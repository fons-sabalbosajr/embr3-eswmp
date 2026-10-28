// ── Fit a table's columns to the table's own width ───────────────────────────
//
// Pixel widths only ADD UP to a table width; they never adapt to the space the
// table actually has. The Submission History columns summed to ~1630px at xl
// against a card a little over 1100px wide, so the table always scrolled
// sideways on a desktop. Restating each VISIBLE column's width as its share of
// the table keeps the proportions the pixel widths were chosen for and makes
// them sum to exactly the width available.
//
// Pure: no hooks, no component state.

/** Whether antd renders this column at the current breakpoints. Same rule antd
 * applies to `responsive`: shown when any listed breakpoint is active. */
export const isColumnVisible = (column, screens = {}) =>
  !Array.isArray(column?.responsive) || column.responsive.some((bp) => Boolean(screens[bp]));

/**
 * Columns with each visible one's width as a percentage of the table.
 *
 * @param {object[]} columns    antd column definitions with pixel widths
 * @param {object}   screens    Grid.useBreakpoint() result
 * @param {number}   reservedPct share kept back for a column antd adds itself
 *                              (the expand toggle), so the total stays 100%
 */
export function fitColumnsToWidth(columns = [], screens = {}, reservedPct = 0) {
  const list = Array.isArray(columns) ? columns : [];
  const px = (column) => {
    const n = Number(column?.width);
    return Number.isFinite(n) && n > 0 ? n : 100;
  };
  const total = list.filter((c) => isColumnVisible(c, screens)).reduce((sum, c) => sum + px(c), 0);
  if (!total) return list;
  const share = 100 - reservedPct;
  return list.map((column) =>
    isColumnVisible(column, screens)
      ? { ...column, width: `${((px(column) / total) * share).toFixed(3)}%` }
      : column,
  );
}

export default { isColumnVisible, fitColumnsToWidth };
