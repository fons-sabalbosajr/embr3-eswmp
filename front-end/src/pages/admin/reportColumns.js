// Column widths for the Reporting Summary tables (SlfSubmissionReport).
//
// The tables use `table-layout: fixed` with percentage widths so they fit the
// modal. With a fixed layout, a table whose column widths add up to more than
// its container grows past it — the operator table was 100% + the 40 px Remove
// column and the baseline table 98% + 40 px, so both ran off the side of the
// modal. These widths are therefore NORMALISED to exactly 100%: a pixel width
// (the Remove button) becomes a small share, a column without a width takes an
// equal part of what is left, and every share is scaled to a 100% total.

export const PX_COLUMN_SHARE = 4; // % given to a pixel-width column

export function fitColumnWidths(columns) {
  const shareOf = (c) => {
    if (typeof c.width === "string" && c.width.trim().endsWith("%")) return parseFloat(c.width) || 0;
    if (typeof c.width === "number") return PX_COLUMN_SHARE;
    return 0;
  };
  const given = columns.map(shareOf);
  const unset = given.filter((s) => !s).length;
  const declared = given.reduce((a, b) => a + b, 0);
  const fill = unset ? Math.max((100 - declared) / unset, 100 / columns.length / 2) : 0;
  const shares = given.map((s) => s || fill);
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  return columns.map((c, i) => ({
    ...c,
    ellipsis: false,
    width: `${((shares[i] / total) * 100).toFixed(3)}%`,
  }));
}
