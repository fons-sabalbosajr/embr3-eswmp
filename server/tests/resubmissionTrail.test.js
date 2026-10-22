/**
 * Resubmission trail — how a corrected reverted entry is recognised and labelled.
 *
 * A resubmission keeps its ID No., so `previousIdNos` stopped marking one and
 * both Remarks columns (admin Submissions, portal history) showed resubmissions
 * as plain submissions. Pinned here:
 *   1. the shared rule recognises old (previousIdNos) and new (resubmittedAt /
 *      resubmitCount) resubmissions alike;
 *   2. PUT /data-slf/:id records the trail only for a REVERTED entry, and only
 *      for the caller's own entry;
 *   3. a draft blocked by an unresolved revert carries the blocking entry's id.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  isResubmissionEntry,
  resubmissionSummary,
  RESUBMISSION_FIELDS,
} = require("../utils/resubmission");
const DataSLF = require("../models/DataSLF");

const readRoute = (file) =>
  fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");
const codeOnly = (src) =>
  src.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

test("a plain submission is not a resubmission", () => {
  assert.equal(isResubmissionEntry({ idNo: "SLF-PVT-PA-0001", previousIdNos: [] }), false);
  assert.equal(resubmissionSummary({ idNo: "SLF-PVT-PA-0001" }), null);
});

test("a resubmission that kept its ID No. is recognised by resubmittedAt", () => {
  const at = new Date("2026-10-22T03:00:00Z");
  const entry = {
    idNo: "SLF-LGU-PA-0018",
    previousIdNos: [],
    resubmittedAt: at,
    resubmitCount: 2,
    resubmitComment: "Corrected the truck capacity unit",
    resubmittedRevertReason: "Kindly update the unit of measurement",
  };
  assert.equal(isResubmissionEntry(entry), true);
  assert.deepEqual(resubmissionSummary(entry), {
    at,
    count: 2,
    comment: "Corrected the truck capacity unit",
    revertReason: "Kindly update the unit of measurement",
    previousIdNo: null,
  });
});

test("a legacy resubmission (re-minted ID) still counts", () => {
  const entry = { idNo: "SLF-LGU-PA-0016", previousIdNos: ["SLF-PVT-PA-0006"], updatedAt: new Date() };
  assert.equal(isResubmissionEntry(entry), true);
  assert.equal(resubmissionSummary(entry).previousIdNo, "SLF-PVT-PA-0006");
  assert.equal(resubmissionSummary(entry).count, 1);
});

test("the model stores every field the projections ask for", () => {
  for (const field of RESUBMISSION_FIELDS.split(" ")) {
    assert.ok(DataSLF.schema.path(field), `DataSLF is missing ${field}`);
  }
});

test("PUT /:id records the trail only when the entry was REVERTED", () => {
  const src = codeOnly(readRoute("dataSLF.js"));
  const put = src.slice(src.indexOf('router.put("/:id"'), src.indexOf("// Get latest baseline info"));
  assert.match(put, /const wasReverted = entry\.status === "reverted";/);
  assert.match(put, /if \(wasReverted\) \{[\s\S]*?entry\.resubmittedAt = new Date\(\);[\s\S]*?entry\.resubmitCount =/);
  // The reason it answered is captured BEFORE the resubmit clears it.
  assert.ok(
    put.indexOf("const answeredRevertReason = entry.revertReason") < put.indexOf('entry.revertReason = "";'),
  );
});

test("PUT /:id refuses a portal user updating another account's entry", () => {
  const src = codeOnly(readRoute("dataSLF.js"));
  const put = src.slice(src.indexOf('router.put("/:id"'), src.indexOf("// Get latest baseline info"));
  assert.match(put, /req\.user\?\.role === "portal_user"/);
  assert.match(put, /status\(403\)\.json\(\{ message: "You can only update your own submissions\." \}\)/);
  // The ownership check runs before anything is written.
  assert.ok(put.indexOf("You can only update your own submissions") < put.indexOf("applyEntryUpdates("));
});

test("the unresolved-revert refusal names the blocking entry by id", () => {
  const src = codeOnly(readRoute("dataSLF.js"));
  assert.match(src, /error\.ruleContext = \{ idNo: stale\.idNo \|\| null, id: String\(stale\._id\) \};/);
  const queue = codeOnly(readRoute("portalQueue.js"));
  assert.match(queue, /submitErr\.ruleContext \? \{ ruleContext: submitErr\.ruleContext \}/);
  assert.match(queue, /typeof submitErr\.code === "string" \? \{ code: submitErr\.code \}/);
});

test("both history reads ship the resubmission summary", () => {
  const portal = readRoute("portalAuth.js");
  assert.match(portal, /RESUBMISSION_FIELDS,/);
  assert.match(portal, /resubmission: resubmissionSummary\(entry\)/);
  const admin = readRoute("dataSLF.js");
  assert.match(admin, /resubmission: resubmissionSummary\(entry\)/);
});
