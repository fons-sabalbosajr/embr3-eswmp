/**
 * The portal user's own disposal report.
 *
 * Two properties matter here and neither is visible from the output:
 *
 *   1. SCOPE. The report may only ever contain the caller's own submissions.
 *      That is enforced by the query (identity from the token, filtered on that
 *      email) rather than by a check the next edit could forget, and the tests
 *      below read the route to pin it — a leak here would hand one facility's
 *      disposal record to another operator.
 *
 *   2. RECONCILIATION. The operator's figures must agree with the admin's for the
 *      same period. That means the volume rule has to be the SHARED one
 *      (ACTIVE_VOLUME_STATUSES), not a second copy: a reverted submission is
 *      counted as having happened but contributes no volume, because its waste no
 *      longer stands.
 *
 * Pure — no database. Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildPortalReport, countsTowardVolume } = require("../utils/portalReport");
const { ACTIVE_VOLUME_STATUSES } = require("../utils/cellOccupancy");

const FACILITY = {
  lgu: "Pampanga - Test Enviro Park",
  province: "Pampanga",
  statusOfSLF: "OPERATIONAL",
  numberOfCell: 3,
  cellNames: ["Cell 4", "Cell 6", "Cell 9"],
  cellStatuses: ["Active Cell", "Active Cell", "Not Existed"],
  cellCapacities: [1000, 500, 0],
  cellFillValues: [250, 100, 0],
  cellTypes: ["Residual", "Treated Hazardous Waste", "Residual"],
};

const ACK = {
  idNo: "A1",
  status: "acknowledged",
  dateOfDisposal: "2026-07-12T00:00:00.000Z",
  // Declared in TONS so the expectations below read in the same unit as the
  // figures. A fixture with no unit means m³, which is halved on the way in.
  baselineUnit: "tons",
  totalVolumeTons: 30,
  residualVolumeTons: 24,
  hazardousVolumeTons: 6,
  trucks: [
    {
      hauler: "GREEN RESCUE",
      truckCapacity: 30,
      vehicles: [
        { actualVolume: 18, cellName: "Cell 4", wasteType: "Residual", capacity: 30, selectedClients: [{ clientName: "LGU of Pulilan" }] },
        { actualVolume: 6, cellName: "Cell 4", wasteType: "Residual", capacity: 30, selectedClients: ["MUNICIPALITY OF GUAGUA"] },
      ],
    },
    {
      hauler: "SERVO TREAT",
      truckCapacity: 15,
      vehicles: [
        { actualVolume: 6, cellName: "Cell 6", wasteType: "Treated Hazardous Waste", capacity: 15, selectedClients: [{ clientName: "SERVO TREAT" }] },
      ],
    },
  ],
};

const REVERTED = {
  idNo: "A2",
  status: "reverted",
  dateOfDisposal: "2026-07-13T00:00:00.000Z",
  baselineUnit: "tons",
  totalVolumeTons: 99,
  residualVolumeTons: 99,
  trucks: [{ hauler: "GREEN RESCUE", vehicles: [{ actualVolume: 99, cellName: "Cell 4", capacity: 30 }] }],
};

// ── The volume rule ──────────────────────────────────────────────────────────

test("volume counts for exactly the shared set of statuses, not a second copy", () => {
  // If these ever diverge, an operator's report stops reconciling with the
  // admin's for the same period and neither side can explain the difference.
  for (const status of ACTIVE_VOLUME_STATUSES) {
    assert.equal(countsTowardVolume(status), true, `${status} should carry volume`);
  }
  for (const status of ["reverted", "rejected"]) {
    assert.equal(countsTowardVolume(status), false, `${status} should not carry volume`);
  }
  // A legacy record with no status reads as pending, matching every other consumer.
  assert.equal(countsTowardVolume(""), true);
  assert.equal(countsTowardVolume(undefined), true);
});

test("a reverted submission is COUNTED but contributes no volume", () => {
  const r = buildPortalReport([ACK, REVERTED], { facility: FACILITY });
  assert.equal(r.totals.submissions, 2, "it happened, so it is reported");
  assert.equal(r.totals.volumeBearingSubmissions, 1, "…but only one carries volume");
  assert.equal(r.totals.totalTons, 30, "the reverted 99t is excluded");
  assert.equal(r.totals.residualTons, 24);
  assert.equal(r.totals.hazardousTons, 6);
  assert.equal(r.statuses.reverted, 1);
  assert.equal(r.outstanding.revertedSubmissions, 1);
  // …and its trips do not inflate the breakdowns either.
  assert.equal(r.byHauler.find((h) => h.name === "GREEN RESCUE").trips, 2);
});

test("the report explains its own arithmetic", () => {
  // Without volumeBearingSubmissions a reader cannot tell why 2 submissions
  // produced one submission's worth of tonnage.
  const r = buildPortalReport([ACK, REVERTED], { facility: FACILITY });
  assert.ok(r.totals.volumeBearingSubmissions < r.totals.submissions);
  assert.match(r.scope.description, /this portal account/i);
});

// ── The parts must sum to the whole ──────────────────────────────────────────

test("volumes are normalised to tons, whichever unit the record used", () => {
  // TON_PER_M3 is 0.5, so 100 m³ is 50 tons. Summing raw values as if they were
  // tons is what made the per-hauler figures exceed the header total against live
  // data (5,045 t of haulers under a stated 1,464 t).
  const inM3 = {
    idNo: "M1", status: "acknowledged", dateOfDisposal: "2026-07-12T00:00:00.000Z", baselineUnit: "m³",
    trucks: [{ hauler: "H", vehicles: [{ actualVolume: 100, actualVolumeUnit: "m³", cellName: "Cell 4", wasteType: "Residual" }] }],
  };
  const inTons = {
    idNo: "T1", status: "acknowledged", dateOfDisposal: "2026-07-12T00:00:00.000Z", baselineUnit: "tons",
    trucks: [{ hauler: "H", vehicles: [{ actualVolume: 50, actualVolumeUnit: "tons", cellName: "Cell 4", wasteType: "Residual" }] }],
  };
  assert.equal(buildPortalReport([inM3]).totals.totalTons, 50);
  assert.equal(buildPortalReport([inTons]).totals.totalTons, 50);
  // The same load in either unit reports the same tonnage.
  assert.equal(
    buildPortalReport([inM3]).byHauler[0].tons,
    buildPortalReport([inTons]).byHauler[0].tons,
  );
});

test("totals come from the walk, NOT the denormalized field", () => {
  // Records written before both units were populated in lockstep carry
  // totalVolumeTons: 0 alongside a real m³ figure — live example
  // SLF-LGU-BA-0100: 188.16 m³, 0 tons. Trusting that field understated the
  // facility by more than half.
  const legacy = {
    idNo: "L1", status: "acknowledged", dateOfDisposal: "2026-07-12T00:00:00.000Z", baselineUnit: "m³",
    totalVolumeM3: 100, totalVolumeTons: 0, residualVolumeTons: 0,
    trucks: [{ hauler: "H", vehicles: [{ actualVolume: 100, actualVolumeUnit: "m³", cellName: "Cell 4", wasteType: "Residual" }] }],
  };
  const r = buildPortalReport([legacy]);
  assert.equal(r.totals.totalTons, 50, "derived from the trucks, not the zeroed field");
  assert.equal(r.totals.residualTons, 50);
});

test("every breakdown sums to the header total — by construction", () => {
  const r = buildPortalReport([ACK], { facility: FACILITY });
  const sum = (rows) => Number(rows.reduce((s, x) => s + x.tons, 0).toFixed(2));
  assert.equal(sum(r.byHauler), r.totals.totalTons);
  assert.equal(sum(r.byWasteType), r.totals.totalTons);
  assert.equal(sum(r.byCell), r.totals.totalTons);
  assert.equal(sum(r.monthly.map((m) => ({ tons: m.tons }))), r.totals.totalTons);
  assert.equal(
    Number((r.totals.residualTons + r.totals.hazardousTons).toFixed(2)),
    r.totals.totalTons,
    "residual + hazardous must be the whole",
  );
});

test("hazardous is classified by the shared rule, including legacy spellings", () => {
  const legacyHaz = {
    idNo: "H1", status: "acknowledged", dateOfDisposal: "2026-07-12T00:00:00.000Z", baselineUnit: "tons",
    trucks: [{ hauler: "H", vehicles: [{ actualVolume: 10, actualVolumeUnit: "tons", wasteType: "HW", cellName: "Cell 6" }] }],
  };
  const r = buildPortalReport([legacyHaz]);
  assert.equal(r.totals.hazardousTons, 10);
  assert.equal(r.totals.residualTons, 0);
});

// ── The breakdowns ───────────────────────────────────────────────────────────

test("volume and placement are read from VEHICLES when a truck carries them", () => {
  const r = buildPortalReport([ACK], { facility: FACILITY });
  assert.deepEqual(
    r.byCell.map((c) => [c.name, c.trips, c.tons]),
    [["Cell 4", 2, 24], ["Cell 6", 1, 6]],
  );
  assert.deepEqual(
    r.byWasteType.map((w) => [w.name, w.tons]),
    [["Residual", 24], ["Treated Hazardous Waste", 6]],
  );
});

test("a truck with no vehicles is read at the truck level rather than skipped", () => {
  const flat = {
    idNo: "B1",
    status: "acknowledged",
    dateOfDisposal: "2026-07-12T00:00:00.000Z",
    baselineUnit: "tons",
    totalVolumeTons: 12,
    trucks: [{ hauler: "FLAT HAULER", truckCapacity: 12, actualVolume: 12, actualVolumeUnit: "tons", cellName: "Cell 4", wasteType: "Residual" }],
  };
  const r = buildPortalReport([flat], { facility: FACILITY });
  assert.equal(r.byHauler[0].name, "FLAT HAULER");
  assert.equal(r.byHauler[0].tons, 12);
  assert.equal(r.byCell[0].name, "Cell 4");
});

test("clients are counted whether stored as objects or as plain strings", () => {
  const r = buildPortalReport([ACK], { facility: FACILITY });
  const names = r.byClient.map((c) => c.name).sort();
  assert.deepEqual(names, ["LGU of Pulilan", "MUNICIPALITY OF GUAGUA", "SERVO TREAT"]);
});

test("rankings are ordered by volume, biggest first", () => {
  const r = buildPortalReport([ACK], { facility: FACILITY });
  const tons = r.byClient.map((c) => c.tons);
  assert.deepEqual([...tons].sort((a, b) => b - a), tons);
});

test("months are keyed and sorted chronologically", () => {
  const august = { ...ACK, idNo: "A3", dateOfDisposal: "2026-08-01T00:00:00.000Z" };
  const r = buildPortalReport([august, ACK], { facility: FACILITY });
  assert.deepEqual(r.monthly.map((m) => m.month), ["2026-07", "2026-08"]);
});

// ── Facility cells ───────────────────────────────────────────────────────────

test("non-existent cells are left out and remaining space is derived", () => {
  const r = buildPortalReport([ACK], { facility: FACILITY });
  assert.equal(r.cells.length, 2, "the 'Not Existed' cell is not a cell");
  // Cells are reported in TONS, like every other figure in this report. The
  // fixture declares no cell unit, so its capacities are m³ and are halved on
  // the way in (TON_PER_M3 = 0.5) — the same normalisation `toTons` applies to
  // the submission volumes above. Before this, the cells table was the one part
  // of the document still in the facility's own unit, so "Used" here disagreed
  // with the same cell's figure in "Disposal by Cell" by exactly that factor.
  assert.deepEqual(r.cells[0], {
    name: "Cell 4", status: "Active Cell", type: "Residual", unit: "tons",
    capacity: 500, fill: 125, remaining: 375, utilization: 25,
  });
  // The ratio is unit-invariant: both sides converted, so the percentage the
  // operator reads is unchanged by the normalisation.
  assert.equal(r.cells[0].utilization, 25, "utilisation is unaffected by the unit");
  // A facility already declaring tons is passed through untouched.
  const inTons = buildPortalReport([], {
    facility: {
      numberOfCell: 1, cellNames: ["C1"], cellStatuses: ["Active Cell"],
      cellCapacities: [1000], cellFillValues: [250], cellCapacityUnits: ["tons"],
    },
  });
  assert.deepEqual(
    { capacity: inTons.cells[0].capacity, fill: inTons.cells[0].fill, unit: inTons.cells[0].unit },
    { capacity: 1000, fill: 250, unit: "tons" },
    "a tons-declared cell is not converted twice",
  );
  // A cell with no capacity reports no percentage rather than dividing by zero.
  const noCap = buildPortalReport([], {
    facility: { numberOfCell: 1, cellNames: ["C1"], cellStatuses: ["Active Cell"], cellCapacities: [0], cellFillValues: [0] },
  });
  assert.equal(noCap.cells[0].utilization, null);
});

test("no facility, no submissions — the report still builds", () => {
  const r = buildPortalReport([], {});
  assert.equal(r.facility, null);
  assert.equal(r.totals.submissions, 0);
  assert.deepEqual(r.cells, []);
  assert.deepEqual(r.monthly, []);
  assert.ok(r.generatedAt);
});

// ── Outstanding work ─────────────────────────────────────────────────────────

test("waste with no cell, and entries with no capacity, are surfaced", () => {
  const messy = {
    idNo: "C1",
    status: "acknowledged",
    dateOfDisposal: "2026-07-12T00:00:00.000Z",
    baselineUnit: "tons",
    trucks: [{ hauler: "H", vehicles: [{ actualVolume: 5, cellName: "" }, { actualVolume: 0, cellName: "" }] }],
  };
  const r = buildPortalReport([messy], { facility: FACILITY });
  // Only waste that EXISTS can be unplaced — a zero-volume row has nothing to place.
  assert.equal(r.outstanding.unplacedEntries, 1);
  assert.equal(r.outstanding.missingCapacityEntries, 2);
});

// ── Scope, read off the route ────────────────────────────────────────────────

test("the endpoint resolves identity from the token and filters on it", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "portalAuth.js"), "utf8");
  const route = src.slice(src.indexOf('router.get("/my-report"'), src.indexOf('router.get("/my-report"') + 3000);
  // Identity comes from resolvePortalContext, which refuses (and audits) a target
  // naming anyone else.
  assert.match(route, /resolvePortalContext\(req/);
  // …and the query filters on THAT resolved email, so the scoping is a property
  // of the query rather than a check that could be dropped.
  assert.match(route, /submittedBy: user\.email/);
  // It must never accept a facility/user selector of its own.
  assert.doesNotMatch(route, /req\.query\.slfGenerator/);
  assert.doesNotMatch(route, /req\.query\.slfName/);
});

test("the report modal takes no identity props — it cannot be pointed elsewhere", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "PortalReportModal.jsx"),
    "utf8",
  );
  assert.match(src, /export default function PortalReportModal\(\{ open, onClose \}\)/);
  assert.match(src, /api\.get\("\/portal-auth\/my-report"/);
});
