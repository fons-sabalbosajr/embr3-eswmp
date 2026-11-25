/**
 * Backlog upload rules in the portal (backlogUpload.js) — the same window the
 * server enforces in server/utils/backlogEntries.js.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBacklogRules,
  backlogWindow,
  distinctDays,
  oneMonthBefore,
  summarizeBacklog,
} from "../backlogUpload.js";

// Nov 24, 2026 (browser-local).
const NOW = new Date(2026, 10, 24, 10, 0, 0);

const row = (disposalDate, extra = {}) => ({ key: disposalDate + Math.random(), disposalDate, _errors: [], ...extra });

test("the window is one calendar month back to today", () => {
  assert.deepEqual(backlogWindow(NOW), { from: "2026-10-24", to: "2026-11-24" });
  assert.equal(oneMonthBefore("2026-03-31"), "2026-02-28");
  assert.equal(oneMonthBefore("2026-01-10"), "2025-12-10");
});

test("a single-date file is never subject to the backlog window", () => {
  const rows = [row("2025-01-05"), row("2025-01-05")];
  assert.equal(applyBacklogRules(rows, { now: NOW }), rows);
});

test("in a backlog, future and too-old dates become row errors", () => {
  const rows = [row("2026-10-24"), row("2026-11-24"), row("2026-11-25"), row("2026-10-23")];
  const checked = applyBacklogRules(rows, { now: NOW });
  assert.deepEqual(checked.map((r) => r._errors.length), [0, 0, 1, 1]);
  assert.match(checked[2]._errors[0], /Nov 25, 2026 is in the future/);
  assert.match(checked[3]._errors[0], /more than one month ago .* back to Oct 24, 2026/);
  assert.equal(rows[2]._errors.length, 0, "the stored rows are not mutated");
});

test("distinct days fall back to the form date for trucks without one", () => {
  assert.deepEqual(distinctDays([{ disposalDate: "2026-11-02" }, {}, { disposalDate: "2026-11-01" }], "2026-11-03"), [
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
  ]);
});

test("summary: one line per day with its entries and volume", () => {
  const trucks = [
    { disposalDate: "2026-11-01", actualVolume: 10 },
    { disposalDate: "2026-11-01", vehicles: [{ actualVolume: 4 }, { actualVolume: 6 }] },
    { disposalDate: "2026-11-02", actualVolume: 5 },
  ];
  const summary = summarizeBacklog(trucks, "", { now: NOW });
  assert.equal(summary.from, "2026-11-01");
  assert.equal(summary.to, "2026-11-02");
  assert.deepEqual(summary.days, [
    { day: "2026-11-01", trucks: 2, volume: 20 },
    { day: "2026-11-02", trucks: 1, volume: 5 },
  ]);
  assert.deepEqual(summary.outOfWindow, []);
  assert.equal(summarizeBacklog([{ disposalDate: "2026-11-01" }], "", { now: NOW }), null, "one day is not a backlog");
});
