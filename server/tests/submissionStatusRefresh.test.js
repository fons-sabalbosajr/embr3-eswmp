/**
 * Approval → the status is visible immediately.
 *
 * THE DEFECT THIS PINS. `PATCH /data-slf/bulk-status` used to send its response
 * only after awaiting everything an approval sets in motion: a facility-wide
 * occupancy recompute, one Transaction insert per entry, one sibling lookup per
 * acknowledged submission, and an SMTP send per submission. The status was
 * durable after the first updateMany, but the admin's browser sat through all of
 * it before being told so — which is what "the status does not update promptly
 * after approval" actually was. It also never broadcast, so no other open session
 * learned about the approval at all until a cache TTL expired.
 *
 * The decisive test is `the response does not wait for the acknowledgement
 * email`: the mail transport is held open, and the HTTP response must still
 * arrive. If the derived work ever moves back in front of res.json(), that test
 * hangs and fails on its own timeout rather than quietly getting slower.
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
const Notification = require("../models/Notification");
const AppLog = require("../models/AppLog");
const AppSettings = require("../models/AppSettings");

// `routes/dataSLF.js` destructures the mail helpers at module load, so the email
// module has to be patched BEFORE the router is required or the real transport
// binding is captured.
const email = require("../utils/email");

const FACILITY_ID = new mongoose.Types.ObjectId();
const EMAIL = "operator@example.com";
const OTHER_EMAIL = "second.operator@example.com";

const FACILITY = {
  _id: FACILITY_ID,
  numberOfCell: 2,
  cellNames: ["CELL 01", "CELL 02"],
  cellStatuses: ["Active Cell", "Active Cell"],
  cellTypes: ["Residual", "Residual"],
  cellCapacities: [1000, 1000],
  cellCapacityUnits: ["tons", "tons"],
  cellFillValues: [0, 0],
  cellFillUnits: ["tons", "tons"],
  volumeCapacityUnit: "tons",
  wasteReceivedUnit: "tons",
};

// Two submitters × two submissions each, four entries each — the shape that used
// to cost one sibling lookup and one SMTP send per submission.
const makeEntries = () => {
  const rows = [];
  [EMAIL, OTHER_EMAIL].forEach((submittedBy, s) => {
    ["A", "B"].forEach((suffix) => {
      for (let i = 0; i < 4; i += 1) {
        rows.push({
          _id: new mongoose.Types.ObjectId(),
          idNo: `SLF-PVT-PA-${s}${suffix}${i}`,
          submissionId: `SUB-${s}-${suffix}`,
          submittedBy,
          slfGenerator: { _id: FACILITY_ID, lgu: "Prime SLF" },
          lguCompanyName: "Prime Waste",
          companyType: "Private",
          status: "acknowledged", // the state updateMany has just written
          dateOfDisposal: new Date("2026-08-01"),
          trucks: [{ actualVolume: 5, actualVolumeUnit: "tons", cellIndex: 0 }],
        });
      }
    });
  });
  return rows;
};

const chain = (value) => {
  const c = {
    select: () => c, sort: () => c, setOptions: () => c, populate: () => c, lean: () => c,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (fn) => Promise.resolve(value).catch(fn),
  };
  return c;
};

/** A promise the test releases by hand, so ordering can be observed. */
const deferred = () => {
  let release;
  const promise = new Promise((r) => { release = r; });
  return { promise, release };
};

const waitFor = async (predicate, label, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`timed out waiting for: ${label}`);
};

let server; let baseUrl; let entries;
let emitted; let findFilters; let transactionInserts; let emailCalls;
let occupancyWrites; let emailGate;

test.before(async () => {
  AppLog.create = async () => ({});
  Notification.updateMany = async () => ({});
  UserPortal.find = () => chain([]);
  AppSettings.findOne = () => chain({ excludePreBaselineDisposalFromCellFill: false });
  SlfFacility.findById = () => chain(FACILITY);
  SlfFacility.findByIdAndUpdate = () => { occupancyWrites += 1; return chain(FACILITY); };

  DataSLF.updateMany = async () => ({ matchedCount: entries.length, modifiedCount: entries.length });
  DataSLF.find = (filter = {}) => {
    findFilters.push(filter);
    // The route reads by _id (the response), by submissionId (the "is the whole
    // submission acknowledged?" rule) and by slfGenerator (occupancy).
    if (filter.submissionId) return chain(entries);
    if (filter.slfGenerator) return chain(entries);
    return chain(entries);
  };
  Transaction.insertMany = async (list) => { transactionInserts.push(list); return list; };
  Transaction.create = async () => {
    assert.fail("audit rows must be inserted in one batch, not one create per entry");
  };

  email.sendBulkAcknowledgeEmail = async (to, payload) => {
    emailCalls.push({ to, payload });
    await emailGate.promise; // held open until the test releases it
  };

  const app = express();
  app.use(express.json());
  // Capture what the route broadcasts, the way Socket.IO would receive it.
  app.set("io", {
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  });
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (emailGate) emailGate.release();
  if (server) await new Promise((r) => server.close(r));
});

test.beforeEach(() => {
  entries = makeEntries();
  emitted = [];
  findFilters = [];
  transactionInserts = [];
  emailCalls = [];
  occupancyWrites = 0;
  emailGate = deferred();
});

const token = jwt.sign(
  { id: String(new mongoose.Types.ObjectId()), role: "admin", email: "admin@emb.gov.ph" },
  process.env.JWT_SECRET,
);

async function bulkStatus(body) {
  const res = await fetch(`${baseUrl}/api/data-slf/bulk-status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    // A regression that puts the email back in the request path would hang here;
    // fail fast and loudly instead of stalling the suite.
    signal: AbortSignal.timeout(4000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const ids = () => entries.map((e) => String(e._id));

// ── The defect itself ───────────────────────────────────────────────────────
test("the response does not wait for the acknowledgement email", async () => {
  // The transport is held open for the whole request. If the route still awaited
  // it before answering, this fetch could not resolve.
  const { status, body } = await bulkStatus({ ids: ids(), status: "acknowledged" });

  assert.equal(status, 200, "the approval is reported while mail is still in flight");
  assert.equal(body.data.length, entries.length);
  assert.ok(
    body.data.every((e) => e.status === "acknowledged"),
    "the response carries the NEW status, so the table can merge it in place",
  );
  assert.equal(emailGate.promise instanceof Promise, true);

  // …and the mail really was still outstanding when the answer went out.
  assert.equal(emailCalls.length > 0, true, "the email was started, just not awaited");
  emailGate.release();
});

test("the approval is broadcast so other sessions re-read it", async () => {
  await bulkStatus({ ids: ids(), status: "acknowledged" });
  emailGate.release();

  // The "submissions" broadcast is issued synchronously, before the response, so
  // it is deterministic here. (The background occupancy recompute later emits a
  // second admin event targeted "facility" — a different target, which is why the
  // admin listeners filter on it, and why the ones that accept BOTH targets
  // debounce: one approval legitimately produces two refresh signals.)
  const submissions = emitted.filter(
    (e) => e.room === "admin-room" && e.event === "data-refresh" && e.payload.target === "submissions",
  );
  assert.equal(submissions.length, 1, "exactly one admin broadcast — this used to be zero");

  // Both submitters' portal rooms are told, once each — not once per entry.
  const portalRooms = emitted
    .filter((e) => e.event === "data-refresh" && e.room.startsWith("portal-"))
    .map((e) => e.room);
  assert.deepEqual(
    [...portalRooms].sort(),
    [`portal-${EMAIL}`, `portal-${OTHER_EMAIL}`].sort(),
    "each distinct submitter is notified exactly once",
  );
});

// ── The N+1s that made it slow ──────────────────────────────────────────────
test("audit rows are one batched insert, never one per entry", async () => {
  await bulkStatus({ ids: ids(), status: "acknowledged" });
  emailGate.release();

  await waitFor(() => transactionInserts.length > 0, "the audit insert");
  assert.equal(transactionInserts.length, 1, "one insertMany for all 16 entries");
  assert.equal(transactionInserts[0].length, entries.length);
  assert.ok(
    transactionInserts[0].every((t) => t.type === "status_change"),
    "the audit content is unchanged — only how it is written",
  );
  // Transaction.create is stubbed to fail the test outright, so a reintroduced
  // per-entry loop cannot pass silently.
});

test("the whole-submission check is ONE lookup, not one per submission", async () => {
  await bulkStatus({ ids: ids(), status: "acknowledged" });
  emailGate.release();

  await waitFor(() => emailCalls.length === 4, "one email per submission group");

  const siblingLookups = findFilters.filter((f) => f.submissionId);
  assert.equal(siblingLookups.length, 1, "four submissions, one query");
  assert.ok(siblingLookups[0].submissionId.$in, "resolved with $in, not one id at a time");
  assert.deepEqual(
    [...siblingLookups[0].submissionId.$in].sort(),
    ["SUB-0-A", "SUB-0-B", "SUB-1-A", "SUB-1-B"],
    "every affected submission is covered by the single query",
  );
});

// ── Business rules that must survive the reordering ─────────────────────────
test("one email per submission, addressed to its own submitter", async () => {
  await bulkStatus({ ids: ids(), status: "acknowledged" });
  emailGate.release();

  await waitFor(() => emailCalls.length === 4, "the acknowledgement emails");
  assert.deepEqual(
    emailCalls.map((c) => c.to).sort(),
    [EMAIL, EMAIL, OTHER_EMAIL, OTHER_EMAIL],
    "grouped by submittedBy + submissionId, exactly as before",
  );
});

test("a submission that is not fully acknowledged is not emailed", async () => {
  // One entry of SUB-0-A is still pending — the rule says hold that email.
  entries[0].status = "pending";
  await bulkStatus({ ids: ids(), status: "acknowledged" });
  emailGate.release();

  await waitFor(() => emailCalls.length === 3, "the three complete submissions");
  assert.equal(
    emailCalls.some((c) => c.payload.submissionId === "SUB-0-A"),
    false,
    "a partially acknowledged submission must not be announced as complete",
  );
});

test("occupancy is still recomputed after the response", async () => {
  await bulkStatus({ ids: ids(), status: "acknowledged" });
  emailGate.release();

  // Derived, deferred — but never dropped. This is the data-correctness half of
  // the fix: moving the work off the request must not lose it.
  await waitFor(() => occupancyWrites > 0, "the occupancy recompute");
  assert.equal(occupancyWrites, 1, "one recompute for the one facility involved");
});

test("a rejection broadcasts too, and sends no acknowledgement email", async () => {
  const { status } = await bulkStatus({ ids: ids(), status: "rejected" });
  emailGate.release();

  assert.equal(status, 200);
  assert.equal(
    emitted.filter(
      (e) => e.room === "admin-room" && e.event === "data-refresh" && e.payload.target === "submissions",
    ).length,
    1,
    "a rejection changes what is visible just as much as an approval",
  );
  await waitFor(() => transactionInserts.length > 0, "the audit insert");
  assert.equal(emailCalls.length, 0, "acknowledgement mail is for acknowledgements only");
});

test("an invalid status is still refused before anything is written", async () => {
  const { status, body } = await bulkStatus({ ids: ids(), status: "acknowledgedd" });
  emailGate.release();
  assert.equal(status, 400);
  assert.match(body.message, /Invalid status/);
  assert.equal(emitted.length, 0, "nothing is broadcast for a rejected request");
  assert.equal(transactionInserts.length, 0);
});
