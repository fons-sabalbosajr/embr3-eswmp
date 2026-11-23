/**
 * Cell occupancy — the lifecycle contract.
 *
 * `cellFillValues` is a PERSISTED denormalization that both the portal's
 * cell-availability gate and the admin gauges read. Every event that changes
 * whether a submission's volume counts has to recompute it, or the stored figure
 * silently drifts below reality — measured on production before this was wired
 * up: 8 of 16 facilities stale, one cell reading empty while holding 52.97.
 *
 * These tests pin (a) the counting rule and (b) the fact that each lifecycle
 * route actually calls the refresh, so a route added later cannot quietly skip it.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { ACTIVE_VOLUME_STATUSES, computeCellOccupancy } = require("../utils/cellOccupancy");

const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const routeBody = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  assert.ok(start > -1, `route not found: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `end marker not found after ${startMarker}`);
  return source.slice(start, end);
};

// ── The counting rule ───────────────────────────────────────────────────────
test("only pending / acknowledged / revert_requested count toward occupancy", () => {
  assert.deepEqual(
    [...ACTIVE_VOLUME_STATUSES].sort(),
    ["acknowledged", "pending", "revert_requested"],
  );
  // A reverted or rejected submission must NOT hold capacity.
  assert.equal(ACTIVE_VOLUME_STATUSES.has("reverted"), false);
  assert.equal(ACTIVE_VOLUME_STATUSES.has("rejected"), false);
});

const facility = {
  numberOfCell: 2,
  cellNames: ["Cell 1", "Cell 2"],
  cellStatuses: ["Active Cell", "Active Cell"],
  cellTypes: ["Residual", "Residual"],
  cellCapacities: [1000, 1000],
  cellCapacityUnits: ["m³", "m³"],
  cellFillUnits: ["m³", "m³"],
  volumeCapacityUnit: "m³",
};
const truck = (volume, cellIndex) => ({
  actualVolume: volume,
  actualVolumeUnit: "m³",
  wasteType: "Residual",
  cellIndex,
  cellName: `Cell ${cellIndex + 1}`,
});
const entry = (id, status, trucks) => ({ _id: id, status, baselineUnit: "m³", trucks });

test("multiple APPROVED entries into the SAME cell aggregate, they do not overwrite", () => {
  const occ = computeCellOccupancy(facility, [
    entry("a", "acknowledged", [truck(10, 0)]),
    entry("b", "acknowledged", [truck(15, 0)]),
    entry("c", "acknowledged", [truck(20, 0)]),
  ]);
  assert.equal(Math.round(occ.cellFillValues[0]), 45, "10 + 15 + 20");
  assert.equal(Math.round(occ.cellFillValues[1] || 0), 0, "the other cell is untouched");
});

test("Waste in Cell = baseline + APPROVED; pending is reserved against capacity, not in the cell", () => {
  const occ = computeCellOccupancy(facility, [
    entry("a", "acknowledged", [truck(10, 0)]),
    entry("c", "pending", [truck(20, 0)]),
  ]);
  assert.equal(Math.round(occ.cellFillValues[0]), 10, "only the approved load");
  assert.equal(Math.round(occ.cellFillPendingValues[0]), 20, "the pending load is held separately");
  assert.equal(Math.round(occ.totalVolume), 10, "nor is pending part of the received total");
});

test("a reverted submission releases its volume", () => {
  const before = computeCellOccupancy(facility, [
    entry("a", "acknowledged", [truck(10, 0)]),
    entry("b", "acknowledged", [truck(25, 0)]),
  ]);
  const after = computeCellOccupancy(facility, [
    entry("a", "acknowledged", [truck(10, 0)]),
    entry("b", "reverted", [truck(25, 0)]), // admin reverted it
  ]);
  assert.equal(Math.round(before.cellFillValues[0]), 35);
  assert.equal(Math.round(after.cellFillValues[0]), 10, "the reverted volume must leave the cell");
  assert.equal(Math.round(after.cellFillPendingValues[0]), 0, "…and holds no capacity either");
});

test("revert → correct → resubmit counts the CORRECTED volume once, never X + Y", () => {
  // Submitted 25 into Cell 1, reverted, corrected to 40 and moved to Cell 2.
  const resubmitted = computeCellOccupancy(facility, [
    entry("a", "acknowledged", [truck(10, 0)]),
    entry("b", "pending", [truck(40, 1)]), // same record, updated in place, awaiting review
  ]);
  assert.equal(Math.round(resubmitted.cellFillValues[0]), 10, "the old placement is gone");
  assert.equal(Math.round(resubmitted.cellFillValues[1]), 0, "not in the cell until approved");
  assert.equal(Math.round(resubmitted.cellFillPendingValues[1]), 40, "but its capacity is reserved");
  const approved = computeCellOccupancy(facility, [
    entry("a", "acknowledged", [truck(10, 0)]),
    entry("b", "acknowledged", [truck(40, 1)]),
  ]);
  assert.equal(Math.round(approved.cellFillValues[1]), 40, "only the corrected volume, once approved");
});

test("the calculation is a RECOMPUTE — running it twice changes nothing", () => {
  const entries = [entry("a", "acknowledged", [truck(12.5, 0)]), entry("b", "pending", [truck(7.5, 1)])];
  const first = computeCellOccupancy(facility, entries);
  const second = computeCellOccupancy(facility, entries);
  assert.deepEqual(first.cellFillValues, second.cellFillValues, "idempotent: no accumulation");
});

// ── Every lifecycle route refreshes ─────────────────────────────────────────
const LIFECYCLE_ROUTES = [
  ["submit", "async function submitEntries", "// Submit SLF data — batch (client portal)"],
  ["resubmit", 'router.put("/:id", optionalAuth', 'router.get("/baseline/:slfName"'],
  ["portal organize cells", 'router.patch("/:id/portal-cell-assignments"', "// ── Portal: BULK cell organization"],
  ["bulk organize cells", 'router.post("/portal-cell-assignments/bulk"', 'router.patch("/:id/admin-edit"'],
  ["admin cell assignments", 'router.patch("/:id/cell-assignments"', 'router.patch("/:id/portal-cell-assignments"'],
  ["status change", 'router.patch("/:id/status"', 'router.patch("/bulk-status"'],
  ["bulk status", 'router.patch("/bulk-status"', 'router.post("/bulk-delete"'],
  ["bulk delete", 'router.post("/bulk-delete"', 'router.patch("/bulk-revert"'],
  ["soft delete", 'router.delete("/:id", async', 'router.get("/trash/list"'],
  ["restore", 'router.patch("/:id/restore"', 'router.delete("/:id/permanent"'],
  ["permanent delete", 'router.delete("/:id/permanent"', 'router.patch("/:id/request-revert"'],
];

test("every route that changes whether volume counts refreshes occupancy", () => {
  const missing = LIFECYCLE_ROUTES.filter(([, start, end]) => {
    const body = routeBody(start, end);
    return !/refreshOccupancyForFacilities|refreshFacilityCellOccupancy/.test(body);
  }).map(([name]) => name);
  assert.deepEqual(missing, [], `these routes would leave cellFillValues stale: ${missing.join(", ")}`);
});

test("the refresh helper de-duplicates facilities and never throws", () => {
  const helper = routeBody("async function refreshOccupancyForFacilities", "function getNameVariants");
  assert.match(helper, /new Set\(/, "a bulk action across one facility must recompute once");
  assert.match(helper, /ObjectId\.isValid/, "ignore malformed ids rather than crash");
  assert.match(helper, /catch \(error\)/, "a derived-figure failure must not fail the user's operation");
});
