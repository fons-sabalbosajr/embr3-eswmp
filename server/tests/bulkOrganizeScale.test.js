/**
 * Bulk Organize Cells AT SCALE — 900 placements, capacity + cell, in one upload.
 *
 * The correctness suite (bulkOrganizeCells.test.js) proves the batch leaves the
 * right database state on small fixtures. This one proves the SHAPE of the work
 * does not degrade with the size of the file, because that is the failure mode
 * that stays invisible until a real operator uploads a real workbook.
 *
 * The property being pinned is that DATABASE ROUND TRIPS ARE INDEPENDENT OF ROW
 * COUNT. Before the batch path was rewritten, applying this file meant:
 *   • one save() per submission, sequentially — 60 round trips here;
 *   • each rewriting that submission's ENTIRE trucks array to set a cell name.
 * Now it is one bulkWrite of one targeted op per submission, whatever the file
 * holds. A regression that reintroduces a query (or a save) inside the row loop
 * shows up here as a call count that tracks ROWS instead of SUBMISSIONS.
 *
 * Timings are asserted against a deliberately loose ceiling — a guard against an
 * order-of-magnitude regression, NOT a benchmark.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
mongoose.set("bufferCommands", false);

const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const Transaction = require("../models/Transaction");
const UserPortal = require("../models/UserPortal");
const AppLog = require("../models/AppLog");
const AppSettings = require("../models/AppSettings");

// 60 submissions × 15 trucks = 900 placements, every one needing BOTH a cell and
// a Truck Capacity. Spreading them across many submissions is the hard case: the
// old path's cost was per-submission, so a file concentrated in one record would
// have hidden the problem.
const SUBMISSIONS = 60;
const TRUCKS_PER_SUBMISSION = 15;
const TOTAL_ROWS = SUBMISSIONS * TRUCKS_PER_SUBMISSION;

const FACILITY_ID = new mongoose.Types.ObjectId();
const EMAIL = "operator@example.com";

const FACILITY = {
  _id: FACILITY_ID,
  numberOfCell: 4,
  cellNames: ["CELL 01", "CELL 02", "CELL 03", "CELL 04"],
  cellStatuses: ["Active Cell", "Active Cell", "Active Cell", "Active Cell"],
  cellTypes: ["Residual", "Residual", "Residual", "Residual"],
  // Roomy enough that the COMBINED batch volume is a valid load — the per-cell
  // running total is still checked, it just is not what this test is about.
  cellCapacities: [500000, 500000, 500000, 500000],
  cellCapacityUnits: ["tons", "tons", "tons", "tons"],
  cellFillValues: [0, 0, 0, 0],
  cellFillUnits: ["tons", "tons", "tons", "tons"],
  volumeCapacityUnit: "tons",
  wasteReceivedUnit: "tons",
};

const makeDocs = () =>
  Array.from({ length: SUBMISSIONS }, (_, s) => ({
    _id: new mongoose.Types.ObjectId(),
    idNo: `SLF-PVT-PA-${String(s).padStart(4, "0")}`,
    submissionId: `SUB-SCALE-${s}`,
    slfGenerator: FACILITY_ID,
    lguCompanyName: "Prime Waste",
    companyType: "Private",
    submittedBy: EMAIL,
    status: "acknowledged",
    baselineUnit: "tons",
    cellCorrections: [],
    trucks: Array.from({ length: TRUCKS_PER_SUBMISSION }, (_, t) => ({
      disposalTicketNo: `DT-${s}-${t}`,
      plateNumber: `AAA-${s}-${t}`,
      wasteType: "Residual",
      actualVolume: 1,
      actualVolumeUnit: "tons",
      truckCapacity: undefined, // the file must supply it
      cellIndex: undefined, // and a cell
      vehicles: [],
    })),
  }));

const chain = (value) => {
  const c = {
    select: () => c, sort: () => c, setOptions: () => c, populate: () => c, lean: () => c,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (fn) => Promise.resolve(value).catch(fn),
  };
  return c;
};

let server; let baseUrl; let docs;
let counts; let writes;

test.before(async () => {
  AppLog.create = async () => ({});
  Transaction.findOne = () => chain(null);
  UserPortal.find = () => chain([]);
  AppSettings.findOne = () => chain({ excludePreBaselineDisposalFromCellFill: false });
  SlfFacility.findByIdAndUpdate = () => chain(FACILITY);

  Transaction.insertMany = async (list) => { counts.transactionInsertMany += 1; return list; };
  SlfFacility.findById = () => { counts.facilityFindById += 1; return chain(FACILITY); };
  DataSLF.find = () => { counts.dataSlfFind += 1; return chain(docs); };
  DataSLF.bulkWrite = async (ops) => {
    counts.bulkWrite += 1;
    writes.push(ops);
    return { matchedCount: ops.length, modifiedCount: ops.length };
  };

  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { if (server) await new Promise((r) => server.close(r)); });
test.beforeEach(() => {
  docs = makeDocs();
  writes = [];
  counts = { dataSlfFind: 0, facilityFindById: 0, bulkWrite: 0, transactionInsertMany: 0 };
});

// Real portal tokens carry the e-mail (routes/portalAuth.js); the route acts as it.
const token = jwt.sign({ id: String(new mongoose.Types.ObjectId()), role: "portal_user", email: EMAIL }, process.env.JWT_SECRET);

// Exactly what BulkOrganizeCells.jsx sends: one assignment per placement, both a
// target cell AND the Truck Capacity the trip was missing.
const buildAssignments = () =>
  docs.flatMap((doc, s) =>
    Array.from({ length: TRUCKS_PER_SUBMISSION }, (_, t) => ({
      _id: String(doc._id),
      submissionId: doc.submissionId,
      idNo: doc.idNo,
      disposalTicketNo: `DT-${s}-${t}`,
      truckIndex: t,
      vehicleIndex: null,
      cellIndex: t % 4,
      cellName: `CELL 0${(t % 4) + 1}`,
      cellType: "Residual",
      truckCapacity: 12,
    })),
  );

async function bulk(body) {
  const res = await fetch(`${baseUrl}/api/data-slf/portal-cell-assignments/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ submittedBy: EMAIL, ...body }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test(`${TOTAL_ROWS} placements validate without a query per row`, async () => {
  const started = performance.now();
  const { status, body } = await bulk({ dryRun: true, assignments: buildAssignments() });
  const ms = performance.now() - started;

  assert.equal(status, 200, body.message);
  assert.equal(body.summary.total, TOTAL_ROWS);
  assert.equal(body.summary.valid, TOTAL_ROWS, "every row is a valid placement");
  assert.equal(body.summary.invalid, 0);

  // ONE resolution query for every referenced submission, and ONE facility read
  // for the whole batch — not one per row, and not one per submission.
  assert.equal(counts.dataSlfFind, 1, "one query resolves all 60 submissions");
  assert.equal(counts.facilityFindById, 1, "the facility is read once and cached");
  assert.equal(counts.bulkWrite, 0, "a preview writes nothing");
  assert.ok(ms < 5000, `validation of ${TOTAL_ROWS} rows took ${ms.toFixed(0)}ms`);
});

test(`${TOTAL_ROWS} placements apply in ONE bulkWrite of ${SUBMISSIONS} ops`, async () => {
  const started = performance.now();
  const { status, body } = await bulk({ batchId: "scale-1", assignments: buildAssignments() });
  const ms = performance.now() - started;

  assert.equal(status, 200, body.message);
  assert.equal(body.applied, TOTAL_ROWS, "every placement applied");

  // THE INVARIANT: writes scale with SUBMISSIONS, not with rows.
  assert.equal(counts.bulkWrite, 1, "one command for the whole file");
  assert.equal(writes[0].length, SUBMISSIONS, `${SUBMISSIONS} ops for ${TOTAL_ROWS} rows`);
  assert.equal(counts.transactionInsertMany, 1, "one audit insert, not one per submission");

  // Two reads total: the submission resolution, and the occupancy recompute that
  // every placement path owes. Neither is inside the row loop.
  assert.equal(counts.dataSlfFind, 2, "resolution + one occupancy recompute");
  assert.equal(counts.facilityFindById, 2, "the batch's cached read + the recompute's own");

  // Each op carries only the fields that placement changed — cell (3) + capacity
  // and its unit (2), per truck — never the whole trucks array.
  const first = writes[0][0].updateOne;
  const paths = Object.keys(first.update.$set);
  assert.equal(
    paths.length,
    TRUCKS_PER_SUBMISSION * 5,
    "5 targeted paths per placement, nothing else",
  );
  assert.ok(
    paths.every((p) => /^trucks\.\d+\.(cellIndex|cellName|cellType|truckCapacity|truckCapacityUnit)$/.test(p)),
    "every staged path addresses one placement's own fields",
  );
  // A first assignment is not a movement, so nothing is appended.
  assert.equal(first.update.$push, undefined, "no spurious correction records");

  assert.ok(ms < 8000, `applying ${TOTAL_ROWS} rows took ${ms.toFixed(0)}ms`);
});

test("the whole batch is still refused if a single row is invalid", async () => {
  // Scale must not weaken the all-or-nothing guarantee.
  const assignments = buildAssignments();
  assignments[TOTAL_ROWS - 1].truckCapacity = -3;

  const { status, body } = await bulk({ assignments });
  assert.equal(status, 400);
  assert.match(body.message, /No changes were applied/);
  assert.equal(counts.bulkWrite, 0, "not one of the 899 valid rows was written");
  assert.equal(body.rows.filter((r) => r.status === "invalid").length, 1);
});
