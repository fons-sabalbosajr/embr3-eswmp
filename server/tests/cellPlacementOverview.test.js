/**
 * Cell Waste Placement — the per-cell panel is computed in the DATABASE.
 *
 * The page used to answer "how full is each cell?" in the browser: selecting a
 * submission fetched every record of that facility WITH its full trucks[] (an
 * unpaginated `mode=list&includeTrucks=true&search=<name>` call that cannot be
 * cached and grows without bound), plus the whole /baselines aggregation for one
 * date field. It was also wrong — the only facility document it had was the
 * list route's populated `slfGenerator`, projected to SLF_GENERATOR_REF_FIELDS,
 * which carries `cellNames` and NOT numberOfCell/cellCapacities/cellStatuses/
 * cellTypes. The cell count fell back to 1, so the panel showed a single
 * "Cell 1", the assignment dropdown offered only that cell, and any volume in a
 * cell other than index 0 vanished from the totals.
 *
 * These tests pin the replacement: a response sized by CELLS, built from the
 * facility's real configuration, using the same occupancy function that produces
 * the persisted `SlfFacility.cellFillValues`.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
mongoose.set("bufferCommands", false);

const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const AppSettings = require("../models/AppSettings");
const AppLog = require("../models/AppLog");

const FACILITY_ID = new mongoose.Types.ObjectId();
const FACILITY = {
  _id: FACILITY_ID,
  lgu: "Demonstration Valley",
  slfName: "Demonstration Valley SLF",
  numberOfCell: 4,
  cellNames: ["CELL 01", "CELL 02", "CELL 03", "CELL 04"],
  cellStatuses: ["Active Cell", "Active Cell", "Active Cell", "Used/Completed"],
  cellTypes: ["Residual", "Residual", "Residual", "Residual"],
  cellCapacities: [500, 500, 500, 500],
  cellCapacityUnits: ["tons", "tons", "tons", "tons"],
  cellFillUnits: ["tons", "tons", "tons", "tons"],
};

const truck = (volume, cellIndex) => ({
  actualVolume: volume,
  actualVolumeUnit: "tons",
  wasteType: "Residual",
  cellIndex,
  cellName: `CELL 0${cellIndex + 1}`,
  vehicles: [],
});

const ENTRIES = [
  // Baseline container: no trucks, carries the facility's starting figures.
  {
    _id: new mongoose.Types.ObjectId(),
    status: "pending",
    baselineUnit: "tons",
    createdAt: new Date("2026-01-01"),
    dateOfDisposal: new Date("2026-01-01"),
    totalVolumeAccepted: 200,
    activeCellEntries: [{ cellName: "CELL 01", wasteType: "Residual", volume: 200, unit: "tons" }],
    trucks: [],
  },
  // Real submissions, in three different cells.
  {
    _id: new mongoose.Types.ObjectId(),
    status: "acknowledged",
    baselineUnit: "tons",
    createdAt: new Date("2026-03-02"),
    dateOfDisposal: new Date("2026-03-02"),
    trucks: [truck(100, 2)],
  },
  {
    _id: new mongoose.Types.ObjectId(),
    status: "acknowledged",
    baselineUnit: "tons",
    createdAt: new Date("2026-03-03"),
    dateOfDisposal: new Date("2026-03-03"),
    trucks: [truck(50, 1)],
  },
  // Rejected: holds no capacity (ACTIVE_VOLUME_STATUSES).
  {
    _id: new mongoose.Types.ObjectId(),
    status: "rejected",
    baselineUnit: "tons",
    createdAt: new Date("2026-03-04"),
    dateOfDisposal: new Date("2026-03-04"),
    trucks: [truck(999, 2)],
  },
];

const query = (value) => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    setOptions: () => chain,
    populate: () => chain,
    lean: () => chain,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return chain;
};

let server;
let baseUrl;
let entries;
let settings;

test.before(async () => {
  AppLog.create = async () => ({});
  SlfFacility.findById = () => query(FACILITY);
  DataSLF.find = () => query(entries);
  AppSettings.findOne = () => query(settings);

  const app = express();
  app.use(express.json());
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(async () => {
  entries = ENTRIES;
  settings = { excludePreBaselineDisposalFromCellFill: false, preBaselineDisposalDetectorEnabled: true };
  // The route is cached (that is the point); each case here changes the inputs
  // behind the same key, so drop the entry rather than assert on a stale body.
  await require("../utils/serverCache").invalidate(require("../utils/cacheKeys").CELL_PLACEMENT_PREFIX);
});

const token = jwt.sign({ id: String(new mongoose.Types.ObjectId()), role: "admin" }, process.env.JWT_SECRET);

async function overview(id = FACILITY_ID, bearer = token) {
  const res = await fetch(`${baseUrl}/api/data-slf/cell-placement-overview/${id}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("the panel is built from the facility's real cell configuration", async () => {
  const { status, body } = await overview();
  assert.equal(status, 200);
  assert.equal(body.cells.length, 4, "all four cells, not the '1' fallback");
  assert.deepEqual(
    body.cells.map((c) => c.label),
    ["CELL 01", "CELL 02", "CELL 03", "CELL 04"],
  );
  assert.deepEqual(
    body.cells.map((c) => c.active),
    [true, true, true, false],
    "a Used/Completed cell is not offered as a placement target",
  );
  assert.deepEqual(body.cells.map((c) => c.capacity), [500, 500, 500, 500]);
});

test("volumes land in the cell they were placed in, baseline and submitted apart", async () => {
  const { body } = await overview();
  const byLabel = Object.fromEntries(body.cells.map((c) => [c.label, c]));
  assert.equal(byLabel["CELL 01"].baselineUsed, 200, "the baseline's own figures");
  assert.equal(byLabel["CELL 01"].submittedUsed, 0);
  assert.equal(byLabel["CELL 02"].submittedUsed, 50);
  assert.equal(byLabel["CELL 03"].submittedUsed, 100, "index 2 is NOT collapsed into cell 0");
  assert.equal(byLabel["CELL 03"].used, 100, "the rejected 999 t holds no capacity");
  assert.equal(byLabel["CELL 01"].pct, 40);
});

test("the response is sized by cells, never by submissions", async () => {
  const { body } = await overview();
  const payload = JSON.stringify(body);
  assert.doesNotMatch(payload, /"trucks"/, "no trucks[] is ever shipped to the browser");
  assert.doesNotMatch(payload, /actualVolume/);
  assert.equal(Object.keys(body).sort().join(","),
    ["baselineLastUpdated", "cells", "excludedPreBaselineCount", "facility", "generatedAt",
      "preBaselineDetectorEnabled", "totals", "unit"].join(","));
  // `totals` is a fixed-size rollup, not a per-submission list.
  assert.deepEqual(
    Object.keys(body.totals).sort(),
    ["baseline", "cellTotal", "placedSubmitted", "submitted", "total", "unplaced"],
  );
  // Only the submission ids the "Notify Users" action needs, per cell.
  const cell3 = body.cells.find((c) => c.label === "CELL 03");
  assert.equal(cell3.submissionCount, 1);
  assert.equal(cell3.submissionIds.length, 1);
});

test("the pre-baseline exclusion setting is honoured server-side", async () => {
  settings = { excludePreBaselineDisposalFromCellFill: true, preBaselineDisposalDetectorEnabled: true };
  entries = [
    ENTRIES[0],
    // Disposed before the baseline was encoded, and submitted before it too.
    {
      _id: new mongoose.Types.ObjectId(),
      status: "acknowledged",
      baselineUnit: "tons",
      createdAt: new Date("2025-06-01"),
      dateOfDisposal: new Date("2025-06-01"),
      trucks: [truck(70, 1)],
    },
    ENTRIES[2],
  ];
  const { body } = await overview();
  assert.equal(body.excludedPreBaselineCount, 1);
  const cell2 = body.cells.find((c) => c.label === "CELL 02");
  assert.equal(cell2.submittedUsed, 50, "only the post-baseline submission counts");
});

test("the endpoint is admin-only and validates its facility id", async () => {
  assert.equal((await overview(FACILITY_ID, "")).status, 401);
  const portalToken = jwt.sign({ id: "x", role: "portal_user" }, process.env.JWT_SECRET);
  assert.equal((await overview(FACILITY_ID, portalToken)).status, 403);
  assert.equal((await overview("not-an-id")).status, 400);
});

test("the panel is cached under its own key and invalidated with submissions", () => {
  const keys = require("../utils/cacheKeys");
  assert.equal(keys.CELL_PLACEMENT_PREFIX, "slf:admin:cell-placement");
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  // Keyed by facility AND by dummy scope — an ambiguous key serves one
  // facility's occupancy for another.
  assert.match(
    route,
    /const cellPlacementOverviewKey = \(req\) =>\s*`\$\{CELL_PLACEMENT_PREFIX\}:\$\{req\.params\.facilityId\}:\$\{devWantsDummy\(req\) \? "dummy" : "default"\}`/,
  );
  // cacheJson mounts AFTER the auth middleware, so a cache hit can never bypass
  // the admin check.
  assert.match(
    route,
    /"\/cell-placement-overview\/:facilityId",\s*\n\s*authMiddleware,\s*\n\s*adminOnly,\s*\n\s*cacheJson\(cellPlacementOverviewKey/,
  );
});

test("the front end no longer loads the whole dataset for this page", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "CellWastePlacement.jsx"),
    "utf8",
  );
  assert.match(page, /cell-placement-overview\//);
  // The two unbounded loads this replaced.
  assert.doesNotMatch(page, /\/data-slf\/baselines/);
  assert.doesNotMatch(page, /search: selectedFacilityName/);
  // The submissions list itself stays server-paginated.
  assert.match(page, /page,\s*\n\s*limit: pageSize,/);
});
