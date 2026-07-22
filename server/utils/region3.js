// Centralized Region 3 (Central Luzon) classification.
//
// SINGLE source of truth for the Region 3 province fallback and the
// within/outside classification, so the list is not duplicated across files.
// The authoritative province set is the Region3Lgu configuration collection
// (Developer → App Settings → Region 3 LGU Data); this fallback is used only
// until that collection is populated.

const REGION3_PROVINCE_FALLBACK = [
  "Aurora",
  "Bataan",
  "Bulacan",
  "Nueva Ecija",
  "Pampanga",
  "Tarlac",
  "Zambales",
];

// Region classification values stored on records.
const REGION_CLASS = {
  WITHIN: "within-region-3",
  OUTSIDE: "outside-region-3",
  UNCLASSIFIED: "unclassified",
};

// Normalize a name for matching: lowercase, strip "province of", collapse
// whitespace, drop common punctuation.
function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/province of\s+/g, "")
    .replace(/[.,''`]/g, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// True when a free-text region string reads as Region 3 / Central Luzon.
function isRegion3RegionString(region) {
  const r = normalizeName(region);
  if (!r) return false;
  return (
    r === "region iii" ||
    r === "region 3" ||
    r === "region3" ||
    r === "iii" ||
    r === "3" ||
    r.includes("central luzon") ||
    r.includes("region iii") ||
    r.includes("region 3") ||
    /\bregion\s*0?3\b/.test(r)
  );
}

// Resolve the authoritative Region 3 province set (normalized) from the
// Region3Lgu configuration; falls back to the centralized constant when the
// configuration has no active data. Returns a Set of normalized province names.
async function getRegion3ProvinceSet() {
  try {
    const Region3Lgu = require("../models/Region3Lgu");
    const rows = await Region3Lgu.find({ status: "Active" }).select("province normalizedProvince").lean();
    const set = new Set();
    rows.forEach((r) => {
      const n = r.normalizedProvince || normalizeName(r.province);
      if (n) set.add(n);
    });
    if (set.size) return set;
  } catch {
    /* model may not exist / DB unavailable — use fallback */
  }
  return new Set(REGION3_PROVINCE_FALLBACK.map(normalizeName));
}

// Classify a location as within/outside Region 3, or unclassified when neither
// a province nor a region string is usable. `provinceSet` is the normalized set
// from getRegion3ProvinceSet() (pass it in to avoid a query per record).
function classifyRegion({ province, region } = {}, provinceSet) {
  const set = provinceSet || new Set(REGION3_PROVINCE_FALLBACK.map(normalizeName));
  const p = normalizeName(province);
  if (p) return set.has(p) ? REGION_CLASS.WITHIN : REGION_CLASS.OUTSIDE;
  if (region) return isRegion3RegionString(region) ? REGION_CLASS.WITHIN : REGION_CLASS.OUTSIDE;
  return REGION_CLASS.UNCLASSIFIED;
}

module.exports = {
  REGION3_PROVINCE_FALLBACK,
  REGION_CLASS,
  normalizeName,
  isRegion3RegionString,
  getRegion3ProvinceSet,
  classifyRegion,
};
