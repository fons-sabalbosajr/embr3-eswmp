/**
 * Special economic zones as a client's City/Municipality.
 *
 * A freeport is a real address that PSGC does not list as a political
 * subdivision, so before this the municipality matcher could only ever answer
 * "none" for a client inside Clark Freeport Zone or the Freeport Area of Bataan —
 * and the address picker could not offer one to be selected in the first place.
 *
 * What matters most here is what must NOT change: zones are merged into the
 * province's candidate pool and then held to exactly the same exact → alias →
 * fuzzy rules as a municipality. In particular the never-across-provinces rule
 * still applies, and an admin who encodes a zone by hand in Region 3 LGU Data
 * overrides the built-in rather than competing with it.
 *
 * Pure — no database. Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { matchClient } = require("../utils/lguMatch");
const {
  isSpecialZoneCode,
  specialZoneOptions,
  specialZoneMasters,
  zonesForProvince,
  findSpecialZone,
} = require("../utils/specialZones");

test("a zone resolves exactly against its host province with no masterlist encoded", () => {
  const result = matchClient(
    { municipality: "Clark Freeport Zone", province: "Pampanga" },
    [],
  );
  assert.equal(result.classification, "exact");
  assert.equal(result.suggestions[0].name, "Clark Freeport Zone");
  assert.equal(result.suggestions[0].isSpecialZone, true);
});

test("the abbreviations operators actually type are accepted as aliases", () => {
  for (const [value, province, expected] of [
    ["CFZ", "Pampanga", "Clark Freeport Zone"],
    ["SBFZ", "Zambales", "Subic Bay Freeport Zone"],
    ["AFAB", "Bataan", "Freeport Area of Bataan"],
    ["APECO", "Aurora", "Aurora Pacific Economic Zone and Freeport"],
  ]) {
    const result = matchClient({ municipality: value, province }, []);
    assert.equal(result.suggestions[0]?.name, expected, `${value} → ${expected}`);
    assert.equal(result.suggestions[0]?.confidence, "high");
  }
});

test("a zone spanning two provinces is offered under BOTH, and only those", () => {
  assert.deepEqual(
    zonesForProvince("Pampanga").map((z) => z.name),
    ["Clark Freeport Zone", "Clark Special Economic Zone"],
  );
  assert.ok(zonesForProvince("Tarlac").some((z) => z.name === "Clark Freeport Zone"));
  // The never-across-provinces rule is not relaxed for zones.
  const wrongProvince = matchClient(
    { municipality: "Clark Freeport Zone", province: "Bulacan" },
    [],
  );
  assert.equal(wrongProvince.classification, "none");
});

test("an admin-encoded masterlist entry overrides the built-in of the same name", () => {
  const encoded = [
    {
      _id: "abc123",
      name: "Clark Freeport Zone",
      normalizedName: "clark freeport zone",
      province: "Pampanga",
      normalizedProvince: "pampanga",
      psgcCode: "PSGC-CUSTOM",
      lguType: "Special Zone",
      aliases: [],
    },
  ];
  const result = matchClient(
    { municipality: "Clark Freeport Zone", province: "Pampanga" },
    encoded,
  );
  assert.equal(result.classification, "exact");
  assert.equal(result.suggestions.length, 1, "the built-in must not appear alongside it");
  assert.equal(result.suggestions[0].masterId, "abc123");
  assert.equal(result.suggestions[0].psgc, "PSGC-CUSTOM");
});

test("real municipalities are unaffected by the merge", () => {
  const masters = [
    {
      _id: "m1",
      name: "Mabalacat City",
      normalizedName: "mabalacat city",
      province: "Pampanga",
      normalizedProvince: "pampanga",
      psgcCode: "0354011000",
      lguType: "City",
      aliases: [],
    },
  ];
  const result = matchClient({ municipality: "Mabalacat", province: "Pampanga" }, masters);
  assert.equal(result.classification, "exact");
  assert.equal(result.suggestions[0].masterId, "m1");
});

test("zone options carry the host LGUs so a picker can tell one side of a zone from the other", () => {
  const options = specialZoneOptions("Tarlac");
  const clark = options.find((o) => o.name === "Clark Freeport Zone");
  assert.ok(clark, "Clark is hosted by Tarlac too");
  assert.equal(clark.isSpecialZone, true);
  assert.equal(clark.provinceName, "Tarlac");
  assert.ok(clark.hostLgus.includes("Capas"));
});

test("a zone code is recognisable as synthetic so PSGC lookups can decline it", () => {
  const [zone] = specialZoneMasters("Bataan");
  assert.ok(isSpecialZoneCode(zone._id));
  // A real PSGC code must never be mistaken for one — the barangay proxy uses
  // this to decide whether to call upstream at all.
  assert.equal(isSpecialZoneCode("0308000000"), false);
});

test("findSpecialZone matches whole values only, never substrings", () => {
  assert.equal(findSpecialZone("Clark Freeport Zone")?.name, "Clark Freeport Zone");
  assert.equal(findSpecialZone("clark")?.name, "Clark Freeport Zone");
  // "Clark Street Trading" contains "clark" but is not the zone.
  assert.equal(findSpecialZone("Clark Street Trading"), null);
});
