/**
 * Per-hauler client list — export ⇄ upload, validation, and the merge.
 *
 * This import is NARROWER than the baseline-wide hauler upload, and the extra
 * rigour it can afford is the whole reason it exists: it runs inside Edit
 * Accredited Hauler, so the hauler's current client list is known and every row
 * can be resolved against it before anything is applied. These tests pin the
 * two consequences of that — a NEW client is held to the Add Client form's
 * requirements, an UPDATE is not — plus the merge contract shared with every
 * other import in the portal: blank keeps stored, nothing is ever removed.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  CLIENT_UPLOAD_COLUMNS,
  annotateClientUploadRows,
  buildClientExportRows,
  getClientUploadMissingColumns,
  getClientUploadRowErrors,
  mergeClientListUpload,
  parseClientUploadRow,
  resolveClientUploadField,
  summarizeClientUpload,
} from "../clientListUpload.js";

const HAULER = {
  haulerName: "XYZ Hauling Services",
  privateSectorClients: [
    {
      key: 1,
      clientName: "ABC Manufacturing",
      clientType: "Private",
      clientAddress: "San Fernando, Pampanga",
      regionName: "Region III (Central Luzon)",
      provinceName: "Pampanga",
      municipalityName: "San Fernando",
    },
    { key: 2, clientName: "DEF Foods", clientType: "Private", provinceName: "Pampanga" },
  ],
};

const namesOf = (clients) => clients.map((c) => c.clientName);
const byName = (clients, name) => clients.find((c) => c.clientName === name);

// ── Header mapping ──────────────────────────────────────────────────────────
test("every column resolves to its own field, not a neighbour's", () => {
  // "Client Name", "Client Type" and "Client Address" all contain "client", so
  // only the priority order keeps them apart.
  for (const column of CLIENT_UPLOAD_COLUMNS) {
    assert.equal(
      resolveClientUploadField(column.label),
      column.field,
      `${column.label} must map to ${column.field}`,
    );
  }
});

test("a row maps every declared column, and normalizes the type", () => {
  const parsed = parseClientUploadRow({
    "Client Name": "  Baliuag   LGU ",
    "Client Type": "lgu",
    "Client Address": "Poblacion, Baliuag",
    Region: "Region III (Central Luzon)",
    Province: "Bulacan",
    "City/Municipality": "Baliuag",
  });
  assert.equal(parsed.clientName, "Baliuag LGU", "whitespace is collapsed");
  assert.equal(parsed.clientType, "LGU", "casing is normalized to the stored enum");
  assert.equal(parsed.clientAddress, "Poblacion, Baliuag");
  assert.equal(parsed.regionName, "Region III (Central Luzon)");
  assert.equal(parsed.provinceName, "Bulacan");
  assert.equal(parsed.municipalityName, "Baliuag");
});

test("there is no Hauler Name column — the hauler is the modal, not the file", () => {
  // The single biggest failure of the wide import (a misspelled hauler name
  // silently creating a second hauler) is removed from this path by construction.
  assert.deepEqual(
    CLIENT_UPLOAD_COLUMNS.filter((c) => /hauler/i.test(c.label)),
    [],
  );
  // A stray Hauler Name column (from a file built off the wide hauler export)
  // is IGNORED rather than read as a client name — the safer of the two, since
  // silently importing hauler names as clients would be worse than dropping a
  // column the format has no use for.
  assert.equal(resolveClientUploadField("Hauler Name"), null);
});

test("the required columns are the ones the file cannot work without", () => {
  assert.deepEqual(
    CLIENT_UPLOAD_COLUMNS.filter((c) => c.required).map((c) => c.label),
    ["Client Name", "Client Type"],
  );
  assert.deepEqual(getClientUploadMissingColumns(["Client Name", "Client Type"]), []);
  assert.deepEqual(getClientUploadMissingColumns(["Client Name"]), ["Client Type"]);
});

// ── The rule scope buys: new vs update ──────────────────────────────────────
test("a NEW client must clear the same bar as the Add Client form", () => {
  const existing = new Set(["abc manufacturing"]);
  assert.deepEqual(
    getClientUploadRowErrors({ clientName: "New Co", clientType: "Private" }, existing),
    ["Province is required for a new client"],
  );
  assert.deepEqual(
    getClientUploadRowErrors(
      { clientName: "New Co", clientType: "Private", provinceName: "Bulacan" },
      existing,
    ),
    [],
  );
});

test("an UPDATE may fill one field and leave the rest blank", () => {
  // Blank means "keep what is stored", and the stored client already has a
  // province — so demanding one here would make a one-field correction
  // impossible, which is the mistake the wide import deliberately avoids too.
  const existing = new Set(["abc manufacturing"]);
  assert.deepEqual(
    getClientUploadRowErrors(
      { clientName: "ABC Manufacturing", clientType: "Private", clientAddress: "New address" },
      existing,
    ),
    [],
  );
});

test("a missing name or an unusable type is reported", () => {
  assert.deepEqual(
    getClientUploadRowErrors({ clientName: "", clientType: "" }, new Set()),
    ["Client Name is required", "Client Type is required"],
  );
  assert.deepEqual(
    getClientUploadRowErrors(
      { clientName: "X Co", clientType: "Commercial", provinceName: "Bulacan" },
      new Set(),
    ),
    ["Client Type must be LGU or Private"],
  );
});

// ── Preview classification ──────────────────────────────────────────────────
test("the preview says which rows ADD a client and which UPDATE one", () => {
  const rows = annotateClientUploadRows(
    [
      { clientName: "ABC Manufacturing", clientType: "LGU" },
      { clientName: "Baliuag LGU", clientType: "LGU", provinceName: "Bulacan" },
      { clientName: "abc manufacturing", clientType: "Private" },
    ],
    HAULER.privateSectorClients,
  );
  assert.deepEqual(rows.map((r) => r._status), ["update", "new", "duplicate"]);
  assert.equal(rows[2]._duplicateOfRow, 2, "…and which row it repeats");

  const summary = summarizeClientUpload(rows);
  assert.equal(summary.newClients, 1);
  assert.equal(summary.updatedClients, 1, "the duplicate is the SAME client, counted once");
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.invalid, 0);
});

test("an invalid row is never also counted as an add or an update", () => {
  const rows = annotateClientUploadRows(
    [{ clientName: "New Co", clientType: "Private" }],
    HAULER.privateSectorClients,
  );
  assert.equal(rows[0]._status, "invalid", "no province on a new client");
  const summary = summarizeClientUpload(rows);
  assert.equal(summary.invalid, 1);
  assert.equal(summary.newClients, 0);
});

// ── The merge ───────────────────────────────────────────────────────────────
test("an upload adds and updates, and never removes a client", () => {
  const rows = annotateClientUploadRows(
    [
      { clientName: "ABC Manufacturing", clientAddress: "Corrected address", clientType: "Private" },
      { clientName: "Baliuag LGU", clientType: "LGU", provinceName: "Bulacan", municipalityName: "Baliuag" },
    ],
    HAULER.privateSectorClients,
  );
  const merged = mergeClientListUpload(HAULER.privateSectorClients, rows);

  assert.deepEqual(namesOf(merged), ["ABC Manufacturing", "DEF Foods", "Baliuag LGU"]);
  // DEF Foods is not in the file at all and must be untouched.
  assert.deepEqual(byName(merged, "DEF Foods"), HAULER.privateSectorClients[1]);

  const abc = byName(merged, "ABC Manufacturing");
  assert.equal(abc.clientAddress, "Corrected address", "the supplied field is updated");
  assert.equal(abc.provinceName, "Pampanga", "…and every field the row left blank survives");
  assert.equal(abc.municipalityName, "San Fernando");
  assert.equal(abc.key, 1, "the stored row identity is preserved across an update");

  const baliuag = byName(merged, "Baliuag LGU");
  assert.equal(baliuag.clientType, "LGU");
  assert.equal(baliuag.provinceName, "Bulacan");
  assert.ok(baliuag.key, "a new client still gets a row key");
});

test("matching ignores case and spacing, so one client never splits into two", () => {
  const rows = annotateClientUploadRows(
    [{ clientName: "  abc   MANUFACTURING ", clientType: "LGU" }],
    HAULER.privateSectorClients,
  );
  const merged = mergeClientListUpload(HAULER.privateSectorClients, rows);
  assert.equal(merged.length, 2, "no client was added");
  assert.equal(byName(merged, "ABC Manufacturing").clientType, "LGU", "the stored record was updated");
  // …and the STORED spelling survives. The only renames reachable through a
  // match are casing/whitespace drift, so letting the sheet overwrite the name
  // would churn the matching key without anyone asking for it.
  assert.equal(byName(merged, "abc MANUFACTURING"), undefined);
  assert.deepEqual(namesOf(merged), ["ABC Manufacturing", "DEF Foods"]);
});

test("a client stored as a bare string survives the merge as a record", () => {
  const merged = mergeClientListUpload(
    ["Legacy Client"],
    annotateClientUploadRows([{ clientName: "Legacy Client", clientType: "LGU", provinceName: "Tarlac" }], [
      "Legacy Client",
    ]),
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].clientName, "Legacy Client");
  assert.equal(merged[0].clientType, "LGU");
  assert.equal(merged[0].provinceName, "Tarlac");
});

test("empty and malformed input does not throw", () => {
  assert.doesNotThrow(() => mergeClientListUpload(undefined, undefined));
  assert.doesNotThrow(() => annotateClientUploadRows(null, null));
  assert.deepEqual(mergeClientListUpload([], []), []);
});

// ── Export ⇄ upload round-trip ──────────────────────────────────────────────
test("an exported client list is a file the uploader accepts, unedited", () => {
  const exported = buildClientExportRows(HAULER);
  const sheet = [
    CLIENT_UPLOAD_COLUMNS.map((c) => c.label),
    ...exported.map((row) => CLIENT_UPLOAD_COLUMNS.map((c) => row[c.field] ?? "")),
  ];

  // Through real .xlsx bytes, the same way the panel reads a picked file.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet), "Clients");
  const reread = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), {
    type: "buffer",
  });
  const raw = XLSX.utils.sheet_to_json(reread.Sheets[reread.SheetNames[0]], { defval: "" });

  assert.deepEqual(getClientUploadMissingColumns(Object.keys(raw[0])), []);
  const rows = annotateClientUploadRows(raw.map(parseClientUploadRow), HAULER.privateSectorClients);
  assert.deepEqual(rows.flatMap((r) => r._errors), [], "a straight re-upload must not be rejected");
  assert.deepEqual(rows.map((r) => r._status), ["update", "update"], "…and changes nothing");

  // Round-tripping must leave the hauler's clients exactly as they were.
  const merged = mergeClientListUpload(HAULER.privateSectorClients, rows);
  assert.equal(merged.length, HAULER.privateSectorClients.length);
  assert.equal(byName(merged, "ABC Manufacturing").provinceName, "Pampanga");
  assert.equal(byName(merged, "ABC Manufacturing").municipalityName, "San Fernando");
});

test("a client's PSGC code is never exported as its location", () => {
  // Legacy clients store the picker's code in `province` and the readable name
  // in `provinceName`. Writing "031400000" into the sheet would upload back as
  // a province no Region 3 check can match.
  const [row] = buildClientExportRows({
    privateSectorClients: [
      {
        clientName: "Legacy LGU",
        clientType: "LGU",
        region: "030000000",
        regionName: "Region III (Central Luzon)",
        province: "031400000",
        provinceName: "Bulacan",
        municipality: "031405000",
        municipalityName: "Baliuag",
      },
    ],
  });
  assert.equal(row.regionName, "Region III (Central Luzon)");
  assert.equal(row.provinceName, "Bulacan");
  assert.equal(row.municipalityName, "Baliuag");
});

test("a hauler with no clients exports an empty list rather than a blank row", () => {
  assert.deepEqual(buildClientExportRows({ privateSectorClients: [] }), []);
  assert.deepEqual(buildClientExportRows({}), []);
  // A stored entry with no name is not a client and must not become one.
  assert.deepEqual(buildClientExportRows({ privateSectorClients: [{ clientType: "LGU" }] }), []);
});
