// THE single volume-unit conversion module for the admin + portal frontend.
//
// Before this existed, `convertVolume` was copy-pasted into five components
// (SLFMonitoring helpers, SubmissionSummary, SLFPortal, CellWastePlacement,
// DummyCellPlacementModal) plus an inline `/0.2` in SlfSubmissionReport — and
// they DISAGREED: some defaulted a missing source unit to "tons", others to
// "m³". Since the factor is 0.2, guessing wrong is a 25× error. Everything now
// routes through here.
//
// Where the units come from (the "Set Field Units" tool):
//   Set Field Units does not write a global config — it stamps the chosen unit
//   onto the SlfFacility record's own unit fields (volumeCapacityUnit,
//   wasteReceivedUnit, cellCapacityUnits[], cellFillUnits[], …). So the DECLARED
//   unit is per-facility and lives on the facility document. `resolveFacilityUnit`
//   below reads it from exactly those fields, in the order the app already uses.
//
// Submissions carry their OWN source unit per truck/vehicle
// (actualVolumeUnit). A submission may therefore be in m³ while the facility
// declares tons — that is the case this module exists to normalize.

// m³ ↔ tons density factor. 1 m³ of waste ≈ 0.2 tons.
// Mirrored server-side by DataSLF.TON_PER_M3 / server/utils/volumeUnits.js.
export const TON_PER_M3 = 0.2;

export const M3 = "m³";
export const TONS = "tons";
export const VOLUME_UNITS = [M3, TONS];
export const UNIT_OPTIONS = VOLUME_UNITS.map((value) => ({ label: value, value }));

// "m3" is stored by older records/enums; fold it onto the canonical "m³".
export function normalizeUnit(unit) {
  const u = String(unit ?? "").trim().toLowerCase().replace("m3", "m³");
  if (u === "m³") return M3;
  if (u === "ton" || u === "tons" || u === "tonnes" || u === "t") return TONS;
  return "";
}

// True when the unit is one we can actually convert.
export function isKnownUnit(unit) {
  return normalizeUnit(unit) !== "";
}

// Convert between the configured volume units.
//
// Returns `null` — never a silently wrong number — when the value isn't numeric
// or either unit is missing/unrecognised. Callers that need a number must decide
// what to do with an unconvertible record (flag it / exclude it), which is what
// `convertVolumeSafe` below makes explicit. This is the rule that stops an
// unlabelled m³ value from being counted as tons.
export function convertVolume(value, fromUnit, toUnit) {
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

// Conversion + an explicit reason when it can't be done, so a caller can flag or
// exclude the record instead of quietly mis-counting it.
//
//   { value, ok, reason }   reason ∈ null | "missing-value" | "missing-source-unit"
//                                    | "missing-target-unit" | "unsupported-pair"
export function convertVolumeSafe({ value, fromUnit, toUnit }) {
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

export const CONVERSION_WARNINGS = {
  "missing-value": "No volume recorded.",
  "missing-source-unit": "Submitted volume has no unit — it cannot be safely converted, so it is excluded from capacity totals.",
  "missing-target-unit": "This SLF has no declared unit — set one with “Set Field Units”.",
  "unsupported-pair": "Volume is recorded in a unit this system cannot convert.",
};

// The unit an SLF facility DECLARES, per the fields "Set Field Units" writes.
// Order mirrors the precedence the app already used (wasteReceivedUnit first).
// Falls back to m³ only when the facility declares nothing at all.
export function resolveFacilityUnit(facility, fallback = M3) {
  const candidates = [
    facility?.wasteReceivedUnit,
    facility?.volumeCapacityUnit,
    facility?.receivingVolumeCapacityUnit,
    facility?.estimatedVolumeWasteUnit,
    facility?.baselineUnit,
    (facility?.cellCapacityUnits || []).find(Boolean),
    (facility?.cellFillUnits || []).find(Boolean),
  ];
  for (const c of candidates) {
    const u = normalizeUnit(c);
    if (u) return u;
  }
  return normalizeUnit(fallback) || M3;
}

// The declared unit for a single cell, falling back to the facility's unit.
export function resolveCellUnit(facility, index, kind = "capacity") {
  const arr = kind === "fill" ? facility?.cellFillUnits : facility?.cellCapacityUnits;
  return normalizeUnit(arr?.[index]) || resolveFacilityUnit(facility);
}

// Format a normalized value for display. Formatting only — never converts.
export function formatVolume(value, unit, { maximumFractionDigits = 2 } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits })} ${normalizeUnit(unit) || ""}`.trim();
}

// THE single volume-vs-capacity comparison — reuse everywhere a truck/vehicle's
// actual volume is judged against its capacity, so colours and thresholds never
// disagree. Units are normalized (volume → capacity's unit) before comparing;
// mismatched/missing units or capacity yield `comparable: false` so the caller can
// fall back to a neutral colour instead of a misleading one.
//
// Thresholds (per spec):
//   • < 90%           → green
//   • 90% ‥ 100%      → orange (inclusive of 100)
//   • > 100%          → red
export const CAPACITY_STATUS_COLORS = {
  ok: "#52c41a",
  warn: "#fa8c16",
  over: "#ff4d4f",
  unknown: undefined,
};
export function volumeCapacityStatus({ actualVolume, actualVolumeUnit, capacity, capacityUnit }) {
  const cap = Number(capacity);
  const toUnit = normalizeUnit(capacityUnit) || normalizeUnit(actualVolumeUnit);
  const fromUnit = normalizeUnit(actualVolumeUnit) || toUnit;
  const vol = convertVolume(actualVolume, fromUnit, toUnit);
  if (!Number.isFinite(cap) || cap <= 0 || vol === null || !Number.isFinite(vol)) {
    return { comparable: false, percent: null, level: "unknown", color: CAPACITY_STATUS_COLORS.unknown };
  }
  const percent = (vol / cap) * 100;
  const level = percent > 100 ? "over" : percent >= 90 ? "warn" : "ok";
  return { comparable: true, percent, level, color: CAPACITY_STATUS_COLORS[level] };
}
