/**
 * Occupancy calc v6 — Waste in Cell = baseline + APPROVED submissions.
 *
 * Pins the parts of the rule not covered by the lifecycle/override suites:
 *   • closed-cell baseline entries are placed in THEIR cells (they were never
 *     counted, so a Used/Completed cell always read 0 — General Tinio Cell 3);
 *   • a baseline row binds by its stored cellIndex, not by parsing its name
 *     ("Treated Hazardous Waste Cell (M501)" parsed as cell 501);
 *   • the unit is the facility's DECLARED unit, not the first truck's.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { computeCellOccupancy, CELL_FILL_STATUSES, OCCUPANCY_CALC_VERSION } = require("../utils/cellOccupancy");

const FACILITY = {
  numberOfCell: 3,
  cellNames: ["Cell 1", "Treated Hazardous Waste Cell (M501)", "Cell 3"],
  cellStatuses: ["Active Cell", "Active Cell", "Used/Completed"],
  cellTypes: ["Residual", "Treated Haz Waste", "Residual"],
  cellCapacities: [1000, 1000, 1000],
  cellCapacityUnits: ["m³", "m³", "m³"],
  volumeCapacityUnit: "m³",
  wasteReceivedUnit: "tons", // written by an older recompute — must not win
};

const baseline = (active = [], closed = []) => ({
  _id: "baseline",
  baselineUnit: "m³",
  trucks: [],
  activeCellEntries: active,
  closedCellEntries: closed,
});

test("closed-cell baseline entries land in their own cells", () => {
  const occ = computeCellOccupancy(FACILITY, [
    baseline(
      [{ cellIndex: 0, cellName: "Cell 1", volume: 100, unit: "m³" }],
      [{ cellIndex: 2, cellName: "Cell 3", volume: 900, unit: "m³" }],
    ),
  ]);
  assert.equal(occ.rows[2].baseline, 900, "the Used/Completed cell holds its baseline");
  assert.equal(occ.rows[0].baseline, 100);
  assert.equal(occ.baselineTotal, 1000);
});

test("a closed entry that names no real cell is never guessed into an open one", () => {
  const occ = computeCellOccupancy(FACILITY, [
    baseline([], [{ cellName: "Cell 9", volume: 50, unit: "m³" }]),
  ]);
  assert.equal(occ.rows.reduce((s, r) => s + r.total, 0), 0);
  assert.equal(occ.unplacedBaselineTotal, 50, "reported, not attributed");
});

test("a baseline row binds by its stored cellIndex, not by parsing its name", () => {
  const occ = computeCellOccupancy(FACILITY, [
    baseline([{ cellIndex: 1, cellName: "Treated Hazardous Waste Cell (M501)", wasteType: "Inert/Hazardous Waste", volume: 40, unit: "m³" }]),
  ]);
  assert.equal(occ.rows[1].baseline, 40);
});

test("the occupancy unit is the facility's DECLARED unit, not the first truck's", () => {
  const occ = computeCellOccupancy(FACILITY, [
    baseline([{ cellIndex: 0, volume: 100, unit: "m³" }]),
    { _id: "s", status: "acknowledged", baselineUnit: "tons", trucks: [{ actualVolume: 5, actualVolumeUnit: "tons", cellIndex: 0 }] },
  ]);
  assert.equal(occ.unit, "m³", "capacity units outrank the recompute-written wasteReceivedUnit");
  assert.equal(occ.rows[0].total, 110, "100 m³ + 5 t (= 10 m³)");
});

test("the formula's statuses and the recompute version are pinned", () => {
  assert.deepEqual([...CELL_FILL_STATUSES].sort(), ["acknowledged", "approved", "revert_requested"]);
  assert.ok(OCCUPANCY_CALC_VERSION >= 6, "stored figures must be recomputed under the new rule");
});
