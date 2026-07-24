// Canonical resolution of a "Total Volume Accepted" value arriving in a PARTIAL
// baseline update. Centralized here so the portal save, the admin baseline save,
// and the regression check all apply the exact same rule — the field can only be
// updated with a real number and can never be silently blanked by a partial edit.
//
//   • null / undefined / "" / non-numeric → { apply: false }
//        → the caller must PRESERVE the currently-stored value (do not $set).
//   • a real number, including 0, or a numeric string ("1500") → { apply: true, value }
//        → the caller stores `value` (a canonical Number; 0 is a valid value).
//
// This is the single guard that stops an unrelated baseline edit (haulers, cells,
// company info) from wiping a previously-saved Total Volume Accepted, and the
// place that fixes the "zero treated as missing" / string-to-number issues.
function resolveTotalVolumeForUpdate(raw) {
  if (raw === "" || raw === null || raw === undefined) return { apply: false };
  const num = Number(raw);
  if (Number.isNaN(num)) return { apply: false };
  return { apply: true, value: num };
}

module.exports = { resolveTotalVolumeForUpdate };
