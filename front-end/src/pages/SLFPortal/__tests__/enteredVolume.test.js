/**
 * Tons → m³ (and back) for values weighed in the other unit (enteredVolume.js).
 * Mirrors server/utils/enteredVolume.js, which recomputes on save.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  convertEntered,
  describeConversion,
  enteredVolumePatch,
  factorText,
  otherUnit,
  uploadRowToSlfUnit,
} from "../enteredVolume.js";

test("12.5 tons is 25 m³ (m³ = tons ÷ 0.5)", () => {
  assert.equal(convertEntered(12.5, "tons", "m³"), 25);
  assert.equal(convertEntered(25, "m³", "tons"), 12.5);
  assert.equal(convertEntered(0, "tons", "m³"), null);
  assert.equal(convertEntered("", "tons", "m³"), null);
  assert.equal(factorText("m³"), "m³ = tons ÷ 0.5");
  assert.equal(otherUnit("m³"), "tons");
  assert.equal(otherUnit("tons"), "m³");
});

test("the truck-form patch fills the volume and keeps the weight", () => {
  assert.deepEqual(enteredVolumePatch(12.5, "tons", "m³"), {
    actualVolume: 25,
    enteredVolume: 12.5,
    enteredVolumeUnit: "tons",
  });
  // Same unit: a plain volume, nothing to keep.
  assert.deepEqual(enteredVolumePatch(7, "m³", "m³"), {
    actualVolume: 7,
    enteredVolume: undefined,
    enteredVolumeUnit: undefined,
  });
});

test("an uploaded tons row at an m³ SLF converts volume and capacity", () => {
  const row = { actualVolume: 12.5, truckCapacity: 10, actualVolumeUnit: "tons" };
  const out = uploadRowToSlfUnit(row, "m³");
  assert.equal(out.actualVolume, 25);
  assert.equal(out.truckCapacity, 20);
  assert.equal(out.actualVolumeUnit, "m³");
  assert.equal(out.enteredVolume, 12.5);
  assert.equal(out.enteredVolumeUnit, "tons");
  assert.equal(describeConversion(out, "m³"), "12.5 tons → 25 m³");
});

test("rows already in the SLF's unit, or unconvertible, are untouched", () => {
  const same = { actualVolume: 5, actualVolumeUnit: "m³" };
  assert.equal(uploadRowToSlfUnit(same, "m³"), same);
  const unknown = { actualVolume: 5, actualVolumeUnit: "barrels" };
  assert.equal(uploadRowToSlfUnit(unknown, "m³"), unknown);
  assert.equal(describeConversion(same, "m³"), "");
});
