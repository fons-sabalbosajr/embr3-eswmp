/**
 * Preview Uploaded Data — cell assignment and preview editing.
 *
 * The rules under test are the ones that decide what the FINAL IMPORT carries:
 * how an uploaded/edited cell label resolves to the facility's canonical
 * `cellIndex`, and whether an edited value is re-validated. `updateUploadCell`
 * itself is a setState wrapper in index.jsx; its decision logic is these
 * helpers, applied here in the same order.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveUploadCell,
  getUploadRowErrors,
  getUploadRelationshipErrors,
} from "../uploadHelpers.js";

// Demo facility (seeds/seedDemoAccounts.js): Cell 1 Used/Completed and Cell 5
// Under Construction are NOT offered; 2, 3 and 4 are.
const ACTIVE_CELL_OPTIONS = [
  { value: "Cell 2", cellName: "Cell 2", label: "Cell 2 - Residual", cellIndex: 1, cellType: "Residual" },
  { value: "Cell 3", cellName: "Cell 3", label: "Cell 3 - Residual", cellIndex: 2, cellType: "Residual" },
  { value: "Cell 4", cellName: "Cell 4", label: "Cell 4 - Treated Haz Waste", cellIndex: 3, cellType: "Treated Haz Waste" },
];

const HAULERS = [
  {
    haulerName: "TEST HAULER 001",
    privateSectorClients: [{ clientName: "TEST CLIENT 001", clientType: "Private" }],
    vehicles: [{ plateNumber: "TST-0001", selectedClients: [{ clientName: "TEST CLIENT 001" }] }],
  },
];

// The rule updateUploadCell applies: patch the field, re-resolve the cell when
// the cell changed, then recompute every error from the EDITED row.
const applyPreviewEdit = (row, field, value) => {
  const cellPatch = field === "cellName" ? resolveUploadCell(ACTIVE_CELL_OPTIONS, value) : null;
  const updated = { ...row, [field]: value, ...(cellPatch || {}) };
  const relationshipErrors = getUploadRelationshipErrors(updated, HAULERS);
  const cellKnown = !updated.cellName || updated.cellIndex != null;
  return {
    ...updated,
    _errors: [
      ...getUploadRowErrors(updated, "truck"),
      ...relationshipErrors,
      ...(cellKnown
        ? []
        : [`Row ${updated._rowNumber} — Cell or Disposal Area "${updated.cellName}" is not an available cell under this SLF.`]),
    ],
  };
};

const uploadedRow = () => ({
  _rowNumber: 2,
  disposalDate: "2026-08-13",
  disposalTicketNo: "TEST-DT-0001",
  hauler: "TEST HAULER 001",
  client: "TEST CLIENT 001",
  plateNumber: "TST-0001",
  truckCapacity: 15,
  actualVolume: 12.5,
  actualVolumeUnit: "m³",
  wasteType: "Residual",
  ...resolveUploadCell(ACTIVE_CELL_OPTIONS, "Cell 2"),
});

// ── Upload Excel with Cell → Cell appears in Preview ────────────────────────
test("an uploaded Cell is resolved to a real placement, so nothing must be re-assigned", () => {
  const row = uploadedRow();
  assert.equal(row.cellName, "Cell 2");
  assert.equal(row.cellIndex, 1, "the canonical identifier, not just the label");
  assert.equal(row.cellType, "Residual");
  assert.deepEqual(applyPreviewEdit(row, "wasteType", "Residual")._errors, []);
});

test("a Cell is matched by value, configured name, display label, casing or padding", () => {
  for (const input of ["Cell 4", "cell 4", "  CELL 4 ", "Cell 4 - Treated Haz Waste"]) {
    assert.equal(resolveUploadCell(ACTIVE_CELL_OPTIONS, input).cellIndex, 3, `"${input}" must resolve`);
  }
});

// ── Edit Cell in Preview → the EDITED cell is what gets imported ────────────
test("editing the Cell re-resolves the identifier the import writes", () => {
  const edited = applyPreviewEdit(uploadedRow(), "cellName", "Cell 4");
  assert.equal(edited.cellName, "Cell 4");
  assert.equal(edited.cellIndex, 3, "the file's Cell 2 index must NOT survive the edit");
  assert.equal(edited.cellType, "Treated Haz Waste");
  assert.deepEqual(edited._errors, []);
});

test("editing the Cell to an unavailable one is reported, not silently accepted", () => {
  // Cell 5 is Under Construction, so it is not in activeCellOptions.
  const edited = applyPreviewEdit(uploadedRow(), "cellName", "Cell 5");
  assert.equal(edited.cellIndex, null);
  assert.match(edited._errors.join(" | "), /is not an available cell under this SLF/);
});

// ── Edit other Preview fields → edited value is validated and carried ───────
test("editing a numeric field validates the EDITED value", () => {
  assert.equal(applyPreviewEdit(uploadedRow(), "truckCapacity", 18).truckCapacity, 18);
  assert.deepEqual(applyPreviewEdit(uploadedRow(), "truckCapacity", 18)._errors, []);
  assert.match(
    applyPreviewEdit(uploadedRow(), "actualVolume", -1)._errors.join(" | "),
    /Waste Volume must be greater than 0/,
  );
  assert.match(
    applyPreviewEdit(uploadedRow(), "truckCapacity", 0)._errors.join(" | "),
    /Truck Capacity must be greater than 0/,
  );
});

test("an edit that FIXES an invalid row clears its error", () => {
  const broken = applyPreviewEdit(uploadedRow(), "actualVolume", -1);
  assert.ok(broken._errors.length);
  const fixed = applyPreviewEdit(broken, "actualVolume", 8);
  assert.deepEqual(fixed._errors, [], "the corrected value must be the one validated");
  assert.equal(fixed.actualVolume, 8);
  assert.equal(fixed.cellIndex, 1, "unrelated resolved fields survive the edit");
});

test("editing the client to an unknown one is reported", () => {
  const edited = applyPreviewEdit(uploadedRow(), "client", "TEST CLIENT 999");
  assert.match(edited._errors.join(" | "), /is not assigned to hauler/);
});
