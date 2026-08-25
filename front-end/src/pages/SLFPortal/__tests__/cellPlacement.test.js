/**
 * Disposal cell placement — entry ⇄ vehicle inheritance.
 *
 * The rule exists because the two levels disagree about who owns a placement:
 * an entry can be placed as a whole ("Assign to Cell"), but the server reads
 * placement from EACH VEHICLE and ignores the entry's cell when vehicles are
 * present. So relaxing the front-end check alone would let a submission through
 * that the server then counts as unplaced — the operator would be sent to
 * Organize Cells for an entry they had already placed.
 *
 * These tests pin that the placement is made REAL (inherited onto each vehicle)
 * rather than merely assumed, and that inheritance never touches the per-vehicle
 * figures, which would double-count an entry's waste.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  entryCellOf,
  hasCellPlacement,
  inheritEntryCell,
  vehicleNeedsCell,
} from "../cellPlacement.js";

const PLACED_ENTRY = { cellName: "Cell 4", cellType: "Residual", cellIndex: 3 };

test("a placement is a name or a canonical index, and blank is neither", () => {
  assert.equal(hasCellPlacement({ cellName: "Cell 4" }), true);
  assert.equal(hasCellPlacement({ cellIndex: 0 }), true, "index 0 is a real cell");
  assert.equal(hasCellPlacement({ cellName: "   " }), false);
  assert.equal(hasCellPlacement({ cellIndex: null }), false);
  assert.equal(hasCellPlacement({}), false);
});

test("every vehicle without a cell inherits the entry's", () => {
  const vehicles = [
    { plateNumber: "AAA 111", actualVolume: 5 },
    { plateNumber: "BBB 222", actualVolume: 7 },
  ];
  const out = inheritEntryCell(vehicles, PLACED_ENTRY);
  out.forEach((vehicle) => {
    assert.equal(vehicle.cellName, "Cell 4");
    assert.equal(vehicle.cellIndex, 3);
    assert.equal(vehicle.cellType, "Residual");
  });
});

test("a vehicle with its OWN cell is left alone", () => {
  const out = inheritEntryCell(
    [{ plateNumber: "AAA 111", cellName: "Cell 6", cellIndex: 5, cellType: "Treated Hazardous Waste" }],
    PLACED_ENTRY,
  );
  assert.equal(out[0].cellName, "Cell 6", "the entry must not overwrite a real per-vehicle placement");
  assert.equal(out[0].cellIndex, 5);
});

test("inheritance carries the CELL only, never the volume or waste type", () => {
  // Copying an entry's volume onto each vehicle is how one trip's waste gets
  // counted twice.
  const entry = { ...PLACED_ENTRY, actualVolume: 12, wasteType: "Residual", hazWasteCode: ["K301"] };
  const out = inheritEntryCell([{ plateNumber: "AAA 111" }], entry);
  assert.equal(out[0].actualVolume, undefined);
  assert.equal(out[0].wasteType, undefined);
  assert.equal(out[0].hazWasteCode, undefined);
});

test("an unplaced entry changes nothing", () => {
  const vehicles = [{ plateNumber: "AAA 111" }];
  const out = inheritEntryCell(vehicles, { cellName: "", cellIndex: null });
  assert.deepEqual(out, [{ plateNumber: "AAA 111" }]);
});

test("nothing is mutated in place", () => {
  const vehicles = [{ plateNumber: "AAA 111" }];
  const before = JSON.stringify(vehicles);
  inheritEntryCell(vehicles, PLACED_ENTRY);
  assert.equal(JSON.stringify(vehicles), before);
});

test("entryCellOf normalizes what it copies", () => {
  assert.deepEqual(entryCellOf({ cellName: "  Cell 2  ", cellType: " Residual ", cellIndex: 1 }), {
    cellName: "Cell 2",
    cellType: "Residual",
    cellIndex: 1,
  });
  assert.deepEqual(entryCellOf({}), { cellName: "", cellType: "", cellIndex: null });
});

// ── What the operator is asked for ───────────────────────────────────────────

test("a cell is demanded only when neither the vehicle nor the entry has one", () => {
  const bare = { plateNumber: "AAA 111" };
  assert.equal(vehicleNeedsCell(bare, {}, 3), true, "nothing placed → ask");
  assert.equal(vehicleNeedsCell(bare, PLACED_ENTRY, 3), false, "entry placed → do not ask again");
  assert.equal(vehicleNeedsCell({ cellName: "Cell 1" }, {}, 3), false, "vehicle placed → do not ask");
});

test("a facility with no cell that can accept waste is never blocked on choosing one", () => {
  // There is nothing to choose; blocking here would strand the operator.
  assert.equal(vehicleNeedsCell({ plateNumber: "AAA 111" }, {}, 0), false);
});
