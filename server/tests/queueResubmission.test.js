/**
 * Drafts & Scheduled can hold the CORRECTION of a reverted entry, and submitting
 * it resubmits that entry in place.
 *
 * Production: the queue sent every record through submitEntries, so a correction
 * saved as a draft (the Data Entry "Save as Draft" button stays visible during
 * Edit & Resubmit) or scheduled came back as a NEW submission. The reverted entry
 * stayed reverted — after 24 h it blocked every later submission (409, seen
 * 2026-10-22/23) — and once the copy was approved the operator's Submission
 * Breakdown still counted the original as Reverted (Porac: SLF-PVT-PA-0005 →
 * -0043, SLF-PVT-PA-0002 → -0003).
 *
 * Run: node --test tests/queueResubmission.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const dataSLF = require("../routes/dataSLF");
const UserPortal = require("../models/UserPortal");
const DataSLF = require("../models/DataSLF");
const AppLog = require("../models/AppLog");
const { submitQueueRecord } = require("../utils/queueSubmission");

AppLog.create = async () => ({});
const OWNER = "operator@example.com";
const REVERTED_ID = new mongoose.Types.ObjectId();

const realSubmit = dataSLF.submitEntries;
const realResubmit = dataSLF.resubmitEntry;
let calls;
let portalAccess;

test.beforeEach(() => {
  calls = [];
  portalAccess = undefined; // default policy: allowed
  dataSLF.submitEntries = async (args) => { calls.push(["submit", args]); return { submissionId: "SUB-NEW" }; };
  dataSLF.resubmitEntry = async (args) => {
    calls.push(["resubmit", args]);
    return { submissionId: "SUB-ORIGINAL", idNo: "SLF-PVT-PA-0005" };
  };
  UserPortal.findOne = () => ({
    select() { return this; },
    lean: async () => ({ email: OWNER, portalAccess }),
  });
});

test.after(() => {
  dataSLF.submitEntries = realSubmit;
  dataSLF.resubmitEntry = realResubmit;
});

test("an ordinary draft still files a new submission", async () => {
  const out = await submitQueueRecord({ portalUserEmail: OWNER, payload: { trucks: [{}] } });
  assert.equal(out.submissionId, "SUB-NEW");
  assert.deepEqual(calls.map(([kind]) => kind), ["submit"]);
  assert.equal(calls[0][1].submittedBy, OWNER);
});

test("a saved correction resubmits the reverted entry in place", async () => {
  const payload = { trucks: [{}], resubmitComment: "fixed the plate numbers" };
  const out = await submitQueueRecord({ portalUserEmail: OWNER, payload, resubmitOf: REVERTED_ID });
  assert.deepEqual(calls.map(([kind]) => kind), ["resubmit"], "never filed as a new submission");
  const args = calls[0][1];
  assert.equal(String(args.id), String(REVERTED_ID));
  assert.equal(args.ownerEmail, OWNER, "only the owner's entry can be corrected");
  assert.equal(args.requireReverted, true, "a stale copy must not overwrite a resubmission already made");
  assert.equal(args.body, payload, "the operator's note travels with the payload");
  assert.equal(out.resubmittedIdNo, "SLF-PVT-PA-0005");
});

test("the queue honours the same portal rule as Edit & Resubmit", async () => {
  const { fieldForRule } = require("../utils/portalPolicy");
  portalAccess = { [fieldForRule("can_edit_submitted_data")]: false };
  await assert.rejects(
    submitQueueRecord({ portalUserEmail: OWNER, payload: {}, resubmitOf: REVERTED_ID }),
    (err) => err.statusCode === 403,
  );
  assert.equal(calls.length, 0);
});

test("resubmitEntry refuses a correction once the entry is no longer reverted", async () => {
  const realFindById = DataSLF.findById;
  DataSLF.findById = async () => ({ _id: REVERTED_ID, idNo: "SLF-PVT-PA-0005", status: "pending", submittedBy: OWNER });
  UserPortal.findOne = () => ({
    select() { return this; },
    then: (resolve) => resolve({ email: OWNER, status: "approved", verificationRequired: false }),
  });
  try {
    await assert.rejects(
      realResubmit({ id: REVERTED_ID, body: {}, ownerEmail: OWNER, requireReverted: true }),
      (err) => err.statusCode === 409 && err.code === "NOT_REVERTED",
    );
    await assert.rejects(
      realResubmit({ id: REVERTED_ID, body: {}, ownerEmail: "someone@else.com" }),
      (err) => err.statusCode === 403,
      "another account's entry is refused",
    );
  } finally {
    DataSLF.findById = realFindById;
  }
});

test("both queue paths go through the shared helper; drafts never merge with corrections", () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
  assert.match(read("routes", "portalQueue.js"), /await submitQueueRecord\(record, req\)/);
  assert.match(read("utils", "scheduledSubmissionWorker.js"), /await submitQueueRecord\(record\)/);
  assert.match(read("routes", "portalQueue.js"), /resubmitOf: \{ \$exists: false \}/);
  // A correction that can never succeed is failed at once, not retried 3 times.
  assert.match(read("utils", "scheduledSubmissionWorker.js"), /err\?\.code === "NOT_REVERTED"/);
});

test("the portal sends the link when a correction is drafted or scheduled", () => {
  const portal = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "index.jsx"),
    "utf8",
  );
  assert.match(portal, /const correctionLink = \(\) => \(editingRevertedId \? \{ resubmitOf: editingRevertedId \} : \{\}\)/);
  assert.equal((portal.match(/\.\.\.correctionLink\(\)/g) || []).length, 3, "draft create, draft update and schedule");
  // Reopening a saved correction puts Data Entry back in resubmit mode.
  assert.match(portal, /setEditingRevertedId\(correctionOf\)/);
});
