/**
 * An admin-declared "Waste in Cell" figure sticks — and the per-cell drill-down
 * is offered when the cell actually has submissions.
 *
 * Waste in Cell is DERIVED: baseline + valid submissions, recomputed by
 * refreshFacilityCellOccupancy on every submission, placement and
 * acknowledgement. But SLF Table → Edit exposes a "Waste in Cell" input, and a
 * figure typed there had nowhere to survive:
 *   • the recompute overwrote `cellFillValues` on the next write, and
 *   • every view now reads the derived rollup, which never looked at the stored
 *     value at all — so Facility Details showed the derived number and the edit
 *     appeared to do nothing.
 *
 * `cellFillOverridden[i]` marks a cell as admin-declared. These tests pin that
 * the flag is only set by the form that actually offers the input, that the
 * override wins inside the ONE shared calculation (so it reaches Facility
 * Details, Cell Infrastructure, View SLF Details and the portal identically),
 * and that clearing the field hands the cell back to the derived value.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { computeCellOccupancy } = require("../utils/cellOccupancy");

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const readUi = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", "front-end", "src", ...parts), "utf8");
const slice = (source, start, end) => {
  const a = source.indexOf(start);
  assert.ok(a > -1, `not found: ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `end not found after ${start}`);
  return source.slice(a, b);
};

const FACILITY = {
  numberOfCell: 4,
  cellNames: ["CELL 01", "CELL 02", "CELL 03", "CELL 04"],
  cellStatuses: ["Active Cell", "Active Cell", "Active Cell", "Active Cell"],
  cellTypes: ["Residual", "Residual", "Residual", "Residual"],
  cellCapacities: [1000, 1000, 1000, 1000],
  cellCapacityUnits: ["tons", "tons", "tons", "tons"],
  cellFillUnits: ["tons", "tons", "tons", "tons"],
};

const SUBMISSION = {
  _id: "s1",
  status: "acknowledged",
  baselineUnit: "tons",
  createdAt: new Date("2026-03-01"),
  trucks: [
    { actualVolume: 100, actualVolumeUnit: "tons", wasteType: "Residual", cellIndex: 0, vehicles: [] },
  ],
};

// ── The formula always wins (occupancy calc v6) ─────────────────────────────
//
// Waste in Cell = baseline + APPROVED submissions. An admin-typed figure used to
// REPLACE that — Porac's cells read 1,310,353 / 683,202 m³ although their own
// baseline alone was larger — so the baseline and every approval disappeared and
// the View and Edit modals could disagree. A stored declaration is now audit-only.
test("a stored declaration no longer replaces the derived total", () => {
  const withOverride = {
    ...FACILITY,
    cellFillValues: [250, null, null, 250],
    cellFillOverridden: [true, false, false, true],
    cellFillOverrideValues: [250, null, null, 250],
    cellFillOverrideUnits: ["tons", null, null, "tons"],
    cellFillOverrideAt: [new Date("2026-04-01"), null, null, new Date("2026-04-01")],
  };
  const occ = computeCellOccupancy(withOverride, [SUBMISSION]);
  assert.equal(occ.rows[0].total, 100, "the approved 100 t, not the typed 250");
  assert.equal(occ.rows[3].total, 0, "an empty cell reads empty");
  assert.equal(occ.rows.some((r) => r.overridden), false, "nothing is presented as overridden");
  assert.equal(occ.rows[0].legacyOverride, 250, "the old figure is still visible for audit");
  assert.equal(occ.cellFillValues[0], 100);
});

test("clearing the field hands the cell back to the derived value", () => {
  const cleared = computeCellOccupancy(
    { ...FACILITY, cellFillValues: [null, null, null, null], cellFillOverridden: [false, false, false, false] },
    [SUBMISSION],
  );
  assert.equal(cleared.rows[3].total, 0);
  assert.equal(cleared.rows[3].legacyOverride, undefined);
});

test("a facility with no override behaves exactly as before", () => {
  const before = computeCellOccupancy(FACILITY, [SUBMISSION]);
  assert.equal(before.rows[0].total, 100);
  assert.equal(before.totalVolume, 100);
  assert.equal(before.rows.some((r) => r.overridden), false);
});

// ── It has to reach the recompute and the rollup ────────────────────────────
test("both the recompute and the rollup READ the override, not just write it", () => {
  const dataSlf = read("routes", "dataSLF.js");
  // refreshFacilityCellOccupancy is what persists cellFillValues; without these
  // two fields in its projection the override was invisible and got overwritten.
  const refresh = slice(dataSlf, "async function refreshFacilityCellOccupancy", "refreshAdmin(req, \"facility\")");
  assert.match(refresh, /\$\{OVERRIDE_FACILITY_FIELDS\}/);
  // The multi-facility rollup and the per-facility panel share one projection.
  assert.match(dataSlf, /const FACILITY_CELL_FIELDS =[\s\S]*?\$\{OVERRIDE_FACILITY_FIELDS\}/);
  // ONE named fragment, so a projection cannot silently lose a field and make
  // the override invisible to just that reader.
  assert.match(
    read("utils", "cellOccupancy.js"),
    /const OVERRIDE_FACILITY_FIELDS =[\s\S]*?cellFillOverrideValues cellFillOverrideUnits cellFillOverrideAt cellFillOverrideBy/,
  );
  // The portal reads the whole facility document, so it gets them for free.
  const facilities = read("routes", "slfFacilities.js");
  assert.match(facilities, /async function enrichPortalFacilityVolumes/);
});

test("the override travels to the client with what the data alone says", () => {
  const dataSlf = read("routes", "dataSLF.js");
  const builder = slice(dataSlf, "function buildOccupancyCells(", "/** Per-cell set of submission ids");
  assert.match(builder, /overridden: !!row\.overridden/);
  assert.match(builder, /derivedTotal: row\.overridden \? row\.derivedTotal : undefined/);
});

// ── The server no longer records a hand-typed Waste in Cell ─────────────────
test("the SLF edit form can no longer declare a hand-typed Waste in Cell", () => {
  const facilities = read("routes", "slfFacilities.js");
  const put = slice(facilities, 'router.put("/:id", adminOnly', 'router.patch("/:id/cell-status"');
  // The request flag is consumed and ignored.
  assert.match(put, /const fillsDeclared = false;/);
  assert.match(put, /delete update\.cellFillValuesDeclared;/, "a request flag, never a facility field");
  assert.match(put, /const declaredFills = null;/);
  // The edit form shows the derived figure read-only and sends no flag.
  assert.doesNotMatch(readUi("pages", "admin", "SLFMonitoring.jsx"), /payload\.cellFillValuesDeclared = true;/);
  // Stored declarations are still carried with their CELL when cells are added,
  // removed or reordered, so the audit record never points at the wrong cell.
  const merge = slice(facilities, "function mergeCellInfrastructureUpdate(update, record", "async function enrichPortalFacilityVolumes");
  ["cellFillOverridden", "cellFillOverrideValues", "cellFillOverrideUnits", "cellFillOverrideAt", "cellFillOverrideBy"]
    .forEach((key) => assert.match(merge, new RegExp(`carryDerived\\("${key}"`)));
  assert.match(merge, /const from = sourceIndexOf\(index\);/);
  assert.match(merge, /if \(raw === null \|\| raw === undefined \|\| raw === ""\) return null;/);
});

// ── The disabled View button ────────────────────────────────────────────────
test("the per-cell drill-down is offered on submission COUNT, not on volume", () => {
  const modal = readUi("pages", "admin", "slf-monitoring", "modals", "SlfDetailModal.jsx");
  const column = slice(modal, 'title: "Daily Submissions"', "const totalBaseline");
  assert.match(column, /const count = row\.submissionCount;/);
  assert.match(column, /count === undefined\s*\n?\s*\?\s*Number\(row\.submissions \|\| 0\) > 0\s*\n?\s*:\s*count > 0/);
  assert.match(column, /disabled=\{!hasSubmissions\}/);
  // A disabled button now says why.
  assert.match(column, /no submissions to list/i);

  // The count comes from the authoritative rollup.
  const dashboard = readUi("pages", "admin", "slf-monitoring", "SlfDashboardTab.jsx");
  assert.match(dashboard, /submissionCount: cell\.submissionCount \|\| 0/);
  assert.match(dashboard, /overridden: !!cell\.overridden/);
});

test("the drill-down lists per-vehicle placements, not only truck-level ones", () => {
  const monitoring = readUi("pages", "admin", "SLFMonitoring.jsx");
  const handler = slice(monitoring, "const openDailySubmissionsModal", "const generatorOptions");
  // One row per PLACEMENT.
  assert.match(handler, /\.flatMap\(\(truck, truckIndex\) => \{/);
  assert.match(handler, /const vehicles = \(truck\.vehicles \|\| \[\]\)\.filter\(/);
  // The vehicle's own cell wins, falling back to the truck's.
  assert.match(handler, /getTruckCellIndex\(vehicle\) \?\? getTruckCellIndex\(truck\)/);
  // Filtered on the row's own volume — the truck-level check dropped every
  // multi-vehicle trip, which is what made the modal come up empty.
  assert.match(handler, /if \(!\(item\.volume > 0\)\) return false;/);
});

// ── Nothing is faked in the UI ──────────────────────────────────────────────
test("an admin-declared figure is labelled, not passed off as derived", () => {
  const infra = readUi("pages", "admin", "CellInfraOverview.jsx");
  assert.match(infra, /Admin-set/);
  assert.match(infra, /data says \{fmt\(cell\.derivedTotal\)\}/);
  // The baseline/submitted split is only shown when it actually adds up.
  assert.match(infra, /cell\.overridden\s*\n?\s*\? item\(/);
});
