/**
 * Generates the developer bulk-update / bulk-upload test workbooks.
 *
 *   node scripts/generateDevTestWorkbook.js
 *
 * ── Why a generator and not a checked-in binary ──────────────────────────────
 * The column HEADERS are copied from the portal's own upload definitions
 * (front-end/src/pages/SLFPortal/uploadHelpers.js → DISPOSAL_UPLOAD_COLUMNS /
 * HAULER_UPLOAD_COLUMNS). Regenerating after an import-format change keeps the
 * test data valid instead of silently drifting from the real parser.
 *
 * ── Isolation ───────────────────────────────────────────────────────────────
 * Every value targets the EXISTING sealed demo environment created by
 * `npm run seed:demo` — portal account demo.portal@eswmp-demo.local, facility
 * "Demonstration Valley" (isDummy: true), cells 1-5 with Cell 2/3 (Residual) and
 * Cell 4 (Treated Haz Waste) open for submissions. Every name is obviously
 * synthetic ("TEST ..."); nothing here references a real LGU, hauler or client.
 *
 * ── Output ──────────────────────────────────────────────────────────────────
 * The portal's uploader reads ONLY THE FIRST SHEET of an uploaded file, so each
 * scenario is written as its own single-sheet .xlsx (that is what you upload).
 * A combined multi-sheet workbook is also written for reading/reference only.
 */
const path = require("node:path");
const fs = require("node:fs");
const XLSX = require("xlsx");

const OUT_DIR = path.join(__dirname, "..", "..", "docs", "dev-test-data");

// ── Headers — the LABELS the portal's header matcher resolves ────────────────
// Disposal (uploadType "truck"): every column below is REQUIRED except the
// hazardous waste code.
const DISPOSAL_HEADERS = [
  "Disposal Date",
  "Ticket Number",
  "Hauler",
  "Client",
  "Plate Number",
  "Truck Capacity",
  "Waste Volume",
  "Unit of Measurement",
  "Cell or Disposal Area",
  "Waste Type",
  "Hazardous Waste Code",
];

// Accredited haulers (uploadType "hauler"): Hauler Name + Number of Trucks are
// required; everything else is optional — which is what makes a partial update
// possible.
// The client LOCATION columns are the ones the Add Client form asks for
// (province classifies a client within / outside Region 3), and they are also
// what "Export Hauler Data" writes — the export uses this exact layout so it can
// be edited and uploaded straight back.
const HAULER_HEADERS = [
  "Hauler Name",
  "Number of Trucks",
  "Office Address",
  "Plate Number",
  "Vehicle Type",
  "Capacity",
  "Capacity Unit",
  "Clients",
  "Client Type",
  "Client Address",
  "Client Region",
  "Client Province",
  "Client City/Municipality",
];

// The demo facility declares m³ and has Cell 2 / Cell 3 (Residual) and Cell 4
// (Treated Haz Waste) open. Cell 1 is Used/Completed and Cell 5 is Under
// Construction — both are correctly rejected by the cell validator.
const UNIT = "m³";
const DISPOSAL_DATE = "2026-08-13";

// ── 1. Hauler bulk upload — establishes the accredited haulers + clients ─────
const R3 = "Region III (Central Luzon)";
const haulerUploadRows = [
  ["TEST HAULER 001", 2, "TEST ADDRESS 001, Demonstration Valley", "TST-0001", "Dump Truck", 15, UNIT, "TEST CLIENT 001", "Private", "TEST CLIENT ADDRESS 001", R3, "Bulacan", "TEST CITY 001"],
  ["TEST HAULER 001", 2, "TEST ADDRESS 001, Demonstration Valley", "TST-0002", "Compactor", 12, UNIT, "TEST CLIENT 002", "LGU", "TEST CLIENT ADDRESS 002", R3, "Bulacan", "TEST CITY 002"],
  ["TEST HAULER 002", 1, "TEST ADDRESS 002, San Ejemplo", "TST-0003", "Dump Truck", 20, UNIT, "TEST CLIENT 003", "Private", "TEST CLIENT ADDRESS 003", R3, "Pampanga", "TEST CITY 003"],
];

// ── 2. Hauler PARTIAL update — only the fields being changed ────────────────
// Number of Trucks is required by the validator, so it is carried unchanged.
// Office Address / Vehicle Type / Clients / Client Address are DELIBERATELY
// absent: after this upload they must still hold their values from step 1.
const haulerPartialRows = [
  ["TEST HAULER 001", 2, "TST-0001", 18, UNIT],
  ["TEST HAULER 002", 1, "TST-0003", 22, UNIT],
];
const HAULER_PARTIAL_HEADERS = [
  "Hauler Name",
  "Number of Trucks",
  "Plate Number",
  "Capacity",
  "Capacity Unit",
];

// ── 3. Disposal bulk upload — references the haulers/clients from step 1 ────
const disposalUploadRows = [
  [DISPOSAL_DATE, "TEST-DT-0001", "TEST HAULER 001", "TEST CLIENT 001", "TST-0001", 15, 12.5, UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-0002", "TEST HAULER 001", "TEST CLIENT 002", "TST-0002", 12, 9, UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-0003", "TEST HAULER 002", "TEST CLIENT 003", "TST-0003", 20, 16.25, UNIT, "Cell 3", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-0004", "TEST HAULER 002", "TEST CLIENT 003", "TST-0003", 20, 4.75, UNIT, "Cell 4", "Treated Hazardous Waste", "K301"],
];

// ── 4. Invalid data — one defect per row, each must be REPORTED, not imported ─
const invalidRows = [
  ["", "TEST-DT-9001", "TEST HAULER 001", "TEST CLIENT 001", "TST-0001", 15, 10, UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-9002", "TEST HAULER 001", "TEST CLIENT 001", "TST-0001", 15, -5, UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-9003", "TEST HAULER 001", "TEST CLIENT 001", "TST-0001", 0, 10, UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-9004", "TEST HAULER 001", "TEST CLIENT 001", "TST-0001", 15, "abc", UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-9005", "TEST HAULER 999", "TEST CLIENT 001", "TST-0001", 15, 10, UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-9006", "TEST HAULER 001", "TEST CLIENT 999", "TST-0001", 15, 10, UNIT, "Cell 2", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-9007", "TEST HAULER 001", "TEST CLIENT 001", "TST-0001", 15, 10, UNIT, "Cell 5", "Residual", ""],
  [DISPOSAL_DATE, "TEST-DT-9008", "TEST HAULER 001", "TEST CLIENT 001", "TST-0001", 15, 10, UNIT, "", "Residual", ""],
];
const INVALID_EXPECTATIONS = [
  "Missing Disposal Date → required-column/row error",
  "Negative Waste Volume → 'Waste Volume must be greater than 0'",
  "Zero Truck Capacity → 'Truck Capacity must be greater than 0'",
  "Non-numeric Waste Volume → 'Waste Volume must be greater than 0'",
  "Unknown hauler → 'Hauler ... is not assigned under this SLF.'",
  "Unknown client → 'Client ... is not assigned to hauler ...'",
  "Cell 5 is Under Construction → cell not available",
  "Missing cell → required Cell or Disposal Area",
];

// ── 5. Duplicate handling — a controlled duplicate, no DB rows created ───────
// Same hauler + client repeated (must MERGE into one hauler/client, not two,
// and must not report "duplicated or ambiguous"), and a repeated ticket number.
const duplicateHaulerRows = [
  ["TEST HAULER 001", 2, "TEST ADDRESS 001, Demonstration Valley", "TST-0001", "Dump Truck", 15, UNIT, "TEST CLIENT 001", "Private", "TEST CLIENT ADDRESS 001", R3, "Bulacan", "TEST CITY 001"],
  ["test hauler 001", 2, "", "TST-0001", "", 15, UNIT, "test client 001", "Private", "", "", "", ""],
  ["TEST HAULER 001", 2, "", "TST-0004", "Dump Truck", 14, UNIT, "TEST CLIENT 001", "Private", "", "", "", ""],
];

const README_ROWS = [
  ["SLF Portal — Developer Bulk Update / Bulk Upload Test Data"],
  [""],
  ["Environment", "Sealed demo environment created by: npm run seed:demo (server/)"],
  ["Portal account", "demo.portal@eswmp-demo.local"],
  ["Admin account", "demo.admin@eswmp-demo.local"],
  ["Passwords", "From DEMO_PORTAL_PASSWORD / DEMO_ADMIN_PASSWORD in server/.env — never from this file"],
  ["Container", 'SLF facility "Demonstration Valley" (Bulacan), isDummy: true'],
  ["Reset", "npm run seed:demo:reset (server/) — deletes and re-creates ONLY the demo rows"],
  [""],
  ["IMPORTANT", "The portal uploader reads only the FIRST SHEET of a file."],
  ["", "Upload the individual .xlsx files, not this combined reference workbook."],
  [""],
  ["Order of use", ""],
  ["1", "01_Hauler_Bulk_Upload.xlsx — Data Entry > Baseline > Accredited Haulers > Upload"],
  ["2", "Save Baseline (haulers + clients must be persisted before a disposal upload)"],
  ["3", "02_Hauler_Partial_Update.xlsx — re-upload; ONLY Capacity changes (15→18, 20→22)"],
  ["", "Office Address / Vehicle Type / Clients / Client Address / Client location must remain from step 1"],
  ["4", "03_Disposal_Bulk_Upload.xlsx — Data Entry > Waste Generation Information > Upload"],
  ["5", "04_Invalid_Data_Test.xlsx — every row must be REPORTED and the import blocked"],
  ["6", "05_Duplicate_Data_Test.xlsx — 3 rows must merge into 1 hauler / 1 client / 2 vehicles"],
  [""],
  ["Safety", "Every value is synthetic (TEST ...). Do not upload against a real SLF account."],
];

const sheetOf = (aoa, widths) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = (widths || aoa[0].map((h) => String(h).length + 6)).map((wch) => ({ wch }));
  return ws;
};

const writeSingleSheet = (fileName, sheetName, aoa) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetOf(aoa), sheetName);
  const target = path.join(OUT_DIR, fileName);
  XLSX.writeFile(wb, target);
  return target;
};

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const written = [];
  written.push(writeSingleSheet("01_Hauler_Bulk_Upload.xlsx", "Hauler_Bulk_Upload", [HAULER_HEADERS, ...haulerUploadRows]));
  written.push(writeSingleSheet("02_Hauler_Partial_Update.xlsx", "Hauler_Partial_Update", [HAULER_PARTIAL_HEADERS, ...haulerPartialRows]));
  written.push(writeSingleSheet("03_Disposal_Bulk_Upload.xlsx", "Disposal_Bulk_Upload", [DISPOSAL_HEADERS, ...disposalUploadRows]));
  written.push(writeSingleSheet("04_Invalid_Data_Test.xlsx", "Invalid_Data", [DISPOSAL_HEADERS, ...invalidRows]));
  written.push(writeSingleSheet("05_Duplicate_Data_Test.xlsx", "Duplicate_Data", [HAULER_HEADERS, ...duplicateHaulerRows]));

  // Combined reference workbook (reading only — the app imports sheet 1).
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetOf(README_ROWS, [22, 84]), "README");
  XLSX.utils.book_append_sheet(wb, sheetOf([HAULER_HEADERS, ...haulerUploadRows]), "1_Hauler_Bulk_Upload");
  XLSX.utils.book_append_sheet(wb, sheetOf([HAULER_PARTIAL_HEADERS, ...haulerPartialRows]), "2_Partial_Update");
  XLSX.utils.book_append_sheet(wb, sheetOf([DISPOSAL_HEADERS, ...disposalUploadRows]), "3_Disposal_Bulk_Upload");
  XLSX.utils.book_append_sheet(
    wb,
    sheetOf([[...DISPOSAL_HEADERS, "EXPECTED RESULT"], ...invalidRows.map((r, i) => [...r, INVALID_EXPECTATIONS[i]])]),
    "4_Invalid_Data",
  );
  XLSX.utils.book_append_sheet(wb, sheetOf([HAULER_HEADERS, ...duplicateHaulerRows]), "5_Duplicate_Data");
  const combined = path.join(OUT_DIR, "SLF_Developer_Test_Data.xlsx");
  XLSX.writeFile(wb, combined);
  written.push(combined);

  written.forEach((file) => console.log(`  ✓ ${path.relative(path.join(__dirname, "..", ".."), file)}`));
}

if (require.main === module) main();

module.exports = {
  DISPOSAL_HEADERS,
  HAULER_HEADERS,
  HAULER_PARTIAL_HEADERS,
  haulerUploadRows,
  haulerPartialRows,
  disposalUploadRows,
  invalidRows,
  INVALID_EXPECTATIONS,
  duplicateHaulerRows,
  OUT_DIR,
};
