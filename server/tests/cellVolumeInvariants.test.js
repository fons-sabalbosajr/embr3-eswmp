/**
 * The invariants that make "Waste in Cell" mean ONE thing.
 *
 * Baseline and submission volume are combined per cell in several places, and
 * they used to be combined DIFFERENTLY in each: the server's computeCellOccupancy
 * (which writes the persisted SlfFacility.cellFillValues), and a second
 * re-derivation in the browser (buildFacilityCellUsage) that fed the SLF
 * Monitoring breakdown table and charts. The two disagreed — most visibly after a
 * cell move, and for every submission whose waste is split across per-VEHICLE
 * placements, which the browser version could not see at all.
 *
 * These tests pin the arithmetic rules directly on the shared calculation, and
 * pin that the movement paths MOVE a volume rather than adding it.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  computeCellOccupancy,
  applyPreBaselineRule,
  chooseBaselineEntry,
  ACTIVE_VOLUME_STATUSES,
} = require("../utils/cellOccupancy");

const dataSlf = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const slice = (source, start, end) => {
  const a = source.indexOf(start);
  assert.ok(a > -1, `not found: ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `end not found after ${start}`);
  return source.slice(a, b);
};

const FACILITY = {
  numberOfCell: 3,
  cellNames: ["CELL 01", "CELL 02", "CELL 03"],
  cellStatuses: ["Active Cell", "Active Cell", "Active Cell"],
  cellTypes: ["Residual", "Residual", "Residual"],
  cellCapacities: [1000, 1000, 1000],
  cellCapacityUnits: ["tons", "tons", "tons"],
  cellFillUnits: ["tons", "tons", "tons"],
};

const BASELINE = {
  _id: "baseline",
  status: "pending",
  baselineUnit: "tons",
  createdAt: new Date("2026-01-01"),
  totalVolumeAccepted: 300,
  activeCellEntries: [
    { cellName: "CELL 01", wasteType: "Residual", volume: 300, unit: "tons" },
  ],
  trucks: [],
};

const submission = (id, cellIndex, volume, status = "acknowledged") => ({
  _id: id,
  status,
  baselineUnit: "tons",
  createdAt: new Date("2026-03-01"),
  trucks: [
    {
      actualVolume: volume,
      actualVolumeUnit: "tons",
      wasteType: "Residual",
      cellIndex,
      cellName: `CELL 0${cellIndex + 1}`,
      vehicles: [],
    },
  ],
});

const totalOf = (occ) => occ.rows.reduce((s, r) => s + r.total, 0);
const cell = (occ, i) => occ.rows[i];

// ── Rule D — Waste in Cell = baseline in cell + valid submission in cell ────
test("a cell's volume is its baseline plus its submissions, each counted once", () => {
  const occ = computeCellOccupancy(FACILITY, [BASELINE, submission("s1", 0, 100)]);
  assert.equal(cell(occ, 0).baseline, 300);
  assert.equal(cell(occ, 0).submitted, 100);
  assert.equal(cell(occ, 0).total, 400, "300 baseline + 100 submitted, not 700");
  assert.equal(occ.baselineTotal, 300);
  assert.equal(occ.submittedTotal, 100);
  assert.equal(occ.totalVolume, 400);
});

// ── Rule A — a baseline record is never also a submission ───────────────────
test("the record carrying the baseline is not counted again as a submission", () => {
  // The baseline container has a dateOfDisposal (the save stamps one) and a
  // status — neither makes it a submission.
  const withDate = { ...BASELINE, dateOfDisposal: new Date("2026-01-01") };
  const occ = computeCellOccupancy(FACILITY, [withDate]);
  assert.equal(occ.baselineTotal, 300);
  assert.equal(occ.submittedTotal, 0, "a baseline contributes zero submitted volume");
  assert.equal(occ.totalVolume, 300);
});

// ── Rule B — no duplication ─────────────────────────────────────────────────
test("Waste in Cell counts APPROVED volume; pending only reserves capacity; rejected/reverted count nowhere", () => {
  const occ = computeCellOccupancy(FACILITY, [
    BASELINE,
    submission("s1", 1, 100, "acknowledged"),
    submission("s2", 1, 50, "pending"),
    submission("s3", 1, 999, "rejected"),
    submission("s4", 1, 999, "reverted"),
    submission("s5", 1, 7, "revert_requested"), // approved until EMB actually reverts it
  ]);
  assert.equal(cell(occ, 1).submitted, 107, "baseline + approved formula");
  assert.equal(cell(occ, 1).pending, 50, "pending is held against capacity only");
  assert.equal(ACTIVE_VOLUME_STATUSES.has("rejected"), false);
  assert.equal(ACTIVE_VOLUME_STATUSES.has("reverted"), false);
});

// ── Rule C — moving Cell A → Cell B does not change the total ───────────────
test("moving an acknowledged volume between cells moves it, it does not add it", () => {
  const before = computeCellOccupancy(FACILITY, [BASELINE, submission("s1", 0, 100)]);
  // The write path overwrites cellIndex in place; this is the same record after.
  const after = computeCellOccupancy(FACILITY, [BASELINE, submission("s1", 2, 100)]);

  assert.equal(totalOf(before), totalOf(after), "TOTAL SUBMITTED VOLUME IS UNCHANGED");
  assert.equal(before.submittedTotal, after.submittedTotal);
  assert.equal(cell(before, 0).submitted, 100);
  assert.equal(cell(after, 0).submitted, 0, "the old cell no longer holds it");
  assert.equal(cell(after, 2).submitted, 100, "the new cell does");
  assert.equal(cell(after, 0).baseline, 300, "the baseline stays where it is");
});

test("per-vehicle placements are counted, and split across their own cells", () => {
  const multi = {
    _id: "s-multi",
    status: "acknowledged",
    baselineUnit: "tons",
    createdAt: new Date("2026-03-02"),
    trucks: [
      {
        actualVolume: 0,
        actualVolumeUnit: "tons",
        wasteType: "Residual",
        cellIndex: 0,
        vehicles: [
          { actualVolume: 60, actualVolumeUnit: "tons", cellIndex: 0 },
          { actualVolume: 40, actualVolumeUnit: "tons", cellIndex: 2 },
        ],
      },
    ],
  };
  const occ = computeCellOccupancy(FACILITY, [multi]);
  assert.equal(cell(occ, 0).submitted, 60);
  assert.equal(cell(occ, 2).submitted, 40);
  assert.equal(occ.submittedTotal, 100, "the truck's whole load, once");
});

// ── Rule F/G — one calculation behind every view, one rule behind every path ─
test("every placement write recomputes occupancy from the submissions", () => {
  // Never an increment/decrement of a stored total — that is what would let a
  // move inflate a facility.
  [
    ['router.patch("/:id/cell-assignments"', "// Portal: the submitter organizes"],
    ['router.patch("/:id/portal-cell-assignments"', "// ── Portal: BULK cell organization"],
    ['router.post("/portal-cell-assignments/bulk"', "// Update a submission (admin edit)"],
    ['router.patch(\n  "/:id/correct-cell-placement"', "// Admin: assign submitted truck volumes"],
  ].forEach(([start, end]) => {
    const body = slice(dataSlf, start, end);
    assert.match(body, /refreshFacilityCellOccupancy|refreshOccupancyForFacilities/, `${start} must recompute`);
    assert.doesNotMatch(body, /cellFillValues\s*[:=]\s*[^;]*[+-]=/, `${start} must not hand-adjust a total`);
  });
});

test("manual and bulk organization record the same kind of movement", () => {
  const manual = slice(
    dataSlf,
    'router.patch("/:id/portal-cell-assignments"',
    "// ── Portal: BULK cell organization",
  );
  const bulk = slice(
    dataSlf,
    'router.post("/portal-cell-assignments/bulk"',
    "// Update a submission (admin edit)",
  );
  assert.match(manual, /recordCellMovement\(entry, move\)/);
  assert.match(manual, /source: "portal_organize"/);
  assert.match(bulk, /recordCellMovement\(doc, \{/);
  assert.match(bulk, /source: "portal_bulk"/);
  // Both address a placement the same way, so they cannot land on different slots.
  [manual, bulk].forEach((body) => {
    assert.match(body, /currentCellIndexOf\(truck, vehicleIndex\)/);
  });
});

test("a first assignment and a no-op are not recorded as movements", () => {
  const helper = slice(dataSlf, "function recordCellMovement(entry, move)", "/** The cell a placement");
  // Nothing to move FROM.
  assert.match(helper, /if \(from === null \|\| from === undefined/);
  // Same cell in and out.
  assert.match(helper, /if \(Number\(from\) === Number\(move\.toCellIndex\)\) return null;/);
  // Append-only — a second move keeps the first.
  assert.match(helper, /entry\.cellCorrections\.push\(record\)/);
  assert.doesNotMatch(helper, /cellCorrections\s*=\s*\[record\]/);
});

// ── The canonical rollup ────────────────────────────────────────────────────
test("one server rollup feeds the admin views that used to each derive their own", () => {
  const route = slice(dataSlf, 'router.get("/cell-occupancy"', 'router.get(\n  "/cell-placement-overview');
  assert.match(route, /computeCellOccupancy\(facility, counted, \{ unitSource/);
  assert.match(route, /buildOccupancyCells\(facility, occupancy/);
  // Both endpoints emit the identical cell shape from the identical helper.
  const overview = slice(dataSlf, '"/cell-placement-overview/:facilityId"', "router.post(\"/cell-capacity-alert\"");
  assert.match(overview, /buildOccupancyCells\(facility, occupancy/);
  assert.match(overview, /computeCellOccupancy\(facility, counted, \{ unitSource/);

  const dashboardTab = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "slf-monitoring", "SlfDashboardTab.jsx"),
    "utf8",
  );
  assert.match(dashboardTab, /const usageFromOccupancy = \(occupancy\)/);
  assert.match(dashboardTab, /occupancy\?\.cells\?\.length\s*\n?\s*\?\s*usageFromOccupancy\(occupancy\)/);

  const cellInfra = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "CellInfraOverview.jsx"),
    "utf8",
  );
  assert.match(cellInfra, /\/data-slf\/cell-occupancy/);
  // Capacity and fill can be declared in different units — convert before dividing.
  assert.match(cellInfra, /convertVolume\(rollup\.used, rollup\.unit, unit\)/);
  // The required note.
  assert.match(cellInfra, /Waste in Cell already includes the baseline/);
});

// ── Waste goes where it was PUT, not where there is room ────────────────────
test("an explicit cell keeps its volume even after that cell is closed", () => {
  // Cells 2 and 3 are closed; their baseline still belongs to them.
  const facility = {
    ...FACILITY,
    cellStatuses: ["Reserved Area", "Used/Completed", "Active Cell"],
  };
  const baseline = {
    _id: "b",
    status: "pending",
    baselineUnit: "tons",
    createdAt: new Date("2026-01-01"),
    activeCellEntries: [
      { cellName: "CELL 01", wasteType: "Residual", volume: 100, unit: "tons" },
      { cellName: "CELL 02", wasteType: "Residual", volume: 200, unit: "tons" },
    ],
    trucks: [],
  };
  const occ = computeCellOccupancy(facility, [baseline]);
  assert.equal(occ.rows[0].baseline, 100, "a Reserved cell keeps its own baseline");
  assert.equal(occ.rows[1].baseline, 200, "a Used/Completed cell keeps its own baseline");
  assert.equal(occ.rows[2].baseline, 0, "the open cell is not a dumping ground");
  // The production symptom: 240,854 + 200,469 both landing in the first open cell.
  assert.notEqual(occ.rows[2].baseline, 300);
});

test("waste with NO cell is not attributed to one — it is reported as unplaced", () => {
  const unorganized = {
    _id: "u",
    status: "acknowledged",
    baselineUnit: "tons",
    createdAt: new Date("2026-03-01"),
    trucks: [
      { actualVolume: 40, actualVolumeUnit: "tons", wasteType: "Residual", vehicles: [] }, // no cell
      { actualVolume: 10, actualVolumeUnit: "tons", wasteType: "Residual", cellIndex: 1, vehicles: [] },
    ],
  };
  const occ = computeCellOccupancy(FACILITY, [unorganized]);
  assert.equal(occ.rows[1].submitted, 10, "the placed trip counts in its cell");
  assert.equal(occ.rows.reduce((s, r) => s + r.submitted, 0), 10, "and ONLY the placed trip");
  assert.equal(occ.unplacedTotal, 40, "the unorganized trip is reported, not hidden");
  // It is still part of what the facility received, so no volume disappears.
  assert.equal(occ.submittedTotal, 50);
  assert.equal(occ.totalVolume, 50);
  assert.equal(occ.cellTotal, 10);
});

test("a legacy name-only placement is still an explicit placement", () => {
  const legacy = {
    _id: "l",
    status: "acknowledged",
    baselineUnit: "tons",
    createdAt: new Date("2026-03-01"),
    trucks: [{ actualVolume: 25, actualVolumeUnit: "tons", cellName: "CELL 03", vehicles: [] }],
  };
  const occ = computeCellOccupancy(FACILITY, [legacy]);
  assert.equal(occ.rows[2].submitted, 25);
  assert.equal(occ.unplacedTotal, 0);
});

// ── Which record IS the baseline ────────────────────────────────────────────
test("a submission carrying a copy of the baseline block is not the baseline", () => {
  const container = { _id: "container", createdAt: new Date("2026-01-01"), totalVolumeAccepted: 500, trucks: [] };
  const submissionWithCopy = {
    _id: "sub",
    createdAt: new Date("2026-06-01"),
    status: "acknowledged",
    totalVolumeAccepted: 500,
    activeCellEntries: [{ cellName: "CELL 01", volume: 500, unit: "tons" }],
    trucks: [{ actualVolume: 10, actualVolumeUnit: "tons", cellIndex: 0 }],
  };
  // Newest-first, exactly as the callers sort.
  assert.equal(chooseBaselineEntry([submissionWithCopy, container])._id, "container");
  // With no container at all, the newest record carrying the figures stands in.
  assert.equal(chooseBaselineEntry([submissionWithCopy])._id, "sub");
  assert.equal(chooseBaselineEntry([]), null);
});

test("the pre-baseline rule never excludes the record supplying the baseline", () => {
  // An SLF with NO container: the baseline lives on an old submission, which is
  // also what dates the cutoff. Excluding it left the facility with nothing —
  // measured on production, Masinloc 153,282 → 0 and Porac 1,941,366 → 0.
  const onlyRecord = {
    _id: "only",
    status: "pending",
    baselineUnit: "tons",
    createdAt: new Date("2026-07-10"),
    dateOfDisposal: new Date("2026-07-06"), // BEFORE its own createdAt
    totalVolumeAccepted: 153240,
    activeCellEntries: [{ cellName: "CELL 01", wasteType: "Residual", volume: 153240, unit: "tons" }],
    trucks: [{ actualVolume: 42, actualVolumeUnit: "tons", cellIndex: 0 }],
  };
  const { counted, excludedCount } = applyPreBaselineRule([onlyRecord], { exclude: true });
  assert.equal(counted.length, 1, "the baseline record survives its own cutoff");
  assert.equal(excludedCount, 0);
  const occ = computeCellOccupancy(FACILITY, counted);
  assert.equal(occ.rows[0].baseline, 153240);
});

test("with no baseline container the cutoff comes from the EARLIEST baseline copy", () => {
  // The bug this pins: at an SLF with no baseline-only container, every submission
  // carries a COPY of the baseline block, so chooseBaselineEntry — scanning a
  // newest-first list — always picked the NEWEST submission as "the baseline".
  // Its createdAt then dated the cutoff, so the cutoff was always ~now and every
  // other submission fell before it. That is not a threshold the data failed to
  // clear: no submission could EVER count, so Waste in Cell could never move.
  // Measured on production: Porac counted 1 of 80, Limay 1 of 87,
  // Floridablanca 1 of 59 — 545 submissions dropped across 13 facilities.
  const baselineBlock = {
    totalVolumeAccepted: 5000,
    activeCellEntries: [{ cellName: "CELL 01", wasteType: "Residual", volume: 5000, unit: "m³" }],
  };
  const sub = (id, createdAt, disposal) => ({
    _id: id,
    status: "acknowledged",
    baselineUnit: "m³",
    createdAt: new Date(createdAt),
    dateOfDisposal: new Date(disposal),
    ...baselineBlock, // every submission carries the copy — this is the trap
    trucks: [{ actualVolume: 10, actualVolumeUnit: "m³", wasteType: "Residual", cellIndex: 0 }],
  });

  // Newest-first, exactly how the routes load them.
  const entries = [
    sub("newest", "2026-07-20", "2026-07-19"),
    sub("mid", "2026-06-10", "2026-06-09"),
    sub("oldest", "2026-05-14", "2026-05-13"),
  ];

  const { counted, excludedCount } = applyPreBaselineRule(entries, { exclude: true });
  assert.ok(
    counted.length >= 2,
    `the cutoff must not exclude the facility's whole history (counted ${counted.length} of 3)`,
  );
  assert.ok(excludedCount <= 1, "at most the earliest record predates the encoding");

  // And the submitted volume must actually reach the cell.
  const occ = computeCellOccupancy(FACILITY, counted, { unitSource: entries });
  assert.ok(
    occ.placedSubmittedTotal > 0,
    "submitted volume must reach the cell — this is the empty Submission column",
  );
  // 5,000 m³ in the facility's DECLARED unit (tons) — counted exactly once.
  assert.equal(occ.unit, "tons", "the facility's declared unit, not the first truck's");
  assert.equal(occ.rows[0].baseline, 2500, "the baseline is still counted exactly once");
});

test("a real baseline container still dates the cutoff on its own", () => {
  // The container is authoritative: an operator who saves their baseline AFTER
  // submitting is declaring a total that already contains that waste, so those
  // submissions must stay excluded. This is the rule working, not the bug above.
  const container = {
    _id: "container",
    status: "pending",
    baselineUnit: "tons",
    createdAt: new Date("2026-08-14"),
    totalVolumeAccepted: 596981,
    activeCellEntries: [{ cellName: "CELL 01", wasteType: "Residual", volume: 596981, unit: "tons" }],
    trucks: [], // no transport entries — this is what makes it a container
  };
  const earlier = {
    _id: "earlier",
    status: "acknowledged",
    baselineUnit: "tons",
    createdAt: new Date("2026-07-16"),
    dateOfDisposal: new Date("2026-07-11"),
    totalVolumeAccepted: 596981,
    trucks: [{ actualVolume: 25, actualVolumeUnit: "tons", wasteType: "Residual", cellIndex: 0 }],
  };
  const { counted, excludedCount } = applyPreBaselineRule([container, earlier], { exclude: true });
  assert.equal(excludedCount, 1, "waste disposed before the container was saved stays inside it");
  assert.ok(counted.some((e) => String(e._id) === "container"));
  assert.ok(!counted.some((e) => String(e._id) === "earlier"));
});

// ── The declared unit must not move ─────────────────────────────────────────
test("the display unit does not change with how many submissions are filtered out", () => {
  const baseline = {
    _id: "b",
    createdAt: new Date("2026-06-01"),
    dateOfDisposal: new Date("2026-06-01"),
    // Declared in m³…
    activeCellEntries: [{ cellName: "CELL 01", wasteType: "Residual", volume: 1000, unit: "m³" }],
    trucks: [],
  };
  // …while the trips report tons.
  const trip = (id, day) => ({
    _id: id,
    status: "acknowledged",
    createdAt: new Date(day),
    dateOfDisposal: new Date(day),
    trucks: [{ actualVolume: 5, actualVolumeUnit: "tons", cellIndex: 0, vehicles: [] }],
  });
  const all = [baseline, trip("new", "2026-07-01"), trip("old", "2026-01-01")];
  const { counted } = applyPreBaselineRule(all, { exclude: true });

  const unfiltered = computeCellOccupancy(FACILITY, all, { unitSource: all });
  const filtered = computeCellOccupancy(FACILITY, counted, { unitSource: all });
  assert.equal(
    filtered.unit,
    unfiltered.unit,
    "the same facility must not switch unit because a filter removed the trips that declared it",
  );
  // Without the anchor the unit would follow whatever survived.
  const drifting = computeCellOccupancy(FACILITY, counted);
  assert.ok(drifting.unit, "sanity: the unfixed path still resolves something");
});

// ── Rule F — Portal and Admin filter the same set ───────────────────────────
test("the pre-baseline rule is one implementation, applied on both sides", () => {
  const preBaseline = {
    _id: "old",
    status: "acknowledged",
    baselineUnit: "tons",
    createdAt: new Date("2025-06-01"),
    dateOfDisposal: new Date("2025-06-01"),
    trucks: [{ actualVolume: 70, actualVolumeUnit: "tons", cellIndex: 1, vehicles: [] }],
  };
  const postBaseline = { ...submission("new", 1, 50), dateOfDisposal: new Date("2026-03-01") };
  const entries = [BASELINE, preBaseline, postBaseline];

  const on = applyPreBaselineRule(entries, { exclude: true });
  assert.equal(on.excludedCount, 1);
  assert.equal(computeCellOccupancy(FACILITY, on.counted).rows[1].submitted, 50);

  const off = applyPreBaselineRule(entries, { exclude: false });
  assert.equal(off.excludedCount, 0);
  assert.equal(computeCellOccupancy(FACILITY, off.counted).rows[1].submitted, 120);

  // A submission DISPOSED before the baseline but SUBMITTED after it is a new
  // declaration and still counts.
  const lateDeclared = { ...preBaseline, _id: "late", createdAt: new Date("2026-05-01") };
  assert.equal(applyPreBaselineRule([BASELINE, lateDeclared], { exclude: true }).excludedCount, 0);

  // Both readers call the shared helper — neither reimplements the dates.
  const facilities = fs.readFileSync(path.join(__dirname, "..", "routes", "slfFacilities.js"), "utf8");
  assert.match(facilities, /applyPreBaselineRule\(entries, \{\s*\n?\s*exclude: await preBaselineExclusionEnabled\(\),/);
  assert.match(dataSlf, /applyPreBaselineRule\(own, \{ exclude \}\)/);
  assert.match(dataSlf, /applyPreBaselineRule\(entries, \{/);
  // …and dataSLF.js no longer carries its own copy of the date arithmetic.
  assert.doesNotMatch(dataSlf, /function applyPreBaselineRule/);
});

test("the portal scopes dummy submissions the same way the admin rollup does", () => {
  const facilities = fs.readFileSync(path.join(__dirname, "..", "routes", "slfFacilities.js"), "utf8");
  const enrich = slice(facilities, "async function enrichPortalFacilityVolumes", "// Get all records (admin");
  assert.match(enrich, /facility\.isDummy \? \{\} : \{ isDummy: \{ \$ne: true \} \}/);
});

// ── Rule H — Redis never serves a stale placement ───────────────────────────
test("the new aggregates are cached under invalidated keys, with no flush", () => {
  const keys = require("../utils/cacheKeys");
  const socketEmit = fs.readFileSync(path.join(__dirname, "..", "utils", "socketEmit.js"), "utf8");
  const slfData = socketEmit.slice(socketEmit.indexOf("const slfData = ["), socketEmit.indexOf("switch (target)"));
  ["CELL_PLACEMENT_PREFIX", "BASELINES_CACHE_PREFIX"].forEach((key) => {
    assert.ok(keys[key], `${key} must exist`);
    assert.match(slfData, new RegExp(`keys\\.${key}`), `${key} must be invalidated on a placement/baseline write`);
  });
  // Both cell-occupancy entries live under the one prefix, so a single targeted
  // prefix delete clears the per-facility panel AND the all-facility rollup.
  assert.match(dataSlf, /\$\{CELL_PLACEMENT_PREFIX\}:all:/);
  assert.match(dataSlf, /\$\{CELL_PLACEMENT_PREFIX\}:\$\{req\.params\.facilityId\}/);
  // Never a blanket flush as part of normal application logic.
  assert.doesNotMatch(dataSlf, /flushall|flushdb/i);
  assert.doesNotMatch(socketEmit, /flushall|flushdb/i);
  // The baselines aggregation is cache-aside behind its auth middleware.
  assert.match(dataSlf, /router\.get\("\/baselines", optionalAuth, cacheJson\(baselinesCacheKey, \d+\)/);
  assert.match(dataSlf, /\$\{BASELINES_CACHE_PREFIX\}:\$\{devWantsDummy\(req\) \? "dummy" : "default"\}/);
});

// ── Bulk template scope + ticket ────────────────────────────────────────────
test("the bulk template carries only organization data, keyed by ticket", () => {
  const bulkUi = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "BulkOrganizeCells.jsx"),
    "utf8",
  );
  const headers = bulkUi.slice(bulkUi.indexOf("const TEMPLATE_HEADERS"), bulkUi.indexOf("const STATUS_META"));
  assert.match(headers, /"Submission Ticket No"/);
  // Truck Capacity IS organization data: a trip cannot be completed without one,
  // so the operator has to see which are missing and which are already declared.
  assert.match(headers, /"Truck Capacity"/);
  // Nothing from the baseline / company / client side of the record, though.
  ["Baseline", "Company", "Client", "Address"].forEach((word) =>
    assert.doesNotMatch(headers, new RegExp(word), `the template must not carry ${word} columns`),
  );
  // Capacity-only placements are not cell-organization rows.
  assert.match(bulkUi, /if \(p\.needsCell === false\) return;/);
  // The ticket travels to the server and is re-validated there.
  assert.match(bulkUi, /disposalTicketNo: r\.ticketNo \|\| undefined/);
  const bulkRoute = slice(dataSlf, 'router.post("/portal-cell-assignments/bulk"', "// Update a submission (admin edit)");
  assert.match(bulkRoute, /code: "bad_ticket"/);
  assert.match(bulkRoute, /claimedTicket\.toLowerCase\(\) !== actualTicket\.toLowerCase\(\)/);
  // And the portal payload actually supplies it — no fabricated numbers.
  const portalAuth = fs.readFileSync(path.join(__dirname, "..", "routes", "portalAuth.js"), "utf8");
  assert.match(portalAuth, /disposalTicketNo: truck\.disposalTicketNo \|\| ""/);
  assert.match(portalAuth, /trucks\.disposalTicketNo trucks\.hauler/);
});
