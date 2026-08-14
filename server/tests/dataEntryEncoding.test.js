/**
 * Data Entry ENCODING — validation, cell context, TabPane isolation, and the
 * cache invalidation a successful write must trigger.
 *
 * The encoding path is:
 *   value typed → sanitizeSubmissionEntry (validate + normalize)
 *     → 400 with a human-readable message when it fails, and NOTHING is written
 *     → MongoDB write when it passes
 *     → refreshAdmin() invalidates the dashboard caches the write made stale
 *
 * These tests drive the real exported functions, not copies of them.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { sanitizeSubmissionEntry } = require("../routes/dataSLF");
const { resolveBaselineCellEntries } = require("../utils/cellNaming");
const serverCache = require("../utils/serverCache");
const cacheKeys = require("../utils/cacheKeys");
const { refreshAdmin } = require("../utils/socketEmit");

const FACILITY = {
  numberOfCell: 3,
  cellNames: ["Cell Area Phase 1", "", "Hazardous Cell"],
  cellTypes: ["Residual", "Residual", "Treated Haz Waste"],
  cellStatuses: ["Active Cell", "Used/Completed", "Active Cell"],
};

// ── 1. Valid encoding ───────────────────────────────────────────────────────

test("a valid encoded value passes validation and is normalized, not altered", () => {
  const errors = [];
  const out = sanitizeSubmissionEntry(
    {
      baselineUnit: "m3",
      activeCellEntries: [{ cellName: "Cell Area Phase 1", volume: "1250.5", unit: "m3", wasteType: "Residual" }],
    },
    errors,
  );

  assert.deepEqual(errors, [], "a valid entry must produce no validation errors");
  assert.equal(out.activeCellEntries[0].volume, 1250.5, "a numeric string is coerced to a number");
  assert.equal(out.activeCellEntries[0].unit, "m³", "the unit is normalized to the stored enum");
  assert.equal(out.activeCellEntries[0].wasteType, "Residual", "free-text wasteType is preserved on cell entries");
});

test("zero is a legitimate encoded volume and must survive", () => {
  const errors = [];
  const out = sanitizeSubmissionEntry({ activeCellEntries: [{ cellName: "Cell 1", volume: 0 }] }, errors);
  assert.deepEqual(errors, []);
  assert.equal(out.activeCellEntries[0].volume, 0, "0 must not be dropped as falsy");
});

test("a blank field means 'not provided' — it is neither an error nor a zero", () => {
  const errors = [];
  const out = sanitizeSubmissionEntry({ activeCellEntries: [{ cellName: "Cell 1", volume: "" }] }, errors);
  assert.deepEqual(errors, [], "leaving a field empty is not a validation failure");
  assert.equal(out.activeCellEntries[0].volume, "", "the untouched value is left for the write guard to ignore");
});

// ── 2. Invalid encoding ─────────────────────────────────────────────────────

test("a non-numeric volume fails validation and names the offending field", () => {
  const errors = [];
  sanitizeSubmissionEntry({ activeCellEntries: [{ cellName: "Cell 1", volume: "twelve" }] }, errors);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Active cell entry 1 volume is not a valid number/);
});

test("a negative volume fails validation", () => {
  const errors = [];
  sanitizeSubmissionEntry({ closedCellEntries: [{ cellName: "Cell 2", volume: -5 }] }, errors);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Closed cell entry 1 volume cannot be negative/);
});

test("an invalid truck/vehicle volume is caught with its position", () => {
  const errors = [];
  sanitizeSubmissionEntry(
    { trucks: [{ vehicles: [{ actualVolume: 10 }, { actualVolume: "abc" }] }] },
    errors,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Truck 1 vehicle 2 volume is not a valid number/);
});

test("an invalid value NEVER reaches the stored payload", () => {
  const errors = [];
  const out = sanitizeSubmissionEntry({ activeCellEntries: [{ cellName: "Cell 1", volume: "twelve" }] }, errors);
  assert.ok(errors.length > 0);
  assert.equal(
    out.activeCellEntries[0].volume,
    "twelve",
    "the raw value is returned untouched — the route rejects on errors.length before any write",
  );
});

test("the routes REFUSE to write when validation produced errors", () => {
  // The guarantee above only holds because both encoding routes gate on it.
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  assert.match(
    source,
    /if \(validationErrors\.length\) \{\s*const error = new Error\(validationErrors\.join\(" \| "\)\);\s*error\.statusCode = 400;\s*throw error;/,
    "submitEntries must throw 400 before saving",
  );
  assert.match(
    source,
    /if \(updateErrors\.length\) \{\s*return res\.status\(400\)\.json\(\{ message: updateErrors\.join\(" "\) \}\);/,
    "the resubmit path must return 400 before applying updates",
  );
});

// ── 3. API failure ──────────────────────────────────────────────────────────

test("a failed write leaves the cache untouched, so the UI cannot show it as saved", async () => {
  serverCache._clearLocal();
  const key = `${cacheKeys.STATS_CACHE_PREFIX}:default`;
  await serverCache.set(key, { totalSubmissions: 41 }, 60000);

  const { invalidateOnWrite } = require("../middleware/cacheRoute");
  const listeners = {};
  const res = {
    statusCode: 500,
    on: (event, fn) => { (listeners[event] ||= []).push(fn); },
  };
  await new Promise((resolve) => invalidateOnWrite(cacheKeys.STATS_CACHE_PREFIX)({ method: "POST" }, res, resolve));
  (listeners.finish || []).forEach((fn) => fn());
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(
    await serverCache.get(key),
    { totalSubmissions: 41 },
    "a rejected encoding must not advance any cached figure",
  );
});

// ── 4. Cell-specific encoding ───────────────────────────────────────────────

test("an encoded value is bound to the cell the operator chose, by stable index", () => {
  const rows = resolveBaselineCellEntries(
    [
      { cellName: "Cell Area Phase 1", volume: 100, wasteType: "Residual" },
      { cellName: "Hazardous Cell", volume: 250, wasteType: "Inert/Hazardous Waste" },
    ],
    FACILITY,
  );
  assert.equal(rows[0].cellIndex, 0);
  assert.equal(rows[0].volume, 100);
  assert.equal(rows[1].cellIndex, 2, "the hazardous load must land on the hazardous cell, not the next one");
  assert.equal(rows[1].volume, 250);
  assert.equal(rows[1].cellType, "Treated Haz Waste");
});

test("a value encoded against an unknown cell stays unbound instead of landing on the wrong one", () => {
  const [row] = resolveBaselineCellEntries([{ cellName: "Cell That Was Deleted", volume: 900 }], FACILITY);
  assert.equal(row.cellIndex, null, "guessing here would corrupt another cell's capacity figures");
  assert.equal(row.volume, 900, "the operator's value is never discarded");
});

test("re-encoding an existing row keeps its cell binding", () => {
  const first = resolveBaselineCellEntries([{ cellName: "Cell Area Phase 1", volume: 100 }], FACILITY);
  const edited = [{ ...first[0], volume: 175 }];
  const [again] = resolveBaselineCellEntries(edited, FACILITY);
  assert.equal(again.cellIndex, 0, "editing the volume must not re-open the cell question");
  assert.equal(again.volume, 175);
});

// ── 5. TabPane isolation ────────────────────────────────────────────────────

test("encoding into the Active tab does not touch the Closed tab's rows", () => {
  const closed = [{ cellIndex: 1, cellName: "Cell 2", volume: 500 }];
  const closedSnapshot = JSON.parse(JSON.stringify(closed));

  const errors = [];
  const out = sanitizeSubmissionEntry(
    {
      activeCellEntries: [{ cellName: "Cell Area Phase 1", volume: "1250" }],
      closedCellEntries: closed,
    },
    errors,
  );

  assert.deepEqual(errors, []);
  assert.equal(out.activeCellEntries[0].volume, 1250);
  assert.deepEqual(closed, closedSnapshot, "the caller's closed rows must not be mutated");
  assert.equal(out.closedCellEntries[0].volume, 500, "the other tab's value is unchanged");
  assert.equal(out.closedCellEntries[0].cellIndex, 1, "and keeps its own cell binding");
});

test("the two tabs resolve independently — same label, different tab, different row", () => {
  const active = resolveBaselineCellEntries([{ cellName: "Cell 1", volume: 10 }], FACILITY);
  const closed = resolveBaselineCellEntries([{ cellName: "Cell 1", volume: 20 }], FACILITY);
  assert.equal(active[0].volume, 10);
  assert.equal(closed[0].volume, 20, "resolving one list must never read from the other");
});

test("an invalid value in one tab does not corrupt the other tab's valid value", () => {
  const errors = [];
  const out = sanitizeSubmissionEntry(
    {
      activeCellEntries: [{ cellName: "Cell 1", volume: "not a number" }],
      closedCellEntries: [{ cellName: "Cell 2", volume: "300" }],
    },
    errors,
  );
  assert.equal(errors.length, 1, "only the offending tab reports an error");
  assert.match(errors[0], /Active cell entry 1/);
  assert.equal(out.closedCellEntries[0].volume, 300, "the valid tab is still normalized correctly");
});

// ── 6. Cache behaviour after a successful write ─────────────────────────────

test("a successful submission invalidates the dashboard caches it made stale", async () => {
  serverCache._clearLocal();
  const stale = [
    cacheKeys.SUMMARY_BY_SLF_CACHE_KEY,
    `${cacheKeys.STATS_CACHE_PREFIX}:default`,
    `${cacheKeys.CELL_USAGE_CACHE_PREFIX}:default`,
  ];
  for (const key of stale) await serverCache.set(key, "pre-write", 60000);

  refreshAdmin({ app: { get: () => null } }, "submissions");
  await new Promise((r) => setImmediate(r));

  for (const key of stale) {
    assert.equal(await serverCache.get(key), undefined, `${key} must not survive the write`);
  }
});

test("a baseline save also clears the client-roster tile it re-derives", async () => {
  serverCache._clearLocal();
  await serverCache.set(cacheKeys.MODULE_STATS.slfClients, { total: 3 }, 60000);
  await serverCache.set(cacheKeys.SUMMARY_BY_SLF_CACHE_KEY, "pre-write", 60000);

  refreshAdmin({ app: { get: () => null } }, "baselines");
  await new Promise((r) => setImmediate(r));

  assert.equal(await serverCache.get(cacheKeys.MODULE_STATS.slfClients), undefined);
  assert.equal(await serverCache.get(cacheKeys.SUMMARY_BY_SLF_CACHE_KEY), undefined);
});

test("an admin cell rename clears the caches that embed cell names", async () => {
  serverCache._clearLocal();
  await serverCache.set(`${cacheKeys.CELL_USAGE_CACHE_PREFIX}:default`, "old names", 60000);
  await serverCache.set(`${cacheKeys.MODULE_STATS.slfFacilities}:all:default`, "old", 60000);

  refreshAdmin({ app: { get: () => null } }, "facility");
  await new Promise((r) => setImmediate(r));

  assert.equal(await serverCache.get(`${cacheKeys.CELL_USAGE_CACHE_PREFIX}:default`), undefined);
  assert.equal(await serverCache.get(`${cacheKeys.MODULE_STATS.slfFacilities}:all:default`), undefined);
});

test("the Data Entry baseline read is NOT cached — it is per-facility and user-scoped", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const from = source.indexOf('router.get("/baseline/:slfName"');
  const to = source.indexOf('router.get("/baselines"', from);
  const route = source.slice(from, to);
  assert.doesNotMatch(
    route,
    /cacheJson\(/,
    "caching this response under a shared key would serve one operator's baseline to another",
  );
});

// ── 7. Regression: Admin data → Portal Data Entry ───────────────────────────

test("REGRESSION — admin has cells + a stored baseline → Data Entry shows the ADMIN's cells", () => {
  // Exactly the live shape at BESLF: the admin renamed the cells; the stored
  // baseline row still carries the label from before the rename and no index.
  const storedByPortal = [{ cellName: "Cell 1", wasteType: "Residual", volume: 28611.47, unit: "m³" }];

  const asDataEntrySeesIt = resolveBaselineCellEntries(storedByPortal, FACILITY);

  assert.equal(asDataEntrySeesIt[0].cellName, "Cell Area Phase 1", "before the fix Data Entry showed 'Cell 1'");
  assert.equal(asDataEntrySeesIt[0].cellIndex, 0, "and had no way to tie the row to the admin's cell");
  assert.equal(asDataEntrySeesIt[0].volume, 28611.47, "the encoded figure is unchanged by the fix");
});

test("REGRESSION — a value saved today is stored WITH its cell index", () => {
  // The save path resolves before writing, so the read path no longer has to
  // infer anything for rows written from now on.
  const fromTheForm = [{ cellName: "Hazardous Cell", volume: 44, unit: "m³" }];
  const [persisted] = resolveBaselineCellEntries(fromTheForm, FACILITY);
  assert.equal(persisted.cellIndex, 2, "the stable relationship is what gets stored");
  assert.equal(persisted.cellType, "Treated Haz Waste");
});

test("REGRESSION — renaming a cell in Admin changes what Data Entry displays", () => {
  const stored = [{ cellIndex: 0, cellName: "Cell Area Phase 1", volume: 10 }];
  const renamed = { ...FACILITY, cellNames: ["Phase 1 (North)", "", "Hazardous Cell"] };
  const [row] = resolveBaselineCellEntries(stored, renamed);
  assert.equal(row.cellName, "Phase 1 (North)", "the admin is authoritative for the label");
  assert.equal(row.cellIndex, 0, "the relationship survives the rename");
  assert.equal(row.volume, 10);
});
