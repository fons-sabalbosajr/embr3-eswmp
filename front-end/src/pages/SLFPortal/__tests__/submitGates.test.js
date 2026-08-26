/**
 * The two things that were stopping operators submitting real data.
 *
 * 1. A PLACED entry still demanded a cell per vehicle
 * ---------------------------------------------------
 * A transport entry can be placed as a whole — by an upload carrying a cell
 * column, by Assign to Cell, or by its own cell field — and every vehicle on it
 * then INHERITS that placement (cellPlacement.js → inheritEntryCell, applied on
 * save and, now, by the server's sanitizer for every other write path).
 * `validateWasteGeneration` did not know that: it looked only at each vehicle's
 * own cell, reported "Disposal Cell is required for every vehicle", and because
 * that same function drives `submitBlockers`, the Review & Submit button stayed
 * disabled on waste that was already in a cell.
 *
 * 2. One trip, several clients
 * ----------------------------
 * Operators write every client served on a trip into ONE Client cell —
 * "Limay Public Market, Wawa, Poblacion, Kitang I". All four are registered
 * clients of that hauler, but the cell was only ever compared as a SINGLE name,
 * and normalizeComparableText folds commas to spaces, so it became the one token
 * "limay public market wawa poblacion kitang i" and the submission was rejected
 * with "Client … is not assigned to hauler …".
 *
 * The hauler/client fixture below mirrors Limay's real MUNICIPAL roster.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { validateWasteGeneration } from "../wasteGenValidation.js";
import {
  splitClientCell,
  findUploadClientsForHauler,
  findUploadClientForHauler,
  getUploadRelationshipErrors,
} from "../uploadHelpers.js";

// ── 1. Cell placement ───────────────────────────────────────────────────────

const truckWith = (over = {}) => ({
  disposalTicketNo: "DT-1",
  hauler: "MUNICIPAL",
  plateNumber: "ABC-123",
  truckCapacity: 10,
  ...over,
});

const cellErrors = (trucks) =>
  validateWasteGeneration(trucks).filter((i) => i.field === "cellName");

test("a vehicle with no cell of its own is satisfied by the ENTRY's placement", () => {
  const trucks = [
    truckWith({
      cellName: "Cell 1",
      cellIndex: 0,
      vehicles: [
        { plateNumber: "ABC-123", actualVolume: 5, wasteType: "Residual" },
        { plateNumber: "ABC-124", actualVolume: 6, wasteType: "Residual" },
      ],
    }),
  ];
  assert.deepEqual(cellErrors(trucks), [], "the entry is placed; nothing more to choose");
});

test("cell index 0 counts as a placement (it is a real cell, not a missing one)", () => {
  const trucks = [
    truckWith({
      cellIndex: 0,
      vehicles: [{ plateNumber: "ABC-123", actualVolume: 5, wasteType: "Residual" }],
    }),
  ];
  assert.deepEqual(cellErrors(trucks), []);
});

test("a vehicle's OWN cell still satisfies it when the entry has none", () => {
  const trucks = [
    truckWith({
      vehicles: [
        { plateNumber: "ABC-123", actualVolume: 5, wasteType: "Residual", cellName: "Cell 2" },
      ],
    }),
  ];
  assert.deepEqual(cellErrors(trucks), []);
});

test("waste with NO cell anywhere is still blocked", () => {
  // The relaxation must not become "cells are optional" — that is the whole
  // point of the gate.
  const trucks = [
    truckWith({
      vehicles: [{ plateNumber: "ABC-123", actualVolume: 5, wasteType: "Residual" }],
    }),
  ];
  assert.equal(cellErrors(trucks).length, 1);
  assert.match(cellErrors(trucks)[0].message, /Disposal Cell is required/);
});

test("an entry with no vehicles still needs its own cell", () => {
  const trucks = [truckWith({ actualVolume: 5, wasteType: "Residual" })];
  assert.equal(cellErrors(trucks).length, 1);
});

// ── 1b. A STUB vehicle does not move the load to the vehicle level ──────────
//
// The exact shape of live reverted SLF-LGU-PA-0016: the truck records 3.1 m³ of
// Residual, and its single vehicle row carries a plate and nothing else. Because
// a vehicle ROW existed, validation took the per-vehicle branch and demanded
// volume, waste type AND a cell from the stub — so the entry could never be
// completed, and the message named the cell, which had never been the problem.

const STUB_VEHICLE_TRUCK = truckWith({
  actualVolume: 3.1,
  wasteType: "Residual",
  cellName: "Cell 2",
  cellIndex: 1,
  vehicles: [{ plateNumber: "CAY 8658" }],
});

test("a truck whose only vehicle is a stub validates at the TRUCK level", () => {
  assert.deepEqual(
    validateWasteGeneration([STUB_VEHICLE_TRUCK]),
    [],
    "the truck carries volume, waste type and a cell — nothing is missing",
  );
});

test("a stub vehicle is still a stub once the entry's cell is inherited onto it", () => {
  // Inheritance copies the cell down, and that must not promote the row to
  // load-bearing — otherwise placing a cell would re-create the demand.
  const inherited = {
    ...STUB_VEHICLE_TRUCK,
    vehicles: [{ plateNumber: "CAY 8658", cellName: "Cell 2", cellIndex: 1 }],
  };
  assert.deepEqual(validateWasteGeneration([inherited]), []);
});

test("a vehicle that DOES carry a load is still validated in full", () => {
  const real = truckWith({
    vehicles: [
      { plateNumber: "A", actualVolume: 5, wasteType: "Residual", cellName: "Cell 1" },
      { plateNumber: "B", actualVolume: 6 }, // incomplete: no waste type, no cell
    ],
  });
  const issues = validateWasteGeneration([real]);
  const fields = issues.map((i) => i.field).sort();
  assert.deepEqual(fields, ["cellName", "wasteType"], "the incomplete sibling is still caught");
  assert.equal(issues.every((i) => i.vehicleIndex === 1), true, "…and pointed at the right vehicle");
});

test("a truck with a stub vehicle and no load anywhere is still blocked", () => {
  // The relaxation must not become "a stub excuses the truck".
  const empty = truckWith({ vehicles: [{ plateNumber: "A" }] });
  const fields = validateWasteGeneration([empty]).map((i) => i.field).sort();
  assert.deepEqual(fields, ["actualVolume", "cellName", "wasteType"]);
  // Reported at the TRUCK level, where the operator can actually enter them.
  assert.equal(
    validateWasteGeneration([empty]).every((i) => i.vehicleIndex === null),
    true,
  );
});

// ── 2. Multi-client cell ────────────────────────────────────────────────────

const client = (clientName) => ({ clientName });
const MUNICIPAL = {
  haulerName: "MUNICIPAL",
  clients: [
    client("Limay Public Market"),
    client("Wawa"),
    client("Poblacion"),
    client("Kitang I"),
    client("Kitang 2/Bo. Luz"),
    client("Inactive Place"),
  ].map((c) => (c.clientName === "Inactive Place" ? { ...c, status: "inactive" } : c)),
};

test("splitClientCell reads a list, and leaves a single name alone", () => {
  assert.deepEqual(splitClientCell("Limay Public Market, Wawa, Poblacion, Kitang I"), [
    "Limay Public Market",
    "Wawa",
    "Poblacion",
    "Kitang I",
  ]);
  assert.deepEqual(splitClientCell("Limay Public Market"), ["Limay Public Market"]);
  assert.deepEqual(splitClientCell("  "), []);
  assert.deepEqual(splitClientCell("A;B"), ["A", "B"]);
});

test("every client named in one cell is bound to the row", () => {
  const { clients, split } = findUploadClientsForHauler(
    MUNICIPAL,
    "Limay Public Market, Wawa, Poblacion, Kitang I",
  );
  assert.equal(split, true);
  assert.deepEqual(
    clients.map((c) => c.clientName),
    ["Limay Public Market", "Wawa", "Poblacion", "Kitang I"],
  );
});

test("the whole cell is tried FIRST, so a comma inside one name still matches", () => {
  // "Kitang 2/Bo. Luz" is one registered client. Splitting first would break it.
  const { clients, split } = findUploadClientsForHauler(MUNICIPAL, "Kitang 2/Bo. Luz");
  assert.equal(split, undefined, "matched whole, never split");
  assert.deepEqual(clients.map((c) => c.clientName), ["Kitang 2/Bo. Luz"]);
});

test("a list is rejected unless EVERY part is a registered client", () => {
  // Dropping the part that did not resolve would file that client's waste under
  // the others, so a partial match is a rejection.
  const { clients } = findUploadClientsForHauler(
    MUNICIPAL,
    "Limay Public Market, Somebody Else Entirely",
  );
  assert.deepEqual(clients, []);
});

test("an unknown single client is still rejected", () => {
  assert.deepEqual(findUploadClientsForHauler(MUNICIPAL, "Totally Unknown").clients, []);
});

test("an inactive client is reported as inactive, not as unassigned", () => {
  const { clients, single } = findUploadClientsForHauler(MUNICIPAL, "Inactive Place");
  assert.deepEqual(clients, []);
  assert.equal(single?.inactiveOnly, true);
});

test("the row-level error reporting keeps its existing wording", () => {
  const row = { _rowNumber: 3, hauler: "MUNICIPAL", client: "Totally Unknown" };
  assert.deepEqual(getUploadRelationshipErrors(row, [MUNICIPAL]), [
    'Row 3 — Client "Totally Unknown" is not assigned to hauler "MUNICIPAL" under this SLF.',
  ]);
  assert.deepEqual(
    getUploadRelationshipErrors(
      { _rowNumber: 4, hauler: "MUNICIPAL", client: "Inactive Place" },
      [MUNICIPAL],
    ),
    ['Row 4 — Client "Inactive Place" is inactive for hauler "MUNICIPAL" under this SLF.'],
  );
});

test("the multi-client row passes the relationship check that used to block it", () => {
  const row = {
    _rowNumber: 1,
    hauler: "MUNICIPAL",
    client: "Limay Public Market, Wawa, Poblacion, Kitang I",
  };
  assert.deepEqual(getUploadRelationshipErrors(row, [MUNICIPAL]), []);
});

test("findUploadClientForHauler keeps its single-client contract", () => {
  // Still exported and unchanged — the split logic is layered on top of it.
  assert.equal(findUploadClientForHauler(MUNICIPAL, "Wawa").clientName, "Wawa");
  assert.equal(findUploadClientForHauler(MUNICIPAL, "Nope"), null);
});
