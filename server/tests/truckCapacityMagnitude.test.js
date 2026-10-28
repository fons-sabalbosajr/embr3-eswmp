/**
 * Truck capacity sanity limit — a capacity in the wrong unit is rejected.
 *
 * BESLF entered every truck capacity in KILOGRAMS under a "tons" label
 * (5000 "tons" carrying 2.5 t loads). The unit check passed because the label
 * matched the baseline, so nothing caught it until an admin reverted by hand.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MAX_TRUCK_CAPACITY,
  validateCapacityMagnitude,
  validateFleetCapacityMagnitude,
} = require("../utils/wasteGenerationValidation");

test("a kilogram figure labelled tons is rejected with the conversion", () => {
  const issues = validateCapacityMagnitude(
    [{ truckCapacity: 5000, truckCapacityUnit: "tons", vehicles: [] }],
    "tons",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].field, "truckCapacity");
  assert.match(issues[0].message, /5,000 kg = 5 tons/);
});

test("real capacities pass in either unit, up to the limit", () => {
  const trucks = [
    { truckCapacity: 36, truckCapacityUnit: "tons" },
    { truckCapacity: MAX_TRUCK_CAPACITY.tons, truckCapacityUnit: "tons" },
    { truckCapacity: 32, truckCapacityUnit: "m³" },
    { truckCapacity: MAX_TRUCK_CAPACITY["m³"], truckCapacityUnit: "m3" },
    { truckCapacity: null },
  ];
  assert.deepEqual(validateCapacityMagnitude(trucks, "tons"), []);
});

test("per-vehicle capacities are checked, and a missing unit uses the baseline", () => {
  const issues = validateCapacityMagnitude(
    [{ truckCapacity: 5, vehicles: [{ capacity: 4300 }, { capacity: 4.3 }] }],
    "tons",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].vehicleIndex, 0);
});

test("the baseline fleet is held to the same limit", () => {
  const msgs = validateFleetCapacityMagnitude(
    [{ haulerName: "METRO CLARK", vehicles: [{ plateNumber: "NIK 8661", capacity: 105000, capacityUnit: "tons" }, { plateNumber: "X", capacity: 10, capacityUnit: "tons" }] }],
    "tons",
  );
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /^METRO CLARK \/ NIK 8661: /);
});

test("submit, resubmit and baseline save all run the check", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  assert.match(src, /validateCapacityMagnitude\(item\?\.trucks, item\?\.baselineUnit\)/);
  const put = src.slice(src.indexOf('router.put("/:id"'), src.indexOf('router.get("/baseline/:slfName"'));
  assert.match(put, /validateCapacityMagnitude\(/);
  const save = src.slice(src.indexOf('router.patch("/portal-save-baseline/:slfName"'), src.indexOf('router.post("/baseline-update-request"'));
  assert.match(save, /validateFleetCapacityMagnitude\(/);
});

test("the portal mirror uses the same limits", () => {
  const fe = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "wasteGenValidation.js"),
    "utf8",
  );
  assert.match(fe, /MAX_TRUCK_CAPACITY = \{ tons: 60, "m³": 120 \}/);
  assert.deepEqual(MAX_TRUCK_CAPACITY, { tons: 60, "m³": 120 });
});
