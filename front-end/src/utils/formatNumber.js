// THE single compact number formatter for the whole app (admin + SLF Portal).
// Reuse this instead of duplicating K/M logic in components.
//
// Rules (Item #1):
//   • thousands → K, millions → M
//   • max 2 decimal places, trailing zeros stripped (5.00K → 5K, 1.20M → 1.2M)
//   • values below 1,000 stay in normal numeric format
//   • negatives preserved
//   • null / undefined / "" / non-finite → the `invalid` placeholder (default "—")
//   • zero → "0"
//
// Do NOT use this for IDs, years, phone numbers, coordinates, or exact editable
// form values — those must show the complete number.

// Round to `decimals` and drop trailing zeros: 1.2600 → "1.26", 5.00 → "5".
function trimZeros(num, decimals) {
  return parseFloat(num.toFixed(decimals)).toString();
}

export function formatCompact(value, { decimals = 2, invalid = "—" } = {}) {
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
    return invalid;
  }
  if (n === 0) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  if (abs >= 1_000_000) return `${sign}${trimZeros(abs / 1_000_000, decimals)}M`;
  if (abs >= 1_000) return `${sign}${trimZeros(abs / 1_000, decimals)}K`;
  // Below 1,000 — normal numeric format (still capped at `decimals` places).
  return `${sign}${trimZeros(abs, decimals)}`;
}

// Compact value + unit label, e.g. formatCompactVolume(1256000, "tons") → "1.26M tons".
// Never converts units — presentation only. Missing/invalid values return the
// `invalid` placeholder without a unit.
export function formatCompactVolume(value, unit, opts = {}) {
  const formatted = formatCompact(value, opts);
  if (formatted === (opts.invalid ?? "—")) return formatted;
  const u = String(unit || "").trim();
  return u ? `${formatted} ${u}` : formatted;
}
