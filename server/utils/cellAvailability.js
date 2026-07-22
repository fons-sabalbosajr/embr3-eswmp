// Backend mirror of front-end/src/utils/cellVisuals#getCellAcceptance.
// THE authoritative "can this cell accept new waste?" rule, re-checked on the
// server during submit / cell-assignment so a stale or concurrently-updated
// front-end cannot place waste into a full, completed, out-of-service, or
// nonexistent cell. Kept intentionally small and dependency-free.

const TON_PER_M3 = 0.2;

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
function evaluateFacilityCellAcceptance(facility, cellIndex, proposedVolume = null, unit = "m³") {
  const idx = Number(cellIndex);
  if (!cellExists(cellIndex, facility)) {
    return { ok: false, code: "missing", reason: "Selected cell no longer exists in the facility.", remaining: null, utilization: null };
  }
  const status = facility?.cellStatuses?.[idx];
  if (!isOperationalStatus(status)) {
    return { ok: false, code: "nonoperational", reason: `Cell is not operational (${status || "unknown"}).`, remaining: null, utilization: null };
  }
  const capUnit = facility?.cellCapacityUnits?.[idx] || facility?.volumeCapacityUnit || "m³";
  const fillUnit = facility?.cellFillUnits?.[idx] || facility?.wasteReceivedUnit || capUnit;
  const cap = toBaseM3(facility?.cellCapacities?.[idx], capUnit);
  const fill = toBaseM3(facility?.cellFillValues?.[idx], fillUnit);
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
  evaluateFacilityCellAcceptance,
  toBaseM3,
};
