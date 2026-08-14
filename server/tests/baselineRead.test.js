/**
 * Portal baseline READ — GET /data-slf/baseline/:slfName.
 *
 * The bug this pins: Data Entry loaded with every field empty even though the
 * baseline was stored and intact.
 *
 * An SLF's baseline values live in a BASELINE-ONLY container — a DataSLF document
 * with no transport entries, which PATCH /portal-save-baseline writes through
 * `findMatchingBaselineOnlyIds`. The container is created on the FIRST baseline
 * save, so it is the OLDEST document the facility owns. The read fetched
 * candidates with `.sort({ createdAt: -1 }).limit(50)`, so on a busy SLF the
 * container fell outside the window entirely (Zambales - Iba ranked 79th of 80;
 * Nueva Ecija - Santa Rosa 68th of 69). The portal then hydrated Data Entry from
 * whatever submission happened to sort first — one carrying none of the baseline
 * columns — and every field came up blank.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  orderBaselineCandidates,
  makeBaselineFieldReader,
  chooseBaselineRecord,
  isBaselineOnlyRecord,
  BASELINE_ONLY_FILTER,
} = require("../routes/dataSLF");

const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const baselineRead = (() => {
  const from = source.indexOf('router.get("/baseline/:slfName"');
  assert.ok(from > -1, "GET /baseline/:slfName not found");
  const to = source.indexOf('router.get("/baselines"', from);
  assert.ok(to > from, "end of the baseline read not found");
  return source.slice(from, to);
})();

// A container: baseline values, no transport entries. Deliberately the OLDEST.
const container = {
  _id: "container",
  trucks: [],
  totalVolumeAccepted: 19000,
  totalVolumeAcceptedUnit: "m³",
  baselineUnit: "m³",
  lguCompanyName: "Iba LGU",
  companyRegion: "030000000",
  activeCellEntries: [{ cellName: "Cell 1", volume: 500 }],
  closedCellEntries: [],
  accreditedHaulers: [{ haulerName: "Hauler A" }],
  createdAt: new Date("2024-01-01"),
};

// Submissions made afterwards. They carry transport entries and none of the
// baseline columns — which is the whole point.
const submissions = Array.from({ length: 50 }, (_, i) => ({
  _id: `submission-${i}`,
  trucks: [{ actualVolume: 12 }],
  lguCompanyName: "Iba LGU",
  createdAt: new Date(2025, 0, i + 1),
})).reverse(); // createdAt DESC, as the query returns them

test("the container is fetched by its own query, not hoped for in a recency window", () => {
  assert.deepEqual(
    BASELINE_ONLY_FILTER,
    { $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }] },
    "the Mongo filter must be the twin of isBaselineOnlyRecord()",
  );
  assert.match(
    baselineRead,
    /BASELINE_ONLY_FILTER/,
    "the read must query the containers directly",
  );
  assert.match(
    baselineRead,
    /Promise\.all\(\[/,
    "…alongside the recency window, in one round trip",
  );
});

test("a container outside the recency window is still chosen", () => {
  // The regression: the container never appears in `recent`.
  const candidates = orderBaselineCandidates([container], submissions);
  const latest = chooseBaselineRecord(candidates);
  assert.equal(latest._id, "container");
  assert.ok(isBaselineOnlyRecord(latest));

  // What the read did before: window only.
  const oldCandidates = submissions;
  assert.notEqual(
    chooseBaselineRecord(oldCandidates)._id,
    "container",
    "sanity: the old candidate set could not reach the container",
  );
});

test("the container's values are what Data Entry hydrates from", () => {
  const candidates = orderBaselineCandidates([container], submissions);
  const { hasContainer, valueOf, unitFor } = makeBaselineFieldReader(
    candidates,
    chooseBaselineRecord(candidates),
  );
  assert.equal(hasContainer, true);
  assert.equal(valueOf("totalVolumeAccepted"), 19000);
  assert.equal(unitFor("totalVolumeAccepted", "totalVolumeAcceptedUnit", "m³"), "m³");
  assert.equal(valueOf("activeCellEntries").length, 1);
  assert.equal(valueOf("companyRegion"), "030000000");
});

test("a container never falls through to a submission's stale copy", () => {
  // The operator removed every cell entry and every hauler, and cleared the
  // address. An older submission still holds the pre-deletion copies.
  const emptied = {
    ...container,
    activeCellEntries: [],
    accreditedHaulers: [],
    address: "",
  };
  const stale = {
    _id: "stale",
    trucks: [{ actualVolume: 5 }],
    activeCellEntries: [{ cellName: "deleted", volume: 900 }],
    accreditedHaulers: [{ haulerName: "deleted hauler" }],
    address: "Old address that was cleared",
  };
  const candidates = orderBaselineCandidates([emptied], [stale]);
  const { valueOf } = makeBaselineFieldReader(candidates, chooseBaselineRecord(candidates));

  assert.deepEqual(valueOf("activeCellEntries"), [], "a deleted cell entry stays deleted");
  assert.deepEqual(valueOf("accreditedHaulers"), [], "a deleted hauler stays deleted");
  assert.equal(valueOf("address"), "", "a cleared address stays cleared");
});

test("a legacy SLF with NO container reads each field from the newest record that has it", () => {
  // Limay / Porac / Floridablanca / Prime Waste Solution: the baseline was only
  // ever duplicated onto submissions, and the newest one carries nothing.
  const newest = {
    _id: "newest",
    trucks: [{ actualVolume: 9 }],
    lguCompanyName: "Limay LGU",
    createdAt: new Date("2026-08-01"),
  };
  const older = {
    _id: "older",
    trucks: [{ actualVolume: 4 }],
    totalVolumeAccepted: 72754.72,
    totalVolumeAcceptedUnit: "tons",
    activeCellEntries: [{ cellName: "Cell 1" }],
    createdAt: new Date("2025-05-01"),
  };
  const candidates = orderBaselineCandidates([], [newest, older]);
  const latest = chooseBaselineRecord(candidates);
  const { hasContainer, valueOf, unitFor } = makeBaselineFieldReader(candidates, latest);

  assert.equal(hasContainer, false);
  assert.equal(valueOf("totalVolumeAccepted"), 72754.72, "recovered from the sibling record");
  assert.equal(
    unitFor("totalVolumeAccepted", "totalVolumeAcceptedUnit", "m³"),
    "tons",
    "the unit comes from the SAME record as the value it describes",
  );
  assert.equal(valueOf("activeCellEntries").length, 1);
  assert.equal(valueOf("lguCompanyName"), "Limay LGU", "the newest record still wins where it has the field");
});

test("null and undefined fall through; an explicit empty string does not", () => {
  const first = { _id: "a", trucks: [{ actualVolume: 1 }], address: "", companyBarangay: null };
  const second = { _id: "b", trucks: [{ actualVolume: 1 }], address: "Somewhere", companyBarangay: "037701001" };
  const candidates = orderBaselineCandidates([], [first, second]);
  const { valueOf } = makeBaselineFieldReader(candidates, chooseBaselineRecord(candidates));

  assert.equal(valueOf("address"), "", "a cleared value is a real value — it must not fall through");
  assert.equal(valueOf("companyBarangay"), "037701001", "null means 'not recorded here' and falls through");
});

test("ordering puts containers first and never duplicates one", () => {
  const both = orderBaselineCandidates([container], [container, ...submissions]);
  assert.equal(both[0]._id, "container");
  assert.equal(both.filter((item) => item._id === "container").length, 1);
  assert.equal(both.length, submissions.length + 1);
});

// ── Portal dashboard: GET /waste-received-summary/:slfName ──────────────────
//
// Every card below the dashboard's KPI row waits on this one request. It used to
// select `accreditedHaulers` on EVERY submission even though the summary reads a
// single copy — and that array is deliberately duplicated across all of an SLF's
// baseline documents. Measured on live data: 4.7 MB of a 5.3 MB response for
// Floridablanca (59 records) and 4.7 MB of 4.9 MB for Prime Waste Solution.
const wasteSummary = (() => {
  const from = source.indexOf('router.get("/waste-received-summary/:slfName"');
  assert.ok(from > -1, "GET /waste-received-summary/:slfName not found");
  const to = source.indexOf('router.get("/slf-names"', from);
  assert.ok(to > from, "end of the waste summary route not found");
  return source.slice(from, to);
})();

const haulerResolver = (() => {
  const from = source.indexOf("async function resolveWasteSummaryHaulers");
  assert.ok(from > -1, "resolveWasteSummaryHaulers not found");
  return source.slice(from, source.indexOf("\n}", from));
})();

// These assertions are about CODE, not the prose around it — every slice below
// is stripped of comments first, or a comment that merely names the field would
// fail the test.
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// The projection strings themselves, isolated from their surrounding commentary.
const selectLiteral = (name) => {
  const from = source.indexOf(`const ${name} =`);
  assert.ok(from > -1, `${name} not found`);
  const to = source.indexOf(";", from);
  return stripComments(source.slice(from, to));
};

test("the waste summary never bulk-selects the hauler graph", () => {
  assert.doesNotMatch(
    selectLiteral("WASTE_SUMMARY_BASELINE_SELECT"),
    /accreditedHaulers/,
    "the baseline projection may not carry accreditedHaulers",
  );
  assert.doesNotMatch(
    selectLiteral("WASTE_SUMMARY_SUBMISSION_SELECT"),
    /accreditedHaulers/,
    "the per-submission projection may not carry accreditedHaulers",
  );
  // Both are still projections, not accidental full-document reads.
  assert.match(selectLiteral("WASTE_SUMMARY_BASELINE_SELECT"), /trucks\.actualVolume/);
  assert.match(selectLiteral("WASTE_SUMMARY_SUBMISSION_SELECT"), /trucks\.selectedClients/);
});

test("the hauler list is resolved in two passes — pick an id, then read one record", () => {
  // Pass 1 must stay cheap: id + the truck flag the tier order needs, nothing else.
  assert.match(haulerResolver, /\.select\("_id trucks\.actualVolume"\)/);
  // Pass 2 reads the winner alone.
  assert.match(haulerResolver, /findById\(winner\._id\)[\s\S]*\.select\("accreditedHaulers"\)/);
  // And the tier order is the same one the portal baseline read uses.
  assert.match(haulerResolver, /candidates\.find\(isBaselineOnlyRecord\)/);
  assert.match(haulerResolver, /candidates\.find\(\(item\) => !hasTruckVolume\(item\)\)/);
});

test("the summary picks its baseline record by the same container-first rule", () => {
  const code = stripComments(wasteSummary);
  assert.match(code, /orderBaselineCandidates\(baselineContainers, baselineRecent\)/);
  assert.match(code, /BASELINE_ONLY_FILTER/);
  // Re-filtering with hasBaselineData would now discard a hauler-only record,
  // because accreditedHaulers is no longer projected.
  assert.doesNotMatch(code, /\.filter\(hasBaselineData\)/);
});

test("the missing-Total-Volume warning tests the RESOLVED value", () => {
  // Otherwise it fires for every legacy SLF whose figure simply lives on a
  // sibling record, and stops being a data-loss signal.
  assert.match(
    baselineRead,
    /valueOf\("totalVolumeAccepted"\) == null && hasBaselineData\(latest\)/,
  );
});
