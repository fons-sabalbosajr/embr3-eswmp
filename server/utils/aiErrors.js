// Shared, secret-safe error sanitizer for AI provider calls (Anthropic / Gemini).
//
// Used by both the Automation Agent (routes/automationAgent.js) and VERA
// (routes/vera.js). It maps raw SDK/HTTP errors to a short user-facing message +
// a stable code, and NEVER leaks the API key, stack traces, or raw provider
// payloads. The key (if known) is scrubbed defensively as a last step.
//
//   sanitizeError(err, key, provider) -> { message, code }

function sanitizeError(err, key, provider = "anthropic") {
  const vendor = provider === "gemini" ? "Gemini" : "Anthropic";
  const consoleName = provider === "gemini" ? "Google AI Studio" : "the Anthropic Console";
  const status = err?.status || err?.statusCode || err?.code;
  const rawType = err?.error?.type || err?.name || "";
  const rawMsg = String(err?.message || err?.error?.message || "");
  let message = "The AI request failed. Please try again.";
  let code = "unknown";
  if (err?.code === "not_configured") {
    message = "No API key is configured for the selected provider.";
    code = "not_configured";
  } else if (err?.code === "sdk_missing") {
    message = "The Gemini SDK is not installed on the server.";
    code = "sdk_missing";
  } else if (status === 401 || rawType === "authentication_error" || /UNAUTHENTICATED|API key/i.test(rawMsg)) {
    message = `Authentication failed — the ${vendor} API key was rejected.`;
    code = "auth_failed";
  } else if (status === 403 || rawType === "permission_error" || /PERMISSION_DENIED/i.test(rawMsg)) {
    message = "The API key lacks permission for this model.";
    code = "permission_denied";
  } else if (status === 404 || rawType === "not_found_error" || /NOT_FOUND|is not found/i.test(rawMsg)) {
    message = `The configured model is not available for this ${vendor} API key.`;
    code = "model_unavailable";
  } else if (
    (status === 429 && provider === "gemini" && /free_tier|limit: 0/i.test(rawMsg)) ||
    (status === 429 && /quota|RESOURCE_EXHAUSTED/i.test(rawMsg) && /limit: 0/i.test(rawMsg))
  ) {
    message = `This ${vendor} model has no free-tier quota for your project — pick a different model (e.g. a Flash model) or enable billing.`;
    code = "no_quota";
  } else if (status === 429 || rawType === "rate_limit_error" || /rate limit|RESOURCE_EXHAUSTED/i.test(rawMsg)) {
    message = `${vendor} rate limit reached. Please wait and try again.`;
    code = "rate_limited";
  } else if (status === 400 && /credit|balance|billing|quota/i.test(rawMsg)) {
    message = `Insufficient ${vendor} credits — check billing in ${consoleName}.`;
    code = "insufficient_credits";
  } else if (
    err?.name === "APIConnectionTimeoutError" ||
    /timeout|timed out|ETIMEDOUT|ECONNRESET|AbortError|abort/i.test(String(err?.message || err?.name || ""))
  ) {
    message = `The request to ${vendor} timed out. Please try again.`;
    code = "timeout";
  }
  // Defensive scrub — never echo the key even if it somehow reached a message.
  if (key) message = message.split(key).join("****");
  return { message, code };
}

module.exports = { sanitizeError };
