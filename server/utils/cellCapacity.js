/**
 * THE per-cell capacity rule — capacity, Waste in Cell, remaining and % used —
 * for every server reader (the submit capacity gate, the admin rollups, the
 * portal report, VERA's facts).
 *
 * Mirrored exactly by front-end/src/utils/cellCapacity.js, which every admin and
 * portal screen reads. Change both together: tests/cellCapacityUniform.test.js
 * runs the same cases through each.
 *
 * Why it exists: each reader resolved a cell's units its own way. When a cell
 * had no unit of its own, the capacity gate assumed m³, the portal report and
 * VERA assumed m³, the schema and the dashboards assumed tons — so the same cell
 * could be judged against a capacity twice (or half) the one on screen. And the
 * percentage was rounded differently on every screen (64%, 64.3%, 64.29%).
 *
 * The rule:
 *   • capacity unit  = resolveCellUnit(facility, i, "capacity") — the cell's own
 *                      declared unit, else the facility's declared unit
 *   • fill unit      = resolveCellUnit(facility, i, "fill")
 *   • used / pending = the stored fill converted INTO the capacity unit
 *   • % used         = cellPercent(used, capacity) — a whole number, 100 only
 *                      when the cell is actually full
 *   • remaining      = capacity − used, never below 0
 */
const { convertVolume, normalizeUnit, resolveCellUnit } = require("./volumeUnits");

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * % of a cell's capacity in use, as a whole number.
 * null when the cell has no capacity. Never reads 100 unless the cell is full,
 * and never exceeds 100 (over-capacity is reported by `over`, not the %).
 */
function cellPercent(used, capacity) {
  const cap = Number(capacity);
  if (!Number.isFinite(cap) || cap <= 0) return null;
  const value = Math.max(0, finite(used));
  if (value >= cap) return 100;
  return Math.min(99, Math.round((value / cap) * 100));
}

/** Number of cell slots a facility record describes. */
function cellCount(facility) {
  return Math.max(
    finite(facility?.numberOfCell),
    facility?.cellCapacities?.length || 0,
    facility?.cellFillValues?.length || 0,
    facility?.cellStatuses?.length || 0,
    facility?.cellNames?.length || 0,
  );
}

/**
 * One cell's figures from the facility record, in `unit` when given (and
 * convertible), else in the cell's own capacity unit.
 */
function cellCapacityRow(facility, index, { unit } = {}) {
  const capacityUnit = resolveCellUnit(facility, index, "capacity");
  const fillUnit = resolveCellUnit(facility, index, "fill");
  const target = normalizeUnit(unit) || capacityUnit;
  const rawCapacity = finite(facility?.cellCapacities?.[index]);
  const rawFill = facility?.cellFillValues?.[index];
  const rawPending = facility?.cellFillPendingValues?.[index];
  const capacity = convertVolume(rawCapacity, capacityUnit, target) ?? 0;
  const used = convertVolume(finite(rawFill), fillUnit, target) ?? 0;
  const pending = convertVolume(finite(rawPending), fillUnit, target) ?? 0;
  return {
    index,
    unit: target,
    capacityUnit,
    fillUnit,
    capacity,
    used,
    pending,
    hasCapacity: capacity > 0,
    hasFill: rawFill !== null && rawFill !== undefined && rawFill !== "",
    pct: cellPercent(used, capacity),
    remaining: capacity > 0 ? Math.max(0, capacity - used) : null,
    over: capacity > 0 && used > capacity ? used - capacity : 0,
  };
}

/** Every cell of a facility, all in the same `unit` when one is given. */
function facilityCellCapacityRows(facility, options = {}) {
  return Array.from({ length: cellCount(facility) }, (_, index) => cellCapacityRow(facility, index, options));
}

module.exports = { cellPercent, cellCount, cellCapacityRow, facilityCellCapacityRows };
