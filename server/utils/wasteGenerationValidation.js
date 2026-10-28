// Waste Generation Information — required-field rules for FINAL submission.
//
// This is the authoritative copy. front-end/src/pages/SLFPortal/wasteGenValidation.js
// mirrors it (separate runtimes) so the Portal can flag fields inline, but the
// Portal's copy is a convenience: THIS one is what actually blocks a submission.
// Frontend validation alone is not enough.
//
// Rules apply to FINAL submission only. Drafts intentionally allow incomplete work
// (see the draft workflow), and a scheduled submission is validated at the point it
// becomes eligible for final processing — not when it is queued.
//
// A truck reports its waste either directly (truck.actualVolume / truck.cellName)
// or through per-vehicle placements (truck.vehicles[].actualVolume / .cellName).
// Both shapes exist in the model, so both are accepted — but whichever shape a
// truck uses must be complete.

const TAB = "waste-generation-information";

// Blank means: null, undefined, "", or whitespace-only.
function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// A valid, positive, finite number. Rejects "", "abc", NaN, Infinity, 0 and negatives.
function isPositiveNumber(value) {
  if (isBlank(value)) return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

function isTreatedHazardous(wasteType) {
  return String(wasteType || "").trim().toLowerCase() === "treated hazardous waste";
}

// A real cell index. NB: Number(null) === 0 and Number.isInteger(0) is true, so a
// naive check treats a MISSING cellIndex as the valid cell 0 — which let a truck
// with no disposal cell pass validation. Reject the empty values before coercing.
function hasCellIndex(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0;
}

// Does this record (entry OR vehicle) carry a usable disposal cell? Twin of
// hasCellPlacement in front-end/src/pages/SLFPortal/cellPlacement.js.
function hasCellPlacement(record) {
  return !isBlank(record?.cellName) || hasCellIndex(record?.cellIndex);
}

const issue = (truckIndex, field, message, vehicleIndex = null) => ({
  tab: TAB,
  truckIndex,
  vehicleIndex,
  field,
  message,
});

/**
 * Validate the Waste Generation Information of one submission entry.
 * @returns {Array<{tab,truckIndex,vehicleIndex,field,message}>} empty when valid.
 */
function validateWasteGeneration(trucks, options = {}) {
  const list = Array.isArray(trucks) ? trucks : [];
  const issues = [];
  const forceRequireCapacity = options.requireTruckCapacity === true;

  if (list.length === 0) {
    issues.push(issue(null, "trucks", "At least one truck entry is required."));
    return issues;
  }

  list.forEach((truck, t) => {
    if (isBlank(truck?.disposalTicketNo)) {
      issues.push(issue(t, "disposalTicketNo", "Disposal Ticket No. is required."));
    }
    if (isBlank(truck?.hauler)) {
      issues.push(issue(t, "hauler", "Hauler is required."));
    }
    if (isBlank(truck?.plateNumber)) {
      issues.push(issue(t, "plateNumber", "Plate Number is required."));
    }
    // Truck Capacity rules:
    //   • MANUALLY-entered rows: optional at entry (missing historical capacity is
    //     completed later via Organize Cells). A present value must still be > 0.
    //   • UPLOADED rows (truck.entrySource === "upload") — or when the caller forces
    //     it via options.requireTruckCapacity: REQUIRED and > 0. Missing/null/zero/
    //     negative/invalid is rejected here (and by the upload parser).
    const isUploadedRow =
      String(truck?.entrySource || "").trim().toLowerCase() === "upload";
    if (forceRequireCapacity || isUploadedRow) {
      if (!isPositiveNumber(truck?.truckCapacity)) {
        issues.push(
          issue(
            t,
            "truckCapacity",
            isBlank(truck?.truckCapacity)
              ? "Truck Capacity is required."
              : "Truck Capacity must be a number greater than 0.",
          ),
        );
      }
    } else if (!isBlank(truck?.truckCapacity) && !isPositiveNumber(truck?.truckCapacity)) {
      issues.push(issue(t, "truckCapacity", "Truck Capacity must be a number greater than 0."));
    }

    const vehicles = Array.isArray(truck?.vehicles) ? truck.vehicles : [];
    // ── Which LEVEL does this truck report its load at? ───────────────────────
    //
    // The presence of a vehicle ROW used to be enough to say "per-vehicle", and
    // that is not the same question. A truck can carry a STUB vehicle — a row
    // holding a plate number and nothing else — while its actual load sits at the
    // truck level. Live example, the reverted SLF-LGU-PA-0016: the truck records
    // 3.1 m³ of Residual, and its single vehicle row has no volume, no waste type
    // and no cell. Validation took the per-vehicle branch and demanded all three
    // from the stub, so the operator was told to complete fields that had no
    // business existing — and placing a cell, which is what the message named,
    // could never clear it.
    //
    // It also disagreed with the rest of the system: hasTruckVolume(),
    // computeSlfMetrics() and the occupancy walk all read the truck level when the
    // vehicles carry nothing, so this record's 3.1 m³ was counted everywhere while
    // being rejected here.
    //
    // A vehicle counts as load-bearing when it carries a VOLUME or a WASTE TYPE.
    // Deliberately not its cell: entry→vehicle inheritance copies a cell onto
    // every stub, and treating that as "this vehicle reports its own load" would
    // re-create the same demand the moment a cell was placed.
    const vehicleCarriesLoad = (v) => !isBlank(v?.actualVolume) || !isBlank(v?.wasteType);
    const usesVehicles = vehicles.some(vehicleCarriesLoad);

    if (usesVehicles) {
      // Placement lives on each vehicle.
      vehicles.forEach((v, vi) => {
        if (!isPositiveNumber(v?.actualVolume)) {
          issues.push(issue(t, "actualVolume", "Actual Volume is required for every vehicle.", vi));
        }
        if (isBlank(v?.wasteType)) {
          issues.push(issue(t, "wasteType", "Waste Type is required for every vehicle.", vi));
        }
        // A vehicle with no cell of its own INHERITS the entry's placement.
        // sanitizeTrucksForSave materialises that inheritance before this runs, so
        // by the time a real submission reaches here the vehicle usually carries
        // its own copy — this accepts the entry's placement as well so the rule
        // holds for any caller, and so the portal's mirrored copy (which gates the
        // Review & Submit button) and this one can never disagree.
        if (!hasCellPlacement(v) && !hasCellPlacement(truck)) {
          issues.push(issue(t, "cellName", "Disposal Cell is required for every vehicle.", vi));
        }
        if (isTreatedHazardous(v?.wasteType) && isBlank(v?.hazWasteCode)) {
          issues.push(
            issue(t, "hazWasteCode", "Hazardous Waste Code is required for treated hazardous waste.", vi),
          );
        }
      });
    } else {
      if (!isPositiveNumber(truck?.actualVolume)) {
        issues.push(issue(t, "actualVolume", "Actual Volume is required."));
      }
      if (isBlank(truck?.wasteType)) {
        issues.push(issue(t, "wasteType", "Waste Type is required."));
      }
      if (isBlank(truck?.cellName) && !hasCellIndex(truck?.cellIndex)) {
        issues.push(issue(t, "cellName", "Disposal Cell is required."));
      }
      if (isTreatedHazardous(truck?.wasteType) && isBlank(truck?.hazWasteCode)) {
        issues.push(
          issue(t, "hazWasteCode", "Hazardous Waste Code is required for treated hazardous waste."),
        );
      }
    }
  });

  return issues;
}

// ── Declared baseline unit + truck-capacity elevation rules ──
// Mirrors front-end/src/pages/SLFPortal/wasteGenValidation.js. Authoritative copy.

// A truck's entered capacity may exceed its declared/registered capacity by at
// most 10% (measurement/loading tolerance).
const TRUCK_CAPACITY_ELEVATION_FACTOR = 1.1;

const normUnit = (u) => String(u || "").trim().replace("m3", "m³");

// Every transport-entry unit must match the SLF's declared baseline unit. Mixed
// units silently distort every downstream total, so they are rejected.
function validateTransportUnits(trucks, baselineUnit) {
  const unit = normUnit(baselineUnit);
  if (!unit) return [];
  const list = Array.isArray(trucks) ? trucks : [];
  const issues = [];
  list.forEach((truck, t) => {
    const check = (value, field, vi = null) => {
      const u = normUnit(value);
      if (u && u !== unit) {
        issues.push(issue(t, field, `Unit must be ${unit} (your declared baseline unit).`, vi));
      }
    };
    check(truck && truck.truckCapacityUnit, "truckCapacityUnit");
    check(truck && truck.actualVolumeUnit, "actualVolumeUnit");
    (Array.isArray(truck && truck.vehicles) ? truck.vehicles : []).forEach((v, vi) => {
      check(v && v.capacityUnit, "capacityUnit", vi);
      check(v && v.actualVolumeUnit, "actualVolumeUnit", vi);
    });
  });
  return issues;
}

// Largest capacity a waste-hauling truck can plausibly have, per unit. A figure
// above it is a capacity in the wrong unit, not a big truck: BESLF entered every
// capacity in KILOGRAMS under "tons" (5000 "tons" carrying 2.5 t loads), which
// the unit check cannot see because the label was right. No other facility's
// data comes near these limits (largest: 36 t, 32 m³).
const MAX_TRUCK_CAPACITY = { tons: 60, "m³": 120 };

function capacityMagnitudeMessage(value, unit) {
  const max = MAX_TRUCK_CAPACITY[unit];
  const hint = unit === "tons"
    ? ` If it is in kilograms, divide by 1,000 (e.g. ${Number(value).toLocaleString("en-US")} kg = ${Number(value) / 1000} tons).`
    : " If it is in litres, divide by 1,000 to get m³.";
  return `Truck Capacity ${value} ${unit} is not a realistic truck capacity (max ${max} ${unit}).${hint}`;
}

// A missing unit falls back to the declared baseline unit.
function checkCapacityMagnitude(value, unitRaw, baselineUnit) {
  if (!isPositiveNumber(value)) return null;
  const unit = normUnit(unitRaw || baselineUnit) === "tons" ? "tons" : "m³";
  return Number(value) > MAX_TRUCK_CAPACITY[unit] ? capacityMagnitudeMessage(value, unit) : null;
}

function validateCapacityMagnitude(trucks, baselineUnit) {
  const list = Array.isArray(trucks) ? trucks : [];
  const issues = [];
  list.forEach((truck, t) => {
    const msg = checkCapacityMagnitude(truck?.truckCapacity, truck?.truckCapacityUnit, baselineUnit);
    if (msg) issues.push(issue(t, "truckCapacity", msg));
    (Array.isArray(truck?.vehicles) ? truck.vehicles : []).forEach((v, vi) => {
      const vmsg = checkCapacityMagnitude(v?.capacity, v?.capacityUnit, baselineUnit);
      if (vmsg) issues.push(issue(t, "capacity", vmsg, vi));
    });
  });
  return issues;
}

// Same rule for the accredited-hauler fleet saved with the baseline.
function validateFleetCapacityMagnitude(haulers, baselineUnit) {
  const messages = [];
  (Array.isArray(haulers) ? haulers : []).forEach((h) => {
    (Array.isArray(h?.vehicles) ? h.vehicles : []).forEach((v) => {
      const msg = checkCapacityMagnitude(v?.capacity, v?.capacityUnit, baselineUnit);
      if (msg) messages.push(`${h?.haulerName || "Hauler"} / ${v?.plateNumber || "vehicle"}: ${msg}`);
    });
  });
  return messages;
}

// The entered truck/vehicle capacity may not exceed the declared capacity for
// that plate by more than 10%. `getDeclaredCapacity(hauler, plate)` returns the
// declared capacity, or a falsy value when unknown (unknown plates are skipped).
function validateTruckCapacityElevation(trucks, getDeclaredCapacity) {
  const list = Array.isArray(trucks) ? trucks : [];
  const issues = [];
  const flag = (t, vi, entered, declared) => {
    if (!isPositiveNumber(declared) || !isPositiveNumber(entered)) return;
    const max = Number(declared) * TRUCK_CAPACITY_ELEVATION_FACTOR;
    if (Number(entered) > max + 1e-9) {
      issues.push(
        issue(
          t,
          "truckCapacity",
          `Truck Capacity ${entered} exceeds the maximum allowed ${Number(max.toFixed(2))} (declared ${declared} + 10%).`,
          vi,
        ),
      );
    }
  };
  list.forEach((truck, t) => {
    const vehicles = Array.isArray(truck && truck.vehicles) ? truck.vehicles : [];
    if (vehicles.length > 0) {
      vehicles.forEach((v, vi) => {
        flag(t, vi, v && v.capacity, getDeclaredCapacity(truck && truck.hauler, v && v.plateNumber));
      });
    } else {
      flag(t, null, truck && truck.truckCapacity, getDeclaredCapacity(truck && truck.hauler, truck && truck.plateNumber));
    }
  });
  return issues;
}

module.exports = {
  WASTE_GENERATION_TAB: TAB,
  TRUCK_CAPACITY_ELEVATION_FACTOR,
  MAX_TRUCK_CAPACITY,
  validateCapacityMagnitude,
  validateFleetCapacityMagnitude,
  isBlank,
  isPositiveNumber,
  validateWasteGeneration,
  validateTransportUnits,
  validateTruckCapacityElevation,
};
