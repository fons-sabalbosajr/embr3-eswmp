/**
 * SLF Portal — data-integrity regression tests.
 *
 * These exercise the PURE persistence/validation rules of the portal data flow
 * (what the schema will actually store, what the submission validator counts as a
 * duplicate, what the organize/blockage summary reports). They run with the
 * built-in `node --test` runner and need NO database: a Mongoose document can be
 * constructed and inspected offline, which is exactly how a field that is silently
 * stripped on save is caught.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const DataSLF = require("../models/DataSLF");
const dataSlfRoutes = require("../routes/dataSLF");
const portalAuthRoutes = require("../routes/portalAuth");

const {
  mergeAccreditedHaulerCopies,
  sanitizeClient,
  sanitizeAccreditedHaulers,
  sanitizeSubmissionEntry,
} = dataSlfRoutes;
const { summarizeCellAssignment } = portalAuthRoutes;

// One hauler as it is actually stored: the same client repeated across
// privateSectorClients, clients and the vehicle's selectedClients.
const haulerCopy = () => ({
  haulerName: " ABC  Hauling ",
  officeAddress: "Angeles City, Pampanga",
  privateSectorClients: [{ clientName: "City of San Fernando", clientType: "LGU" }],
  clients: ["City of San Fernando"],
  vehicles: [
    {
      plateNumber: "AAA111",
      vehicleType: "Dump Truck",
      capacity: 12,
      capacityUnit: "m³",
      selectedClients: [{ clientName: "city of san fernando" }],
    },
  ],
});

// ── T14 — duplicate / ambiguous rows ────────────────────────────────────────
test("T14 duplicated baseline hauler copies collapse to one hauler and one client", () => {
  // Three baseline documents each carrying a copy of the same hauler, plus a
  // casing/whitespace variant of the hauler name.
  const merged = mergeAccreditedHaulerCopies([
    haulerCopy(),
    haulerCopy(),
    { ...haulerCopy(), haulerName: "abc hauling" },
  ]);
  assert.equal(merged.length, 1, "copies of one hauler must not read as several haulers");
  assert.equal(merged[0].clients.length, 1, "one client stored in 3 places is still one client");
});

test("T14 genuinely different haulers and clients stay distinct", () => {
  const merged = mergeAccreditedHaulerCopies([
    haulerCopy(),
    {
      haulerName: "XYZ Transport",
      privateSectorClients: [{ clientName: "Mabalacat LGU", clientType: "LGU" }],
    },
    {
      ...haulerCopy(),
      privateSectorClients: [{ clientName: "Bacolor LGU", clientType: "LGU" }],
    },
  ]);
  assert.equal(merged.length, 2);
  const abc = merged.find((h) => /abc/i.test(h.haulerName));
  assert.deepEqual(
    abc.clients.map((c) => c.clientName || c).sort(),
    ["Bacolor LGU", "City of San Fernando"],
    "a client added by a newer baseline must be part of the pool",
  );
});

// ── T06 / T11 — Client Address survives sanitization + the schema ───────────
test("T06 sanitizeClient keeps the Client Address instead of stripping it", () => {
  const cleaned = sanitizeClient({
    clientName: "Porac LGU",
    clientType: "LGU",
    clientAddress: "Brgy. Cangatba, Porac, Pampanga",
    provinceName: "Pampanga",
  });
  assert.equal(cleaned.clientAddress, "Brgy. Cangatba, Porac, Pampanga");
  assert.equal(cleaned.provinceName, "Pampanga");
});

test("T06 Client Address and vehicle capacity persist through the DataSLF schema", () => {
  const doc = new DataSLF({
    dateOfDisposal: new Date("2026-08-13"),
    lguCompanyName: "Test SLF",
    companyType: "LGU",
    accreditedHaulers: sanitizeAccreditedHaulers([
      {
        haulerName: "ABC Hauling",
        officeAddress: "Angeles City",
        vehicles: [{ plateNumber: "AAA111", vehicleType: "Dump Truck", capacity: 12 }],
        privateSectorClients: [
          { clientName: "Porac LGU", clientType: "LGU", clientAddress: "Brgy. Cangatba" },
        ],
      },
    ]),
  });
  const stored = doc.toObject().accreditedHaulers[0];
  assert.equal(stored.officeAddress, "Angeles City");
  assert.equal(stored.vehicles[0].capacity, 12);
  assert.equal(
    stored.privateSectorClients[0].clientAddress,
    "Brgy. Cangatba",
    "an uploaded Client Address must have somewhere to land",
  );
});

test("T06 Client Address survives the strict clientSchema on a transport entry", () => {
  // trucks[].selectedClients / vehicles[].selectedClients use clientSchema, which
  // DROPS anything not declared — unlike the Mixed privateSectorClients array.
  const doc = new DataSLF({
    dateOfDisposal: new Date("2026-08-13"),
    lguCompanyName: "Test SLF",
    companyType: "LGU",
    trucks: [
      {
        plateNumber: "AAA111",
        truckCapacity: 12,
        selectedClients: [
          sanitizeClient({
            clientName: "Porac LGU",
            clientType: "LGU",
            clientAddress: "Brgy. Cangatba",
          }),
        ],
      },
    ],
  });
  const client = doc.toObject().trucks[0].selectedClients[0];
  assert.equal(client.clientAddress, "Brgy. Cangatba");
  assert.equal(client.clientType, "LGU");
});

// ── T04 — General Information address persists through the schema ───────────
test("T04 General Information address + PSGC codes persist through the schema", () => {
  const doc = new DataSLF({
    dateOfDisposal: new Date("2026-08-13"),
    lguCompanyName: "Test SLF",
    companyType: "LGU",
    address: "Brgy. Sindalan, City of San Fernando, Pampanga, Region III",
    companyRegion: "030000000",
    companyProvince: "035400000",
    companyMunicipality: "035420000",
    companyBarangay: "035420001",
  });
  const stored = doc.toObject();
  assert.equal(stored.address, "Brgy. Sindalan, City of San Fernando, Pampanga, Region III");
  assert.equal(stored.companyRegion, "030000000");
  assert.equal(stored.companyMunicipality, "035420000");
});

// The portal read projection must actually SELECT everything the endpoint returns,
// otherwise the persisted address never reaches the form (and Review & Submit
// reports General Information as incomplete for data that is stored).
test("T04 portal baseline projection selects every General Information field", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "routes", "dataSLF.js"),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("const PORTAL_BASELINE_SELECT"),
    source.indexOf("function hasTruckVolume"),
  );
  for (const field of [
    "address",
    "companyRegion",
    "companyProvince",
    "companyMunicipality",
    "companyBarangay",
  ]) {
    assert.match(block, new RegExp(`\\b${field}: 1`), `${field} must be projected`);
  }
});

// ── T05 / T08 — a submission entry keeps every unrelated field ──────────────
test("T05 sanitizing a submission preserves truck capacity and unrelated sections", () => {
  const errors = [];
  const cleaned = sanitizeSubmissionEntry(
    {
      lguCompanyName: "Test SLF",
      address: "Brgy. Sindalan",
      companyRegion: "030000000",
      totalVolumeAccepted: 1500,
      baselineUnit: "m³",
      activeCellEntries: [{ cellName: "Cell 1", wasteType: "Residual", volume: 100, unit: "m³" }],
      trucks: [
        {
          plateNumber: "AAA111",
          truckCapacity: 12,
          truckCapacityUnit: "m3",
          actualVolume: 10,
          wasteType: "Residual",
          cellIndex: 0,
          vehicles: [{ plateNumber: "AAA111", capacity: 12, actualVolume: 10 }],
        },
      ],
    },
    errors,
  );
  assert.deepEqual(errors, []);
  assert.equal(cleaned.trucks[0].truckCapacity, 12);
  assert.equal(cleaned.trucks[0].truckCapacityUnit, "m³");
  assert.equal(cleaned.trucks[0].vehicles[0].capacity, 12);
  // Unrelated sections are untouched by the truck sanitizer.
  assert.equal(cleaned.address, "Brgy. Sindalan");
  assert.equal(cleaned.companyRegion, "030000000");
  assert.equal(cleaned.totalVolumeAccepted, 1500);
  assert.equal(cleaned.activeCellEntries[0].volume, 100);
});

// ── T07 / T12 — organize/blockage state is derived from the PERSISTED shape ──
const facility = { cellNames: ["Cell 1", "Cell 2"], cellStatuses: ["Active Cell", "Active Cell"] };

test("T07 a name-only placement counts as UNPLACED until it carries a cell index", () => {
  const before = summarizeCellAssignment({
    slfGenerator: facility,
    trucks: [{ actualVolume: 10, truckCapacity: 12, cellName: "Cell 1" }],
  });
  assert.equal(before.unplacedCount, 1, "a cellName copy with no cellIndex is not a placement");

  const after = summarizeCellAssignment({
    slfGenerator: facility,
    trucks: [{ actualVolume: 10, truckCapacity: 12, cellIndex: 0, cellName: "Cell 1" }],
  });
  assert.equal(after.unplacedCount, 0);
  assert.equal(after.cellsAssigned[0].cellName, "Cell 1");
});

test("T12 blockage counts a placement missing its truck capacity", () => {
  const summary = summarizeCellAssignment({
    slfGenerator: facility,
    trucks: [{ actualVolume: 10, cellIndex: 0, cellName: "Cell 1" }],
  });
  assert.equal(summary.unplacedCount, 0);
  assert.equal(summary.missingCapacityCount, 1);

  const completed = summarizeCellAssignment({
    slfGenerator: facility,
    trucks: [{ actualVolume: 10, truckCapacity: 12, cellIndex: 0, cellName: "Cell 1" }],
  });
  assert.equal(completed.missingCapacityCount, 0);
});

test("T12 per-vehicle volumes are summarized from the vehicle, not the truck", () => {
  const summary = summarizeCellAssignment({
    slfGenerator: facility,
    trucks: [
      {
        truckCapacity: 12,
        vehicles: [
          { actualVolume: 6, cellIndex: 0, cellName: "Cell 1" },
          { actualVolume: 4, cellName: "Cell 2" }, // name only → unplaced
        ],
      },
    ],
  });
  assert.equal(summary.unplacedCount, 1);
  assert.equal(summary.unplacedVolume, 4);
});
