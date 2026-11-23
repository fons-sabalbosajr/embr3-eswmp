/**
 * Baseline cell entries follow the unit the ADMIN declared for each cell.
 *
 * The defect this pins (live data, 2026-11): Floridablanca declares tons for the
 * facility and every cell, yet its baseline cells were stored as 430,738.41 m³
 * and 8,389.42 m³ — the operator picked m³ per entry. Portal and admin showed the
 * same cell in two units. Every save and read now converts into the cell's
 * declared unit; the conversion must preserve the QUANTITY (never relabel).
 *
 * Pure — no database. Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  declaredUnitForEntry,
  normalizeBaselineEntryUnits,
  sanitizeBaselineEntryExtras,
  prepareBaselineCellEntriesForSave,
  resolveBaselineCellEntriesForRead,
} = require("../utils/baselineCellEntries");
const { buildPortalReport } = require("../utils/portalReport");

const FLORIDABLANCA = {
  numberOfCell: 2,
  cellNames: ["Cell 1A", "Treated Hazardous Waste Cell (M501)"],
  cellStatuses: ["Active Cell", "Active Cell"],
  cellCapacityUnits: ["tons", "tons"],
  wasteReceivedUnit: "tons",
  volumeCapacityUnit: "tons",
};

// Facility declares tons, its cells m³ (General Tinio / Baler shape).
const MIXED = {
  numberOfCell: 2,
  cellNames: ["Cell 1", "Cell 2"],
  cellCapacityUnits: ["m³", "m³"],
  wasteReceivedUnit: "tons",
};

test("an m³ entry on a tons cell is CONVERTED, not relabelled", () => {
  const [row] = normalizeBaselineEntryUnits(
    [{ cellIndex: 0, cellName: "Cell 1A", volume: 430738.41, unit: "m³" }],
    FLORIDABLANCA,
  );
  assert.equal(row.unit, "tons");
  assert.equal(row.volume, 215369.205, "tons = m³ × 0.5");
});

test("the CELL's declared unit wins over the facility unit", () => {
  assert.equal(declaredUnitForEntry(MIXED, { cellIndex: 1 }), "m³");
  const [row] = normalizeBaselineEntryUnits([{ cellIndex: 1, volume: 9, unit: "tons" }], MIXED);
  assert.deepEqual([row.volume, row.unit], [18, "m³"]);
});

test("an unbound entry falls back to the facility's declared unit", () => {
  // Admin-set capacity units outrank the recompute-written wasteReceivedUnit.
  assert.equal(declaredUnitForEntry(MIXED, { cellIndex: null }), "m³");
  assert.equal(declaredUnitForEntry({ ...MIXED, volumeCapacityUnit: "tons" }, { cellIndex: null }), "tons");
});

test("already-correct rows keep object identity; unknown units are never guessed", () => {
  const ok = { cellIndex: 0, volume: 5, unit: "tons" };
  assert.equal(normalizeBaselineEntryUnits([ok], FLORIDABLANCA)[0], ok);
  const noUnit = { cellIndex: 0, volume: 5 };
  assert.equal(normalizeBaselineEntryUnits([noUnit], FLORIDABLANCA)[0], noUnit);
  const noFacility = [{ cellIndex: 0, volume: 5, unit: "m³" }];
  assert.equal(normalizeBaselineEntryUnits(noFacility, null), noFacility);
  // A facility that declares nothing at all is left alone too.
  const bare = { numberOfCell: 1 };
  assert.equal(normalizeBaselineEntryUnits(noFacility, bare)[0], noFacility[0]);
});

test("read path binds by name THEN converts", () => {
  const [row] = resolveBaselineCellEntriesForRead(
    [{ cellName: "Treated Hazardous Waste Cell (M501)", volume: 8389.42, unit: "m³" }],
    FLORIDABLANCA,
  );
  assert.equal(row.cellIndex, 1);
  assert.equal(row.unit, "tons");
  assert.equal(row.volume, 4194.71);
});

test("dateClosed is kept on closed cells only; future dates are dropped", () => {
  const future = new Date(Date.now() + 7 * 864e5).toISOString();
  const [closed, closedFuture] = sanitizeBaselineEntryExtras(
    [{ dateClosed: "2025-06-30" }, { dateClosed: future }],
    { closed: true },
  );
  assert.ok(closed.dateClosed instanceof Date);
  assert.equal(closedFuture.dateClosed, null);
  const [active] = sanitizeBaselineEntryExtras([{ dateClosed: "2025-06-30" }]);
  assert.equal("dateClosed" in active, false);
});

test("MOV attachments accept only app-produced links and are capped", () => {
  const [row] = sanitizeBaselineEntryExtras(
    [{
      movAttachments: [
        { url: "https://drive.google.com/file/d/abc123/view", name: "mov.pdf", size: 10 },
        { url: "/eswm-pipeline/api/upload/files/123-x.pdf", fileName: "local.pdf" },
        { url: "javascript:alert(1)" },
        { url: "https://evil.example/x.pdf" },
      ],
    }],
    { actor: "op@example.com" },
  );
  assert.equal(row.movAttachments.length, 2);
  assert.equal(row.movAttachments[0].fileName, "mov.pdf");
  assert.equal(row.movAttachments[0].uploadedBy, "op@example.com");
  const many = Array.from({ length: 30 }, (_, i) => ({ url: `https://drive.google.com/file/d/f${i}/view` }));
  const [capped] = sanitizeBaselineEntryExtras([{ movAttachments: many }]);
  assert.equal(capped.movAttachments.length, 20);
});

test("save path: extras + binding + unit in one pass", () => {
  const [row] = prepareBaselineCellEntriesForSave(
    [{ cellName: "Cell 1A", volume: 100, unit: "m³", dateClosed: "2024-01-01", movAttachments: [] }],
    FLORIDABLANCA,
    { closed: true },
  );
  assert.deepEqual([row.cellIndex, row.volume, row.unit], [0, 50, "tons"]);
  assert.ok(row.dateClosed instanceof Date);
});

test("portal report: per-day breakdown lists every submission and sums to the totals", () => {
  const sub = (idNo, day, status, volume) => ({
    idNo,
    status,
    dateOfDisposal: new Date(`${day}T00:00:00Z`),
    trucks: [{ hauler: "H", actualVolume: volume, actualVolumeUnit: "tons", wasteType: "Residual" }],
  });
  const report = buildPortalReport([
    sub("A", "2026-10-01", "acknowledged", 10),
    sub("B", "2026-10-01", "pending", 5),
    sub("C", "2026-10-15", "reverted", 99),
    sub("D", "2026-10-15", "acknowledged", 2),
  ]);
  assert.deepEqual(report.daily.map((d) => d.date), ["2026-10-01", "2026-10-15"]);
  const [oct1, oct15] = report.daily;
  assert.equal(oct1.submissions, 2);
  assert.equal(oct1.tons, 15);
  assert.equal(oct15.submissions, 2, "a reverted entry is still listed on its day");
  assert.equal(oct15.tons, 2, "…but adds no volume");
  assert.equal(oct15.items.find((i) => i.id === "C").tons, 0);
  const dailySum = report.daily.reduce((s, d) => s + d.tons, 0);
  assert.equal(dailySum, report.totals.totalTons, "days sum to the report total");
});

test("portal report: permits come from the admin's permit LISTS, newest first", () => {
  const report = buildPortalReport([], {
    facility: {
      lgu: "X",
      dischargePermit: "OLD",
      dischargePermits: [
        { permitNo: "DP-25", validity: new Date("2026-03-18"), status: "New" },
        { permitNo: "DP-26", validity: new Date("2027-01-25"), status: "Renewal", permitType: "Domestic" },
      ],
    },
  });
  assert.deepEqual(report.facility.dischargePermits.map((p) => p.permitNo), ["DP-26", "DP-25"]);
  assert.equal(report.facility.dischargePermits[0].permitType, "Domestic");
});
