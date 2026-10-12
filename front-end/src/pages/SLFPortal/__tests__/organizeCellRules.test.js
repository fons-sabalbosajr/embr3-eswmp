/**
 * Organize Cell Placement — the rulings.
 *
 * Pins: placed waste never appears as placement work; waste type must fit the
 * cell (no "any open cell" fallback); capacity counts what this session already
 * chose; bulk assign and auto-place only write rows a cell can legally take.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  wasteFitsCell,
  splitOrganizerWork,
  plannedM3ByCell,
  cellChoicesFor,
  applyCellToRows,
  autoPlace,
  organizerProgress,
  placementKey,
} from "../organizeCellRules.js";

const cell = (cellIndex, cellType, remainingM3) => ({ value: `Cell ${cellIndex + 1}`, cellIndex, cellType, remainingM3, cellName: `Cell ${cellIndex + 1}` });
const toPatch = (o) => ({ cellName: o.value, cellIndex: o.cellIndex, cellType: o.cellType });
const row = (truckIndex, extra = {}) => ({ truckIndex, vehicleIndex: null, wasteType: "Residual", actualVolume: 10, actualVolumeUnit: "m³", needsCell: true, needsCapacity: false, ...extra });

test("REGRESSION — waste that already has a cell is never placement work", () => {
  const data = [
    { _id: "A", placements: [row(0), row(1, { needsCell: false, needsCapacity: true, cellName: "Cell 1", cellIndex: 0 })] },
    // Live: 30 of 44 organizer submissions had ONLY this kind of row.
    { _id: "B", placements: [row(0, { needsCell: false, needsCapacity: true, cellName: "Cell 2", cellIndex: 1 })] },
  ];
  const { placementSubs, capacityRows } = splitOrganizerWork(data);
  assert.deepEqual(placementSubs.map((s) => [s._id, s.placements.length]), [["A", 1]]);
  assert.equal(capacityRows.length, 2, "they are still offered — for their capacity only");
  assert.ok(capacityRows.every((r) => r.placement.needsCell === false));
});

test("waste type must fit the cell — both directions", () => {
  assert.equal(wasteFitsCell("Residual", "Residual"), true);
  assert.equal(wasteFitsCell("Treated Hazardous Waste", "Treated Haz Waste"), true);
  assert.equal(wasteFitsCell("Hazardous Waste", "Residual"), false);
  assert.equal(wasteFitsCell("Residual", "Treated Haz Waste"), false);
  assert.equal(wasteFitsCell("Residual", undefined), true, "an untyped cell is residual");
});

test("REGRESSION — no fallback to an incompatible cell when no matching cell is open", () => {
  const choices = cellChoicesFor(row(0, { wasteType: "Treated Hazardous Waste" }), [cell(0, "Residual", 100)]);
  assert.deepEqual(choices, [], "a hazardous load is offered nothing rather than a residual cell");
});

test("REGRESSION — capacity counts what this session already chose", () => {
  const options = [cell(0, "Residual", 15)];
  const data = [{ _id: "A", placements: [row(0, { cellName: "Cell 1", cellIndex: 0 }), row(1)] }];
  // The first 10 m³ is already chosen for Cell 1, leaving 5 for the second 10 m³ load.
  const planned = plannedM3ByCell(data, placementKey("A", data[0].placements[1]));
  const [choice] = cellChoicesFor(data[0].placements[1], options, planned);
  assert.equal(choice.fits, false);
  assert.equal(choice.room, 5);
});

test("a row is never counted against itself", () => {
  const options = [cell(0, "Residual", 10)];
  const data = [{ _id: "A", placements: [row(0, { cellName: "Cell 1", cellIndex: 0 })] }];
  const p = data[0].placements[0];
  const [choice] = cellChoicesFor(p, options, plannedM3ByCell(data, placementKey("A", p)));
  assert.equal(choice.fits, true, "its own 10 m³ in a 10 m³ cell still fits");
});

test("bulk assign skips the rows the cell cannot take, and says why", () => {
  const data = [{
    _id: "A",
    placements: [row(0), row(1), row(2, { wasteType: "Hazardous Waste" }), row(3)],
  }];
  const keys = data[0].placements.map((p) => placementKey("A", p));
  const res = applyCellToRows(data, keys, cell(0, "Residual", 25), toPatch);
  assert.equal(res.applied, 2, "two 10 m³ loads fit in 25 m³");
  assert.deepEqual(res.skipped, { type: 1, capacity: 1 });
  assert.equal(res.data[0].placements[2].cellName, undefined, "the hazardous load was not placed in a residual cell");
});

test("auto-place uses the compatible cell with the most room, largest loads first", () => {
  const options = [cell(0, "Residual", 30), cell(1, "Residual", 12), cell(2, "Treated Haz Waste", 50)];
  const data = [{
    _id: "A",
    placements: [
      row(0, { actualVolume: 20 }),
      row(1, { actualVolume: 10 }),
      row(2, { actualVolume: 15 }),
      row(3, { wasteType: "Treated Hazardous Waste", actualVolume: 5 }),
      row(4, { actualVolume: 40 }), // fits nowhere
    ],
  }];
  const res = autoPlace(data, options, toPatch);
  const cells = res.data[0].placements.map((p) => p.cellIndex ?? null);
  // Largest first: 40 fits nowhere; 20 → Cell 1 (most room, 30 → 10 left);
  // 15 then fits neither (10 and 12 left); 10 → Cell 2 (12 > 10).
  assert.deepEqual(cells, [0, 1, null, 2, null]);
  assert.equal(res.unplaceable, 2, "the 40 and the 15 are left for a person");
  const used = (idx) => res.data[0].placements.filter((p) => p.cellIndex === idx).reduce((s, p) => s + p.actualVolume, 0);
  assert.ok(used(0) <= 30 && used(1) <= 12, "no cell is over-filled by auto-place");
});

test("auto-place never touches a row that already has a cell", () => {
  const data = [{ _id: "A", placements: [row(0, { cellName: "Cell 2", cellIndex: 1 })] }];
  const res = autoPlace(data, [cell(0, "Residual", 100), cell(1, "Residual", 100)], toPatch);
  assert.equal(res.data[0].placements[0].cellIndex, 1);
  assert.equal(res.placed, 0);
});

test("progress counts placement and capacity work separately", () => {
  const data = [{
    _id: "A",
    placements: [
      row(0, { cellName: "Cell 1", cellIndex: 0 }),
      row(1),
      row(2, { needsCell: false, needsCapacity: true, capacity: 12 }),
      row(3, { needsCell: false, needsCapacity: true }),
    ],
  }];
  assert.deepEqual(organizerProgress(data), { toPlace: 2, placed: 1, capacityNeeded: 2, capacityFilled: 1 });
});
