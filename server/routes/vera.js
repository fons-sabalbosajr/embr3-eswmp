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
