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
const { portalJsxSource } = require("./helpers/portalSource");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
mongoose.set("bufferCommands", false);

const DataSLF = require("../models/DataSLF");
const serverCache = require("../utils/serverCache");
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

let limits;

const chain = (value) => {
  const c = {
    select: () => c,
    sort: () => c,
    setOptions: () => c,
    limit: (n) => { limits.push(n); return c; },
    lean: () => c,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return c;
};

test.beforeEach(() => {
  fleetDocs = [FLEET_DOC];
  queries = [];
  limits = [];
  // The fleet lookup is cached (serverCache, Redis-backed in production). Clear
  // the in-process tier between tests so each one measures its own queries
  // instead of inheriting the previous test's warm cache.
  serverCache._clearLocal();
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

// ── What made Organize Cell Placement slow to open ──────────────────────────
test("the fleet scan is BOUNDED — it never reads every baseline copy", async () => {
  // accreditedHaulers is duplicated onto every one of an SLF's baseline-carrying
  // records and carries each hauler's vehicles AND client lists; measured on
  // production one facility's 22 records hold 5,099 KB of it. Unbounded, opening
  // the organizer read all of it to build a map the newest record already
  // answers, because `add` never overwrites.
  await buildBaselineCapacityIndex([submission()]);
  assert.equal(limits.length, 1, "the query is limited");
  assert.ok(limits[0] > 0 && limits[0] <= 25, `a small bound, got ${limits[0]}`);
});

test("only the three fields the index reads are fetched", () => {
  const projection = slice(portalAuth, "serverCache.wrap(cacheKey", ".sort({ updatedAt");
  // A vehicle subdocument also carries `selectedClients`. Selecting whole
  // vehicles pulled every vehicle's client list across every copy, to read a
  // plate and a number.
  ["accreditedHaulers.vehicles.plateNumber", "accreditedHaulers.vehicles.capacity"].forEach((field) =>
    assert.ok(projection.includes(field), `${field} must be projected explicitly`),
  );
  assert.ok(
    !/select\([^)]*accreditedHaulers\.vehicles(?!\.)/.test(projection),
    "the whole vehicles array must not be selected",
  );
});

test("a repeat open is served from cache, not re-read", async () => {
  const batch = [submission(), submission()];
  const first = await buildBaselineCapacityIndex(batch);
  assert.equal(queries.length, 1);

  // Reopening the organizer must not re-read the fleet. Invalidation is exact —
  // every baseline/submission write clears PORTAL_FLEET_CAPACITY_PREFIX — so this
  // cannot serve a stale plate after a new vehicle is accredited.
  const second = await buildBaselineCapacityIndex(batch);
  assert.equal(queries.length, 1, "the second open issued no query");
  assert.deepEqual(
    [...second.get(String(FACILITY_ID)).entries()],
    [...first.get(String(FACILITY_ID)).entries()],
    "and returns the same fleet",
  );
});

test("a different facility does not share the cached fleet", async () => {
  await buildBaselineCapacityIndex([submission()]);
  assert.equal(queries.length, 1);
  // A second SLF is a different key — serving the first one's fleet here would
  // offer an operator a capacity from somebody else's baseline.
  await buildBaselineCapacityIndex([
    submission({ slfGenerator: { _id: OTHER_FACILITY_ID, cellNames: [] }, slfName: "Other SLF" }),
  ]);
  assert.equal(queries.length, 2, "a facility set it has not seen is looked up");
});

test("the cache key is invalidated by the writes that change a fleet", () => {
  const socketEmit = fs.readFileSync(path.join(__dirname, "..", "utils", "socketEmit.js"), "utf8");
  const slfData = socketEmit.slice(socketEmit.indexOf("const slfData = ["), socketEmit.indexOf("switch (target)"));
  assert.match(
    slfData,
    /keys\.PORTAL_FLEET_CAPACITY_PREFIX/,
    "a baseline save must not leave a newly accredited vehicle waiting out a TTL",
  );
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
  const ui = portalJsxSource();
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
