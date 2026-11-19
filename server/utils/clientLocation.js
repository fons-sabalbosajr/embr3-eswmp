// Client location and type inference: classify a client Within / Outside Region 3,
// and LGU / Private, from whatever location data the record actually carries.
//
// WHY THIS EXISTS
// ---------------
// classifyRegion (utils/region3) only looks at a province or region string. Client
// Data Issues showed 172 open "No province (Region 3 unknown)" flags, and the Region
// tiles showed zero clients "Outside R3", even though operators had completed the
// location in the SLF Portal. They had: the portal saves `provinceName`,
// `municipalityName`, `regionName` and a free-text `clientAddress` ("Tanza, Cavite").
// Older rows carry only a city ("Angeles City"), a PSGC code ("042100000"), or put
// the place in the client name ("PRIVATE - TRECE CAVITE", "LGU UMINGAN").
// This module reads all of those, in order of reliability, so a client in Cavite or
// Batangas counts as served Outside Region 3 and one in Angeles counts Within.
//
// ORDER OF EVIDENCE (first one that decides wins)
//   1. province field        (Region 3 masterlist → within; any known PH province → outside)
//   2. region field          ("Region IV-A", "Central Luzon", PSGC region code)
//   3. city/municipality     (Region 3 masterlist → within + its province;
//                             known outside city/municipality → outside)
//   4. free-text address     (province, then city names found in the text)
//   5. client name           (province and outside-city names only; a Region 3
//                             municipality name inside a company name is too weak)
//
// It never invents a place. A record with none of the above stays "unclassified"
// and keeps its Client Data Issue, which is the right outcome for a person to fix.

const { normalizeName, REGION_CLASS, isRegion3RegionString } = require("./region3");

// Every Philippine province outside Region 3, plus Metro Manila spellings.
const OUTSIDE_PROVINCES = [
  // NCR
  "Metro Manila", "National Capital Region", "NCR",
  // CAR
  "Abra", "Apayao", "Benguet", "Ifugao", "Kalinga", "Mountain Province",
  // Region I
  "Ilocos Norte", "Ilocos Sur", "La Union", "Pangasinan",
  // Region II
  "Batanes", "Cagayan", "Isabela", "Nueva Vizcaya", "Quirino",
  // Region IV-A
  "Batangas", "Cavite", "Laguna", "Quezon", "Rizal",
  // MIMAROPA
  "Marinduque", "Occidental Mindoro", "Oriental Mindoro", "Palawan", "Romblon",
  // Region V
  "Albay", "Camarines Norte", "Camarines Sur", "Catanduanes", "Masbate", "Sorsogon",
  // Region VI
  "Aklan", "Antique", "Capiz", "Guimaras", "Iloilo", "Negros Occidental",
  // Region VII
  "Bohol", "Cebu", "Negros Oriental", "Siquijor",
  // Region VIII
  "Biliran", "Eastern Samar", "Leyte", "Northern Samar", "Samar", "Southern Leyte",
  // Region IX
  "Zamboanga del Norte", "Zamboanga del Sur", "Zamboanga Sibugay",
  // Region X
  "Bukidnon", "Camiguin", "Lanao del Norte", "Misamis Occidental", "Misamis Oriental",
  // Region XI
  "Davao de Oro", "Davao del Norte", "Davao del Sur", "Davao Occidental", "Davao Oriental",
  // Region XII
  "Cotabato", "Sarangani", "South Cotabato", "Sultan Kudarat",
  // Caraga
  "Agusan del Norte", "Agusan del Sur", "Dinagat Islands", "Surigao del Norte", "Surigao del Sur",
  // BARMM
  "Basilan", "Lanao del Sur", "Maguindanao", "Maguindanao del Norte", "Maguindanao del Sur", "Sulu", "Tawi-Tawi",
];

// Cities and municipalities outside Region 3 that show up WITHOUT a province:
// all of NCR, the CALABARZON/Baguio cities clients come from, and every LGU of
// Pangasinan (Region 3's northern neighbour, whose towns appear by name alone,
// "LGU UMINGAN"). Each maps to its province. Any name that ALSO exists in the
// Region 3 masterlist (Santa Maria, Santo Tomas, San Jose ...) is dropped when the
// index is built, so a Region 3 town is never read as outside.
const OUTSIDE_CITIES = {
  "Metro Manila": [
    "Manila", "Quezon City", "Caloocan", "Las Pinas", "Makati", "Malabon", "Mandaluyong",
    "Marikina", "Muntinlupa", "Navotas", "Paranaque", "Pasay", "Pasig", "Pateros",
    "San Juan", "Taguig", "Valenzuela", "BGC", "Bonifacio Global City", "Ortigas", "Alabang",
  ],
  Cavite: [
    "Bacoor", "Imus", "Dasmarinas", "General Trias", "Trece Martires", "Tagaytay", "Cavite City",
    "Carmona", "Silang", "Tanza", "Kawit", "Noveleta", "Rosario", "Naic", "General Mariano Alvarez",
  ],
  Laguna: ["Calamba", "Binan", "Cabuyao", "San Pedro", "Los Banos", "San Pablo", "Santa Cruz Laguna"],
  Batangas: ["Batangas City", "Lipa", "Tanauan", "Santo Tomas Batangas", "Nasugbu"],
  Rizal: ["Antipolo", "Cainta", "Taytay", "Binangonan", "Rodriguez", "Montalban", "San Mateo"],
  Quezon: ["Lucena", "Tayabas"],
  Benguet: ["Baguio", "La Trinidad"],
  "La Union": ["San Fernando La Union"],
  Pangasinan: [
    "Dagupan", "Urdaneta", "Alaminos", "San Carlos Pangasinan", "Lingayen", "Agno", "Aguilar",
    "Alcala", "Anda", "Asingan", "Balungao", "Bani", "Basista", "Bautista", "Bayambang",
    "Binalonan", "Binmaley", "Bolinao", "Bugallon", "Burgos", "Calasiao", "Dasol", "Infanta",
    "Labrador", "Laoac", "Mabini", "Malasiqui", "Manaoag", "Mangaldan", "Mangatarem",
    "Mapandan", "Natividad", "Pozorrubio", "Rosales", "San Fabian", "San Jacinto",
    "San Manuel", "San Nicolas", "San Quintin", "Santa Barbara", "Santa Maria", "Santo Tomas",
    "Sison", "Sual", "Tayug", "Umingan", "Urbiztondo", "Villasis",
  ],
};

/**
 * Normalize a place name for matching: lowercase, no accents ("Parañaque" →
 * "paranaque"), common abbreviations expanded ("Sta." → "santa"), LGU wrappers
 * dropped ("City of San Fernando", "Angeles City", "LGU ..." → bare name).
 */
function placeKey(value) {
  let s = String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  s = normalizeName(s)
    .replace(/\bsta\b\.?/g, "santa")
    .replace(/\bsto\b\.?/g, "santo")
    .replace(/\bgen\b\.?/g, "general")
    .replace(/\b(lgu|municipality|municipal|mun|city|province|provincial)\s+(of|government of)\s+/g, "")
    .replace(/^(lgu|brgy|barangay|bgy)\s+/g, "")
    // "Angeles City" → "angeles", but "Quezon City" (NCR) must not collapse into
    // Quezon, Nueva Ecija.
    .replace(/\s+city$/g, (m, offset, str) => (str === "quezon city" ? m : ""))
    .replace(/[()/&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

/** The names a value lists, split on "&", "/", "and", "," ("Imus City & Tanza"). */
function placeParts(value) {
  return String(value || "")
    .split(/\s*(?:&|\/|,|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A 9- or 10-digit PSGC code → its two-digit region prefix, else "". */
function psgcRegionPrefix(value) {
  const s = String(value || "").trim();
  if (!/^\d{9,10}$/.test(s)) return "";
  return s.slice(0, 2);
}

/**
 * Build the lookup tables once per request / sync run.
 *
 * @param {Set<string>} provinceSet  normalized Region 3 provinces (getRegion3ProvinceSet)
 * @param {Array} masters            Region3Lgu rows (Municipality / City / Special Zone)
 */
function buildLocationIndex(provinceSet, masters = []) {
  const r3Provinces = new Map(); // placeKey → display province
  (provinceSet ? [...provinceSet] : []).forEach((p) => r3Provinces.set(placeKey(p), titleCase(p)));

  const r3Munis = new Map(); // placeKey → { name, province }
  for (const m of masters || []) {
    const entry = { name: m.name, province: m.province || "" };
    for (const label of [m.name, m.normalizedName, ...(m.aliases || [])]) {
      const k = placeKey(label);
      if (k && !r3Munis.has(k)) r3Munis.set(k, entry);
    }
  }

  const outsideProvinces = new Map(); // placeKey → display province
  OUTSIDE_PROVINCES.forEach((p) => outsideProvinces.set(placeKey(p), p === "NCR" || p === "National Capital Region" ? "Metro Manila" : p));

  const outsideCities = new Map(); // placeKey → { name, province }
  for (const [province, cities] of Object.entries(OUTSIDE_CITIES)) {
    for (const city of cities) {
      const k = placeKey(city);
      // A name Region 3 also has is never evidence of "outside".
      if (!k || r3Munis.has(k)) continue;
      if (!outsideCities.has(k)) outsideCities.set(k, { name: city, province });
    }
  }
  return { r3Provinces, r3Munis, outsideProvinces, outsideCities };
}

function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Similarity for province typos ("PAMPNGA"), Dice over bigrams.
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a); const B = grams(b);
  let overlap = 0; let total = 0;
  A.forEach((n) => { total += n; }); B.forEach((n) => { total += n; });
  A.forEach((n, g) => { if (B.has(g)) overlap += Math.min(n, B.get(g)); });
  return total ? (2 * overlap) / total : 0;
}

const within = (province, municipalityCity, method) => ({ regionClass: REGION_CLASS.WITHIN, province: province || "", municipalityCity: municipalityCity || "", method });
const outside = (province, municipalityCity, method) => ({ regionClass: REGION_CLASS.OUTSIDE, province: province || "", municipalityCity: municipalityCity || "", method });

function fromProvince(value, idx) {
  const k = placeKey(value);
  if (!k) return null;
  if (idx.r3Provinces.has(k)) return within(idx.r3Provinces.get(k), "", "province");
  if (idx.outsideProvinces.has(k)) return outside(idx.outsideProvinces.get(k), "", "province");
  const code = psgcRegionPrefix(value);
  if (code) return code === "03" ? within("", "", "province-code") : outside("", "", "province-code");
  // A misspelt Region 3 province ("Pampnga", "Nueva Ejica").
  // Compared only with the seven Region 3 provinces, and only after every real
  // province name failed an exact match, so 0.75 catches "Pampnga" (0.77) without
  // pulling an outside province in.
  for (const [rk, name] of idx.r3Provinces) if (dice(k, rk) >= 0.75) return within(name, "", "province-fuzzy");
  // Some other non-empty province text: the long-standing rule (utils/region3) is
  // that a named province not in Region 3 is outside it.
  return outside(String(value).trim(), "", "province");
}

function fromRegion(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const code = psgcRegionPrefix(s);
  if (code) return code === "03" ? within("", "", "region-code") : outside("", "", "region-code");
  return isRegion3RegionString(s) ? within("", "", "region") : outside("", "", "region");
}

function fromMunicipality(value, idx) {
  for (const part of placeParts(value)) {
    const k = placeKey(part);
    if (!k) continue;
    if (idx.r3Munis.has(k)) { const m = idx.r3Munis.get(k); return within(m.province, m.name, "municipality"); }
    if (idx.outsideCities.has(k)) { const c = idx.outsideCities.get(k); return outside(c.province, c.name, "municipality"); }
    if (idx.outsideProvinces.has(k)) return outside(idx.outsideProvinces.get(k), "", "municipality");
  }
  return null;
}

// Longest-first whole-word search of `text` for any key in `map`.
function findIn(text, map) {
  const hay = ` ${placeKey(text).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  if (!hay.trim()) return null;
  const keys = [...map.keys()].filter((k) => k.length >= 3).sort((a, b) => b.length - a.length);
  for (const k of keys) if (hay.includes(` ${k} `)) return { key: k, value: map.get(k) };
  return null;
}

function fromText(text, idx, { allowR3Munis }) {
  if (!String(text || "").trim()) return null;
  // Provinces first: "LGU - STA. MARIA PANGASINAN" is Pangasinan, not Santa Maria, Bulacan.
  const op = findIn(text, idx.outsideProvinces);
  const rp = findIn(text, idx.r3Provinces);
  if (op && rp) return null; // names both sides ("SM Clark & SM Cavite"): leave for a person
  if (rp) return within(rp.value, "", "text-province");
  if (op) return outside(op.value, "", "text-province");
  const oc = findIn(text, idx.outsideCities);
  if (oc) return outside(oc.value.province, oc.value.name, "text-city");
  if (allowR3Munis) {
    const rm = findIn(text, idx.r3Munis);
    if (rm) return within(rm.value.province, rm.value.name, "text-municipality");
  }
  return null;
}

/**
 * Classify one client.
 *
 * @param {object} c   { province, municipalityCity, region, address, name, isLgu }
 *   `isLgu`: the client is an LGU, so its NAME is a place ("LGU Sta. Maria").
 * @param {object} idx buildLocationIndex(...)
 * @returns {{ regionClass, province, municipalityCity, method }}
 *   province / municipalityCity are what the evidence established (may be "").
 */
function inferClientLocation(c = {}, idx) {
  return (
    fromProvince(c.province, idx) ||
    fromRegion(c.region) ||
    fromMunicipality(c.municipalityCity, idx) ||
    (c.isLgu ? fromMunicipality(c.name, idx) : null) ||
    fromText(c.address, idx, { allowR3Munis: true }) ||
    fromText(c.name, idx, { allowR3Munis: false }) ||
    { regionClass: REGION_CLASS.UNCLASSIFIED, province: "", municipalityCity: "", method: "none" }
  );
}

// Names that are an LGU by their own wording.
const LGU_NAME_RE = /^\s*(lgu\b|municipality of\b|municipal government\b|city of\b|city government\b|province of\b|provincial government\b|brgy\b\.?|barangay\b|bgy\b\.?)/i;
// Names that are a business by their own wording.
const PRIVATE_NAME_RE = /\b(inc|incorporated|corp|corporation|company|co|ltd|llc|trading|enterprises?|services?|hauling|haulers?|junk ?shop|scrap|logistics|hospital|medical|university|college|school|resort|hotel|restaurant|mall|supermarket|market|industries|manufacturing|foods?|ventures?)\b\.?/i;

/**
 * Infer LGU / Private Sector for a client.
 *
 * The client's NAME decides when it is unambiguous: "LGU Umingan", "City of San
 * Fernando", "Brgy. Basa", or a name that is itself a city/municipality
 * ("Angeles", "Pilar", "San Fernando"): those are LGUs whatever type was picked.
 * Otherwise the operator's own type stands, and only when that is missing does a
 * business suffix ("Inc.", "Trading", "Hauling") decide Private Sector.
 *
 * @param {object} c          { name, rawType, municipalityCity }
 * @param {object} idx        buildLocationIndex(...)
 * @param {Function} classify the existing raw-type classifier (returns "LGU" | "Private Sector" | null)
 * @returns {{ type: string|null, method: string }}
 */
function inferClientType(c = {}, idx, classify) {
  const name = String(c.name || "").trim();
  if (LGU_NAME_RE.test(name)) return { type: "LGU", method: "name-prefix" };
  const k = placeKey(name);
  // A bare province name ("BULACAN", "TARLAC") is usually a fragment of a longer
  // address, not the provincial government, so it does not decide the type.
  const isProvinceName = k && idx && (idx.r3Provinces.has(k) || idx.outsideProvinces.has(k));
  if (k && idx && !isProvinceName && (idx.r3Munis.has(k) || idx.outsideCities.has(k))) return { type: "LGU", method: "name-is-municipality" };
  // The client IS the municipality its own location names ("Angeles" in Angeles City).
  const mk = placeKey(c.municipalityCity);
  if (k && mk && k === mk) return { type: "LGU", method: "name-matches-municipality" };
  const raw = classify ? classify(c.rawType) : null;
  if (raw) return { type: raw, method: "declared" };
  if (PRIVATE_NAME_RE.test(name)) return { type: "Private Sector", method: "name-business" };
  return { type: null, method: "none" };
}

module.exports = {
  OUTSIDE_PROVINCES,
  OUTSIDE_CITIES,
  placeKey,
  placeParts,
  buildLocationIndex,
  inferClientLocation,
  inferClientType,
};
