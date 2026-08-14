/**
 * The Cell Infrastructure — All Facilities modal reports each SLF in ITS OWN
 * declared unit.
 *
 * The modal used to normalise every figure to m³ for display. The arithmetic was
 * right, but the numbers disagreed with every other screen: Prime Waste Solution
 * declares 450,000 TONS per cell and the Cell Breakdown rendered "900,000 m³"
 * (TON_PER_M3 = 0.5), so an admin cross-checking against the SLF Data Table or
 * Cell Infrastructure saw double. Floridablanca showed 3,600,000 m³ against a
 * declared 1,800,000 tons.
 *
 * Per-facility and per-cell figures now use the facility's declared unit. Only
 * the cross-facility TOTALS normalise — tons and m³ cannot be summed — and those
 * are the ones labelled m³.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { TON_PER_M3, convertVolume } = require("../utils/volumeUnits");

const dashboard = fs.readFileSync(
  path.join(__dirname, "..", "..", "front-end", "src", "pages", "AdminHome", "DashboardContent.jsx"),
  "utf8",
);

test("the conversion that produced the wrong figure is real, and now avoided", () => {
  // 1 m³ = 0.5 tons, so a tons-declared capacity DOUBLES when rendered as m³.
  assert.equal(TON_PER_M3, 0.5);
  assert.equal(convertVolume(450000, "tons", "m³"), 900000, "this is where 900K came from");
  assert.equal(convertVolume(450000, "tons", "tons"), 450000, "in its own unit it is unchanged");
});

test("per-cell figures are converted into the FACILITY's unit, not m³", () => {
  const block = dashboard.slice(
    dashboard.indexOf("const cellGaugeFacilities = mgmtData"),
    dashboard.indexOf("const cellsOverall = cellGaugeFacilities.reduce"),
  );
  assert.match(block, /const facilityUnit = resolveFacilityUnit\(r\) \|\| "m³";/);
  assert.match(block, /const toFacilityUnit = \(value, unit\) => convertVolume\(value, unit, facilityUnit\);/);
  // Capacity, fill and both provenance halves all go through it.
  assert.match(block, /const cap = toFacilityUnit\(caps\[i\], capUnit\)/);
  assert.match(block, /\? toFacilityUnit\(live\.used, live\.unit\)/);
  assert.match(block, /\? toFacilityUnit\(live\.baselineUsed, live\.unit\)/);
  assert.match(block, /\? toFacilityUnit\(live\.submittedUsed, live\.unit\)/);
  // The cell carries the unit it is actually expressed in.
  assert.match(block, /unit: facilityUnit, \/\/ the SLF's own declared unit/);
  assert.doesNotMatch(block, /unit: "m³", \/\/ normalized/, "the hard-coded label is gone");
  // No per-cell figure is normalised for display any more.
  assert.doesNotMatch(block, /const cap = toM3\(caps\[i\]/);
});

test("cross-facility totals still normalise, and only they do", () => {
  // Summing tons into m³ would be the opposite bug, so the facility subtotals are
  // carried in BOTH units and the rollup uses the m³ pair.
  assert.match(dashboard, /totalCapM3: toM3\(totalCap, facilityUnit\)/);
  assert.match(dashboard, /totalFillM3: toM3\(totalFill, facilityUnit\)/);
  assert.match(
    dashboard,
    /cellsOverall = cellGaugeFacilities\.reduce\(\s*\n?\s*\(a, f\) => \(\{ cap: a\.cap \+ f\.totalCapM3, fill: a\.fill \+ f\.totalFillM3/,
  );
});

test("every rendered figure carries the unit it is actually in", () => {
  // The facility gauge legend and the capacity tag read the facility's unit…
  assert.match(dashboard, /<GaugeLegend segments=\{f\.volumeSegments\} unit=\{f\.unit\}/);
  assert.match(dashboard, /\{Number\(f\.declaredCap\)\.toLocaleString\(\)\} \{f\.unit\}/);
  assert.match(dashboard, /declaredCap: convertVolume\(r\.volumeCapacity, r\.volumeCapacityUnit, declaredUnit\)/);
  // …and the awaiting-placement tag too.
  assert.match(dashboard, /\{drillFacility\.unit\} awaiting placement/);
  // No facility-scoped figure is still hard-labelled m³.
  assert.doesNotMatch(dashboard, /unit="m³" capacity=\{f\.totalCap\}/);
  assert.doesNotMatch(dashboard, /\{Number\(f\.totalCap\)\.toLocaleString\(\)\} m³/);
});

test("the modal reads the live rollup, and keeps the stored figures as a fallback", () => {
  assert.match(dashboard, /\/data-slf\/cell-occupancy/);
  assert.match(dashboard, /const rollup = cellOccupancy\[String\(r\._id\)\] \|\| null;/);
  // Fallback path still present for a facility the rollup has no entry for.
  assert.match(dashboard, /: toFacilityUnit\(fills\[i\], fillUnit\)/);
  // Same gauge key as Cell Infrastructure Overview.
  assert.match(dashboard, /import CellGaugeLegend from "\.\.\/admin\/slf-monitoring\/CellGaugeLegend"/);
  assert.ok(
    (dashboard.match(/<CellGaugeLegend isDark=\{isDark\} \/>/g) || []).length >= 2,
    "legend on both the facility grid and the per-facility breakdown",
  );
});
