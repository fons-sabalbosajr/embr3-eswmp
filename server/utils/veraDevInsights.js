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

// Compute the full curated metrics object. Every sub-section is guarded so a
// single failing query never breaks the whole response.
async function computeInsights(req) {
  const now = new Date();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const settings = await AppSettings.findOne().lean().catch(() => null);
  const a = settings?.automationAgent || {};

  // ── Submission statistics (counts by normalized status) ──
  const submissions = { total: 0, pending: 0, acknowledged: 0, reverted: 0, rejected: 0, last24h: 0 };
  try {
    const rows = await DataSLF.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    for (const r of rows) {
      submissions.total += r.count;
      const n = normalizeStatus(r._id);
      submissions[n] = (submissions[n] || 0) + r.count;
    }
    submissions.last24h = await DataSLF.countDocuments({ createdAt: { $gte: dayAgo } });
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
  const users = { portalTotal: 0, portalPending: 0, portalApproved: 0, portalRejected: 0, adminTotal: 0 };
  try {
    users.portalTotal = await UserPortal.countDocuments({});
    users.portalPending = await UserPortal.countDocuments({ status: "pending" });
    users.portalApproved = await UserPortal.countDocuments({ status: "approved" });
    users.portalRejected = await UserPortal.countDocuments({ status: "rejected" });
    users.adminTotal = await User.countDocuments({});
  } catch { /* leave zeros */ }

  // ── Notifications ──
  const notifications = { total: 0, unread: 0, adminUnread: 0, last24h: 0 };
  try {
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
  const activity = { logs24h: 0, errors24h: 0, warns24h: 0 };
  try {
    activity.logs24h = await AppLog.countDocuments({ createdAt: { $gte: dayAgo } });
    activity.errors24h = await AppLog.countDocuments({ level: "error", createdAt: { $gte: dayAgo } });
    activity.warns24h = await AppLog.countDocuments({ level: "warn", createdAt: { $gte: dayAgo } });
  } catch { /* leave zeros */ }

  let latestEvent = null;
  try {
    const ev = await AppLog.findOne().sort({ createdAt: -1 }).select("action message level createdAt").lean();
    if (ev) latestEvent = { action: ev.action, message: trim(ev.message, 140), level: ev.level, at: fmtTime(ev.createdAt) };
  } catch { /* leave null */ }

  let recentErrors = [];
  try {
    const errs = await AppLog.find({ level: "error" }).sort({ createdAt: -1 }).limit(5).select("action message createdAt").lean();
    recentErrors = errs.map((e) => ({ action: e.action, message: trim(e.message, 120), at: fmtTime(e.createdAt) }));
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
    slf,
    users: { ...users, activeSessions: socketClients },
    notifications,
    queue,
    syncJob,
    activity,
    latestEvent,
    recentErrors,
    services: {
      database: READY_STATES[dbState] || "unknown",
      databaseOk: dbState === 1,
      email: emailOk === null ? "unknown" : emailOk ? "ok" : "error",
      aiAgent: aiOperational ? "ok" : "not-configured",
      socketClients,
      apiUp: true, // this handler responded, so the API layer is up
    },
  };
}

// Render metrics as a compact, model-groundable text block (numbers/booleans/log
// summaries only). `view` tailors depth: "admin" = operational subset,
// "developer" = full technical detail.
function insightsToPromptBlock(ins, view = "developer") {
  if (!ins) return "";
  const { submissions: s, slf, users: u, notifications: n, queue: q, activity: ac, services: sv, system: sy, runtime: rt, syncJob, latestEvent, recentErrors } = ins;
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
  lines.push(`- Submissions: total ${s.total} — pending ${s.pending}, acknowledged ${s.acknowledged}, reverted ${s.reverted}, rejected ${s.rejected}; last 24h ${s.last24h}.`);
  lines.push(`- Users / sessions: portal ${u.portalTotal} (approved ${u.portalApproved}, pending ${u.portalPending}${dev ? `, rejected ${u.portalRejected}` : ""}); admin ${u.adminTotal}; active sessions ${u.activeSessions ?? "n/a"}.`);
  lines.push(`- Notifications: ${n.total} total, ${n.unread} unread (${n.adminUnread} admin), ${n.last24h} in last 24h.`);
  lines.push(`- Queue & jobs: submission queue — draft ${q.draft}, scheduled ${q.scheduled}, submitted ${q.submitted}, failed ${q.failed}, cancelled ${q.cancelled}. ${syncJob ? `Latest sync job (${syncJob.scope}): ${syncJob.status}${syncJob.percent ? ` ${syncJob.percent}%` : ""}${syncJob.error ? ` — error: ${syncJob.error}` : ""}.` : "No sync jobs recorded."}`);
  lines.push(`- Activity (24h): ${ac.logs24h} log events, ${ac.errors24h} errors, ${ac.warns24h} warnings.`);
  if (latestEvent) lines.push(`- Latest system event: ${latestEvent.message || latestEvent.action} (${latestEvent.level}) at ${latestEvent.at}.`);

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
  /\b(status|health|uptime|statistic|stats|metric|metrics|how many|count|counts|database|db|mongo|service|services|socket|operational|submission|submissions|pending|acknowledg|error|errors|log|logs|users?|session|sessions|activit|diagnostic|diagnostics|running|online|connected|notification|notifications|queue|job|jobs|memory|facilit|slf|report|analytics|api|health\s*check)\b/i;

function wantsInsights(message) {
  return INSIGHT_INTENT_RE.test(String(message || ""));
}

module.exports = { computeInsights, insightsToPromptBlock, wantsInsights };
