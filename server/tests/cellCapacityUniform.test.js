/**
 * Cell capacities must read the same on the admin side, the portal and Portal
 * Submissions. They come from ONE rule, implemented twice (server and browser)
 * because both need it: server/utils/cellCapacity.js and
 * front-end/src/utils/cellCapacity.js. This runs the same cases through both and
 * requires identical answers, and checks that every reader goes through it.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = require("../utils/cellCapacity");
const browser = require("../../front-end/src/utils/cellCapacity.js");
const { evaluateFacilityCellAcceptance } = require("../utils/cellAvailability");

const root = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const CASES = [
  {
    name: "no unit declared anywhere → the facility default (tons) on both sides",
    facility: { numberOfCell: 1, cellCapacities: [1000], cellFillValues: [250] },
  },
  {
    name: "capacity in m³, fill stored in tons → fill converted before the %",
    facility: { numberOfCell: 1, cellCapacities: [1000], cellCapacityUnits: ["m³"], cellFillValues: [250], cellFillUnits: ["tons"] },
  },
  {
    name: "cell without its own unit inherits the facility's declared unit",
    facility: { numberOfCell: 2, volumeCapacityUnit: "m³", cellCapacities: [800, 400], cellCapacityUnits: ["tons"], cellFillValues: [100, 100], cellFillUnits: ["m³", "m³"] },
  },
  {
    name: "99.6% full reads 99, not 100",
    facility: { numberOfCell: 1, cellCapacities: [1000], cellCapacityUnits: ["m³"], cellFillValues: [996], cellFillUnits: ["m³"] },
  },
  {
    name: "over capacity reads 100 and reports the excess",
    facility: { numberOfCell: 1, cellCapacities: [100], cellCapacityUnits: ["m³"], cellFillValues: [130], cellFillUnits: ["m³"] },
  },
  {
    name: "no capacity → no %",
    facility: { numberOfCell: 1, cellCapacities: [0], cellFillValues: [50] },
  },
  {
    name: "pending review volume is carried in the capacity unit",
    facility: { numberOfCell: 1, cellCapacities: [1000], cellCapacityUnits: ["m³"], cellFillValues: [100], cellFillPendingValues: [50], cellFillUnits: ["tons"] },
  },
];

test("the server and the browser compute every cell identically", () => {
  for (const { name, facility } of CASES) {
    assert.deepEqual(browser.facilityCellCapacityRows(facility), server.facilityCellCapacityRows(facility), name);
    for (const unit of ["m³", "tons"]) {
      assert.deepEqual(
        browser.facilityCellCapacityRows(facility, { unit }),
        server.facilityCellCapacityRows(facility, { unit }),
        `${name} (in ${unit})`,
      );
    }
  }
});

test("the rule's answers", () => {
  const [plain] = server.facilityCellCapacityRows(CASES[0].facility);
  assert.deepEqual(
    { unit: plain.unit, capacity: plain.capacity, used: plain.used, pct: plain.pct, remaining: plain.remaining },
    { unit: "tons", capacity: 1000, used: 250, pct: 25, remaining: 750 },
  );
  const [mixed] = server.facilityCellCapacityRows(CASES[1].facility);
  assert.equal(mixed.used, 500, "250 t = 500 m³");
  assert.equal(mixed.pct, 50);
  const [, inherits] = server.facilityCellCapacityRows(CASES[2].facility);
  assert.equal(inherits.capacityUnit, "m³");
  assert.equal(server.cellPercent(996, 1000), 99);
  assert.equal(server.cellPercent(1000, 1000), 100);
  assert.equal(server.cellPercent(5, 1000), 1);
  assert.equal(server.cellPercent(50, 0), null);
  const [over] = server.facilityCellCapacityRows(CASES[4].facility);
  assert.deepEqual({ pct: over.pct, remaining: over.remaining, over: over.over }, { pct: 100, remaining: 0, over: 30 });
  const [pending] = server.facilityCellCapacityRows(CASES[6].facility);
  assert.equal(pending.pending, 100, "50 t pending = 100 m³");
});

test("the submit capacity gate judges a cell by the same units the screens show", () => {
  // A cell with no unit of its own at a facility that declares none: the screens
  // read 1,000 t capacity with 900 t in it (100 t left). The gate used to assume
  // m³ here — 1,000 m³ = 500 t — and so judged the cell already over-full.
  const facility = {
    numberOfCell: 1,
    cellStatuses: ["Active Cell"],
    cellCapacities: [1000],
    cellFillValues: [900],
  };
  const [row] = browser.facilityCellCapacityRows(facility);
  assert.deepEqual({ unit: row.unit, remaining: row.remaining, pct: row.pct }, { unit: "tons", remaining: 100, pct: 90 });
  const gate = evaluateFacilityCellAcceptance(facility, 0, 80, "tons");
  assert.equal(gate.ok, true, gate.reason);
  assert.equal(Math.round(gate.utilization), row.pct, "the gate's % is the screen's %");
  const tooMuch = evaluateFacilityCellAcceptance(facility, 0, 120, "tons");
  assert.equal(tooMuch.code, "insufficient", "120 t does not fit in the 100 t the screen shows as left");
});

test("every reader goes through the one rule", () => {
  const readers = {
    // server
    "server/utils/cellAvailability.js": /resolveCellUnit\(facility, idx, "capacity"\)/,
    "server/utils/portalReport.js": /cellCapacityRow\(facility, i, \{ unit: "tons" \}\)/,
    "server/utils/veraPortalFacts.js": /cellCapacityRow\(facility, i\)/,
    "server/routes/dataSLF.js": /pct: cellPercent\(row\.total, capacity\)/,
    // portal
    "front-end/src/pages/SLFPortal/OverviewPanel.jsx": /cellCapacityRow\(slfInfo, idx/,
    "front-end/src/pages/SLFPortal/AssignedSlfDashboard.jsx": /cellCapacityRow\(slfInfo, index\)/,
    "front-end/src/pages/SLFPortal/submissionCellUsage.js": /facilityCellCapacityRows\(slfInfo\)/,
    "front-end/src/pages/SLFPortal/CellOrganizerModal.jsx": /cellPercent\(fill, capacity\)/,
    "front-end/src/pages/SLFPortal/hooks/useSubmitSubmission.jsx": /resolveCellUnit\(slfInfo, idx, "capacity"\)/,
    // admin
    "front-end/src/pages/admin/SLFMonitoring.jsx": /cellCapacityRow\(facility, i, \{ unit \}\)/,
    "front-end/src/pages/admin/slf-monitoring/modals/SlfDetailModal.jsx": /cellCapacityRow\(detailViewRecord, i\)/,
    "front-end/src/pages/admin/slf-monitoring/modals/SlfEditModal.jsx": /cellPercent\(fillInCapacityUnit, cap\)/,
    "front-end/src/pages/admin/CellInfraOverview.jsx": /cellPercent\(used, cap\)/,
    "front-end/src/pages/admin/SubmissionSummary.jsx": /cellPercent\(used, capacity\)/,
    "front-end/src/pages/admin/SlfSubmissionReport.jsx": /cellCapacityRow\(fac, i\)/,
    "front-end/src/pages/AdminHome/DashboardContent.jsx": /percent: cellPercent\(fill, cap\)/,
  };
  for (const [file, pattern] of Object.entries(readers)) assert.match(read(file), pattern, file);
});

test("the persisted figures count the same submissions as the admin rollups", () => {
  const dataSlf = read("server/routes/dataSLF.js");
  const refresh = dataSlf.slice(
    dataSlf.indexOf("async function refreshFacilityCellOccupancy"),
    dataSlf.indexOf("const occupancy = computeCellOccupancy(facility, counted, { unitSource: entries });"),
  );
  assert.match(refresh, /setOptions\(\{ includeHiddenYears: true \}\)/, "hidden years are still in the cell");
  assert.match(refresh, /facility\.isDummy \? \{\} : \{ isDummy: \{ \$ne: true \} \}/);
  const backfill = read("server/utils/backfillCellOccupancy.js");
  assert.match(backfill, /\.setOptions\(\{ includeHiddenYears: true \}\)\n\s+\/\/ `dateOfDisposal`/);
  const { OCCUPANCY_CALC_VERSION } = require("../utils/cellOccupancy");
  assert.ok(OCCUPANCY_CALC_VERSION >= 7, "stored figures are recomputed under the aligned scope");
});
