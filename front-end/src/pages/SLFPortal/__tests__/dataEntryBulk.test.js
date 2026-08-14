/**
 * SLF Portal — Data Entry bulk update / bulk upload regression tests.
 *
 * `mergeHaulersByName` is the single merge point for every Accredited-Haulers
 * write path: the baseline load, a single hauler edit, and the hauler BULK UPLOAD
 * (`handleConfirmUpload` merges the parsed rows into the existing list). These
 * tests pin the rule that makes a partial upload safe — an uploaded row updates
 * the fields it carries and leaves everything else alone.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeHaulersByName,
  cleanHaulerForSubmit,
  cleanClientForSubmit,
} from "../haulerNormalization.js";
import {
  submissionNeedsOrganize,
  getUnplacedSubmissions,
} from "../organizeCellsValidation.js";

// The baseline as already loaded in the portal.
const storedHaulers = () => [
  {
    key: "h1",
    haulerName: "ABC Hauling",
    officeAddress: "Angeles City, Pampanga",
    numberOfTrucks: 2,
    vehicles: [
      { plateNumber: "AAA111", vehicleType: "Dump Truck", capacity: 10, capacityUnit: "m³" },
      { plateNumber: "BBB222", vehicleType: "Compactor", capacity: 8, capacityUnit: "m³" },
    ],
    privateSectorClients: [
      {
        key: "c1",
        clientName: "Porac LGU",
        clientType: "LGU",
        clientAddress: "Brgy. Cangatba, Porac",
        provinceName: "Pampanga",
      },
    ],
  },
  {
    key: "h2",
    haulerName: "XYZ Transport",
    officeAddress: "Mabalacat, Pampanga",
    vehicles: [{ plateNumber: "ZZZ999", vehicleType: "Dump Truck", capacity: 15 }],
    privateSectorClients: [],
  },
];

// ── T10 / T11 — bulk upload carrying only SOME fields ───────────────────────
test("T11 uploading only a new Truck Capacity updates it and keeps every other field", () => {
  // The uploaded row carries the plate + the new capacity and nothing else —
  // exactly what handleConfirmUpload builds from a capacity-only file.
  const uploaded = {
    key: "upload-0",
    haulerName: "ABC Hauling",
    officeAddress: "",
    vehicles: [{ plateNumber: "AAA111", vehicleType: "", capacity: 15, capacityUnit: "m³" }],
    privateSectorClients: [],
  };
  const merged = mergeHaulersByName([...storedHaulers(), uploaded], "m³");
  const abc = merged.find((h) => h.haulerName === "ABC Hauling");
  const aaa = abc.vehicles.find((v) => v.plateNumber === "AAA111");

  assert.equal(aaa.capacity, 15, "the uploaded capacity must be applied");
  assert.equal(aaa.vehicleType, "Dump Truck", "vehicle type was not in the upload — keep it");
  assert.equal(abc.officeAddress, "Angeles City, Pampanga", "office address must survive");
  assert.equal(abc.vehicles.length, 2, "the untouched vehicle must remain");
  assert.equal(
    abc.vehicles.find((v) => v.plateNumber === "BBB222").capacity,
    8,
    "an unrelated vehicle must not change",
  );
  assert.equal(
    abc.privateSectorClients[0].clientAddress,
    "Brgy. Cangatba, Porac",
    "client details must survive a vehicle-only upload",
  );
});

test("T11 uploading only a Client Address updates it without dropping the client's other fields", () => {
  const uploaded = {
    key: "upload-1",
    haulerName: "ABC Hauling",
    officeAddress: "",
    vehicles: [],
    privateSectorClients: [
      { key: "u-c1", clientName: "Porac LGU", clientAddress: "Brgy. Manibaug, Porac" },
    ],
  };
  const merged = mergeHaulersByName([...storedHaulers(), uploaded], "m³");
  const client = merged.find((h) => h.haulerName === "ABC Hauling").privateSectorClients[0];

  assert.equal(client.clientAddress, "Brgy. Manibaug, Porac", "the uploaded address must apply");
  assert.equal(client.clientType, "LGU", "client type was not uploaded — keep it");
  assert.equal(client.provinceName, "Pampanga", "province was not uploaded — keep it");
  assert.equal(client.key, "c1", "the existing row identity is kept");
});

test("T09 a bulk upload never touches haulers it does not mention", () => {
  const merged = mergeHaulersByName(
    [
      ...storedHaulers(),
      { key: "upload-2", haulerName: "ABC Hauling", vehicles: [], privateSectorClients: [] },
    ],
    "m³",
  );
  const xyz = merged.find((h) => h.haulerName === "XYZ Transport");
  assert.equal(xyz.officeAddress, "Mabalacat, Pampanga");
  assert.equal(xyz.vehicles[0].capacity, 15);
  assert.equal(merged.length, 2, "an uploaded duplicate name must merge, not add a row");
});

test("T10 a genuinely new hauler from an upload is appended", () => {
  const merged = mergeHaulersByName(
    [
      ...storedHaulers(),
      {
        key: "upload-3",
        haulerName: "New Movers Inc",
        officeAddress: "Tarlac City",
        vehicles: [{ plateNumber: "NEW001", capacity: 20 }],
        privateSectorClients: [{ clientName: "Concepcion LGU", clientType: "LGU" }],
      },
    ],
    "m³",
  );
  assert.equal(merged.length, 3);
  const added = merged.find((h) => h.haulerName === "New Movers Inc");
  assert.equal(added.vehicles[0].capacity, 20);
  assert.equal(added.privateSectorClients[0].clientName, "Concepcion LGU");
});

// ── T05 / T06 — the submit payload keeps capacity + client address ──────────
test("T05 cleanHaulerForSubmit keeps vehicle capacity, office address and client address", () => {
  const payload = cleanHaulerForSubmit(storedHaulers()[0], 0, "m³");
  assert.equal(payload.officeAddress, "Angeles City, Pampanga");
  assert.equal(payload.vehicles.length, 2);
  assert.equal(payload.vehicles[0].capacity, 10);
  assert.equal(payload.privateSectorClients[0].clientAddress, "Brgy. Cangatba, Porac");
  assert.equal(payload.privateSectorClients[0].clientType, "LGU");
});

test("T06 cleanClientForSubmit no longer strips the Client Address", () => {
  const cleaned = cleanClientForSubmit({
    clientName: "Porac LGU",
    clientType: "LGU",
    clientAddress: "Brgy. Cangatba",
    provinceName: "Pampanga",
  });
  assert.equal(cleaned.clientAddress, "Brgy. Cangatba");
  assert.equal(cleaned.provinceName, "Pampanga");
});

test("T05 blank auto-padded vehicle rows are dropped from the submit payload", () => {
  const payload = cleanHaulerForSubmit(
    {
      haulerName: "ABC Hauling",
      numberOfTrucks: 4,
      vehicles: [
        { plateNumber: "AAA111", capacity: 10 },
        { plateNumber: "", vehicleType: "", capacity: null }, // padded blank
      ],
    },
    0,
    "m³",
  );
  assert.equal(payload.vehicles.length, 1);
});

// ── T07 / T12 — the organize blockage is driven by the persisted counts ─────
test("T12 blockage follows the server-computed counts, not local state", () => {
  const pending = { _id: "1", status: "acknowledged", unplacedCount: 2, missingCapacityCount: 0 };
  const capacityOnly = { _id: "2", status: "pending", unplacedCount: 0, missingCapacityCount: 1 };
  const done = { _id: "3", status: "acknowledged", unplacedCount: 0, missingCapacityCount: 0 };
  const locked = { _id: "4", status: "reverted", unplacedCount: 5, missingCapacityCount: 5 };

  assert.equal(submissionNeedsOrganize(pending), true);
  assert.equal(submissionNeedsOrganize(capacityOnly), true, "missing capacity also blocks");
  assert.equal(submissionNeedsOrganize(done), false);
  assert.equal(submissionNeedsOrganize(locked), false, "reverted entries are re-encoded, not organized");
  assert.deepEqual(
    getUnplacedSubmissions([pending, capacityOnly, done, locked]).map((s) => s._id),
    ["1", "2"],
  );
});
