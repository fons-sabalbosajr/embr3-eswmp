/**
 * Automation Agent model router: a failing model is rested and the call falls
 * back; keys never leave the module.
 *
 * Production: the selected model (gemini-2.5-flash, free tier) failed 73 of 201
 * automatic reviews with 429/503 and nothing else was ever tried. The router
 * (approach from VERA in embr3-ucds) tries the selected model, then a fallback,
 * then other providers with keys, and rests a model that just failed.
 *
 * Driven end to end through Groq's REST path with a stubbed fetch — no network.
 *
 * Run: node --test tests/agentModelRouter.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const SAVED = {};
const ENV_KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AUTOMATION_AGENT_ENABLED", "GROQ_MODEL", "GROQ_LIGHT_MODEL"];
ENV_KEYS.forEach((k) => { SAVED[k] = process.env[k]; delete process.env[k]; });
process.env.GROQ_API_KEY = "gsk_test_secret_value";
process.env.AUTOMATION_AGENT_ENABLED = "true";

const agent = require("../utils/automationAgent");
const realFetch = global.fetch;
const cfg = { enabled: true, provider: { provider: "groq" } };

const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => body,
});

test.after(() => {
  global.fetch = realFetch;
  ENV_KEYS.forEach((k) => { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; });
});
test.beforeEach(() => agent._resetRouter());

test("the route starts with the selected model, then its fallback", () => {
  const route = agent.routeFor(cfg);
  assert.equal(route[0].model, "openai/gpt-oss-120b");
  assert.equal(route[0].role, "Selected model");
  assert.equal(route[1].model, "openai/gpt-oss-20b");
  // No other provider has a key, so none is added.
  assert.ok(route.every((c) => c.provider === "groq"));
});

test("a rate-limited model is rested and the call falls back", async () => {
  const asked = [];
  global.fetch = async (_url, init) => {
    const { model } = JSON.parse(init.body);
    asked.push(model);
    if (model === "openai/gpt-oss-120b") {
      return reply(429, { error: { message: "Rate limit reached for model on requests per minute" } }, { "retry-after": "30" });
    }
    return reply(200, { model, choices: [{ message: { content: "Answer from the light model" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4 } });
  };
  const out = await agent.complete(cfg, { system: "s", prompt: "p" });
  assert.equal(out.text, "Answer from the light model");
  assert.equal(out.model, "openai/gpt-oss-20b");
  assert.equal(out.fellBack, true);
  assert.deepEqual(asked, ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);

  const route = agent.routerStatus(cfg).route;
  assert.equal(route[0].reason, "rate limited");
  assert.ok(route[0].restingUntil, "the failing model is resting");

  // The next call skips the resting model entirely — no wait on it.
  asked.length = 0;
  await agent.complete(cfg, { prompt: "again" });
  assert.deepEqual(asked, ["openai/gpt-oss-20b"]);
});

test("when every model fails the last error is thrown", async () => {
  global.fetch = async () => reply(503, { error: { message: "Service unavailable — overloaded" } });
  await assert.rejects(agent.complete(cfg, { prompt: "p" }), (err) => err.status === 503);
  const reasons = agent.routerStatus(cfg).route.map((r) => r.reason);
  assert.deepEqual(reasons, ["overloaded", "overloaded"]);
});

test("rest lengths follow the failure kind", () => {
  assert.equal(agent.restFor({ status: 429, message: "per day (RPD)" }).reason, "daily quota used up");
  assert.equal(agent.restFor({ status: 401 }).wholeProvider, true);
  assert.equal(agent.restFor({ status: 404 }).reason, "model not available to this key");
  assert.equal(agent.restFor({ name: "AbortError", code: 20 }).reason, "too slow");
  assert.equal(agent.restFor({ status: 400, message: "bad request" }), null, "a malformed request is not rested");
});

test("status never carries a key, only names and booleans", () => {
  const status = agent.safeStatus(cfg);
  const json = JSON.stringify(status);
  assert.ok(!json.includes("gsk_test_secret_value"), "the key value must never appear");
  const groq = status.providers.find((p) => p.id === "groq");
  assert.equal(groq.keyConfigured, true);
  assert.equal(groq.envVar, "GROQ_API_KEY");
  assert.equal(status.providers.find((p) => p.id === "gemini").keyConfigured, false);
  assert.equal(status.operational, true);
});

test("routing switched off leaves only the selected model", () => {
  const route = agent.routeFor({ ...cfg, modelRouting: false });
  assert.equal(route.length, 1);
});
