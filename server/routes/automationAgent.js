const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const { authMiddleware, adminOnly, developerOnly } = require("../middleware/auth");
const AppSettings = require("../models/AppSettings");
const UsageLog = require("../models/AutomationAgentUsageLog");
const agent = require("../utils/automationAgent");
const { FUNCTION_CATALOG, isAllowed, runFunction } = require("../utils/agentFunctions");
const { refreshAdmin } = require("../utils/socketEmit");
const { writeLog } = require("../utils/logger");
const { sanitizeError } = require("../utils/aiErrors");
const veraCache = require("../utils/veraSemanticCache");

// ── helpers ─────────────────────────────────────────────────────────────────
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

// Count today's query attempts (global + per user).
async function usageToday(userId) {
  const since = startOfToday();
  const [globalCount, userCount] = await Promise.all([
    UsageLog.countDocuments({ feature: "query", createdAt: { $gte: since } }),
    UsageLog.countDocuments({ feature: "query", userId, createdAt: { $gte: since } }),
  ]);
  return { globalCount, userCount };
}

// Today's activity for the status screen: every model call and VERA answer,
// grouped by the model that answered ("cache" / "fallback" for the ones that
// cost nothing). Counts and token sums only — never a question or an answer.
async function liveActivity(a) {
  const since = startOfToday();
  const rows = await UsageLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: "$model",
        calls: { $sum: 1 },
        ok: { $sum: { $cond: ["$success", 1, 0] } },
        inputTokens: { $sum: "$inputTokens" },
        outputTokens: { $sum: "$outputTokens" },
        avgMs: { $avg: "$durationMs" },
        lastAt: { $max: "$createdAt" },
        chat: { $sum: { $cond: [{ $in: ["$feature", ["vera_chat", "vera_public_chat"]] }, 1, 0] } },
      },
    },
  ]).catch(() => []);
  const byModel = Object.fromEntries(rows.map((r) => [r._id || "unknown", r]));
  const sum = (k) => rows.filter((r) => !["cache", "fallback"].includes(r._id)).reduce((s, r) => s + (r[k] || 0), 0);
  return {
    asOf: new Date().toISOString(),
    // The route with each model's state AND what it did today.
    models: agent.routerStatus(a).route.map((m) => {
      const u = byModel[m.model] || {};
      return {
        ...m,
        status: !m.hasKey ? "no-key" : m.restingUntil ? "resting" : "ready",
        today: {
          calls: u.calls || 0,
          ok: u.ok || 0,
          failed: (u.calls || 0) - (u.ok || 0),
          inputTokens: u.inputTokens || 0,
          outputTokens: u.outputTokens || 0,
          avgMs: u.avgMs != null ? Math.round(u.avgMs) : null,
          lastAt: u.lastAt || null,
        },
      };
    }),
    totals: {
      modelCalls: sum("calls"),
      modelOk: sum("ok"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      chatMessages: rows.reduce((s, r) => s + (r.chat || 0), 0),
      fromCache: byModel.cache?.calls || 0,
      fromLibrary: byModel.fallback?.calls || 0,
    },
    cache: { enabled: a.semanticCache !== false, ...veraCache.stats() },
    guardrails: a.guardrails !== false,
  };
}

// ── Settings (developer-only) ────────────────────────────────────────────────
// GET current config + masked status + function catalog + today's usage.
router.get("/developer/automation-agent/settings", authMiddleware, developerOnly, async (req, res) => {
  try {
    const settings = await loadSettings();
    const a = settings.automationAgent || {};
    const [{ globalCount }, activity] = await Promise.all([
      usageToday(null).catch(() => ({ globalCount: 0 })),
      liveActivity(a),
    ]);
    res.json({
      status: agent.safeStatus(a),
      activity,
      config: {
        enabled: !!a.enabled,
        name: a.name || "",
        description: a.description || "",
        role: a.role || "",
        systemInstruction: a.systemInstruction || "",
        allowedFunctions: a.allowedFunctions || [],
        loggingLevel: a.loggingLevel || "metadata",
        provider: a.provider?.provider || "anthropic",
        model: a.provider?.model || "",
        maxTokens: a.provider?.maxTokens ?? null,
        temperature: a.provider?.temperature ?? null,
        requestTimeoutMs: a.provider?.requestTimeoutMs ?? null,
        dailyRequestLimit: a.dailyRequestLimit ?? null,
        perUserRequestLimit: a.perUserRequestLimit ?? null,
        modelRouting: a.modelRouting !== false,
        crossProviderFallback: a.crossProviderFallback !== false,
        lightModelRouting: a.lightModelRouting !== false,
        semanticCache: a.semanticCache !== false,
        guardrails: a.guardrails !== false,
        veraOnAdminLogin: settings.veraOnAdminLogin !== false,
        veraOnPortalLogin: settings.veraOnPortalLogin !== false,
      },
      functionCatalog: FUNCTION_CATALOG,
      usageToday: globalCount,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Live status only (polled by the settings screen without resetting its form).
router.get("/developer/automation-agent/status", authMiddleware, developerOnly, async (_req, res) => {
  try {
    const settings = await loadSettings();
    const a = settings.automationAgent || {};
    res.json({ status: agent.safeStatus(a), activity: await liveActivity(a) });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Empty the semantic cache (e.g. after a help-library change).
router.post("/developer/automation-agent/cache/clear", authMiddleware, developerOnly, (req, res) => {
  veraCache.clear();
  writeLog("info", "automationAgent.cache.cleared", { message: "VERA semantic cache cleared", user: req.user?.email || req.user?.id || "" });
  res.json({ ok: true, cache: veraCache.stats() });
});

// PUT config. Encrypts a UI-supplied key; a blank key preserves the stored one.
// Non-secret settings only otherwise. Provider is forced to "anthropic".
router.put("/developer/automation-agent/settings", authMiddleware, developerOnly, async (req, res) => {
  try {
    const settings = await loadSettings();
    if (!settings.automationAgent) settings.automationAgent = {};
    const a = settings.automationAgent;
    const b = req.body || {};

    // Scalar config (validated / clamped).
    if (b.enabled != null) a.enabled = !!b.enabled;
    if (typeof b.name === "string") a.name = b.name.slice(0, 200);
    if (typeof b.description === "string") a.description = b.description.slice(0, 2000);
    if (typeof b.role === "string") a.role = b.role.slice(0, 300);
    if (typeof b.systemInstruction === "string") a.systemInstruction = b.systemInstruction.slice(0, 8000);
    if (Array.isArray(b.allowedFunctions)) {
      const valid = new Set(FUNCTION_CATALOG.map((f) => f.id));
      a.allowedFunctions = b.allowedFunctions.filter((id) => valid.has(id));
    }
    if (["none", "metadata", "full"].includes(b.loggingLevel)) a.loggingLevel = b.loggingLevel;
    if (b.dailyRequestLimit === null || b.dailyRequestLimit === "") a.dailyRequestLimit = null;
    else if (b.dailyRequestLimit != null) a.dailyRequestLimit = Math.max(0, Math.min(100000, Number(b.dailyRequestLimit) || 0));
    if (b.perUserRequestLimit === null || b.perUserRequestLimit === "") a.perUserRequestLimit = null;
    else if (b.perUserRequestLimit != null) a.perUserRequestLimit = Math.max(0, Math.min(100000, Number(b.perUserRequestLimit) || 0));

    if (typeof b.modelRouting === "boolean") a.modelRouting = b.modelRouting;
    if (typeof b.crossProviderFallback === "boolean") a.crossProviderFallback = b.crossProviderFallback;
    if (typeof b.lightModelRouting === "boolean") a.lightModelRouting = b.lightModelRouting;
    if (typeof b.semanticCache === "boolean") {
      a.semanticCache = b.semanticCache;
      if (!b.semanticCache) veraCache.clear();
    }
    if (typeof b.guardrails === "boolean") a.guardrails = b.guardrails;
    // VERA on each side's sign-in pages (top-level settings, read publicly).
    if (typeof b.veraOnAdminLogin === "boolean") settings.veraOnAdminLogin = b.veraOnAdminLogin;
    if (typeof b.veraOnPortalLogin === "boolean") settings.veraOnPortalLogin = b.veraOnPortalLogin;

    // Provider selection (anthropic | gemini | groq).
    if (!a.provider) a.provider = {};
    if (typeof b.provider === "string" && agent.PROVIDER_IDS.includes(b.provider.trim().toLowerCase())) {
      a.provider.provider = b.provider.trim().toLowerCase();
    } else if (!a.provider.provider) {
      a.provider.provider = "anthropic";
    }
    if (typeof b.model === "string") a.provider.model = b.model.trim().slice(0, 120);
    if (b.maxTokens != null) a.provider.maxTokens = Math.max(1, Math.min(8192, Number(b.maxTokens) || 1024));
    if (b.temperature != null) a.provider.temperature = Math.max(0, Math.min(1, Number(b.temperature)));
    if (b.requestTimeoutMs != null) a.provider.requestTimeoutMs = Math.max(1000, Math.min(120000, Number(b.requestTimeoutMs) || 30000));

    // API key: only touch when a real value is provided. Encrypt at rest and tag
    // it with the provider it belongs to (so it is never used for another vendor).
    if (typeof b.apiKey === "string" && b.apiKey.trim()) {
      const stored = agent.prepareKeyForStorage(b.apiKey, a.provider.provider);
      if (stored) {
        a.provider.apiKeyEnc = stored.apiKeyEnc;
        a.provider.apiKeyHint = stored.apiKeyHint;
        a.provider.apiKeyProvider = stored.apiKeyProvider;
        a.provider.apiKey = ""; // never keep plaintext
      }
    } else if (b.clearApiKey === true) {
      a.provider.apiKeyEnc = "";
      a.provider.apiKeyHint = "";
      a.provider.apiKeyProvider = "";
      a.provider.apiKey = "";
    }

    settings.markModified("automationAgent");
    await settings.save();
    refreshAdmin(req, "settings");
    writeLog("info", "automationAgent.settings.updated", {
      message: "Automation Agent configuration updated",
      user: req.user?.email || req.user?.id || "",
      meta: { enabled: a.enabled, provider: a.provider?.provider || "anthropic", model: a.provider?.model || "" },
    });
    res.json({ message: "Automation Agent settings saved", status: agent.safeStatus(a) });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// ── Test connection (developer-only) ─────────────────────────────────────────
// Minimal, low-token request that confirms auth + model access. Records the
// outcome (last success / last error) and returns a sanitized state only.
router.post("/developer/automation-agent/test", authMiddleware, developerOnly, async (req, res) => {
  const settings = await loadSettings();
  const a = settings.automationAgent || {};
  const provider = agent.resolveProvider(a);
  const { key } = agent.resolveKey(a);
  if (!key) {
    const meta = agent.PROVIDERS[provider];
    return res.status(200).json({ ok: false, code: "not_configured", message: `No API key is configured for ${meta.label}. Set ${meta.envKey} on the server or save a key here.` });
  }
  const model = agent.resolveModel(a);
  const started = Date.now();
  try {
    const resp = await agent.testConnection(a);
    const durationMs = Date.now() - started;
    a.lastSuccessfulConnectionAt = new Date();
    a.lastError = "";
    a.lastErrorAt = null;
    settings.markModified("automationAgent");
    await settings.save();
    await UsageLog.create({
      userId: req.user?.id, userEmail: req.user?.email, userRole: req.user?.role,
      feature: "test", model, success: true, durationMs,
      inputTokens: resp?.inputTokens || 0, outputTokens: resp?.outputTokens || 0,
    });
    res.json({ ok: true, code: "success", message: `Connected to ${model}.`, provider, model, durationMs, lastSuccessfulConnectionAt: a.lastSuccessfulConnectionAt });
  } catch (err) {
    const { message, code } = sanitizeError(err, key, provider);
    a.lastError = message;
    a.lastErrorAt = new Date();
    settings.markModified("automationAgent");
    await settings.save().catch(() => {});
    await UsageLog.create({
      userId: req.user?.id, userEmail: req.user?.email, userRole: req.user?.role,
      feature: "test", model, success: false, durationMs: Date.now() - started, errorMessage: message,
    }).catch(() => {});
    res.json({ ok: false, code, message });
  }
});

// ── Query (admin or developer) ───────────────────────────────────────────────
// Runs ONE allowlisted read-only function to build bounded, sanitized context,
// then asks the model to summarize/explain. Enforces daily + per-user limits,
// duplicate protection, timeout/abort, and usage logging.
router.post("/automation-agent/query", authMiddleware, adminOnly, async (req, res) => {
  const settings = await loadSettings();
  const a = settings.automationAgent || {};

  if (!agent.isOperational(a)) {
    return res.status(200).json({ ok: false, code: "disabled", message: "The Automation Agent is not enabled or has no API key configured." });
  }

  const functionId = String(req.body?.functionId || "").trim();
  const question = String(req.body?.question || "").trim().slice(0, 2000);
  const params = req.body?.params && typeof req.body.params === "object" ? req.body.params : {};

  if (!isAllowed(functionId, a.allowedFunctions)) {
    return res.status(400).json({ ok: false, code: "not_allowed", message: "That function is not permitted." });
  }

  // Rate limits (per-user + global daily).
  const dailyLimit = agent.resolveDailyLimit(a);
  const userLimit = agent.resolveUserLimit(a);
  const { globalCount, userCount } = await usageToday(req.user?.id);
  if (dailyLimit > 0 && globalCount >= dailyLimit) {
    return res.status(429).json({ ok: false, code: "global_limit", message: `Daily request limit reached (${dailyLimit}). Try again tomorrow.` });
  }
  if (userLimit > 0 && userCount >= userLimit) {
    return res.status(429).json({ ok: false, code: "user_limit", message: `Your daily request limit is reached (${userLimit}).` });
  }

  // Duplicate-request protection (same user + function + question in 15s).
  const requestHash = crypto.createHash("sha256").update(`${req.user?.id}|${functionId}|${question}|${JSON.stringify(params)}`).digest("hex");
  const dupe = await UsageLog.findOne({ requestHash, createdAt: { $gte: new Date(Date.now() - 15000) } }).lean();
  if (dupe) {
    return res.status(429).json({ ok: false, code: "duplicate", message: "Identical request just submitted — please wait a moment." });
  }

  const masking = !!settings.maskSensitiveSlfValues;
  const provider = agent.resolveProvider(a);
  const model = agent.resolveModel(a);
  const { key } = agent.resolveKey(a);
  const started = Date.now();

  // Abort budget slightly above the client timeout so the request can't hang.
  const controller = new AbortController();
  const abortMs = agent.resolveTimeoutMs(a) + 2000;
  const abortTimer = setTimeout(() => controller.abort(), abortMs);

  let ctx;
  try {
    ctx = await runFunction(functionId, { params, masking });
  } catch (e) {
    clearTimeout(abortTimer);
    return res.status(400).json({ ok: false, code: "context_error", message: "Could not build the requested context." });
  }

  const systemInstruction = a.systemInstruction || "You are a read-only operations assistant. Summarize the structured data provided. Never invent data.";
  const userContent =
    `Task: ${ctx.label}\n` +
    (question ? `Question: ${question}\n` : "") +
    (masking ? "Note: sensitive numeric values are masked as ***** — do not guess them.\n" : "") +
    `\nStructured context (JSON):\n${JSON.stringify(ctx.data).slice(0, 60000)}`;

  try {
    const resp = await agent.complete(a, {
      system: systemInstruction,
      prompt: userContent,
      signal: controller.signal,
    });
    clearTimeout(abortTimer);
    const durationMs = Date.now() - started;
    const answer = resp.text;

    const logging = a.loggingLevel || "metadata";
    await UsageLog.create({
      userId: req.user?.id, userEmail: req.user?.email, userRole: req.user?.role,
      // The model that ACTUALLY answered — the router may have fallen back.
      feature: "query", model: resp?.model || model, success: true, durationMs,
      inputTokens: resp?.inputTokens || 0, outputTokens: resp?.outputTokens || 0,
      stopReason: resp?.stopReason || "",
      dataCategories: ctx.categories, maskingApplied: masking,
      requestHash,
      promptText: logging === "full" ? userContent : "",
      responseText: logging === "full" ? answer : "",
    }).catch(() => {});

    res.json({
      ok: true,
      answer,
      function: functionId,
      provider: resp?.provider || provider,
      model: resp?.model || model,
      fellBack: !!resp?.fellBack,
      maskingApplied: masking,
      dataCategories: ctx.categories,
      usage: { inputTokens: resp?.inputTokens || 0, outputTokens: resp?.outputTokens || 0, durationMs },
    });
  } catch (err) {
    clearTimeout(abortTimer);
    const { message, code } = sanitizeError(err, key, provider);
    await UsageLog.create({
      userId: req.user?.id, userEmail: req.user?.email, userRole: req.user?.role,
      feature: "query", model, success: false, durationMs: Date.now() - started,
      dataCategories: ctx?.categories || [], maskingApplied: masking, requestHash, errorMessage: message,
    }).catch(() => {});
    res.status(200).json({ ok: false, code, message });
  }
});

module.exports = router;
