// THE single volume-unit conversion module for the server.
// Mirrors front-end/src/utils/volumeUnits.js (separate runtimes, identical rules).
//
// The declared unit is NOT a global setting: the "Set Field Units" tool stamps
// the chosen unit onto the SlfFacility record's own unit fields
// (wasteReceivedUnit, volumeCapacityUnit, cellCapacityUnits[], cellFillUnits[]).
// Submissions carry their own per-truck source unit (actualVolumeUnit). So a
// submission may be in m³ while its facility declares tons — normalizing that
// gap is what this module is for.

// m³ ↔ tons density factor: tons = m³ × TON_PER_M3, m³ = tons / TON_PER_M3.
// Per the configured business rule the factor is 0.50 (tons = m³ × 0.50, i.e.
// m³ = tons / 0.50). THIS is the single source of truth for the factor: the
// server model (DataSLF), the dataSLF route, and cellAvailability all import it
// from here rather than hardcoding, and the frontend mirrors the same value in
// front-end/src/utils/volumeUnits.js. Change it in these two places only.
const TON_PER_M3 = 0.5;

const M3 = "m³";
const TONS = "tons";
const VOLUME_UNITS = [M3, TONS];

function normalizeUnit(unit) {
  const u = String(unit ?? "").trim().toLowerCase().replace("m3", "m³");
  if (u === "m³") return M3;
  if (u === "ton" || u === "tons" || u === "tonnes" || u === "t") return TONS;
  return "";
}

function isKnownUnit(unit) {
  return normalizeUnit(unit) !== "";
}

// Returns `null` — never a silently wrong number — when the value isn't numeric
// or a unit is missing/unrecognised. This is what stops an unlabelled m³ value
// from being summed as tons (a multiple-x error at any factor).
function convertVolume(value, fromUnit, toUnit) {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return null;
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to) return null;
  if (n === 0) return 0;
  if (from === to) return n;
  if (from === TONS && to === M3) return n / TON_PER_M3;
  if (from === M3 && to === TONS) return n * TON_PER_M3;
  return null;
}

// Conversion plus an explicit reason, so a caller can flag/exclude a record
// instead of quietly mis-counting it.
function convertVolumeSafe({ value, fromUnit, toUnit }) {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
    return { value: null, ok: false, reason: "missing-value" };
  }
  if (!isKnownUnit(fromUnit)) return { value: null, ok: false, reason: "missing-source-unit" };
  if (!isKnownUnit(toUnit)) return { value: null, ok: false, reason: "missing-target-unit" };
  const converted = convertVolume(n, fromUnit, toUnit);
  if (converted === null) return { value: null, ok: false, reason: "unsupported-pair" };
  return { value: converted, ok: true, reason: null };
}

// The unit an SLF facility DECLARES. Same order as the front-end module and the
// occupancy recompute: admin-set capacity units first, `wasteReceivedUnit`
// (written by the recompute) after them.
function resolveFacilityUnit(facility, fallback = TONS) {
  const candidates = [
    facility?.volumeCapacityUnit,
    (facility?.cellCapacityUnits || []).find(Boolean),
    facility?.wasteReceivedUnit,
    facility?.receivingVolumeCapacityUnit,
    facility?.estimatedVolumeWasteUnit,
    facility?.baselineUnit,
    (facility?.cellFillUnits || []).find(Boolean),
  ];
  for (const c of candidates) {
    const u = normalizeUnit(c);
    if (u) return u;
  }
  // Default unit is TONS; m³ only when a facility is explicitly configured for it.
  return normalizeUnit(fallback) || TONS;
}

function resolveCellUnit(facility, index, kind = "capacity") {
  const arr = kind === "fill" ? facility?.cellFillUnits : facility?.cellCapacityUnits;
  return normalizeUnit(arr?.[index]) || resolveFacilityUnit(facility);
}

// Convert to m³ inside an aggregation pipeline, using the same factor.
// Yields null when the value isn't numeric, matching convertVolume().
function toM3Expr(valueExpr, unitExpr) {
  return {
    $let: {
      vars: { v: valueExpr, u: { $toLower: { $ifNull: [unitExpr, M3] } } },
      in: {
        $cond: [
          { $not: [{ $isNumber: "$$v" }] },
          null,
          { $cond: [{ $eq: ["$$u", TONS] }, { $divide: ["$$v", TON_PER_M3] }, "$$v"] },
        ],
      },
    },
  };
}

module.exports = {
  TON_PER_M3,
  M3,
  TONS,
  VOLUME_UNITS,
  normalizeUnit,
  isKnownUnit,
  convertVolume,
  convertVolumeSafe,
  resolveFacilityUnit,
  resolveCellUnit,
  toM3Expr,
};
