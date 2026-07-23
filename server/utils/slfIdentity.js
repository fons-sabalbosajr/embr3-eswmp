// Canonical SLF identity helpers.
//
// An SLF's RELATIONSHIP key is always its SlfFacility `_id`. These helpers exist
// only for the secondary, best-effort work that an id cannot do on its own:
//   • building the single display name a facility is shown under, and
//   • collapsing free-text name variants when detecting accidental duplicates or
//     re-linking legacy records that were saved before ids were stored.
//
// Mirrors the name normalization already used inline by routes/dataSLF.js and
// routes/slfFacilities.js so every consumer agrees on what "the same name" means.

// The one place a facility's display name is composed. DataSLF.slfName and
// UserPortal.assignedSlfName store a SNAPSHOT of this string; the facility record
// is always the source of truth.
function buildSlfDisplayName(lgu, ownership) {
  return `${lgu || ""}${ownership ? ` (${ownership})` : ""}`.trim();
}

function facilityDisplayName(facility) {
  if (!facility) return "";
  return buildSlfDisplayName(facility.lgu, facility.ownership);
}

// Strip the decoration that makes two labels for the same site look different:
// parenthetical qualifiers ("(Cat 4)", "(Private)"), LGU/city/municipality
// prefixes, category wording, punctuation and dash variants.
function normalizeSlfName(value) {
  return String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
    .replace(/\blgu\b/gi, " ")
    .replace(/\bmunicipality\s+of\b/gi, " ")
    .replace(/\bcity\s+of\b/gi, " ")
    .replace(/^province\s+of\s+/i, "")
    .replace(/[‒-―-]+/g, " ")
    .replace(/[,.;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Aggressive key used ONLY for duplicate detection. On top of normalizeSlfName it
// drops the boilerplate that the same facility is written with inconsistently
// ("Sanitary Landfill", "Enviro Park", "Category 4"/"Cat 4", province prefix) and
// sorts the remaining words, so
//   "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4)"
//   "Floridablanca Enviro Park - Category 4 Sanitary Landfill"
// collapse to the same key. Deliberately lossy — never use it as a storage key or
// as the basis for an automatic delete; it only nominates candidates for review.
const DUPLICATE_NOISE_WORDS = new Set([
  "sanitary", "landfill", "slf", "facility", "enviro", "environmental", "park",
  "category", "cat", "the", "of", "and", "engineered", "site", "disposal",
  "1", "2", "3", "4", "5", "i", "ii", "iii", "iv", "v",
]);

function slfDuplicateKey(value, { province = "" } = {}) {
  // The province is frequently prefixed into the name of one variant only
  // ("Pampanga - Floridablanca ...") — drop it so it can't split the key.
  const provinceWords = new Set(normalizeSlfName(province).split(" ").filter(Boolean));
  const words = normalizeSlfName(value)
    .split(" ")
    .filter((word) => word && !DUPLICATE_NOISE_WORDS.has(word) && !provinceWords.has(word));
  return [...new Set(words)].sort().join(" ");
}

// Two facility records are the same SITE when their duplicate keys match and they
// sit in the same province. Barangay is intentionally NOT required — it is often
// spelled differently ("Pabanlag" vs "Pabanlag, Floridblanca") for the same site.
function isSameSlfSite(a, b) {
  const provA = normalizeSlfName(a?.province);
  const provB = normalizeSlfName(b?.province);
  if (provA && provB && provA !== provB) return false;
  const keyA = slfDuplicateKey(a?.lgu, { province: a?.province || b?.province });
  const keyB = slfDuplicateKey(b?.lgu, { province: b?.province || a?.province });
  return !!keyA && !!keyB && keyA === keyB;
}

module.exports = {
  buildSlfDisplayName,
  facilityDisplayName,
  normalizeSlfName,
  slfDuplicateKey,
  isSameSlfSite,
};
