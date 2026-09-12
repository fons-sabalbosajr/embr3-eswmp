/**
 * Waste volume integrity — the value in the operator's Excel file is the value
 * the portal submits.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * The NUMBER was never the problem: a real .xlsx round-trips through
 * XLSX.read → sheet_to_json({defval:""}) → parseUploadNumber exactly, decimals
 * and all. The UNIT was.
 *
 * A waste volume is a number AND a unit, and with TON_PER_M3 = 0.5 a tons figure
 * read as m³ is an exact 2× error in every total, gauge and report — the digits
 * on screen never change while the quantity they claim doubles or halves.
 *
 * Three gaps let a bad unit through the disposal upload:
 *
 *   1. getUploadRowErrors validated the volume but NOT its unit (the hauler
 *      branch beside it always validated Capacity Unit). "MT", "kg", "cu.m",
 *      "cubic meters" imported with the row reporting "Ready".
 *   2. The parser normalized the unit with helpers#normalizeUnit — a display
 *      formatter that only rewrites "m3" → "m³" — so "Tons"/"M3"/"t" reached the
 *      submit gate uncanonicalized and were rejected as a mismatch against an
 *      IDENTICAL baseline unit.
 *   3. convertVolume() returns null for an unconvertible unit, and
 *      `null > maxAllowed` is false — so such a load passed the over-capacity
 *      gate unchecked, at any size.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

import {
  uploadHeaderKey,
  cleanUploadText,
  parseUploadNumber,
  normalizeUploadUnit,
  getUploadRowErrors,
  getUploadMissingColumns,
  UPLOAD_COLUMNS,
} from "../uploadHelpers.js";
import { validateTransportUnits } from "../wasteGenValidation.js";
import { convertVolume, normalizeUnit } from "../../../utils/volumeUnits.js";

const BASELINE = "m³";

// ── The production pipeline, Excel bytes → imported truck ────────────────────
// Mirrors index.jsx: handleExcelUpload (XLSX.read / sheet_to_json / the
// header→field chain) and handleConfirmUpload (the preview row → trucks[]).
const HEADERS = [
  "Disposal Date", "Hauler", "Client", "Waste Type", "Waste Volume",
  "Unit of Measurement", "Cell or Disposal Area", "Ticket Number",
  "Plate Number", "Truck Capacity",
];

function importWorkbook(dataRows, baselineUnit = BASELINE) {
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  // A REAL .xlsx byte stream, read back exactly as the browser reads it.
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const wb2 = XLSX.read(buf, { type: "array" });
  const ws2 = wb2.Sheets[wb2.SheetNames[0]];

  const jsonData = XLSX.utils
    .sheet_to_json(ws2, { defval: "" })
    .filter((row) => Object.values(row || {}).some((v) => cleanUploadText(v) !== ""));

  const col = (f) => UPLOAD_COLUMNS.truck.find((c) => c.field === f);
  const parsed = jsonData.map((row, i) => {
    const n = { key: `upload-${i}`, _rowNumber: i + 2 };
    for (const [key, value] of Object.entries(row)) {
      const k = uploadHeaderKey(key);
      if (col("disposalDate").matches(k)) n.disposalDate = cleanUploadText(value);
      else if (col("disposalTicketNo").matches(k)) n.disposalTicketNo = cleanUploadText(value);
      else if (col("hauler").matches(k)) n.hauler = cleanUploadText(value);
      else if (col("client").matches(k)) n.client = cleanUploadText(value);
      else if (k.includes("plate")) n.plateNumber = cleanUploadText(value);
      else if (k.includes("capacity") && !k.includes("unit")) n.truckCapacity = parseUploadNumber(value);
      else if (col("actualVolume").matches(k)) n.actualVolume = parseUploadNumber(value);
      else if (col("actualVolumeUnit").matches(k)) n.actualVolumeUnit = normalizeUploadUnit(value, baselineUnit);
      else if (col("cellName").matches(k)) n.cellName = cleanUploadText(value);
      else if (k.includes("waste") && k.includes("type")) n.wasteType = cleanUploadText(value);
    }
    return n;
  });

  // handleConfirmUpload — one preview row becomes one truck with one vehicle.
  const trucks = parsed.map((d) => ({
    disposalTicketNo: d.disposalTicketNo || "",
    plateNumber: d.plateNumber || "",
    truckCapacity: parseUploadNumber(d.truckCapacity),
    truckCapacityUnit: d.actualVolumeUnit || baselineUnit,
    vehicles: d.plateNumber
      ? [{
          plateNumber: d.plateNumber,
          capacity: parseUploadNumber(d.truckCapacity),
          capacityUnit: d.actualVolumeUnit || baselineUnit,
          actualVolume: parseUploadNumber(d.actualVolume),
          actualVolumeUnit: d.actualVolumeUnit || baselineUnit,
        }]
      : [],
    actualVolume: parseUploadNumber(d.actualVolume),
    actualVolumeUnit: d.actualVolumeUnit || baselineUnit,
  }));

  return { jsonData, parsed, trucks, errors: parsed.map((r) => getUploadRowErrors(r, "truck")) };
}

const rowFor = (volume, unit = "m3", i = 0) => [
  "2026-07-24", "XYZ Hauling", "ABC Mfg", "Residual", volume,
  unit, "Cell 1", `DT-${i}`, `ABC-${1000 + i}`, 2000000,
];

// ── 1. The number survives the round trip, exactly ───────────────────────────

test("Cases 1-5: the submitted volume equals the Excel volume", () => {
  const cases = [
    { name: "integer", excel: 100, expect: 100 },
    { name: "decimal", excel: 100.25, expect: 100.25 },
    { name: "trailing decimal precision", excel: 100.2500, expect: 100.25 },
    { name: "large value", excel: 1234567.89, expect: 1234567.89 },
    { name: "zero", excel: 0, expect: 0 },
  ];
  const { trucks } = importWorkbook(cases.map((c, i) => rowFor(c.excel, "m3", i)));
  cases.forEach((c, i) => {
    assert.equal(trucks[i].actualVolume, c.expect, `${c.name}: truck-level volume`);
    assert.equal(trucks[i].vehicles[0].actualVolume, c.expect, `${c.name}: vehicle-level volume`);
  });
});

test("a comma-formatted number keeps its value (1,234.56 is not 1)", () => {
  const { trucks } = importWorkbook([rowFor("1,234.56")]);
  assert.equal(trucks[0].actualVolume, 1234.56);
});

test("no rounding is applied — three decimals and sub-unit values survive", () => {
  const { trucks } = importWorkbook([rowFor(12.345, "m3", 0), rowFor(0.001, "m3", 1)]);
  assert.equal(trucks[0].actualVolume, 12.345, "not rounded to 12.35 or 12.34");
  assert.equal(trucks[1].actualVolume, 0.001, "not floored to 0");
});

test("Case 6: an empty volume cell becomes null and is rejected — never 0/NaN", () => {
  const { parsed, errors } = importWorkbook([rowFor("")]);
  assert.equal(parsed[0].actualVolume, null, "empty must not become 0");
  assert.ok(errors[0].some((e) => /Waste Volume/i.test(e)), "the blank row is flagged");
});

test("Case 7: a non-numeric volume is rejected, not coerced", () => {
  const { parsed, errors } = importWorkbook([rowFor("abc")]);
  assert.ok(Number.isNaN(parsed[0].actualVolume), "'abc' must not become a number");
  assert.ok(errors[0].length > 0, "the row is flagged");
});

test("Case 5: zero is flagged rather than silently submitted", () => {
  const { errors } = importWorkbook([rowFor(0)]);
  assert.ok(errors[0].some((e) => /greater than 0/i.test(e)));
});

test("Case 8: each row keeps its OWN volume — no shifting between rows", () => {
  const volumes = [11.1, 22.22, 33.333, 44, 55.5];
  const { trucks } = importWorkbook(volumes.map((v, i) => rowFor(v, "m3", i)));
  assert.equal(trucks.length, volumes.length);
  volumes.forEach((v, i) => {
    assert.equal(trucks[i].actualVolume, v, `row ${i} volume`);
    assert.equal(trucks[i].disposalTicketNo, `DT-${i}`, `row ${i} is still its own ticket`);
    assert.equal(trucks[i].plateNumber, `ABC-${1000 + i}`, `row ${i} is still its own plate`);
  });
});

test("Case 9: a second import does not alter the rows of the first", () => {
  const a = importWorkbook([rowFor(100, "m3", 0)]);
  const b = importWorkbook([rowFor(999, "m3", 0)]);
  assert.equal(a.trucks[0].actualVolume, 100, "the first import is untouched by the second");
  assert.equal(b.trucks[0].actualVolume, 999);
});

test("every required column is recognised, so no row is dropped for a header", () => {
  const { jsonData } = importWorkbook([rowFor(100)]);
  assert.deepEqual(getUploadMissingColumns(Object.keys(jsonData[0]), "truck"), []);
});

// ── 2. The unit is validated, because the unit is half of the volume ─────────

test("REGRESSION — an unconvertible Unit of Measurement is rejected at the preview", () => {
  // Each of these used to import with the row reporting "Ready", and was then
  // stored as m³ by the server — a 2× error for anything that meant tons.
  for (const unit of ["MT", "kg", "cu.m", "cubic meters", "liters"]) {
    const { errors } = importWorkbook([rowFor(100, unit)]);
    assert.ok(
      errors[0].some((e) => /Unit of Measurement/i.test(e)),
      `"${unit}" must be rejected, not imported`,
    );
  }
});

test("the rejection names the offending unit so the operator can fix the file", () => {
  const { errors } = importWorkbook([rowFor(100, "MT")]);
  assert.ok(errors[0].some((e) => e.includes("MT")), "the message quotes the value");
});

test("a legitimate unit spelling is ACCEPTED and canonicalized, not blocked", () => {
  // The other half of the bug: these are all real units the app can convert, and
  // they were being rejected as a mismatch against an identical baseline unit.
  for (const [written, canonical] of [
    ["tons", "tons"], ["Tons", "tons"], ["TONS", "tons"], ["ton", "tons"],
    ["tonnes", "tons"], ["t", "tons"], [" tons ", "tons"],
    ["m3", "m³"], ["m³", "m³"], ["M3", "m³"], ["M³", "m³"],
  ]) {
    const { parsed, errors } = importWorkbook([rowFor(100, written)], canonical);
    assert.equal(parsed[0].actualVolumeUnit, canonical, `"${written}" → ${canonical}`);
    assert.deepEqual(errors[0], [], `"${written}" must not be flagged`);
    assert.deepEqual(
      validateTransportUnits(
        [{ actualVolumeUnit: parsed[0].actualVolumeUnit, vehicles: [{ actualVolumeUnit: parsed[0].actualVolumeUnit }] }],
        canonical,
      ),
      [],
      `"${written}" must not be blocked at submit against a ${canonical} baseline`,
    );
  }
});

test("a GENUINE unit mismatch is still blocked at submit — never converted silently", () => {
  // tons vs m³ is a real disagreement. The app's documented rule is to reject it
  // rather than convert, so this must keep blocking.
  const issues = validateTransportUnits(
    [{ actualVolumeUnit: "tons", vehicles: [{ actualVolumeUnit: "tons" }] }],
    "m³",
  );
  assert.ok(issues.length > 0, "tons against an m³ baseline must block");
});

test("the 2x error this prevents is real at the configured factor", () => {
  // 100 tons is 200 m³. Storing "100" under the label m³ under-reports by half.
  assert.equal(convertVolume(100, "tons", "m³"), 200);
  assert.equal(convertVolume(100, "m³", "tons"), 50);
  assert.equal(normalizeUnit("MT"), "", "an unconvertible unit yields no canonical form");
  assert.equal(convertVolume(100, "MT", "m³"), null, "and cannot be converted at all");
});

// ── 3. The over-capacity gate is not bypassable by an unconvertible unit ─────

// index.jsx#evaluateCapacity, post-fix.
const evaluateCapacity = (actualVolume, actualVolumeUnit, capacity, capacityUnit, pct = 10) => {
  const cap = Number(capacity || 0);
  const vol = Number(actualVolume || 0);
  if (!(cap > 0) || !(vol > 0)) return { hasCapacity: cap > 0, exceeded: false, maxAllowed: null };
  const volInCapUnit = convertVolume(vol, actualVolumeUnit || capacityUnit, capacityUnit);
  const maxAllowed = cap + (cap * pct) / 100;
  if (volInCapUnit === null) return { hasCapacity: true, exceeded: false, unconvertible: true, maxAllowed };
  return { hasCapacity: true, exceeded: volInCapUnit > maxAllowed + 1e-9, maxAllowed };
};

test("REGRESSION — an unconvertible unit no longer passes the capacity gate", () => {
  // 10,000 against a capacity of 10 used to report exceeded:false, because
  // convertVolume returned null and `null > 11` is false.
  const result = evaluateCapacity(10000, "MT", 10, "m³");
  assert.equal(result.unconvertible, true, "it is reported as not comparable");
  assert.notEqual(result.exceeded, true, "and not mislabelled as an exceedance");
  // The caller blocks on `unconvertible || exceeded`, so the submission stops.
  assert.ok(result.unconvertible || result.exceeded, "the submission is blocked either way");
});

test("a convertible over-capacity load is still caught, and a normal one still passes", () => {
  assert.equal(evaluateCapacity(10000, "m³", 10, "m³").exceeded, true);
  assert.equal(evaluateCapacity(10, "m³", 10, "m³").exceeded, false, "exact match is not an exceedance");
  assert.equal(evaluateCapacity(11, "m³", 10, "m³").exceeded, false, "the 10% allowance still applies");
  assert.equal(evaluateCapacity(11.5, "m³", 10, "m³").exceeded, true);
  // Cross-unit comparison still works: 6 tons = 12 m³ against an 11 m³ ceiling.
  assert.equal(evaluateCapacity(6, "tons", 10, "m³").exceeded, true);
});

// ── 4. Backward compatibility ────────────────────────────────────────────────

test("Case 10: records already stored in a canonical unit are unaffected", () => {
  // An existing submission carries "tons" or "m³"/"m3" — all still valid, still
  // convertible, still comparable. Nothing about stored data changes.
  for (const unit of ["tons", "m³", "m3"]) {
    assert.notEqual(normalizeUnit(unit), "", `${unit} remains a known unit`);
    assert.deepEqual(
      validateTransportUnits([{ actualVolumeUnit: unit, vehicles: [] }], normalizeUnit(unit)),
      [],
      `a stored ${unit} record still validates`,
    );
  }
});

test("the hauler upload's own unit rule is untouched", () => {
  assert.deepEqual(
    getUploadRowErrors({ haulerName: "H", numberOfTrucks: 2, capacity: 10, capacityUnit: "m³" }, "hauler"),
    [],
  );
  assert.ok(
    getUploadRowErrors({ haulerName: "H", numberOfTrucks: 2, capacity: 10, capacityUnit: "kg" }, "hauler").length > 0,
  );
});
