const SlfFacility = require("../models/SlfFacility");

// Ensure a dummy facility has usable cell infrastructure so a dummy portal user
// can immediately select a cell in the baseline (and disposal) flows. If the
// developer left numberOfCell blank/0, default to a small number of active
// cells; also pad the status/type arrays to match the cell count.
// Returns true when the facility object was modified.
function ensureDummyCellInfrastructure(facility) {
  let changed = false;
  let count = Number(facility.numberOfCell || 0);
  if (!Number.isFinite(count) || count < 1) {
    count = Math.max(
      facility.cellCapacities?.length || 0,
      facility.cellStatuses?.length || 0,
      facility.cellTypes?.length || 0,
      2, // default so the portal baseline cell picker is never empty
    );
    facility.numberOfCell = count;
    changed = true;
  }
  const existingStatuses = Array.isArray(facility.cellStatuses) ? facility.cellStatuses : [];
  if (existingStatuses.length < count) {
    facility.cellStatuses = Array.from(
      { length: count },
      (_, i) => existingStatuses[i] || "Active Cell",
    );
    changed = true;
  }
  const existingTypes = Array.isArray(facility.cellTypes) ? facility.cellTypes : [];
  if (existingTypes.length < count) {
    facility.cellTypes = Array.from(
      { length: count },
      (_, i) => existingTypes[i] || "Residual",
    );
    changed = true;
  }
  return changed;
}

// One-time, idempotent startup fix: any existing dummy SLF facility that was
// created without cell infrastructure (so a dummy portal account could not pick
// a cell in the baseline tab) is given sensible active-cell defaults.
async function backfillDummyCells() {
  const facilities = await SlfFacility.find({ isDummy: true, deletedAt: null });
  let fixed = 0;
  for (const facility of facilities) {
    if (ensureDummyCellInfrastructure(facility)) {
      facility.markModified("cellStatuses");
      facility.markModified("cellTypes");
      await facility.save();
      fixed += 1;
    }
  }
  if (fixed > 0) {
    console.log(`[dummy] Cell infrastructure backfilled for ${fixed} dummy facility record(s).`);
  }
}

module.exports = { ensureDummyCellInfrastructure, backfillDummyCells };
