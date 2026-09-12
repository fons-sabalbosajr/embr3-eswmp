/**
 * Report volume units — one unit per report, and that unit is TONS.
 *
 * ── The bugs this pins ──────────────────────────────────────────────────────
 *
 * `computeSlfMetrics` (server/models/DataSLF.js) stores every metric in BOTH
 * units, kept in lockstep via TON_PER_M3 = 0.5. One 1,000 m³ load is written as
 * `totalVolumeM3: 1000` AND `totalVolumeTons: 500` — the same waste twice, never
 * two quantities. Three places read that pair wrongly:
 *
 *   1. SlfSubmissionReport's company chart computed
 *      `_m3 + convertVolume(_tons, "tons", "m³")`, which is `m3 + m3` — every
 *      company's bar read exactly 2× its real volume.
 *   2. `formatVolume` printed both sides joined by " / " ("1,000 m³ / 500 t"),
 *      which under "Total Waste Volume" reads as a sum of 1,500.
 *   3. The portal report's Disposal Cells table was emitted in the FACILITY's
 *      unit while every other table in the same document was tons, so "Used"
 *      there disagreed with the same cell in "Disposal by Cell" by the factor.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { tonsFromMetricPair, convertVolume, TON_PER_M3 } from "../../utils/volumeUnits.js";
import { buildReportDocument } from "../SLFPortal/portalReportDocument.js";

// How computeSlfMetrics writes one load, whichever unit it arrived in.
const storeMetrics = (amount, unit) => ({
  m3: unit === "tons" ? amount / TON_PER_M3 : amount,
  tons: unit === "tons" ? amount : amount * TON_PER_M3,
});

test("the factor is the configured 0.5 — tons = m³ × 0.5", () => {
  assert.equal(TON_PER_M3, 0.5);
  assert.equal(convertVolume(1000, "m³", "tons"), 500);
  assert.equal(convertVolume(500, "tons", "m³"), 1000);
});

test("the metric pair reads as ONE tons figure, never a sum", () => {
  const stored = storeMetrics(1000, "m³");
  assert.deepEqual(stored, { m3: 1000, tons: 500 });
  assert.equal(tonsFromMetricPair(stored.m3, stored.tons), 500);
  // A tons-declared facility lands on the same figure from the other direction.
  const fromTons = storeMetrics(500, "tons");
  assert.equal(tonsFromMetricPair(fromTons.m3, fromTons.tons), 500);
});

test("REGRESSION — the company chart no longer doubles every volume", () => {
  const { m3, tons } = storeMetrics(1000, "m³");
  // The old line, preserved so the 2× can never quietly return.
  const old = (m3 || 0) + (convertVolume(tons || 0, "tons", "m³") || 0);
  assert.equal(old, 2000, "the old formula produced 2x");
  assert.equal(tonsFromMetricPair(m3, tons), 500, "the metric is 500 t (= 1000 m³)");
  assert.notEqual(tonsFromMetricPair(m3, tons), old);
});

test("legacy records with an unpopulated tons side still report their volume", () => {
  // Written before both units were stored: real m³, zero tons. Reading the tons
  // field alone would report the facility as having received nothing.
  assert.equal(tonsFromMetricPair(1000, 0), 500);
  assert.equal(tonsFromMetricPair(1000, undefined), 500);
  assert.equal(tonsFromMetricPair(1000, null), 500);
});

test("no waste is 0, and junk never becomes NaN on a report", () => {
  for (const [m3, tons] of [[0, 0], [null, null], [undefined, undefined], ["", ""], ["x", "y"], [-5, -5]]) {
    const v = tonsFromMetricPair(m3, tons);
    assert.ok(Number.isFinite(v), `${m3}/${tons} must be finite`);
    assert.equal(v, 0);
  }
});

test("precision is preserved — no rounding to whole tonnes", () => {
  assert.equal(tonsFromMetricPair(100.5, 0), 50.25);
  assert.equal(tonsFromMetricPair(0, 12.345), 12.345);
  assert.equal(tonsFromMetricPair(1, 0), 0.5, "a 1 m³ load is half a tonne, not 0");
});

// ── The portal PDF: every table in the SAME unit ─────────────────────────────

const REPORT = {
  totals: { submissions: 2, trucks: 3, totalTons: 30, residualTons: 24, hazardousTons: 6 },
  facility: { name: "Test Enviro Park", province: "Pampanga" },
  monthly: [],
  // The server now normalises these to tons before they leave buildPortalReport.
  cells: [
    { name: "Cell 4", type: "Residual", status: "Active Cell", unit: "tons",
      capacity: 500, fill: 125, remaining: 375, utilization: 25 },
  ],
  byWasteType: [], byHauler: [], byClient: [], byCell: [],
  outstanding: {},
};

test("REGRESSION — the Disposal Cells table is labelled in the report's unit", () => {
  const html = buildReportDocument(REPORT, { unitLabel: "tons", statusRows: [], formatDate: (v) => String(v ?? "") });
  assert.ok(html.includes("Capacity (tons)"), "capacity carries the report unit");
  assert.ok(html.includes("Used (tons)"), "used carries the report unit");
  assert.ok(html.includes("Remaining (tons)"), "remaining carries the report unit");
  // The m³ spelling must not appear anywhere in a tons report.
  assert.ok(!html.includes("m³"), "a tons report contains no m³ figures");
});

test("the cell figures themselves are unchanged — only the labelling moved", () => {
  const html = buildReportDocument(REPORT, { unitLabel: "tons", statusRows: [], formatDate: (v) => String(v ?? "") });
  assert.ok(html.includes("500"), "capacity");
  assert.ok(html.includes("125"), "used");
  assert.ok(html.includes("375"), "remaining");
  assert.ok(html.includes("25%"), "utilisation is a ratio and is unit-invariant");
});

test("the SCREEN's cells table carries the unit the same way the document does", () => {
  // The modal and the export are two renderers of one report, and the cells table
  // was the only place they disagreed: the document labelled the column while the
  // screen appended a per-row `r.unit` to every figure. Both now put it in the
  // header, so neither can imply this table is in a different unit than the rest.
  const src = readFileSync(
    new URL("../SLFPortal/PortalReportModal.jsx", import.meta.url),
    "utf8",
  );
  for (const column of ["Capacity", "Used", "Remaining"]) {
    assert.ok(
      src.includes(`title: \`${column} (\${unitLabel})\``),
      `${column} names its unit in the column header`,
    );
  }
  assert.ok(
    !/render: \(v, r\) => `\$\{num\(v\)\} \$\{r\.unit\}`/.test(src),
    "no figure re-states a per-row unit",
  );
});

test("the summary and per-cell tables agree on the unit", () => {
  const html = buildReportDocument(
    { ...REPORT, byCell: [{ name: "Cell 4", trips: 3, tons: 125 }] },
    { unitLabel: "tons", statusRows: [], formatDate: (v) => String(v ?? "") },
  );
  // "Disposal by Cell" reports Volume (tons); "Disposal Cells" reports Used
  // (tons). Both 125 for the same cell — before, one was 125 and the other 250.
  assert.ok(html.includes("Volume (tons)"), "the rank tables use the report unit");
  assert.ok(html.includes("Used (tons)"), "the cells table uses the same one");
});
