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

// ── The override itself ─────────────────────────────────────────────────────
test("a declared Waste in Cell replaces the derived total for that cell only", () => {
  const withOverride = {
    ...FACILITY,
    // Cell 4 (index 3) was declared by an admin as 250 t.
    cellFillValues: [null, null, null, 250],
    cellFillOverridden: [false, false, false, true],
  };
  const occ = computeCellOccupancy(withOverride, [SUBMISSION]);

  assert.equal(occ.rows[3].total, 250, "the admin's figure IS the cell's volume");
  assert.equal(occ.rows[3].overridden, true);
  assert.equal(occ.rows[3].derivedTotal, 0, "what the data alone says is kept beside it");
  // Every other cell is untouched and still derived.
  assert.equal(occ.rows[0].total, 100);
  assert.equal(occ.rows[0].overridden, undefined);
  // And the value the recompute writes back carries the override, so the next
  // submission cannot silently wipe it.
  assert.equal(occ.cellFillValues[3], 250);
  assert.equal(occ.cellFillValues[0], 100);
});

test("the override is converted into the occupancy unit, never assumed", () => {
  const occ = computeCellOccupancy(
    {
      ...FACILITY,
      cellFillUnits: ["tons", "tons", "tons", "m³"],
      cellFillValues: [null, null, null, 100],
      cellFillOverridden: [false, false, false, true],
    },
    [SUBMISSION], // resolves the target unit to tons
  );
  assert.equal(occ.unit, "tons");
  assert.notEqual(occ.rows[3].total, 100, "100 m³ is not 100 tons");
  assert.ok(occ.rows[3].total > 0);
});

test("clearing the field hands the cell back to the derived value", () => {
  const cleared = computeCellOccupancy(
    { ...FACILITY, cellFillValues: [null, null, null, null], cellFillOverridden: [false, false, false, false] },
    [SUBMISSION],
  );
  assert.equal(cleared.rows[3].total, 0);
  assert.equal(cleared.rows[3].overridden, undefined);
  // A flag with no value behind it is ignored rather than zeroing the cell.
  const flagOnly = computeCellOccupancy(
    { ...FACILITY, cellFillValues: [], cellFillOverridden: [false, false, false, true] },
    [SUBMISSION],
  );
  assert.equal(flagOnly.rows[0].total, 100);
  assert.equal(flagOnly.rows[3].overridden, undefined);
});

// ── An override is a BASE, not a lid ────────────────────────────────────────
//
// The scenario this exists for: automatic value 100, admin declares 120, a 10 t
// load is then approved. The admin's 120 must survive AND the 10 must be
// recorded — 120 must not collapse back to 110, and it must not stay 120 while
// the approval vanishes.
const OVERRIDE_AT = new Date("2026-04-01T00:00:00Z");
const declaredFacility = (value = 120) => ({
  ...FACILITY,
  cellFillValues: [value, null, null, null],
  cellFillOverridden: [true, false, false, false],
  cellFillOverrideValues: [value, null, null, null],
  cellFillOverrideUnits: ["tons", null, null, null],
  cellFillOverrideAt: [OVERRIDE_AT, null, null, null],
});
const load = (id, volume, createdAt, cellIndex = 0) => ({
  _id: id,
  status: "acknowledged",
  baselineUnit: "tons",
  createdAt,
  trucks: [{ actualVolume: volume, actualVolumeUnit: "tons", wasteType: "Residual", cellIndex, vehicles: [] }],
});

test("a submission recorded AFTER the declaration is added to it, not discarded", () => {
  const before = load("before", 100, new Date("2026-03-01"));
  const after = load("after", 10, new Date("2026-04-05"));

  const occ = computeCellOccupancy(declaredFacility(120), [before, after]);
  assert.equal(occ.rows[0].total, 130, "120 declared + the 10 t approved since");
  assert.equal(occ.rows[0].overrideBase, 120, "the admin's figure is untouched");
  assert.equal(occ.rows[0].postOverrideSubmitted, 10);
  // …and the two halves add up to what is displayed, so a gauge cannot lie.
  assert.equal(occ.rows[0].overrideBase + occ.rows[0].postOverrideSubmitted, occ.rows[0].total);
  // What the data alone says is still kept beside it.
  assert.equal(occ.rows[0].derivedTotal, 110);
});

test("waste already recorded when the figure was typed is NOT re-added", () => {
  // Both loads predate the declaration: they are inside the 120 the admin typed.
  const occ = computeCellOccupancy(declaredFacility(120), [
    load("a", 100, new Date("2026-03-01")),
    load("b", 10, new Date("2026-03-20")),
  ]);
  assert.equal(occ.rows[0].total, 120, "the declaration replaced them, once");
  assert.equal(occ.rows[0].postOverrideSubmitted, 0);
});

test("the accumulated figure is stable across recomputes — it never compounds", () => {
  const facility = declaredFacility(120);
  const entries = [load("before", 100, new Date("2026-03-01")), load("after", 10, new Date("2026-04-05"))];
  const first = computeCellOccupancy(facility, entries);
  // What refreshFacilityCellOccupancy persists back onto the facility.
  const persisted = {
    ...facility,
    cellFillValues: first.cellFillValues,
    cellFillUnits: first.cellFillUnits,
  };
  const second = computeCellOccupancy(persisted, entries);
  assert.equal(second.rows[0].total, first.rows[0].total, "recomputing must be idempotent");
  assert.equal(second.rows[0].overrideBase, 120, "the base is read from the declaration, never from the effective total");
});

test("only the cell the waste was placed in accumulates", () => {
  const occ = computeCellOccupancy(declaredFacility(120), [
    load("elsewhere", 40, new Date("2026-04-05"), 2),
  ]);
  assert.equal(occ.rows[0].total, 120, "Cell 1's declaration is not moved by Cell 3's load");
  assert.equal(occ.rows[2].total, 40);
});

test("a legacy override — flagged before the declaration was recorded — still replaces", () => {
  // No cellFillOverrideValues / cellFillOverrideAt: there is no way to tell what
  // was already inside the figure, so nothing may be added to it. This is the
  // behaviour those facilities already had; it must not change under them.
  const legacy = {
    ...FACILITY,
    cellFillValues: [250, null, null, null],
    cellFillOverridden: [true, false, false, false],
  };
  const occ = computeCellOccupancy(legacy, [load("after", 10, new Date("2099-01-01"))]);
  assert.equal(occ.rows[0].total, 250);
  assert.equal(occ.rows[0].postOverrideSubmitted, 0);
  // And it cannot compound either: the effective total written back IS the base.
  const second = computeCellOccupancy({ ...legacy, cellFillValues: occ.cellFillValues }, [
    load("after", 10, new Date("2099-01-01")),
  ]);
  assert.equal(second.rows[0].total, 250);
});

test("approving a submission that predates the declaration does not inflate it", () => {
  // A pending submission ALREADY counts toward occupancy, so it was part of what
  // the admin saw and replaced. Acknowledging it later is not new volume.
  const pending = { ...load("p", 30, new Date("2026-03-10")), status: "pending" };
  const approved = { ...pending, status: "acknowledged" };
  const facility = declaredFacility(120);
  assert.equal(computeCellOccupancy(facility, [pending]).rows[0].total, 120);
  assert.equal(computeCellOccupancy(facility, [approved]).rows[0].total, 120);
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

// ── Only the form that offers the input may declare one ─────────────────────
test("only the SLF edit form declares a hand-typed Waste in Cell", () => {
  const facilities = read("routes", "slfFacilities.js");
  const put = slice(facilities, 'router.put("/:id", adminOnly', 'router.patch("/:id/cell-status"');
  assert.match(put, /const fillsDeclared = update\.cellFillValuesDeclared === true;/);
  assert.match(put, /delete update\.cellFillValuesDeclared;/, "a request flag, never a facility field");
  // Captured BEFORE the merge — the merge carries stored flags forward.
  assert.ok(
    put.indexOf("const declaredFills") < put.indexOf("mergeCellInfrastructureUpdate(update, record"),
    "the declared values must be read before the merge rewrites them",
  );
  // A blank clears the override for that cell — flag, base, unit, stamp and
  // author all go, so nothing is left behind to be picked up again.
  assert.match(put, /if \(isBlank\(declared\)\) \{[\s\S]*?flags\.push\(false\);[\s\S]*?bases\.push\(null\);/);
  // A declared figure records WHO and WHEN, because the date is what divides the
  // volume already inside the number from the volume that arrives afterwards.
  assert.match(put, /update\.cellFillOverrideValues = bases;/);
  assert.match(put, /update\.cellFillOverrideAt = stamps;/);
  assert.match(put, /update\.cellFillOverrideBy = authors;/);
  // Re-saving the SAME figure must not restart the accumulation window.
  assert.match(put, /stamps\.push\(unchanged \? storedAt\[index\] : now\);/);

  // The flag is sent by the form that has the input…
  assert.match(readUi("pages", "admin", "SLFMonitoring.jsx"), /payload\.cellFillValuesDeclared = true;/);
  assert.match(readUi("pages", "admin", "slf-monitoring", "modals", "SlfEditModal.jsx"), /label="Waste in Cell"/);
  // …and NOT by the Cell Infrastructure editor, which only carries the stored
  // fills through and remaps them when cells are added, removed or reordered.
  assert.doesNotMatch(
    readUi("pages", "admin", "CellInfraOverview.jsx"),
    /cellFillValuesDeclared/,
    "inferring a declaration there would mark a reordered cell as hand-set",
  );
  // An incoming flag array is never trusted — the whole declaration is carried
  // from the stored record, never from the request.
  const merge = slice(facilities, "function mergeCellInfrastructureUpdate(update, record", "async function enrichPortalFacilityVolumes");
  ["cellFillOverridden", "cellFillOverrideValues", "cellFillOverrideUnits", "cellFillOverrideAt", "cellFillOverrideBy"]
    .forEach((key) => assert.match(merge, new RegExp(`carryDerived\\("${key}"`)));
  // …and it follows its CELL when cells are inserted, deleted or reordered.
  // Positional carry-forward slid every declaration onto its neighbour.
  assert.match(merge, /const from = sourceIndexOf\(index\);/);
  // A NEW cell sends an explicit null; Number(null) is 0, so the blank has to be
  // rejected BEFORE coercion or every added cell inherits stored cell 0's
  // declaration.
  assert.match(merge, /if \(raw === null \|\| raw === undefined \|\| raw === ""\) return null;/);
  assert.match(
    readUi("pages", "admin", "CellInfraOverview.jsx"),
    /cellOriginIndexes: editCells\.map\(/,
    "the editor that reorders cells must send its own mapping",
  );
  // …and every override array stays length-aligned when cells are added/removed.
  assert.match(facilities, /"cellFillOverrideValues", "cellFillOverrideUnits", "cellFillOverrideAt", "cellFillOverrideBy",\n\];/);
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
