/**
 * Bulk Organize Cells — the file upload must leave the same database state the
 * manual organizer would.
 *
 * The batch is persisted with ONE bulkWrite carrying one targeted `updateOne` per
 * touched submission (not a save() per submission rewriting its whole trucks
 * array), so these tests also pin WHAT is written: only the placement paths the
 * batch actually changed, and only the new movement records.
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
    toObject() { const { toObject, ...rest } = this; return rest; },
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
// Every bulkWrite command the route issued, flattened to its ops.
let writes;
/** All `$set` paths staged across the batch. */
const setPaths = () => writes.flat().flatMap((op) => Object.keys(op.updateOne.update.$set || {}));

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
  DataSLF.bulkWrite = async (ops) => {
    writes.push(ops);
    return { matchedCount: ops.length, modifiedCount: ops.length };
  };

  const app = express();
  app.use(express.json());
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { if (server) await new Promise((r) => server.close(r)); });
test.beforeEach(() => { doc = makeDoc(); occupancyRefreshes = 0; transactions = []; writes = []; });

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
  assert.equal(writes.length, 1, "ONE bulkWrite for the whole batch");
  assert.equal(writes[0].length, 1, "one targeted op for the one touched submission");
  assert.deepEqual(writes[0][0].updateOne.filter, { _id: doc._id, deletedAt: null });
  assert.deepEqual(
    setPaths().sort(),
    [
      "trucks.0.cellIndex", "trucks.0.cellName", "trucks.0.cellType",
      "trucks.0.truckCapacity", "trucks.0.truckCapacityUnit",
    ].sort(),
    "only the placement's own fields are written — not the whole trucks array",
  );
  assert.equal(occupancyRefreshes, 1, "occupancy recomputed, never incremented");
});

test("a batch across many submissions is still exactly one bulkWrite", async () => {
  // Two submissions, four placements. The old path issued one save() per
  // submission, sequentially; the cost must now scale with the round trip, not
  // with how many submissions the file touches.
  const second = { ...makeDoc(), _id: new mongoose.Types.ObjectId(), submissionId: "SUB-BULK-2" };
  const both = [doc, second];
  const prevFind = DataSLF.find;
  DataSLF.find = () => chain(both);
  try {
    const { status, body } = await bulk({
      assignments: [
        row({ truckCapacity: 14 }),
        // Already placed in CELL 01 — the row names its own cell and completes
        // only the capacity (moving placed waste is refused; see below).
        row({ truckIndex: 1, vehicleIndex: 1, cellIndex: 0, cellName: "CELL 01", truckCapacity: 9 }),
        row({ _id: String(second._id), submissionId: "SUB-BULK-2", truckCapacity: 14 }),
        row({ _id: String(second._id), submissionId: "SUB-BULK-2", truckIndex: 1, vehicleIndex: 1, cellIndex: 0, cellName: "CELL 01", truckCapacity: 9 }),
      ],
    });
    assert.equal(status, 200, body.message);
    assert.equal(body.applied, 4);
    assert.equal(writes.length, 1, "one command");
    assert.equal(writes[0].length, 2, "one op per submission, not per row");
  } finally {
    DataSLF.find = prevFind;
  }
});

test("a successful apply does not echo back every valid row", async () => {
  const { body } = await bulk({ assignments: [row({ truckCapacity: 14 })] });
  assert.equal(body.summary.valid, 1, "the counts are still reported");
  assert.deepEqual(body.rows, [], "…without repeating rows the client already has");
});

test("a per-vehicle row writes the capacity to that vehicle only", async () => {
  const { status, body } = await bulk({
    assignments: [row({ truckIndex: 1, vehicleIndex: 1, cellIndex: 0, cellName: "CELL 01", truckCapacity: 9 })],
  });
  assert.equal(status, 200, body.message);
  assert.equal(doc.trucks[1].vehicles[1].capacity, 9);
  assert.equal(doc.trucks[1].vehicles[1].cellIndex, 0, "its cell is unchanged");
  assert.equal(doc.trucks[1].vehicles[0].capacity, undefined, "its sibling is untouched");
  assert.equal(doc.trucks[1].truckCapacity, undefined, "the truck-level capacity is untouched");
});

test("a non-positive capacity is rejected and nothing is written", async () => {
  for (const bad of [0, -5, "abc"]) {
    const { status, body } = await bulk({ assignments: [row({ truckCapacity: bad })] });
    assert.equal(status, 400, `capacity ${bad}`);
    assert.equal(body.rows[0].code, "bad_capacity");
  }
  assert.equal(writes.length, 0);
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
  assert.equal(writes.length, 0, "no write on a preview");
  assert.equal(occupancyRefreshes, 0);
});

test("REGRESSION — waste that is already placed is not moved by the organizer", async () => {
  // Truck 1's vehicles already sit in CELL 01. The organizer places UNPLACED
  // waste; moving placed waste is an EMB correction, so this row is refused and
  // nothing is written.
  const { status, body } = await bulk({
    assignments: [row({ truckIndex: 1, vehicleIndex: 0, cellIndex: 1, cellName: "CELL 02" })],
  });
  assert.equal(status, 400);
  assert.equal(body.rows[0].code, "already_placed");
  assert.match(body.rows[0].message, /CELL 01/);
  assert.equal(doc.trucks[1].vehicles[0].cellIndex, 0, "not moved");
  assert.equal(doc.cellCorrections.length, 0);
  assert.equal(writes.length, 0);
});

test("naming the cell a slot already has completes only its capacity", async () => {
  const { status, body } = await bulk({
    dryRun: true,
    assignments: [row({ truckIndex: 1, vehicleIndex: 0, cellIndex: 0, cellName: "CELL 01", truckCapacity: 12 })],
  });
  assert.equal(status, 200);
  assert.equal(body.rows[0].code, "capacity_only");
});

test("waste type must fit the cell type", async () => {
  const prev = FACILITY.cellTypes;
  FACILITY.cellTypes = ["Residual", "Treated Haz Waste", "Residual", "Residual"];
  try {
    const { status, body } = await bulk({ assignments: [row({ truckCapacity: 14 })] }); // Residual → haz cell
    assert.equal(status, 400);
    assert.equal(body.rows[0].code, "type_mismatch");
    assert.equal(writes.length, 0);
  } finally {
    FACILITY.cellTypes = prev;
  }
});

test("a cell EMB closed for submissions is refused", async () => {
  FACILITY.cellSubmissionAllowed = [true, false, true, true];
  try {
    const { status, body } = await bulk({ assignments: [row({ truckCapacity: 14 })] });
    assert.equal(status, 400);
    assert.equal(body.rows[0].code, "unavailable");
    assert.match(body.rows[0].message, /closed/i);
  } finally {
    delete FACILITY.cellSubmissionAllowed;
  }
});

test("a ticket that disagrees with the resolved trip is rejected", async () => {
  const { status, body } = await bulk({ assignments: [row({ disposalTicketNo: "DT-999" })] });
  assert.equal(status, 400);
  assert.equal(body.rows[0].code, "bad_ticket");
  assert.equal(writes.length, 0);
});

test("a closed cell cannot receive waste", async () => {
  const { status, body } = await bulk({ assignments: [row({ cellIndex: 2, cellName: "CELL 03", truckCapacity: 14 })] });
  assert.equal(status, 400);
  assert.equal(body.rows[0].code, "unavailable");
  assert.equal(writes.length, 0);
});

test("one invalid row blocks the whole batch unless partial is asked for", async () => {
  const { status, body } = await bulk({
    assignments: [row({ truckCapacity: 14 }), row({ truckIndex: 9, truckCapacity: 14 })],
  });
  assert.equal(status, 400);
  assert.match(body.message, /No changes were applied/);
  assert.equal(writes.length, 0, "the valid row is not written either");
});

test("a locked submission is refused", async () => {
  doc.status = "reverted";
  const { status, body } = await bulk({ assignments: [row({ truckCapacity: 14 })] });
  assert.equal(status, 400);
  assert.equal(body.rows[0].code, "locked");
  assert.equal(writes.length, 0);
});

// ── The single-save route (the organizer's "Save Placement") enforces the same
//    rulings as the bulk path. ──────────────────────────────────────────────
async function patchOne(assignments) {
  const prevFindOne = DataSLF.findOne;
  // The route loads one hydrated document and save()s it.
  doc.save = async () => doc;
  doc.markModified = () => {};
  DataSLF.findOne = () => doc;
  try {
    const res = await fetch(`${baseUrl}/api/data-slf/${SUB_ID}/portal-cell-assignments`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ submittedBy: EMAIL, assignments }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    DataSLF.findOne = prevFindOne;
  }
}

test("Save Placement places unplaced waste", async () => {
  const { status, body } = await patchOne([{ truckIndex: 0, cellIndex: 1, cellName: "CELL 02", cellType: "Residual" }]);
  assert.equal(status, 200, body.message);
  assert.equal(doc.trucks[0].cellIndex, 1);
});

test("REGRESSION — Save Placement refuses to move waste that is already placed", async () => {
  const { status, body } = await patchOne([{ truckIndex: 1, vehicleIndex: 0, cellIndex: 1, cellName: "CELL 02" }]);
  assert.equal(status, 400);
  assert.match(body.message, /already placed in CELL 01/);
  assert.equal(doc.trucks[1].vehicles[0].cellIndex, 0, "not moved");
});

test("Save Placement completes a capacity for placed waste without touching its cell", async () => {
  const { status, body } = await patchOne([{ truckIndex: 1, vehicleIndex: 0, truckCapacity: 12, truckCapacityUnit: "tons" }]);
  assert.equal(status, 200, body.message);
  assert.equal(doc.trucks[1].vehicles[0].capacity, 12);
  assert.equal(doc.trucks[1].vehicles[0].cellIndex, 0);
});

test("REGRESSION — Save Placement checks the COMBINED volume against the cell's room", async () => {
  const prevFill = FACILITY.cellFillValues;
  // CELL 02 has 25 t left; truck 0 alone (20 t) fits, but a second unplaced 20 t load does not.
  FACILITY.cellFillValues = [0, 975, 0, 0];
  doc.trucks.push({ disposalTicketNo: "DT-3", plateNumber: "DDD-4444", wasteType: "Residual", actualVolume: 20, actualVolumeUnit: "tons", vehicles: [] });
  try {
    const { status, body } = await patchOne([
      { truckIndex: 0, cellIndex: 1, cellName: "CELL 02" },
      { truckIndex: 2, cellIndex: 1, cellName: "CELL 02" },
    ]);
    assert.equal(status, 400);
    assert.match(body.message, /Row 2 .*remaining capacity/);
    assert.equal(doc.trucks[0].cellIndex, undefined, "all-or-nothing: the first row is not written either");
  } finally {
    FACILITY.cellFillValues = prevFill;
  }
});

test("Save Placement refuses waste whose type does not fit the cell", async () => {
  const prev = FACILITY.cellTypes;
  FACILITY.cellTypes = ["Residual", "Treated Haz Waste", "Residual", "Residual"];
  try {
    const { status, body } = await patchOne([{ truckIndex: 0, cellIndex: 1, cellName: "CELL 02" }]);
    assert.equal(status, 400);
    assert.match(body.message, /cannot go into a Treated Haz Waste cell/);
  } finally {
    FACILITY.cellTypes = prev;
  }
});
