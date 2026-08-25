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

/**
 * Collapse baseline rows that are the SAME FACILITY under different name
 * snapshots.
 *
 * `DataSLF.slfName` is a snapshot of the facility's display name at the moment
 * the record was written, and the facility record is the source of truth. So any
 * rename — or one record hand-typed with a different wording — leaves the older
 * spelling behind, and a list grouped by name shows one facility twice. Observed
 * live: Floridablanca Enviro Park had 58 records under
 * "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4) (Private)" and
 * 1 under "Floridablanca Enviro Park - Category 4 Sanitary Landfill (Private)",
 * both pointing at the SAME facility id.
 *
 * This groups on the canonical key — the facility `_id` — and falls back to the
 * normalized name only for rows that cannot be resolved to a facility at all.
 * It is therefore exact, not heuristic: no two distinct facilities can be merged
 * by it, which is why it is safe to apply automatically (unlike slfDuplicateKey,
 * which only nominates candidates for human review).
 *
 * The surviving row is renamed to the facility's CURRENT display name, so the
 * list stops showing a spelling the facility no longer uses, and carries
 * `mergedFromNames` so the older spellings remain visible rather than vanishing.
 *
 * @param {Array} rows        baseline rows, each with { slfName, slfGenerator, … }
 * @param {Array} facilities  [{ _id, lgu, ownership }]
 * @param {Function} [score]  row → number; the highest-scoring row survives.
 *                            Defaults to "most complete baseline wins".
 */
function baselineCompletenessScore(row = {}) {
  let score = 0;
  if (Number(row.totalVolumeAccepted) > 0) score += 4;
  if ((row.activeCellEntries || []).length) score += 2;
  if ((row.closedCellEntries || []).length) score += 2;
  if ((row.accreditedHaulers || []).length) score += 1;
  return score;
}

function mergeBaselineRowsByFacility(rows = [], facilities = [], score = baselineCompletenessScore) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const byId = new Map();
  // A name may legitimately belong to two facilities (same LGU, two sites). Such
  // a name resolves to nothing rather than to an arbitrary one of them — an
  // ambiguous match is exactly where an automatic merge would be wrong.
  const byName = new Map();
  const ambiguous = new Set();
  (Array.isArray(facilities) ? facilities : []).forEach((facility) => {
    const id = String(facility?._id || "");
    if (!id) return;
    byId.set(id, facility);
    [facilityDisplayName(facility), facility?.lgu].forEach((name) => {
      const key = normalizeSlfName(name);
      if (!key) return;
      if (byName.has(key) && byName.get(key) !== id) ambiguous.add(key);
      else byName.set(key, id);
    });
  });
  ambiguous.forEach((key) => byName.delete(key));

  const groupKeyOf = (row) => {
    const generatorId = String(row?.slfGenerator || "");
    if (generatorId && byId.has(generatorId)) return `id:${generatorId}`;
    // A row whose generator is set but points at a facility we did not load is
    // still keyed by that id — two such rows are still the same facility.
    if (generatorId) return `id:${generatorId}`;
    const byNameId = byName.get(normalizeSlfName(row?.slfName));
    return byNameId ? `id:${byNameId}` : `name:${normalizeSlfName(row?.slfName)}`;
  };

  const groups = new Map();
  list.forEach((row) => {
    const key = groupKeyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const out = [];
  groups.forEach((members, key) => {
    if (members.length === 1) {
      out.push(members[0]);
      return;
    }
    const winner = members.reduce((best, row) => {
      const delta = score(row) - score(best);
      if (delta !== 0) return delta > 0 ? row : best;
      // Same completeness → the most recently updated record is the live one.
      return new Date(row.lastUpdated || 0) > new Date(best.lastUpdated || 0) ? row : best;
    }, members[0]);

    const facility = key.startsWith("id:") ? byId.get(key.slice(3)) : null;
    const canonicalName = facility ? facilityDisplayName(facility) : winner.slfName;
    out.push({
      ...winner,
      slfName: canonicalName || winner.slfName,
      // An update request or approval on ANY of the merged records still applies
      // to the facility, so the flags are unioned rather than taken from the
      // winner — dropping one would silently hide a pending request.
      baselineUpdateRequested: members.some((row) => row.baselineUpdateRequested),
      baselineUpdateApproved: members.some((row) => row.baselineUpdateApproved),
      mergedFromNames: [
        ...new Set(
          members
            .map((row) => String(row.slfName || "").trim())
            .filter((name) => name && name !== canonicalName),
        ),
      ],
    });
  });

  return out;
}

module.exports = {
  buildSlfDisplayName,
  facilityDisplayName,
  normalizeSlfName,
  slfDuplicateKey,
  isSameSlfSite,
  baselineCompletenessScore,
  mergeBaselineRowsByFacility,
};
