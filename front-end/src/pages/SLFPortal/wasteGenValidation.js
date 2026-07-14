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
export function validateWasteGeneration(trucks) {
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
    if (isBlank(truck?.hauler)) issues.push(issue(t, "hauler", "Hauler is required."));
    if (isBlank(truck?.plateNumber)) issues.push(issue(t, "plateNumber", "Plate Number is required."));

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
