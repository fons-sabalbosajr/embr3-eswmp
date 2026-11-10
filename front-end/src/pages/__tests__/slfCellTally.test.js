/**
 * SLF Data Table: each cell's Waste in Cell is shown as two parts that add up,
 * and the edit form only declares the cells an admin actually set.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { cellTally, facilityTally, declaredCellFills } from "../admin/slf-monitoring/cellTally.js";

test("a derived cell is baseline + submitted", () => {
  const t = cellTally({ baseline: 9663.63, submissions: 11727.61, total: 21391.24 });
  assert.equal(t.declared, false);
  assert.ok(Math.abs(t.baseline + t.submitted - t.total) < 1e-6);
});

test("an admin-declared cell is its declared base + what was submitted since", () => {
  // Limay on production: declared 19,789.66 m³, total 21,391.24 m³.
  const t = cellTally({
    baseline: 9663.63,
    submissions: 22707.2,
    total: 21391.237,
    overridden: true,
    overrideBase: 19789.66,
    postOverrideSubmitted: 1601.577,
  });
  assert.equal(t.declared, true);
  assert.equal(t.baseline, 19789.66, "the declared base, not the raw baseline");
  assert.equal(t.submitted, 1601.577, "only what arrived after the declaration");
  assert.ok(Math.abs(t.baseline + t.submitted - t.total) < 1e-6, "the two parts add up to the figure shown");
});

test("an undated (replace-forever) declaration is the whole figure", () => {
  const t = cellTally({ baseline: 31.5, submissions: 0, total: 9, overridden: true });
  assert.equal(t.baseline, 9);
  assert.equal(t.submitted, 0);
});

test("facility totals use the same parts and report unplaced waste separately", () => {
  const rows = [
    { baseline: 100, submissions: 20, total: 120 },
    { overridden: true, overrideBase: 500, postOverrideSubmitted: 5, total: 505, baseline: 1, submissions: 999 },
  ];
  const t = facilityTally(rows, 7);
  assert.equal(t.baseline, 600);
  assert.equal(t.submitted, 25);
  assert.equal(t.inCells, 625);
  assert.equal(t.baseline + t.submitted, t.inCells, "baseline + submissions = waste in cells");
  assert.equal(t.unplaced, 7);
  assert.equal(t.received, 632);
  assert.equal(t.declaredCells, 1);
});

test("an untouched form declares nothing", () => {
  const loaded = { values: [21391.237, 4194.71, null], overridden: [false, false, false] };
  assert.deepEqual(declaredCellFills([21391.237, 4194.71, null], loaded), [null, null, null]);
});

test("only the cell the admin changed becomes a declaration", () => {
  const loaded = { values: [100, 200], overridden: [false, false] };
  assert.deepEqual(declaredCellFills([100, 250], loaded), [null, 250]);
});

test("an existing declaration is kept, changed or cleared by its field", () => {
  const loaded = { values: [505, 200], overridden: [true, false] };
  assert.deepEqual(declaredCellFills([505, 200], loaded), [505, null], "re-sent unchanged keeps it");
  assert.deepEqual(declaredCellFills([600, 200], loaded), [600, null], "a new figure replaces it");
  assert.deepEqual(declaredCellFills([null, 200], loaded), [null, null], "a blank field clears it");
});

test("a new facility declares whatever is typed", () => {
  assert.deepEqual(declaredCellFills([10, null], { values: [], overridden: [] }), [10, null]);
});
