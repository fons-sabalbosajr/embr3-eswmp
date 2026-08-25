// Philippine special economic zones / freeports — the addresses PSGC does not have.
//
// WHY THIS EXISTS
// ---------------
// Every address picker in the app cascades Region → Province → City/Municipality
// straight off the PSGC masterlist (psgc.gitlab.io). PSGC is a list of political
// subdivisions, and a freeport is not one: Clark Freeport Zone straddles Angeles
// City, Mabalacat and Porac in Pampanga plus Bamban and Capas in Tarlac, and is
// administered by a zone authority rather than by any of them. It therefore
// appears nowhere in `/provinces/{code}/cities-municipalities/`.
//
// The practical consequence was a portal user who could not encode a real client:
// Prime Waste Solution's clients inside Clark Freeport Zone had no selectable
// municipality, so the Add Client form was completed with a neighbouring
// municipality or left blank — which then reported the client as INCOMPLETE and
// mis-stated the served-LGU counts.
//
// WHAT A ZONE IS HERE
// -------------------
// A selectable municipality-level value that carries its own synthetic code, its
// host province(s) and the PSGC LGUs it physically sits in. It is deliberately
// NOT a PSGC code: `SZ-…` is unmistakable downstream, and `isSpecialZoneCode`
// lets any consumer that needs a real PSGC code (barangay lookups, for one)
// recognise it and decline rather than issue a request that would 404.
//
// The province is what classifies a record within / outside Region 3
// (utils/region3), so every zone MUST name its host province(s) — that is what
// keeps a Clark client counted under Pampanga.
//
// EXTENDING THE LIST
// ------------------
// These are the built-ins: nationally chartered zone authorities, always
// available with no configuration. Anything else is encoded by an admin in
// Developer → App Settings → Region 3 LGU Data with lguType "Special Zone", and
// is picked up by utils/lguMatch alongside these.

const { normalizeName } = require("./region3");

// Synthetic code prefix. Never a PSGC value — see isSpecialZoneCode.
const SPECIAL_ZONE_CODE_PREFIX = "SZ-";

/**
 * Built-in zones.
 *
 * `provinces` — host province NAMES, matched normalized against the province the
 *   user has already picked. A zone that straddles two provinces is offered under
 *   both, which is correct: the client really is in that province.
 * `hostLgus` — the PSGC LGUs the zone physically occupies. Shown as the option's
 *   subtitle so an operator can tell Clark-in-Pampanga from Clark-in-Tarlac, and
 *   used by the matcher as additional accepted spellings.
 * `aliases` — the abbreviations these actually get typed as. Compared as WHOLE
 *   normalized values, never as substrings, so a short alias cannot over-match.
 */
const SPECIAL_ZONES = [
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}CLARK-FREEPORT-ZONE`,
    name: "Clark Freeport Zone",
    authority: "Clark Development Corporation (CDC) / BCDA",
    regionName: "Region III (Central Luzon)",
    provinces: ["Pampanga", "Tarlac"],
    hostLgus: ["Angeles City", "Mabalacat City", "Porac", "Bamban", "Capas"],
    aliases: ["clark freeport", "cfz", "clark", "clarkfield", "clark field", "clark freeport zone pampanga"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}CLARK-SPECIAL-ECONOMIC-ZONE`,
    name: "Clark Special Economic Zone",
    authority: "Clark Development Corporation (CDC)",
    regionName: "Region III (Central Luzon)",
    provinces: ["Pampanga", "Tarlac"],
    hostLgus: ["Angeles City", "Mabalacat City", "Porac", "Bamban", "Capas"],
    aliases: ["csez", "clark ecozone", "clark economic zone", "clark sez"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}NEW-CLARK-CITY`,
    name: "New Clark City",
    authority: "Bases Conversion and Development Authority (BCDA)",
    regionName: "Region III (Central Luzon)",
    provinces: ["Tarlac"],
    hostLgus: ["Capas", "Bamban"],
    aliases: ["ncc", "clark green city", "new clark"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}SUBIC-BAY-FREEPORT-ZONE`,
    name: "Subic Bay Freeport Zone",
    authority: "Subic Bay Metropolitan Authority (SBMA)",
    regionName: "Region III (Central Luzon)",
    provinces: ["Zambales", "Bataan"],
    hostLgus: ["Olongapo City", "Subic", "Hermosa", "Morong"],
    aliases: ["sbfz", "subic freeport", "subic bay freeport", "subic bay metropolitan authority", "sbma", "subic special economic zone", "sbsez"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}FREEPORT-AREA-OF-BATAAN`,
    name: "Freeport Area of Bataan",
    authority: "Authority of the Freeport Area of Bataan (AFAB)",
    regionName: "Region III (Central Luzon)",
    provinces: ["Bataan"],
    hostLgus: ["Mariveles"],
    aliases: ["fab", "afab", "freeport area bataan", "bataan freeport", "authority of the freeport area of bataan"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}BATAAN-ECONOMIC-ZONE`,
    name: "Bataan Economic Zone",
    authority: "PEZA",
    regionName: "Region III (Central Luzon)",
    provinces: ["Bataan"],
    hostLgus: ["Mariveles"],
    aliases: ["bez", "bataan export processing zone", "bepz", "bataan ecozone"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}AURORA-PACIFIC-ECOZONE`,
    name: "Aurora Pacific Economic Zone and Freeport",
    authority: "Aurora Pacific Economic Zone and Freeport Authority (APECO)",
    regionName: "Region III (Central Luzon)",
    provinces: ["Aurora"],
    hostLgus: ["Casiguran"],
    aliases: ["apeco", "aurora pacific ecozone", "aurora special economic zone", "aurora freeport"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}PORO-POINT-FREEPORT-ZONE`,
    name: "Poro Point Freeport Zone",
    authority: "Poro Point Management Corporation (BCDA)",
    regionName: "Region I (Ilocos Region)",
    provinces: ["La Union"],
    hostLgus: ["City of San Fernando"],
    aliases: ["ppfz", "poro point", "poro point special economic zone", "ppsez"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}CAGAYAN-SPECIAL-ECONOMIC-ZONE`,
    name: "Cagayan Special Economic Zone and Freeport",
    authority: "Cagayan Economic Zone Authority (CEZA)",
    regionName: "Region II (Cagayan Valley)",
    provinces: ["Cagayan"],
    hostLgus: ["Santa Ana", "Aparri"],
    aliases: ["ceza", "cagayan freeport", "cagayan ecozone", "cagayan special economic zone"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}JOHN-HAY-SPECIAL-ECONOMIC-ZONE`,
    name: "John Hay Special Economic Zone",
    authority: "John Hay Management Corporation (BCDA)",
    regionName: "Cordillera Administrative Region (CAR)",
    provinces: ["Benguet"],
    hostLgus: ["Baguio City"],
    aliases: ["jhsez", "camp john hay", "john hay", "john hay economic zone"],
  },
  {
    code: `${SPECIAL_ZONE_CODE_PREFIX}ZAMBOANGA-CITY-SPECIAL-ECONOMIC-ZONE`,
    name: "Zamboanga City Special Economic Zone and Freeport",
    authority: "Zamboanga City Special Economic Zone Authority (ZAMBOECOZONE)",
    regionName: "Region IX (Zamboanga Peninsula)",
    provinces: ["Zamboanga del Sur"],
    hostLgus: ["Zamboanga City"],
    aliases: ["zamboecozone", "zamboanga freeport", "zamboanga ecozone"],
  },
];

/** True for the synthetic codes this module mints — never a PSGC code. */
function isSpecialZoneCode(code) {
  return String(code || "").toUpperCase().startsWith(SPECIAL_ZONE_CODE_PREFIX);
}

/**
 * Every accepted spelling of one zone, normalized. Name, aliases and the zone's
 * own code, plus "<name>, <host lgu>" forms operators actually type
 * ("Clark Freeport Zone, Mabalacat").
 */
function zoneLookupKeys(zone) {
  const keys = new Set();
  const add = (value) => {
    const n = normalizeName(value);
    if (n) keys.add(n);
  };
  add(zone.name);
  add(zone.code);
  (zone.aliases || []).forEach(add);
  (zone.hostLgus || []).forEach((lgu) => {
    add(`${zone.name} ${lgu}`);
    add(`${lgu} ${zone.name}`);
  });
  return keys;
}

/** Zones hosted by a province, by NAME (case/punctuation-insensitive). */
function zonesForProvince(provinceName) {
  const target = normalizeName(provinceName);
  if (!target) return [];
  return SPECIAL_ZONES.filter((zone) =>
    (zone.provinces || []).some((p) => normalizeName(p) === target),
  );
}

/**
 * Resolve a free-text value (or a stored `SZ-…` code) to a zone.
 * Whole-value comparison only — a zone is never inferred from a substring.
 */
function findSpecialZone(value, { province } = {}) {
  const target = normalizeName(value);
  if (!target) return null;
  const pool = province ? zonesForProvince(province) : SPECIAL_ZONES;
  const searched = pool.length ? pool : SPECIAL_ZONES;
  return searched.find((zone) => zoneLookupKeys(zone).has(target)) || null;
}

/**
 * Zones for a province in the shape the PSGC cities-municipalities payload uses,
 * so the address cascade can concatenate the two lists and render them with one
 * mapper. `isSpecialZone` is what the UI groups and labels on.
 */
function specialZoneOptions(provinceName) {
  return zonesForProvince(provinceName).map((zone) => ({
    code: zone.code,
    name: zone.name,
    isSpecialZone: true,
    authority: zone.authority,
    hostLgus: zone.hostLgus,
    provinceName,
    regionName: zone.regionName,
  }));
}

/**
 * Zones for a province shaped as Region3Lgu masterlist records, so
 * utils/lguMatch can resolve a client whose municipality is a zone using exactly
 * the same matching rules it applies to a real municipality — no separate code
 * path, no separate confidence scale.
 */
function specialZoneMasters(provinceName) {
  return zonesForProvince(provinceName).map((zone) => ({
    _id: zone.code,
    name: zone.name,
    normalizedName: normalizeName(zone.name),
    province: provinceName,
    normalizedProvince: normalizeName(provinceName),
    psgcCode: "",
    lguType: "Special Zone",
    aliases: [...(zone.aliases || []), ...(zone.hostLgus || []).map((lgu) => `${zone.name} ${lgu}`)],
    isSpecialZone: true,
  }));
}

module.exports = {
  SPECIAL_ZONES,
  SPECIAL_ZONE_CODE_PREFIX,
  isSpecialZoneCode,
  zonesForProvince,
  findSpecialZone,
  specialZoneOptions,
  specialZoneMasters,
};
