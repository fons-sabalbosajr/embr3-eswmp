/**
 * Backlog upload (utils/backlogEntries.js): one entry whose trucks span several
 * disposal dates becomes one entry per date, inside a one-month window.
 *
 * Run: node --test tests/backlogEntries.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  dayKey,
  oneMonthBefore,
  backlogWindow,
  splitEntryByDisposalDate,
  expandBacklogEntries,
} = require("../utils/backlogEntries");

// Nov 24, 2026, 10:00 in Manila.
const NOW = new Date("2026-11-24T02:00:00Z");

const entry = (dates, extra = {}) => ({
  slfName: "Demo SLF",
  dateOfDisposal: "2026-11-23",
  totalVolumeAccepted: 1000,
  trucks: dates.map((d, i) => ({ disposalTicketNo: `T-${i}`, disposalDate: d, actualVolume: 10 + i })),
  ...extra,
});

test("dates are read as Manila calendar days", () => {
  assert.equal(dayKey("2026-11-01"), "2026-11-01");
  // 4 PM UTC on Oct 31 is already Nov 1 in Manila.
  assert.equal(dayKey("2026-10-31T16:30:00Z"), "2026-11-01");
  assert.equal(dayKey(""), "");
  assert.equal(dayKey("not a date"), "");
});

test("one month back keeps the day, clamped to the month's length", () => {
  assert.equal(oneMonthBefore("2026-11-24"), "2026-10-24");
  assert.equal(oneMonthBefore("2026-03-31"), "2026-02-28");
  assert.equal(oneMonthBefore("2028-03-31"), "2028-02-29");
  assert.equal(oneMonthBefore("2026-01-15"), "2025-12-15");
  assert.deepEqual(backlogWindow(NOW), { from: "2026-10-24", to: "2026-11-24" });
});

test("a single-date entry is left exactly as it is", () => {
  const one = entry(["2026-11-23", "2026-11-23"]);
  const { entries, backlog } = splitEntryByDisposalDate(one);
  assert.equal(backlog, false);
  assert.equal(entries[0], one);
});

test("trucks without their own date belong to the entry's Date of Disposal", () => {
  const mixed = entry(["", "2026-11-23"]);
  assert.equal(splitEntryByDisposalDate(mixed).backlog, false);
});

test("a backlog becomes one entry per day, oldest first, each with its own trucks", () => {
  const multi = entry(["2026-11-02", "2026-10-30", "2026-11-02", "2026-10-31"]);
  const { entries, backlog } = splitEntryByDisposalDate(multi);
  assert.equal(backlog, true);
  assert.deepEqual(entries.map((e) => e.dateOfDisposal), ["2026-10-30", "2026-10-31", "2026-11-02"]);
  assert.deepEqual(entries.map((e) => e.trucks.length), [1, 1, 2]);
  assert.equal(entries[0].totalVolumeAccepted, 1000, "every day keeps the entry's baseline fields");
  assert.equal(entries[2].trucks.every((t) => t.disposalDate === "2026-11-02"), true);
});

test("a backlog inside the window passes and is expanded", () => {
  const out = expandBacklogEntries([entry(["2026-10-24", "2026-11-24"])], { now: NOW });
  assert.deepEqual(out.errors, []);
  assert.equal(out.items.length, 2);
  assert.equal(out.backlogDays, 2);
});

test("future dates and dates older than one month are refused", () => {
  const future = expandBacklogEntries([entry(["2026-11-20", "2026-11-25"])], { now: NOW });
  assert.match(future.errors.join(" "), /Future disposal dates cannot be submitted: Nov 25, 2026/);
  const old = expandBacklogEntries([entry(["2026-10-23", "2026-11-20"])], { now: NOW });
  assert.match(old.errors.join(" "), /go back one month \(to Oct 24, 2026\).*Oct 23, 2026/);
});

test("ordinary submissions are not subject to the backlog window", () => {
  const out = expandBacklogEntries([entry(["2025-01-05"], { dateOfDisposal: "2025-01-05" })], { now: NOW });
  assert.deepEqual(out.errors, []);
  assert.equal(out.items.length, 1);
});

test("submitEntries expands backlogs before validating and saving", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const at = source.indexOf("async function runSubmitEntries");
  const body = source.slice(at, at + 6000);
  assert.match(body, /const backlog = expandBacklogEntries\(received\)/);
  assert.match(body, /error\.code = "BACKLOG_WINDOW"/);
  assert.ok(body.indexOf("expandBacklogEntries") < body.indexOf("sanitizeSubmissionEntry"));
});

test("the cell-capacity gate counts every load of one request together", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  assert.match(source, /const committedCellM3 = new Map\(\);/);
  assert.match(source, /evaluateFacilityCellAcceptance\(\s*facCells,\s*ci,\s*vol \+ committedInUnit,/);
  assert.match(source, /committedCellM3\.set\(cellKey, committedM3 \+/);
});
