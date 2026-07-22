// Centralized application timezone. The ESWMP operates in the Philippines
// (Asia/Manila, UTC+8, no DST), so "today" is computed against this single fixed
// offset rather than comparing browser-local or server-UTC dates independently.
// Change the offset HERE only.

const APP_TZ = "Asia/Manila";
const APP_UTC_OFFSET_MINUTES = 8 * 60; // UTC+8, no DST

// Start (inclusive) and end (exclusive) of the current official day as UTC Date
// objects, so a range query on a UTC-stored field selects "today in Manila".
function todayRange(now = new Date()) {
  const shifted = new Date(now.getTime() + APP_UTC_OFFSET_MINUTES * 60000);
  // Midnight of the shifted (local) day, expressed back in UTC.
  const startUtcMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
    - APP_UTC_OFFSET_MINUTES * 60000;
  const start = new Date(startUtcMs);
  const end = new Date(startUtcMs + 24 * 60 * 60000);
  return { start, end };
}

// Start/end (UTC) of an arbitrary official day given a "YYYY-MM-DD" string
// (interpreted in Manila). Falls back to today for an empty/invalid input.
function dayRangeFor(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
  if (!m) return todayRange();
  const startUtcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - APP_UTC_OFFSET_MINUTES * 60000;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60000) };
}

module.exports = { APP_TZ, APP_UTC_OFFSET_MINUTES, todayRange, dayRangeFor };
