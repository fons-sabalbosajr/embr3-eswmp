/**
 * The admin override, exercised as a LIFECYCLE rather than as a single call.
 *
 * The unit tests beside this one pin what computeCellOccupancy returns for a
 * given facility + entry set. What they cannot see is the loop the live system
 * actually runs:
 *
 *     compute → PERSIST cellFillValues → recompute from the persisted document
 *
 * Every bug this feature has had lived in that loop, not in a single call: a
 * figure that was right once and wrong on the next write, a base read back out
 * of the value it produced, a declaration that drifted onto the wrong cell when
 * a cell above it was deleted. So these tests replay the sequences from the
 * override's acceptance criteria end to end, persisting between steps exactly as
 * refreshFacilityCellOccupancy does.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { computeCellOccupancy } = require("../utils/cellOccupancy");
const { mergeCellInfrastructureUpdate } = require("../routes/slfFacilities");

const FACILITY = {
  numberOfCell: 3,
  cellNames: ["CELL 01", "CELL 02", "CELL 03"],
  cellStatuses: ["Active Cell", "Active Cell", "Active Cell"],
  cellTypes: ["Residual", "Residual", "Residual"],
  cellCapacities: [1000, 1000, 1000],
  cellCapacityUnits: ["tons", "tons", "tons"],
  cellFillUnits: ["tons", "tons", "tons"],
};

const submission = (id, volume, createdAt, cellIndex = 0, status = "acknowledged") => ({
  _id: id,
  status,
  baselineUnit: "tons",
  createdAt: new Date(createdAt),
  dateOfDisposal: new Date(createdAt),
  trucks: [{ actualVolume: volume, actualVolumeUnit: "tons", wasteType: "Residual", cellIndex, vehicles: [] }],
});

/** A truck that splits its load across vehicles — the truck level stays 0. */
const multiVehicle = (id, createdAt, loads) => ({
  _id: id,
  status: "acknowledged",
  baselineUnit: "tons",
  createdAt: new Date(createdAt),
  dateOfDisposal: new Date(createdAt),
  trucks: [
    {
      actualVolume: 0,
      actualVolumeUnit: "tons",
      wasteType: "Residual",
      vehicles: loads.map(([volume, cellIndex]) => ({
        actualVolume: volume,
        actualVolumeUnit: "tons",
        wasteType: "Residual",
        cellIndex,
      })),
    },
  ],
});

/** EXACTLY what refreshFacilityCellOccupancy writes back onto the facility. */
function persist(facility, occupancy) {
  return {
    ...facility,
    cellFillValues: occupancy.cellFillValues,
    cellFillUnits: occupancy.cellFillUnits,
    cellFillBaselineValues: occupancy.cellFillBaselineValues,
    cellFillSubmittedValues: occupancy.cellFillSubmittedValues,
    actualResidualWasteReceived: occupancy.totalVolume,
    wasteReceivedUnit: occupancy.unit,
  };
}

/** What the PUT handler writes when an admin types a figure for one cell. */
function declare(facility, index, value, at, unit = "tons") {
  const size = Math.max(facility.numberOfCell, index + 1);
  const grow = (arr, empty) => Array.from({ length: size }, (_, i) => (arr || [])[i] ?? empty);
  return {
    ...facility,
    cellFillOverridden: grow(facility.cellFillOverridden, false).map((f, i) => (i === index ? true : f === true)),
    cellFillOverrideValues: grow(facility.cellFillOverrideValues, null).map((v, i) => (i === index ? value : v)),
    cellFillOverrideUnits: grow(facility.cellFillOverrideUnits, null).map((u, i) => (i === index ? unit : u)),
    cellFillOverrideAt: grow(facility.cellFillOverrideAt, null).map((d, i) => (i === index ? new Date(at) : d)),
  };
}

/** Clearing the field: the declaration is removed, not merely un-flagged. */
function clearDeclaration(facility, index) {
  const blank = (arr, empty) => (arr || []).map((v, i) => (i === index ? empty : v));
  return {
    ...facility,
    cellFillOverridden: blank(facility.cellFillOverridden, false),
    cellFillOverrideValues: blank(facility.cellFillOverrideValues, null),
    cellFillOverrideUnits: blank(facility.cellFillOverrideUnits, null),
    cellFillOverrideAt: blank(facility.cellFillOverrideAt, null),
  };
}

// ── Scenario 2/3/4 — submit, approve, approve again ─────────────────────────
test("approvals accumulate into the right cell and nothing is counted twice", () => {
  let facility = { ...FACILITY };
  const entries = [];

  const step = (entry) => {
    if (entry) entries.unshift(entry); // newest first, as the query returns them
    const occ = computeCellOccupancy(facility, entries);
    facility = persist(facility, occ);
    return occ;
  };

  assert.equal(step(null).totalVolume, 0, "an SLF with no submissions holds nothing");

  const first = step(submission("s1", 100, "2026-03-01", 0));
  assert.equal(first.rows[0].total, 100);
  assert.equal(first.totalVolume, 100);

  const second = step(submission("s2", 50, "2026-03-02", 0));
  assert.equal(second.rows[0].total, 150, "the second approval adds, it does not replace");
  assert.equal(second.totalVolume, 150);

  const other = step(submission("s3", 25, "2026-03-03", 2));
  assert.equal(other.rows[0].total, 150, "Cell 1 is untouched by a load placed in Cell 3");
  assert.equal(other.rows[2].total, 25);
  assert.equal(other.totalVolume, 175);

  // Scenario 8 — recomputing from the persisted document changes nothing.
  const reload = computeCellOccupancy(facility, entries);
  assert.deepEqual(reload.cellFillValues, other.cellFillValues, "a reload must not move the numbers");
});

test("a multi-vehicle submission counts its vehicles, not its zeroed truck", () => {
  // The truck level is 0 here. Reading it alone is what made a busy facility's
  // cells stay empty while waste was being placed in them every day.
  const occ = computeCellOccupancy(FACILITY, [multiVehicle("m1", "2026-03-01", [[30, 0], [20, 1]])]);
  assert.equal(occ.rows[0].total, 30);
  assert.equal(occ.rows[1].total, 20);
  assert.equal(occ.totalVolume, 50);
});

test("a rejected or reverted submission does not fill a cell", () => {
  ["rejected", "reverted"].forEach((status) => {
    const occ = computeCellOccupancy(FACILITY, [submission("x", 100, "2026-03-01", 0, status)]);
    assert.equal(occ.rows[0].total, 0, `${status} must not count`);
  });
  // Waste in Cell = baseline + APPROVED. revert_requested is still approved until
  // EMB actually reverts it. Pending only reserves capacity.
  ["acknowledged", "revert_requested"].forEach((status) => {
    const occ = computeCellOccupancy(FACILITY, [submission("x", 100, "2026-03-01", 0, status)]);
    assert.equal(occ.rows[0].total, 100, `${status} must count`);
  });
  const pending = computeCellOccupancy(FACILITY, [submission("x", 100, "2026-03-01", 0, "pending")]);
  assert.equal(pending.rows[0].total, 0, "pending is not yet in the cell");
  assert.equal(pending.cellFillPendingValues[0], 100, "…but it holds the capacity");
});

// ── No override: the formula always wins (occupancy calc v6) ────────────────
test("a stored admin declaration no longer replaces baseline + approved submissions", () => {
  // The Porac defect: cells read the typed 1,310,353 / 683,202 m³ while their
  // own baseline alone was larger, so baseline and approvals were invisible.
  const entries = [submission("s2", 10, "2026-04-05", 0), submission("s1", 100, "2026-03-01", 0)];
  const facility = declare({ ...FACILITY }, 0, 120, "2026-04-01");
  const occ = computeCellOccupancy(facility, entries);
  assert.equal(occ.rows[0].total, 110, "100 + 10 approved — the typed 120 is not used");
  assert.equal(occ.rows[0].overridden, undefined, "nothing is presented as overridden");
  assert.equal(occ.rows[0].legacyOverride, 120, "the old declaration stays visible for audit");
  // Stable across recomputes from the persisted document.
  const again = computeCellOccupancy(persist(facility, occ), entries);
  assert.deepEqual(again.cellFillValues, occ.cellFillValues);
});

test("the facility total and the sum of its cells stay reconcilable", () => {
  const entries = [
    submission("placed", 100, "2026-03-01", 0),
    { ...submission("unplaced", 40, "2026-03-02", 0), trucks: [{ actualVolume: 40, actualVolumeUnit: "tons", wasteType: "Residual", cellIndex: null, vehicles: [] }] },
  ];
  const occ = computeCellOccupancy(declare({ ...FACILITY }, 0, 120, "2026-04-01"), entries);
  // Waste awaiting placement is reported, never attributed to a cell nobody chose.
  assert.equal(occ.unplacedTotal, 40);
  assert.equal(occ.cellTotal, 100);
  assert.equal(occ.totalVolume, 140, "cells + unplaced");
});

// ── The declaration has to stay attached to ITS cell ────────────────────────
test("deleting a cell moves each declaration with its cell, not onto its neighbour", () => {
  const record = {
    numberOfCell: 3,
    cellNames: ["A", "B", "C"],
    cellStatuses: ["Active Cell", "Active Cell", "Active Cell"],
    cellTypes: ["Residual", "Residual", "Residual"],
    cellCapacities: [10, 20, 30],
    cellCapacityUnits: ["tons", "tons", "tons"],
    cellFillValues: [1, 2, 3],
    cellFillUnits: ["tons", "tons", "tons"],
    // Only the THIRD cell is admin-declared.
    cellFillOverridden: [false, false, true],
    cellFillOverrideValues: [null, null, 300],
    cellFillOverrideUnits: [null, null, "tons"],
    cellFillOverrideAt: [null, null, new Date("2026-04-01")],
    cellFillOverrideBy: ["", "", "admin@embr3"],
  };
  // The editor deletes cell A; the two survivors came from original 1 and 2.
  const update = {
    numberOfCell: 2,
    cellNames: ["B", "C"],
    cellStatuses: ["Active Cell", "Active Cell"],
    cellTypes: ["Residual", "Residual"],
    cellCapacities: [20, 30],
    cellCapacityUnits: ["tons", "tons"],
    cellFillValues: [2, 3],
    cellFillUnits: ["tons", "tons"],
  };
  mergeCellInfrastructureUpdate(update, record, { authoritative: true, originIndexes: [1, 2] });

  assert.deepEqual(update.cellFillOverridden, [false, true], "the declaration followed cell C");
  assert.deepEqual(update.cellFillOverrideValues, [null, 300]);
  assert.deepEqual(update.cellFillOverrideBy, ["", "admin@embr3"]);
  assert.equal(String(update.cellFillOverrideAt[1]), String(record.cellFillOverrideAt[2]));

  // …and the remapped arrays are what the calculation then reads.
  const facility = { ...record, ...update };
  const occ = computeCellOccupancy(facility, [submission("s", 5, "2026-03-01", 0)]);
  // The declaration is audit-only now, but it must still sit on the right cell.
  assert.equal(occ.rows[1].legacyOverride, 300, "cell C keeps its declaration at its new index");
  assert.equal(occ.rows[0].legacyOverride, undefined, "cell B did not inherit one");
});

test("a newly added cell starts with no declaration of its own", () => {
  const record = {
    numberOfCell: 1,
    cellStatuses: ["Active Cell"],
    cellFillValues: [5],
    cellFillUnits: ["tons"],
    cellFillOverridden: [true],
    cellFillOverrideValues: [5],
    cellFillOverrideUnits: ["tons"],
    cellFillOverrideAt: [new Date("2026-04-01")],
    cellFillOverrideBy: ["admin@embr3"],
  };
  const update = {
    numberOfCell: 2,
    cellStatuses: ["Active Cell", "Active Cell"],
    cellFillValues: [5, null],
    cellFillUnits: ["tons", "tons"],
  };
  mergeCellInfrastructureUpdate(update, record, { authoritative: true, originIndexes: [0, null] });
  assert.deepEqual(update.cellFillOverridden, [true, false]);
  assert.equal(update.cellFillOverrideValues[1], null);
  assert.equal(update.cellFillOverrideAt[1], null);
});

test("a partial payload with no mapping still carries every declaration forward", () => {
  const record = {
    numberOfCell: 2,
    cellStatuses: ["Active Cell", "Active Cell"],
    cellFillValues: [1, 2],
    cellFillUnits: ["tons", "tons"],
    cellFillOverridden: [false, true],
    cellFillOverrideValues: [null, 200],
    cellFillOverrideUnits: [null, "tons"],
    cellFillOverrideAt: [null, new Date("2026-04-01")],
    cellFillOverrideBy: ["", "admin@embr3"],
  };
  const update = { cellStatuses: ["Active Cell", "Used/Completed"] };
  mergeCellInfrastructureUpdate(update, record, {});
  assert.deepEqual(update.cellFillOverridden, [false, true]);
  assert.deepEqual(update.cellFillOverrideValues, [null, 200]);
});
