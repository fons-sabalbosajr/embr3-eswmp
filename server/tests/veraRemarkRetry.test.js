/**
 * A VERA submission remark that fell back because the model call FAILED is
 * retried; one that fell back because no model call was made is not.
 *
 * Production, 21 days to 2026-11-09: 73 of 201 automatic remarks were the
 * rule-based fallback after Gemini 429 / 503 / timeouts. The fallback carried the
 * same issue signature as a real review, and the list read only re-queued rows
 * whose signature changed, so a passing rate limit left the canned text forever.
 *
 * Run: node --test tests/veraRemarkRetry.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const model = fs.readFileSync(path.join(__dirname, "..", "models", "DataSLF.js"), "utf8");

test("a remark records whether the model call failed", () => {
  const gen = source.slice(source.indexOf("async function generateVeraRemark"), source.indexOf('router.post("/vera-remarks"'));
  assert.match(gen, /degraded: Boolean\(providerError\)/);
  // Without the schema path, strict mode would silently drop the flag on $set.
  assert.match(model, /veraRemark: \{[\s\S]*?degraded: \{ type: Boolean \}/);
});

test("the list read re-queues degraded fallbacks, not deliberate ones", () => {
  const start = source.indexOf("const reviewOnRead");
  const block = source.slice(start, source.indexOf("queueVeraAutoReview(staleGroups", start));
  assert.match(block, /vr\?\.signature !== signature/, "a changed issue set is still stale");
  assert.match(
    block,
    /vr\.source === "fallback" && vr\.degraded !== false/,
    "a failed-call fallback (or a legacy one without the flag) must be retried; degraded:false must not",
  );

  // Execute the rule exactly as written in the route.
  const expr = block.match(/const stale = groupRows\.some\(\(\{ raw \}\) => \{([\s\S]*?)\n\s*\}\);/)[1];
  const isStale = new Function("raw", "signature", expr);
  const sig = "abc";
  assert.equal(isStale({ veraRemark: { signature: sig, source: "model" } }, sig), false);
  assert.equal(isStale({ veraRemark: { signature: sig, source: "fallback", degraded: true } }, sig), true);
  assert.equal(isStale({ veraRemark: { signature: sig, source: "fallback" } }, sig), true, "legacy fallback retried once");
  assert.equal(isStale({ veraRemark: { signature: sig, source: "fallback", degraded: false } }, sig), false);
  assert.equal(isStale({ veraRemark: { signature: "old", source: "model" } }, sig), true);
  assert.equal(isStale({}, sig), true, "no remark yet");
});
