/**
 * SLF Data Table accuracy: which submissions count toward Waste in Cell, and
 * that every write that changes the inputs recomputes it.
 *
 * Production, 2026-11-09:
 *   • Limay, Prime Waste Solution and Maria Aurora kept their baseline on their
 *     submissions; a container was only created later by the portal's first
 *     baseline save, COPYING the same figures. Dating the pre-baseline cutoff from
 *     that copy excluded 94 / 21 / 19 submissions from the cells.
 *   • PATCH /portal-save-baseline never recomputed the cells, so a new baseline
 *     reached no gauge until an unrelated write touched the facility.
 *
 * Run: node --test tests/cellTallyAccuracy.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  baselineCutoffDate,
  baselineFingerprint,
  applyPreBaselineRule,
  OCCUPANCY_CALC_VERSION,
} = require("../utils/cellOccupancy");

const day = (s) => new Date(`${s}T08:00:00Z`);
const baselineCopy = (createdAt, extra = {}) => ({
  _id: `b-${createdAt}`,
  createdAt: day(createdAt),
  totalVolumeAccepted: 72754.72,
  activeCellEntries: [{ volume: 9663.63, cellName: "Cell 1", unit: "m³" }],
  ...extra,
});
const submission = (createdAt, disposal, extra = {}) => ({
  _id: `s-${createdAt}`,
  createdAt: day(createdAt),
  dateOfDisposal: day(disposal),
  trucks: [{ actualVolume: 10 }],
  totalVolumeAccepted: 72754.72,
  activeCellEntries: [{ volume: 9663.63, cellName: "Cell 1", unit: "m³" }],
  ...extra,
});

test("a container that copied existing figures is dated from the first record carrying them", () => {
  const container = baselineCopy("2026-08-29", {
    // Bookkeeping that changes without any re-encoding must not matter.
    activeCellResidualVolume: 9663.63,
    activeCellEntries: [{ volume: 9663.63, cellName: "Cell 1", cellIndex: 0, unit: "m³" }],
  });
  const entries = [container, submission("2026-07-01", "2026-06-30"), submission("2026-05-15", "2026-05-15")];
  assert.equal(baselineCutoffDate(entries, container).toISOString().slice(0, 10), "2026-05-15");
  const { excludedCount } = applyPreBaselineRule(entries, { exclude: true });
  assert.equal(excludedCount, 0, "submissions after the real encoding count toward the cells");
});

test("a container with re-encoded figures keeps its own date (the waste before it is inside)", () => {
  const container = baselineCopy("2026-08-28", {
    totalVolumeAccepted: 219563.92,
    activeCellEntries: [{ volume: 215369.2 }, { volume: 4194.71 }],
  });
  const entries = [container, submission("2026-07-22", "2026-07-22"), submission("2026-05-19", "2026-05-19")];
  assert.equal(baselineCutoffDate(entries, container).toISOString().slice(0, 10), "2026-08-28");
  assert.equal(applyPreBaselineRule(entries, { exclude: true }).excludedCount, 2);
});

test("the fingerprint compares only what the operator encodes", () => {
  const a = { totalVolumeAccepted: 100, activeCellEntries: [{ volume: 60, cellName: "Cell 1" }, { volume: 40 }] };
  const renamed = {
    totalVolumeAccepted: 100,
    activeCellResidualVolume: 999, // a rollup, recomputed on save
    activeCellEntries: [{ volume: 60, cellName: "Main cell", cellIndex: 0 }, { volume: 40, cellIndex: 1 }],
  };
  assert.equal(baselineFingerprint(a), baselineFingerprint(renamed));
  assert.notEqual(baselineFingerprint(a), baselineFingerprint({ ...a, totalVolumeAccepted: 101 }));
});

test("the calculation version moved so the startup sweep recomputes stored figures", () => {
  assert.ok(OCCUPANCY_CALC_VERSION >= 5);
});

test("a portal baseline save recomputes the facility's cells", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const start = src.indexOf('router.patch("/portal-save-baseline/:slfName"');
  const block = src.slice(start, src.indexOf("\nrouter.", start + 10));
  assert.match(block, /refreshOccupancyForFacilities\(req, \[genId \|\| latest\?\.slfGenerator\]\)/);
  assert.ok(
    block.indexOf("refreshOccupancyForFacilities(") > block.indexOf("res.json({"),
    "recomputed after the answer, so the save itself stays fast",
  );
});

test("Cell Waste Placement uses the portal's placement rule", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  assert.match(src, /\.\.\.cellAssignmentStages\(assignment, SlfFacility\.collection\.collectionName\)/);
  const filter = require("../utils/cellPlacementFilter");
  const stages = filter.cellAssignmentStages("unassigned");
  const json = JSON.stringify(stages);
  assert.match(json, /"\$lookup"/, "validates the cell id against the facility's cells");
  assert.match(json, /actualVolume/, "only waste that exists needs a cell");
  assert.doesNotMatch(json, /\$\$[tv]\.cellName/, "a name alone never counts as placed");
  // The guard must be able to fail: it does match the old rule's shape.
  assert.match('{"in":{"cellName":"$$t.cellName"}}', /\$\$[tv]\.cellName/);
  assert.deepEqual(stages[stages.length - 1], { $match: { _unplaced: { $gt: 0 } } });
});

test("the developer portal picker names facilities as Province - SLF Name", () => {
  // Shared by the Developer Portal and Planning Unit pickers (utils/portalUserPicker).
  const { facilityLabel } = require("../utils/portalUserPicker");
  assert.equal(
    facilityLabel({ lgu: "Aurora - LGU Baler Sanitary Landfill Facility", province: "Aurora" }),
    "Aurora - LGU Baler Sanitary Landfill Facility",
    "a name that already carries its province is used as-is",
  );
  assert.equal(
    facilityLabel({ lgu: "Bataan Engineered Sanitary Landfill Facility (BESLF)", province: "Bataan" }),
    "Bataan - Bataan Engineered Sanitary Landfill Facility (BESLF)",
  );
});
