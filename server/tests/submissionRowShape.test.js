/**
 * An approved submission must not lose columns on its way back.
 *
 * THE DEFECT THIS PINS. `cellPlacement` and `remarks` are DERIVED, never stored —
 * both are pure functions of the submission's own `trucks`, computed on the way
 * out. The submissions LIST computed them; the approval endpoint returned raw
 * documents. The admin table merges an approval response straight over its row,
 * so approving a submission replaced an enriched row with an unenriched one and
 * the Cell Placement and Remarks columns fell back to their empty rendering —
 * "correct only after a refresh".
 *
 * It was never an asynchronous backend gap. There is no second process, no
 * placement record created later, nothing to wait for: the values are computable
 * from data the approval already has in hand. So the fix is a complete response,
 * not a refetch and not a retry — the columns are right in the same tick the
 * status is.
 *
 * `the approval response is shape-identical to a list row` is the test that
 * matters: it is what makes the lazy path and a page refresh agree.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const path = require("node:path");
const fs = require("node:fs");

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
const email = require("../utils/email");

const FACILITY_ID = new mongoose.Types.ObjectId();
const EMAIL = "operator@example.com";

const FACILITY = {
  _id: FACILITY_ID,
  lgu: "Prime SLF",
  slfName: "Prime SLF",
  cellNames: ["CELL 01", "CELL 02"],
  cellStatuses: ["Active Cell", "Active Cell"],
  numberOfCell: 2,
};

// A submission with THREE trucks: one fully placed, one unplaced, one with no
// declared capacity — so the derived columns have something real to say.
//   cellPlacement → { placed: 1, total: 3, known: true }  ("Partial (1/3)")
//   remarks       → "No truck capacity" + "Missing cell placement" + "Cell used…"
const makeEntry = (over = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  idNo: "SLF-PVT-PA-0100",
  submissionId: "SUB-1",
  submittedBy: EMAIL,
  slfGenerator: FACILITY,
  lguCompanyName: "Prime Waste",
  companyType: "Private",
  status: "acknowledged",
  baselineUnit: "tons",
  truckCount: 3,
  dateOfDisposal: new Date("2026-08-01"),
  trucks: [
    { actualVolume: 10, actualVolumeUnit: "tons", truckCapacity: 12, cellIndex: 0, cellName: "CELL 01", vehicles: [] },
    { actualVolume: 8, actualVolumeUnit: "tons", truckCapacity: 12, vehicles: [] },
    { actualVolume: 5, actualVolumeUnit: "tons", vehicles: [] },
  ],
  ...over,
});

const chain = (value) => {
  const c = {
    select: () => c, sort: () => c, setOptions: () => c, populate: () => c, lean: () => c,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (fn) => Promise.resolve(value).catch(fn),
  };
  return c;
};

let server; let baseUrl; let entries; let queryCount;

test.before(async () => {
  AppLog.create = async () => ({});
  Notification.updateMany = async () => ({});
  UserPortal.find = () => chain([]);
  AppSettings.findOne = () => chain({ truckCapacityAllowancePercent: 10 });
  SlfFacility.findById = () => chain(FACILITY);
  SlfFacility.findByIdAndUpdate = () => chain(FACILITY);
  Transaction.insertMany = async (l) => l;
  email.sendBulkAcknowledgeEmail = async () => {};

  DataSLF.updateMany = async () => ({ matchedCount: entries.length });
  DataSLF.find = () => { queryCount += 1; return chain(entries); };
  DataSLF.aggregate = () => {
    const result = [{ groups: [], meta: [] }];
    return { allowDiskUse: () => Promise.resolve(result), then: (r) => Promise.resolve(result).then(r) };
  };

  const app = express();
  app.use(express.json());
  app.set("io", { to: () => ({ emit: () => {} }) });
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { if (server) await new Promise((r) => server.close(r)); });
test.beforeEach(() => { entries = [makeEntry()]; queryCount = 0; });

const token = jwt.sign(
  { id: String(new mongoose.Types.ObjectId()), role: "admin", email: "admin@emb.gov.ph" },
  process.env.JWT_SECRET,
);

const approve = async (status = "acknowledged") => {
  const res = await fetch(`${baseUrl}/api/data-slf/bulk-status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids: entries.map((e) => String(e._id)), status }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ── The defect ──────────────────────────────────────────────────────────────
test("the approval response carries the derived Cell Placement column", async () => {
  const { status, body } = await approve();
  assert.equal(status, 200);

  const row = body.data[0];
  assert.ok(row.cellPlacement, "cellPlacement must be present — its absence IS the blank column");
  assert.deepEqual(
    row.cellPlacement,
    { placed: 1, total: 3, known: true },
    "and it must describe the real placement, not a placeholder",
  );
});

test("the approval response carries the derived Remarks column", async () => {
  const { body } = await approve();
  const texts = (body.data[0].remarks || []).map((r) => r.text);

  assert.ok(texts.length > 0, "remarks must be present — its absence IS the blank column");
  assert.ok(texts.includes("No truck capacity"), "the truck with no capacity is flagged");
  assert.ok(texts.includes("Missing cell placement"), "the unplaced trucks are flagged");
});

test("the approval response carries the new Status", async () => {
  entries = [makeEntry({ status: "acknowledged" })];
  const { body } = await approve("acknowledged");
  assert.equal(body.data[0].status, "acknowledged", "the row can be merged without waiting for a list fetch");
});

// ── The property that makes lazy-load and refresh agree ─────────────────────
test("the approval response is shape-identical to a list row", async () => {
  const { body } = await approve();
  const approvalRow = body.data[0];

  // Every field the admin table reads off a row must be present, so a merged row
  // and a refreshed row render the same thing.
  [
    "_id", "idNo", "submissionId", "status", "lguCompanyName", "companyType",
    "submittedBy", "truckCount", "cellPlacement", "remarks", "cellNames",
    "isResubmission", "trucks",
  ].forEach((field) =>
    assert.ok(Object.hasOwn(approvalRow, field), `a list row has ${field}; the approval row must too`),
  );

  // `trucks` is emptied exactly as the Submissions tab's list does (it does not
  // request them), so merging cannot silently fatten the table's state either.
  assert.deepEqual(approvalRow.trucks, [], "trucks are stripped the same way the list strips them");
});

// ── The `remarks` name collision ────────────────────────────────────────────
test("a whole-record read does NOT carry the derived remarks array", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");

  // `remarks` means two things. DataSLF has no such field, so a consumer reading
  // `record.remarks` is reading a free-text remark that falls through to
  // resubmitComment/revertReason — while the admin submissions TABLE uses the
  // same name for a derived array of {text, level} flags.
  //
  // Attaching the array to a whole-record read renders an object as a React child
  // and takes the page down: SubmissionSummary's disposal calendar fetches
  // `mode=list&includeTrucks=true` and crashed with "Objects are not valid as a
  // React child (found: object with keys {text, level})".
  assert.match(
    source,
    /enrichSubmissionRow\(raw, \{ allowancePct, includeTrucks, derive: !includeTrucks \}\)/,
    "the whole-record branch must opt OUT of the derived columns",
  );
  assert.match(
    source,
    /function enrichSubmissionRow\(raw, \{ allowancePct = 10, includeTrucks = false, derive = true(, ticketReuse = null)? \} = \{\}\)/,
    "…and the helper must support that",
  );
  // The derived columns are behind the flag, not unconditional.
  const helper = source.slice(
    source.indexOf("function enrichSubmissionRow"),
    source.indexOf("/** The truck-capacity allowance"),
  );
  assert.match(helper, /\.\.\.\(derive\s*\n?\s*\? \{/, "the derived block is conditional");
  assert.ok(
    helper.indexOf("remarks: computeSubmissionRemarks") > helper.indexOf("...(derive"),
    "remarks is inside the conditional block",
  );
});

test("the table read still gets its derived columns", () => {
  // The fix must not have removed them from the reads that DO render the column.
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  // `ticketReuse` (cross-submission ticket flag) is an additional derived input.
  assert.match(source, /enrichSubmissionRow\(raw, \{ allowancePct, includeTrucks(, ticketReuse)? \}\)/, "the paginated list");
  assert.match(source, /enrichSubmissionRow\(raw, \{ allowancePct, includeTrucks: false(, ticketReuse)? \}\)/, "the approval response");
});

test("both shapes come from ONE helper, so they cannot drift apart again", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const calls = source.match(/enrichSubmissionRow\(/g) || [];
  assert.ok(calls.length >= 4, "the list branches and the approval route all go through the helper");
  // The inline copies the list used to carry are gone — a second copy is how the
  // approval route came to return a different shape in the first place.
  assert.equal(
    (source.match(/cellPlacement: computeCellPlacementSummary\(entry\)/g) || []).length,
    1,
    "exactly one place computes the row shape",
  );
});

// ── It must not cost anything ───────────────────────────────────────────────
test("enriching the response adds no database round trip", async () => {
  // Three fixed reads, none of them per-row: the response read, the sibling
  // lookup behind the "is the whole submission acknowledged?" email rule, and the
  // occupancy recompute's own read. The derived columns are pure functions of
  // `trucks`, which the response read already loaded.
  await approve();
  const forOne = queryCount;
  assert.equal(forOne, 3);

  // The real invariant: approving THREE submissions costs the same reads as one.
  entries = [makeEntry({ submissionId: "A" }), makeEntry({ submissionId: "B" }), makeEntry({ submissionId: "C" })];
  queryCount = 0;
  await approve();
  assert.equal(queryCount, forOne, "reads must not scale with the number of submissions approved");
});

// ── Real emptiness is not a loading state ───────────────────────────────────
test("a submission with no trucks reports 'not known', not a fake placement", async () => {
  entries = [makeEntry({ trucks: [], truckCount: 0 })];
  const { body } = await approve();
  assert.deepEqual(
    body.data[0].cellPlacement,
    { placed: 0, total: 0, known: false },
    "known:false is how the table tells 'no waste data' from 'not loaded yet'",
  );
  assert.deepEqual(body.data[0].remarks, [], "and an empty remarks list is a real answer");
});

test("a fully placed submission reports no placement warning", async () => {
  entries = [makeEntry({
    trucks: [{ actualVolume: 10, actualVolumeUnit: "tons", truckCapacity: 12, cellIndex: 0, cellName: "CELL 01", vehicles: [] }],
    truckCount: 1,
  })];
  const { body } = await approve();
  assert.deepEqual(body.data[0].cellPlacement, { placed: 1, total: 1, known: true });
  const texts = (body.data[0].remarks || []).map((r) => r.text);
  assert.ok(!texts.includes("Missing cell placement"), "nothing is flagged that is not wrong");
  assert.ok(texts.includes("Cell used for waste placement"));
});

// ── Multiple submissions must not cross-contaminate ─────────────────────────
test("each approved submission gets its OWN derived values", async () => {
  entries = [
    makeEntry({ submissionId: "SUB-A" }),
    makeEntry({
      submissionId: "SUB-B",
      truckCount: 1,
      trucks: [{ actualVolume: 4, actualVolumeUnit: "tons", truckCapacity: 9, cellIndex: 1, cellName: "CELL 02", vehicles: [] }],
    }),
  ];
  const { body } = await approve();
  const bySubmission = Object.fromEntries(body.data.map((r) => [r.submissionId, r]));
  assert.deepEqual(bySubmission["SUB-A"].cellPlacement, { placed: 1, total: 3, known: true });
  assert.deepEqual(bySubmission["SUB-B"].cellPlacement, { placed: 1, total: 1, known: true });
});

// ── The browser half ────────────────────────────────────────────────────────
const settingsSource = () =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "SubmissionSettings.jsx"),
    "utf8",
  );

test("the table MERGES an approval response over the row, never replaces it", () => {
  const source = settingsSource();
  const helper = source.slice(
    source.indexOf("const applyUpdatedEntries"),
    source.indexOf("const applyUpdatedEntries") + 700,
  );
  assert.match(helper, /\{ \.\.\.entry, \.\.\.next \}/, "a merge keeps fields the response omits");
  // The wholesale swap that dropped the derived columns.
  assert.doesNotMatch(
    source,
    /updatedById\.get\(entry\._id\) \|\| entry/,
    "the replace-the-whole-row merge must not come back",
  );
  // Both write paths (acknowledge + reject) go through the one helper.
  assert.equal(
    (source.match(/applyUpdatedEntries\(/g) || []).length,
    2,
    "runAcknowledgeFlow and updateStatus both call it",
  );
});

test("a list response that predates an approval cannot repaint the old status", () => {
  const source = settingsSource();
  // Request A approves; request B (already in flight) returns pre-approval rows.
  // Without this guard B lands last and the row reverts until the next refresh.
  assert.match(source, /const seenMutationSeq = mutationSeqRef\.current;/, "the fetch snapshots the counter");
  assert.match(
    source,
    /if \(mutationSeqRef\.current !== seenMutationSeq\) return;/,
    "and a payload from before the write is dropped",
  );
  assert.match(source, /mutationSeqRef\.current \+= 1;/, "every confirmed write bumps it");
});

test("approval does not trigger a full-table reload of its own", () => {
  const source = settingsSource();
  const flow = source.slice(
    source.indexOf("const runAcknowledgeFlow"),
    source.indexOf("const updateStatus"),
  );
  // The row is updated from the confirmed response; the authoritative catch-up is
  // the debounced socket refetch, not an immediate second full query.
  assert.doesNotMatch(flow, /fetchData\(\s*\{\s*force:\s*true/, "no eager full refetch after approving");
  assert.match(flow, /applyUpdatedEntries\(/, "the row is updated in place instead");
});
