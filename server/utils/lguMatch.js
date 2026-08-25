// LGU municipality matcher — deterministic-first, fuzzy last. Resolves a client's
// free-text municipality to the official Region III LGU masterlist so served-LGU
// counts stay accurate. Suggestions come ONLY from the encoded masterlist — this
// module never fabricates a municipality and never creates a masterlist entry.
//
// Matching priority (constraint):
//   1. stored masterlist link  (not present on clients today)
//   2. PSGC code               (not present on clients today)
//   3. exact normalized municipality + province
//   4. approved alias/abbreviation + province
//   5. fuzzy comparison, WITHIN THE SAME PROVINCE ONLY
//
// Never matches across provinces. Classifies each record: exact | high | medium |
// multiple | none | invalid.

const { normalizeName } = require("./region3");
const { specialZoneMasters } = require("./specialZones");

// Extra normalization on top of region3.normalizeName: strip common LGU prefixes
// ("city of", "municipality of", "mun. of", "brgy") and collapse whitespace so
// "City of San Fernando" ≈ "San Fernando".
function normMuni(value) {
  let s = normalizeName(value);
  s = s
    .replace(/\b(city|municipality|mun)\s+of\s+/g, "")
    .replace(/\s+city$/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

// Dice coefficient over character bigrams — a lightweight, dependency-free fuzzy
// similarity in [0,1]. Good for spelling variants ("mabalacat" vs "mabalcat").
function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  A.forEach((n) => { total += n; });
  B.forEach((n) => { total += n; });
  A.forEach((n, g) => { if (B.has(g)) overlap += Math.min(n, B.get(g)); });
  return (2 * overlap) / total;
}

// Confidence thresholds (documented for the audit trail).
const HIGH = 0.9;   // fuzzy ≥ this (unique) → high confidence
const MED = 0.8;    // fuzzy in [MED, HIGH) → medium
const MULTI = 0.85; // ≥1 other master also ≥ this → "multiple possible"

// masters: [{ _id, name, normalizedName, province, normalizedProvince, psgcCode, lguType, aliases }]
// Returns { classification, suggestions: [{ masterId, name, province, psgc, confidence, method, reason, score }] }
function matchClient({ municipality, province, name } = {}, masters = []) {
  const muni = normMuni(municipality || name || "");
  const prov = normalizeName(province || "");
  if (!muni) return { classification: "invalid", suggestions: [], reason: "Municipality value is empty." };
  if (!prov) {
    return { classification: "none", suggestions: [], reason: "Missing province — cannot match safely across provinces." };
  }

  // Restrict to the correct province (never cross-province).
  //
  // Special economic zones are appended to the province's pool as first-class
  // candidates. A freeport is a real address but not a PSGC subdivision, so it is
  // absent from the Region3Lgu masterlist by construction — without this, every
  // client inside Clark Freeport Zone or the Freeport Area of Bataan resolved to
  // "none" and was reported as an unmatched municipality forever. Merged BEFORE
  // matching, not bolted on after, so a zone is held to exactly the same
  // exact → alias → fuzzy rules and confidence levels as a municipality.
  // Masterlist entries win a collision: an admin who encodes a zone by hand in
  // Region 3 LGU Data is overriding the built-in, which is the point of encoding it.
  const encoded = masters.filter((m) => (m.normalizedProvince || normalizeName(m.province)) === prov);
  const encodedNames = new Set(encoded.map((m) => normMuni(m.normalizedName || m.name)));
  const inProvince = [
    ...encoded,
    ...specialZoneMasters(province).filter((z) => !encodedNames.has(normMuni(z.name))),
  ];
  if (inProvince.length === 0) {
    return { classification: "none", suggestions: [], reason: `No masterlist municipalities encoded for province "${province}".` };
  }

  const mk = (m, confidence, method, reason, score) => ({
    masterId: String(m._id), name: m.name, province: m.province || "", psgc: m.psgcCode || "",
    // Surfaced so a caller can say "Clark Freeport Zone (special economic zone)"
    // rather than presenting it as an ordinary municipality.
    isSpecialZone: !!m.isSpecialZone || m.lguType === "Special Zone",
    confidence, method, reason, score: score == null ? undefined : Math.round(score * 100) / 100,
  });

  // 3 — exact normalized name + province.
  const exact = inProvince.find((m) => normMuni(m.normalizedName || m.name) === muni);
  if (exact) return { classification: "exact", suggestions: [mk(exact, "high", "exact", "Exact normalized municipality + province match.")] };

  // 4 — approved alias/abbreviation + province.
  const aliasHit = inProvince.find((m) => (m.aliases || []).some((a) => normMuni(a) === muni));
  if (aliasHit) return { classification: "high", suggestions: [mk(aliasHit, "high", "alias", "Matched an approved alias/abbreviation within the province.")] };

  // 5 — fuzzy within the province.
  const scored = inProvince
    .map((m) => ({ m, score: dice(muni, normMuni(m.normalizedName || m.name)) }))
    .filter((x) => x.score >= MED)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { classification: "none", suggestions: [], reason: "No sufficiently similar municipality in this province." };

  const top = scored[0];
  const near = scored.filter((x) => x.score >= MULTI);
  if (near.length > 1) {
    return {
      classification: "multiple",
      reason: "Several municipalities in this province are similar — needs review.",
      suggestions: near.slice(0, 4).map((x) => mk(x.m, x.score >= HIGH ? "high" : "medium", "fuzzy", `Fuzzy similarity ${(x.score * 100).toFixed(0)}% within the province.`, x.score)),
    };
  }
  if (top.score >= HIGH) {
    return { classification: "high", suggestions: [mk(top.m, "high", "fuzzy", `High fuzzy similarity ${(top.score * 100).toFixed(0)}% within the province.`, top.score)] };
  }
  return {
    classification: "medium",
    suggestions: scored.slice(0, 3).map((x) => mk(x.m, "medium", "fuzzy", `Fuzzy similarity ${(x.score * 100).toFixed(0)}% within the province.`, x.score)),
  };
}

module.exports = { matchClient, normMuni, dice, THRESHOLDS: { HIGH, MED, MULTI } };
