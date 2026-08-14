/**
 * VERA client-issue repair — the rules that decide a WRITTEN value.
 *
 * `buildIssueSuggestion` proposes a province/municipality that an admin can apply
 * to a client record, so a wrong proposal becomes wrong compliance data. These
 * pin the matcher's ranking and the refusals.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { proposeMunicipalityMatch, buildIssueSuggestion } = require("../routes/slfClients");

// A slice of the real Region 3 masterlist, including the shapes that broke the
// matcher: cities stored as "City of X", and a city sharing its province's name.
const MASTERS = [
  { name: "Capas", municipalityCity: "Capas", province: "Tarlac" },
  { name: "City of Tarlac", municipalityCity: "City of Tarlac", province: "Tarlac" },
  { name: "City of Angeles", municipalityCity: "City of Angeles", province: "Pampanga" },
  { name: "Arayat", municipalityCity: "Arayat", province: "Pampanga" },
  { name: "Sta. Ana", municipalityCity: "Sta. Ana", province: "Pampanga" },
  { name: "Balagtas", municipalityCity: "Balagtas", province: "Bulacan" },
  { name: "Subic", municipalityCity: "Subic", province: "Zambales" },
  { name: "San Isidro", municipalityCity: "San Isidro", province: "Nueva Ecija" },
  { name: "San Isidro", municipalityCity: "San Isidro", province: "Bulacan" },
];

const top = (raw) => proposeMunicipalityMatch(raw, MASTERS)[0];

// ── Matching ────────────────────────────────────────────────────────────────
test("a city stored as 'City of X' matches a client that writes just 'X'", () => {
  // The masterlist says "City of Angeles"; clients write "ANGELES".
  assert.equal(top("PRIVATE - ANGELES PAMPANGA")?.name, "City of Angeles");
});

test("the PROVINCE in an address is never mistaken for the municipality", () => {
  // Regression: "longest match wins" picked "City of Tarlac" (6 chars) over
  // "Capas" (5) because addresses end with the province. The town is Capas.
  assert.equal(top("PRIVATE - SITIO KAWILIWILI,CUTCUT II, CAPAS TARLAC")?.name, "Capas");
  assert.equal(top("PRIVATE - SITIO KAWILIWILI,CUTCUT II, CAPAS TARLAC")?.province, "Tarlac");
});

test("a genuine city-named-after-its-province still resolves when it is the only match", () => {
  assert.equal(top("PRIVATE - TARLAC")?.name, "City of Tarlac");
});

test("punctuation and prefixes do not block a match", () => {
  assert.equal(top("BRGY. TELAPAYONG ARAYAT PAMPANGA")?.name, "Arayat");
  assert.equal(top("LGU - BALAGTAS BULACAN")?.name, "Balagtas");
});

test("a name that matches nothing in Region 3 yields no candidates", () => {
  assert.deepEqual(proposeMunicipalityMatch("BATAAN GENERAL HOSPITAL AND MEDICAL CENTER", MASTERS), []);
  assert.deepEqual(proposeMunicipalityMatch("", MASTERS), []);
  assert.deepEqual(proposeMunicipalityMatch(null, MASTERS), []);
});

// ── Proposals ───────────────────────────────────────────────────────────────
const issue = (over = {}) => ({ flagType: "region_unclassified", clientName: "X", ...over });
const client = (over = {}) => ({ _id: "c1", name: "X", province: "", municipalityCity: "", address: "", ...over });

test("a single-province match is HIGH confidence and proposes exactly three fields", () => {
  const s = buildIssueSuggestion(issue(), client({ name: "PRIVATE - SUBIC ZAMBALES" }), MASTERS);
  assert.equal(s.canFix, true);
  assert.equal(s.confidence, "high");
  assert.deepEqual(Object.keys(s.proposal).sort(), ["municipalityCity", "province", "regionClass"]);
  assert.equal(s.proposal.province, "Zambales");
  assert.equal(s.proposal.regionClass, "within-region-3");
});

test("the same town name in two provinces is AMBIGUOUS, never auto-picked", () => {
  const s = buildIssueSuggestion(issue(), client({ name: "SAN ISIDRO" }), MASTERS);
  assert.equal(s.canFix, true);
  assert.equal(s.confidence, "ambiguous", "bulk repair must exclude this");
  assert.ok(s.alternatives.length > 1, "the admin is offered the choices");
});

test("VERA declines the issue types that need human judgement", () => {
  for (const flagType of ["duplicate_client", "missing_hauler", "something_else"]) {
    const s = buildIssueSuggestion(issue({ flagType }), client(), MASTERS);
    assert.equal(s.canFix, false, `${flagType} must not be auto-fixable`);
    assert.ok(s.reason, `${flagType} must explain why`);
  }
});

test("a client that already has a province, or is missing entirely, is declined", () => {
  assert.equal(buildIssueSuggestion(issue(), client({ province: "Bulacan" }), MASTERS).canFix, false);
  assert.equal(buildIssueSuggestion(issue(), null, MASTERS).canFix, false);
});

test("an unmatchable client is declined rather than given a guess", () => {
  const s = buildIssueSuggestion(issue(), client({ name: "METRO CLARK WASTE MANAGEMENT CORPORATION" }), MASTERS);
  assert.equal(s.canFix, false);
  assert.match(s.reason, /does not match any Region 3/);
});

test("municipalityCity is preferred over the free-text name", () => {
  // Name says Subic, the structured field says Arayat — the structured one wins.
  const s = buildIssueSuggestion(issue(), client({ name: "SUBIC BRANCH", municipalityCity: "Arayat" }), MASTERS);
  assert.equal(s.proposal.province, "Pampanga");
  assert.equal(s.proposal.municipalityCity, "Arayat");
});
