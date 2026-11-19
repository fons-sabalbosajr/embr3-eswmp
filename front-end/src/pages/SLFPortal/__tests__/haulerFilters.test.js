/**
 * Accredited Haulers table — column filters.
 *
 * The option lists and the predicates have to agree: an option offered by a
 * column must select something, and a record that has nothing in a column must
 * still be reachable. That second half is the point of the whole feature — the
 * rows an operator most needs to find are the incomplete ones (no office address,
 * no vehicle, no clients), and a filter list derived only from present values
 * cannot select them.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  NONE,
  TRUCK_BUCKETS,
  clientAddressOf,
  clientTypesOf,
  distinctFilters,
  filterByClientAddress,
  filterByClientName,
  filterByClientType,
  filterByHaulerName,
  filterByOfficeAddress,
  filterByTruckBucket,
  filterByVehicleType,
  truckCount,
  vehiclesOf,
} from "../columns/haulerFilters.js";

const HAULERS = [
  {
    key: 1,
    haulerName: "GREEN RESCUE",
    officeAddress: "San Fernando, Pampanga",
    numberOfTrucks: 4,
    vehicles: [
      { plateNumber: "ABJ 4635", vehicleType: "Dump Truck" },
      { plateNumber: "NGL 8726", vehicleType: "Compactor" },
    ],
    privateSectorClients: [
      { clientName: "MUNICIPALITY OF PULILAN", clientType: "LGU", provinceName: "Bulacan", municipalityName: "Pulilan" },
      { clientName: "MUNICIPALITY OF BAUTISTA", clientType: "LGU" },
    ],
  },
  {
    key: 2,
    haulerName: "BGC HAULERS",
    // No office address — the record this whole column exists to surface.
    numberOfTrucks: 12,
    vehicles: [{ plateNumber: "CCF 5541", vehicleType: "Dump Truck" }],
    privateSectorClients: [
      { clientName: "BGC HAULERS", clientType: "Private", clientAddress: "Taguig City" },
    ],
  },
  {
    key: 3,
    haulerName: "NEW HAULER",
    officeAddress: "Angeles City",
    // No trucks, no vehicles, no clients.
    privateSectorClients: [],
  },
  {
    key: 4,
    haulerName: "LEGACY HAULER",
    officeAddress: "Balanga, Bataan",
    // Legacy single-vehicle shape, and no declared truck count.
    plateNumber: "NAK 4286",
    vehicleType: "Compactor",
    privateSectorClients: [
      // Only a PSGC code for its location — counts as no address.
      { clientName: "SOME CLIENT", clientType: "Private", municipality: "0354010000" },
    ],
  },
];

const apply = (predicate, value) => HAULERS.filter((h) => predicate(value, h)).map((h) => h.key);

// ── Option lists ─────────────────────────────────────────────────────────────

test("hauler names are offered alphabetically, with no (none) entry when all are named", () => {
  const options = distinctFilters(HAULERS, (h) => [h.haulerName], "(unnamed)");
  assert.deepEqual(
    options.map((o) => o.value),
    ["BGC HAULERS", "GREEN RESCUE", "LEGACY HAULER", "NEW HAULER"],
  );
});

test("a column with a gap gains a (none) option; one without does not", () => {
  const vehicleTypes = distinctFilters(
    HAULERS,
    (h) => vehiclesOf(h).map((v) => v.vehicleType),
    "No vehicle encoded",
  );
  // NEW HAULER has no vehicle, so the sentinel is offered.
  assert.deepEqual(vehicleTypes.map((o) => o.value), ["Compactor", "Dump Truck", NONE]);

  const allNamed = distinctFilters(HAULERS, (h) => [h.haulerName], "(unnamed)");
  assert.ok(!allNamed.some((o) => o.value === NONE), "no gap → no sentinel option");
});

test("every offered option selects at least one row", () => {
  const clientNames = distinctFilters(
    HAULERS,
    (h) => (h.privateSectorClients || []).map((c) => c.clientName),
    "No clients encoded",
  );
  clientNames.forEach((option) => {
    assert.ok(
      apply(filterByClientName, option.value).length > 0,
      `"${option.text}" selects nothing`,
    );
  });
});

// ── Predicates ───────────────────────────────────────────────────────────────

test("office address filters the incomplete records IN, not out", () => {
  assert.deepEqual(apply(filterByOfficeAddress, "missing"), [2]);
  assert.deepEqual(apply(filterByOfficeAddress, "encoded"), [1, 3, 4]);
});

test("hauler name matches exactly, not by substring", () => {
  assert.deepEqual(apply(filterByHaulerName, "BGC HAULERS"), [2]);
  assert.deepEqual(apply(filterByHaulerName, "HAULER"), [], "a substring must not match");
});

test("truck bands cover every count exactly once", () => {
  assert.deepEqual(apply(filterByTruckBucket, "0"), [3]);
  assert.deepEqual(apply(filterByTruckBucket, "1-5"), [1, 4]);
  assert.deepEqual(apply(filterByTruckBucket, "6-10"), []);
  assert.deepEqual(apply(filterByTruckBucket, "10+"), [2]);
  // No row falls into two bands, and none falls into none of them.
  HAULERS.forEach((hauler) => {
    const hits = TRUCK_BUCKETS.filter((bucket) => bucket.match(truckCount(hauler)));
    assert.equal(hits.length, 1, `${hauler.haulerName} matched ${hits.length} bands`);
  });
});

test("a hauler whose fleet was typed vehicle-by-vehicle is not banded as having none", () => {
  // LEGACY HAULER has no numberOfTrucks but does carry a vehicle.
  assert.equal(truckCount(HAULERS[3]), 1);
});

test("vehicle type reaches the legacy single-vehicle shape and the empty one", () => {
  assert.deepEqual(apply(filterByVehicleType, "Compactor"), [1, 4]);
  assert.deepEqual(apply(filterByVehicleType, NONE), [3]);
});

test("client type shows a mixed hauler under both, and finds the client-less one", () => {
  const mixed = { privateSectorClients: [{ clientName: "A", clientType: "LGU" }, { clientName: "B", clientType: "Private" }] };
  assert.deepEqual(clientTypesOf(mixed), ["LGU", "Private"]);
  assert.ok(filterByClientType("LGU", mixed));
  assert.ok(filterByClientType("Private", mixed));

  assert.deepEqual(apply(filterByClientType, "LGU"), [1]);
  assert.deepEqual(apply(filterByClientType, NONE), [3]);
});

// Client Type is required: a client with no type is shown (and filtered) as
// "Not set", never silently counted as Private.
test("a client with no type at all is 'Not set', matching what the cell renders", () => {
  assert.deepEqual(clientTypesOf({ privateSectorClients: [{ clientName: "A" }] }), ["Not set"]);
});

test("client address completeness separates the three states", () => {
  // GREEN RESCUE: one client located, one with nothing → incomplete.
  // BGC HAULERS: its only client has an address → complete.
  // NEW HAULER: no clients at all → neither.
  // LEGACY HAULER: its client carries only a PSGC code → incomplete.
  assert.deepEqual(apply(filterByClientAddress, "incomplete"), [1, 4]);
  assert.deepEqual(apply(filterByClientAddress, "complete"), [2]);
  assert.deepEqual(apply(filterByClientAddress, NONE), [3]);
});

test("a bare PSGC code is not an address", () => {
  assert.equal(clientAddressOf({ municipality: "0354010000" }), "");
  assert.equal(clientAddressOf({ municipalityName: "Mabalacat", province: "0354000000" }), "Mabalacat");
  assert.equal(clientAddressOf({ clientAddress: "Clark Freeport Zone" }), "Clark Freeport Zone");
});

test("the sentinel cannot be produced by real data", () => {
  // Every value the predicates compare is trimmed, and NONE has a leading space.
  assert.equal(NONE.trim() === NONE, false);
  assert.deepEqual(apply(filterByClientName, NONE), [3], "only the client-less hauler");
});
