/**
 * A BASELINE UPDATE IS NOT A SUBMISSION.
 *
 * PATCH /portal-save-baseline has to give its baseline-only container a
 * `dateOfDisposal` — the field is required by the schema — so it stamps the save
 * time. Every reader that treats "has a dateOfDisposal" as "is a disposal" then
 * shows a baseline save as a submission on the day it was saved. That is exactly
 * what put phantom records on the Admin → Main Dashboard → SLF Operators
 * Disposal Submission Calendar and phantom rows in the Submission Tracker.
 *
 * These tests pin the classification at the source: the containers that a
 * baseline save writes, and the queries every submission reader must apply.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const DataSLF = require("../models/DataSLF");
const { SUBMISSION_HAS_TRUCKS } = require("../routes/dataSLF");

const readSource = (file) => fs.readFileSync(path.join(__dirname, "..", "routes", file), "utf8");
const dataSlf = readSource("dataSLF.js");
const sliceRoute = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start > -1, `route not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `end marker not found after ${startMarker}`);
  return source.slice(start, end);
};

// ── What the baseline save actually writes ──────────────────────────────────
test("a baseline container carries a save-time dateOfDisposal and no trucks", () => {
  const handler = sliceRoute(
    dataSlf,
    'router.patch("/portal-save-baseline/:slfName"',
    'router.post("/baseline-update-request"',
  );
  // This is the line that makes the container LOOK like a disposal.
  assert.match(handler, /dateOfDisposal: new Date\(\)/);
  // …and it is why "has a date" can never be the submission test.
  const container = new DataSLF({
    dateOfDisposal: new Date("2026-08-14"),
    lguCompanyName: "Demonstration Valley",
    companyType: "Private",
    totalVolumeAccepted: 1500,
  });
  assert.equal(container.trucks.length, 0);
  assert.ok(container.dateOfDisposal, "the container is dated, which is the whole problem");
});

test("a baseline save creates no submission and emits no submission refresh", () => {
  const handler = sliceRoute(
    dataSlf,
    'router.patch("/portal-save-baseline/:slfName"',
    'router.post("/baseline-update-request"',
  );
  // The audit record is KEPT — it is classified as a baseline_update
  // transaction, which is a different thing from a submission.
  assert.match(handler, /type: "baseline_update"/);
  // It must not masquerade as one.
  assert.doesNotMatch(handler, /type: "submission"/);
  // Refresh/invalidation is targeted at baselines, not submissions.
  assert.match(handler, /refreshAdmin\(req, "baselines"\)/);
  assert.doesNotMatch(handler, /refreshAdmin\(req, "submissions"\)/);
});

// ── The calendar ────────────────────────────────────────────────────────────
test("the Disposal Submission Calendar returns submissions only", () => {
  const route = sliceRoute(
    dataSlf,
    'router.get("/disposal-calendar"',
    'const adminSubmissionsCacheKey',
  );
  assert.match(
    route,
    /\.\.\.SUBMISSION_HAS_TRUCKS,/,
    "without this a baseline save appears on the calendar as a disposal",
  );
  assert.deepEqual(SUBMISSION_HAS_TRUCKS, { "trucks.0": { $exists: true } });
  // Filtering is done in the QUERY, not handed to the client to sort out.
  assert.match(route, /const records = await DataSLF\.find\(match\)/);
  // The event date is the disposal date, not createdAt/updatedAt.
  assert.match(route, /\.sort\(\{ dateOfDisposal: -1, createdAt: -1 \}\)/);
  // Reverted / revert-requested records are not active disposal activity.
  assert.match(route, /status: \{ \$nin: \["reverted", "revert_requested"\] \}/);
  // The identifiers the calendar renders and groups on all travel with it.
  ["idNo", "submissionId", "previousIdNos", "slfGenerator", "dateOfDisposal", "status"].forEach(
    (field) => assert.ok(route.includes(field), `calendar payload must carry ${field}`),
  );
});

test("every submission reader on the dashboard applies the same rule", () => {
  // The calendar, the SLF map marker, the dashboard counts and the admin list —
  // one rule, applied in four places. A reader added without it is the bug.
  const readers = [
    ['router.get("/disposal-calendar"', "const adminSubmissionsCacheKey"],
    ['router.get("/today-status"', 'router.get("/stats"'],
    ['router.get("/stats"', 'router.get("/generator-summary"'],
    ['router.get("/", optionalAuth', 'router.get("/detail/:id"'],
  ];
  readers.forEach(([start, end]) => {
    assert.match(
      sliceRoute(dataSlf, start, end),
      /SUBMISSION_HAS_TRUCKS/,
      `${start} must exclude baseline containers`,
    );
  });
});

// ── The tracker ─────────────────────────────────────────────────────────────
test("the admin Submission Tracker lists a portal user's submissions only", () => {
  const portalUsers = readSource("portalUsers.js");
  const route = sliceRoute(
    portalUsers,
    'router.get("/:id/submission-history"',
    'router.post("/:id/send-email"',
  );
  assert.match(route, /"trucks\.0": \{ \$exists: true \}/, "baseline containers are not submissions");
  assert.match(route, /deletedAt: null/, "a deleted record is not in the live tracker");
});

// ── One submission ≠ one document ───────────────────────────────────────────
test("a multi-entry submit shares ONE submissionId across its documents", () => {
  const helper = sliceRoute(dataSlf, "async function submitEntries", 'router.post("/", optionalAuth');
  // One id minted per REQUEST…
  assert.match(helper, /const submissionId = `SUB-\$\{Date\.now\(\)\}/);
  // …and stamped on every entry that request saves, which is why the calendar
  // groups on it instead of counting rows.
  assert.ok(
    (helper.match(/\n\s+submissionId,/g) || []).length >= 1,
    "each saved entry carries the request's submissionId",
  );
});

test("the calendar counts submission EVENTS, not documents", () => {
  const calendar = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "DisposalActivityCalendar.jsx"),
    "utf8",
  );
  assert.match(calendar, /const submissionKeyOf = \(record\) =>[\s\S]*?record\?\.submissionId/);
  assert.match(calendar, /d\.submissionCount = dayBuckets\.length;/);
  // The month grid uses the same grouping as the day cells.
  assert.match(calendar, /groupBySubmission\(filteredRecords\)\.forEach/);
});
