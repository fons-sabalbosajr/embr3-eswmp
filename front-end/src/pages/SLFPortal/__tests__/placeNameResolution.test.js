/**
 * Resolving a place name typed into the completion sheet.
 *
 * Every case below is a REAL rejection from a filled work list:
 *
 *   client-26-0 — Province "Manila" is not a known province.
 *   client-33-0 — "San" is not a city/municipality of Pampanga.
 *   client-34-0 — "Balanga" is not a city/municipality of Pampanga.
 *   client-35-0 — Province "Ecija" is not a known province.
 *
 * Checked against the real PSGC list, these are four different problems:
 *   "Ecija"   — half of "Nueva Ecija", and the ONLY province containing it.
 *   "Balanga" — PSGC spells it "City of Balanga", and it is in BATAAN, not the
 *               Pampanga typed beside it.
 *   "San"     — Pampanga has San Luis AND San Simon. Genuinely ambiguous.
 *   "Manila"  — not a province at all; an NCR city standing in for its region.
 *
 * So three are lookups and one is a real choice. The rule these pin: resolve the
 * lookups, and NEVER pick between San Luis and San Simon, because that files a
 * client's waste in the wrong municipality.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBaselineCompletionPatches,
  disambiguateByAddress,
  parseCompletionUpload,
  resolvePlaceName,
  provinceCodesInUpload,
  summarizeBaselineCompleteness,
} from "../baselineCompleteness.js";

// Trimmed from the real PSGC response.
const PROVINCES = [
  { code: "034900000", name: "Nueva Ecija", regionCode: "030000000" },
  { code: "035400000", name: "Pampanga", regionCode: "030000000" },
  { code: "030800000", name: "Bataan", regionCode: "030000000" },
  { code: "037700000", name: "Zambales", regionCode: "030000000" },
  { code: "037100000", name: "Aurora", regionCode: "030000000" },
];
const MUNICIPALITIES = {
  "035400000": [
    { code: "035413000", name: "San Luis" },
    { code: "035414000", name: "San Simon" },
    { code: "035416000", name: "Santa Ana" },
    { code: "035404000", name: "City of San Fernando" },
    { code: "035401000", name: "Angeles City" },
  ],
  "030800000": [
    { code: "030801000", name: "City of Balanga" },
    { code: "030805000", name: "Limay" },
  ],
  "034900000": [{ code: "034902000", name: "Aliaga" }],
};

// ── The lookups ─────────────────────────────────────────────────────────────

test('"Ecija" resolves to Nueva Ecija — it is contained in exactly one province', () => {
  assert.equal(resolvePlaceName("Ecija", PROVINCES).match?.name, "Nueva Ecija");
});

test('"Balanga" resolves to "City of Balanga" — PSGC spells cities that way', () => {
  const pool = MUNICIPALITIES["030800000"];
  assert.equal(resolvePlaceName("Balanga", pool).match?.name, "City of Balanga");
  assert.equal(resolvePlaceName("Balanga City", pool).match?.name, "City of Balanga");
  assert.equal(resolvePlaceName("City of Balanga", pool).match?.name, "City of Balanga");
});

test('"Aurpra" resolves to Aurora — one character, and nothing numeric differs', () => {
  // 24 client entries already carry this typo.
  assert.equal(resolvePlaceName("Aurpra", PROVINCES).match?.name, "Aurora");
});

test("a one-character typo is refused when the difference is a DIGIT", () => {
  // Same rule, same reason, as the client-name matcher: "Barangay 1" and
  // "Barangay 2" are one character apart and are different places.
  const pool = [{ code: "1", name: "Barangay 1" }, { code: "2", name: "Barangay 2" }];
  assert.equal(resolvePlaceName("Barangay 3", pool).match, undefined);
});

// ── The genuine choice ──────────────────────────────────────────────────────

test('"San" in Pampanga is AMBIGUOUS and names its candidates', () => {
  const result = resolvePlaceName("San", MUNICIPALITIES["035400000"]);
  assert.equal(result.match, undefined, "must never pick one");
  // THREE, not two — "San" is a whole word inside "City of San Fernando" as well.
  // Which is the point: a truncated token like this is not a near-miss to be
  // repaired, it is a fragment that fits several real municipalities.
  assert.deepEqual(result.candidates.sort(), [
    "City of San Fernando",
    "San Luis",
    "San Simon",
  ]);
});

test("an ambiguous municipality is rejected with the candidates named", () => {
  const fleet = [{ haulerName: "H", privateSectorClients: [{ clientName: "Depot" }] }];
  const [row] = summarizeBaselineCompleteness(fleet).rows.filter((r) => r.kind === "client");
  const { applied, rejected } = parseCompletionUpload(
    [{ "Row ID": row.id, Hauler: "H", Client: "Depot", Province: "Pampanga", Municipality: "San" }],
    fleet,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.equal(applied, 0);
  assert.match(rejected[0].reason, /could be .*San Luis.*San Simon/);
  assert.match(rejected[0].reason, /write it in full/);
});

test("the client's ADDRESS breaks a tie — but only when it names exactly one", () => {
  assert.equal(disambiguateByAddress(["San Luis", "San Simon"], "Purok 3, San Simon, Pampanga"), "San Simon");
  // Two mentions is a coin toss, not a tie-break.
  assert.equal(disambiguateByAddress(["San Luis", "San Simon"], "between San Luis and San Simon"), null);
  assert.equal(disambiguateByAddress(["San Luis", "San Simon"], "Angeles City"), null);
});

test("an ambiguous row is accepted when the address settles it, and SAYS so", () => {
  const fleet = [{ haulerName: "H", privateSectorClients: [{ clientName: "Depot" }] }];
  const [row] = summarizeBaselineCompleteness(fleet).rows.filter((r) => r.kind === "client");
  const { applied, corrections, patches } = parseCompletionUpload(
    [{
      "Row ID": row.id, Hauler: "H", Client: "Depot",
      Province: "Pampanga", Municipality: "San",
      "Client Address": "Purok 3, San Simon",
    }],
    fleet,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.equal(applied, 1);
  assert.equal(patches[row.id].municipalityName, "San Simon");
  assert.match(corrections[0], /read as "San Simon" from the client's address/);
});

// ── The wrong-province rescue ───────────────────────────────────────────────

test('"Balanga" under Pampanga is filed under BATAAN, and reported', () => {
  const fleet = [{ haulerName: "H", privateSectorClients: [{ clientName: "Depot" }] }];
  const [row] = summarizeBaselineCompleteness(fleet).rows.filter((r) => r.kind === "client");
  const { applied, patches, corrections, rejected } = parseCompletionUpload(
    [{
      "Row ID": row.id, Hauler: "H", Client: "Depot",
      Province: "Pampanga", Municipality: "Balanga",
    }],
    fleet,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.deepEqual(rejected, []);
  assert.equal(applied, 1);
  assert.equal(patches[row.id].provinceName, "Bataan", "the province follows the LGU");
  assert.equal(patches[row.id].municipalityName, "City of Balanga");
  assert.match(corrections[0], /is in Bataan, not Pampanga — province corrected/);

  const next = applyBaselineCompletionPatches(fleet, patches);
  assert.equal(next[0].privateSectorClients[0].province, "030800000");
});

test('"Ecija" end-to-end: the province resolves and its municipality applies', () => {
  const fleet = [{ haulerName: "H", privateSectorClients: [{ clientName: "Depot" }] }];
  const [row] = summarizeBaselineCompleteness(fleet).rows.filter((r) => r.kind === "client");
  const { applied, patches, rejected } = parseCompletionUpload(
    [{ "Row ID": row.id, Hauler: "H", Client: "Depot", Province: "Ecija", Municipality: "Aliaga" }],
    fleet,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.deepEqual(rejected, []);
  assert.equal(applied, 1);
  assert.equal(patches[row.id].provinceName, "Nueva Ecija");
  assert.equal(patches[row.id].municipalityName, "Aliaga");
});

test('"Manila" is still refused — it is not a province', () => {
  // Nothing in the PSGC province list contains it, so there is nothing to resolve
  // to. Refusing beats inventing a location for a client.
  assert.deepEqual(resolvePlaceName("Manila", PROVINCES), {});
});

// ── The lists that make the rescue possible ─────────────────────────────────

test("province lists are pre-loaded from the SHEET and from the FLEET", () => {
  // The sheet's own names, resolved tolerantly…
  const fromSheet = provinceCodesInUpload([{ Province: "Ecija" }], PROVINCES, []);
  assert.deepEqual(fromSheet, ["034900000"], '"Ecija" must still load Nueva Ecija');

  // …and the provinces the fleet already uses, which is what makes "Balanga"
  // findable in Bataan when the sheet only ever mentions Pampanga.
  const fleet = [
    { haulerName: "H", privateSectorClients: [{ clientName: "A", province: "030800000" }] },
  ];
  const both = provinceCodesInUpload([{ Province: "Pampanga" }], PROVINCES, fleet);
  assert.equal(both.includes("035400000"), true);
  assert.equal(both.includes("030800000"), true, "Bataan comes from the fleet");
});

test("a municipality in two provinces is refused rather than guessed", () => {
  const twoWays = {
    "035400000": [{ code: "a", name: "San Isidro" }],
    "034900000": [{ code: "b", name: "San Isidro" }],
    "030800000": [{ code: "c", name: "Limay" }],
  };
  const fleet = [{ haulerName: "H", privateSectorClients: [{ clientName: "Depot" }] }];
  const [row] = summarizeBaselineCompleteness(fleet).rows.filter((r) => r.kind === "client");
  const { applied, rejected } = parseCompletionUpload(
    [{
      "Row ID": row.id, Hauler: "H", Client: "Depot",
      Province: "Bataan", Municipality: "San Isidro",
    }],
    fleet,
    { provinces: PROVINCES, municipalitiesByProvince: twoWays },
  );
  assert.equal(applied, 0);
  assert.match(rejected[0].reason, /exists in 2 provinces/);
});
