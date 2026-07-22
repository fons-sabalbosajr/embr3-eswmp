// Automation Agent — multi-provider configuration + client resolution.
//
// Supports two providers, selectable per config:
//   • "anthropic" — official Anthropic API (Claude). Paid, funded key required.
//   • "gemini"    — Google Gemini API. Has a genuine free tier.
//
// Security model:
//   • The operational API key comes FIRST from the provider's env var
//     (ANTHROPIC_API_KEY / GEMINI_API_KEY).
//   • A UI-entered key is only a fallback, stored AES-256-GCM-encrypted in the DB
//     (provider.apiKeyEnc) and tagged with provider.apiKeyProvider. A stored key
//     is ONLY used for its own provider — switching providers never sends a key
//     to the wrong vendor.
//   • The key is NEVER returned to any caller, logged in full, or sent to the
//     frontend. Only `safeStatus()` (masked) leaves this module.
//   • The frontend must never call a model vendor directly — only this server does.

const Anthropic = require("@anthropic-ai/sdk");
const { encryptSecret, decryptSecret, isEncrypted, maskHint } = require("./secretBox");

// Lazy/defensive require so the app never crashes if the Gemini SDK is absent.
let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require("@google/genai"));
} catch (_) {
  GoogleGenAI = null;
}

// Per-provider metadata: env var names + built-in default models.
const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: () => (process.env.ANTHROPIC_MODEL || "claude-opus-4-8").trim(),
    sdkAvailable: () => true,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    defaultModel: () => (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim(),
    sdkAvailable: () => !!GoogleGenAI,
  },
};

// Shared env fallbacks (config in the DB wins when present).
const ENV = {
  anthropicKey: () => (process.env.ANTHROPIC_API_KEY || "").trim(),
  geminiKey: () => (process.env.GEMINI_API_KEY || "").trim(),
  maxTokens: () => Number(process.env.ANTHROPIC_MAX_TOKENS) || 1024,
  temperature: () =>
    process.env.ANTHROPIC_TEMPERATURE != null && process.env.ANTHROPIC_TEMPERATURE !== ""
      ? Number(process.env.ANTHROPIC_TEMPERATURE)
      : 0.2,
  timeoutMs: () => Number(process.env.ANTHROPIC_TIMEOUT_MS) || 30000,
  masterEnabled: () => String(process.env.AUTOMATION_AGENT_ENABLED || "").toLowerCase() === "true",
  dailyLimit: () => Number(process.env.AUTOMATION_AGENT_DAILY_LIMIT) || 100,
  userLimit: () => Number(process.env.AUTOMATION_AGENT_USER_LIMIT) || 20,
};

// Which provider is selected (defaults to anthropic for back-compat).
function resolveProvider(agent) {
  const p = (agent?.provider?.provider || "").trim().toLowerCase();
  return p === "gemini" ? "gemini" : "anthropic";
}

// Resolve the effective API key + where it came from, for the SELECTED provider.
// Env var wins; a DB key is only used when it belongs to the same provider.
//   returns { key: string, source: "env" | "database" | "" }
function resolveKey(agent) {
  const provider = resolveProvider(agent);
  const envKey = provider === "gemini" ? ENV.geminiKey() : ENV.anthropicKey();
  if (envKey) return { key: envKey, source: "env" };

  // DB fallback — only if the stored key was saved for THIS provider.
  const storedProvider = (agent?.provider?.apiKeyProvider || "anthropic").toLowerCase();
  if (storedProvider === provider) {
    const enc = agent?.provider?.apiKeyEnc || "";
    if (enc) {
      const dec = decryptSecret(enc);
      if (dec) return { key: dec, source: "database" };
    }
    // Legacy plaintext (pre-encryption) — usable until migrated.
    const legacy = (agent?.provider?.apiKey || "").trim();
    if (legacy) return { key: legacy, source: "database" };
  }
  return { key: "", source: "" };
}

// Effective model / token / temperature / timeout (config wins over env).
function resolveModel(agent) {
  const explicit = (agent?.provider?.model || "").trim();
  if (explicit) return explicit;
  return PROVIDERS[resolveProvider(agent)].defaultModel();
}
function resolveMaxTokens(agent) {
  return Number(agent?.provider?.maxTokens) || ENV.maxTokens();
}
function resolveTemperature(agent) {
  const t = agent?.provider?.temperature;
  return t == null ? ENV.temperature() : Number(t);
}
function resolveTimeoutMs(agent) {
  return Number(agent?.provider?.requestTimeoutMs) || ENV.timeoutMs();
}
function resolveDailyLimit(agent) {
  const v = agent?.dailyRequestLimit;
  return v == null || v === "" ? ENV.dailyLimit() : Number(v);
}
function resolveUserLimit(agent) {
  const v = agent?.perUserRequestLimit;
  return v == null || v === "" ? ENV.userLimit() : Number(v);
}

// Is the agent allowed to make a real model call right now?
function isOperational(agent) {
  const provider = resolveProvider(agent);
  if (!PROVIDERS[provider].sdkAvailable()) return false;
  const enabled = ENV.masterEnabled() && !!agent?.enabled;
  const { key } = resolveKey(agent);
  return enabled && !!key;
}

// Build an Anthropic client bound to the resolved key + timeout. Returns null if
// no key resolves or the selected provider is not Anthropic.
function getClient(agent) {
  if (resolveProvider(agent) !== "anthropic") return null;
  const { key } = resolveKey(agent);
  if (!key) return null;
  return new Anthropic({ apiKey: key, timeout: resolveTimeoutMs(agent), maxRetries: 1 });
}

// ── Unified completion across providers ──────────────────────────────────────
// Returns a normalized shape regardless of vendor:
//   { text, inputTokens, outputTokens, stopReason, provider, model }
// `signal` (AbortSignal) is honored by both providers.
async function complete(agent, { system, prompt, signal } = {}) {
  const provider = resolveProvider(agent);
  const model = resolveModel(agent);
  const maxTokens = resolveMaxTokens(agent);
  const temperature = resolveTemperature(agent);
  const { key } = resolveKey(agent);
  if (!key) {
    const err = new Error("not_configured");
    err.code = "not_configured";
    throw err;
  }

  if (provider === "gemini") {
    if (!GoogleGenAI) {
      const err = new Error("Gemini SDK not installed");
      err.code = "sdk_missing";
      throw err;
    }
    const ai = new GoogleGenAI({ apiKey: key });
    const resp = await ai.models.generateContent({
      model,
      contents: String(prompt || ""),
      config: {
        systemInstruction: system || undefined,
        maxOutputTokens: maxTokens,
        temperature,
        abortSignal: signal,
      },
    });
    const usage = resp?.usageMetadata || {};
    return {
      provider,
      model,
      text: (resp?.text || "").trim(),
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
      stopReason: resp?.candidates?.[0]?.finishReason || "",
    };
  }

  // Anthropic
  const client = new Anthropic({ apiKey: key, timeout: resolveTimeoutMs(agent), maxRetries: 1 });
  const resp = await client.messages.create(
    {
      model,
      max_tokens: maxTokens,
      temperature,
      system: system || undefined,
      messages: [{ role: "user", content: String(prompt || "") }],
    },
    { signal }
  );
  return {
    provider,
    model,
    text: (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(),
    inputTokens: resp?.usage?.input_tokens || 0,
    outputTokens: resp?.usage?.output_tokens || 0,
    stopReason: resp?.stop_reason || "",
  };
}

// Minimal, low-token round-trip that confirms auth + model access for the
// selected provider. Returns { text, model, provider, inputTokens, outputTokens }.
async function testConnection(agent) {
  const provider = resolveProvider(agent);
  const model = resolveModel(agent);
  const { key } = resolveKey(agent);
  if (!key) {
    const err = new Error("not_configured");
    err.code = "not_configured";
    throw err;
  }

  if (provider === "gemini") {
    if (!GoogleGenAI) {
      const err = new Error("Gemini SDK not installed");
      err.code = "sdk_missing";
      throw err;
    }
    const ai = new GoogleGenAI({ apiKey: key });
    const resp = await ai.models.generateContent({
      model,
      contents: "Reply with the single word: OK",
      // Disable "thinking" (2.5 models) so the tiny budget returns visible text.
      config: { maxOutputTokens: 16, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    });
    const usage = resp?.usageMetadata || {};
    return { provider, model, text: (resp?.text || "").trim(), inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0 };
  }

  const client = new Anthropic({ apiKey: key, timeout: resolveTimeoutMs(agent), maxRetries: 1 });
  const resp = await client.messages.create({
    model,
    max_tokens: 16,
    messages: [{ role: "user", content: "Reply with the single word: OK" }],
  });
  return {
    provider,
    model,
    text: (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim(),
    inputTokens: resp?.usage?.input_tokens || 0,
    outputTokens: resp?.usage?.output_tokens || 0,
  };
}

// UI-safe status. NEVER includes the key — only a masked hint + booleans.
function safeStatus(agent) {
  const provider = resolveProvider(agent);
  const { key, source } = resolveKey(agent);
  const configured = !!key;
  return {
    provider,
    providerLabel: PROVIDERS[provider].label,
    sdkAvailable: PROVIDERS[provider].sdkAvailable(),
    masterEnabled: ENV.masterEnabled(),
    enabled: !!agent?.enabled,
    operational: isOperational(agent),
    keyConfigured: configured,
    keySource: source, // "env" | "database" | ""
    keyEnvVar: PROVIDERS[provider].envKey,
    // A hint is only meaningful for a DB-stored key; for an env key we cannot
    // (and must not) reflect its characters, so we show a generic marker.
    keyHint:
      source === "database"
        ? agent?.provider?.apiKeyHint || maskHint(key)
        : configured
          ? "configured via server environment"
          : "",
    model: resolveModel(agent),
    maxTokens: resolveMaxTokens(agent),
    temperature: resolveTemperature(agent),
    requestTimeoutMs: resolveTimeoutMs(agent),
    dailyRequestLimit: resolveDailyLimit(agent),
    perUserRequestLimit: resolveUserLimit(agent),
    loggingLevel: agent?.loggingLevel || "metadata",
    lastSuccessfulConnectionAt: agent?.lastSuccessfulConnectionAt || null,
    lastError: agent?.lastError || "",
    lastErrorAt: agent?.lastErrorAt || null,
  };
}

// Prepare a DB write for a UI-supplied key: encrypt it, compute the hint, and
// tag it with the provider it belongs to. Returns the fields to $set on provider
// (apiKeyEnc/apiKeyHint/apiKeyProvider) and clears the legacy plaintext field.
// Blank input → no change instruction (caller keeps the existing key).
function prepareKeyForStorage(plaintext, provider) {
  const text = String(plaintext || "").trim();
  if (!text) return null; // preserve existing
  const prov = (provider || "anthropic").toLowerCase() === "gemini" ? "gemini" : "anthropic";
  return { apiKeyEnc: encryptSecret(text), apiKeyHint: maskHint(text), apiKeyProvider: prov, apiKey: "" };
}

// One-time migration helper: if a legacy plaintext key exists and no encrypted
// copy does, return the fields to re-store it encrypted (caller persists).
function migrateLegacyKeyIfNeeded(agent) {
  const legacy = (agent?.provider?.apiKey || "").trim();
  const enc = agent?.provider?.apiKeyEnc || "";
  if (legacy && !enc && !isEncrypted(legacy)) {
    const prov = (agent?.provider?.provider || "anthropic").toLowerCase() === "gemini" ? "gemini" : "anthropic";
    return { apiKeyEnc: encryptSecret(legacy), apiKeyHint: maskHint(legacy), apiKeyProvider: prov, apiKey: "" };
  }
  return null;
}

module.exports = {
  PROVIDERS,
  ENV,
  resolveProvider,
  resolveKey,
  resolveModel,
  resolveMaxTokens,
  resolveTemperature,
  resolveTimeoutMs,
  resolveDailyLimit,
  resolveUserLimit,
  isOperational,
  getClient,
  complete,
  testConnection,
  safeStatus,
  prepareKeyForStorage,
  migrateLegacyKeyIfNeeded,
};
