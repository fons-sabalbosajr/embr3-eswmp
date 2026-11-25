/**
 * Volumes entered in another unit (utils/enteredVolume.js): the server
 * recomputes the stored volume from the value as weighed, and keeps the original.
 *
 * Run: node --test tests/enteredVolume.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { applyEnteredVolume, applyEnteredVolumesToTruck } = require("../utils/enteredVolume");

test("12.5 tons at an m³ SLF is stored as 25 m³, with the tons kept", () => {
  const row = { actualVolume: 999, actualVolumeUnit: "m³", enteredVolume: 12.5, enteredVolumeUnit: "Tons" };
  assert.equal(applyEnteredVolume(row), true);
  assert.equal(row.actualVolume, 25, "the client's number is not trusted");
  assert.equal(row.enteredVolume, 12.5);
  assert.equal(row.enteredVolumeUnit, "tons");
});

test("m³ at a tons SLF converts the other way", () => {
  const row = { actualVolumeUnit: "tons", enteredVolume: 30, enteredVolumeUnit: "m3" };
  applyEnteredVolume(row);
  assert.equal(row.actualVolume, 15);
});

test("an entered value in the same unit, or an unusable one, is dropped", () => {
  for (const extra of [
    { enteredVolume: 10, enteredVolumeUnit: "m³" },
    { enteredVolume: -3, enteredVolumeUnit: "tons" },
    { enteredVolume: "abc", enteredVolumeUnit: "tons" },
    { enteredVolume: 5, enteredVolumeUnit: "barrels" },
  ]) {
    const row = { actualVolume: 10, actualVolumeUnit: "m³", ...extra };
    assert.equal(applyEnteredVolume(row), false);
    assert.equal(row.actualVolume, 10, "volume untouched");
    assert.equal("enteredVolume" in row, false);
    assert.equal("enteredVolumeUnit" in row, false);
  }
});

test("rows without an entered value are untouched", () => {
  const row = { actualVolume: 7, actualVolumeUnit: "m³" };
  assert.equal(applyEnteredVolume(row), false);
  assert.deepEqual(row, { actualVolume: 7, actualVolumeUnit: "m³" });
});

test("a truck's total follows its converted vehicles", () => {
  const truck = {
    actualVolume: 1,
    actualVolumeUnit: "m³",
    enteredVolume: 1,
    enteredVolumeUnit: "tons",
    vehicles: [
      { actualVolumeUnit: "m³", enteredVolume: 12.5, enteredVolumeUnit: "tons" },
      { actualVolume: 4, actualVolumeUnit: "m³" },
    ],
  };
  applyEnteredVolumesToTruck(truck);
  assert.equal(truck.vehicles[0].actualVolume, 25);
  assert.equal(truck.actualVolume, 29);
  assert.equal("enteredVolume" in truck, false, "the truck's own stale entered value goes");
});

test("a truck without vehicles converts on its own row", () => {
  const truck = { actualVolumeUnit: "m³", enteredVolume: 2, enteredVolumeUnit: "tons", vehicles: [] };
  applyEnteredVolumesToTruck(truck);
  assert.equal(truck.actualVolume, 4);
});

test("submissions run every truck through the conversion, and the schema keeps the original", () => {
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  assert.match(route, /return applyEnteredVolumesToTruck\(cleaned\);/);
  const model = fs.readFileSync(path.join(__dirname, "..", "models", "DataSLF.js"), "utf8");
  assert.equal((model.match(/enteredVolume: \{ type: Number \}/g) || []).length, 2, "vehicle and truck");
});
