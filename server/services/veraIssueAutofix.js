// VERA resolves Hauler Clients data issues on its own — the "Let VERA fix" action.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Measured on live data (2026-10-12): 28,479 OPEN issues for 525 clients. They
// were not 28,479 problems:
//
//   duplicate_client     20,177 rows → 517 distinct, up to 78 copies of one
//   region_unclassified   8,130 rows → 435 distinct, up to 80 copies of one
//   missing_hauler          171 rows →   9 distinct, up to 19 copies of one
//
// An SLF's accreditedHaulers roster is copied onto EVERY one of its
// baseline-carrying records, and the sync's issue signature carried the baseline
// id — so one problem was filed once per copy. Older sync versions also used
// other signature formats, and the sync never closed an issue it had stopped
// detecting, so every superseded copy stayed open for good. `duplicate_client`
// is not even produced any more: it fired when one client was read from several
// copies of the same roster, which the sync now merges into one canonical client.
//
// ── What VERA does (and does not) do ─────────────────────────────────────────
// Only DETERMINISTIC, explainable actions, each recorded on the issue it closes
// (resolvedBy "VERA", with the reason):
//
//   1. Collapses copies — one open issue per real problem, the newest kept.
//   2. Closes flags the data no longer supports:
//        • duplicate_client, once the client exists as one canonical record;
//        • region_unclassified, once the client has a province/region;
//        • missing_hauler, once that portal user's link to the client names one.
//   3. Repairs location: a region_unclassified client whose name/address matches
//      the Region 3 masterlist with ONE unambiguous province gets that province
//      and municipality — the same proposal the per-issue "VERA" button makes
//      (routes/slfClients → buildIssueSuggestion), applied without the extra
//      click because it is unambiguous.
//
// Everything that needs a person stays open: an ambiguous masterlist match, a
// client outside Region 3, a hauler that was never declared, a client listed
// under two types. Nothing is deleted; every action can be reopened.

const SlfClient = require("../models/SlfClient");
const SlfDataIssue = require("../models/SlfDataIssue");

const norm = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The identity of the PROBLEM an issue describes — what makes two rows copies of
 * one another. Never the baseline id: that is which copy of the roster it was
 * read from, not what is wrong.
 */
function problemKey(issue) {
  const flag = issue.flagType;
  const name = norm(issue.clientName);
  switch (flag) {
    // A client-level fact: the same client is unclassified, or ambiguous,
    // whoever declared it.
    case "region_unclassified":
    case "ambiguous_duplicate":
    case "conflicting_portal_users":
      return `${flag}|${name}`;
    // Per declaration: this portal user's roster, this hauler.
    case "missing_hauler":
    case "missing_type":
    case "duplicate_client":
    case "unknown_hauler":
      return `${flag}|${name}|${norm(issue.hauler)}|${String(issue.portalUserEmail || "").toLowerCase()}`;
    // Genuinely per-record.
    default:
      return `${flag}|${String(issue._id)}`;
  }
}

const VERA = "VERA (automatic fix)";

async function runVeraIssueAutofix({ actor = "admin", buildIssueSuggestion, loadMasters, dryRun = false } = {}) {
  const started = Date.now();
  const summary = {
    scanned: 0,
    duplicateCopies: 0,
    staleClosed: { duplicate_client: 0, region_unclassified: 0, missing_hauler: 0 },
    repaired: 0,
    leftOpen: 0,
    leftOpenByType: {},
    repairedClients: [],
  };

  const issues = await SlfDataIssue.find({ status: "open" })
    .select("_id flagType clientName clientType hauler portalUserEmail client lastSeenAt createdAt")
    .lean();
  summary.scanned = issues.length;

  const resolveOps = [];
  const resolve = (issue, notes) => {
    resolveOps.push({
      updateOne: {
        filter: { _id: issue._id, status: "open" },
        update: {
          $set: {
            status: "resolved",
            resolvedAt: new Date(),
            resolvedBy: VERA,
            resolutionNotes: `${notes} (run by ${actor})`,
          },
        },
      },
    });
  };

  // ── 1. One open issue per real problem ──
  const groups = new Map();
  for (const issue of issues) {
    const key = problemKey(issue);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  const survivors = [];
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        new Date(b.lastSeenAt || b.createdAt || 0) - new Date(a.lastSeenAt || a.createdAt || 0) ||
        String(b._id).localeCompare(String(a._id)),
    );
    const [keep, ...copies] = list;
    survivors.push(keep);
    copies.forEach((copy) => {
      summary.duplicateCopies += 1;
      resolve(
        copy,
        `VERA: duplicate copy of issue ${keep._id} — the same problem was filed once per baseline copy of the hauler roster`,
      );
    });
  }

  // ── 2 & 3. Re-check each surviving problem against the current data ──
  const names = [...new Set(survivors.map((i) => i.clientName).filter(Boolean))];
  const clients = await SlfClient.find({ name: { $in: names }, deletedAt: null, mergedInto: null })
    .select("name type province region regionClass municipalityCity address portalUserRelationships")
    .lean();
  const byNameType = new Map();
  const byName = new Map();
  clients.forEach((c) => {
    byNameType.set(`${c.name}|${c.type || ""}`, c);
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  });
  const clientFor = (issue) =>
    byNameType.get(`${issue.clientName}|${issue.clientType || ""}`) ||
    ((byName.get(issue.clientName) || []).length === 1 ? byName.get(issue.clientName)[0] : null);

  const masters = typeof loadMasters === "function" ? await loadMasters() : [];
  const clientWrites = [];

  for (const issue of survivors) {
    const client = clientFor(issue);
    let closed = false;

    if (issue.flagType === "duplicate_client" && client) {
      summary.staleClosed.duplicate_client += 1;
      resolve(
        issue,
        `VERA: "${client.name}" is one canonical client record. The repeat declarations came from copies of the same hauler roster, which the sync now merges`,
      );
      closed = true;
    } else if (issue.flagType === "region_unclassified" && client) {
      if (client.province || (client.regionClass && client.regionClass !== "unclassified")) {
        summary.staleClosed.region_unclassified += 1;
        resolve(issue, `VERA: "${client.name}" is now classified (${client.province || client.regionClass})`);
        closed = true;
      } else if (typeof buildIssueSuggestion === "function" && masters.length) {
        const suggestion = buildIssueSuggestion(issue, client, masters);
        if (suggestion.canFix && suggestion.confidence === "high") {
          const { province, municipalityCity } = suggestion.proposal;
          clientWrites.push({
            updateOne: {
              filter: { _id: client._id, province: { $in: [null, ""] } },
              update: {
                $set: {
                  province,
                  ...(municipalityCity ? { municipalityCity } : {}),
                  regionClass: "within-region-3",
                  updatedBy: VERA,
                },
              },
            },
          });
          summary.repaired += 1;
          summary.repairedClients.push({ client: client.name, province, municipalityCity });
          resolve(issue, `VERA: ${suggestion.rationale} Province set to "${province}"${municipalityCity ? `, municipality "${municipalityCity}"` : ""}`);
          closed = true;
        }
      }
    } else if (issue.flagType === "missing_hauler" && client) {
      const email = String(issue.portalUserEmail || "").toLowerCase();
      const linked = (client.portalUserRelationships || []).some(
        (rel) => String(rel.portalUserEmail || "").toLowerCase() === email && String(rel.hauler || "").trim(),
      );
      if (linked) {
        summary.staleClosed.missing_hauler += 1;
        resolve(issue, `VERA: "${client.name}" is now linked to a named hauler for ${issue.portalUserEmail}`);
        closed = true;
      }
    }

    if (!closed) {
      summary.leftOpen += 1;
      summary.leftOpenByType[issue.flagType] = (summary.leftOpenByType[issue.flagType] || 0) + 1;
    }
  }

  // Client repairs first, so an issue is never closed for a write that failed.
  // `dryRun` computes the whole plan and writes nothing — for previewing a run.
  if (!dryRun) {
    if (clientWrites.length) await SlfClient.bulkWrite(clientWrites, { ordered: false });
    for (let i = 0; i < resolveOps.length; i += 1000) {
      await SlfDataIssue.bulkWrite(resolveOps.slice(i, i + 1000), { ordered: false });
    }
  }
  summary.dryRun = dryRun;
  summary.resolved = resolveOps.length;
  summary.durationMs = Date.now() - started;
  summary.repairedClients = summary.repairedClients.slice(0, 50);
  return summary;
}

module.exports = { runVeraIssueAutofix, problemKey };
