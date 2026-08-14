/**
 * Bulk Organize Cells — the file upload must leave the same database state the
 * manual organizer would.
 *
 * The template now carries Truck Capacity, because a trip missing one cannot be
 * completed by a cell alone: the operator would place every row, apply the batch,
 * and still be blocked. The endpoint therefore accepts and applies a capacity to
 * the same slot the cell goes to, validates it, and keeps every existing
 * guarantee — ownership, live cell state, combined-capacity checks, all-or-nothing
 * apply, and idempotency by batchId.
 *
 * Exercised through the REAL router in an Express app with the data layer stubbed.
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

const FACILITY_ID = new mongoose.Types.ObjectId();
const SUB_ID = new mongoose.Types.ObjectId();
const EMAIL = "operator@example.com";

const FACILITY = {
  _id: FACILITY_ID,
  numberOfCell: 4,
  cellNames: ["CELL 01", "CELL 02", "CELL 03", "CELL 04"],
  cellStatuses: ["Active Cell", "Active Cell", "Used/Completed", "Active Cell"],
  cellTypes: ["Residual", "Residual", "Residual", "Residual"],
  cellCapacities: [1000, 1000, 1000, 1000],
  cellCapacityUnits: ["tons", "tons", "tons", "tons"],
  cellFillValues: [0, 0, 0, 0],
  cellFillUnits: ["tons", "tons", "tons", "tons"],
  volumeCapacityUnit: "tons",
  wasteReceivedUnit: "tons",
};

function makeDoc() {
  return {
    _id: SUB_ID,
    idNo: "SLF-PVT-PA-0100",
    submissionId: "SUB-BULK-1",
    slfGenerator: FACILITY_ID,
    lguCompanyName: "Prime Waste",
    companyType: "Private",
    submittedBy: EMAIL,
    status: "acknowledged",
    baselineUnit: "tons",
    cellCorrections: [],
    saved: 0,
    trucks: [
      {
        disposalTicketNo: "DT-1",
        plateNumber: "AAA-1111",
        wasteType: "Residual",
        actualVolume: 20,
        actualVolumeUnit: "tons",
        truckCapacity: undefined, // missing — the file must supply it
        cellIndex: undefined,
        vehicles: [],
      },
      {
        disposalTicketNo: "DT-2",
        plateNumber: "BBB-2222",
        wasteType: "Residual",
        actualVolume: 0,
        actualVolumeUnit: "tons",
        cellIndex: 0,
        cellName: "CELL 01",
        vehicles: [
          { plateNumber: "BBB-2222", actualVolume: 30, actualVolumeUnit: "tons", cellIndex: 0, cellName: "CELL 01" },
          { plateNumber: "CCC-3333", actualVolume: 10, actualVolumeUnit: "tons", cellIndex: 0, cellName: "CELL 01" },
        ],
      },
    ],
    markModified() {},
    async save() { this.saved += 1; },
    toObject() { const { markModified, save, toObject, saved, ...rest } = this; return rest; },
  };
}

const chain = (value) => {
  const c = {
    select: () => c, sort: () => c, setOptions: () => c, populate: () => c, lean: () => c,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    // refreshFacilityCellOccupancy ends its portal-user lookup with `.catch()`.
    catch: (fn) => Promise.resolve(value).catch(fn),
  };
  return c;
};

let server; let baseUrl; let doc; let occupancyRefreshes; let transactions;

test.before(async () => {
  AppLog.create = async () => ({});
  Transaction.create = async (d) => { transactions.push(d); return d; };
  Transaction.insertMany = async (list) => { transactions.push(...list); return list; };
  Transaction.findOne = () => chain(null);
  UserPortal.find = () => chain([]);
  AppSettings.findOne = () => chain({ excludePreBaselineDisposalFromCellFill: false });
  SlfFacility.findById = () => chain(FACILITY);
  SlfFacility.findByIdAndUpdate = () => { occupancyRefreshes += 1; return chain(FACILITY); };
  DataSLF.find = () => chain([doc]);

  const app = express();
  app.use(express.json());
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { if (server) await new Promise((r) => server.close(r)); });
test.beforeEach(() => { doc = makeDoc(); occupancyRefreshes = 0; transactions = []; });

const token = jwt.sign({ id: String(new mongoose.Types.ObjectId()), role: "portal_user" }, process.env.JWT_SECRET);

async function bulk(body) {
  const res = await fetch(`${baseUrl}/api/data-slf/portal-cell-assignments/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ submittedBy: EMAIL, ...body }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const row = (over = {}) => ({
  _id: String(SUB_ID), submissionId: "SUB-BULK-1", truckIndex: 0, vehicleIndex: null,
  cellIndex: 1, cellName: "CELL 02", cellType: "Residual", ...over,
});

// ── Truck Capacity through the bulk path ────────────────────────────────────
test("a capacity supplied by the file is applied to the same slot as the cell", async () => {
  const { status, body } = await bulk({ assignments: [row({ truckCapacity: 14 })] });
  assert.equal(status, 200, body.message);
  assert.equal(body.applied, 1);
  assert.equal(doc.trucks[0].cellIndex, 1, "cell written");
  assert.equal(doc.trucks[0].truckCapacity, 14, "capacity written to the truck");
  assert.equal(doc.saved, 1, "one document write");
  assert.equal(occupancyRefreshes, 1, "occupancy recomputed, never incremented");
});

test("a per-vehicle row writes the capacity to that vehicle only", async () => {
  const { status } = await bulk({
    assignments: [row({ truckIndex: 1, vehicleIndex: 1, cellIndex: 3, cellName: "CELL 04", truckCapacity: 9 })],
  });
  assert.equal(status, 200);
  assert.equal(doc.trucks[1].vehicles[1].capacity, 9);
  assert.equal(doc.trucks[1].vehicles[0].capacity, undefined, "its sibling is untouched");
  assert.equal(doc.trucks[1].truckCapacity, undefined, "the truck-level capacity is untouched");
});

test("a non-positive capacity is rejected and nothing is written", async () => {
  for (const bad of [0, -5, "abc"]) {
    const { status, body } = await bulk({ assignments: [row({ truckCapacity: bad })] });
    assert.equal(status, 400, `capacity ${bad}`);
    assert.equal(body.rows[0].code, "bad_capacity");
  }
  assert.equal(doc.saved, 0);
});

test("omitting the capacity leaves the stored one alone", async () => {
  doc.trucks[0].truckCapacity = 25;
  const { status } = await bulk({ assignments: [row()] });
  assert.equal(status, 200);
  assert.equal(doc.trucks[0].truckCapacity, 25, "not cleared by a row that carries no capacity");
  assert.equal(doc.trucks[0].cellIndex, 1, "the cell still applied");
});

// ── Everything that already had to hold, still holds ────────────────────────
test("a dry run validates and writes nothing", async () => {
  const { status, body } = await bulk({ dryRun: true, assignments: [row({ truckCapacity: 14 })] });
  assert.equal(status, 200);
  assert.equal(body.preview, true);
  assert.equal(body.summary.valid, 1);
  assert.equal(doc.saved, 0, "no write on a preview");
  assert.equal(occupancyRefreshes, 0);
});

test("moving an already-placed volume records a movement, never a duplicate", async () => {
  // Truck 1's vehicles already sit in CELL 01; move vehicle 0 to CELL 02.
  const { status } = await bulk({
    assignments: [row({ truckIndex: 1, vehicleIndex: 0, cellIndex: 1, cellName: "CELL 02" })],
  });
  assert.equal(status, 200);
  assert.equal(doc.trucks[1].vehicles[0].cellIndex, 1, "moved");
  assert.equal(doc.trucks[1].vehicles[0].actualVolume, 30, "VOLUME UNCHANGED — a move, not an addition");
  assert.equal(doc.trucks[1].vehicles[1].cellIndex, 0, "its sibling stayed");
  assert.equal(doc.cellCorrections.length, 1);
  assert.equal(doc.cellCorrections[0].fromCellIndex, 0);
  assert.equal(doc.cellCorrections[0].toCellIndex, 1);
  assert.equal(doc.cellCorrections[0].source, "portal_bulk");
  assert.equal(doc.trucks.length, 2, "no submission or truck was created");
});

test("a ticket that disagrees with the resolved trip is rejected", async () => {
  const { status, body } = await bulk({ assignments: [row({ disposalTicketNo: "DT-999" })] });
  assert.equal(status, 400);
  assert.equal(body.rows[0].code, "bad_ticket");
  assert.equal(doc.saved, 0);
});

test("a closed cell cannot receive waste", async () => {
  const { status, body } = await bulk({ assignments: [row({ cellIndex: 2, cellName: "CELL 03", truckCapacity: 14 })] });
  assert.equal(status, 400);
  assert.equal(body.rows[0].code, "unavailable");
  assert.equal(doc.saved, 0);
});

test("one invalid row blocks the whole batch unless partial is asked for", async () => {
  const { status, body } = await bulk({
    assignments: [row({ truckCapacity: 14 }), row({ truckIndex: 9, truckCapacity: 14 })],
  });
  assert.equal(status, 400);
  assert.match(body.message, /No changes were applied/);
  assert.equal(doc.saved, 0, "the valid row is not written either");
});

test("a locked submission is refused", async () => {
  doc.status = "reverted";
  const { status, body } = await bulk({ assignments: [row({ truckCapacity: 14 })] });
  assert.equal(status, 400);
  assert.equal(body.rows[0].code, "locked");
  assert.equal(doc.saved, 0);
});
