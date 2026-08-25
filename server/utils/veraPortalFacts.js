/**
 * VERA portal facts — a grounded, permission-scoped snapshot of the CALLER'S OWN
 * facility, so VERA can answer "is my discharge permit still valid?" or "how full
 * is my active cell?" from any page.
 *
 * Why this exists
 * ---------------
 * VERA could already read the table the user happens to be looking at
 * (veraPageData) and their submission readiness (portalReadiness). Everything
 * else — permits, cell utilization, ticket status, notifications, hauler/client
 * counts — was invisible unless the user was standing on that exact screen, so
 * VERA fell back to generic help articles for questions it had the data to
 * answer precisely.
 *
 * Boundaries (all enforced here, not by the prompt)
 * ------------------------------------------------
 *   • ONLY the caller's assigned SLF. Never another operator's facility.
 *   • Aggregates and status only — never raw submission rows or client records.
 *   • Demo sessions get confidential volumes masked. This block goes into the
 *     PROMPT, which never passes through the res.json masking middleware, so the
 *     masking has to be applied here or a demo session could read real figures
 *     back out of VERA.
 *   • Fetched only when the question is actually about these topics, and cached
 *     per user for a short window so a follow-up question costs nothing.
 */

const { isDemoRequest, MASK } = require("./demoMode");

/** Topics this provider can ground. Deliberately narrow — a miss just means
 *  VERA answers from the knowledge base, which is the old behaviour. */
const FACTS_QUESTION_RE =
  /\b(permit|permits|pto|ecc|discharge|hazwaste|hazardous waste id|valid(ity|ity date)?|expir\w*|cell|cells|capacity|utili[sz]ation|full|remaining|baseline|submission|submissions|submitted|pending|approved|rejected|reverted|ticket|tickets|support|notification|notifications|hauler|haulers|client|clients|address|addresses|province|municipality|incomplete|encoded|upload|uploads|dashboard|summary|status)\b/i;

function wantsPortalFacts(message) {
  return FACTS_QUESTION_RE.test(String(message || ""));
}

// Short TTL: long enough that a multi-question conversation reuses one fetch,
// short enough that VERA never quotes a stale figure after the user acts.
const TTL_MS = 60 * 1000;
const cache = new Map();

function readCache(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (hit) cache.delete(key);
  return null;
}

function writeCache(key, data) {
  cache.set(key, { data, expires: Date.now() + TTL_MS });
  // Bound the map so a long-lived process cannot accumulate stale user entries.
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  }
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Volumes/capacities are confidential; counts, statuses and dates are not. */
const vol = (value, masked) =>
  masked ? MASK : Number(num(value).toFixed(2)).toLocaleString();

const trimmed = (value) => String(value ?? "").trim();

// A stored PSGC identifier, not a place name. The portal's address cascade saves
// the CODE in province/municipality and the readable name alongside it; a record
// carrying only the code is located but not readable, and VERA must not quote
// "0354010000" back to an operator as their municipality.
const isCodeLike = (value) => /^[0-9]{4,}$/.test(trimmed(value));
const placeName = (name, code) => trimmed(name) || (isCodeLike(code) ? "" : trimmed(code));

/**
 * What the facility's OWN baseline is missing, so VERA can answer "which of my
 * haulers have no address?" and "why is my upload rejecting every row?" from
 * facts instead of from general advice.
 *
 * Mirrors the rule in front-end/src/pages/SLFPortal/baselineCompleteness.js.
 * The two are separate implementations of one definition — the browser derives it
 * from the baseline it has loaded, this derives it from the database — so a
 * change to what "incomplete" means has to be made in both, and any drift shows
 * up as VERA and the portal panel disagreeing about the same facility.
 *
 * A hauler with NO CLIENTS is called out first: every disposal row is attributed
 * through Hauler → Client, so such a hauler cannot have a single trip imported,
 * and that is the single most common cause of a whole upload being rejected.
 */
function summarizeBaselineGaps(baselines = []) {
  // accreditedHaulers is duplicated onto every one of an SLF's baseline records
  // (see routes/dataSLF#getAuthoritativeHaulersForEntry), so the same hauler
  // appears many times over. Collapsed by name, newest record first, so each
  // hauler is judged once and on its most recent state.
  const byName = new Map();
  baselines.forEach((baseline) => {
    (baseline.accreditedHaulers || []).forEach((hauler) => {
      const key = trimmed(hauler?.haulerName).toLowerCase();
      if (!key || byName.has(key)) return;
      byName.set(key, hauler);
    });
  });

  const haulersMissingAddress = [];
  const haulersWithoutClients = [];
  const clientsMissingLocation = [];
  const clientsMissingAddress = [];
  let clientCount = 0;

  byName.forEach((hauler) => {
    const name = trimmed(hauler.haulerName) || "(unnamed hauler)";
    if (!trimmed(hauler.officeAddress)) haulersMissingAddress.push(name);

    const seen = new Set();
    const clients = [];
    [
      ...(Array.isArray(hauler.privateSectorClients) ? hauler.privateSectorClients : []),
      ...(Array.isArray(hauler.clients) ? hauler.clients : []),
      ...(Array.isArray(hauler.vehicles)
        ? hauler.vehicles.flatMap((vehicle) => vehicle.selectedClients || [])
        : []),
    ].forEach((entry) => {
      const client = typeof entry === "string" ? { clientName: entry } : entry || {};
      const key = trimmed(client.clientName).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      clients.push(client);
    });

    if (clients.length === 0) {
      haulersWithoutClients.push(name);
      return;
    }
    clientCount += clients.length;
    clients.forEach((client) => {
      const label = `${name} → ${trimmed(client.clientName)}`;
      const province = placeName(client.provinceName, client.province);
      const municipality = placeName(client.municipalityName, client.municipality);
      const missing = [];
      if (!trimmed(client.clientType)) missing.push("type");
      if (!province) missing.push("province");
      if (!municipality) missing.push("municipality");
      if (missing.length) clientsMissingLocation.push(`${label} (no ${missing.join(", ")})`);
      if (!trimmed(client.clientAddress) && !trimmed(client.address)) {
        clientsMissingAddress.push(label);
      }
    });
  });

  return {
    haulerCount: byName.size,
    clientCount,
    haulersMissingAddress,
    haulersWithoutClients,
    clientsMissingLocation,
    clientsMissingAddress,
  };
}

function permitRow(label, number, validity, status) {
  const hasAny = number || validity || String(status || "").trim();
  if (!hasAny) return `${label}: not encoded`;
  if (/^(not[\s_-]*required|n\/?a)$/i.test(String(status || "").trim())) {
    return `${label}: Not Required for this facility`;
  }
  const parts = [];
  if (number) parts.push(String(number));
  if (validity) {
    const d = new Date(validity);
    if (!Number.isNaN(d.getTime())) {
      const days = Math.ceil((d - new Date()) / 86400000);
      const state = days < 0 ? "EXPIRED" : days <= 30 ? `expires in ${days} day(s)` : "valid";
      parts.push(`valid to ${d.toISOString().slice(0, 10)} — ${state}`);
    }
  }
  if (status) parts.push(`status ${status}`);
  return `${label}: ${parts.join(", ")}`;
}

/**
 * Build the fact snapshot for one portal account.
 *
 * @param {object} portalUser lean UserPortal doc (must include assignedSlf)
 * @returns {Promise<object|null>}
 */
async function getPortalFacts(portalUser) {
  if (!portalUser?._id) return null;
  const masked = isDemoRequest();
  const cacheKey = `${portalUser._id}|${masked ? "masked" : "plain"}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const SlfFacility = require("../models/SlfFacility");
  const DataSLF = require("../models/DataSLF");
  const SupportTicket = require("../models/SupportTicket");
  const Notification = require("../models/Notification");

  const slfIds = Array.isArray(portalUser.assignedSlf) ? portalUser.assignedSlf : [];
  if (!slfIds.length) return null;

  // One round trip for all five sources rather than five sequential awaits.
  const [facility, submissions, tickets, unreadNotifications, baselines] = await Promise.all([
    SlfFacility.findById(slfIds[0])
      .select(
        "lgu province barangay statusOfSLF numberOfCell cellNames cellStatuses cellCapacities cellFillValues cellTypes cellCapacityUnits " +
          "permitToOperate permitToOperateValidity permitToOperateStatus dischargePermit dischargePermitValidity dischargePermitStatus eccNo hazwasteGenerationId",
      )
      .lean(),
    DataSLF.find({ slfGenerator: { $in: slfIds }, deletedAt: null })
      .select("status")
      .lean(),
    SupportTicket.find({ portalUserEmail: portalUser.email })
      .select("status")
      .lean()
      .catch(() => []),
    // Notification.recipient is a plain string keyed by e-mail.
    Notification.countDocuments({
      recipient: portalUser.email,
      read: { $ne: true },
    }).catch(() => 0),
    // Only the records that actually carry haulers, newest first — the array is
    // duplicated across an SLF's baselines and is by far the largest field on the
    // document, so this reads the fewest of them that can answer the question.
    DataSLF.find({
      slfGenerator: { $in: slfIds },
      deletedAt: null,
      "accreditedHaulers.0": { $exists: true },
    })
      .select("accreditedHaulers")
      .sort({ createdAt: -1 })
      .limit(25)
      .lean()
      .catch(() => []),
  ]);

  if (!facility) return null;

  const statusCounts = submissions.reduce((acc, s) => {
    const key = String(s.status || "unknown").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const ticketCounts = (tickets || []).reduce((acc, t) => {
    const key = String(t.status || "unknown").toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const cellCount = Math.max(
    num(facility.numberOfCell),
    (facility.cellStatuses || []).length,
    (facility.cellCapacities || []).length,
  );
  const cells = [];
  for (let i = 0; i < cellCount; i += 1) {
    const status = facility.cellStatuses?.[i] || "Active Cell";
    if (/not\s*exist/i.test(status)) continue;
    const capacity = num(facility.cellCapacities?.[i]);
    const fill = num(facility.cellFillValues?.[i]);
    const pct = capacity > 0 ? Math.min(100, Math.round((fill / capacity) * 100)) : null;
    cells.push({
      name: facility.cellNames?.[i] || `Cell ${i + 1}`,
      status,
      type: facility.cellTypes?.[i] || "Residual",
      unit: facility.cellCapacityUnits?.[i] || "m³",
      capacity,
      fill,
      pct,
    });
  }

  const facts = {
    facility: {
      name: facility.lgu || "",
      province: facility.province || "",
      status: facility.statusOfSLF || "",
    },
    permits: [
      permitRow("Permit to Operate", facility.permitToOperate, facility.permitToOperateValidity, facility.permitToOperateStatus),
      permitRow("Discharge Permit", facility.dischargePermit, facility.dischargePermitValidity, facility.dischargePermitStatus),
      permitRow("ECC", facility.eccNo, null, ""),
      permitRow("Hazardous Waste Generator ID", facility.hazwasteGenerationId, null, ""),
    ],
    cells,
    submissions: statusCounts,
    submissionTotal: submissions.length,
    tickets: ticketCounts,
    ticketTotal: (tickets || []).length,
    unreadNotifications: num(unreadNotifications),
    baseline: summarizeBaselineGaps(baselines || []),
    masked,
  };

  writeCache(cacheKey, facts);
  return facts;
}

/**
 * Render facts as a grounded prompt block.
 *
 * Phrased as facts with an explicit instruction not to invent beyond them —
 * the point is to stop VERA guessing at values it now actually knows.
 */
function factsToPromptBlock(facts) {
  if (!facts) return "";
  const lines = [];
  lines.push("PORTAL FACTS (the signed-in user's OWN facility — authoritative, do not contradict):");
  lines.push(`Facility: ${facts.facility.name || "(unnamed)"}${facts.facility.province ? `, ${facts.facility.province}` : ""}${facts.facility.status ? ` — ${facts.facility.status}` : ""}`);

  lines.push("Permits:");
  facts.permits.forEach((p) => lines.push(`  - ${p}`));

  if (facts.cells.length) {
    lines.push("Cells:");
    facts.cells.forEach((c) => {
      const cap = `${vol(c.capacity, facts.masked)} ${c.unit}`;
      const fill = `${vol(c.fill, facts.masked)} ${c.unit}`;
      const pctText = c.pct == null ? "no capacity encoded" : `${c.pct}% full`;
      const warn = c.pct != null && c.pct >= 100 ? " [AT CAPACITY]" : c.pct != null && c.pct >= 85 ? " [NEARLY FULL]" : "";
      lines.push(`  - ${c.name} (${c.type}, ${c.status}): ${pctText}, ${fill} of ${cap}${warn}`);
    });
  } else {
    lines.push("Cells: none encoded.");
  }

  const sub = Object.entries(facts.submissions)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`Submissions (${facts.submissionTotal} total): ${sub || "none"}`);

  const tix = Object.entries(facts.tickets)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`Support tickets (${facts.ticketTotal} total): ${tix || "none"}`);
  lines.push(`Unread notifications: ${facts.unreadNotifications}`);

  // Baseline completeness. Names are listed, not just counted, because the whole
  // value of this block is that VERA can answer "WHICH haulers have no address?"
  // — a count sends the operator back to the table to work it out themselves.
  // Capped so a large fleet cannot crowd out the rest of the prompt.
  const baseline = facts.baseline;
  if (baseline) {
    const list = (values, cap = 12) =>
      values.slice(0, cap).join("; ") +
      (values.length > cap ? ` (+${values.length - cap} more)` : "");
    lines.push(
      `Baseline: ${baseline.haulerCount} accredited hauler(s), ${baseline.clientCount} client record(s).`,
    );
    if (baseline.haulersWithoutClients.length) {
      lines.push(
        `  - ${baseline.haulersWithoutClients.length} hauler(s) have NO clients encoded: ${list(baseline.haulersWithoutClients)}. ` +
          "Every disposal row is attributed through Hauler → Client, so no trip can be uploaded for these until a client is added under them.",
      );
    }
    if (baseline.haulersMissingAddress.length) {
      lines.push(
        `  - ${baseline.haulersMissingAddress.length} hauler(s) have NO office address: ${list(baseline.haulersMissingAddress)}. ` +
          "Fixed in Baseline Data → Accredited Haulers → Edit → Office Address.",
      );
    }
    if (baseline.clientsMissingLocation.length) {
      lines.push(
        `  - ${baseline.clientsMissingLocation.length} client(s) are missing type/province/municipality: ${list(baseline.clientsMissingLocation)}. ` +
          "The province is what classifies a client within or outside Region 3, so these are reported to EMB as incomplete.",
      );
    }
    if (baseline.clientsMissingAddress.length) {
      lines.push(
        `  - ${baseline.clientsMissingAddress.length} client(s) have no address: ${list(baseline.clientsMissingAddress)}.`,
      );
    }
    if (
      !baseline.haulersWithoutClients.length &&
      !baseline.haulersMissingAddress.length &&
      !baseline.clientsMissingLocation.length &&
      !baseline.clientsMissingAddress.length
    ) {
      lines.push("  - No gaps: every hauler has an office address and clients, and every client has a location.");
    }
    lines.push(
      "  - Note on special economic zones: Clark Freeport Zone, Subic Bay Freeport Zone, the Freeport Area of Bataan and similar zones ARE selectable as a client's City/Municipality — they appear in the picker under their host province alongside the ordinary municipalities. A client inside one should be encoded with the zone itself, not with a neighbouring municipality.",
    );
  }

  if (facts.masked) {
    lines.push(
      "NOTE: this is a DEMONSTRATION account — volume and capacity figures are masked. " +
        "State that they are hidden for the demo; never estimate or reconstruct them.",
    );
  }
  lines.push(
    "Use these facts to answer directly and to recommend the next action. If the question needs a figure that is not listed above, say what is missing rather than guessing.",
  );
  return lines.join("\n");
}

module.exports = {
  wantsPortalFacts,
  getPortalFacts,
  factsToPromptBlock,
  FACTS_QUESTION_RE,
};
