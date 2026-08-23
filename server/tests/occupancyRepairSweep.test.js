/**
 * A corrected calculation must reach the figures it corrected.
 *
 * `SlfFacility.cellFillValues` and its baseline/submitted split are a
 * denormalisation of utils/cellOccupancy.js. The repair sweep's gate used to ask
 * only "is the split MISSING?", so once every facility had one it returned early
 * for ever — and a fixed calculation left the old numbers in place until some
 * unrelated write happened to touch that facility.
 *
 * That is why PWS Cell 4 kept reporting a 441,324.28 t baseline (240,854.455 +
 * 200,469.822, merged in from two CLOSED cells) after the merge bug was fixed.
 *
 * A version stamp closes it: bump OCCUPANCY_CALC_VERSION and every facility
 * carrying an older stamp is recomputed at startup.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { OCCUPANCY_CALC_VERSION } = require("../utils/cellOccupancy");
const SlfFacility = require("../models/SlfFacility");

const backfill = fs.readFileSync(path.join(__dirname, "..", "utils", "backfillCellOccupancy.js"), "utf8");
const dataSlf = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");

test("the calculation carries a version, and the facility records which wrote it", () => {
  assert.ok(Number.isInteger(OCCUPANCY_CALC_VERSION) && OCCUPANCY_CALC_VERSION >= 2);
  const field = SlfFacility.schema.path("cellOccupancyVersion");
  assert.ok(field, "SlfFacility must record the calculation version");
  assert.equal(field.instance, "Number");
});

test("the sweep re-runs when the version moves, not only when the split is missing", () => {
  const gate = backfill.slice(backfill.indexOf("const STALE_FILTER"), backfill.indexOf("async function backfillCellOccupancy"));
  assert.match(gate, /cellFillBaselineValues: \{ \$exists: false \}/, "still repairs a missing split");
  assert.match(gate, /cellOccupancyVersion: \{ \$ne: OCCUPANCY_CALC_VERSION \}/, "AND a stale calculation");
  // The per-facility skip has to agree with the gate, or the sweep would select
  // facilities and then decline to write them.
  assert.match(backfill, /const versionMatches = Number\(facility\.cellOccupancyVersion \|\| 0\) === OCCUPANCY_CALC_VERSION;/);
  assert.match(backfill, /if \(hasSplit && totalMatches && versionMatches\) return;/);
  // And the stamp is written with the figures.
  assert.match(backfill, /cellOccupancyVersion: OCCUPANCY_CALC_VERSION,/);
});

test("the repair computes exactly what the live write path computes", () => {
  // A repair that used different rules would rewrite the drift it exists to fix.
  assert.match(backfill, /applyPreBaselineRule\(own, \{ exclude: excludePreBaseline \}\)/);
  assert.match(backfill, /computeCellOccupancy\(facility, counted, \{ unitSource: own \}\)/);
  assert.match(backfill, /\$\{OCCUPANCY_ENTRY_FIELDS\} dateOfDisposal/);
  // An admin-declared Waste in Cell has to survive the sweep, so the whole
  // declaration is read — base, unit and the date that decides what accumulates
  // on top of it, not just the flag.
  assert.match(backfill, /\$\{OVERRIDE_FACILITY_FIELDS\}/);
  assert.match(backfill, /OVERRIDE_FACILITY_FIELDS,\n\} = require\("\.\/cellOccupancy"\);/);
  // The setting is read once for the whole sweep, not per facility.
  assert.match(backfill, /const excludePreBaseline = await preBaselineExclusionEnabled\(\);/);

  // The live path stamps the same version, so the two never disagree.
  const refresh = dataSlf.slice(
    dataSlf.indexOf("async function refreshFacilityCellOccupancy"),
    dataSlf.indexOf('refreshAdmin(req, "facility")'),
  );
  assert.match(refresh, /cellOccupancyVersion: OCCUPANCY_CALC_VERSION,/);
  assert.match(refresh, /applyPreBaselineRule\(entries, \{/);
  assert.match(refresh, /computeCellOccupancy\(facility, counted, \{ unitSource: entries \}\)/);
});

test("an admin-set cell is labelled, not passed off as recorded data", () => {
  const metrics = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "utils", "volumeMetrics.js"),
    "utf8",
  );
  assert.match(metrics, /adminSet: \{/);
  assert.match(metrics, /label: "Admin-Set Volume"/);
  // It replaces the derived split rather than sitting beside it — otherwise the
  // legend would show baseline 0 + submitted 0 against a filled arc.
  assert.match(metrics, /if \(cell\.overridden && Number\(cell\.fill\) > 0\) \{/);
  assert.match(metrics, /return \[\{ \.\.\.VOLUME_METRICS\.adminSet, value: Number\(cell\.fill\) \}\];/);
  // …but volume recorded SINCE the declaration is real submitted data and is
  // drawn beside it, so the segments still total the fill on the gauge.
  assert.match(metrics, /label: "Submitted Since Admin Update", value: since/);
  assert.match(metrics, /const base = Number\(cell\.overrideBase\);/);
  assert.match(metrics, /const since = Number\(cell\.postOverrideSubmitted\);/);
  // The dashboard supplies the flag, live first and stored as the fallback.
  const dashboard = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "AdminHome", "DashboardContent.jsx"),
    "utf8",
  );
  assert.match(dashboard, /overridden: live \? !!live\.overridden : r\.cellFillOverridden\?\.\[i\] === true,/);
  // …and the API actually sends it.
  const facilities = fs.readFileSync(path.join(__dirname, "..", "routes", "slfFacilities.js"), "utf8");
  const projection = facilities.slice(
    facilities.indexOf("SlfFacility.find(scopedFilter, {"),
    facilities.indexOf("leachatePondDetails: 1"),
  );
  assert.match(projection, /cellFillOverridden: 1/);
});
