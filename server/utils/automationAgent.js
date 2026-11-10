// Automation Agent — multi-provider configuration, client resolution and the
// MODEL ROUTER every AI call in this app goes through (VERA chat, automatic
// submission remarks, ticket triage, the read-only agent query).
//
// Providers, selectable per config:
//   • "anthropic" — official Anthropic API (Claude). Paid, funded key required.
//   • "gemini"    — Google Gemini API. Has a genuine free tier.
//   • "groq"      — Groq (OpenAI's open-weight GPT-OSS models). Free tier, fast.
//                   Called over its OpenAI-compatible REST API — no SDK needed.
//
// Model router (approach from VERA in embr3-ucds):
//   A call tries the SELECTED model first, then a fallback model of the same
//   provider, then — when cross-provider fallback is on — the other providers
//   whose keys are set (free before paid). A model that fails with a quota, rate
//   limit, overload, timeout, rejected key or unknown model is RESTED for a while
//   (process-local; a restart forgets and relearns in one call), so users stop
//   paying its wait on every message. Overloads and timeouts rest longer each
//   time they repeat (10 → 20 → 40 → 60 min). On production the selected model
//   (gemini-2.5-flash, free tier) failed 73 of 201 automatic reviews with
//   429/503 while nothing else was ever tried.
//
// Security model:
//   • The operational API key comes FIRST from the provider's env var
//     (ANTHROPIC_API_KEY / GEMINI_API_KEY / GROQ_API_KEY).
//   • A UI-entered key is only a fallback, stored AES-256-GCM-encrypted in the DB
//     (provider.apiKeyEnc) and tagged with provider.apiKeyProvider. A stored key
//     is ONLY used for its own provider — routing never sends a key to the wrong
//     vendor.
//   • The key is NEVER returned to any caller, logged in full, or sent to the
//     frontend. Only `safeStatus()` (booleans, env var NAMES, a masked hint)
//     leaves this module.
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

const env = (...names) => {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return "";
};

// Per-provider metadata: env var names + built-in default models.
const PROVIDERS = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: () => env("ANTHROPIC_MODEL") || "claude-haiku-4-5",
    // The model a call falls back to within Anthropic: fast and inexpensive.
    lightModel: () => env("ANTHROPIC_LIGHT_MODEL") || "claude-haiku-4-5",
    sdkAvailable: () => true,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    defaultModel: () => env("GEMINI_MODEL") || "gemini-2.5-flash",
    lightModel: () => env("GEMINI_FALLBACK_MODEL", "GEMINI_LIGHT_MODEL") || "gemini-2.5-flash-lite",
    sdkAvailable: () => !!GoogleGenAI,
  },
  groq: {
    id: "groq",
    label: "Groq (GPT-OSS)",
    envKey: "GROQ_API_KEY",
    defaultModel: () => env("GROQ_MODEL") || "openai/gpt-oss-120b",
    lightModel: () => env("GROQ_LIGHT_MODEL") || "openai/gpt-oss-20b",
    sdkAvailable: () => typeof fetch === "function",
  },
};
const PROVIDER_IDS = Object.keys(PROVIDERS);
// Order the OTHER providers are tried in when the selected one cannot answer:
// free tiers before paid.
const FALLBACK_ORDER = ["groq", "gemini", "anthropic"];

const num = (v, fallback) => (v === "" || v == null || !Number.isFinite(Number(v)) ? fallback : Number(v));

// Shared env fallbacks (config in the DB wins when present).
const ENV = {
  anthropicKey: () => env("ANTHROPIC_API_KEY"),
  geminiKey: () => env("GEMINI_API_KEY"),
  groqKey: () => env("GROQ_API_KEY"),
  keyFor: (provider) => env(PROVIDERS[provider]?.envKey || ""),
  maxTokens: (provider = "anthropic") =>
    num(env(`${String(provider).toUpperCase()}_MAX_TOKENS`, "ANTHROPIC_MAX_TOKENS"), 1024),
  temperature: (provider = "anthropic") =>
    num(env(`${String(provider).toUpperCase()}_TEMPERATURE`, "ANTHROPIC_TEMPERATURE"), 0.2),
  timeoutMs: (provider = "anthropic") =>
    num(env(`${String(provider).toUpperCase()}_TIMEOUT_MS`, "ANTHROPIC_TIMEOUT_MS"), 30000),
  masterEnabled: () => env("AUTOMATION_AGENT_ENABLED").toLowerCase() === "true",
  dailyLimit: () => Number(process.env.AUTOMATION_AGENT_DAILY_LIMIT) || 100,
  userLimit: () => Number(process.env.AUTOMATION_AGENT_USER_LIMIT) || 20,
};

// Which provider is selected (defaults to anthropic for back-compat).
function resolveProvider(agent) {
  const p = (agent?.provider?.provider || "").trim().toLowerCase();
  return PROVIDERS[p] ? p : "anthropic";
}

// A key's vendor, read from its shape: each provider issues a distinct prefix.
function providerOfKeyShape(key) {
  const k = String(key || "").trim();
  if (/^sk-ant-/.test(k)) return "anthropic";
  if (/^AIza/.test(k)) return "gemini";
  if (/^gsk_/.test(k)) return "groq";
  return "";
}

function storedKeyPlain(agent) {
  const enc = agent?.provider?.apiKeyEnc || "";
  if (enc) {
    const dec = decryptSecret(enc);
    if (dec) return dec;
  }
  // Legacy plaintext (pre-encryption) — usable until migrated.
  return (agent?.provider?.apiKey || "").trim();
}

// Which provider the stored key belongs to. Keys saved before the tag existed
// carry `apiKeyProvider: ""`, which used to be read as "anthropic" — so on
// production, with Gemini selected, the saved Gemini key was silently ignored
// and choosing a provider in the settings appeared not to work. An untagged key
// is now attributed by its shape, and only failing that, to the selected provider.
function storedKeyProvider(agent) {
  const tagged = String(agent?.provider?.apiKeyProvider || "").toLowerCase();
  if (PROVIDERS[tagged]) return tagged;
  const key = storedKeyPlain(agent);
  if (!key) return "";
  return providerOfKeyShape(key) || resolveProvider(agent);
}

// The key for ONE provider + where it came from. Env var wins; a DB key is only
// used when it was stored for that same provider.
//   returns { key: string, source: "env" | "database" | "" }
function resolveKeyFor(agent, provider) {
  const envKey = ENV.keyFor(provider);
  if (envKey) return { key: envKey, source: "env" };
  if (storedKeyProvider(agent) === provider) {
    const key = storedKeyPlain(agent);
    if (key) return { key, source: "database" };
  }
  return { key: "", source: "" };
}

// The key for the SELECTED provider (unchanged contract).
function resolveKey(agent) {
  return resolveKeyFor(agent, resolveProvider(agent));
}

// Effective model / token / temperature / timeout (config wins over env).
function resolveModel(agent) {
  const explicit = (agent?.provider?.model || "").trim();
  if (explicit) return explicit;
  return PROVIDERS[resolveProvider(agent)].defaultModel();
}
function resolveMaxTokens(agent) {
  return Number(agent?.provider?.maxTokens) || ENV.maxTokens(resolveProvider(agent));
}
function resolveTemperature(agent) {
  const t = agent?.provider?.temperature;
  return t == null ? ENV.temperature(resolveProvider(agent)) : Number(t);
}
function resolveTimeoutMs(agent) {
  return Number(agent?.provider?.requestTimeoutMs) || ENV.timeoutMs(resolveProvider(agent));
}
function resolveDailyLimit(agent) {
  const v = agent?.dailyRequestLimit;
  return v == null || v === "" ? ENV.dailyLimit() : Number(v);
}
function resolveUserLimit(agent) {
  const v = agent?.perUserRequestLimit;
  return v == null || v === "" ? ENV.userLimit() : Number(v);
}

const routingOn = (agent) => agent?.modelRouting !== false && env("AUTOMATION_AGENT_MODEL_ROUTING").toLowerCase() !== "false";
const crossProviderOn = (agent) =>
  agent?.crossProviderFallback !== false && env("AUTOMATION_AGENT_CROSS_PROVIDER").toLowerCase() !== "false";

// Short help questions go to the provider's light model first (UCDS VERA's
// "send simple questions to the light model"): a fraction of the tokens, and its
// own quota. Needs routing on, as the light model is part of the route.
const lightRoutingOn = (agent) => routingOn(agent) && agent?.lightModelRouting !== false;

// ── The route: which models a call may use, in order ─────────────────────────
// `light`: the call is a short help question — the light model leads.
function routeFor(agent, { light = false } = {}) {
  const primary = resolveProvider(agent);
  const list = [];
  const add = (provider, model, role) => {
    if (!model || !PROVIDERS[provider]?.sdkAvailable()) return;
    if (list.some((c) => c.provider === provider && c.model === model)) return;
    list.push({ provider, model, role });
  };
  if (light && lightRoutingOn(agent)) add(primary, PROVIDERS[primary].lightModel(), "Light model (short questions)");
  add(primary, resolveModel(agent), "Selected model");
  if (!routingOn(agent)) return list;
  add(primary, PROVIDERS[primary].lightModel(), "Fallback (same provider)");
  if (crossProviderOn(agent)) {
    for (const other of FALLBACK_ORDER) {
      if (other === primary || !resolveKeyFor(agent, other).key) continue;
      add(other, PROVIDERS[other].defaultModel(), "Other provider");
      add(other, PROVIDERS[other].lightModel(), "Other provider (light)");
    }
  }
  return list;
}

// ── Resting: models that just failed are skipped for a while ─────────────────
const MIN = 60 * 1000;
const resting = new Map(); // "provider:model" | "provider:*" → { until, reason }
const strikes = new Map(); // "provider:model" → consecutive failures
const restKey = (p, m) => `${p}:${m}`;

const statusOf = (err) => Number(err?.status || err?.statusCode || err?.response?.status || err?.code) || 0;
const rawOf = (err) => String(err?.message || err?.error?.message || "");
const isOverloaded = (err) => [500, 502, 503, 529].includes(statusOf(err)) || /overloaded|high demand|unavailable|try again later/i.test(rawOf(err));
const isTimeout = (err) =>
  err?.name === "AbortError" || err?.name === "TimeoutError" || err?.name === "APIConnectionTimeoutError" ||
  Number(err?.code) === 20 || /timeout|timed out|aborted/i.test(rawOf(err));
const isRateLimited = (err) => [429, 413].includes(statusOf(err)) || /resource[_\s-]?exhausted|rate limit|quota/i.test(rawOf(err));
const isDailyQuota = (err) => isRateLimited(err) && (err?.perDay || /per\s?day|daily|free_tier|limit: 0|\(RPD\)|\(TPD\)/i.test(rawOf(err)));
const noCredit = (err) => /credit balance|billing|insufficient[_\s-]?(funds|quota)/i.test(rawOf(err));
const keyRejected = (err) => [401, 403].includes(statusOf(err)) || /UNAUTHENTICATED|PERMISSION_DENIED|invalid api key/i.test(rawOf(err));
const modelMissing = (err) => statusOf(err) === 404 || /NOT_FOUND|is not found|does not exist|model_not_found/i.test(rawOf(err));

function restFor(err) {
  const after = Number(err?.retryAfterMs) || 0;
  if (isDailyQuota(err)) return { ms: Math.min(after || 60 * MIN, 60 * MIN), reason: "daily quota used up" };
  if (isRateLimited(err)) return { ms: Math.min(Math.max(after || MIN, 15 * 1000), 30 * MIN), reason: "rate limited" };
  if (noCredit(err)) return { ms: 60 * MIN, reason: "no credit on the account", wholeProvider: true };
  if (keyRejected(err)) return { ms: 10 * MIN, reason: "API key rejected", wholeProvider: true };
  if (modelMissing(err)) return { ms: 60 * MIN, reason: "model not available to this key" };
  if (isOverloaded(err)) return { ms: 10 * MIN, reason: "overloaded", grows: true };
  if (isTimeout(err)) return { ms: 10 * MIN, reason: "too slow", grows: true };
  return null;
}

function rest(candidate, err) {
  const r = restFor(err);
  if (!r) return false;
  const key = restKey(candidate.provider, candidate.model);
  const times = (strikes.get(key) || 0) + 1;
  strikes.set(key, times);
  const ms = r.grows ? Math.min(r.ms * 2 ** (times - 1), 60 * MIN) : r.ms;
  resting.set(r.wholeProvider ? restKey(candidate.provider, "*") : key, { until: Date.now() + ms, reason: r.reason });
  return true;
}

function restingInfo(c) {
  const now = Date.now();
  const hits = [resting.get(restKey(c.provider, c.model)), resting.get(restKey(c.provider, "*"))].filter(
    (r) => r && r.until > now,
  );
  if (!hits.length) return null;
  const longest = hits.reduce((a, b) => (b.until > a.until ? b : a));
  return longest;
}

function clearRest(c) {
  resting.delete(restKey(c.provider, c.model));
  strikes.delete(restKey(c.provider, c.model));
}

// Is the agent allowed to make a real model call right now? Master switch AND
// stored toggle AND a key for SOME model in the route.
function isOperational(agent) {
  if (!(ENV.masterEnabled() && !!agent?.enabled)) return false;
  return routeFor(agent).some((c) => !!resolveKeyFor(agent, c.provider).key);
}

// Build an Anthropic client bound to the resolved key + timeout. Returns null if
// no key resolves or the selected provider is not Anthropic.
function getClient(agent) {
  if (resolveProvider(agent) !== "anthropic") return null;
  const { key } = resolveKey(agent);
  if (!key) return null;
  return new Anthropic({ apiKey: key, timeout: resolveTimeoutMs(agent), maxRetries: 1 });
}

// Current-generation Claude models reject a sampling temperature.
const anthropicAcceptsTemperature = (model) => !/claude-(opus-(4-[78]|5)|sonnet-5|haiku-5|fable)/.test(model);

// ── One call to one model ────────────────────────────────────────────────────
async function callModel({ provider, model, key, system, prompt, maxTokens, temperature, timeoutMs, signal }) {
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

  if (provider === "groq") {
    const timeout = AbortSignal.timeout(timeoutMs);
    const reasoning = /gpt-oss/.test(model);
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: String(prompt || "") }],
        // GPT-OSS reasons before it answers; leave it room so the answer is not cut off.
        max_completion_tokens: reasoning ? maxTokens + 512 : maxTokens,
        temperature,
        ...(reasoning ? { reasoning_effort: "low", include_reasoning: false } : {}),
      }),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const e = new Error(body?.error?.message || `HTTP ${res.status}`);
      e.status = res.status;
      const after = Number(res.headers.get("retry-after"));
      if (Number.isFinite(after) && after > 0) e.retryAfterMs = after * 1000;
      e.perDay = /per day|\(RPD\)|\(TPD\)/i.test(e.message);
      throw e;
    }
    const choice = body?.choices?.[0];
    return {
      provider,
      model: body?.model || model,
      text: String(choice?.message?.content || "").trim(),
      inputTokens: body?.usage?.prompt_tokens || 0,
      outputTokens: body?.usage?.completion_tokens || 0,
      stopReason: choice?.finish_reason || "",
    };
  }

  // Anthropic
  const client = new Anthropic({ apiKey: key, timeout: timeoutMs, maxRetries: 1 });
  const resp = await client.messages.create(
    {
      model,
      max_tokens: maxTokens,
      ...(anthropicAcceptsTemperature(model) ? { temperature } : {}),
      system: system || undefined,
      messages: [{ role: "user", content: String(prompt || "") }],
    },
    { signal },
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

// ── Unified completion through the router ────────────────────────────────────
// Returns a normalized shape regardless of vendor:
//   { text, inputTokens, outputTokens, stopReason, provider, model, fellBack }
// `signal` (AbortSignal) is honored by every provider. Throws the LAST failure
// (with a `code`) when no model in the route answers.
//
// Guardrails (utils/veraGuardrails) for EVERY caller:
//   • `chat: true` marks a VERA chat turn, whose user turn is a person's
//     question. Every other call (automatic remarks, ticket triage, the agent
//     query) feeds records to the model, so its system prompt is closed with
//     DATA_FENCE: a record that says "ignore the above" is read as data.
//   • The answer is screened: a secret from this server's environment, or
//     anything shaped like a credential, is cut out before it is returned.
// `light: true` lets a short help question lead with the light model.
async function complete(agent, { system, prompt, signal, chat = false, light = false } = {}) {
  const guardrails = require("./veraGuardrails");
  const guardsOn = guardrails.enabled(agent);
  if (guardsOn && !chat) system = [system, guardrails.DATA_FENCE].filter(Boolean).join("\n\n");
  const out = await completeRouted(agent, { system, prompt, signal, light });
  if (guardsOn && out?.text) {
    const screened = guardrails.screenOutput(out.text);
    out.text = screened.leaked ? "" : screened.text;
    out.redactions = screened.redactions;
  }
  return out;
}

async function completeRouted(agent, { system, prompt, signal, light = false } = {}) {
  const route = routeFor(agent, { light }).filter((c) => resolveKeyFor(agent, c.provider).key);
  if (!route.length) {
    const err = new Error("not_configured");
    err.code = "not_configured";
    throw err;
  }
  // Skip resting models — but if EVERY model is resting, try them anyway rather
  // than fail without asking anyone.
  const ready = route.filter((c) => !restingInfo(c));
  const candidates = ready.length ? ready : route;
  const selectedProvider = resolveProvider(agent);
  let lastErr = null;
  for (const c of candidates) {
    if (signal?.aborted) break;
    const sameProvider = c.provider === selectedProvider;
    try {
      const out = await callModel({
        provider: c.provider,
        model: c.model,
        key: resolveKeyFor(agent, c.provider).key,
        system,
        prompt,
        maxTokens: sameProvider ? resolveMaxTokens(agent) : ENV.maxTokens(c.provider),
        temperature: sameProvider ? resolveTemperature(agent) : ENV.temperature(c.provider),
        timeoutMs: sameProvider ? resolveTimeoutMs(agent) : ENV.timeoutMs(c.provider),
        signal,
      });
      clearRest(c);
      return { ...out, fellBack: c !== candidates[0] || c.provider !== route[0].provider || c.model !== route[0].model };
    } catch (err) {
      lastErr = err;
      // The caller gave up (its own timeout): stop rather than start another call.
      if (signal?.aborted) break;
      // A failure the router cannot route around (e.g. a malformed request)
      // still moves on — another model may accept it — but is not rested.
      rest(c, err);
    }
  }
  throw lastErr || Object.assign(new Error("No model answered"), { code: "no_model" });
}

// Minimal, low-token round-trip that confirms auth + model access for the
// SELECTED provider and model only (resting or not), so a test reports on what
// the developer configured. Returns { text, model, provider, inputTokens, outputTokens }.
async function testConnection(agent) {
  const provider = resolveProvider(agent);
  const model = resolveModel(agent);
  const { key } = resolveKey(agent);
  if (!key) {
    const err = new Error("not_configured");
    err.code = "not_configured";
    throw err;
  }
  const candidate = { provider, model };
  try {
    const out = await callModel({
      provider,
      model,
      key,
      prompt: "Reply with the single word: OK",
      maxTokens: provider === "groq" ? 64 : 16,
      temperature: 0,
      timeoutMs: resolveTimeoutMs(agent),
    });
    clearRest(candidate);
    return { provider, model, text: out.text, inputTokens: out.inputTokens, outputTokens: out.outputTokens };
  } catch (err) {
    rest(candidate, err);
    throw err;
  }
}

// For the settings screen: the route, and which models are resting. Names only.
function routerStatus(agent) {
  return {
    routing: routingOn(agent),
    lightRouting: lightRoutingOn(agent),
    lightModel: PROVIDERS[resolveProvider(agent)].lightModel(),
    crossProvider: crossProviderOn(agent),
    fallbackOrder: FALLBACK_ORDER,
    route: routeFor(agent).map((c) => {
      const r = restingInfo(c);
      return {
        provider: c.provider,
        providerLabel: PROVIDERS[c.provider].label,
        model: c.model,
        role: c.role,
        hasKey: !!resolveKeyFor(agent, c.provider).key,
        restingUntil: r ? new Date(r.until).toISOString() : null,
        reason: r ? r.reason : "",
      };
    }),
  };
}

// UI-safe status. NEVER includes a key — only booleans, env var NAMES and a masked hint.
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
    // Every provider's key state, so the screen shows what the router can use.
    providers: PROVIDER_IDS.map((id) => {
      const k = resolveKeyFor(agent, id);
      return {
        id,
        label: PROVIDERS[id].label,
        envVar: PROVIDERS[id].envKey,
        keyConfigured: !!k.key,
        keySource: k.source,
        defaultModel: PROVIDERS[id].defaultModel(),
        lightModel: PROVIDERS[id].lightModel(),
        sdkAvailable: PROVIDERS[id].sdkAvailable(),
      };
    }),
    router: routerStatus(agent),
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
  const prov = PROVIDERS[(provider || "").toLowerCase()] ? provider.toLowerCase() : "anthropic";
  return { apiKeyEnc: encryptSecret(text), apiKeyHint: maskHint(text), apiKeyProvider: prov, apiKey: "" };
}

// One-time migration helper: if a legacy plaintext key exists and no encrypted
// copy does, return the fields to re-store it encrypted (caller persists).
function migrateLegacyKeyIfNeeded(agent) {
  const legacy = (agent?.provider?.apiKey || "").trim();
  const enc = agent?.provider?.apiKeyEnc || "";
  if (legacy && !enc && !isEncrypted(legacy)) {
    const prov = resolveProvider(agent);
    return { apiKeyEnc: encryptSecret(legacy), apiKeyHint: maskHint(legacy), apiKeyProvider: prov, apiKey: "" };
  }
  return null;
}

module.exports = {
  PROVIDERS,
  PROVIDER_IDS,
  FALLBACK_ORDER,
  ENV,
  resolveProvider,
  resolveKey,
  resolveKeyFor,
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
  routeFor,
  routerStatus,
  restFor,
  safeStatus,
  prepareKeyForStorage,
  migrateLegacyKeyIfNeeded,
  // For tests: forget which models are resting.
  _resetRouter: () => {
    resting.clear();
    strikes.clear();
  },
};
