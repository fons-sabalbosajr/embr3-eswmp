// Gemini provider (Google Generative AI) — SAMPLE / INACTIVE.
//
// This module is a self-contained, opt-in helper for a POSSIBLE future free-tier
// provider (Google Gemini). It is NOT wired into the live Automation Agent flow:
// nothing in routes/ or the running server imports it. The active provider
// remains Anthropic (see utils/automationAgent.js). This exists so the app can
// be switched to (or offer) Gemini later without re-researching the SDK.
//
// Security model (mirrors the Anthropic helper):
//   • The API key comes ONLY from process.env.GEMINI_API_KEY. It is never
//     returned to any caller, logged in full, or sent to the frontend.
//   • Gemini has a genuine free tier (e.g. gemini-2.0-flash / gemini-1.5-flash)
//     with per-day/per-minute limits — no billing required to start.
//   • The frontend must never call Google directly — only this server would.
//
// Usage (see scripts/testGemini.js for a runnable sample):
//   const g = require("./utils/geminiProvider");
//   if (g.isConfigured()) {
//     const out = await g.generate({ system, prompt });
//   }

let GoogleGenAI = null;
try {
  // Lazy/defensive require so the app never crashes if the SDK is absent.
  ({ GoogleGenAI } = require("@google/genai"));
} catch (_) {
  GoogleGenAI = null;
}

// Env-only configuration. Kept parallel to the Anthropic ENV block so a future
// multi-provider switch reads consistently.
const ENV = {
  key: () => (process.env.GEMINI_API_KEY || "").trim(),
  model: () => (process.env.GEMINI_MODEL || "gemini-2.0-flash").trim(),
  maxTokens: () => Number(process.env.GEMINI_MAX_TOKENS) || 1024,
  temperature: () =>
    process.env.GEMINI_TEMPERATURE != null && process.env.GEMINI_TEMPERATURE !== ""
      ? Number(process.env.GEMINI_TEMPERATURE)
      : 0.2,
  timeoutMs: () => Number(process.env.GEMINI_TIMEOUT_MS) || 30000,
};

// Is a key present AND the SDK installed?
function isConfigured() {
  return !!ENV.key() && !!GoogleGenAI;
}

// Non-secret status for logging/UI — NEVER includes the key.
function safeStatus() {
  return {
    provider: "gemini",
    sdkInstalled: !!GoogleGenAI,
    keyConfigured: !!ENV.key(),
    model: ENV.model(),
    maxTokens: ENV.maxTokens(),
    temperature: ENV.temperature(),
    timeoutMs: ENV.timeoutMs(),
  };
}

// Build a client bound to the env key. Returns null if unconfigured.
function getClient() {
  const key = ENV.key();
  if (!key || !GoogleGenAI) return null;
  return new GoogleGenAI({ apiKey: key });
}

// Minimal, low-token round-trip to confirm the key + model work.
// Returns { ok, model, text, durationMs } or { ok:false, code, message }.
async function testConnection() {
  const client = getClient();
  if (!client) {
    return { ok: false, code: "not_configured", message: "No GEMINI_API_KEY set or SDK missing." };
  }
  const model = ENV.model();
  const started = Date.now();
  try {
    const resp = await client.models.generateContent({
      model,
      contents: "Reply with the single word: OK",
      // Disable "thinking" (2.5 models) so the tiny token budget returns visible
      // text instead of being consumed by internal reasoning.
      config: { maxOutputTokens: 16, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    });
    return { ok: true, model, text: (resp?.text || "").trim(), durationMs: Date.now() - started };
  } catch (err) {
    return { ok: false, ...sanitizeError(err), durationMs: Date.now() - started };
  }
}

// Read-only summarization call, matching the Automation Agent's contract:
// a system instruction plus a single user prompt, returning plain text.
// Returns { ok, model, text, durationMs } or { ok:false, code, message }.
async function generate({ system, prompt }) {
  const client = getClient();
  if (!client) {
    return { ok: false, code: "not_configured", message: "No GEMINI_API_KEY set or SDK missing." };
  }
  const model = ENV.model();
  const started = Date.now();
  try {
    const resp = await client.models.generateContent({
      model,
      contents: String(prompt || ""),
      config: {
        systemInstruction: system || undefined,
        maxOutputTokens: ENV.maxTokens(),
        temperature: ENV.temperature(),
      },
    });
    return { ok: true, model, text: (resp?.text || "").trim(), durationMs: Date.now() - started };
  } catch (err) {
    return { ok: false, ...sanitizeError(err), durationMs: Date.now() - started };
  }
}

// Map SDK/HTTP errors to a safe, provider-agnostic shape. Never leaks the key.
function sanitizeError(err) {
  const status = err?.status || err?.code || err?.response?.status;
  const raw = String(err?.message || "");
  let message = "The Gemini request failed. Please try again.";
  let code = "unknown";
  if (status === 401 || status === 403 || /API key|permission|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
    message = "Authentication failed — the Gemini API key was rejected or lacks access.";
    code = "auth_failed";
  } else if (status === 404 || /not found|NOT_FOUND/i.test(raw)) {
    message = "The configured Gemini model is not available for this API key.";
    code = "model_unavailable";
  } else if (status === 429 || /quota|rate limit|RESOURCE_EXHAUSTED/i.test(raw)) {
    message = "Gemini rate limit / free-tier quota reached. Please wait and try again.";
    code = "rate_limited";
  } else if (/timeout|timed out|ETIMEDOUT|ECONNRESET|abort/i.test(raw)) {
    message = "The request to Gemini timed out. Please try again.";
    code = "timeout";
  }
  const key = ENV.key();
  if (key) message = message.split(key).join("****");
  return { code, message };
}

module.exports = {
  ENV,
  isConfigured,
  safeStatus,
  getClient,
  testConnection,
  generate,
};
