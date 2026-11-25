/**
 * Data Entry autosave on the portal queue: `autosave: true` stamps the draft's
 * `autosavedAt` (a manual save clears it), it is listed in the summary the
 * Drafts & Scheduled panel reads, and autosaves do not write an app-log line
 * per save.
 *
 * Run: node --test tests/draftAutosave.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const queue = require("../routes/portalQueue");
const PortalSubmissionQueue = require("../models/PortalSubmissionQueue");

const source = fs.readFileSync(path.join(__dirname, "..", "routes", "portalQueue.js"), "utf8");

test("only an explicit autosave: true counts as an autosave", () => {
  assert.equal(queue.isAutosave({ autosave: true }), true);
  assert.equal(queue.isAutosave({ autosave: "true" }), false);
  assert.equal(queue.isAutosave({}), false);
  assert.equal(queue.isAutosave(undefined), false);
});

test("an autosave stamps autosavedAt and a manual save clears it", () => {
  const record = new PortalSubmissionQueue({ type: "draft", status: "draft" });
  queue.stampAutosave(record, { autosave: true });
  assert.ok(record.autosavedAt instanceof Date);
  queue.stampAutosave(record, { type: "draft" });
  assert.equal(record.autosavedAt, undefined);
});

test("the Drafts & Scheduled summary list carries autosavedAt", () => {
  assert.match(source, /const SUMMARY_FIELDS =[\s\S]*?autosavedAt";/);
});

test("autosaved updates skip the per-save app-log line", () => {
  for (const event of ["portal.queue.update", "portal.queue.draft_updated", "portal.queue.resubmit_updated"]) {
    const at = source.indexOf(`"${event}"`);
    assert.ok(at > 0, `${event} is still logged for manual saves`);
    const before = source.slice(Math.max(0, at - 200), at);
    assert.match(before, /if \(!isAutosave\(req\.body\)\) \{\s*writeLog\(/, `${event} is guarded`);
  }
});
