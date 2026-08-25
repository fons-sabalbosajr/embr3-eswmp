/**
 * Baseline Data — one facility, one row.
 *
 * `DataSLF.slfName` is a SNAPSHOT of the facility's display name at write time,
 * and the facility record is the source of truth. So a rename — or one record
 * typed with different wording — leaves the old spelling behind, and a list
 * grouped by name shows one site twice.
 *
 * Confirmed live on Floridablanca Enviro Park: 58 records under
 * "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4) (Private)" and
 * 1 under "Floridablanca Enviro Park - Category 4 Sanitary Landfill (Private)",
 * both carrying the SAME facility id.
 *
 * The merge groups on that id, which makes it exact rather than heuristic — the
 * property these tests exist to protect, since merging two genuinely different
 * facilities would silently fuse two facilities' baselines.
 *
 * Pure — no database. Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  baselineCompletenessScore,
  mergeBaselineRowsByFacility,
} = require("../utils/slfIdentity");

const FLORIDABLANCA_ID = "69d9221d97ad5bde74b93799";
const FACILITIES = [
  {
    _id: FLORIDABLANCA_ID,
    lgu: "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4)",
    ownership: "Private",
  },
  { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", lgu: "Bataan - Limay Sanitary Landfill", ownership: "Public" },
];

const CURRENT = {
  slfName: "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4) (Private)",
  slfGenerator: FLORIDABLANCA_ID,
  totalVolumeAccepted: 500000,
  activeCellEntries: [{}],
  closedCellEntries: [{}],
  accreditedHaulers: [{}, {}],
  lastUpdated: "2026-08-20T00:00:00.000Z",
  baselineUpdateRequested: false,
  baselineUpdateApproved: false,
};
const STRAY = {
  slfName: "Floridablanca Enviro Park - Category 4 Sanitary Landfill (Private)",
  slfGenerator: FLORIDABLANCA_ID,
  lastUpdated: "2026-01-02T00:00:00.000Z",
  baselineUpdateRequested: true,
  baselineUpdateApproved: false,
};

test("two name snapshots of one facility collapse into one row", () => {
  const out = mergeBaselineRowsByFacility([CURRENT, STRAY], FACILITIES);
  assert.equal(out.length, 1);
  assert.equal(out[0].totalVolumeAccepted, 500000, "the complete baseline survives");
});

test("the surviving row carries the facility's CURRENT name", () => {
  const out = mergeBaselineRowsByFacility([STRAY, CURRENT], FACILITIES);
  assert.equal(
    out[0].slfName,
    "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4) (Private)",
  );
  // The older spelling is surfaced, not silently dropped — an admin searching
  // for the name they remember has to be able to find it.
  assert.deepEqual(out[0].mergedFromNames, [
    "Floridablanca Enviro Park - Category 4 Sanitary Landfill (Private)",
  ]);
});

test("a pending update request on ANY merged record survives the merge", () => {
  // The request is on the STRAY record and the CURRENT one wins on completeness.
  // Taking the winner's flag would hide a request an admin has to act on.
  const out = mergeBaselineRowsByFacility([CURRENT, STRAY], FACILITIES);
  assert.equal(out[0].baselineUpdateRequested, true);
  assert.equal(out[0].baselineUpdateApproved, false);
});

test("the most COMPLETE baseline wins, not the most recent", () => {
  const newerButEmpty = { ...STRAY, lastUpdated: "2027-01-01T00:00:00.000Z" };
  const out = mergeBaselineRowsByFacility([CURRENT, newerButEmpty], FACILITIES);
  assert.equal(out[0].totalVolumeAccepted, 500000);
  // Completeness is what ranks them; recency only breaks a tie.
  assert.ok(baselineCompletenessScore(CURRENT) > baselineCompletenessScore(newerButEmpty));
  // Equally (in)complete → the most recently updated is the live one.
  const tieA = { ...STRAY, lastUpdated: "2026-01-01T00:00:00.000Z", slfName: "A (Private)" };
  const tieB = { ...STRAY, lastUpdated: "2026-06-01T00:00:00.000Z", slfName: "B (Private)" };
  const tie = mergeBaselineRowsByFacility([tieA, tieB], FACILITIES);
  assert.equal(tie.length, 1);
  // Both are older names here: the row is renamed to the FACILITY's current name,
  // which neither of them is.
  assert.equal(
    tie[0].slfName,
    "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4) (Private)",
  );
  assert.deepEqual(tie[0].mergedFromNames.sort(), ["A (Private)", "B (Private)"]);
});

test("DIFFERENT facilities are never merged, however alike their names", () => {
  const a = { slfName: "Pampanga - X Sanitary Landfill (Private)", slfGenerator: FLORIDABLANCA_ID };
  const b = {
    slfName: "Pampanga - X Sanitary Landfill (Private)",
    slfGenerator: "aaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const out = mergeBaselineRowsByFacility([a, b], FACILITIES);
  assert.equal(out.length, 2, "identical names under different facility ids stay separate");
});

test("rows with no facility id fall back to their name, and resolve to a facility when one matches", () => {
  // Legacy records predate the id. A name that matches a facility joins that
  // facility's group; one that matches nothing keeps its own row.
  const legacy = {
    slfName: "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4) (Private)",
    lastUpdated: "2025-01-01T00:00:00.000Z",
  };
  const orphan = { slfName: "Some Facility Nobody Registered (Private)", lastUpdated: "2025-01-01" };
  const out = mergeBaselineRowsByFacility([CURRENT, legacy, orphan], FACILITIES);
  assert.equal(out.length, 2);
  assert.ok(out.some((row) => row.slfName === "Some Facility Nobody Registered (Private)"));
});

test("a name shared by two facilities resolves to neither", () => {
  // An ambiguous name is exactly where an automatic merge would be wrong, so it
  // is not used for matching at all.
  const twins = [
    { _id: "1111", lgu: "Same Name SLF", ownership: "Private" },
    { _id: "2222", lgu: "Same Name SLF", ownership: "Private" },
  ];
  const rows = [
    { slfName: "Same Name SLF (Private)", lastUpdated: "2026-01-01" },
    { slfName: "Same Name SLF (Private)", lastUpdated: "2026-02-01" },
  ];
  const out = mergeBaselineRowsByFacility(rows, twins);
  // They still collapse — by NAME, which is the pre-existing behaviour — but no
  // facility id was invented for them.
  assert.equal(out.length, 1);
  assert.equal(out[0].slfName, "Same Name SLF (Private)");
});

test("an empty or single-row list is returned untouched", () => {
  assert.deepEqual(mergeBaselineRowsByFacility([], FACILITIES), []);
  const one = [CURRENT];
  const out = mergeBaselineRowsByFacility(one, FACILITIES);
  assert.equal(out.length, 1);
  assert.equal(out[0].mergedFromNames, undefined, "a row that absorbed nothing gains no marker");
});
