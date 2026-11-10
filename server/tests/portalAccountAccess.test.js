/**
 * Portal account access, the drafts queue, and the costs behind both.
 *
 * Three reports from one account (Prime Waste Solution) turned out to be three
 * faces of the same neglect, and none of them was specific to that account:
 *
 *   1. "Cannot load support tickets — it says I can only view my own."
 *      The portal JWT carried { id, role } and no `email`, so the self-check in
 *      GET /support-tickets/my-tickets/:email compared "" against the requested
 *      address and refused. EVERY portal user, every request.
 *
 *   2. "Cannot submit though the details are complete."
 *      The pre-submit gate loaded every submission the account had ever filed
 *      WITH its whole `trucks` array — haulers, plates, and a selectedClients
 *      list on each truck and each of its vehicles.
 *
 *   3. "Drafts & Scheduled times out." Same shape: the list hydrated every queue
 *      record with its whole payload, unprojected, unlimited, sorted in memory.
 *
 * The ticket guard is exercised against a REAL Express app so the middleware
 * chain is proven rather than read; the query shapes are asserted at the source,
 * because what went wrong there was the shape itself.
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

const readSource = (...parts) =>
  fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

// ── 1. The ticket guard, against a real app ─────────────────────────────────

const SupportTicket = require("../models/SupportTicket");
const UserPortal = require("../models/UserPortal");

const OWNER_ID = new mongoose.Types.ObjectId();
const OTHER_ID = new mongoose.Types.ObjectId();
const OWNER_EMAIL = "rtabella@piwsi.ph";
const OTHER_EMAIL = "someone.else@example.com";

const query = (value) => {
  const chain = {
    select: () => chain,
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: () => chain,
    maxTimeMS: () => chain,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return chain;
};

const TICKETS = [{ ticketNo: "TKT-0001", portalUserEmail: OWNER_EMAIL, subject: "Cannot submit" }];

let server;
let baseUrl;

test.before(async () => {
  SupportTicket.find = () => query(TICKETS);
  SupportTicket.countDocuments = () => query(TICKETS.length);
  SupportTicket.findById = () => query({ _id: "t1", portalUserEmail: OWNER_EMAIL });
  // The accounts the id-only tokens below resolve to.
  UserPortal.findById = (id) =>
    query(
      String(id) === String(OWNER_ID)
        ? { _id: OWNER_ID, email: OWNER_EMAIL }
        : { _id: OTHER_ID, email: OTHER_EMAIL },
    );

  const app = express();
  app.use(express.json());
  app.use("/api/support-tickets", require("../routes/supportTickets"));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

// A token of the shape the portal issued BEFORE the fix: identity, no address.
const legacyPortalToken = (id) =>
  jwt.sign({ id: String(id), role: "portal_user" }, process.env.JWT_SECRET);
const currentPortalToken = (id, email) =>
  jwt.sign({ id: String(id), role: "portal_user", email }, process.env.JWT_SECRET);

const get = async (url, token) => {
  const res = await fetch(`${baseUrl}${url}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("a portal user reaches their own tickets with a token that carries no email", async () => {
  // THE reported bug. A 7-day token issued before the `email` claim existed must
  // keep working — telling everyone already signed in to sign in again is not a
  // fix, it is the same outage with an extra step.
  const res = await get(
    `/api/support-tickets/my-tickets/${encodeURIComponent(OWNER_EMAIL)}`,
    legacyPortalToken(OWNER_ID),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.tickets.length, 1);
});

test("a token that DOES carry the email works the same way", async () => {
  const res = await get(
    `/api/support-tickets/my-tickets/${encodeURIComponent(OWNER_EMAIL)}`,
    currentPortalToken(OWNER_ID, OWNER_EMAIL),
  );
  assert.equal(res.status, 200);
});

test("the address is matched case-insensitively, as it is stored", async () => {
  const res = await get(
    `/api/support-tickets/my-tickets/${encodeURIComponent(OWNER_EMAIL.toUpperCase())}`,
    legacyPortalToken(OWNER_ID),
  );
  assert.equal(res.status, 200);
});

test("asking for SOMEONE ELSE's tickets is still refused", async () => {
  // The guard must not have been loosened into a no-op by the fallback: the
  // fallback supplies the caller's identity, it does not skip the comparison.
  const res = await get(
    `/api/support-tickets/my-tickets/${encodeURIComponent(OWNER_EMAIL)}`,
    legacyPortalToken(OTHER_ID),
  );
  assert.equal(res.status, 403);
  assert.match(res.body.message, /only view your own/i);
});

test("a portal user cannot list the WHOLE ticket queue", async () => {
  // GET / returns every user's tickets, contact details and attachments. It
  // carried no role check at all — only `requireAnyAuth`.
  const res = await get("/api/support-tickets", legacyPortalToken(OWNER_ID));
  assert.equal(res.status, 403);
});

test("a portal user cannot open another user's ticket by id", async () => {
  const res = await get("/api/support-tickets/t1", legacyPortalToken(OTHER_ID));
  assert.equal(res.status, 403);
});

test("…but can open their own", async () => {
  const res = await get("/api/support-tickets/t1", legacyPortalToken(OWNER_ID));
  assert.equal(res.status, 200);
});

test("an unauthenticated caller gets nothing", async () => {
  const res = await get(`/api/support-tickets/my-tickets/${encodeURIComponent(OWNER_EMAIL)}`);
  assert.equal(res.status, 401);
});

// ── 2. The token now states who the caller is ───────────────────────────────

test("both realms put the caller's email in the token they issue", () => {
  assert.match(
    readSource("routes", "portalAuth.js"),
    /role: "portal_user",\s*email: String\(user\.email \|\| ""\)\.trim\(\)\.toLowerCase\(\),/,
  );
  assert.match(
    readSource("routes", "auth.js"),
    /role: user\.role,\s*email: String\(user\.email \|\| ""\)\.trim\(\)\.toLowerCase\(\),/,
  );
});

test("the login response carries the account's portal rules", () => {
  // The portal gates its own controls on portalAccess. It used to arrive only on
  // the /me refresh that follows, so the first render showed every control
  // regardless of what the account is allowed.
  assert.match(readSource("routes", "portalAuth.js"), /portalAccess: user\.portalAccess,/);
});

// ── 3. The pre-submit gate no longer reads whole submissions ────────────────

test("the Organize Cells gate trims trucks in the pipeline, not with a sub-field select", () => {
  const dataSlf = readSource("routes", "dataSLF.js");
  const gate = dataSlf.slice(
    dataSlf.indexOf("async function assertNoUnorganizedPortalSubmissions"),
    dataSlf.indexOf("// Collect the distinct cell names"),
  );
  assert.ok(gate.length > 0);

  // Selecting `trucks` WHOLE was the original bug — a truck carries haulers,
  // plates, addresses and a selectedClients array, on every submission ever
  // filed by the account.
  assert.doesNotMatch(
    gate,
    /\.select\("idNo submissionId dateOfDisposal status trucks truckCount/,
  );
  // Asking for the sub-fields with a dotted `select` was the SECOND bug: a
  // sub-field projection into a nested array makes the server rebuild the
  // structure per document. $map costs a fraction of it.
  assert.doesNotMatch(gate, /\.select\(ORGANIZE_NEED_PROJECTION\)/);
  assert.match(gate, /const trimmedTrucks = \{\s*\$map:/);

  // The six values summarizePortalOrganizeNeed() actually looks at, in the shape
  // it expects — so that function runs unchanged.
  for (const field of ["cellIndex", "actualVolume", "truckCapacity", "capacity"]) {
    assert.ok(gate.includes(`${field}:`), `the trimmed shape must carry ${field}`);
  }

  // A record with no trucks scores 0/0 and cannot block — and those are the
  // BASELINE containers holding the multi-megabyte hauler array.
  assert.match(gate, /\.\.\.SUBMISSION_HAS_TRUCKS,/);

  // An aggregation has no populate, so the facilities must still be attached or
  // isValidPortalCellRef silently treats every cell as unknown.
  assert.match(gate, /SlfFacility\.find\(\{ _id: \{ \$in: facilityIds \} \}\)/);
  assert.match(gate, /entry\.slfGenerator = byId\.get\(String\(entry\.slfGenerator\)\) \|\| null/);
  assert.match(gate, /maxTimeMS: PORTAL_GATE_MAX_TIME_MS/);
});

test("a database timeout is answered as a timeout, not as a rejected submission", () => {
  const dataSlf = readSource("routes", "dataSLF.js");
  assert.match(dataSlf, /function isDatabaseTimeout\(error\)/);
  assert.match(dataSlf, /if \(isDatabaseTimeout\(error\)\) \{[\s\S]{0,600}?return res\.status\(503\)/);
  // …and it names the stage it died in, so the next one is diagnosable instead
  // of being an opaque driver error.
  assert.match(dataSlf, /"submission\.db_timeout"/);
  assert.match(dataSlf, /stage: error\.slowStage \|\| "unknown"/);
  // The operator must not be told their data was wrong when it was not…
  assert.match(dataSlf, /Nothing was submitted and nothing was lost/);
  // …and the queue must not stamp a permanent `failed` on a record that would
  // submit fine on a retry.
  const queue = readSource("routes", "portalQueue.js");
  const submitCatch = queue.slice(queue.indexOf("} catch (submitErr) {"));
  assert.ok(
    submitCatch.indexOf("isDatabaseTimeout") < submitCatch.indexOf('record.status = "failed"'),
    "the timeout must be recognised BEFORE the record is marked failed",
  );
});

test("the submit path's baseline lookups have an index that matches them", () => {
  // THE collection scan. Every slfGenerator/slfName index is prefixed with
  // `deletedAt`, and these two queries do not constrain it — so neither index
  // applied and both scanned the whole collection, fetching every submission
  // document with its full `trucks` and `accreditedHaulers` arrays, once per
  // entry being submitted.
  const model = readSource("models", "DataSLF.js");
  assert.match(model, /index\(\{ slfGenerator: 1, createdAt: -1 \}\)/);
  assert.match(model, /index\(\{ slfName: 1, createdAt: -1 \}\)/);

  const dataSlf = readSource("routes", "dataSLF.js");
  // Both are bounded as well, so a data problem cannot restore the old shape.
  const haulers = dataSlf.slice(
    dataSlf.indexOf("async function getAuthoritativeHaulersForEntry"),
    dataSlf.indexOf("async function validateUploadedClientRelationships"),
  );
  assert.match(haulers, /\$limit: BASELINE_LOOKUP_LIMIT/);
  assert.match(haulers, /maxTimeMS: PORTAL_GATE_MAX_TIME_MS/);
});

test("the roster union happens in the database, not over the wire", () => {
  // `accreditedHaulers` is duplicated onto every baseline-carrying record — 22 of
  // them, 5,099 KB, for the facility this was reported on. The union across those
  // copies is what this path needs, so it could not simply project the array
  // away like the Data Entry read did; it pulled all 5 MB and unioned in JS, on a
  // 15-row submission. $unwind/$group collapses it where the data already is.
  const dataSlf = readSource("routes", "dataSLF.js");
  const roster = dataSlf.slice(
    dataSlf.indexOf("async function getAuthoritativeHaulersForEntry"),
    dataSlf.indexOf("async function validateUploadedClientRelationships"),
  );
  assert.match(roster, /DataSLF\.aggregate\(\[/);
  assert.doesNotMatch(roster, /\.select\("accreditedHaulers createdAt"\)/);

  // All THREE places haulerClientPool() reads a client from must be unioned, or
  // a client recorded in only one of them reads as unaccredited and the
  // submission is refused.
  assert.match(roster, /privateSectorClients/);
  assert.match(roster, /accreditedHaulers\.clients/);
  assert.match(roster, /selectedClients/);

  // A hauler with no clients on file must survive the unwind — dropping it turns
  // "no clients yet" into "not assigned under this SLF".
  assert.match(roster, /preserveNullAndEmptyArrays: true/);

  // $match does not cast; an uncast id matches nothing and the roster comes back
  // empty, which reads as "hauler not assigned".
  assert.match(dataSlf, /new mongoose\.Types\.ObjectId\(id\)/);

  // The canonical identity rules stay in ONE place: the pipeline only pre-dedupes
  // on a coarser-safe key, and the JS merge still decides what is one hauler.
  assert.match(roster, /mergeAccreditedHaulerCopies\(/);
});

test("the capacity map reads two fields, not every client list", () => {
  const dataSlf = readSource("routes", "dataSLF.js");
  const capacities = dataSlf.slice(
    dataSlf.indexOf("async function readDeclaredCapacityMap"),
    dataSlf.indexOf("async function validateUploadedClientRelationships"),
  );
  assert.ok(capacities.length > 0);
  // Selecting the array whole dragged every hauler's client lists along for a
  // plate and a number…
  assert.doesNotMatch(capacities, /\.select\("accreditedHaulers"\)/);
  // …and asking for the two sub-fields with a dotted select was WORSE than
  // whole-field: measured at 14 s for one facility, and a timeout without a
  // deadline. The trim belongs in the pipeline.
  assert.doesNotMatch(capacities, /\.select\("accreditedHaulers\.vehicles/);
  assert.match(capacities, /DataSLF\.aggregate\(\[/);
  assert.match(capacities, /plateNumber: "\$\$v\.plateNumber", capacity: "\$\$v\.capacity"/);
  assert.match(capacities, /maxTimeMS: PORTAL_GATE_MAX_TIME_MS/);
  // Only a real, positive capacity is a declaration — same guard as the loop.
  assert.match(capacities, /Number\.isFinite\(cap\) && cap > 0/);
});

test("the benchmark times the real capacity read, not a copy of it", () => {
  // It mirrored the query once. The mirror went stale the moment the route
  // changed, and the benchmark then reported a 14 s cost for an implementation
  // that no longer existed — and blocked a deploy over it.
  const bench = readSource("scripts", "benchSubmitGates.js");
  assert.match(bench, /readDeclaredCapacityMap,/);
  assert.match(bench, /await readDeclaredCapacityMap\(\{ slfGenerator: slfGeneratorId \}\)/);
  assert.doesNotMatch(bench, /\.select\("accreditedHaulers/);
  assert.match(
    readSource("routes", "dataSLF.js"),
    /module\.exports\.readDeclaredCapacityMap = readDeclaredCapacityMap;/,
  );
});

test("the aggregation's output still merges the way the JS union did", () => {
  // The pipeline groups on lowercase/trim; mergeAccreditedHaulerCopies groups on
  // normalizeRelationshipText, which ALSO folds commas, semicolons and dashes —
  // strictly coarser. So the pipeline can only remove pairs the merge would have
  // collapsed anyway, and the "one hauler or two?" decision is unchanged. These
  // feed the aggregation's output shape ({ haulerName, clients }) through the
  // real merge to prove it.
  const { mergeAccreditedHaulerCopies } = require("../routes/dataSLF");

  // Two spellings the pipeline keeps apart and the merge folds together.
  const merged = mergeAccreditedHaulerCopies([
    { haulerName: "MUNICIPAL-HAULER", clients: [{ clientName: "Limay Public Market" }] },
    { haulerName: "MUNICIPAL HAULER", clients: [{ clientName: "Wawa" }] },
  ]);
  assert.equal(merged.length, 1, "one hauler, not an ambiguous pair");
  assert.deepEqual(
    merged[0].clients.map((c) => c.clientName).sort(),
    ["Limay Public Market", "Wawa"],
    "the client pool is the UNION of every copy",
  );

  // A hauler carried through the unwind with no clients keeps its identity — the
  // difference between "no clients on file" and "not assigned under this SLF".
  const empty = mergeAccreditedHaulerCopies([{ haulerName: "NEW HAULER", clients: [] }]);
  assert.equal(empty.length, 1);
  assert.deepEqual(empty[0].clients, []);

  // A client stored as a bare string survives the round trip.
  const strings = mergeAccreditedHaulerCopies([{ haulerName: "H", clients: ["Poblacion"] }]);
  assert.deepEqual(strings[0].clients, ["Poblacion"]);

  // The same client reached through two different arrays is still one client.
  const deduped = mergeAccreditedHaulerCopies([
    { haulerName: "H", clients: [{ clientName: "Kitang I" }, { clientName: "kitang i" }] },
  ]);
  assert.equal(deduped[0].clients.length, 1);
});

test("one roster read per facility, not one per entry", () => {
  // A bulk upload validates every entry against the SAME facility roster. Without
  // a shared cache that was N reads of the heaviest document set the facility has.
  const dataSlf = readSource("routes", "dataSLF.js");
  assert.match(dataSlf, /const haulerRosterCache = new Map\(\);/);
  assert.match(
    dataSlf,
    /validateUploadedClientRelationships\(\s*sanitizedItems\[idx\],\s*haulerRosterCache,\s*\)/,
  );
  assert.match(dataSlf, /if \(cache && cacheKey && cache\.has\(cacheKey\)\) return cache\.get\(cacheKey\);/);
});

test("every database stage of a submit is timed and named", () => {
  const dataSlf = readSource("routes", "dataSLF.js");
  for (const stage of [
    "account-check",
    "unresolved-revert",
    "organize-cells",
    "client-relationships",
    "declared-capacities",
  ]) {
    assert.ok(dataSlf.includes(`"${stage}"`), `stage ${stage} must be timed`);
  }
  assert.match(dataSlf, /"submission\.stage\.slow"/);
  // The stage rides on the error too, so a timeout answered as a 503 is still
  // attributable.
  assert.match(dataSlf, /error\.slowStage = name;/);
});

// ── 4. The drafts queue: what it reads, and how much of it ──────────────────

const queueRoute = require("../routes/portalQueue");

test("the queue list is bounded, projected and index-backed", () => {
  const queue = readSource("routes", "portalQueue.js");
  const list = queue.slice(queue.indexOf('router.get("/", async'), queue.indexOf('router.get("/:id"'));
  assert.ok(list.length > 0);
  assert.match(list, /\.limit\(limit\)/, "an unbounded find is what a big queue turns into a timeout");
  assert.match(list, /\.maxTimeMS\(QUEUE_MAX_TIME_MS\)/);
  assert.match(list, /\.lean\(\)/, "hydrating thousands of Mixed payloads is the expensive half");
  assert.match(list, /if \(summaryOnly\) query\.select\(SUMMARY_FIELDS\)/);
  // The badge asks for a NUMBER.
  assert.match(list, /countOnly/);
  assert.match(list, /countDocuments\(filter\)/);
  // And the sort has an index to stand on.
  assert.match(
    readSource("models", "PortalSubmissionQueue.js"),
    /index\(\{ portalUserEmail: 1, updatedAt: -1 \}\)/,
  );
});

test("the panel asks for summaries and loads one payload at a time", () => {
  const panel = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "DraftsScheduledPanel.jsx"),
    "utf8",
  );
  assert.match(panel, /params: \{ email, summary: 1 \}/);
  assert.match(panel, /api\.get\(`\/portal-queue\/\$\{record\._id\}`, \{ params: \{ email \} \}\)/);
  assert.doesNotMatch(
    panel,
    /\.get\("\/portal-queue", \{ params: \{ email \} \}\)/,
    "the unfiltered LIST fetch is the one that pulled every payload",
  );
});

// ── 5. Re-drafting the same transaction updates it ──────────────────────────

const { draftIdentity, summarizePayload, isTruthyFlag } = queueRoute;

const draft = (over = {}) => ({
  slfGenerator: "6512f0000000000000000001",
  slfName: "Prime Waste Solution SLF",
  payload: { dateOfDisposal: "2026-08-14", trucks: [] },
  ...over,
});

test("the same facility and disposal date is the SAME draft", () => {
  const a = draftIdentity(draft());
  const b = draftIdentity(draft({ payload: { dateOfDisposal: "2026-08-14", trucks: [{}, {}] } }));
  assert.equal(a, b);
  assert.ok(a);
});

test("a different disposal date is a different draft", () => {
  assert.notEqual(
    draftIdentity(draft()),
    draftIdentity(draft({ payload: { dateOfDisposal: "2026-08-15" } })),
  );
});

test("a different facility is a different draft", () => {
  assert.notEqual(
    draftIdentity(draft()),
    draftIdentity(draft({ slfGenerator: "6512f0000000000000000002" })),
  );
});

test("a timestamped date still matches the same day", () => {
  assert.equal(
    draftIdentity(draft({ payload: { dateOfDisposal: "2026-08-14T09:30:00.000Z" } })),
    draftIdentity(draft()),
  );
});

test("a facility named but not yet linked still identifies a draft", () => {
  // A draft saved before the facility id is resolved falls back to the name,
  // case-insensitively — otherwise the same day's work duplicates once the id
  // appears.
  const byName = draftIdentity(draft({ slfGenerator: null }));
  const byNameUpper = draftIdentity(draft({ slfGenerator: null, slfName: "PRIME WASTE SOLUTION SLF" }));
  assert.ok(byName);
  assert.equal(byName, byNameUpper);
});

test("a draft with no disposal date is never merged into another", () => {
  // Nothing identifies it yet, so merging would silently overwrite unrelated
  // work. It is saved as its own record, exactly as before.
  assert.equal(draftIdentity(draft({ payload: {} })), "");
  assert.equal(draftIdentity(draft({ payload: { dateOfDisposal: "  " } })), "");
});

test("re-saving a draft updates it in place and clears a stale failure", () => {
  const queue = readSource("routes", "portalQueue.js");
  const create = queue.slice(queue.indexOf('router.post("/", async'), queue.indexOf('router.put("/:id"'));
  // A correction of a reverted entry is matched by its own link instead (see
  // resubmitOf), never folded into an ordinary draft for the same date.
  assert.match(create, /if \(kind === "draft" && !resubmitTarget\) \{[\s\S]*?findEquivalentDraft\(email, identity\)/);
  assert.match(create, /updatedExisting: true/);
  assert.match(create, /existing\.failureReason = "";/);
  // Scheduling the same report twice is legitimate — each run has its own time.
  assert.match(
    queue,
    /type: "draft",\s*status: \{ \$in: \["draft", "failed"\] \},/,
    "only DRAFTS are merged; scheduled records are left alone",
  );
});

test("the portal says which of the two just happened", () => {
  const portal = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "index.jsx"),
    "utf8",
  );
  assert.match(portal, /updatedExisting \? "Draft Updated" : "Saved as Draft"/);
});

// ── 6. The payload digest the summary list ships instead of the payload ─────

test("the digest carries the four columns the export renders", () => {
  const summary = summarizePayload({
    dateOfDisposal: "2026-08-14",
    baselineUnit: "tons",
    lguCompanyName: "Prime Waste Solution",
    trucks: [
      { actualVolume: 10 },
      { actualVolume: 999, vehicles: [{ actualVolume: 4 }, { actualVolume: 6 }] },
    ],
  });
  assert.equal(summary.truckCount, 2);
  // A truck that reports through its vehicles is counted at the VEHICLE level —
  // adding its own field too would double the load.
  assert.equal(summary.totalVolume, 20);
  assert.equal(summary.dateOfDisposal, "2026-08-14");
  assert.equal(summary.baselineUnit, "tons");
});

test("the digest degrades to zeroes rather than throwing", () => {
  for (const value of [null, undefined, {}, { trucks: "not an array" }]) {
    const summary = summarizePayload(value);
    assert.equal(summary.truckCount, 0);
    assert.equal(summary.totalVolume, 0);
  }
});

test("the unit falls back to the entry's declared total-volume unit", () => {
  assert.equal(summarizePayload({ totalVolumeAcceptedUnit: "m³" }).baselineUnit, "m³");
});

test("an absent query flag reads false", () => {
  assert.equal(isTruthyFlag(undefined), false);
  assert.equal(isTruthyFlag("0"), false);
  assert.equal(isTruthyFlag("false"), false);
  assert.equal(isTruthyFlag("1"), true);
  assert.equal(isTruthyFlag("true"), true);
});

// ── 7. What the retry actually tells the operator ───────────────────────────

const readPortalFile = (name) =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", name),
    "utf8",
  );

test("a dropped connection is not presented as bad data", () => {
  const panel = readPortalFile("DraftsScheduledPanel.jsx");
  // Rows stamped before the server stopped recording timeouts as failures still
  // carry the driver's own words — an IP, a port and a connection number — which
  // names infrastructure and implies the operator's data is at fault.
  assert.match(panel, /const TRANSIENT_FAILURE_RE =/);
  assert.match(panel, /connection \\d\+ to \[\\d\.\]\+:\\d\+/);
  assert.match(panel, /const readableFailure = \(reason\) =>/);
  // Shown that way everywhere it is shown at all: the row, the detail alert and
  // the export.
  assert.match(panel, /readableFailure\(record\.failureReason\)/);
  assert.match(panel, /readableFailure\(r\.failureReason\) \|\| DASH/);
  // …and it must NOT be given the "fix what the message names" instruction.
  assert.match(panel, /const transient =[\s\S]{0,200}?isTransientFailure\(reason\)/);
  assert.match(panel, /Nothing was submitted and nothing was lost/);
});

test("the status column reports how many times a row has been retried", () => {
  const panel = readPortalFile("DraftsScheduledPanel.jsx");
  assert.match(panel, /const statusTag = \(status, retryCount = 0\) =>/);
  assert.match(panel, /\{attempts\} \{attempts === 1 \? "retry" : "retries"\}/);
  // Both tables, not just one.
  assert.equal(
    (panel.match(/render: \(_, r\) => statusTag\(r\.status, r\.retryCount\)/g) || []).length,
    2,
  );
  // Only once there IS a retry to report.
  assert.match(panel, /\{attempts > 0 && \(/);
});

test("the submit progress modal reports real bytes, not a timer", () => {
  const panel = readPortalFile("DraftsScheduledPanel.jsx");
  assert.match(panel, /onUploadProgress: \(event\) => \{/);
  assert.match(panel, /Math\.round\(\(event\.loaded \/ event\.total\) \* 100\)/);
  // A setInterval that walks a bar toward 100% is inventing a number the client
  // cannot know — the server phase is one opaque request.
  assert.doesNotMatch(panel, /setInterval\([\s\S]{0,120}setSubmitProgress/);
  // It says WHAT is being sent…
  assert.match(panel, /label="Transport entries"/);
  assert.match(panel, /label="Attempt"/);
  // …and cannot be dismissed into a state where the request is still running
  // with no indication of it.
  assert.match(panel, /closable=\{false\}/);
  assert.match(panel, /maskClosable=\{false\}/);
});

// ── 8. Charts that answer the question they are asked ───────────────────────

test("the hauler chart names every hauler instead of folding them away", () => {
  const overview = readPortalFile("OverviewPanel.jsx");
  // The card's badge says 142; the chart used to account for 7 of them.
  assert.doesNotMatch(
    overview,
    /Others \(\$\{rows\.length - 7\}\)/,
    "collapsing the tail is what hid 135 haulers behind one bar",
  );
  // Every bar gets a tick — Recharts silently drops labels that would collide.
  assert.match(overview, /interval=\{0\}\s*\n?\s*tickFormatter=\{truncateName\}/);
  // Height grows with the data and the card scrolls.
  assert.match(overview, /haulerChartData\.length \* HAULER_BAR_HEIGHT/);
  assert.match(overview, /className="slf-slim-scroll"/);
  assert.match(overview, /overflowY: "auto"/);
});

test("a truncated axis name is never a lost name", () => {
  const overview = readPortalFile("OverviewPanel.jsx");
  assert.match(overview, /const truncateName = \(value\) => \{/);
  // The full name is in the tooltip.
  assert.match(overview, /labelFormatter=\{\(label\) => label\}/);
});

test("Baseline Breakdown's values fit the space they are drawn in", () => {
  const overview = readPortalFile("OverviewPanel.jsx");
  const chart = overview.slice(
    overview.indexOf("Baseline Breakdown"),
    overview.indexOf("Submission Breakdown"),
  );
  assert.ok(chart.length > 0);
  // The axis ticks were clipped by a negative left margin…
  assert.doesNotMatch(chart, /left: -16/);
  assert.match(chart, /tickFormatter=\{compactNumber\}/);
  // …and the tallest bar's label was clipped by an 8px top margin.
  assert.match(chart, /top: 22/);
  // The on-bar label is abbreviated; the exact figure with its unit stays in the
  // tooltip.
  assert.match(chart, /formatter=\{compactMaskedValue\}/);
  assert.match(chart, /formatUnitValue\(value\)/);
  // A masked demo session must not leak the number through the new formatter.
  assert.match(overview, /masked \? MASK_PLACEHOLDER : Number\(value \|\| 0\) \? compactNumber\(value\) : ""/);
});

// ── 9. VERA ─────────────────────────────────────────────────────────────────

test("the VERA rule that had a switch but no enforcement now has both", () => {
  const vera = readSource("routes", "vera.js");
  assert.match(vera, /requirePortalRule\("can_view_vera_responses"\)/);
  // Both surfaces a portal user reaches, not just the chat.
  assert.equal(
    (vera.match(/requirePortalRule\("can_view_vera_responses"\)/g) || []).length >= 2,
    true,
  );
  // …and the launcher goes with it, rather than offering a button that can only
  // ever answer "not permitted".
  const portal = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "index.jsx"),
    "utf8",
  );
  assert.match(portal, /portalUser\?\.portalAccess\?\.canViewVera !== false && \(/);
});

test("a ticket is acknowledged before VERA investigates it", () => {
  // The investigation reads the account's 30-day log and recent submissions.
  // Running it first made the operator wait for all of it — and when those reads
  // were slow the request timed out on a ticket that HAD been filed, so they
  // filed it again.
  const tickets = readSource("routes", "supportTickets.js");
  const create = tickets.slice(
    tickets.indexOf('router.post("/", requirePortalRule'),
    tickets.indexOf('router.get("/my-tickets/:email"'),
  );
  assert.ok(create.length > 0);
  assert.ok(
    create.indexOf('res.status(201)') < create.indexOf("runVeraInvestigation"),
    "the response must be sent before the investigation starts",
  );
  assert.doesNotMatch(create, /await runVeraInvestigation/);
});

test("VERA's evidence reads are bounded", () => {
  // Both match the address case-insensitively and so cannot use an index. They
  // already degrade to "unavailable" — which the investigator answers with its
  // supportive Awaiting-User fallback — so a ceiling turns a slow read into that
  // instead of a held-open thread.
  const investigator = readSource("utils", "veraTicketInvestigator.js");
  assert.equal((investigator.match(/\.maxTimeMS\(EVIDENCE_MAX_TIME_MS\)/g) || []).length, 2);
});
