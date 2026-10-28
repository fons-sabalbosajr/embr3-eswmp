/**
 * A draft cannot become an official submission for a non-operational SLF.
 *
 * POST /data-slf turns such an attempt into a draft — but Drafts & Scheduled
 * ("Submit now") and the scheduled worker call submitEntries directly, so the
 * rule has to live in submitEntries or the draft is one click from official.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

test("submitEntries checks the facilities' operational status", () => {
  const src = read("routes", "dataSLF.js");
  const run = src.slice(src.indexOf("async function runSubmitEntries"), src.indexOf("const uploadClientIssues"));
  assert.match(run, /assertSlfsOperational\(items\)/);
  assert.match(src, /error\.code = "SLF_NON_OPERATIONAL";/);
});

test("the draft submit and the scheduled worker both go through submitEntries", () => {
  assert.match(read("routes", "portalQueue.js"), /await submitEntries\(\{/);
  assert.match(read("utils", "scheduledSubmissionWorker.js"), /await submitEntries\(\{/);
});
