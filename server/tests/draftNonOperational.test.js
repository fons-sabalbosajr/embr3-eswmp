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
  // Both now share utils/queueSubmission.js, so they cannot disagree. A record
  // that is NOT the correction of a reverted entry still files through
  // submitEntries — which is where the non-operational restriction lives.
  assert.match(read("routes", "portalQueue.js"), /await submitQueueRecord\(record, req\)/);
  assert.match(read("utils", "scheduledSubmissionWorker.js"), /await submitQueueRecord\(record\)/);
  assert.match(
    read("utils", "queueSubmission.js"),
    /if \(!record\?\.resubmitOf\) \{\s*return submitEntries\(\{ entries: \[record\.payload\]/,
  );
});
