// Deterministic VERA findings for the admin VERA notification bell. These are
// computed by backend queries + deterministic validation (never by the model),
// then surfaced as sanitized, role-appropriate notifications. Cached briefly so
// polling the bell never triggers repeated scans.
//
// Severity model: informational | recommendation | warning | critical.
// Model-generated *suggestions* are never "critical" — only deterministic system
// validation is. (Everything here is deterministic.)
//
// Every finding carries the full admin-actionable shape:
//   { id, category (issue type), sourceModule, severity, title, message
//     (description), recommendedAction, affectedUser, affectedSlf, status
//     (resolution status), actionUrl, createdAt }

const { matchClient } = require("./lguMatch");

let _cache = { at: 0, data: null };
const TTL_MS = Number(process.env.VERA_FINDINGS_TTL_MS) || 60_000;

// Map a logged action string (e.g. "submission.create.error") to a human module
// name so each finding names its source module per spec.
function moduleFromAction(action = "") {
  const a = String(action).toLowerCase();
  if (a.includes("baseline")) return "SLF Baseline";
  if (a.includes("cell")) return "Cell Waste Placement";
  if (a.includes("portal")) return "SLF Portal";
  if (a.includes("submission") || a.includes("data-slf") || a.includes("dataslf")) return "SLF Submissions";
  if (a.includes("vera")) return "VERA";
  if (a.includes("upload")) return "File Upload";
  return "SLF Data";
}

// Normalize a finding to guarantee every spec field is present.
function finding(f) {
  return {
    id: f.id,
    category: f.category, // issue type
    sourceModule: f.sourceModule || "SLF Data",
    severity: f.severity || "informational",
    title: f.title,
    message: f.message, // description
    recommendedAction: f.recommendedAction || "",
    affectedUser: f.affectedUser || "",
    affectedSlf: f.affectedSlf || "",
    status: f.status || "open", // resolution status
    actionUrl: f.actionUrl || "",
    createdAt: f.createdAt || new Date(),
  };
}

async function computeAdminFindings() {
  const SlfClient = require("../models/SlfClient");
  const Region3Lgu = require("../models/Region3Lgu");
  const AppSettings = require("../models/AppSettings");
  const agent = require("./automationAgent");

  const findings = [];
  const now = new Date();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // ── SLF operational failures (failed submissions / CRUD / API / DB) ─────────
  // Sourced from AppLog error-level entries the SLF routes now record in their
  // 500 catch blocks. Grouped by action so one flapping endpoint is a single
  // finding, not dozens. This is what makes a failed submission visible to admins.
  try {
    const AppLog = require("../models/AppLog");
    const groups = await AppLog.aggregate([
      {
        $match: {
          level: "error",
          createdAt: { $gte: since24h },
          action: { $regex: /submission|data-slf|dataslf|baseline|cell|portal|upload/i },
        },
      },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
          lastAt: { $max: "$createdAt" },
          lastMessage: { $last: "$message" },
          users: { $addToSet: "$user" },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: 10 },
    ]);
    for (const g of groups) {
      const affected = (g.users || []).filter((u) => u && u !== "system");
      findings.push(
        finding({
          id: `applog-err-${g._id}-${g.count}`,
          category: "operational-failure",
          sourceModule: moduleFromAction(g._id),
          severity: g.count >= 5 ? "critical" : "warning",
          title: `Repeated failures in ${moduleFromAction(g._id)}`,
          message: `${g.count} failed operation${g.count === 1 ? "" : "s"} (${g._id}) in the last 24h${g.lastMessage ? `. Latest: ${String(g.lastMessage).slice(0, 160)}` : "."}`,
          recommendedAction: "Open Developer Settings → App Logs, filter by this action to inspect the error and affected records, then retry or correct the underlying data.",
          affectedUser: affected.slice(0, 3).join(", "),
          status: "open",
          actionUrl: "app-logs",
          createdAt: g.lastAt,
        })
      );
    }
  } catch { /* non-blocking */ }

  // ── Repeated portal-user errors ─────────────────────────────────────────────
  // A single portal user hitting many warn/error events in 24h usually means they
  // are stuck (bad units, failed submits) and may need a direct nudge from an admin.
  try {
    const AppLog = require("../models/AppLog");
    const perUser = await AppLog.aggregate([
      {
        $match: {
          level: { $in: ["warn", "error"] },
          createdAt: { $gte: since24h },
          user: { $nin: [null, "", "system", "admin"] },
          action: { $regex: /submission|portal|baseline|cell/i },
        },
      },
      { $group: { _id: "$user", count: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
      { $match: { count: { $gte: 3 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);
    for (const u of perUser) {
      findings.push(
        finding({
          id: `portal-user-errors-${u._id}-${u.count}`,
          category: "repeated-portal-errors",
          sourceModule: "SLF Portal",
          severity: u.count >= 8 ? "warning" : "recommendation",
          title: "Portal user hitting repeated errors",
          message: `${u._id} triggered ${u.count} submission/portal errors or warnings in the last 24h — they may be blocked on units, validation, or a failing submission.`,
          recommendedAction: `Message ${u._id} from Portal Users, or review their recent submissions for the failing field.`,
          affectedUser: u._id,
          status: "open",
          actionUrl: "portal-users",
          createdAt: u.lastAt,
        })
      );
    }
  } catch { /* non-blocking */ }

  // ── Portal-user reporting backlogs (pending/overdue data updates) ───────────
  // Detects (and stores) backlogs from the app's own status rules, then surfaces
  // the OPEN ones so admins see who is behind and why. Kept open until submitted.
  try {
    const backlog = require("./veraBacklog");
    await backlog.detectBacklogs().catch(() => {});
    const open = await backlog.getOpenBacklogs(20);
    for (const b of open) {
      findings.push(
        finding({
          id: `backlog-${b.signature}`,
          category: "portal-backlog",
          sourceModule: "SLF Portal",
          severity: b.escalationStatus === "escalated" ? "warning" : "recommendation",
          title: `Reporting backlog — ${b.portalUserEmail}`,
          message: `${b.detectedIssue} Reporting period ${b.reportingPeriod}. VERA status: ${b.status.replace(/_/g, " ")}.`,
          recommendedAction: b.recommendation,
          affectedUser: b.portalUserEmail,
          affectedSlf: b.slfName || "",
          status: b.status,
          actionUrl: "portal-users",
          createdAt: b.lastSeenAt || now,
        })
      );
    }
  } catch { /* non-blocking */ }

  // ── Open SLF data issues (missing / inconsistent data, unit/total mismatches) ─
  // SlfDataIssue already tracks these with a lifecycle (open/resolved) and a
  // sourceModule, so surface the OPEN ones grouped by flag type. validation_mismatch
  // is where a unit/total disagreement (e.g. a unit-conversion inconsistency) lands.
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const open = await SlfDataIssue.find({ status: "open" })
      .select("flagType description sourceModule clientName portalUserEmail lastSeenAt")
      .sort({ lastSeenAt: -1 })
      .limit(50)
      .lean();
    const byType = new Map();
    for (const it of open) {
      const key = it.flagType;
      if (!byType.has(key)) byType.set(key, { count: 0, lastAt: it.lastSeenAt, sample: it });
      const g = byType.get(key);
      g.count += 1;
      if (it.lastSeenAt && it.lastSeenAt > g.lastAt) g.lastAt = it.lastSeenAt;
    }
    const LABELS = {
      validation_mismatch: { title: "Data totals disagree (possible unit/conversion mismatch)", sev: "warning", action: "Open LGU Reconciliation / affected SLF and re-check the unit and totals — a tons/m³ mismatch makes dashboard totals diverge." },
      missing_type: { title: "Client records missing LGU/Private type", sev: "warning", action: "Set the client type in LGUs Served so submissions classify correctly." },
      missing_hauler: { title: "Clients not attached to any hauler", sev: "recommendation", action: "Link the client to its accredited hauler in the baseline." },
      unknown_hauler: { title: "Client references an unknown hauler", sev: "warning", action: "Correct the hauler name in the baseline accredited-haulers list." },
      duplicate_client: { title: "Duplicate client assignments", sev: "recommendation", action: "Merge or remove the duplicate client in LGUs Served." },
      conflicting_portal_users: { title: "Client tied to multiple portal accounts", sev: "warning", action: "Resolve the portal-account conflict in Portal Users." },
      invalid_baseline: { title: "Baseline records missing required fields", sev: "warning", action: "Complete the missing baseline identifying fields." },
      unmigrated_baseline_client: { title: "Baseline client could not be saved", sev: "warning", action: "Re-run baseline sync after correcting the client record." },
      ambiguous_duplicate: { title: "Possible duplicate needs a decision", sev: "recommendation", action: "Review and merge/keep in LGU Reconciliation." },
      region_unclassified: { title: "Client location not classified to a region", sev: "recommendation", action: "Set the client's province/municipality so it classifies within Region 3." },
    };
    for (const [flagType, g] of byType.entries()) {
      const meta = LABELS[flagType] || { title: `Open data issue: ${flagType}`, sev: "recommendation", action: "Review in LGU Reconciliation." };
      findings.push(
        finding({
          id: `data-issue-${flagType}-${g.count}`,
          category: flagType === "validation_mismatch" ? "unit-conversion" : "data-integrity",
          sourceModule: g.sample?.sourceModule || "baseline-sync",
          severity: meta.sev,
          title: meta.title,
          message: `${g.count} open ${flagType.replace(/_/g, " ")} issue${g.count === 1 ? "" : "s"}${g.sample?.description ? ` — e.g. ${String(g.sample.description).slice(0, 140)}` : ""}.`,
          recommendedAction: meta.action,
          affectedUser: g.sample?.portalUserEmail || "",
          affectedSlf: g.sample?.clientName || "",
          status: "open",
          actionUrl: "lgu-reconciliation",
          createdAt: g.lastAt || now,
        })
      );
    }
  } catch { /* non-blocking */ }

  // ── Unlinked LGU records (reconciliation) ──────────────────────────────────
  try {
    const [masters, clients] = await Promise.all([
      Region3Lgu.find({ status: "Active", lguType: { $in: ["Municipality", "City"] } })
        .select("name normalizedName province normalizedProvince municipalityCity psgcCode lguType aliases").lean(),
      SlfClient.find({ deletedAt: null, isCanonical: true, mergedInto: null, status: "Active", isDummy: { $ne: true }, type: "LGU" })
        .select("name municipalityCity province").lean(),
    ]);
    let unlinked = 0, highConfidence = 0, needsReview = 0;
    clients.forEach((c) => {
      const r = matchClient({ municipality: c.municipalityCity, province: c.province, name: c.name }, masters);
      const deterministic = r.classification === "exact" || (r.suggestions[0] && r.suggestions[0].method === "alias");
      if (deterministic) return;
      unlinked += 1;
      if (r.classification === "high") highConfidence += 1;
      else if (["multiple", "none", "invalid"].includes(r.classification)) needsReview += 1;
    });
    if (unlinked > 0) {
      findings.push(
        finding({
          id: `lgu-unlinked-${unlinked}`,
          category: "lgu-reconciliation",
          sourceModule: "LGUs Served",
          severity: "recommendation",
          title: "Unlinked LGU records",
          message: `${unlinked} LGU client record${unlinked === 1 ? "" : "s"} need masterlist reconciliation${highConfidence ? ` — ${highConfidence} have a high-confidence match ready` : ""}.`,
          recommendedAction: "Open LGUs Served → Reconcile unlinked.",
          status: "open",
          actionUrl: "lgu-reconciliation",
          createdAt: now,
        })
      );
    }
    if (needsReview > 0) {
      findings.push(
        finding({
          id: `lgu-review-${needsReview}`,
          category: "data-quality",
          sourceModule: "LGUs Served",
          severity: "warning",
          title: "LGU records need manual review",
          message: `${needsReview} municipality value${needsReview === 1 ? "" : "s"} have no reliable / multiple possible masterlist matches and require a manual decision.`,
          recommendedAction: "Open LGUs Served → Reconcile and pick the correct masterlist match.",
          status: "open",
          actionUrl: "lgu-reconciliation",
          createdAt: now,
        })
      );
    }
  } catch { /* non-blocking */ }

  // ── VERA provider health ───────────────────────────────────────────────────
  try {
    const settings = await AppSettings.findOne().lean().catch(() => null);
    const operational = agent.isOperational(settings?.automationAgent || {});
    if (!operational) {
      findings.push(
        finding({
          id: "vera-help-library-mode",
          category: "vera-health",
          sourceModule: "VERA",
          severity: "informational",
          title: "VERA is in help-library mode",
          message: "No AI provider is configured, so VERA answers from its built-in knowledge base. Configure the provider in settings to enable AI-phrased replies.",
          recommendedAction: "Configure the automation-agent provider in Developer Settings to enable AI-phrased replies.",
          status: "open",
          actionUrl: "",
          createdAt: now,
        })
      );
    }
  } catch { /* non-blocking */ }

  // Most severe first, then most recent — so critical failures lead the bell.
  const sevRank = { critical: 0, warning: 1, recommendation: 2, informational: 3 };
  findings.sort((a, b) => {
    const s = (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9);
    if (s !== 0) return s;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return findings;
}

// Cached accessor (role gating is enforced by the route, not here).
async function getAdminFindings() {
  if (_cache.data && Date.now() - _cache.at < TTL_MS) return _cache.data;
  const data = await computeAdminFindings();
  _cache = { at: Date.now(), data };
  return data;
}

function clearFindingsCache() { _cache = { at: 0, data: null }; }

module.exports = { getAdminFindings, clearFindingsCache };
