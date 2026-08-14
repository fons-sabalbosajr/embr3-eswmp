/**
 * Correcting the cell of an ACKNOWLEDGED submission.
 *
 * A portal user can tip a load into Cell 05 and record it against Cell 03. By
 * the time anyone notices, the submission is usually acknowledged and its volume
 * is already inside the facility's occupancy, the dashboards and the portal's
 * own tiles. The fix therefore cannot be "let an admin edit the field": it has
 * to be authorized, validated against the facility's real cells, refuse to act
 * on a stale screen, and leave the original placement in the record.
 *
 * The route is exercised in a REAL Express app with the Mongoose layer stubbed,
 * so the middleware chain (authMiddleware → adminOnly → requirePermission) and
 * the whole validation ladder are proven, not just read.
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
// Anything this test forgot to stub must fail loudly instead of buffering for
// ten seconds against a database that is not there.
mongoose.set("bufferCommands", false);

const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const UserPortal = require("../models/UserPortal");
const AppLog = require("../models/AppLog");
const User = require("../models/User");

const FACILITY_ID = new mongoose.Types.ObjectId();
const SUBMISSION_ID = new mongoose.Types.ObjectId();
const ADMIN_ID = new mongoose.Types.ObjectId();

const FACILITY = {
  _id: FACILITY_ID,
  lgu: "Demonstration Valley",
  slfName: "Demonstration Valley SLF",
  numberOfCell: 6,
  cellNames: ["CELL 01", "CELL 02", "CELL 03", "CELL 04", "CELL 05", "CELL 06"],
  cellStatuses: [
    "Active Cell",
    "Active Cell",
    "Active Cell",
    "Used/Completed",
    "Active Cell",
    "Active Cell",
  ],
  cellTypes: ["Residual", "Residual", "Residual", "Residual", "Residual", "Treated Haz Waste"],
  cellCapacities: [1000, 1000, 1000, 1000, 1000, 1000],
  cellCapacityUnits: ["tons", "tons", "tons", "tons", "tons", "tons"],
};

// A fake Mongoose document: only the surface the route touches.
function makeSubmission(overrides = {}) {
  const doc = {
    _id: SUBMISSION_ID,
    idNo: "SLF-PVT-PA-0007",
    submissionId: "SUB-1760000000000-abc123",
    slfGenerator: FACILITY_ID,
    slfName: "Demonstration Valley SLF",
    lguCompanyName: "Demonstration Valley",
    companyType: "Private",
    submittedBy: "operator@example.com",
    status: "acknowledged",
    baselineUnit: "tons",
    trucks: [
      {
        disposalTicketNo: "DT-001",
        plateNumber: "AAA-1111",
        wasteType: "Residual",
        actualVolume: 100,
        actualVolumeUnit: "tons",
        cellIndex: 2,
        cellName: "CELL 03",
        cellType: "Residual",
        vehicles: [],
      },
    ],
    cellCorrections: [],
    saved: 0,
    markModified() {},
    async save() {
      this.saved += 1;
    },
    toObject() {
      const { markModified, save, toObject, saved, ...rest } = this;
      return JSON.parse(JSON.stringify(rest));
    },
    ...overrides,
  };
  return doc;
}

// Minimal chainable query stub: `.select().sort().lean()` all return `this`,
// awaiting resolves to `value`.
const query = (value) => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    setOptions: () => chain,
    populate: () => chain,
    lean: () => chain,
    catch: (fn) => Promise.resolve(value).catch(fn),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return chain;
};

let server;
let baseUrl;
let submission;
let transactions;
let notifications;
let occupancyRefreshes;

test.before(async () => {
  // ── Stub the data layer ──
  AppLog.create = async () => ({});
  Transaction.create = async (doc) => {
    transactions.push(doc);
    return doc;
  };
  Notification.create = async (doc) => {
    notifications.push(doc);
    return doc;
  };
  UserPortal.find = () => query([]);
  SlfFacility.findById = () => query(FACILITY);
  SlfFacility.findByIdAndUpdate = () => {
    occupancyRefreshes += 1;
    return query({ ...FACILITY });
  };
  DataSLF.findOne = async () => submission;
  DataSLF.find = () => query([]);
  // requirePermission loads the caller's live permission set from the DB.
  User.findById = () =>
    query({ _id: ADMIN_ID, role: "admin", permissions: { cellWastePlacement: { view: true, edit: true } } });

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

test.beforeEach(() => {
  submission = makeSubmission();
  transactions = [];
  notifications = [];
  occupancyRefreshes = 0;
});

const tokenFor = (role) => jwt.sign({ id: String(ADMIN_ID), role, email: "admin@emb.gov.ph" }, process.env.JWT_SECRET);

async function correct(body, { role = "admin", token = null } = {}) {
  const headers = { "content-type": "application/json" };
  const bearer = token === null ? tokenFor(role) : token;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`${baseUrl}/api/data-slf/${SUBMISSION_ID}/correct-cell-placement`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const VALID = {
  truckIndex: 0,
  vehicleIndex: null,
  fromCellIndex: 2,
  toCellIndex: 4,
  reason: "Operator selected the wrong cell; the load was tipped in CELL 05.",
};

// ── TEST 4 — the correction itself ──────────────────────────────────────────
test("an acknowledged submission's cell is corrected, and the original is preserved", async () => {
  const { status, body } = await correct(VALID);
  assert.equal(status, 200, body.message);

  // Current placement moved.
  assert.equal(submission.trucks[0].cellIndex, 4);
  assert.equal(submission.trucks[0].cellName, "CELL 05");

  // Nothing else about the submission changed.
  assert.equal(String(submission._id), String(SUBMISSION_ID), "submission id unchanged");
  assert.equal(submission.idNo, "SLF-PVT-PA-0007", "reference unchanged");
  assert.equal(submission.trucks[0].actualVolume, 100, "waste volume unchanged");
  assert.equal(submission.trucks.length, 1, "no duplicate placement created");
  assert.equal(submission.status, "acknowledged", "a correction does not change the workflow status");
  assert.equal(submission.saved, 1, "one atomic document write");

  // The original placement survives, with who/when/why.
  assert.equal(submission.cellCorrections.length, 1);
  const audit = submission.cellCorrections[0];
  assert.equal(audit.fromCellIndex, 2);
  assert.equal(audit.fromCellName, "CELL 03");
  assert.equal(audit.toCellIndex, 4);
  assert.equal(audit.toCellName, "CELL 05");
  assert.equal(audit.volume, 100);
  assert.equal(audit.volumeUnit, "tons");
  assert.equal(audit.statusAtCorrection, "acknowledged");
  assert.match(audit.reason, /wrong cell/);
  assert.ok(audit.correctedBy, "the acting admin is recorded");
  assert.ok(audit.correctedAt instanceof Date, "the time is recorded");

  // …and in the application's existing audit log.
  const txn = transactions.find((t) => t.type === "cell_correction");
  assert.ok(txn, "a cell_correction transaction is written");
  assert.equal(txn.meta.fromCellName, "CELL 03");
  assert.equal(txn.meta.toCellName, "CELL 05");
  assert.equal(String(txn.dataEntry), String(SUBMISSION_ID));

  // Derived per-cell occupancy is recomputed, not hand-adjusted.
  assert.equal(occupancyRefreshes, 1);

  // The operator is told their placement moved.
  assert.ok(notifications.some((n) => n.recipient === "operator@example.com" && n.type === "cell_correction"));
});

test("a second correction appends to the history rather than replacing it", async () => {
  await correct(VALID);
  const { status } = await correct({ ...VALID, fromCellIndex: 4, toCellIndex: 1 });
  assert.equal(status, 200);
  assert.equal(submission.cellCorrections.length, 2);
  assert.deepEqual(
    submission.cellCorrections.map((c) => [c.fromCellName, c.toCellName]),
    [["CELL 03", "CELL 05"], ["CELL 05", "CELL 02"]],
  );
});

// ── TEST 5 — invalid cell ───────────────────────────────────────────────────
test("a cell the facility does not have is rejected", async () => {
  const { status, body } = await correct({ ...VALID, toCellIndex: 99 });
  assert.equal(status, 400);
  assert.match(body.message, /does not exist/i);
  assert.equal(submission.trucks[0].cellIndex, 2, "nothing was written");
  assert.equal(submission.cellCorrections.length, 0);
});

test("a non-active cell cannot receive waste", async () => {
  // CELL 04 is "Used/Completed".
  const { status, body } = await correct({ ...VALID, toCellIndex: 3 });
  assert.equal(status, 400);
  assert.match(body.message, /active cell/i);
  assert.equal(submission.trucks[0].cellIndex, 2);
});

// ── TEST 6 — same cell ──────────────────────────────────────────────────────
test("moving waste to the cell it is already in is rejected", async () => {
  const { status, body } = await correct({ ...VALID, toCellIndex: 2 });
  assert.equal(status, 400);
  assert.match(body.message, /same as the current cell/i);
  assert.equal(submission.cellCorrections.length, 0);
});

// ── TEST 7 — authorization ──────────────────────────────────────────────────
test("the correction endpoint is closed to unauthorized callers", async () => {
  const anonymous = await correct(VALID, { token: "" });
  assert.equal(anonymous.status, 401, "no token");

  const portalUser = await correct(VALID, { role: "portal_user" });
  assert.equal(portalUser.status, 403, "a portal user is not an admin");

  const viewer = await correct(VALID, { role: "viewer" });
  assert.equal(viewer.status, 403, "a non-admin admin-console role is not enough");

  assert.equal(submission.cellCorrections.length, 0, "no write on any rejected call");
  assert.equal(submission.saved, 0);
});

test("an admin without cellWastePlacement edit permission is refused", async () => {
  const original = User.findById;
  User.findById = () => query({ _id: ADMIN_ID, role: "admin", permissions: { cellWastePlacement: { view: true } } });
  try {
    const { status } = await correct(VALID);
    assert.equal(status, 403);
    assert.equal(submission.saved, 0);
  } finally {
    User.findById = original;
  }
});

// ── Validation ladder ───────────────────────────────────────────────────────
test("a reason is required and is what the audit entry records", async () => {
  const missing = await correct({ ...VALID, reason: "" });
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /reason for the correction is required/i);
  const tooShort = await correct({ ...VALID, reason: "oops" });
  assert.equal(tooShort.status, 400);
  assert.match(tooShort.body.message, /reason for the correction is required/i);
  assert.equal(submission.cellCorrections.length, 0);
  assert.equal(submission.saved, 0);
});

test("a stale screen cannot move waste that somebody else already moved", async () => {
  // The admin is looking at CELL 03; the stored placement is now CELL 02.
  submission.trucks[0].cellIndex = 1;
  const { status, body } = await correct(VALID);
  assert.equal(status, 409);
  assert.equal(body.code, "CELL_CHANGED");
  assert.equal(submission.trucks[0].cellIndex, 1, "the other admin's change stands");
});

test("waste that was never placed goes through assignment, not correction", async () => {
  submission.trucks[0].cellIndex = undefined;
  const { status, body } = await correct({ ...VALID, fromCellIndex: null });
  assert.equal(status, 400);
  assert.equal(body.code, "NOT_PLACED");
});

test("a reverted submission cannot be corrected behind the operator's back", async () => {
  submission.status = "reverted";
  const { status, body } = await correct(VALID);
  assert.equal(status, 409);
  assert.equal(body.code, "NOT_CORRECTABLE");
  assert.equal(submission.saved, 0);
});

test("a baseline container has no placement to correct", async () => {
  submission.trucks = [];
  const { status, body } = await correct(VALID);
  assert.equal(status, 400);
  assert.match(body.message, /no waste placement/i);
});

test("a placement index that is not on the submission is rejected", async () => {
  const badTruck = await correct({ ...VALID, truckIndex: 7 });
  assert.equal(badTruck.status, 400);
  const badVehicle = await correct({ ...VALID, vehicleIndex: 3 });
  assert.equal(badVehicle.status, 400);
  assert.equal(submission.saved, 0);
});

test("a submission whose reference has changed under the admin is refused", async () => {
  const { status, body } = await correct({ ...VALID, expectedIdNo: "SLF-PVT-PA-0001" });
  assert.equal(status, 409);
  assert.equal(body.code, "STALE_SUBMISSION");
});

// ── Per-vehicle placements ──────────────────────────────────────────────────
test("one vehicle of a multi-vehicle truck can be corrected on its own", async () => {
  submission.trucks[0].vehicles = [
    { plateNumber: "AAA-1111", actualVolume: 60, actualVolumeUnit: "tons", cellIndex: 2, cellName: "CELL 03" },
    { plateNumber: "BBB-2222", actualVolume: 40, actualVolumeUnit: "tons", cellIndex: 2, cellName: "CELL 03" },
  ];
  const { status } = await correct({ ...VALID, vehicleIndex: 1 });
  assert.equal(status, 200);
  assert.equal(submission.trucks[0].vehicles[1].cellIndex, 4, "the corrected vehicle moved");
  assert.equal(submission.trucks[0].vehicles[0].cellIndex, 2, "its sibling did not");
  assert.equal(submission.trucks[0].cellIndex, 2, "the truck-level copy still mirrors vehicle 0");
  assert.equal(submission.cellCorrections[0].volume, 40, "the vehicle's own volume is audited");
});

// ── Cache invalidation ──────────────────────────────────────────────────────
test("a correction invalidates every cache derived from waste placement", () => {
  const keys = require("../utils/cacheKeys");
  const socketEmit = fs.readFileSync(path.join(__dirname, "..", "utils", "socketEmit.js"), "utf8");
  const slfData = socketEmit.slice(socketEmit.indexOf("const slfData = ["), socketEmit.indexOf("switch (target)"));
  [
    "CELL_PLACEMENT_PREFIX",
    "CELL_USAGE_CACHE_PREFIX",
    "SUMMARY_BY_SLF_CACHE_KEY",
    "STATS_CACHE_PREFIX",
    "ADMIN_SUBMISSIONS_PREFIX",
    "ADMIN_SUMMARY_DASHBOARD_KEY",
    "WASTE_RECEIVED_PREFIX",
  ].forEach((key) => {
    assert.ok(keys[key], `${key} must exist`);
    assert.match(slfData, new RegExp(`keys\\.${key}`), `${key} must be invalidated on a submission write`);
  });
  // Targeted keys only — never a flush of the whole cache.
  assert.doesNotMatch(socketEmit, /flushall|flushdb/i);
  // The route emits the submission refresh, which is what runs the list above.
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const handler = route.slice(
    route.indexOf('router.patch(\n  "/:id/correct-cell-placement"'),
    route.indexOf("// Admin: assign submitted truck volumes"),
  );
  assert.match(handler, /refreshAdmin\(req, "submissions"\)/);
  assert.match(handler, /refreshPortal\(req, entry\.submittedBy, "submissions"\)/);
});

// ── Portal exposure ─────────────────────────────────────────────────────────
test("the admin correction trail is not shipped to the portal user", () => {
  const portalAuth = fs.readFileSync(path.join(__dirname, "..", "routes", "portalAuth.js"), "utf8");
  assert.match(portalAuth, /const PORTAL_HIDDEN_ADMIN_FIELDS = "-cellCorrections"/);
  // Both routes that return whole submission documents apply it.
  assert.ok(
    (portalAuth.match(/PORTAL_HIDDEN_ADMIN_FIELDS/g) || []).length >= 3,
    "the definition plus every whole-document route",
  );
  // The list projection is a whitelist, so it can never leak it.
  const listFields = portalAuth.slice(
    portalAuth.indexOf("const PORTAL_SUBMISSION_LIST_FIELDS"),
    portalAuth.indexOf("].join(\" \")"),
  );
  assert.doesNotMatch(listFields, /cellCorrections/);
});
