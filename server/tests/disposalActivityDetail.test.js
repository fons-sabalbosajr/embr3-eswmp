/**
 * The Disposal Activity modal shows the WHOLE trip, and Cell Infrastructure Save
 * actually persists.
 *
 * Two unrelated symptoms, two concrete causes:
 *
 *  1. The day modal rendered "—" for Hauler / Client / Plate No. / Cell / Waste
 *     Type on every row. Those columns are per-TRIP and live only on
 *     trucks[]/vehicles[], which GET /disposal-calendar deliberately does not
 *     ship (it answers "which days had activity" for the whole dashboard). The
 *     data was in MongoDB all along; it never left the server. The modal now
 *     fetches that ONE day's trips when it opens.
 *
 *  2. Cell Infrastructure Save wrote to MongoDB but with the OLD values:
 *     mergeCellInfrastructureUpdate's partial-payload guards reverted a status
 *     going back to "Active Cell" and refused to clear a capacity or a name. The
 *     dedicated editor now declares its payload authoritative.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
mongoose.set("bufferCommands", false);

const DataSLF = require("../models/DataSLF");
const AppLog = require("../models/AppLog");

const dataSlfSource = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const facilitiesSource = fs.readFileSync(path.join(__dirname, "..", "routes", "slfFacilities.js"), "utf8");
const slice = (source, start, end) => {
  const a = source.indexOf(start);
  assert.ok(a > -1, `not found: ${start}`);
  const b = source.indexOf(end, a);
  assert.ok(b > a, `end not found after ${start}`);
  return source.slice(a, b);
};

// ── The day endpoint ────────────────────────────────────────────────────────
const FACILITY_ID = new mongoose.Types.ObjectId();

const RECORDS = [
  {
    _id: new mongoose.Types.ObjectId(),
    idNo: "SLF-LGU-AU-0175",
    submissionId: "SUB-1",
    dateOfDisposal: new Date("2026-08-12T03:00:00.000Z"),
    submittedBy: "reynaldo@example.com",
    slfGenerator: { _id: FACILITY_ID, lgu: "Aurora", slfName: "Aurora SLF", cellNames: ["CELL 01", "CELL 02"] },
    slfName: "Aurora SLF",
    lguCompanyName: "Municipality of Baler",
    status: "pending",
    baselineUnit: "tons",
    totalVolumeTons: 0.61,
    trucks: [
      {
        disposalTicketNo: "DT-9001",
        hauler: "Aragon Hauling Services",
        plateNumber: "ABC-1234",
        wasteType: "Residual",
        actualVolume: 0.61,
        actualVolumeUnit: "tons",
        cellIndex: 1,
        // A STALE snapshot — the facility renamed this cell. The response must
        // carry the current label, not this copy.
        cellName: "Cell 2 (old name)",
        selectedClients: [{ clientName: "Baler Public Market" }],
        vehicles: [],
      },
    ],
  },
];

let server;
let baseUrl;
let queried;

test.before(async () => {
  AppLog.create = async () => ({});
  DataSLF.find = (filter) => {
    queried = filter;
    const chain = {
      setOptions: () => chain,
      sort: () => chain,
      select: (fields) => {
        chain.selected = fields;
        return chain;
      },
      populate: () => chain,
      lean: () => chain,
      then: (resolve, reject) => Promise.resolve(RECORDS).then(resolve, reject),
    };
    return chain;
  };

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

// The router applies requireAnyAuth to everything below it, so the day endpoint
// is closed to anonymous callers exactly like the calendar feed itself.
const jwt = require("jsonwebtoken");
const ADMIN_TOKEN = jwt.sign({ id: String(new mongoose.Types.ObjectId()), role: "admin" }, process.env.JWT_SECRET);

const day = async (date, token = ADMIN_TOKEN) => {
  const res = await fetch(`${baseUrl}/api/data-slf/disposal-calendar/day?date=${date}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("the day endpoint is closed to anonymous callers", async () => {
  assert.equal((await day("2026-08-12", "")).status, 401);
});

test("the day endpoint returns the per-trip fields the modal renders", async () => {
  const { status, body } = await day("2026-08-12");
  assert.equal(status, 200);
  const record = body.records[0];
  const truck = record.trucks[0];
  // The five columns that used to render "—" — from the real record, not a
  // fabricated placeholder.
  assert.equal(truck.hauler, "Aragon Hauling Services");
  assert.equal(truck.plateNumber, "ABC-1234");
  assert.equal(truck.wasteType, "Residual");
  assert.equal(truck.selectedClients[0].clientName, "Baler Public Market");
  assert.equal(truck.actualVolume, 0.61);
  // …and the ones that already worked stay intact.
  assert.equal(record.idNo, "SLF-LGU-AU-0175");
  assert.equal(record.status, "pending");
  assert.equal(record.submittedBy, "reynaldo@example.com");
});

test("the stored cell-name snapshot is resolved to the facility's current label", async () => {
  const { body } = await day("2026-08-12");
  assert.equal(
    body.records[0].trucks[0].cellName,
    "CELL 02",
    "the response must never carry a name frozen at submit time",
  );
});

test("the day endpoint excludes baseline containers and reverted records", async () => {
  await day("2026-08-12");
  assert.deepEqual(queried["trucks.0"], { $exists: true }, "a baseline save is not a disposal");
  assert.deepEqual(queried.status, { $nin: ["reverted", "revert_requested"] });
  assert.equal(queried.deletedAt, null);
  assert.deepEqual(queried.isDummy, { $ne: true });
});

test("the day endpoint is bounded to one day and validates its date", async () => {
  await day("2026-08-12");
  const span = queried.dateOfDisposal.$lt - queried.dateOfDisposal.$gte;
  assert.equal(span, 24 * 60 * 60 * 1000, "exactly one day, never the whole collection");
  assert.equal((await day("not-a-date")).status, 400);
  assert.equal((await day("2026-13-99")).status, 400);
});

test("the payload is projected, not the whole document", () => {
  const route = slice(dataSlfSource, 'router.get("/disposal-calendar/day"', "// Get all SLF data entries (admin)");
  assert.match(route, /DISPOSAL_ACTIVITY_TRUCK_FIELDS/);
  const fields = slice(dataSlfSource, "const DISPOSAL_ACTIVITY_TRUCK_FIELDS", "].join(\" \")");
  // Everything the table's columns read. Hauler is recorded on the TRUCK only
  // (the vehicle sub-schema has no hauler); the rest exist at both levels and the
  // modal prefers the vehicle's, so both must travel.
  assert.match(fields, /trucks\.hauler/);
  ["plateNumber", "wasteType", "actualVolume", "actualVolumeUnit", "cellIndex", "cellName", "selectedClients"].forEach(
    (f) => {
      assert.match(fields, new RegExp(`trucks\\.${f}`), `truck ${f}`);
      assert.match(fields, new RegExp(`trucks\\.vehicles\\.${f}`), `vehicle ${f}`);
    },
  );
  // And nothing heavier: the baseline block and haulers roster stay out.
  assert.doesNotMatch(fields, /accreditedHaulers|activeCellEntries/);
});

test("the month grid feed still ships no trucks", () => {
  const calendar = slice(dataSlfSource, 'router.get("/disposal-calendar", async', 'router.get("/disposal-calendar/day"');
  assert.doesNotMatch(calendar, /\.select\([^)]*\btrucks\b/, "the grid must stay O(submissions), not O(trips)");
  assert.match(calendar, /truckCount/, "it carries the COUNT, not the entries");
});

test("the modal fetches the day's trips instead of falling back to dashes", () => {
  const ui = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "DisposalActivityCalendar.jsx"),
    "utf8",
  );
  assert.match(ui, /\/data-slf\/disposal-calendar\/day/);
  // Rows are built from the detailed record when it has landed.
  assert.match(ui, /buildDisposalRows\(selected\.records\.map\(withTrips\)\)/);
  // The skeleton state that was declared but never used now drives the wait.
  assert.match(ui, /setModalPreparing\(true\)/);
});

// ── Cell Infrastructure save ────────────────────────────────────────────────
test("an authoritative cell payload can reopen a cell, and clear a capacity/name", () => {
  const merge = slice(
    facilitiesSource,
    "function mergeCellInfrastructureUpdate(update, record",
    "async function enrichPortalFacilityVolumes",
  );
  assert.match(merge, /\{ authoritative = false,/, "off by default — partial callers keep their guards");
  // The three guards that silently discarded the editor's changes.
  assert.match(merge, /if \(!authoritative && incoming === "Active Cell" && PROTECTED_CELL_STATUSES\.has\(existing\)\)/);
  assert.match(merge, /if \(!authoritative && !incoming && existing\)/);
  assert.match(merge, /if \(authoritative\) return next \?\? null;/);
  // The wipe guard is NOT conditional — an entirely empty array is still refused.
  const wipeGuard = merge.slice(merge.indexOf("for (const key of CELL_INFRA_ARRAYS)"), merge.indexOf("const mergeArray"));
  assert.match(wipeGuard, /update\[key\]\.length === 0 && Array\.isArray\(record\[key\]\) && record\[key\]\.length > 0/);
  assert.doesNotMatch(wipeGuard, /authoritative/);
});

test("the flag is consumed as a request flag, never written to the facility", () => {
  const put = slice(facilitiesSource, 'router.put("/:id", adminOnly', 'router.patch("/:id/cell-status"');
  assert.match(put, /delete update\.cellInfrastructureAuthoritative;/);
  assert.match(put, /mergeCellInfrastructureUpdate\(update, record, \{\s*\n?\s*authoritative: cellInfrastructureAuthoritative,/);
  // Persist first, then invalidate — never the other way round.
  const saveAt = put.indexOf("await record.save()");
  const refreshAt = put.indexOf('refreshAdmin(req, "facility")');
  assert.ok(saveAt > -1 && refreshAt > saveAt, "caches are invalidated only after MongoDB commits");
});

test("only the dedicated editor claims authority", () => {
  const editor = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "CellInfraOverview.jsx"),
    "utf8",
  );
  assert.match(editor, /cellInfrastructureAuthoritative: true/);
  // Every other cell writer keeps the protective merge.
  ["SLFMonitoring.jsx", "slf-monitoring/modals/SlfEditModal.jsx"].forEach((file) => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", file),
      "utf8",
    );
    assert.doesNotMatch(source, /cellInfrastructureAuthoritative/, `${file} must not claim authority`);
  });
});

test("a facility edit invalidates every cache derived from its cells", () => {
  const keys = require("../utils/cacheKeys");
  const socketEmit = fs.readFileSync(path.join(__dirname, "..", "utils", "socketEmit.js"), "utf8");
  const facilityTarget = socketEmit.slice(
    socketEmit.indexOf('case "facility":'),
    socketEmit.indexOf('case "slf-clients":'),
  );
  // "facility" resolves to slfData + the facility tile, and slfData now carries
  // the cell-placement rollup and the baselines aggregation.
  assert.match(facilityTarget, /\.\.\.slfData/);
  const slfData = socketEmit.slice(socketEmit.indexOf("const slfData = ["), socketEmit.indexOf("switch (target)"));
  ["CELL_PLACEMENT_PREFIX", "BASELINES_CACHE_PREFIX", "CELL_USAGE_CACHE_PREFIX", "SUMMARY_BY_SLF_CACHE_KEY"].forEach(
    (key) => {
      assert.ok(keys[key]);
      assert.match(slfData, new RegExp(`keys\\.${key}`));
    },
  );
  assert.doesNotMatch(socketEmit, /flushall|flushdb/i);
});

test("Facility & Operations counts cells the way Cell Infrastructure does", () => {
  const modal = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "slf-monitoring", "modals", "SlfDetailModal.jsx"),
    "utf8",
  );
  assert.match(modal, /!isNonExistentCell\(configuredStatuses\[i\] \|\| "Active Cell"\)/);
  // Waste Received is the rollup total, not a second derivation.
  assert.match(modal, /detailViewRecord\.actualResidualWasteReceived \|\| 0/);
  const monitoring = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "SLFMonitoring.jsx"),
    "utf8",
  );
  assert.match(monitoring, /cellOccupancy\[String\(baseRecord\?\._id \|\| ""\)\] \|\| null/);
});
