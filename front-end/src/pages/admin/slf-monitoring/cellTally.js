// Where each cell's Waste in Cell comes from, as TWO parts that always add up to
// the figure shown — the rule every SLF Data Table view uses, so the gauge, the
// numbers under it, the per-cell table and the facility totals cannot disagree.
//
// Rows are the server rollup's per-cell rows (usageFromOccupancy in
// SlfDashboardTab), all in ONE unit:
//   • a derived cell:          baseline + submitted              = total
//   • an admin-declared cell:  declared base + submitted SINCE    = total
//
// The second case is why this exists. The table used to print the raw baseline
// and the raw submitted volume beside an admin-declared total, so the columns did
// not add up on Limay, Porac and General Tinio (each has a declared cell) and the
// facility line "Baseline X / Submissions +Y" disagreed with the cells.

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** @returns {{ baseline: number, submitted: number, total: number, declared: boolean }} */
export function cellTally(row = {}) {
  const total = num(row.total);
  if (row.overridden) {
    const submitted = num(row.postOverrideSubmitted);
    // A cell declared before declarations were dated has no recorded base: the
    // whole figure IS the declaration.
    const baseline =
      row.overrideBase !== undefined && row.overrideBase !== null
        ? num(row.overrideBase)
        : Math.max(0, total - submitted);
    return { baseline, submitted, total, declared: true };
  }
  return { baseline: num(row.baseline), submitted: num(row.submissions), total, declared: false };
}

/** A cell as GET /data-slf/cell-occupancy returns it, in the shape cellTally reads. */
export const fromOccupancyCell = (c = {}) => ({
  baseline: c.baselineUsed,
  submissions: c.submittedUsed,
  total: c.used,
  overridden: !!c.overridden,
  overrideBase: c.overrideBase,
  postOverrideSubmitted: c.postOverrideSubmitted,
});

/**
 * Facility totals from the same per-cell parts, plus the volume received but
 * not yet organized into any cell.
 */
export function facilityTally(rows = [], unplaced = 0) {
  const sum = { baseline: 0, submitted: 0, inCells: 0, declaredCells: 0 };
  for (const row of rows) {
    const t = cellTally(row);
    sum.baseline += t.baseline;
    sum.submitted += t.submitted;
    sum.inCells += t.total;
    if (t.declared) sum.declaredCells += 1;
  }
  const awaiting = Math.max(0, num(unplaced));
  return { ...sum, unplaced: awaiting, received: sum.inCells + awaiting };
}

/**
 * The Waste in Cell values the SLF edit form should send as DECLARATIONS.
 *
 * The form's inputs are pre-filled with each cell's DERIVED figure, and the
 * server treats every non-blank value sent with `cellFillValuesDeclared` as an
 * admin declaration. Sending the form back unchanged therefore froze every
 * cell's current total as an admin base on any save — an edit to a permit was
 * enough. Only two kinds of cell are declarations:
 *   • a cell that was already declared — its field is the declaration (a blank
 *     field clears it and hands the cell back to the derived figure);
 *   • a derived cell whose figure the admin actually changed.
 * Everything else is sent blank and stays derived.
 *
 * @param {Array} formFills   the form's current cellFillValues
 * @param {{ values: Array, overridden: Array }} loaded  as loaded into the form
 */
export function declaredCellFills(formFills = [], loaded = {}) {
  const loadedValues = loaded.values || [];
  const loadedFlags = loaded.overridden || [];
  const blank = (v) => v === null || v === undefined || v === "";
  return (formFills || []).map((value, index) => {
    if (loadedFlags[index] === true) return blank(value) ? null : value;
    if (blank(value)) return null;
    const before = loadedValues[index];
    const unchanged = !blank(before) && Math.abs(Number(value) - Number(before)) < 0.0005;
    return unchanged ? null : value;
  });
}

export const formatVolume = (value, unit, digits = 2) =>
  `${num(value).toLocaleString(undefined, { maximumFractionDigits: digits })}${unit ? ` ${unit}` : ""}`;
