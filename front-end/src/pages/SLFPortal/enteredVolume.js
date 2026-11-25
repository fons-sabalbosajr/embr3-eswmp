// ── Volumes weighed in another unit (pure, unit-tested) ──
//
// Some SLFs weigh trucks in tons but report in m³ (or the reverse). The portal
// takes the value as weighed and converts it with the system factor
// (1 m³ = 0.5 tons — utils/volumeUnits.js), so the entry is saved in the SLF's
// unit. The original stays on the row as `enteredVolume` + `enteredVolumeUnit`
// for EMB to check; the server recomputes the conversion from it on save
// (server/utils/enteredVolume.js).
import { TON_PER_M3, convertVolume, normalizeUnit } from "../../utils/volumeUnits.js";

const round3 = (n) => Math.round(n * 1000) / 1000;

/** The unit an operator might weigh in instead of the SLF's own. */
export function otherUnit(slfUnit) {
  return normalizeUnit(slfUnit) === "tons" ? "m³" : "tons";
}

/** `value` in `fromUnit`, converted to `toUnit`, rounded; null when it cannot be. */
export function convertEntered(value, fromUnit, toUnit) {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n) || n <= 0) return null;
  const converted = convertVolume(n, fromUnit, toUnit);
  return converted === null ? null : round3(converted);
}

/**
 * The patch for a row whose volume was weighed in `fromUnit` at an SLF that
 * reports in `slfUnit`. Same unit → a plain volume, no conversion kept.
 */
export function enteredVolumePatch(value, fromUnit, slfUnit) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(slfUnit);
  if (!from || !to || from === to) {
    return { actualVolume: value, enteredVolume: undefined, enteredVolumeUnit: undefined };
  }
  const converted = convertEntered(value, from, to);
  return {
    actualVolume: converted,
    enteredVolume: converted === null ? undefined : Number(value),
    enteredVolumeUnit: converted === null ? undefined : from,
  };
}

/** "12.5 tons → 25 m³" for a converted row, or "" when there is no conversion. */
export function describeConversion(row, slfUnit) {
  const from = normalizeUnit(row?.enteredVolumeUnit);
  const to = normalizeUnit(row?.actualVolumeUnit || slfUnit);
  if (!from || !to || from === to || row?.enteredVolume == null) return "";
  const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return `${fmt(row.enteredVolume)} ${from} → ${fmt(row.actualVolume)} ${to}`;
}

/** How the factor reads for the SLF's unit, e.g. "m³ = tons ÷ 0.5". */
export function factorText(slfUnit) {
  return normalizeUnit(slfUnit) === "tons"
    ? `tons = m³ × ${TON_PER_M3}`
    : `m³ = tons ÷ ${TON_PER_M3}`;
}

/**
 * An uploaded disposal row in the file's unit → the SLF's unit. Volume and
 * truck capacity are converted; the volume as weighed is kept. Rows already in
 * the SLF's unit, or in a unit that cannot be converted, come back unchanged.
 */
export function uploadRowToSlfUnit(row, slfUnit) {
  const from = normalizeUnit(row?.actualVolumeUnit);
  const to = normalizeUnit(slfUnit);
  if (!from || !to || from === to) return row;
  const volume = convertEntered(row.actualVolume, from, to);
  if (volume === null) return row;
  const capacity = convertEntered(row.truckCapacity, from, to);
  return {
    ...row,
    actualVolume: volume,
    actualVolumeUnit: to,
    truckCapacity: capacity === null ? row.truckCapacity : capacity,
    enteredVolume: Number(row.actualVolume),
    enteredVolumeUnit: from,
  };
}
