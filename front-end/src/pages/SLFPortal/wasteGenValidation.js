// Waste Generation Information — required-field rules for FINAL submission.
//
// Mirrors server/utils/wasteGenerationValidation.js (separate runtimes, identical
// rules). This copy exists so the Portal can highlight the offending fields and
// block the request BEFORE uploading. The SERVER copy is the one that actually
// enforces it — frontend validation alone is not security or data integrity.
//
// Drafts are deliberately NOT validated against these rules.

export const WASTE_GENERATION_TAB = "waste-generation-information";

// Blank: null, undefined, "", whitespace-only, or an empty array.
export function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// Valid, finite, > 0. Rejects "", "abc", NaN, Infinity, 0 and negatives.
export function isPositiveNumber(value) {
  if (isBlank(value)) return false;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0;
}

const isTreatedHazardous = (wasteType) =>
  String(wasteType || "").trim().toLowerCase() === "treated hazardous waste";

// A real cell index. NB: Number(null) === 0 and Number.isInteger(0) is true, so a
// naive check treats a MISSING cellIndex as the valid cell 0 — which let a truck
// with no disposal cell pass validation. Reject the empty values before coercing.
export function hasCellIndex(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0;
}

const issue = (truckIndex, field, message, vehicleIndex = null) => ({
  tab: WASTE_GENERATION_TAB,
  truckIndex,
  vehicleIndex,
  field,
  message,
});

/**
 * @returns {Array<{tab,truckIndex,vehicleIndex,field,message}>} empty when valid.
 */
export function validateWasteGeneration(trucks, options = {}) {
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
    if (isBlank(truck?.hauler)) issues.push(issue(t, "hauler", "Hauler is required."));
    if (isBlank(truck?.plateNumber)) issues.push(issue(t, "plateNumber", "Plate Number is required."));

    // Truck Capacity: OPTIONAL for manually-entered rows (missing historical
    // capacity is completed later via Organize Cells; a present value must be > 0),
    // but REQUIRED for UPLOADED rows (truck.entrySource === "upload") or when the
    // caller forces it. Mirrors server-side wasteGenerationValidation.js.
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

    if (vehicles.length > 0) {
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
      if (isBlank(truck?.wasteType)) issues.push(issue(t, "wasteType", "Waste Type is required."));
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
// Mirrors server/utils/wasteGenerationValidation.js. Enforced at FINAL submit on
// both runtimes; the server copy is authoritative.

// A truck's entered capacity may exceed its registered/declared capacity by at
// most 10% (measurement/loading tolerance). 1.10 = declared × 110%.
export const TRUCK_CAPACITY_ELEVATION_FACTOR = 1.1;

const normUnit = (u) => String(u || "").trim().replace("m3", "m³");

// Every transport-entry unit (truck + per-vehicle capacity/volume) must match the
// SLF's declared baseline unit. Mixed units silently distort every downstream
// total, so they are rejected rather than converted.
export function validateTransportUnits(trucks, baselineUnit) {
  const unit = normUnit(baselineUnit);
  if (!unit) return [];
  const list = Array.isArray(trucks) ? trucks : [];
  const issues = [];
  list.forEach((truck, t) => {
    const check = (value, field, vi = null) => {
      const u = normUnit(value);
      if (u && u !== unit) {
        issues.push(
          issue(t, field, `Unit must be ${unit} (your declared baseline unit).`, vi),
        );
      }
    };
    check(truck?.truckCapacityUnit, "truckCapacityUnit");
    check(truck?.actualVolumeUnit, "actualVolumeUnit");
    (Array.isArray(truck?.vehicles) ? truck.vehicles : []).forEach((v, vi) => {
      check(v?.capacityUnit, "capacityUnit", vi);
      check(v?.actualVolumeUnit, "actualVolumeUnit", vi);
    });
  });
  return issues;
}

// The entered truck/vehicle capacity may not exceed the declared (registered)
// capacity for that plate by more than 10%. `getDeclaredCapacity(hauler, plate)`
// returns the declared capacity (or null when unknown — unknown plates are not
// blocked here; required-field rules already cover missing data).
export function validateTruckCapacityElevation(trucks, getDeclaredCapacity) {
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
          `Truck Capacity ${entered} exceeds the maximum allowed ${Number(
            max.toFixed(2),
          )} (declared ${declared} + 10%).`,
          vi,
        ),
      );
    }
  };
  list.forEach((truck, t) => {
    const vehicles = Array.isArray(truck?.vehicles) ? truck.vehicles : [];
    if (vehicles.length > 0) {
      vehicles.forEach((v, vi) => {
        flag(t, vi, v?.capacity, getDeclaredCapacity(truck?.hauler, v?.plateNumber));
      });
    } else {
      flag(
        t,
        null,
        truck?.truckCapacity,
        getDeclaredCapacity(truck?.hauler, truck?.plateNumber),
      );
    }
  });
  return issues;
}

// Human-readable summary for the blocking dialog: "Truck 2 — Truck Capacity is required."
export function formatWasteGenIssues(issues, limit = 8) {
  const lines = issues.slice(0, limit).map((i) => {
    const where =
      i.truckIndex == null
        ? ""
        : `Truck ${i.truckIndex + 1}${i.vehicleIndex != null ? ` · Vehicle ${i.vehicleIndex + 1}` : ""} — `;
    return `${where}${i.message}`;
  });
  if (issues.length > limit) lines.push(`…and ${issues.length - limit} more.`);
  return lines;
}
