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
  // …while pending and acknowledged both do, which is the app's existing rule.
  ["pending", "acknowledged", "revert_requested"].forEach((status) => {
    const occ = computeCellOccupancy(FACILITY, [submission("x", 100, "2026-03-01", 0, status)]);
    assert.equal(occ.rows[0].total, 100, `${status} must count`);
  });
});

// ── Scenario 5/6/7 — the override's whole life ──────────────────────────────
test("declare → approve → recompute: the declaration holds and the approval lands", () => {
  let facility = { ...FACILITY };
  const entries = [submission("s1", 100, "2026-03-01", 0)];

  // Automatic value: 100.
  facility = persist(facility, computeCellOccupancy(facility, entries));
  assert.equal(facility.cellFillValues[0], 100);

  // Scenario 5 — the admin declares 120 for Cell 1.
  facility = declare(facility, 0, 120, "2026-04-01");
  let occ = computeCellOccupancy(facility, entries);
  facility = persist(facility, occ);
  assert.equal(occ.rows[0].total, 120, "the admin's figure is what the cell reports");

  // …and it survives refetch / reload / any number of recomputes.
  for (let i = 0; i < 5; i += 1) {
    occ = computeCellOccupancy(facility, entries);
    facility = persist(facility, occ);
  }
  assert.equal(occ.rows[0].total, 120, "the override neither decays nor compounds");

  // Scenario 6 — a new submission is approved AFTER the override.
  entries.unshift(submission("s2", 10, "2026-04-05", 0));
  occ = computeCellOccupancy(facility, entries);
  facility = persist(facility, occ);
  assert.equal(occ.rows[0].total, 130, "120 held, and the 10 t was recorded — not 110, not 120");
  assert.equal(occ.rows[0].overrideBase, 120);
  assert.equal(occ.rows[0].postOverrideSubmitted, 10);
  assert.equal(occ.rows[0].derivedTotal, 110, "what the data alone says is still available");

  // Scenario 9 — several approvals landing close together each land once.
  entries.unshift(submission("s3", 5, "2026-04-06", 0));
  entries.unshift(submission("s4", 5, "2026-04-06", 0));
  occ = computeCellOccupancy(facility, entries);
  facility = persist(facility, occ);
  assert.equal(occ.rows[0].total, 140);

  // Repeated recomputes over the same set stay put — no lost or double updates.
  const settled = computeCellOccupancy(persist(facility, occ), entries);
  assert.equal(settled.rows[0].total, 140);

  // Scenario 7 — the admin clears the field: back to the canonical automatic
  // value, which is every submission counted once.
  facility = clearDeclaration(facility, 0);
  occ = computeCellOccupancy(facility, entries);
  assert.equal(occ.rows[0].total, 120, "100 + 10 + 5 + 5, derived");
  assert.equal(occ.rows[0].overridden, undefined);
});

test("re-declaring absorbs what accumulated, and starts a fresh window", () => {
  const entries = [submission("after", 10, "2026-04-05", 0), submission("before", 100, "2026-03-01", 0)];
  let facility = declare({ ...FACILITY }, 0, 120, "2026-04-01");
  assert.equal(computeCellOccupancy(facility, entries).rows[0].total, 130);

  // The admin now declares 130 — the figure they can see — with a later stamp.
  facility = declare(facility, 0, 130, "2026-04-10");
  const occ = computeCellOccupancy(facility, entries);
  assert.equal(occ.rows[0].total, 130, "the 10 t is inside the new declaration, not added again");
  assert.equal(occ.rows[0].postOverrideSubmitted, 0);
});

test("an override on one cell leaves every other cell fully automatic", () => {
  const entries = [
    submission("a", 100, "2026-03-01", 0),
    submission("b", 60, "2026-04-05", 1),
  ];
  const facility = declare({ ...FACILITY }, 0, 120, "2026-04-01");
  const occ = computeCellOccupancy(facility, entries);
  assert.equal(occ.rows[0].total, 120);
  assert.equal(occ.rows[0].overridden, true);
  assert.equal(occ.rows[1].total, 60);
  assert.equal(occ.rows[1].overridden, undefined, "Cell 2 is derived, and says so");
});

test("the facility total and the sum of its cells stay reconcilable under an override", () => {
  const entries = [
    submission("placed", 100, "2026-03-01", 0),
    { ...submission("unplaced", 40, "2026-03-02", 0), trucks: [{ actualVolume: 40, actualVolumeUnit: "tons", wasteType: "Residual", cellIndex: null, vehicles: [] }] },
  ];
  const facility = declare({ ...FACILITY }, 0, 120, "2026-04-01");
  const occ = computeCellOccupancy(facility, entries);
  // Waste awaiting placement is reported, never attributed to a cell nobody chose.
  assert.equal(occ.unplacedTotal, 40);
  assert.equal(occ.cellTotal, 120);
  assert.equal(occ.totalVolume, 160, "cells + unplaced");
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
  assert.equal(occ.rows[1].total, 300, "cell C keeps its declared figure at its new index");
  assert.equal(occ.rows[0].overridden, undefined, "cell B did not inherit one");
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
