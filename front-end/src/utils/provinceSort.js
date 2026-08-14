// ── Province ordering ──
// Admin views that GROUP by province list them alphabetically, so an operator can
// find one by name instead of learning a count-based order that reshuffles every
// time the data changes.
//
// One comparator, shared by every such list — the Dashboard's "Cell Infrastructure
// — All Facilities" modal and the "LGUs & Private Sectors Served" summary — so the
// two can never drift into different orders.

// "  province of  Pampanga " → "pampanga"
// The "Province of" prefix is stripped so it sorts under P for Pampanga rather
// than clustering every province under "P" for "Province".
const normalizeProvinceName = (value) =>
  String(value ?? "")
    .replace(/^\s*province\s+of\s+/i, "")
    .trim()
    .replace(/\s+/g, " ");

/**
 * Locale-aware A→Z comparison of two province names.
 *
 * Case- and accent-insensitive (`sensitivity: "base"`), whitespace-tolerant, and
 * null-safe. Rows with no province — rendered as "Unspecified" — always sort
 * LAST rather than under U, so a data gap never sits in the middle of the list.
 */
export function compareProvinceNames(a, b) {
  const left = normalizeProvinceName(a);
  const right = normalizeProvinceName(b);
  const leftMissing = !left || left.toLowerCase() === "unspecified";
  const rightMissing = !right || right.toLowerCase() === "unspecified";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

/** Sort a list of objects alphabetically by a province field. Returns a NEW array. */
export function sortByProvince(rows = [], getProvince = (row) => row?.province) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    compareProvinceNames(getProvince(a), getProvince(b)),
  );
}

export default compareProvinceNames;
