/**
 * Complete Baseline Records — export, fill offline, upload back.
 *
 * WHY BULK AT ALL. The on-screen editor fixes one row at a time, which is right
 * for five rows and wrong for five hundred. Measured on live data, the fleet
 * carries 24,874 client entries with no Client Address and 11,133 with no
 * Province — that is a spreadsheet job.
 *
 * WHAT THESE GUARD. A Row ID is POSITIONAL
 * (`client-<haulerIndex>-<clientIndex>`), which addresses a record only while the
 * fleet is unchanged. Between exporting a sheet and uploading it a hauler can be
 * added, renamed or removed — and writing one client's address onto another is
 * worse than leaving it blank. So identity is re-checked on the way in, and a row
 * that has moved is rejected with a reason rather than applied.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPLETION_COLUMNS,
  applyBaselineCompletionPatches,
  buildCompletionExportRows,
  parseCompletionUpload,
  provinceCodesInUpload,
  summarizeBaselineCompleteness,
} from "../baselineCompleteness.js";

const PROVINCES = [
  { code: "0308", name: "Bataan", regionCode: "03" },
  { code: "0354", name: "Pampanga", regionCode: "03" },
];
const MUNICIPALITIES = {
  "0308": [{ code: "030805", name: "Limay" }, { code: "030810", name: "Orani" }],
  "0354": [{ code: "035403", name: "Angeles City" }],
};

const FLEET = [
  {
    haulerName: "MUNICIPAL",
    officeAddress: "",
    privateSectorClients: [
      { clientName: "Limay Public Market" },                       // missing type/province/mun/address
      { clientName: "Wawa", clientType: "LGU", clientAddress: "Wawa Rd" },
    ],
  },
];

const rowsOf = (fleet) => summarizeBaselineCompleteness(fleet).rows;

test("the export carries the agreed columns and pre-fills what IS stored", () => {
  const exported = buildCompletionExportRows(FLEET);
  assert.ok(exported.length > 0);
  assert.deepEqual(Object.keys(exported[0]), COMPLETION_COLUMNS);
  const wawa = exported.find((r) => r.Client === "Wawa");
  // Pre-filled: an operator handed a sheet of blanks cannot tell a missing value
  // from one the tool simply did not show, and would retype correct data.
  assert.equal(wawa["Client Type"], "LGU");
  assert.equal(wawa["Client Address"], "Wawa Rd");
  assert.match(wawa.Missing, /Province|Municipality/);
});

test("a filled sheet round-trips into patches and applies to the fleet", () => {
  const exported = buildCompletionExportRows(FLEET);
  const target = exported.find((r) => r.Client === "Limay Public Market");
  const filled = [
    {
      ...target,
      "Client Type": "LGU",
      "Client Address": "Public Market, Limay",
      Province: "Bataan",
      Municipality: "Limay",
    },
  ];
  const { patches, applied, rejected } = parseCompletionUpload(filled, FLEET, {
    provinces: PROVINCES,
    municipalitiesByProvince: MUNICIPALITIES,
  });
  assert.equal(applied, 1);
  assert.deepEqual(rejected, []);

  // Names in, CODES stored — and the name kept beside it, which is what the
  // downstream consumers read.
  const next = applyBaselineCompletionPatches(FLEET, patches);
  const client = next[0].privateSectorClients[0];
  assert.equal(client.clientName, "Limay Public Market", "the record is not renamed");
  assert.equal(client.clientType, "LGU");
  assert.equal(client.clientAddress, "Public Market, Limay");
  assert.equal(client.province, "0308");
  assert.equal(client.provinceName, "Bataan");
  assert.equal(client.municipality, "030805");
  assert.equal(client.municipalityName, "Limay");
  // Untouched siblings survive.
  assert.equal(next[0].privateSectorClients[1].clientName, "Wawa");
});

test("a Row ID that now names a different client is REJECTED, not applied", () => {
  // The whole reason identity is re-checked: this row would otherwise write
  // Limay's address onto whatever record has drifted into that position.
  const [row] = rowsOf(FLEET).filter((r) => r.kind === "client");
  const stale = [
    {
      "Row ID": row.id,
      Hauler: "MUNICIPAL",
      Client: "Some Other Client Entirely",
      "Client Address": "123 Somewhere",
    },
  ];
  const { patches, applied, rejected } = parseCompletionUpload(stale, FLEET, {
    provinces: PROVINCES,
    municipalitiesByProvince: MUNICIPALITIES,
  });
  assert.equal(applied, 0);
  assert.deepEqual(patches, {});
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /now belongs to client/);
});

test("an unknown Row ID is reported rather than silently dropped", () => {
  const { applied, rejected } = parseCompletionUpload(
    [{ "Row ID": "client-99-99", "Client Address": "x" }],
    FLEET,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.equal(applied, 0);
  assert.match(rejected[0].reason, /not in the current work list/);
});

test("an unknown province is rejected — never guessed at", () => {
  const [row] = rowsOf(FLEET).filter((r) => r.kind === "client");
  const { applied, rejected } = parseCompletionUpload(
    [{ "Row ID": row.id, Hauler: "MUNICIPAL", Client: row.client, Province: "Atlantis" }],
    FLEET,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.equal(applied, 0);
  assert.match(rejected[0].reason, /is not a known province/);
});

test("a municipality outside its province is FILED WHERE IT BELONGS, and reported", () => {
  // Angeles City is in Pampanga, not the Bataan typed beside it. An LGU name is
  // far more specific than the province next to it, so when it resolves uniquely
  // across the provinces in hand the province follows the LGU rather than the row
  // being thrown out. See placeNameResolution.test.js for the full rule.
  const [row] = rowsOf(FLEET).filter((r) => r.kind === "client");
  const { applied, patches, corrections, rejected } = parseCompletionUpload(
    [{
      "Row ID": row.id, Hauler: "MUNICIPAL", Client: row.client,
      Province: "Bataan", Municipality: "Angeles City",
    }],
    FLEET,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.deepEqual(rejected, []);
  assert.equal(applied, 1);
  assert.equal(patches[row.id].provinceName, "Pampanga");
  assert.match(corrections[0], /is in Pampanga, not Bataan/);
});

test("a municipality that exists nowhere in hand is still rejected", () => {
  const [row] = rowsOf(FLEET).filter((r) => r.kind === "client");
  const { applied, rejected } = parseCompletionUpload(
    [{
      "Row ID": row.id, Hauler: "MUNICIPAL", Client: row.client,
      Province: "Bataan", Municipality: "Nowhereville",
    }],
    FLEET,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.equal(applied, 0);
  assert.match(rejected[0].reason, /is not a city\/municipality of Bataan/);
});

test("a municipality with no province is rejected — the names repeat", () => {
  const [row] = rowsOf(FLEET).filter((r) => r.kind === "client");
  const { applied, rejected } = parseCompletionUpload(
    [{ "Row ID": row.id, Hauler: "MUNICIPAL", Client: row.client, Municipality: "Limay" }],
    FLEET,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.equal(applied, 0);
  assert.match(rejected[0].reason, /needs its Province/);
});

test("blank cells stage nothing — they mean 'keep what is stored'", () => {
  const exported = buildCompletionExportRows(FLEET);
  // Uploaded unchanged: every gap still blank.
  const { patches, applied } = parseCompletionUpload(exported, FLEET, {
    provinces: PROVINCES,
    municipalitiesByProvince: MUNICIPALITIES,
  });
  // Only pre-filled values come back, and none of them CLEARS anything.
  const next = applyBaselineCompletionPatches(FLEET, patches);
  assert.equal(next[0].privateSectorClients[0].clientName, "Limay Public Market");
  assert.equal(next[0].privateSectorClients[1].clientAddress, "Wawa Rd");
  assert.ok(applied >= 0);
  // Nothing was emptied.
  assert.notEqual(next[0].privateSectorClients[1].clientType, "");
});

test("a hauler row fills the office address", () => {
  const haulerRow = rowsOf(FLEET).find((r) => r.kind === "hauler");
  assert.ok(haulerRow, "the unaddressed hauler must appear in the work list");
  const { patches } = parseCompletionUpload(
    [{ "Row ID": haulerRow.id, Hauler: "MUNICIPAL", "Office Address": "Town Hall" }],
    FLEET,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  const next = applyBaselineCompletionPatches(FLEET, patches);
  assert.equal(next[0].officeAddress, "Town Hall");
});

test("the provinces a sheet mentions are discoverable, so their lists can be fetched", () => {
  // Municipality codes only resolve inside their province, so the modal must load
  // those lists BEFORE parsing — otherwise a good municipality is rejected for the
  // accident of not having been fetched yet.
  assert.deepEqual(
    provinceCodesInUpload(
      [{ Province: "Bataan" }, { Province: "Pampanga" }, { Province: "Bataan" }, { Province: "" }],
      PROVINCES,
    ),
    ["0308", "0354"],
  );
});

test("a trailing blank row is ignored rather than reported as an error", () => {
  const { applied, rejected } = parseCompletionUpload(
    [{ "Row ID": "", Hauler: "", Client: "" }],
    FLEET,
    { provinces: PROVINCES, municipalitiesByProvince: MUNICIPALITIES },
  );
  assert.equal(applied, 0);
  assert.deepEqual(rejected, []);
});
