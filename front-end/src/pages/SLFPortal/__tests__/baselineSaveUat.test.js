/**
 * UAT — Save Baseline Update, for everything the Accredited Haulers work changed.
 *
 * This is the acceptance test for the whole feature, and it deliberately runs
 * the FULL pipeline rather than any single layer:
 *
 *   real .xlsx bytes
 *     → the portal's parser + row validators        (uploadHelpers)
 *     → handleConfirmUpload's record builder        (mirrored, pinned below)
 *     → mergeHaulersByName                          (real)
 *     → the per-hauler client list upload           (real)
 *     → handleSaveBaselinePortal's payload builder  (mirrored, pinned below)
 *     → the SERVER's sanitizeAccreditedHaulers      (real, required from server/)
 *     → what Mongo would actually store
 *
 * WHY THE WHOLE CHAIN. Every layer in it is a WHITELIST — the submit cleaner,
 * the payload builder and the server sanitizer each rebuild the record field by
 * field. A field added at the top (Client Region / Province / City-Municipality)
 * is therefore silently dropped by any one of them that was not updated, and the
 * upload still reports success. Nothing short of end-to-end catches that: the
 * unit tests either side of a dropping layer both pass.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import * as XLSX from "xlsx";

import {
  UPLOAD_COLUMNS,
  getUploadMissingColumns,
  getUploadRowErrors,
  parseHaulerUploadRow,
  annotateHaulerUploadRows,
  parseUploadNumber,
  isEmptyUploadValue,
  cleanUploadText,
} from "../uploadHelpers.js";
import { mergeHaulersByName, cleanHaulerForSubmit } from "../haulerNormalization.js";
import {
  annotateClientUploadRows,
  mergeClientListUpload,
  parseClientUploadRow,
  CLIENT_UPLOAD_COLUMNS,
} from "../clientListUpload.js";
import { normalizeUnit } from "../helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..", "..", "..", "..", "..", "server");
const require = createRequire(pathToFileURL(path.join(serverRoot, "package.json")));

// The REAL server-side whitelist the payload has to survive.
const { sanitizeAccreditedHaulers, sanitizeClient } = require("./routes/dataSLF.js");

const UNIT = "m³";

// ── Mirror of index.jsx#handleConfirmUpload (uploadType "hauler") ────────────
const toHaulerRecords = (rows) =>
  rows.map((d) => ({
    key: d.key,
    haulerName: d.haulerName || "",
    numberOfTrucks: parseUploadNumber(d.numberOfTrucks),
    officeAddress: d.officeAddress || "",
    vehicles:
      d.plateNumber || d.vehicleType || !isEmptyUploadValue(d.capacity)
        ? [
            {
              plateNumber: d.plateNumber || "",
              vehicleType: d.vehicleType || "",
              capacity: parseUploadNumber(d.capacity),
              capacityUnit: d.capacityUnit || UNIT,
            },
          ]
        : [],
    privateSectorClients: (d.privateSectorClients || []).map((c, index) => ({
      key: `${d.key}-client-${index}`,
      clientName: c,
      clientType: d.clientType || "Private",
      clientAddress: d.clientAddress || "",
      regionName: d.clientRegion || "",
      provinceName: d.clientProvince || "",
      municipalityName: d.clientMunicipality || "",
    })),
  }));

// ── Mirror of index.jsx#handleSaveBaselinePortal's accreditedHaulers payload ──
// Note this path does NOT use cleanHaulerForSubmit — it strips `key` and sends
// the rest. Both shapes are exercised below, because the portal really does use
// two different builders (save vs. resubmit) and only one of them whitelists.
// The portal writes this as `({ key, ...rest }) => ...`, i.e. destructuring
// purely to OMIT `key`. `omitKey` is the same operation stated directly, which
// keeps the mirror equivalent without importing that lint pattern into a file
// whose whole job is to be trustworthy.
const omitKey = ({ key, ...rest }) => (key === undefined ? rest : rest);

const toSavePayload = (haulers, baselineUnit = UNIT) =>
  mergeHaulersByName(haulers, baselineUnit).map((hauler) => {
    const { vehicles, privateSectorClients, ...rest } = omitKey(hauler);
    return {
      ...rest,
      numberOfTrucks: rest.numberOfTrucks || vehicles?.length || 0,
      vehicles: (vehicles || []).map((vehicle) => {
        const clean = omitKey(vehicle);
        return { ...clean, capacityUnit: normalizeUnit(clean.capacityUnit || baselineUnit) };
      }),
      privateSectorClients: (privateSectorClients || []).map(omitKey),
    };
  });

// A file exercising every column, both row shapes, and both client types.
const UPLOAD_SHEET = () => {
  const row = (values) =>
    UPLOAD_COLUMNS.hauler.map((column) => values[column.field] ?? "");
  return [
    UPLOAD_COLUMNS.hauler.map((column) => column.label),
    row({
      haulerName: "UAT Hauling Services",
      numberOfTrucks: "2",
      officeAddress: "San Fernando, Pampanga",
      plateNumber: "UAT-0001",
      vehicleType: "Dump Truck",
      capacity: "15",
      capacityUnit: "m³",
      privateSectorClients: "UAT Manufacturing, UAT Foods",
      clientType: "Private",
      clientAddress: "San Fernando, Pampanga",
      clientRegion: "Region III (Central Luzon)",
      clientProvince: "Pampanga",
      clientMunicipality: "San Fernando",
    }),
    row({
      haulerName: "UAT Hauling Services",
      numberOfTrucks: "2",
      plateNumber: "UAT-0002",
      vehicleType: "Compactor",
      capacity: "12",
      capacityUnit: "m³",
    }),
    // Clients-only continuation row — no plate at all.
    row({
      haulerName: "UAT Hauling Services",
      numberOfTrucks: "2",
      privateSectorClients: "UAT Municipality",
      clientType: "LGU",
      clientAddress: "Baliuag, Bulacan",
      clientRegion: "Region III (Central Luzon)",
      clientProvince: "Bulacan",
      clientMunicipality: "Baliuag",
    }),
  ];
};

/** Real .xlsx bytes → the rows the portal's parser produces. */
const uploadThroughXlsx = (sheet) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet), "Haulers");
  const reread = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), {
    type: "buffer",
  });
  const raw = XLSX.utils
    .sheet_to_json(reread.Sheets[reread.SheetNames[0]], { defval: "" })
    .filter((r) => Object.values(r || {}).some((v) => cleanUploadText(v) !== ""));

  assert.deepEqual(getUploadMissingColumns(Object.keys(raw[0]), "hauler"), []);
  const parsed = raw.map((r, i) => {
    const row = { key: `u-${i}`, _rowNumber: i + 2, ...parseHaulerUploadRow(r, { fallbackUnit: UNIT }) };
    return { ...row, _errors: getUploadRowErrors(row, "hauler") };
  });
  assert.deepEqual(parsed.flatMap((r) => r._errors), [], "the UAT file must import cleanly");
  return annotateHaulerUploadRows(parsed, []);
};

const clientsOf = (hauler) => hauler.privateSectorClients;
const client = (hauler, name) => clientsOf(hauler).find((c) => c.clientName === name);

// ── UAT 1: bulk hauler upload → Save Baseline Update ────────────────────────
test("UAT — an uploaded hauler survives Save Baseline Update intact", () => {
  const rows = uploadThroughXlsx(UPLOAD_SHEET());
  const haulers = mergeHaulersByName(toHaulerRecords(rows), UNIT);
  assert.equal(haulers.length, 1, "three rows describe ONE hauler");

  const payload = toSavePayload(haulers);
  // …and through the server's own whitelist, which is the last thing standing
  // between the payload and the database.
  const stored = sanitizeAccreditedHaulers(payload, UNIT);

  assert.equal(stored.length, 1);
  const hauler = stored[0];
  assert.equal(hauler.haulerName, "UAT Hauling Services");
  assert.equal(hauler.numberOfTrucks, 2);
  assert.equal(hauler.officeAddress, "San Fernando, Pampanga");

  // Vehicles: two, and the clients-only row added no third.
  assert.equal(hauler.vehicles.length, 2, "the clients-only row must add no phantom vehicle");
  assert.deepEqual(
    hauler.vehicles.map((v) => [v.plateNumber, v.vehicleType, v.capacity, v.capacityUnit]),
    [
      ["UAT-0001", "Dump Truck", 15, "m³"],
      ["UAT-0002", "Compactor", 12, "m³"],
    ],
  );
  // Legacy top-level mirror of the first vehicle, which readers still use.
  assert.equal(hauler.plateNumber, "UAT-0001");
  assert.equal(hauler.capacity, 15);

  // THE POINT OF THIS TEST: the client location added by this work reaches the
  // database. Every layer above is a whitelist that could have dropped it.
  assert.equal(clientsOf(hauler).length, 3);
  const abc = client(hauler, "UAT Manufacturing");
  assert.equal(abc.clientType, "Private");
  assert.equal(abc.clientAddress, "San Fernando, Pampanga");
  assert.equal(abc.regionName, "Region III (Central Luzon)");
  assert.equal(abc.provinceName, "Pampanga");
  assert.equal(abc.municipalityName, "San Fernando");

  // The continuation row's own type and location apply to ITS client only.
  const lgu = client(hauler, "UAT Municipality");
  assert.equal(lgu.clientType, "LGU");
  assert.equal(lgu.provinceName, "Bulacan");
  assert.equal(lgu.municipalityName, "Baliuag");
  assert.equal(client(hauler, "UAT Foods").provinceName, "Pampanga");
});

test("UAT — the server does not consider a saved client incomplete", () => {
  // GET /hauler-clients flags a client with no clientType, provinceName or
  // municipalityName as `incomplete`. A save that dropped the location would
  // therefore show up on the ADMIN side as bad data, days later.
  const rows = uploadThroughXlsx(UPLOAD_SHEET());
  const stored = sanitizeAccreditedHaulers(
    toSavePayload(mergeHaulersByName(toHaulerRecords(rows), UNIT)),
    UNIT,
  );
  for (const c of clientsOf(stored[0])) {
    const incomplete = !c.clientType || !c.provinceName || !c.municipalityName;
    assert.equal(incomplete, false, `${c.clientName} would be reported incomplete`);
  }
});

test("UAT — Region 3 classification can still be computed from what was saved", () => {
  // classifyRegion reads the province NAME. Storing a PSGC code (or nothing)
  // would silently push every client into "outside Region 3" on the dashboard.
  const region3 = require("./utils/region3.js");
  const rows = uploadThroughXlsx(UPLOAD_SHEET());
  const stored = sanitizeAccreditedHaulers(
    toSavePayload(mergeHaulersByName(toHaulerRecords(rows), UNIT)),
    UNIT,
  );
  const provinceSet = new Set(["pampanga", "bulacan", "tarlac", "bataan", "zambales", "aurora", "nueva ecija"]);
  for (const c of clientsOf(stored[0])) {
    assert.equal(
      region3.classifyRegion({ province: c.provinceName, region: c.regionName }, provinceSet),
      region3.REGION_CLASS.WITHIN,
      `${c.clientName} must classify as within Region 3`,
    );
  }
});

// ── UAT 2: re-upload of an existing baseline (the update path) ──────────────
test("UAT — re-uploading over a saved baseline updates without losing anything", () => {
  const first = mergeHaulersByName(toHaulerRecords(uploadThroughXlsx(UPLOAD_SHEET())), UNIT);

  // A correction sheet: one hauler, one plate, a new capacity, nothing else.
  const correction = uploadThroughXlsx([
    UPLOAD_COLUMNS.hauler.map((c) => c.label),
    UPLOAD_COLUMNS.hauler.map((c) =>
      c.field === "haulerName"
        ? "UAT Hauling Services"
        : c.field === "numberOfTrucks"
          ? "2"
          : c.field === "plateNumber"
            ? "UAT-0001"
            : c.field === "capacity"
              ? "18"
              : c.field === "capacityUnit"
                ? "m³"
                : "",
    ),
  ]);

  const merged = mergeHaulersByName([...first, ...toHaulerRecords(correction)], UNIT);
  const stored = sanitizeAccreditedHaulers(toSavePayload(merged), UNIT);
  const hauler = stored[0];

  assert.equal(stored.length, 1, "no second hauler was created");
  assert.equal(hauler.vehicles.length, 2, "and no third vehicle");
  assert.equal(
    hauler.vehicles.find((v) => v.plateNumber === "UAT-0001").capacity,
    18,
    "the correction applied",
  );
  assert.equal(
    hauler.vehicles.find((v) => v.plateNumber === "UAT-0001").vehicleType,
    "Dump Truck",
    "…and the fields the sheet left blank survived",
  );
  assert.equal(hauler.officeAddress, "San Fernando, Pampanga");
  assert.equal(clientsOf(hauler).length, 3, "no client was dropped by a hauler-only correction");
  assert.equal(client(hauler, "UAT Manufacturing").provinceName, "Pampanga");
});

// ── UAT 3: per-hauler client list → Save Baseline Update ────────────────────
test("UAT — a per-hauler client list upload survives Save Baseline Update", () => {
  const baseline = mergeHaulersByName(toHaulerRecords(uploadThroughXlsx(UPLOAD_SHEET())), UNIT);
  const hauler = baseline[0];

  // The client sheet the panel reads: real bytes, no Hauler Name column.
  const sheet = [
    CLIENT_UPLOAD_COLUMNS.map((c) => c.label),
    // Updates an existing client's address only.
    ["UAT Manufacturing", "Private", "New Plant Road, San Fernando", "", "", ""],
    // Adds a new one, with the location the form would demand.
    ["UAT Logistics", "Private", "Malolos, Bulacan", "Region III (Central Luzon)", "Bulacan", "Malolos"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet), "Clients");
  const reread = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), {
    type: "buffer",
  });
  const raw = XLSX.utils.sheet_to_json(reread.Sheets[reread.SheetNames[0]], { defval: "" });

  const rows = annotateClientUploadRows(raw.map(parseClientUploadRow), hauler.privateSectorClients);
  assert.deepEqual(rows.flatMap((r) => r._errors), [], "the client sheet must validate");
  assert.deepEqual(rows.map((r) => r._status), ["update", "new"]);

  // Applied to the hauler draft, exactly as the panel does.
  const updatedHauler = {
    ...hauler,
    privateSectorClients: mergeClientListUpload(hauler.privateSectorClients, rows),
  };
  const stored = sanitizeAccreditedHaulers(toSavePayload([updatedHauler]), UNIT)[0];

  assert.equal(clientsOf(stored).length, 4, "3 existing + 1 added, none removed");
  const updated = client(stored, "UAT Manufacturing");
  assert.equal(updated.clientAddress, "New Plant Road, San Fernando", "the edit applied");
  assert.equal(updated.provinceName, "Pampanga", "…and the blank columns kept their stored values");
  assert.equal(updated.municipalityName, "San Fernando");

  const added = client(stored, "UAT Logistics");
  assert.equal(added.clientType, "Private");
  assert.equal(added.provinceName, "Bulacan");
  assert.equal(added.municipalityName, "Malolos");

  // The row keys the preview uses must never reach the database.
  for (const c of clientsOf(stored)) {
    assert.equal(Object.hasOwn(c, "key"), false, `${c.clientName} still carries a UI key`);
  }
});

// ── UAT 4: nothing internal leaks into the saved record ─────────────────────
test("UAT — no preview metadata is ever written to the baseline", () => {
  // The preview rows carry _rowNumber / _status / _errors / _duplicateOfRow.
  // Those are UI state; a save that persisted them would put junk in every
  // hauler document and in the admin's exports.
  const rows = uploadThroughXlsx(UPLOAD_SHEET());
  assert.ok(rows[0]._status, "the preview rows really do carry metadata");

  const stored = sanitizeAccreditedHaulers(
    toSavePayload(mergeHaulersByName(toHaulerRecords(rows), UNIT)),
    UNIT,
  );
  const leaked = (obj) => Object.keys(obj).filter((k) => k.startsWith("_") || k === "key");
  assert.deepEqual(leaked(stored[0]), []);
  stored[0].vehicles.forEach((v) => assert.deepEqual(leaked(v), []));
  clientsOf(stored[0]).forEach((c) => assert.deepEqual(leaked(c), []));
});

// ── UAT 5: the OTHER payload builder (resubmit) keeps the same fields ───────
test("UAT — the resubmit path keeps the client location too", () => {
  // index.jsx has TWO hauler payload builders: Save Baseline Update spreads the
  // record, and the reverted-entry resubmit runs cleanHaulerForSubmit — a
  // stricter whitelist. A field kept by one and dropped by the other would be
  // lost only for users correcting a reverted submission, which is the hardest
  // kind of bug to hear about.
  const rows = uploadThroughXlsx(UPLOAD_SHEET());
  const haulers = mergeHaulersByName(toHaulerRecords(rows), UNIT);
  const cleaned = haulers.map((h, i) => cleanHaulerForSubmit(h, i, UNIT));
  const stored = sanitizeAccreditedHaulers(cleaned, UNIT)[0];

  assert.equal(clientsOf(stored).length, 3);
  assert.equal(client(stored, "UAT Manufacturing").provinceName, "Pampanga");
  assert.equal(client(stored, "UAT Manufacturing").regionName, "Region III (Central Luzon)");
  assert.equal(client(stored, "UAT Municipality").municipalityName, "Baliuag");
  assert.equal(stored.vehicles.length, 2);
});

// ── UAT 6: the server sanitizer's own contract ─────────────────────────────
test("UAT — sanitizeClient keeps every field the portal now sends", () => {
  const sent = {
    clientName: "UAT Client",
    clientType: "LGU",
    clientAddress: "Somewhere",
    region: "030000000",
    regionName: "Region III (Central Luzon)",
    province: "031400000",
    provinceName: "Bulacan",
    municipality: "031405000",
    municipalityName: "Baliuag",
  };
  assert.deepEqual(sanitizeClient(sent), sent, "the server whitelist must not narrow this shape");
});
