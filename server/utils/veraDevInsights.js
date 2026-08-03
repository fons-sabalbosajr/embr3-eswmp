// VERA operational insights — curated, SAFE aggregate metrics only.
//
// Two audiences share one computation:
//   • Admin  → operational / management view (counts, health, statistics).
//   • Developer → the full technical view (adds runtime diagnostics, error-log
//     detail, queue/job internals, DB state, notification metrics).
//
// This module computes small aggregates (counts, booleans, uptime, memory) — it
// NEVER returns raw PII rows, secrets, credentials, environment values, or
// connection strings, and nothing here reaches the model beyond these
// numbers/booleans and app-generated log summaries.

const mongoose = require("mongoose");

const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const UserPortal = require("../models/UserPortal");
const User = require("../models/User");
const AppLog = require("../models/AppLog");
const Notification = require("../models/Notification");
const PortalSubmissionQueue = require("../models/PortalSubmissionQueue");
const SlfSyncJob = require("../models/SlfSyncJob");
const AppSettings = require("../models/AppSettings");
const agent = require("./automationAgent");
const { normalizeStatus } = require("./submissionStatus");

const READY_STATES = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };
// Exclude soft-deleted / test facilities so counts match the dashboard/map/reports.
const LIVE_FACILITY_FILTER = { isDummy: { $ne: true }, deletedAt: null };

function fmtUptime(sec) {
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor((sec / 3600) % 24);
  const d = Math.floor(sec / 86400);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean).join(" ");
}
const mb = (bytes) => Math.round((bytes || 0) / (1024 * 1024));
const fmtTime = (d) => {
  try { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
};
const trim = (v, n = 120) => String(v || "").replace(/[\x00-\x1F\x7F]/g, " ").trim().slice(0, n); // eslint-disable-line no-control-regex

function redactActor(value) {
  const text = trim(value, 80);
  if (!text) return "Unknown operator";
  const email = text.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!email) return text.length > 6 ? `${text.slice(0, 2)}***${text.slice(-2)}` : "Operator";
  const [, local, domain] = email;
  const domainParts = domain.split(".");
  const org = domainParts.length > 1 ? domainParts.slice(-2).join(".") : domain;
  return `${local.slice(0, 2)}***@${org}`;
}

function canViewPermission(userDoc, key) {
  if (!key) return false;
  if (userDoc?.role === "developer") return true;
  const p = userDoc?.permissions?.[key];
  return p === true || (p && typeof p === "object" && p.view === true);
}

async function resolveAccess(req) {
  if (req?.user?.role === "developer") return { developer: true, can: () => true };
  const user = await User.findById(req?.user?.id).select("role permissions").lean().catch(() => null);
  const can = (...keys) => keys.some((key) => canViewPermission(user, key));
  return { developer: false, can };
}

// Compute the full curated metrics object. Every sub-section is guarded so a
// single failing query never breaks the whole response.
async function computeInsights(req) {
  const now = new Date();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const settings = await AppSettings.findOne().lean().catch(() => null);
  const a = settings?.automationAgent || {};
  const access = await resolveAccess(req);
  const allowed = {
    dashboard: access.can("dashboard", "portalData", "submissions"),
    submissions: access.can("submissions", "portalData"),
    portalUsers: access.can("portalUsers"),
    settings: access.can("developerSettings", "accountSettings"),
    notifications: access.can("notificationManagement", "dashboard"),
    logs: access.can("developerSettings", "dashboard"),
  };

  // ── Submission statistics (counts by normalized status) ──
  const submissions = { authorized: allowed.submissions, total: 0, pending: 0, acknowledged: 0, reverted: 0, rejected: 0, last24h: 0 };
  const dashboard = { authorized: allowed.dashboard, wasteReceivedM3: 0, wasteReceivedTons: 0, baselineReports: 0, activeBaselineUpdates: 0, lguSubmissions: 0, privateSubmissions: 0 };
  let operatorPerformance = [];
  if (allowed.submissions) try {
    const rows = await DataSLF.aggregate([{ $match: { deletedAt: null, isDummy: { $ne: true } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]);
    for (const r of rows) {
      submissions.total += r.count;
      const n = normalizeStatus(r._id);
      submissions[n] = (submissions[n] || 0) + r.count;
    }
    submissions.last24h = await DataSLF.countDocuments({ deletedAt: null, isDummy: { $ne: true }, createdAt: { $gte: dayAgo } });
  } catch { /* leave zeros */ }

  if (allowed.dashboard) try {
    const [totals = {}, baselineRows, byCompany, operators] = await Promise.all([
      DataSLF.aggregate([
        { $match: { deletedAt: null, isDummy: { $ne: true } } },
        { $group: { _id: null, wasteReceivedM3: { $sum: { $ifNull: ["$totalVolumeM3", 0] } }, wasteReceivedTons: { $sum: { $ifNull: ["$totalVolumeTons", 0] } } } },
      ]).then((rows) => rows[0] || {}),
      DataSLF.aggregate([
        { $match: { deletedAt: null, isDummy: { $ne: true }, $or: [{ totalVolumeAccepted: { $ne: null } }, { activeCellEntries: { $ne: [] } }, { closedCellEntries: { $ne: [] } }] } },
        { $group: { _id: null, count: { $sum: 1 }, updateRequests: { $sum: { $cond: [{ $eq: ["$baselineUpdateRequested", true] }, 1, 0] } } } },
      ]).then((rows) => rows[0] || {}),
      DataSLF.aggregate([{ $match: { deletedAt: null, isDummy: { $ne: true } } }, { $group: { _id: "$companyType", count: { $sum: 1 } } }]),
      DataSLF.aggregate([
        { $match: { deletedAt: null, isDummy: { $ne: true }, submittedBy: { $nin: [null, ""] } } },
        { $group: { _id: "$submittedBy", submissions: { $sum: 1 }, acknowledged: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } }, pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } }, lastSubmissionAt: { $max: "$createdAt" } } },
        { $sort: { submissions: -1, lastSubmissionAt: -1 } },
        { $limit: 5 },
      ]),
    ]);
    dashboard.wasteReceivedM3 = totals.wasteReceivedM3 || 0;
    dashboard.wasteReceivedTons = totals.wasteReceivedTons || 0;
    dashboard.baselineReports = baselineRows.count || 0;
    dashboard.activeBaselineUpdates = baselineRows.updateRequests || 0;
    byCompany.forEach((row) => {
      if (row._id === "LGU") dashboard.lguSubmissions = row.count;
      if (row._id === "Private") dashboard.privateSubmissions = row.count;
    });
    operatorPerformance = operators.map((row) => ({
      operator: redactActor(row._id),
      submissions: row.submissions,
      acknowledged: row.acknowledged,
      pending: row.pending,
      lastSubmissionAt: fmtTime(row.lastSubmissionAt),
    }));
  } catch { /* leave zeros */ }

  // ── SLF facilities ──
  const slf = { total: 0, operational: 0, nonOperational: 0, notMonitored: 0 };
  try {
    const rows = await SlfFacility.aggregate([
      { $match: LIVE_FACILITY_FILTER },
      {
        $group: {
          _id: {
            $cond: [
              { $regexMatch: { input: { $ifNull: ["$statusOfSLF", ""] }, regex: /operational/i } },
              { $cond: [{ $regexMatch: { input: { $ifNull: ["$statusOfSLF", ""] }, regex: /non/i } }, "non", "op"] },
              "nm",
            ],
          },
          count: { $sum: 1 },
        },
      },
    ]);
    for (const r of rows) {
      slf.total += r.count;
      if (r._id === "op") slf.operational += r.count;
      else if (r._id === "non") slf.nonOperational += r.count;
      else slf.notMonitored += r.count;
    }
  } catch { /* leave zeros */ }

  // ── Users ──
  const users = { authorized: allowed.portalUsers, portalTotal: 0, portalPending: 0, portalApproved: 0, portalRejected: 0, adminTotal: 0, blocked: 0, selfServiceEnabled: 0, activeLast24h: 0 };
  if (allowed.portalUsers) try {
    const [portalStatus, adminTotal, blocked, selfServiceEnabled, activeLast24h] = await Promise.all([
      UserPortal.aggregate([{ $match: { isDummy: { $ne: true } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      User.countDocuments({}),
      UserPortal.countDocuments({ isDummy: { $ne: true }, blocked: true }),
      UserPortal.countDocuments({ isDummy: { $ne: true }, allowCredentialSelfService: true }),
      UserPortal.countDocuments({ isDummy: { $ne: true }, lastActiveAt: { $gte: dayAgo } }),
    ]);
    users.adminTotal = adminTotal;
    users.blocked = blocked;
    users.selfServiceEnabled = selfServiceEnabled;
    users.activeLast24h = activeLast24h;
    portalStatus.forEach((row) => {
      users.portalTotal += row.count;
      if (row._id === "pending") users.portalPending = row.count;
      if (row._id === "approved") users.portalApproved = row.count;
      if (row._id === "rejected") users.portalRejected = row.count;
    });
  } catch { /* leave zeros */ }

  // ── Notifications ──
  const notifications = { authorized: allowed.notifications, total: 0, unread: 0, adminUnread: 0, last24h: 0 };
  if (allowed.notifications) try {
    notifications.total = await Notification.countDocuments({});
    notifications.unread = await Notification.countDocuments({ read: false });
    notifications.adminUnread = await Notification.countDocuments({ recipient: "admin", read: false });
    notifications.last24h = await Notification.countDocuments({ createdAt: { $gte: dayAgo } });
  } catch { /* leave zeros */ }

  // ── Queue & jobs ──
  const queue = { draft: 0, scheduled: 0, submitted: 0, failed: 0, cancelled: 0 };
  try {
    const rows = await PortalSubmissionQueue.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    for (const r of rows) if (r._id in queue) queue[r._id] = r.count;
  } catch { /* leave zeros */ }

  let syncJob = null;
  try {
    const job = await SlfSyncJob.findOne().sort({ createdAt: -1 }).lean();
    if (job) {
      syncJob = {
        scope: job.scope || "",
        status: job.status || "",
        percent: job.percent || 0,
        finishedAt: job.finishedAt || job.updatedAt || null,
        error: trim(job.errorMessage, 100),
      };
    }
  } catch { /* leave null */ }

  // ── Activity + logs ──
  const activity = { authorized: allowed.logs, logs24h: 0, errors24h: 0, warns24h: 0, failedLogins24h: 0, successfulLogins24h: 0 };
  if (allowed.logs) try {
    activity.logs24h = await AppLog.countDocuments({ createdAt: { $gte: dayAgo } });
    activity.errors24h = await AppLog.countDocuments({ level: "error", createdAt: { $gte: dayAgo } });
    activity.warns24h = await AppLog.countDocuments({ level: "warn", createdAt: { $gte: dayAgo } });
    activity.failedLogins24h = await AppLog.countDocuments({ createdAt: { $gte: dayAgo }, action: /login/i, level: { $in: ["warn", "error"] } });
    activity.successfulLogins24h = await AppLog.countDocuments({ createdAt: { $gte: dayAgo }, action: /login/i, level: "info" });
  } catch { /* leave zeros */ }

  let latestEvent = null;
  if (allowed.logs) try {
    const ev = await AppLog.findOne().sort({ createdAt: -1 }).select("action message level createdAt").lean();
    if (ev) latestEvent = { action: ev.action, message: trim(ev.message, 140), level: ev.level, at: fmtTime(ev.createdAt) };
  } catch { /* leave null */ }

  let recentErrors = [];
  if (allowed.logs) try {
    const errs = await AppLog.find({ level: "error" }).sort({ createdAt: -1 }).limit(5).select("action message createdAt").lean();
    recentErrors = errs.map((e) => ({ action: e.action, message: trim(e.message, 120), at: fmtTime(e.createdAt) }));
  } catch { /* leave empty */ }

  let recentPortalLogins = [];
  if (allowed.portalUsers && allowed.logs) try {
    const loginLogs = await AppLog.find({ action: /^portal\.login/ })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("level action user ip meta createdAt")
      .lean();
    const emails = [...new Set(loginLogs.map((log) => String(log.user || "").trim().toLowerCase()).filter(Boolean))];
    const usersByEmail = new Map();
    if (emails.length) {
      const portalUsers = await UserPortal.find({ email: { $in: emails } })
        .select("firstName lastName username email status")
        .lean();
      portalUsers.forEach((u) => usersByEmail.set(String(u.email || "").toLowerCase(), u));
    }
    recentPortalLogins = loginLogs.map((log) => {
      const email = String(log.user || "").trim().toLowerCase();
      const u = usersByEmail.get(email);
      const name = u ? ([u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || "Portal User") : "Unknown portal user";
      return {
        name: trim(name, 80),
        email: trim(email, 100),
        role: "portal_user",
        status: log.meta?.status || (log.level === "info" ? "success" : "failed"),
        reason: log.meta?.reason || "",
        accountStatus: u?.status || "unknown",
        at: fmtTime(log.createdAt),
        ip: trim(log.ip, 64) || "not stored",
        device: trim(log.meta?.userAgent, 120) || "not stored",
      };
    });
  } catch { /* leave empty */ }

  // ── Service health ──
  const dbState = mongoose.connection?.readyState ?? 0;
  let emailOk = null;
  try {
    const { verifyTransporter } = require("./email");
    await verifyTransporter();
    emailOk = true;
  } catch { emailOk = false; }
  let socketClients = null;
  try { socketClients = req?.app?.get("io")?.engine?.clientsCount ?? null; } catch { /* ignore */ }

  const aiOperational = agent.isOperational(a);
  const veraEnabled = String(process.env.VERA_ENABLED ?? "true").toLowerCase() !== "false";
  const memUsage = process.memoryUsage();

  return {
    generatedAt: now.toISOString(),
    system: {
      uptime: fmtUptime(process.uptime()),
      uptimeSeconds: Math.floor(process.uptime()),
      nodeEnv: process.env.NODE_ENV || "development",
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid,
      veraEnabled,
      aiProvider: agent.resolveProvider(a),
      aiOperational,
    },
    runtime: {
      memoryRssMB: mb(memUsage.rss),
      memoryHeapUsedMB: mb(memUsage.heapUsed),
      memoryHeapTotalMB: mb(memUsage.heapTotal),
    },
    submissions,
    dashboard,
    operatorPerformance,
    slf,
    users: { ...users, activeSessions: socketClients },
    notifications,
    queue,
    syncJob,
    activity,
    latestEvent,
    recentErrors,
    recentPortalLogins,
    services: {
      database: READY_STATES[dbState] || "unknown",
      databaseOk: dbState === 1,
      email: emailOk === null ? "unknown" : emailOk ? "ok" : "error",
      aiAgent: aiOperational ? "ok" : "not-configured",
      socketClients,
      apiUp: true, // this handler responded, so the API layer is up
    },
    settings: {
      authorized: allowed.settings,
      portalEnabled: allowed.settings ? settings?.portalEnabled !== false : null,
      portalMaintenanceMode: allowed.settings ? !!settings?.portalMaintenanceMode : null,
      globalMaintenanceMode: allowed.settings ? !!settings?.maintenanceMode : null,
      driveMaintenanceMode: allowed.settings ? !!settings?.driveMaintenanceMode : null,
      emailMaintenanceMode: allowed.settings ? !!settings?.emailMaintenanceMode : null,
      emailNotificationsEnabled: allowed.settings ? settings?.emailNotificationsEnabled !== false : null,
      smtpConfigured: allowed.settings ? !!settings?.smtpConfigured : null,
      hideHistoricalRecordsEnabled: allowed.settings ? !!settings?.hideHistoricalRecordsEnabled : null,
    },
    permissions: allowed,
  };
}

// Render metrics as a compact, model-groundable text block (numbers/booleans/log
// summaries only). `view` tailors depth: "admin" = operational subset,
// "developer" = full technical detail.
function insightsToPromptBlock(ins, view = "developer") {
  if (!ins) return "";
  const { submissions: s, dashboard: d, operatorPerformance: ops, slf, users: u, notifications: n, queue: q, activity: ac, services: sv, system: sy, runtime: rt, syncJob, latestEvent, recentErrors, recentPortalLogins, settings: st } = ins;
  const dev = view === "developer";
  const lines = [];
  lines.push(
    dev
      ? "LIVE OPERATIONAL METRICS (developer view — technical; safe aggregates + app log summaries, no private records or secrets):"
      : "LIVE OPERATIONAL METRICS (admin view — operational summary; safe aggregates, no private records):",
  );
  lines.push(`- System: uptime ${sy.uptime}, environment ${sy.nodeEnv}, VERA ${sy.veraEnabled ? "enabled" : "disabled"}, AI provider ${sy.aiProvider} (${sy.aiOperational ? "operational" : "not configured"}).`);
  lines.push(`- Services: Database ${sv.database} (${sv.databaseOk ? "healthy" : "unhealthy"}), Email ${sv.email}, AI agent ${sv.aiAgent}, Socket Service ${sv.socketClients ?? "n/a"} active connection${sv.socketClients === 1 ? "" : "s"}, API ${sv.apiUp ? "up" : "down"}.`);
  lines.push(`- SLF facilities: ${slf.total} total — ${slf.operational} operational, ${slf.nonOperational} non-operational${slf.notMonitored ? `, ${slf.notMonitored} not yet monitored` : ""}.`);
  lines.push(s.authorized ? `- Submissions: total ${s.total} — pending ${s.pending}, acknowledged ${s.acknowledged}, reverted ${s.reverted}, rejected ${s.rejected}; last 24h ${s.last24h}.` : "- Submissions: not included because this admin lacks submission/portal-data view permission.");
  lines.push(d.authorized ? `- Dashboard statistics: Waste Received total ${Math.round(d.wasteReceivedM3 * 100) / 100} m³ / ${Math.round(d.wasteReceivedTons * 100) / 100} tons; baseline reports ${d.baselineReports}; pending baseline updates ${d.activeBaselineUpdates}; LGU submissions ${d.lguSubmissions}; private submissions ${d.privateSubmissions}.` : "- Dashboard statistics: not included because this admin lacks dashboard/portal-data view permission.");
  lines.push(u.authorized ? `- Users / sessions: portal ${u.portalTotal} (approved ${u.portalApproved}, pending ${u.portalPending}${dev ? `, rejected ${u.portalRejected}` : ""}, blocked ${u.blocked}, active last 24h ${u.activeLast24h}); admin ${u.adminTotal}; active sessions ${u.activeSessions ?? "n/a"}.` : "- Portal users: not included because this admin lacks portal-user view permission.");
  lines.push(n.authorized ? `- Notifications: ${n.total} total, ${n.unread} unread (${n.adminUnread} admin), ${n.last24h} in last 24h.` : "- Notifications: not included because this admin lacks notification/dashboard view permission.");
  lines.push(`- Queue & jobs: submission queue — draft ${q.draft}, scheduled ${q.scheduled}, submitted ${q.submitted}, failed ${q.failed}, cancelled ${q.cancelled}. ${syncJob ? `Latest sync job (${syncJob.scope}): ${syncJob.status}${syncJob.percent ? ` ${syncJob.percent}%` : ""}${syncJob.error ? ` — error: ${syncJob.error}` : ""}.` : "No sync jobs recorded."}`);
  lines.push(ac.authorized ? `- Activity (24h): ${ac.logs24h} log events, ${ac.errors24h} errors, ${ac.warns24h} warnings, ${ac.successfulLogins24h} successful login log(s), ${ac.failedLogins24h} failed login log(s).` : "- Activity/logs: not included because this admin lacks log/dashboard view permission.");
  if (latestEvent) lines.push(`- Latest system event: ${latestEvent.message || latestEvent.action} (${latestEvent.level}) at ${latestEvent.at}.`);
  if (Array.isArray(ops) && ops.length) {
    lines.push("- Operator performance (top by submissions):");
    ops.forEach((op) => lines.push(`    • ${op.operator}: ${op.submissions} submission(s), ${op.acknowledged} acknowledged, ${op.pending} pending, last ${op.lastSubmissionAt || "n/a"}.`));
  }
  if (Array.isArray(recentPortalLogins)) {
    if (recentPortalLogins.length) {
      lines.push("- Latest SLF Portal login records (authorized admin data):");
      recentPortalLogins.forEach((log) => {
        const outcome = log.status === "success" ? "success" : `${log.status}${log.reason ? ` (${log.reason})` : ""}`;
        lines.push(`    • ${log.name} | ${log.email || "email not stored"} | role ${log.role} | ${log.at || "time not stored"} | ${outcome} | account ${log.accountStatus} | IP ${log.ip} | device ${log.device}`);
      });
    } else if (u.authorized && ac.authorized) {
      lines.push("- Latest SLF Portal login records: no login records were found in the current app logs.");
    }
  }
  if (st?.authorized) {
    lines.push(`- Safe settings status: portal ${st.portalEnabled ? "enabled" : "disabled"}, portal maintenance ${st.portalMaintenanceMode ? "on" : "off"}, global maintenance ${st.globalMaintenanceMode ? "on" : "off"}, Drive maintenance ${st.driveMaintenanceMode ? "on" : "off"}, email maintenance ${st.emailMaintenanceMode ? "on" : "off"}, notifications ${st.emailNotificationsEnabled ? "enabled" : "disabled"}, SMTP ${st.smtpConfigured ? "configured" : "not configured"}, historical-record hiding ${st.hideHistoricalRecordsEnabled ? "enabled" : "disabled"}.`);
  }

  if (dev) {
    lines.push(`- Runtime diagnostics: Node ${sy.nodeVersion} on ${sy.platform}, pid ${sy.pid}; memory RSS ${rt.memoryRssMB}MB, heap ${rt.memoryHeapUsedMB}/${rt.memoryHeapTotalMB}MB.`);
    if (recentErrors && recentErrors.length) {
      lines.push("- Recent error logs:");
      recentErrors.forEach((e) => lines.push(`    • [${e.at}] ${e.action}: ${e.message}`));
    } else {
      lines.push("- Recent error logs: none.");
    }
  }
  return lines.join("\n");
}

// Heuristic: does this message ask for live operational data?
const INSIGHT_INTENT_RE =
  /\b(status|health|uptime|statistic|stats|metric|metrics|how many|count|counts|database|db|mongo|service|services|socket|operational|submission|submissions|pending|approved|rejected|acknowledg|waste received|baseline|breakdown|calendar|operator|performance|approval|account|profile|roles?|permissions?|login|failed logins?|audit|portal usage|email status|configuration|settings|error|errors|log|logs|users?|session|sessions|activit|diagnostic|diagnostics|running|online|connected|notification|notifications|queue|job|jobs|memory|facilit|slf|report|analytics|api|health\s*check)\b/i;

function wantsInsights(message) {
  return INSIGHT_INTENT_RE.test(String(message || ""));
}

module.exports = { computeInsights, insightsToPromptBlock, wantsInsights };
