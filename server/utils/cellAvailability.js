// Backend mirror of front-end/src/utils/cellVisuals#getCellAcceptance.
// THE authoritative "can this cell accept new waste?" rule, re-checked on the
// server during submit / cell-assignment so a stale or concurrently-updated
// front-end cannot place waste into a full, completed, out-of-service, or
// nonexistent cell. Kept intentionally small and dependency-free.

// Single source of truth for the m³ ↔ tons factor (server/utils/volumeUnits.js).
const { TON_PER_M3, resolveCellUnit } = require("./volumeUnits");

function normUnit(u) {
  return String(u || "m³").replace("m3", "m³").trim().toLowerCase();
}

// Convert a volume between the two units the app uses (m³ ↔ tons). Unknown units
// pass through unchanged.
function toBaseM3(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return normUnit(unit) === "tons" ? n / TON_PER_M3 : n;
}

const NON_OPERATIONAL_RE =
  /(used|complete|closed|inactive|out.?of.?service|decommission|reserved|construction|not.?exist|full)/i;
const OPERATIONAL_RE = /(active|operational)/i;

function isOperationalStatus(status) {
  const s = String(status || "").trim();
  if (!s) return true; // blank legacy status defaults to operational
  if (OPERATIONAL_RE.test(s)) return true;
  return !NON_OPERATIONAL_RE.test(s);
}

function cellExists(cellIndex, facility) {
  if (cellIndex === null || cellIndex === undefined || cellIndex === "") return false;
  const idx = Number(cellIndex);
  if (!Number.isInteger(idx) || idx < 0) return false;
  const count = Math.max(
    Array.isArray(facility?.cellNames) ? facility.cellNames.length : 0,
    Array.isArray(facility?.cellStatuses) ? facility.cellStatuses.length : 0,
    Number(facility?.numberOfCell) || 0,
  );
  if (count > 0 && idx >= count) return false;
  const status = facility?.cellStatuses?.[idx];
  if (status && /not\s*exist/i.test(String(status))) return false;
  return true;
}

/**
 * Evaluate whether a facility cell can accept `proposedVolume` (in `unit`).
 * `facility` is an SlfFacility-like doc with cellStatuses / cellCapacities /
 * cellFillValues (+ optional per-cell unit arrays). All volumes are normalized to
 * m³ before comparison.
 * @returns {{ok:boolean, code:string, reason:string, remaining:number|null, utilization:number|null}}
 */
// Hazardous waste belongs in a hazardous cell and residual waste never does.
// The WASTE side uses the app's shared classifier (wasteCategories), which
// normalises legacy spellings ("HW", "hazardous_waste") first; the CELL side reads
// the admin's free-text cell type ("Treated Haz Waste", "Inert/Hazardous"). Same
// rule as the portal organizer (SLFPortal/organizeCellRules#wasteFitsCell).
const { isHazardousWasteType } = require("./wasteCategories");
const HAZ_CELL_RE = /haz|inert/i;
function wasteTypeFitsCell(wasteType, cellType) {
  return isHazardousWasteType(wasteType) === HAZ_CELL_RE.test(String(cellType || "Residual"));
}

/**
 * @param {object} [options]
 * @param {string} [options.wasteType] when given, the waste must fit the cell's
 *   type (code "type_mismatch").
 *
 * A cell an admin has CLOSED for submissions (`cellSubmissionAllowed[i] === false`)
 * is refused (code "locked") whenever the facility read carries that array. A
 * caller that does not project it is unaffected.
 */
function evaluateFacilityCellAcceptance(facility, cellIndex, proposedVolume = null, unit = "m³", options = {}) {
  const idx = Number(cellIndex);
  if (!cellExists(cellIndex, facility)) {
    return { ok: false, code: "missing", reason: "Selected cell no longer exists in the facility.", remaining: null, utilization: null };
  }
  const status = facility?.cellStatuses?.[idx];
  if (!isOperationalStatus(status)) {
    return { ok: false, code: "nonoperational", reason: `Cell is not operational (${status || "unknown"}).`, remaining: null, utilization: null };
  }
  if (facility?.cellSubmissionAllowed?.[idx] === false) {
    return { ok: false, code: "locked", reason: "This cell is closed for new waste by EMB.", remaining: null, utilization: null };
  }
  if (options.wasteType !== undefined && !wasteTypeFitsCell(options.wasteType, facility?.cellTypes?.[idx])) {
    const cellType = facility?.cellTypes?.[idx] || "Residual";
    return {
      ok: false,
      code: "type_mismatch",
      reason: `${options.wasteType || "Residual"} waste cannot go into a ${cellType} cell.`,
      remaining: null,
      utilization: null,
    };
  }
  // The same unit rule every screen uses (utils/cellCapacity.js). This used to
  // fall back to m³ for a cell with no unit of its own while the dashboards and
  // the schema fell back to tons — so the gate could judge a load against twice
  // the capacity the operator was shown.
  const capUnit = resolveCellUnit(facility, idx, "capacity");
  const fillUnit = resolveCellUnit(facility, idx, "fill");
  const cap = toBaseM3(facility?.cellCapacities?.[idx], capUnit);
  // Committed space = Waste in Cell (baseline + approved) + volume still pending
  // review. Pending left cellFillValues in occupancy calc v6 but must keep its
  // space, or several pending loads could each pass this gate and overfill the
  // cell once approved.
  const fill =
    toBaseM3(facility?.cellFillValues?.[idx], fillUnit) +
    (toBaseM3(facility?.cellFillPendingValues?.[idx], fillUnit) || 0);
  const hasCap = cap > 0;
  const remaining = hasCap ? Math.max(0, cap - fill) : null;
  const utilization = hasCap ? Math.round((fill / cap) * 10000) / 100 : null;

  if (hasCap && utilization >= 100) {
    return { ok: false, code: "full", reason: `Cell is full (${Math.round(utilization)}%).`, remaining, utilization };
  }
  if (hasCap && remaining <= 0) {
    return { ok: false, code: "full", reason: "Cell has no remaining capacity.", remaining, utilization };
  }
  if (proposedVolume != null && hasCap) {
    const pv = toBaseM3(proposedVolume, unit);
    if (Number.isFinite(pv) && pv > remaining + 1e-9) {
      return {
        ok: false,
        code: "insufficient",
        reason: `Proposed volume exceeds the cell's remaining capacity (${remaining.toFixed(2)} m³).`,
        remaining,
        utilization,
      };
    }
  }
  return { ok: true, code: "available", reason: "", remaining, utilization };
}

module.exports = {
  isOperationalStatus,
  cellExists,
  wasteTypeFitsCell,
  evaluateFacilityCellAcceptance,
  toBaseM3,
};
