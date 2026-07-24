// VERA — Virtual Environmental Response Assistant (SLF Portal chatbot) API.
//
// Portal-user + admin facing (requireAnyAuth). VERA answers portal/workflow
// questions grounded in a public knowledge base (utils/veraKnowledge.js), reusing
// the existing Automation Agent provider layer to phrase answers when a model is
// configured — and falling back to rule-based knowledge-base answers when it is
// not, so VERA is always useful.
//
// Security posture:
//   • Authenticated only; no anonymous access.
//   • Input is sanitized + length-capped; output is control-char-stripped and
//     rendered as plain text on the client (no HTML injection).
//   • NO secrets, env values, internal prompts, DB internals, or private records
//     are ever returned to the client or sent to the model. Only the (public) KB
//     and, optionally, the current page NAME reach the model.
//   • Per-user daily limit + duplicate-request guard (reuse UsageLog) on top of
//     the IP burst limiter mounted in server.js. AbortController timeout. Errors
//     are sanitized via the shared aiErrors helper.

const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { requireAnyAuth } = require("../middleware/auth");
const AppSettings = require("../models/AppSettings");
const UsageLog = require("../models/AutomationAgentUsageLog");
const AppLog = require("../models/AppLog");
const VeraBacklogInvestigation = require("../models/VeraBacklogInvestigation");
const agent = require("../utils/automationAgent");
const vera = require("../utils/veraAssistant");
const { sanitizeError } = require("../utils/aiErrors");
const { ASSISTANT_NAME, ASSISTANT_FULL_NAME } = require("../utils/veraKnowledge");

const VERA_ENABLED = () => String(process.env.VERA_ENABLED ?? "true").toLowerCase() !== "false";
const VERA_USER_DAILY_LIMIT = () => Number(process.env.VERA_USER_DAILY_LIMIT) || 200;

async function loadSettings() {
  let s = await AppSettings.findOne();
  if (!s) s = await AppSettings.create({});
  return s;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function requireAdminOrDeveloper(req, res) {
  const role = req.user?.role;
  if (role !== "admin" && role !== "developer") {
    res.status(403).json({ message: "Admin access required" });
    return false;
  }
  return true;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyVeraEventType(text) {
  const value = String(text || "").toLowerCase();
  if (/client|hauler/.test(value)) return "Missing client information";
  if (/volume|total volume|waste received/.test(value)) return "Missing waste volume";
  if (/unit|tons|m³|m3/.test(value)) return "Unit mismatch";
  if (/validation|required|incomplete/.test(value)) return "Validation issue";
  if (/save|persist|server error|failed/.test(value)) return "Failed save";
  if (/stale|sync|refresh|cache/.test(value)) return "Data synchronization issue";
  if (/block|revert|overdue/.test(value)) return "Submission blocker";
  return "VERA guidance displayed";
}

function backlogToLog(item) {
  return {
    id: `backlog:${item._id}`,
    sourceType: "backlog",
    recordId: String(item._id),
    timestamp: item.lastSeenAt || item.updatedAt || item.createdAt,
    source: "Portal",
    user: item.portalUserEmail || "",
    facility: item.slfName || "",
    module: "SLF Portal Submissions",
    eventType: classifyVeraEventType(`${item.kind} ${item.detectedIssue} ${item.missingRecords}`),
    issueDetected: item.detectedIssue || item.missingRecords || "Portal reporting backlog detected",
    veraMessage: item.detectedIssue || "VERA detected an unresolved portal reporting issue.",
    recommendedWorkaround: item.recommendation || "Review the affected portal submission and correct the missing data.",
    resolutionStatus: ["resolved", "submitted"].includes(item.status) ? "resolved" : item.status || "backlog_detected",
    resolvedDate: item.resolvedAt || null,
    relatedRecordReference: item.signature || item.reportingPeriod || "",
    technicalDetails: {
      kind: item.kind,
      pendingRecords: item.pendingRecords,
      missingRecords: item.missingRecords,
      confidence: item.confidence,
      evidenceReviewed: item.evidenceReviewed,
      escalationStatus: item.escalationStatus,
      adminNotes: item.adminNotes,
    },
  };
}

function appLogToVeraLog(log) {
  return {
    id: `applog:${log._id}`,
    sourceType: "app-log",
    recordId: String(log._id),
    timestamp: log.createdAt,
    source: String(log.action || "").startsWith("portal") ? "Portal" : "Admin",
    user: log.user || "",
    facility: log.meta?.slfName || log.meta?.facilityName || log.meta?.facilityId || "",
    module: log.meta?.module || log.action || "Application",
    eventType: classifyVeraEventType(`${log.action} ${log.message}`),
    issueDetected: log.message || log.action,
    veraMessage: log.message || "Application event recorded for VERA review.",
    recommendedWorkaround: log.level === "error" ? "Review the failed operation and retry after correcting the reported data." : "Review the affected record for consistency.",
    resolutionStatus: log.level === "error" ? "open" : "informational",
    resolvedDate: null,
    relatedRecordReference: log.meta?.recordId || log.meta?.id || log.meta?.submissionId || "",
    technicalDetails: { action: log.action, level: log.level, meta: log.meta || {} },
  };
}

// ── GET /api/vera/status ──────────────────────────────────────────────────────
// Safe booleans + starter content only. NEVER leaks the key or config secrets.
router.get("/status", requireAnyAuth, async (req, res) => {
  const ctx = vera.contextFor(req.user?.role);
  try {
    const settings = await loadSettings();
    const a = settings.automationAgent || {};
    const operational = VERA_ENABLED() && agent.isOperational(a);
    res.json({
      enabled: VERA_ENABLED(),
      // "model" when a provider is live, "fallback" when VERA answers from the KB.
      mode: operational ? "model" : "fallback",
      realm: ctx.realm, // "portal" | "admin"
      name: ASSISTANT_NAME,
      fullName: ASSISTANT_FULL_NAME,
      greeting: ctx.greeting,
      starterQuestions: ctx.starters,
    });
  } catch (e) {
    // Never fail the widget on a status hiccup — default to fallback mode.
    res.json({
      enabled: true,
      mode: "fallback",
      realm: ctx.realm,
      name: ASSISTANT_NAME,
      fullName: ASSISTANT_FULL_NAME,
      greeting: ctx.greeting,
      starterQuestions: ctx.starters,
    });
  }
});

// ── GET /api/vera/notifications ───────────────────────────────────────────────
// Admin/developer-only VERA notification feed — deterministic, sanitized findings
// (LGU reconciliation, data-quality, provider health) for the dedicated VERA bell.
// Role is taken from the authenticated token, never the client. Never blocks the
// UI: any error returns an empty feed.
router.get("/notifications", requireAnyAuth, async (req, res) => {
  const role = req.user?.role;
  if (role !== "admin" && role !== "developer") {
    return res.json({ items: [], unread: 0 }); // portal users get no admin feed
  }
  try {
    const { getAdminFindings } = require("../utils/veraFindings");
    const items = await getAdminFindings();
    res.json({ items, unread: items.length });
  } catch (e) {
    res.json({ items: [], unread: 0 });
  }
});

// ── Portal-user reporting backlogs (admin/developer) ──────────────────────────
// List stored backlog investigations; POST /scan re-detects on demand. Role from
// the verified token, never the client. Non-blocking on error.
router.get("/backlogs", requireAnyAuth, async (req, res) => {
  const role = req.user?.role;
  if (role !== "admin" && role !== "developer") return res.json({ items: [] });
  try {
    const { getOpenBacklogs } = require("../utils/veraBacklog");
    const items = await getOpenBacklogs(Math.min(Number(req.query.limit) || 50, 200));
    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

router.get("/logs", requireAnyAuth, async (req, res) => {
  if (!requireAdminOrDeveloper(req, res)) return;
  try {
    const {
      search = "",
      source = "all",
      status = "all",
      eventType = "all",
      module = "all",
      facility = "",
      from,
      to,
      limit = 200,
    } = req.query || {};

    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);

    const backlogFilter = {};
    if (Object.keys(dateFilter).length) backlogFilter.lastSeenAt = dateFilter;
    if (facility) backlogFilter.slfName = new RegExp(escapeRegex(facility), "i");
    if (status !== "all") {
      backlogFilter.status = status === "resolved" ? { $in: ["resolved", "submitted"] } : { $nin: ["resolved", "submitted"] };
    }
    const appLogFilter = {
      $or: [
        { action: /vera|slf|portal|submission|baseline|unit|client/i },
        { message: /vera|slf|portal|submission|baseline|unit|client/i },
      ],
    };
    if (Object.keys(dateFilter).length) appLogFilter.createdAt = dateFilter;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      backlogFilter.$or = [{ detectedIssue: rx }, { recommendation: rx }, { portalUserEmail: rx }, { slfName: rx }];
      appLogFilter.$and = [
        { $or: appLogFilter.$or },
        { $or: [{ action: rx }, { message: rx }, { user: rx }, { "meta.slfName": rx }, { "meta.facilityName": rx }] },
      ];
      delete appLogFilter.$or;
    }

    const max = Math.min(Number(limit) || 200, 500);
    const [backlogs, appLogs] = await Promise.all([
      source === "Admin" ? [] : VeraBacklogInvestigation.find(backlogFilter).sort({ lastSeenAt: -1 }).limit(max).lean(),
      source === "Portal" ? [] : AppLog.find(appLogFilter).sort({ createdAt: -1 }).limit(max).lean(),
    ]);

    let items = [...backlogs.map(backlogToLog), ...appLogs.map(appLogToVeraLog)];
    if (source !== "all") items = items.filter((item) => item.source === source);
    if (status !== "all") {
      items = items.filter((item) => status === "resolved" ? item.resolutionStatus === "resolved" : item.resolutionStatus !== "resolved");
    }
    if (eventType !== "all") items = items.filter((item) => item.eventType === eventType);
    if (module !== "all") items = items.filter((item) => item.module === module);
    if (facility) items = items.filter((item) => String(item.facility || "").toLowerCase().includes(String(facility).toLowerCase()));
    items.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    const summary = items.reduce((acc, item) => {
      const resolved = item.resolutionStatus === "resolved";
      if (resolved) acc.resolvedIssues += 1;
      else acc.activeIssues += 1;
      if (item.source === "Portal") acc.portalIssues += 1;
      if (item.source === "Admin") acc.adminIssues += 1;
      if (/failed|error/i.test(`${item.eventType} ${item.issueDetected}`)) acc.failedOperations += 1;
      return acc;
    }, { activeIssues: 0, resolvedIssues: 0, portalIssues: 0, adminIssues: 0, failedOperations: 0 });

    res.json({ items, summary, total: items.length });
  } catch (e) {
    res.status(500).json({ message: "VERA logs failed to load" });
  }
});

router.patch("/backlogs/:id/resolve", requireAnyAuth, async (req, res) => {
  if (!requireAdminOrDeveloper(req, res)) return;
  try {
    const notes = String(req.body?.adminNotes || "").slice(0, 2000);
    const status = req.body?.status === "open" ? "investigating" : "resolved";
    const update = {
      status,
      adminNotes: notes,
      resolvedBy: req.user?.email || req.user?.username || req.user?.id || "admin",
      resolvedAt: status === "resolved" ? new Date() : null,
    };
    const item = await VeraBacklogInvestigation.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!item) return res.status(404).json({ message: "VERA backlog log not found" });
    res.json({ item: backlogToLog(item) });
  } catch (e) {
    res.status(500).json({ message: "Could not update VERA log" });
  }
});

router.post("/backlogs/scan", requireAnyAuth, async (req, res) => {
  const role = req.user?.role;
  if (role !== "admin" && role !== "developer") {
    return res.status(403).json({ message: "Admin access required" });
  }
  try {
    const { detectBacklogs, getOpenBacklogs } = require("../utils/veraBacklog");
    const result = await detectBacklogs();
    const items = await getOpenBacklogs(200);
    res.json({ ...result, items });
  } catch (e) {
    res.status(500).json({ message: "Backlog scan failed" });
  }
});

// ── POST /api/vera/chat ───────────────────────────────────────────────────────
// Body: { message, history?: [{role,content}], page? }
router.post("/chat", requireAnyAuth, async (req, res) => {
  if (!VERA_ENABLED()) {
    return res.status(200).json({ ok: false, code: "disabled", message: "VERA is currently unavailable. Please open a support ticket." });
  }

  const rawMessage = String(req.body?.message || "");
  const message = vera.sanitizeInput(rawMessage);
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const page = String(req.body?.page || "").slice(0, 60);

  if (!message) {
    return res.status(400).json({ ok: false, code: "empty", message: "Please type a question for VERA." });
  }

  const userId = req.user?.id || null;

  // Per-user daily limit (best-effort; never blocks fallback on a count error).
  try {
    const limit = VERA_USER_DAILY_LIMIT();
    if (limit > 0 && userId) {
      const count = await UsageLog.countDocuments({ feature: "vera_chat", userId, createdAt: { $gte: startOfToday() } });
      if (count >= limit) {
        return res.status(429).json({ ok: false, code: "user_limit", message: `You've reached today's chat limit (${limit}). Please try again tomorrow or open a support ticket.` });
      }
    }
  } catch { /* ignore count errors */ }

  // Duplicate-request guard (same user + message within 8s).
  const requestHash = crypto.createHash("sha256").update(`${userId}|vera|${message}`).digest("hex");
  try {
    const dupe = await UsageLog.findOne({ requestHash, createdAt: { $gte: new Date(Date.now() - 8000) } }).lean();
    if (dupe) {
      return res.status(429).json({ ok: false, code: "duplicate", message: "That question was just sent — one moment." });
    }
  } catch { /* ignore */ }

  const settings = await loadSettings().catch(() => null);
  const a = settings?.automationAgent || {};
  const provider = agent.resolveProvider(a);
  const model = agent.resolveModel(a);
  const { key } = agent.resolveKey(a);
  const started = Date.now();

  // Abort budget slightly above the provider timeout so a request can't hang.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), agent.resolveTimeoutMs(a) + 2000);

  try {
    const result = await vera.answer({
      message,
      history,
      page,
      agentConfig: a,
      signal: controller.signal,
      role: req.user?.role, // portal_user | admin | developer — selects KB + RBAC
    });
    clearTimeout(abortTimer);
    const durationMs = Date.now() - started;

    // Minimal, metadata-only usage log (full transcript only when configured).
    const logging = a.loggingLevel || "metadata";
    UsageLog.create({
      userId,
      userEmail: req.user?.email || "",
      userRole: req.user?.role || "",
      feature: "vera_chat",
      model: result.usedModel ? model : "fallback",
      success: true,
      durationMs,
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
      dataCategories: ["portal-help"],
      requestHash,
      promptText: logging === "full" ? message : "",
      responseText: logging === "full" ? result.answer : "",
    }).catch(() => {});

    return res.json({
      ok: true,
      answer: result.answer,
      source: result.source, // "model" | "fallback" | "guard"
      page: page || undefined,
    });
  } catch (err) {
    clearTimeout(abortTimer);
    // A provider call failed — degrade gracefully to a rule-based KB answer so the
    // user still gets help, and log the sanitized error for visibility.
    const { message: safeMsg, code } = sanitizeError(err, key, provider);
    let fallback = "";
    try {
      fallback = vera.fallbackFor(message, req.user?.role);
    } catch { /* ignore */ }

    UsageLog.create({
      userId,
      userEmail: req.user?.email || "",
      userRole: req.user?.role || "",
      feature: "vera_chat",
      model,
      success: false,
      durationMs: Date.now() - started,
      dataCategories: ["portal-help"],
      requestHash,
      errorMessage: safeMsg,
    }).catch(() => {});

    if (fallback) {
      return res.json({ ok: true, answer: fallback, source: "fallback", degraded: true });
    }
    return res.status(200).json({ ok: false, code, message: safeMsg });
  }
});

module.exports = router;
