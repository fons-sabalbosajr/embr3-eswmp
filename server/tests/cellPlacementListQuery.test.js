/**
 * Admin → Cell Waste Placement: what the list page actually asks the database for.
 *
 * THE DEFECT THIS PINS. The submissions list for this tab is an aggregation that
 * splits records into "still needs a cell" and "fully placed". It used to run
 * `$sort` LAST — after two `$addFields` stages had attached computed fields to
 * documents that still carried everything they store, `accreditedHaulers` and its
 * nested vehicle/client lists above all. That forced a blocking sort of the whole
 * matched set with full payloads in memory (which is why it needed allowDiskUse),
 * to answer a question that only ever reads cell fields. The page's second read —
 * the one that actually returns the rows — then used no projection at all and
 * shipped those same arrays to the browser.
 *
 * Stage ORDER is the fix, so stage order is what these tests assert: the sort sits
 * where an index can serve it, and the documents are trimmed before they are
 * computed over. A regression that moves `$sort` back down, or drops either
 * projection, fails here rather than quietly costing seconds per page.
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
const AppSettings = require("../models/AppSettings");
const AppLog = require("../models/AppLog");

const ROW_ID = new mongoose.Types.ObjectId();

const chain = (value) => {
  const c = {
    select: (fields) => { c._select = fields; selectArgs.push(fields); return c; },
    sort: () => c, setOptions: () => c, populate: (p, f) => { populateArgs.push({ p, f }); return c; },
    lean: () => c,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (fn) => Promise.resolve(value).catch(fn),
  };
  return c;
};

let server; let baseUrl;
let pipelines; let selectArgs; let populateArgs;

test.before(async () => {
  AppLog.create = async () => ({});
  AppSettings.findOne = () => chain(null);

  DataSLF.aggregate = (pipeline) => {
    pipelines.push(pipeline);
    const result = [{ page: [{ _id: ROW_ID }], meta: [{ total: 1 }] }];
    return {
      allowDiskUse: () => Promise.resolve(result),
      then: (res, rej) => Promise.resolve(result).then(res, rej),
    };
  };
  DataSLF.find = () => chain([{ _id: ROW_ID, idNo: "SLF-PVT-PA-0001", trucks: [] }]);

  const app = express();
  app.use(express.json());
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { if (server) await new Promise((r) => server.close(r)); });
test.beforeEach(() => { pipelines = []; selectArgs = []; populateArgs = []; });

const token = jwt.sign(
  { id: String(new mongoose.Types.ObjectId()), role: "admin", email: "admin@emb.gov.ph" },
  process.env.JWT_SECRET,
);

/** Exactly what CellWastePlacement.jsx requests. */
async function listPage(assignment = "unassigned") {
  const qs = new URLSearchParams({
    mode: "list",
    includeTrucks: "true",
    withTruckVolume: "true",
    assignment,
    page: "1",
    limit: "12",
  });
  const res = await fetch(`${baseUrl}/api/data-slf?${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Index of the first stage carrying `key`, or -1. */
const stageIndex = (pipeline, key) => pipeline.findIndex((s) => Object.hasOwn(s, key));

// ── Stage order: the sort must be servable by an index ──────────────────────
test("the sort runs before the documents are expanded and computed over", async () => {
  const { status } = await listPage();
  assert.equal(status, 200);
  assert.equal(pipelines.length, 1, "one aggregation for the page");

  const pipeline = pipelines[0];
  const sortAt = stageIndex(pipeline, "$sort");
  const projectAt = stageIndex(pipeline, "$project");
  const addFieldsAt = stageIndex(pipeline, "$addFields");

  assert.ok(sortAt > -1, "the list is sorted");
  assert.ok(
    sortAt < projectAt && sortAt < addFieldsAt,
    `$sort must precede $project/$addFields so an index can serve it ` +
      `(sort@${sortAt}, project@${projectAt}, addFields@${addFieldsAt})`,
  );
  // Only $match may precede it — anything else means the sort is no longer the
  // first thing after the index-eligible filter.
  pipeline.slice(0, sortAt).forEach((stage) => {
    assert.deepEqual(Object.keys(stage), ["$match"], "only $match may precede the sort");
  });
});

test("the sort has an _id tiebreak so pages cannot repeat or skip a row", async () => {
  await listPage();
  const sort = pipelines[0][stageIndex(pipelines[0], "$sort")].$sort;
  assert.equal(sort.createdAt, -1, "newest first, unchanged");
  assert.ok(Object.hasOwn(sort, "_id"), "two records sharing a createdAt need a deterministic order");
});

// ── Payload: what flows through the pipeline, and what comes back ───────────
test("only cell fields flow through the pipeline, never whole submissions", async () => {
  await listPage();
  const pipeline = pipelines[0];
  const project = pipeline[stageIndex(pipeline, "$project")].$project;

  // The placement test reads each placement's cellIndex and volume (the portal's
  // rule: only waste that EXISTS needs a cell, and only a cell id places it), so
  // nothing else should survive into it.
  const serialized = JSON.stringify(project);
  ["accreditedHaulers", "activeCellEntries", "closedCellEntries", "selectedClients"].forEach((field) =>
    assert.ok(!serialized.includes(field), `${field} must not be carried through the sort/compute`),
  );
  assert.ok(serialized.includes("cellIndex"), "the cell identifier is kept");
  assert.ok(serialized.includes("actualVolume"), "volume decides whether a placement needs a cell at all");
  assert.ok(!/\$\$[tv]\.cellName/.test(serialized), "a cell NAME alone never places waste (same as the portal)");
});

test("the facet returns ids only — the rows are re-read projected", async () => {
  await listPage();
  const pipeline = pipelines[0];
  const facet = pipeline[stageIndex(pipeline, "$facet")].$facet;

  const last = facet.page[facet.page.length - 1];
  assert.deepEqual(last, { $project: { _id: 1 } }, "the page branch emits ids, not documents");
  assert.ok(facet.page.some((s) => s.$skip !== undefined), "server-side paging is intact");
  assert.ok(facet.page.some((s) => s.$limit !== undefined));
  assert.ok(facet.meta.some((s) => s.$count), "the total is still counted server-side");
});

test("the row re-read is projected and does not ship the baseline block", async () => {
  await listPage();
  const projection = selectArgs.find((s) => typeof s === "string" && s.includes("trucks"));
  assert.ok(projection, "the list re-read must use a projection — it previously used none");

  // What Cell Waste Placement actually renders.
  ["idNo", "submissionId", "lguCompanyName", "status", "trucks", "cellCorrections", "slfGenerator"].forEach(
    (field) => assert.ok(projection.includes(field), `the page renders ${field}`),
  );
  // The two biggest arrays on the document, neither of which it reads.
  ["accreditedHaulers", "activeCellEntries", "closedCellEntries"].forEach((field) =>
    assert.ok(!projection.includes(field), `${field} must not be sent to the browser`),
  );
  // The facility reference stays narrow too.
  assert.ok(
    populateArgs.some(({ p, f }) => p === "slfGenerator" && typeof f === "string" && f.includes("lgu")),
    "slfGenerator is populated with named fields, not the whole facility document",
  );
});

// ── Both tabs, same shape ───────────────────────────────────────────────────
test("the assigned tab is filtered the same way, with the same stage order", async () => {
  await listPage("assigned");
  const pipeline = pipelines[0];
  assert.ok(stageIndex(pipeline, "$sort") < stageIndex(pipeline, "$addFields"));
  // The business rule, aligned with the SLF Portal: assigned means no placement
  // of existing waste is still without a valid cell.
  const placementMatch = pipeline.filter((s) => s.$match && "_unplaced" in s.$match).pop();
  assert.ok(placementMatch, "the placement predicate is still applied");
  assert.deepEqual(placementMatch.$match, { _tcount: { $gt: 0 }, _unplaced: 0 });
});

// ── The browser half of the same fix ────────────────────────────────────────
test("the page's Refresh button no longer calls a function that does not exist", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "CellWastePlacement.jsx"),
    "utf8",
  );
  // `fetchReference()` was wired to Refresh but is defined nowhere in the file,
  // so clicking Refresh threw a ReferenceError before it reloaded anything.
  // Comments are stripped first — the fix is described in one, and a note about
  // the bug is not the bug.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/\bfetchReference\b/.test(code), "Refresh must not call an undefined function");
  assert.match(source, /onClick=\{\(\) => \{ fetchPage\(\); setFacilityRefresh/);
});

test("a burst of refresh events collapses into one refetch", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "CellWastePlacement.jsx"),
    "utf8",
  );
  const handler = source.slice(source.indexOf('socket.on("data-refresh"') - 900, source.indexOf('socket.on("data-refresh"'));
  // One save legitimately produces both a "submissions" and a "facility" event;
  // without coalescing that is two list pages and two facility rollups.
  assert.match(handler, /setTimeout/, "the socket handler must debounce");
  assert.match(handler, /clearTimeout/, "…and cancel the pending call on a new event");
  assert.match(source, /window\.clearTimeout\(timer\);\s*\n\s*socket\.off/, "and clean up on unmount");
});
