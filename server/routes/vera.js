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
const veraDev = require("../utils/veraDevInsights");
const portalReadiness = require("../utils/portalReadiness");
const { SUPPORT_EMAIL: PUBLIC_SUPPORT_EMAIL } = require("../utils/veraAuthKnowledge");
const veraPageData = require("../utils/veraPageData");
const { isDeveloper } = require("../utils/developerIdentity");
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

// ── VERA onboarding "Do not show again" ───────────────────────────────────────
// Persisted per user, server-side. localStorage alone was not enough: logout calls
// secureStorage.clearAll() → localStorage.clear(), which erased the opt-out, so the
// introduction came back on the very next login. Works for BOTH realms — portal
// tokens carry role "portal_user", admin tokens carry admin/developer/user.
function onboardingModelFor(role) {
  return role === "portal_user"
    ? require("../models/UserPortal")
    : require("../models/User");
}

// ── PUBLIC (unauthenticated) VERA for the auth pages ──────────────────────────
// Lets a locked-out portal user get recovery help BEFORE they can sign in, which is
// exactly when they need it and exactly when every other VERA route is unreachable.
//
// Deliberate constraints, because this is the only tokenless AI surface:
//   * Role is hard-coded "public" — a caller cannot ask for another realm's KB.
//   * NO database lookup of any kind. Nothing here can confirm whether an email is
//     registered or what an account's state is, so it cannot be used to enumerate
//     accounts.
//   * Conversation history is accepted for continuity but never persisted, and the
//     transcript is never written to UsageLog (metadata only), since an anonymous
//     visitor cannot consent to logging.
//   * The global veraLimiter already applies to /api/vera; this adds a tighter
//     per-IP ceiling of its own.
const publicChatHits = new Map(); // ip -> { count, resetAt }
const PUBLIC_CHAT_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_CHAT_MAX = Number(process.env.VERA_PUBLIC_CHAT_MAX || 20);

function publicChatThrottled(ip) {
  const now = Date.now();
  const key = String(ip || "unknown");
  const rec = publicChatHits.get(key);
  if (!rec || now > rec.resetAt) {
    publicChatHits.set(key, { count: 1, resetAt: now + PUBLIC_CHAT_WINDOW_MS });
    // Opportunistic sweep so the map cannot grow without bound.
    if (publicChatHits.size > 5000) {
      for (const [k, v] of publicChatHits) if (now > v.resetAt) publicChatHits.delete(k);
    }
    return false;
  }
  rec.count += 1;
  return rec.count > PUBLIC_CHAT_MAX;
}

router.post("/public-chat", async (req, res) => {
  if (!VERA_ENABLED()) {
    return res.status(200).json({
      ok: false,
      code: "disabled",
      message: `VERA is currently unavailable. Please email ${PUBLIC_SUPPORT_EMAIL} for help with your account.`,
    });
  }
  if (publicChatThrottled(req.ip)) {
    return res.status(429).json({
      ok: false,
      code: "rate_limited",
      message: `You've sent a lot of messages in a short time. Please wait a few minutes, or email ${PUBLIC_SUPPORT_EMAIL} for direct help.`,
    });
  }

  const message = vera.sanitizeInput(String(req.body?.message || ""));
  if (!message) {
    return res.status(400).json({ ok: false, code: "empty", message: "Please type your question." });
  }
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
  const page = String(req.body?.page || "").slice(0, 40);

  const settings = await loadSettings().catch(() => null);
  const a = settings?.automationAgent || {};
  const started = Date.now();

  try {
    const result = await vera.answer({
      message,
      history,
      page,
      agentConfig: a,
      role: "public", // hard-coded: never taken from the request
    });
    // Metadata only — an anonymous visitor's message is never stored, regardless of
    // the configured logging level.
    UsageLog.create({
      userRole: "public",
      feature: "vera_public_chat",
      model: result.usedModel ? agent.resolveModel(a) : "fallback",
      success: true,
      durationMs: Date.now() - started,
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
      dataCategories: ["account-recovery-help"],
    }).catch(() => {});
    return res.json({ ok: true, answer: result.answer, source: result.source });
  } catch (err) {
    // Degrade to the rule-based answer so a locked-out user still gets help.
    let fallback = "";
    try { fallback = vera.fallbackFor(message, "public"); } catch { /* ignore */ }
    UsageLog.create({
      userRole: "public",
      feature: "vera_public_chat",
      success: false,
      durationMs: Date.now() - started,
      dataCategories: ["account-recovery-help"],
      errorMessage: sanitizeError(err).message,
    }).catch(() => {});
    return res.json({
      ok: true,
      answer: fallback || `I couldn't reach my assistant service. For account help, email ${PUBLIC_SUPPORT_EMAIL}.`,
      source: "fallback",
      degraded: true,
    });
  }
});

// Starter content for the public widget — static, no account data.
router.get("/public-status", (_req, res) => {
  const ctx = vera.contextFor("public");
  res.json({
    enabled: VERA_ENABLED(),
    realm: "public",
    name: ASSISTANT_NAME,
    fullName: ASSISTANT_FULL_NAME,
    greeting: ctx.greeting,
    starterQuestions: ctx.starters,
    supportEmail: PUBLIC_SUPPORT_EMAIL,
  });
});

// ── GET /api/vera/portal-readiness ────────────────────────────────────────────
// A portal user's own outstanding items ("backlogs") that would stop a Data Entry
// submission. Derived server-side from their account + past submissions, so it is
// authoritative rather than whatever the browser happens to have loaded. Scoped to
// the CALLER: there is no id parameter, so one portal user can never read another's.
router.get("/portal-readiness", requireAnyAuth, async (req, res) => {
  if (req.user?.role !== "portal_user") {
    return res.status(403).json({ message: "Portal account required." });
  }
  try {
    const UserPortal = require("../models/UserPortal");
    const portalUser = await UserPortal.findById(req.user.id)
      .select("email status verificationRequired verificationSubmitted portalAccess assignedSlf assignedSlfName")
      .lean();
    if (!portalUser) return res.status(404).json({ message: "Portal account not found." });
    const readiness = await portalReadiness.getPortalReadiness(portalUser);
    res.json(readiness);
  } catch (e) {
    res.status(500).json({ message: "Could not check submission readiness.", error: e.message });
  }
});

router.get("/onboarding", requireAnyAuth, async (req, res) => {
  try {
    const Model = onboardingModelFor(req.user?.role);
    const doc = await Model.findById(req.user?.id).select("veraOnboardingDismissedAt").lean();
    res.json({
      dismissed: !!doc?.veraOnboardingDismissedAt,
      dismissedAt: doc?.veraOnboardingDismissedAt || null,
    });
  } catch {
    // Never block the portal on a preference read — showing the intro is the safe
    // default, and the client still has its localStorage mirror to fall back on.
    res.json({ dismissed: false, dismissedAt: null, unavailable: true });
  }
});

router.put("/onboarding", requireAnyAuth, async (req, res) => {
  try {
    const dismissed = req.body?.dismissed === true || req.body?.dismissed === "true";
    const Model = onboardingModelFor(req.user?.role);
    const updated = await Model.findByIdAndUpdate(
      req.user?.id,
      { veraOnboardingDismissedAt: dismissed ? new Date() : null },
      { new: true, select: "veraOnboardingDismissedAt" },
    ).lean();
    if (!updated) return res.status(404).json({ message: "User not found." });
    res.json({
      dismissed: !!updated.veraOnboardingDismissedAt,
      dismissedAt: updated.veraOnboardingDismissedAt || null,
    });
  } catch (e) {
    res.status(500).json({ message: "Could not save the preference.", error: e.message });
  }
});

// ── GET /api/vera/insights ────────────────────────────────────────────────────
// Curated operational metrics (safe aggregates, no raw records or secrets).
// Admin + Developer only. Admins get the operational view; developers (with
// Developer Mode on) get the full technical view. Powers VERA answers and can be
// polled by admin/dev tooling. Sensitive data is restricted to these roles.
router.get("/insights", requireAnyAuth, async (req, res) => {
  const isDev = isDeveloper(req.user);
  const isAdminTier = isDev || req.user?.role === "admin";
  if (!isAdminTier) {
    return res.status(403).json({ message: "Admin or developer access required" });
  }
  try {
    const settings = await loadSettings();
    const devModeOn = isDev && settings?.veraDeveloperMode !== false;
    const view = devModeOn ? "developer" : "admin";
    const insights = await veraDev.computeInsights(req);
    res.json({ view, devMode: devModeOn, insights, summary: veraDev.insightsToPromptBlock(insights, view) });
  } catch (e) {
    res.status(500).json({ message: "VERA insights failed to load" });
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

  // Operational insights: admins get the operational view; developers (with the
  // Developer Mode toggle on) get the full technical view + wider dev scope.
  // Metrics are computed only when the message asks for operational data, and only
  // safe aggregates/log summaries (never raw records/secrets) ever reach the model.
  // General/portal users never receive them.
  const isDev = isDeveloper(req.user);
  const isAdminTier = isDev || req.user?.role === "admin";
  const devModeOn = isDev && settings?.veraDeveloperMode !== false;
  let insightsBlock = "";
  if (isAdminTier && veraDev.wantsInsights(message)) {
    try {
      const ins = await veraDev.computeInsights(req, message);
      insightsBlock = veraDev.insightsToPromptBlock(ins, devModeOn ? "developer" : "admin");
    } catch { /* metrics best-effort — never block the answer */ }
  }

  // PAGE-CONTEXT-FIRST: a snapshot of the data the user currently has on screen,
  // captured by the client. Sanitized before use (untrusted input) and only spent on
  // the prompt when the question is actually about that data, so ordinary chat stays
  // cheap. An empty dataset answers with the exact prescribed line — no model call.
  let pageDataBlock = null;
  const pageCtx = veraPageData.sanitizePageContext(req.body?.pageContext);
  if (pageCtx && veraPageData.wantsPageData(message)) {
    if (veraPageData.isEmptyDataset(pageCtx)) {
      return res.json({ ok: true, answer: veraPageData.NO_RECORDS_REPLY, source: "guard" });
    }
    pageDataBlock = {
      prompt: veraPageData.pageContextToPromptBlock(pageCtx),
      summary: veraPageData.pageContextToUserSummary(pageCtx),
    };
  }

  // Portal users asking about submitting / what is still outstanding get their OWN
  // readiness attached as grounded facts, so VERA names the actual blocking items
  // and the action for each instead of reciting the generic checklist. Always the
  // caller's own account — never another user's.
  let readinessBlock = "";
  if (req.user?.role === "portal_user" && portalReadiness.wantsReadiness(message)) {
    try {
      const UserPortal = require("../models/UserPortal");
      const pu = await UserPortal.findById(req.user.id)
        .select("email status verificationRequired verificationSubmitted portalAccess assignedSlf assignedSlfName")
        .lean();
      if (pu) {
        readinessBlock = portalReadiness.readinessToPromptBlock(
          await portalReadiness.getPortalReadiness(pu),
        );
      }
    } catch { /* readiness is best-effort — never block the answer */ }
  }

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
      devMode: devModeOn,
      insights: insightsBlock,
      readiness: readinessBlock,
      pageData: pageDataBlock,
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
      // Pass the page snapshot through: a provider failure must not send a question
      // about the visible table back to a generic help article.
      fallback = vera.fallbackFor(message, req.user?.role, pageDataBlock?.summary || "");
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
