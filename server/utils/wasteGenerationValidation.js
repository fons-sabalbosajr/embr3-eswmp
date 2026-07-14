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
function validateWasteGeneration(trucks) {
  const list = Array.isArray(trucks) ? trucks : [];
  const issues = [];

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
    // Truck Capacity — previously optional; now required for final submission.
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

module.exports = {
  WASTE_GENERATION_TAB: TAB,
  isBlank,
  isPositiveNumber,
  validateWasteGeneration,
};
