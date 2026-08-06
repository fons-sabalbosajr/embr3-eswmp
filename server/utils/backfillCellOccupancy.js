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
const { computeCellOccupancy, OCCUPANCY_ENTRY_FIELDS } = require("./cellOccupancy");

const BATCH_SIZE = 25;
/** Rounding tolerance when comparing stored vs recomputed totals. */
const TOTAL_EPSILON = 0.001;

async function backfillCellOccupancy() {
  // Cheap gate: once every facility carries the split, this migration has
  // nothing left to do and boot costs a single count instead of a full
  // recompute sweep. Ongoing correctness is maintained by the live write path
  // (refreshFacilityCellOccupancy), not by re-running this on every start.
  const outstanding = await SlfFacility.countDocuments({
    deletedAt: null,
    numberOfCell: { $gt: 0 },
    cellFillBaselineValues: { $exists: false },
  }).setOptions({ includeHiddenYears: true });
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
      "cellCapacityUnits cellFillValues cellFillUnits wasteReceivedUnit volumeCapacityUnit " +
      "actualResidualWasteReceived cellFillBaselineValues cellFillSubmittedValues",
    )
    .setOptions({ includeHiddenYears: true })
    .lean();

  if (!pending.length) return 0;

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
      .select(OCCUPANCY_ENTRY_FIELDS)
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
      const occupancy = computeCellOccupancy(
        facility,
        entriesByFacility.get(String(facility._id)) || [],
      );

      const hasSplit = Array.isArray(facility.cellFillBaselineValues) && facility.cellFillBaselineValues.length > 0;
      const storedTotal = Number(facility.actualResidualWasteReceived || 0);
      const totalMatches = Math.abs(storedTotal - occupancy.totalVolume) <= TOTAL_EPSILON;

      // Leave a facility alone when it is already consistent — this keeps the
      // startup pass free on a healthy database.
      if (hasSplit && totalMatches) return;

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
              baselineVolumeTotal: occupancy.baselineTotal,
              submittedVolumeTotal: occupancy.submittedTotal,
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
