/**
 * Organize Cells offers back the truck capacity the operator already declared.
 *
 * The SLF baseline records the accredited fleet: every vehicle's plate number
 * and that vehicle's capacity. A historical placement missing its Truck Capacity
 * was still asking the operator to type that same figure again, one row at a
 * time. The organizer now pre-fills it from the baseline, keyed on the plate.
 *
 * It is a SUGGESTION, never a silent write: nothing is persisted until the
 * operator saves the arrangement, a plate with nothing on file is left blank and
 * still asks, and a zero/absent baseline capacity never becomes a guess.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
mongoose.set("bufferCommands", false);

const DataSLF = require("../models/DataSLF");
const { buildBaselineCapacityIndex } = require("../routes/portalAuth");

const FACILITY_ID = new mongoose.Types.ObjectId();
const OTHER_FACILITY_ID = new mongoose.Types.ObjectId();

// The baseline's accredited fleet: plates with declared capacities, one legacy
// hauler-level plate, and one plate declared with NO capacity.
const FLEET_DOC = {
  slfGenerator: FACILITY_ID,
  slfName: "PWS Residual Disposal Facility",
  accreditedHaulers: [
    {
      vehicles: [
        { plateNumber: "ABC 1234", capacity: 12.5, capacityUnit: "tons" },
        { plateNumber: "XYZ-9999", capacity: 8, capacityUnit: "tons" },
        { plateNumber: "NOCAP-111", capacity: 0, capacityUnit: "tons" },
        { plateNumber: "", capacity: 30, capacityUnit: "tons" },
      ],
    },
    { plateNumber: "LEG-5555", capacity: 20, capacityUnit: "tons" },
  ],
};

let fleetDocs;
let queries;

const chain = (value) => {
  const c = {
    select: () => c,
    sort: () => c,
    setOptions: () => c,
    lean: () => c,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return c;
};

test.beforeEach(() => {
  fleetDocs = [FLEET_DOC];
  queries = [];
  DataSLF.find = (filter) => {
    queries.push(filter);
    return chain(fleetDocs);
  };
});

const submission = (overrides = {}) => ({
  slfGenerator: { _id: FACILITY_ID, cellNames: [] },
  slfName: "PWS Residual Disposal Facility",
  ...overrides,
});

// ── The lookup ──────────────────────────────────────────────────────────────
test("a declared plate resolves to its declared capacity", async () => {
  const index = await buildBaselineCapacityIndex([submission()]);
  const fleet = index.get(String(FACILITY_ID));
  assert.ok(fleet, "the facility has a fleet entry");
  assert.deepEqual(fleet.get("ABC1234"), { capacity: 12.5, capacityUnit: "tons" });
  assert.deepEqual(fleet.get("XYZ9999"), { capacity: 8, capacityUnit: "tons" });
  // Legacy single-vehicle haulers kept plate + capacity on the hauler itself.
  assert.deepEqual(fleet.get("LEG5555"), { capacity: 20, capacityUnit: "tons" });
});

test("plates match regardless of spacing or dashes", async () => {
  const index = await buildBaselineCapacityIndex([submission()]);
  const fleet = index.get(String(FACILITY_ID));
  // Declared as "ABC 1234"; a submission may carry "abc-1234".
  const normalise = (p) => String(p).replace(/[\s-]+/g, "").toUpperCase();
  ["abc-1234", "ABC1234", " abc 1234 "].forEach((plate) => {
    assert.equal(fleet.get(normalise(plate))?.capacity, 12.5, plate);
  });
});

test("a zero, missing or unplated capacity is never offered", async () => {
  const index = await buildBaselineCapacityIndex([submission()]);
  const fleet = index.get(String(FACILITY_ID));
  assert.equal(fleet.has("NOCAP111"), false, "a declared zero is not a capacity");
  assert.equal(fleet.has(""), false, "a vehicle with no plate cannot be keyed");
  assert.equal(fleet.get("UNKNOWN-PLATE"), undefined, "an unknown plate yields nothing, never a guess");
});

test("the newest baseline wins when a plate is declared twice", async () => {
  // Sorted newest-first by the query; the first entry must not be overwritten.
  fleetDocs = [
    { ...FLEET_DOC, accreditedHaulers: [{ vehicles: [{ plateNumber: "ABC1234", capacity: 15, capacityUnit: "tons" }] }] },
    FLEET_DOC,
  ];
  const index = await buildBaselineCapacityIndex([submission()]);
  assert.equal(index.get(String(FACILITY_ID)).get("ABC1234").capacity, 15);
});

test("a facility's fleet never leaks into another facility", async () => {
  const index = await buildBaselineCapacityIndex([
    submission(),
    submission({ slfGenerator: { _id: OTHER_FACILITY_ID }, slfName: "Another SLF" }),
  ]);
  assert.ok(index.get(String(FACILITY_ID)));
  assert.equal(index.get(String(OTHER_FACILITY_ID)), undefined, "no fleet on file for that facility");
});

test("a submission with no linked facility falls back to its SLF name", async () => {
  const index = await buildBaselineCapacityIndex([
    { slfGenerator: null, slfName: "PWS Residual Disposal Facility" },
  ]);
  assert.equal(index.get("PWS Residual Disposal Facility").get("ABC1234").capacity, 12.5);
});

test("nothing is queried when there is nothing to look up", async () => {
  const index = await buildBaselineCapacityIndex([]);
  assert.equal(index.size, 0);
  assert.equal(queries.length, 0, "no database round trip for an empty batch");
});

test("the whole batch costs ONE query, scoped to baselines that have a fleet", async () => {
  await buildBaselineCapacityIndex([submission(), submission(), submission()]);
  assert.equal(queries.length, 1, "one lookup per batch, not per submission");
  assert.deepEqual(queries[0]["accreditedHaulers.0"], { $exists: true });
  assert.equal(queries[0].deletedAt, null);
});

// ── How it is offered ───────────────────────────────────────────────────────
const portalAuth = fs.readFileSync(path.join(__dirname, "..", "routes", "portalAuth.js"), "utf8");
const slice = (source, start, end) => {
  const a = source.indexOf(start);
  assert.ok(a > -1, `not found: ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `end not found after ${start}`);
  return source.slice(a, b);
};

test("a suggestion is attached only where a capacity is actually missing", () => {
  const flatten = slice(
    portalAuth,
    "const capacityByPlate = await buildBaselineCapacityIndex",
    "// A submission whose waste is now fully placed",
  );
  // Vehicle rows prefer the vehicle's plate, falling back to the truck's.
  assert.match(flatten, /suggestCapacity\(facilityKey, v\?\.plateNumber, truck\?\.plateNumber\)/);
  // Truck-level rows use the truck's plate.
  assert.match(flatten, /suggestCapacity\(facilityKey, truck\?\.plateNumber\)/);
  // Both shapes are guarded on needsCapacity — a row that already has one is
  // never overwritten by a baseline figure.
  assert.equal((flatten.match(/needsCapacity\s*\n?\s*\?\s*suggestCapacity/g) || []).length, 2);
  // The stored value is untouched; the suggestion travels beside it.
  assert.match(flatten, /suggestedCapacity: suggested\?\.capacity \?\? null/);
  assert.match(flatten, /suggestedCapacitySource: suggested \? "baseline" : ""/);
  assert.doesNotMatch(
    flatten,
    /^\s*capacity: suggested/m,
    "the suggestion must never masquerade as the stored capacity",
  );
});

test("the organizer pre-fills it, marks it, and still saves nothing on its own", () => {
  const ui = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "index.jsx"),
    "utf8",
  );
  // Seeded only when the row needs a capacity and does not already have one.
  assert.match(ui, /p\.needsCapacity && !\(Number\(p\.capacity\) > 0\) && Number\(p\.suggestedCapacity\) > 0/);
  assert.match(ui, /capacityPrefilled: true/);
  // Visible: per row, in the how-to, and as a counted notice.
  assert.match(ui, /from baseline/);
  assert.match(ui, /filled in from your Baseline Data/);
  assert.match(ui, /const prefilledCapacityCount = useMemo/);
  // Typing over it drops the label — it is the operator's figure then.
  assert.match(ui, /capacityPrefilled: false/);
  // Persistence is unchanged: the save still gates on a positive capacity, so a
  // prefill that the operator never saves writes nothing.
  assert.match(ui, /const providesCapacity = p\.needsCapacity && isPos\(p\.capacity\)/);
});
