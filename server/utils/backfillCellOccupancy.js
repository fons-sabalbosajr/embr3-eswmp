/**
 * Repair stored per-cell occupancy so every facility reflects the ONE shared
 * calculator (utils/cellOccupancy.js).
 *
 * Two things are fixed here:
 *
 *  1. The BASELINE / SUBMITTED provenance split (cellFillBaselineValues /
 *     cellFillSubmittedValues) did not exist before cellOccupancy.js, so older
 *     records have no split and their gauges cannot colour contributions.
 *
 *  2. More importantly, `cellFillValues` itself was written by the old
 *     truck-only routine in dataSLF.js, which disagreed with the portal-facing
 *     enrichment. Real records were left double-counted (e.g. a baseline of 27
 *     stored as 54). Recomputing through the shared calculator is what makes
 *     the Submitted Volume tile and the Baseline Breakdown agree.
 *
 * Runs at startup over facilities that are missing the split OR whose stored
 * total no longer matches the recomputed one, so it self-heals and is a no-op
 * once everything is consistent.
 */

const SlfFacility = require("../models/SlfFacility");
const DataSLF = require("../models/DataSLF");
const {
  computeCellOccupancy,
  applyPreBaselineRule,
  preBaselineExclusionEnabled,
  OCCUPANCY_ENTRY_FIELDS,
  OCCUPANCY_CALC_VERSION,
  OVERRIDE_FACILITY_FIELDS,
} = require("./cellOccupancy");

const BATCH_SIZE = 25;
/** Rounding tolerance when comparing stored vs recomputed totals. */
const TOTAL_EPSILON = 0.001;

/** Facilities whose derived figures were written by an older calculation. */
const STALE_FILTER = {
  deletedAt: null,
  numberOfCell: { $gt: 0 },
  $or: [
    { cellFillBaselineValues: { $exists: false } },
    { cellOccupancyVersion: { $ne: OCCUPANCY_CALC_VERSION } },
  ],
};

async function backfillCellOccupancy() {
  // Cheap gate: once every facility carries the split AND the current
  // calculation's version stamp, this migration has nothing to do and boot costs
  // a single count instead of a full recompute sweep.
  //
  // The version is what makes it self-heal. The gate used to test only for a
  // MISSING split, so a corrected calculation never reached the facilities it
  // corrected — the stored figures stayed as the old code left them (a cell
  // reporting a 441,324 t baseline that had been merged in from two other cells)
  // until an unrelated write happened to recompute that one facility.
  const outstanding = await SlfFacility.countDocuments(STALE_FILTER).setOptions({
    includeHiddenYears: true,
  });
  if (outstanding === 0) return 0;

  // Every facility with cells is then examined; only the ones that actually
  // differ are written. The candidate filter deliberately avoids a top-level
  // `$or`: the year-visibility plugin adds its own via .where(), which would
  // clobber it and silently change the scope.
  const pending = await SlfFacility.find({
    deletedAt: null,
    numberOfCell: { $gt: 0 },
  })
    .select(
      "_id numberOfCell cellNames cellStatuses cellTypes cellCapacities " +
      "cellCapacityUnits wasteReceivedUnit volumeCapacityUnit " +
      // The override fields are READ so an admin-declared Waste in Cell survives
      // the sweep — base, unit and declaration date included, since the date is
      // what decides which submissions accumulate on top of it. Leaving them out
      // would have the repair quietly rewrite every override back to a plain
      // replacement. The version stamp decides whether a facility needs
      // rewriting at all.
      `${OVERRIDE_FACILITY_FIELDS} ` +
      "actualResidualWasteReceived cellFillBaselineValues cellFillSubmittedValues " +
      "cellOccupancyVersion",
    )
    .setOptions({ includeHiddenYears: true })
    .lean();

  if (!pending.length) return 0;

  // Read once for the whole sweep rather than per facility.
  const excludePreBaseline = await preBaselineExclusionEnabled();

  let updated = 0;
  for (let index = 0; index < pending.length; index += BATCH_SIZE) {
    const batch = pending.slice(index, index + BATCH_SIZE);
    const ids = batch.map((facility) => facility._id);

    // One query per batch rather than per facility.
    // eslint-disable-next-line no-await-in-loop -- deliberate batching
    const entries = await DataSLF.find({
      slfGenerator: { $in: ids },
      deletedAt: null,
      isDummy: { $ne: true },
    })
      // `dateOfDisposal` is what the pre-baseline rule compares against.
      .select(`${OCCUPANCY_ENTRY_FIELDS} dateOfDisposal`)
      .sort({ createdAt: -1 })
      .lean();

    const entriesByFacility = new Map();
    entries.forEach((entry) => {
      const key = String(entry.slfGenerator || "");
      if (!entriesByFacility.has(key)) entriesByFacility.set(key, []);
      entriesByFacility.get(key).push(entry);
    });

    const operations = [];
    batch.forEach((facility) => {
      const own = entriesByFacility.get(String(facility._id)) || [];
      // EXACTLY what refreshFacilityCellOccupancy does on the live write path —
      // the same filter and the same unit anchor. A repair that computed the
      // figures differently from the code that maintains them would simply
      // rewrite the drift it was meant to remove.
      const { counted } = applyPreBaselineRule(own, { exclude: excludePreBaseline });
      const occupancy = computeCellOccupancy(facility, counted, { unitSource: own });

      const hasSplit = Array.isArray(facility.cellFillBaselineValues) && facility.cellFillBaselineValues.length > 0;
      const storedTotal = Number(facility.actualResidualWasteReceived || 0);
      const totalMatches = Math.abs(storedTotal - occupancy.totalVolume) <= TOTAL_EPSILON;
      const versionMatches = Number(facility.cellOccupancyVersion || 0) === OCCUPANCY_CALC_VERSION;

      // Leave a facility alone when it is already consistent AND was written by
      // the current calculation — this keeps the startup pass free on a healthy
      // database.
      if (hasSplit && totalMatches && versionMatches) return;

      operations.push({
        updateOne: {
          filter: { _id: facility._id },
          update: {
            $set: {
              cellFillValues: occupancy.cellFillValues,
              cellFillUnits: occupancy.cellFillUnits,
              actualResidualWasteReceived: occupancy.totalVolume,
              wasteReceivedUnit: occupancy.unit,
              cellFillBaselineValues: occupancy.cellFillBaselineValues,
              cellFillSubmittedValues: occupancy.cellFillSubmittedValues,
              cellFillPendingValues: occupancy.cellFillPendingValues,
              baselineVolumeTotal: occupancy.baselineTotal,
              submittedVolumeTotal: occupancy.submittedTotal,
              cellOccupancyVersion: OCCUPANCY_CALC_VERSION,
            },
          },
        },
      });
    });

    if (!operations.length) continue;
    // eslint-disable-next-line no-await-in-loop -- deliberate batching
    const result = await SlfFacility.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount || 0;
  }

  return updated;
}

module.exports = { backfillCellOccupancy };
