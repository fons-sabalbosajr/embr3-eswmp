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
    const usesVehicles = vehicles.length > 0;

    if (usesVehicles) {
      // Placement lives on each vehicle.
      vehicles.forEach((v, vi) => {
        if (!isPositiveNumber(v?.actualVolume)) {
          issues.push(issue(t, "actualVolume", "Actual Volume is required for every vehicle.", vi));
        }
        if (isBlank(v?.wasteType)) {
          issues.push(issue(t, "wasteType", "Waste Type is required for every vehicle.", vi));
        }
        if (isBlank(v?.cellName) && !hasCellIndex(v?.cellIndex)) {
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
  isBlank,
  isPositiveNumber,
  validateWasteGeneration,
  validateTransportUnits,
  validateTruckCapacityElevation,
};
