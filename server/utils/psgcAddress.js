// PSGC address cascade — the LGUs that belong to no province.
//
// WHY THIS EXISTS
// ---------------
// The address picker cascades Region → Province → City/Municipality straight off
// PSGC. That assumes every city or municipality sits under a province, and PSGC
// does not work that way:
//
//   · NCR has NO provinces at all. Its 17 cities are grouped into four
//     legislative DISTRICTS (First … Fourth), which are a different level of the
//     PSGC hierarchy — `/regions/130000000/provinces/` returns an empty array.
//     So the Province dropdown came up empty and the cascade dead-ended: no
//     province could be picked, and Province is a required field on a client.
//   · Two more regions have a single city attached to no province — City of
//     Isabela in Zamboanga Peninsula and City of Cotabato in SOCCSKSARGEN. Both
//     were simply unreachable: they exist in the region's own city list but in
//     none of its provinces'.
//
// Verified against the live API across all 17 regions: those three are the only
// gaps, and every other LGU — highly urbanized cities included (Angeles City
// under Pampanga, Olongapo City under Zambales) — is reachable through its
// province as expected.
//
// THE FIX
// -------
// A region whose city list contains province-less LGUs gains ONE synthetic
// province-level option covering exactly those LGUs. It is detected, never
// hardcoded: PSGC reassigns LGUs (Negros Island Region was carved out in 2024),
// so a hardcoded list of exceptions would quietly go stale, whereas "which LGUs
// in this region have no provinceCode" re-derives itself from the source.
//
// The synthetic code is deliberately NOT a PSGC value — see isRegionBucketCode —
// so a consumer that needs a real one can tell the difference. The LGUs it
// contains keep their own real PSGC codes, so the level below it (barangays)
// needs no special handling at all.
//
// Pure: no fetching. The caller supplies what it fetched.

// Marks the synthetic province-level option for a region's province-less LGUs.
const REGION_BUCKET_PREFIX = "RG-";

/** True for the synthetic province-level codes this module mints. */
function isRegionBucketCode(code) {
  return String(code || "").toUpperCase().startsWith(REGION_BUCKET_PREFIX);
}

/** The region code inside a synthetic province-level code. */
function regionCodeFromBucket(code) {
  return String(code || "").slice(REGION_BUCKET_PREFIX.length);
}

function buildRegionBucketCode(regionCode) {
  return `${REGION_BUCKET_PREFIX}${regionCode}`;
}

/**
 * The LGUs of a region that belong to no province.
 *
 * PSGC returns `provinceCode: false` (not an empty string, and not absent) for
 * these, so the check is on the coerced value rather than on presence.
 */
function provincelessLgus(regionCitiesMunicipalities = []) {
  return (Array.isArray(regionCitiesMunicipalities) ? regionCitiesMunicipalities : []).filter(
    (lgu) => !String(lgu?.provinceCode || "").trim(),
  );
}

/**
 * A region's readable name.
 *
 * PSGC carries two, and which one is descriptive flips between regions:
 * NCR is `{ name: "NCR", regionName: "National Capital Region" }` while Region IX
 * is `{ name: "Zamboanga Peninsula", regionName: "Region IX" }`. The longer of
 * the two is the descriptive one in every case — "National Capital Region" over
 * "NCR", "Zamboanga Peninsula" over "Region IX", "SOCCSKSARGEN" over "Region XII"
 * — which is what belongs in a dropdown an operator reads.
 */
function regionDisplayName(region = {}) {
  const name = String(region.name || "").trim();
  const regionName = String(region.regionName || "").trim();
  if (!name) return regionName;
  if (!regionName) return name;
  return regionName.length > name.length ? regionName : name;
}

/**
 * Province options for a region: the real ones, plus a bucket for the LGUs that
 * belong to none of them.
 *
 * The bucket is appended only when there is something in it, so the 14 regions
 * with no gap are returned exactly as PSGC gave them.
 *
 * Its LABEL depends on what it represents, because those are two different
 * things to an operator:
 *   · the region has NO provinces (NCR) → the bucket IS the province level, so it
 *     is named after the region: picking "National Capital Region" then lists all
 *     17 cities.
 *   · the region has provinces AND strays (Zamboanga Peninsula, SOCCSKSARGEN) →
 *     the bucket is the exception, and is labelled as such so it is not mistaken
 *     for a province that was somehow missed.
 */
function buildProvinceOptions(provinces = [], regionCitiesMunicipalities = [], region = {}) {
  const list = Array.isArray(provinces) ? provinces : [];
  const orphans = provincelessLgus(regionCitiesMunicipalities);
  if (orphans.length === 0) return list;

  const regionCode = String(region.code || "").trim();
  const label = regionDisplayName(region);
  return [
    ...list,
    {
      code: buildRegionBucketCode(regionCode),
      name: list.length === 0 ? label : `${label} — independent cities`,
      // Flags for the UI; harmless to any consumer that ignores them.
      isRegionBucket: true,
      hasNoProvinces: list.length === 0,
      regionCode,
      lguCount: orphans.length,
    },
  ];
}

module.exports = {
  REGION_BUCKET_PREFIX,
  isRegionBucketCode,
  regionCodeFromBucket,
  buildRegionBucketCode,
  provincelessLgus,
  regionDisplayName,
  buildProvinceOptions,
};
