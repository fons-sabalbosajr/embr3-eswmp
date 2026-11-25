// ── Volumes entered in another unit (tons → m³ and back) ──
//
// Some SLFs weigh trucks in tons but report in m³. The portal lets the operator
// type the weighed value and converts it with the system factor
// (1 m³ = 0.5 tons, utils/volumeUnits.js) before submitting. The record keeps
// BOTH: `actualVolume` in the SLF's unit, and `enteredVolume` +
// `enteredVolumeUnit` as weighed, for EMB to check.
//
// The server does not trust the client's arithmetic: whenever an entered value
// is present, `actualVolume` is recomputed from it here. An entered value in the
// SAME unit (or an unusable one) is not a conversion and is dropped.
const { convertVolume, normalizeUnit } = require("./volumeUnits");

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Recompute one row (a truck or a vehicle) from its entered value, in place.
 * @returns {boolean} true when the row carries a conversion
 */
function applyEnteredVolume(row) {
  if (!row || typeof row !== "object") return false;
  const hasEntered = row.enteredVolume !== undefined || row.enteredVolumeUnit !== undefined;
  if (!hasEntered) return false;
  const entered = Number(row.enteredVolume);
  const from = normalizeUnit(row.enteredVolumeUnit);
  const to = normalizeUnit(row.actualVolumeUnit);
  const converted = Number.isFinite(entered) && entered > 0 && from && to && from !== to
    ? convertVolume(entered, from, to)
    : null;
  if (converted === null) {
    delete row.enteredVolume;
    delete row.enteredVolumeUnit;
    return false;
  }
  row.enteredVolume = entered;
  row.enteredVolumeUnit = from;
  row.actualVolume = round3(converted);
  return true;
}

/**
 * Apply to a truck and its vehicles. When a vehicle was converted, the truck's
 * own total is re-derived from its vehicles so the two cannot disagree.
 */
function applyEnteredVolumesToTruck(truck) {
  if (!truck || typeof truck !== "object") return truck;
  const vehicles = Array.isArray(truck.vehicles) ? truck.vehicles : [];
  let anyVehicle = false;
  for (const vehicle of vehicles) {
    if (applyEnteredVolume(vehicle)) anyVehicle = true;
  }
  if (anyVehicle) {
    truck.actualVolume = round3(
      vehicles.reduce((sum, v) => sum + (Number.isFinite(Number(v?.actualVolume)) ? Number(v.actualVolume) : 0), 0),
    );
    // The truck's own entered value is the vehicles' — drop a stale one.
    delete truck.enteredVolume;
    delete truck.enteredVolumeUnit;
  } else {
    applyEnteredVolume(truck);
  }
  return truck;
}

module.exports = { applyEnteredVolume, applyEnteredVolumesToTruck };
