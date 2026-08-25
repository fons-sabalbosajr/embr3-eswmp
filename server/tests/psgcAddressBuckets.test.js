/**
 * PSGC address cascade — the LGUs that belong to no province.
 *
 * The fixtures are the real shapes returned by psgc.gitlab.io, verified against
 * the live API across all 17 regions. Two details matter and are easy to get
 * wrong from memory, so they are pinned here:
 *
 *   · a province-less LGU carries `provinceCode: false` — the boolean, not an
 *     empty string and not an absent key;
 *   · which of `name` / `regionName` is the descriptive one FLIPS between
 *     regions ("NCR" / "National Capital Region" vs "Zamboanga Peninsula" /
 *     "Region IX").
 *
 * Pure — no network. Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProvinceOptions,
  buildRegionBucketCode,
  isRegionBucketCode,
  provincelessLgus,
  regionCodeFromBucket,
  regionDisplayName,
} = require("../utils/psgcAddress");

const NCR = { code: "130000000", name: "NCR", regionName: "National Capital Region" };
const NCR_LGUS = [
  { code: "133900000", name: "City of Manila", provinceCode: false, districtCode: "133900000", regionCode: "130000000" },
  { code: "137401000", name: "City of Mandaluyong", provinceCode: false, districtCode: "137400000", regionCode: "130000000" },
  { code: "137404000", name: "Quezon City", provinceCode: false, districtCode: "137400000", regionCode: "130000000" },
];

const REGION_IX = { code: "090000000", name: "Zamboanga Peninsula", regionName: "Region IX" };
const REGION_IX_LGUS = [
  { code: "097201000", name: "City of Dapitan", provinceCode: "097200000", districtCode: false },
  { code: "099701000", name: "City of Isabela", provinceCode: false, districtCode: false },
];
const REGION_IX_PROVINCES = [
  { code: "097200000", name: "Zamboanga del Norte" },
  { code: "097300000", name: "Zamboanga del Sur" },
  { code: "098300000", name: "Zamboanga Sibugay" },
];

const REGION_III = { code: "030000000", name: "Central Luzon", regionName: "Region III" };
const REGION_III_PROVINCES = [
  { code: "030800000", name: "Bataan" },
  { code: "035400000", name: "Pampanga" },
];
const REGION_III_LGUS = [
  { code: "030801000", name: "Abucay", provinceCode: "030800000" },
  // A highly urbanized city — reachable through its province, so NOT an orphan.
  { code: "035401000", name: "City of Angeles", provinceCode: "035400000" },
];

// ── Detecting the strays ─────────────────────────────────────────────────────

test("provinceCode: false is what marks a province-less LGU", () => {
  assert.deepEqual(
    provincelessLgus(NCR_LGUS).map((l) => l.name),
    ["City of Manila", "City of Mandaluyong", "Quezon City"],
  );
  assert.deepEqual(provincelessLgus(REGION_IX_LGUS).map((l) => l.name), ["City of Isabela"]);
});

test("a highly urbanized city under its province is not a stray", () => {
  // Angeles City and Olongapo City are HUCs but PSGC still lists them under
  // Pampanga and Zambales, so the bucket must leave them alone — Region III
  // must never grow a spurious extra province option.
  assert.deepEqual(provincelessLgus(REGION_III_LGUS), []);
  assert.deepEqual(
    buildProvinceOptions(REGION_III_PROVINCES, REGION_III_LGUS, REGION_III),
    REGION_III_PROVINCES,
    "a region with no gap is returned exactly as PSGC gave it",
  );
});

test("junk input cannot invent a bucket", () => {
  assert.deepEqual(provincelessLgus(null), []);
  assert.deepEqual(provincelessLgus(undefined), []);
  assert.deepEqual(buildProvinceOptions(REGION_III_PROVINCES, null, REGION_III), REGION_III_PROVINCES);
});

// ── The bucket option ────────────────────────────────────────────────────────

test("NCR gains a single province option named after the region", () => {
  const options = buildProvinceOptions([], NCR_LGUS, NCR);
  assert.equal(options.length, 1);
  const [bucket] = options;
  assert.equal(bucket.name, "National Capital Region", "the descriptive name, not the acronym");
  assert.equal(bucket.hasNoProvinces, true);
  assert.equal(bucket.lguCount, 3);
  assert.ok(isRegionBucketCode(bucket.code));
  assert.equal(regionCodeFromBucket(bucket.code), "130000000");
});

test("a region WITH provinces gets the bucket appended and labelled as the exception", () => {
  const options = buildProvinceOptions(REGION_IX_PROVINCES, REGION_IX_LGUS, REGION_IX);
  assert.equal(options.length, 4);
  // The real provinces come first and are untouched.
  assert.deepEqual(options.slice(0, 3), REGION_IX_PROVINCES);
  const bucket = options[3];
  assert.equal(bucket.name, "Zamboanga Peninsula — independent cities");
  assert.equal(bucket.hasNoProvinces, false);
  assert.equal(bucket.lguCount, 1);
});

test("the region's descriptive name is picked whichever field it lands in", () => {
  // The two PSGC fields swap roles between regions — this is the whole reason
  // the helper exists rather than the route reading one field.
  assert.equal(regionDisplayName(NCR), "National Capital Region");
  assert.equal(regionDisplayName(REGION_IX), "Zamboanga Peninsula");
  assert.equal(regionDisplayName({ name: "SOCCSKSARGEN", regionName: "Region XII" }), "SOCCSKSARGEN");
  // Missing halves degrade rather than producing "undefined".
  assert.equal(regionDisplayName({ name: "NCR" }), "NCR");
  assert.equal(regionDisplayName({ regionName: "Region IX" }), "Region IX");
  assert.equal(regionDisplayName({}), "");
});

// ── The synthetic code ───────────────────────────────────────────────────────

test("the bucket code is never mistaken for a PSGC code, and round-trips", () => {
  const code = buildRegionBucketCode("130000000");
  assert.ok(isRegionBucketCode(code));
  assert.equal(regionCodeFromBucket(code), "130000000");
  // Real PSGC codes at every level must not match.
  ["130000000", "133900000", "030800000", "035401000"].forEach((psgc) => {
    assert.equal(isRegionBucketCode(psgc), false, `${psgc} must not read as a bucket`);
  });
  assert.equal(isRegionBucketCode(""), false);
  assert.equal(isRegionBucketCode(null), false);
});

test("a bucket code is distinguishable from a special-zone code", () => {
  // Both are synthetic and both can appear where a PSGC code is expected, so the
  // two prefixes must not collide — the municipalities route branches on them in
  // sequence.
  const { isSpecialZoneCode } = require("../utils/specialZones");
  const bucket = buildRegionBucketCode("130000000");
  assert.equal(isSpecialZoneCode(bucket), false);
  assert.equal(isRegionBucketCode("SZ-CLARK-FREEPORT-ZONE"), false);
});
