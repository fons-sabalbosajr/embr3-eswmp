/**
 * Cell Infrastructure Overview — a gauge's colour follows the cell's STATUS.
 *
 * The defect this pins: every non-active cell (Used/Completed, Closed, Reserved,
 * Under Construction) was drawn in one muted grey, so a full completed cell
 * looked like an empty reserved one. Status decides first; only an ACTIVE cell
 * is coloured by how full it is.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveCellGaugeState, CELL_GAUGE_STATE_LIST } from "../../utils/cellVisuals.js";

test("non-active statuses keep their own colour whatever the cell holds", () => {
  for (const pct of [0, 45, 100]) {
    assert.equal(resolveCellGaugeState("Used/Completed", pct).key, "completed");
    assert.equal(resolveCellGaugeState("Closed", pct).key, "closed");
    assert.equal(resolveCellGaugeState("Reserved Area", pct).key, "reserved");
    assert.equal(resolveCellGaugeState("Under Construction", pct).key, "construction");
  }
});

test("an active cell is coloured by fullness", () => {
  assert.equal(resolveCellGaugeState("Active Cell", 10).key, "normal");
  assert.equal(resolveCellGaugeState("Active Cell", 75).key, "nearFull");
  assert.equal(resolveCellGaugeState("Active Cell", 95).key, "full");
  assert.equal(resolveCellGaugeState("Active Cell", 120).key, "over");
  assert.equal(resolveCellGaugeState("Active Cell", null).key, "noData");
});

test("every state the legend lists has a distinct colour", () => {
  const colors = CELL_GAUGE_STATE_LIST.map((s) => s.color);
  assert.equal(new Set(colors).size, colors.length);
});
