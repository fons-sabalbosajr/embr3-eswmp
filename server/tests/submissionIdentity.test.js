/**
 * Submission identity — what counts as a submission, and ID No. alignment.
 *
 * Two rules are pinned here:
 *   1. A record with NO transport entries is a baseline container, not a
 *      submission, and must never be listed as one.
 *   2. A permanent delete re-aligns the ID No. sequence against the live
 *      collection: duplicates are repaired, gaps are kept as history.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const DataSLF = require("../models/DataSLF");
const { SUBMISSION_HAS_TRUCKS, realignIdNoSequence } = require("../routes/dataSLF");
const { validateWasteGeneration } = require("../utils/wasteGenerationValidation");

const readSource = (file) =>
  fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");

// Comment lines describe the bug that was removed, so they would match the very
// patterns these assertions look for. Strip them and assert on the CODE.
const codeOnly = (source) =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

// ── The phantom submission ──────────────────────────────────────────────────
test("a submission can never have zero trucks, so 'no trucks' identifies a baseline container", () => {
  const issues = validateWasteGeneration([]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /At least one truck entry is required/);
});

test("both submission lists exclude records with no transport entries", () => {
  assert.deepEqual(SUBMISSION_HAS_TRUCKS, { "trucks.0": { $exists: true } });
  // Admin submissions list.
  const dataSlf = readSource("dataSLF.js");
  const adminList = dataSlf.slice(
    dataSlf.indexOf('router.get("/", optionalAuth'),
    dataSlf.indexOf('router.get("/detail/:id"'),
  );
  assert.match(adminList, /const filter = \{ deletedAt: null, \.\.\.SUBMISSION_HAS_TRUCKS \}/);
  // Portal submission history.
  const portalAuth = readSource("portalAuth.js");
  const history = portalAuth.slice(
    portalAuth.indexOf('router.get("/my-submissions"'),
    portalAuth.indexOf('router.post("/my-submissions/batch"'),
  );
  assert.match(history, /"trucks\.0": \{ \$exists: true \}/);
});

test("the baseline-only record no longer mints its own ID No.", () => {
  const dataSlf = readSource("dataSLF.js");
  const handler = codeOnly(
    dataSlf.slice(
      dataSlf.indexOf('router.patch("/portal-save-baseline/:slfName"'),
      dataSlf.indexOf('router.post("/baseline-update-request"'),
    ),
  );
  assert.doesNotMatch(handler, /getProvinceCode\(""\)/, "the hardcoded empty province produced SLF-…-XX-0001");
  assert.doesNotMatch(handler, /idNo: `SLF-/, "ID generation belongs to the model hook");
});

// ── A resubmission keeps its identity ───────────────────────────────────────
//
// The record an admin reverts must come BACK to them under the same ID No.
// PUT /:id used to mint a fresh sequence number on every resubmission, so the
// revert notification, the revert email and the Transaction History all named an
// ID that no longer existed, and the corrected submission arrived looking like a
// stranger. It also stamped the TYPE segment from the incoming payload — which
// restamped a Private facility as LGU (SLF-PVT-PA-0006 → SLF-LGU-PA-0016 on
// Prime Waste Solution) — and read the "last" ID without includeHiddenYears, so
// it could reissue a number already in use.
test("a resubmission does not re-mint the ID No.", () => {
  const dataSlf = readSource("dataSLF.js");
  const resubmit = codeOnly(
    dataSlf.slice(
      dataSlf.indexOf('router.put("/:id"'),
      dataSlf.indexOf('router.get("/baseline/:slfName"'),
    ),
  );
  assert.ok(resubmit.length > 0, "the resubmit route should exist");
  assert.doesNotMatch(resubmit, /entry\.idNo = `SLF-/, "ID assignment belongs to the model hook");
  assert.doesNotMatch(
    resubmit,
    /entry\.companyType === "Private" \? "PVT"/,
    "the TYPE segment must not be derived from the incoming payload here",
  );
  assert.doesNotMatch(
    resubmit,
    /DataSLF\.findOne\(\{ idNo: pattern/,
    "the un-bypassed sequence scan could reissue an ID already in use",
  );
});

test("the model hook re-mints an ID ONLY on a real companyType change", () => {
  const model = fs.readFileSync(path.join(__dirname, "..", "models", "DataSLF.js"), "utf8");
  assert.match(
    model,
    /if \(!this\.isNew && this\.idNo && this\.isModified\("companyType"\)\)/,
    "an ordinary correction leaves the identity alone",
  );
  // …and when it does re-mint, it reads across every year rather than only the
  // visible one — the guard the route's hand-rolled copy was missing.
  assert.match(
    model,
    /const lastDoc = await DataSLF\.findOne\(\{ idNo: pattern \}\)\s*\.setOptions\(\{ includeHiddenYears: true \}\)/,
  );
  assert.match(model, /this\.previousIdNos\.push\(this\.idNo\)/, "the old ID is kept as history");
});

test("a baseline-only record is never given an ID No.", () => {
  const baseline = new DataSLF({
    dateOfDisposal: new Date("2026-08-13"),
    lguCompanyName: "Demonstration Valley",
    companyType: "Private",
    totalVolumeAccepted: 1500,
  });
  // The hook is async and hits the DB for a real submission; a baseline container
  // must not even reach that branch, which is what this asserts.
  assert.equal(baseline.idNo, undefined);
  assert.equal(baseline.trucks.length, 0, "no transport entries → not a submission");
});

test("a record that carries transport entries is still a submission", () => {
  const submission = new DataSLF({
    dateOfDisposal: new Date("2026-08-13"),
    lguCompanyName: "Demonstration Valley",
    companyType: "Private",
    trucks: [{ plateNumber: "TST-0001", actualVolume: 10, truckCapacity: 12 }],
  });
  assert.equal(submission.trucks.length, 1);
  const model = fs.readFileSync(path.join(__dirname, "..", "models", "DataSLF.js"), "utf8");
  assert.match(model, /if \(!this\.idNo && isSubmissionRecord\(this\)\)/);
  assert.match(
    model,
    /const isSubmissionRecord = \(doc\) =>\s*Array\.isArray\(doc\?\.trucks\) && doc\.trucks\.length > 0;/,
  );
});

test("dashboard counts and the SLF map exclude baseline containers", () => {
  const dataSlf = readSource("dataSLF.js");
  const stats = dataSlf.slice(
    dataSlf.indexOf('router.get("/stats"'),
    dataSlf.indexOf('router.get("/generator-summary"'),
  );
  assert.match(stats, /NON_DUMMY_CLAUSE, \.\.\.SUBMISSION_HAS_TRUCKS/);
  const todayStatus = dataSlf.slice(
    dataSlf.indexOf('router.get("/today-status"'),
    dataSlf.indexOf('router.get("/stats"'),
  );
  assert.equal(
    (todayStatus.match(/SUBMISSION_HAS_TRUCKS/g) || []).length,
    2,
    "both the map-marker and the per-day aggregation must exclude them",
  );
});

test("a reverted BASELINE container cannot block a portal user's next submission", () => {
  const dataSlf = readSource("dataSLF.js");
  const guard = dataSlf.slice(
    dataSlf.indexOf("async function assertNoUnresolvedRevert"),
    dataSlf.indexOf("async function submitEntries"),
  );
  assert.match(
    guard,
    /status: "reverted",\s*\n\s*deletedAt: null,[\s\S]*?\.\.\.SUBMISSION_HAS_TRUCKS,/,
    "there is nothing to correct on a record with no waste data",
  );
});

test("the overdue-revert sweeper never trashes a baseline container", () => {
  const dataSlf = readSource("dataSLF.js");
  const sweeper = dataSlf.slice(
    dataSlf.indexOf("async function softDeleteOverdueReverted"),
    dataSlf.indexOf("async function markSubmissionNotificationsRead"),
  );
  assert.match(sweeper, /\.\.\.SUBMISSION_HAS_TRUCKS,/);
});

test("the cleanup script is dry-run by default and only clears idNo", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "clearBaselineSubmissionIds.js"),
    "utf8",
  );
  assert.match(script, /const APPLY = process\.argv\.includes\("--apply"\)/);
  assert.match(script, /\$unset: \{ idNo: "" \}/);
  assert.doesNotMatch(codeOnly(script), /deleteOne|deleteMany|findByIdAndDelete/, "must never delete a record");
  // Only records with no transport entries may match.
  assert.match(script, /trucks: \{ \$exists: false \} \}, \{ trucks: \{ \$size: 0 \} \}/);
});

test("the model's ID hook resolves a real province and reads across hidden years", () => {
  const model = fs.readFileSync(path.join(__dirname, "..", "models", "DataSLF.js"), "utf8");
  const hook = model.slice(
    model.indexOf("async function nextIdNoSequence"),
    model.indexOf("dataSLFSchema.index({ deletedAt: 1, createdAt: -1 })"),
  );
  assert.match(hook, /setOptions\(\{ includeHiddenYears: true \}\)/);
  assert.match(hook, /this\.companyProvince/, "falls back to the submission's own province");
});

// ── ID No. re-alignment ─────────────────────────────────────────────────────
// realignIdNoSequence talks to Mongoose; stub the two calls it makes so the rule
// is exercised without a database.
const withStubbedDataSLF = async (docs, run) => {
  const originalFind = DataSLF.find;
  const originalUpdateOne = DataSLF.updateOne;
  const updates = [];
  DataSLF.find = () => ({
    setOptions() { return this; },
    select() { return this; },
    lean: async () => docs.map((d) => ({ ...d })),
  });
  DataSLF.updateOne = (filter, update) => {
    updates.push({ filter, update });
    return { setOptions: async () => ({ acknowledged: true }) };
  };
  try {
    return { result: await run(), updates };
  } finally {
    DataSLF.find = originalFind;
    DataSLF.updateOne = originalUpdateOne;
  }
};

test("duplicate ID Nos are repaired — the oldest record keeps the ID", async () => {
  const { result, updates } = await withStubbedDataSLF(
    [
      { _id: "a", idNo: "SLF-PVT-PA-0001", createdAt: "2026-01-01" },
      { _id: "b", idNo: "SLF-PVT-PA-0001", createdAt: "2026-05-01" }, // duplicate
      { _id: "c", idNo: "SLF-PVT-PA-0002", createdAt: "2026-06-01" },
    ],
    () => realignIdNoSequence("SLF-PVT-PA-0007"),
  );

  assert.equal(result.prefix, "SLF-PVT-PA-");
  assert.deepEqual(result.repaired, [{ _id: "b", from: "SLF-PVT-PA-0001", to: "SLF-PVT-PA-0003" }]);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].filter, { _id: "b" });
  assert.equal(updates[0].update.$set.idNo, "SLF-PVT-PA-0003");
  assert.deepEqual(updates[0].update.$push, { previousIdNos: "SLF-PVT-PA-0001" });
});

test("gaps left by a deleted submission are preserved, not compacted", async () => {
  const { result, updates } = await withStubbedDataSLF(
    [
      { _id: "a", idNo: "SLF-LGU-BU-0001", createdAt: "2026-01-01" },
      // 0002 was permanently deleted — the gap is correct history.
      { _id: "c", idNo: "SLF-LGU-BU-0003", createdAt: "2026-03-01" },
    ],
    () => realignIdNoSequence("SLF-LGU-BU-0002"),
  );
  assert.deepEqual(result.repaired, [], "no record may be renumbered to close a gap");
  assert.equal(updates.length, 0);
});

test("re-alignment never reuses a number that is still in use", async () => {
  const { result } = await withStubbedDataSLF(
    [
      { _id: "a", idNo: "SLF-PVT-PA-0001", createdAt: "2026-01-01" },
      { _id: "b", idNo: "SLF-PVT-PA-0001", createdAt: "2026-02-01" },
      { _id: "c", idNo: "SLF-PVT-PA-0001", createdAt: "2026-03-01" },
      { _id: "d", idNo: "SLF-PVT-PA-0002", createdAt: "2026-04-01" },
      { _id: "e", idNo: "SLF-PVT-PA-0003", createdAt: "2026-05-01" },
    ],
    () => realignIdNoSequence("SLF-PVT-PA-0009"),
  );
  assert.deepEqual(
    result.repaired.map((r) => r.to),
    ["SLF-PVT-PA-0004", "SLF-PVT-PA-0005"],
    "the two later duplicates take the next FREE numbers",
  );
});

test("a malformed or missing ID No. is a no-op", async () => {
  assert.deepEqual(await realignIdNoSequence(""), { prefix: null, repaired: [] });
  assert.deepEqual(await realignIdNoSequence("NOT-AN-ID"), { prefix: null, repaired: [] });
});

test("permanent delete re-aligns; soft delete does not", () => {
  const dataSlf = readSource("dataSLF.js");
  const permanent = dataSlf.slice(
    dataSlf.indexOf('router.delete("/:id/permanent"'),
    dataSlf.indexOf('router.patch("/:id/request-revert"'),
  );
  assert.match(permanent, /await realignIdNoSequence\(entry\.idNo\)/);
  const softDelete = dataSlf.slice(
    dataSlf.indexOf('router.delete("/:id", async'),
    dataSlf.indexOf('router.get("/trash/list"'),
  );
  assert.doesNotMatch(softDelete, /realignIdNoSequence/, "a trashed record still owns its ID");
});
