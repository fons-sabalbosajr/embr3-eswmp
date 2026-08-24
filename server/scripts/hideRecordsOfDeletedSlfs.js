/**
 * Repair: hide the data records of SLF facilities that were already DELETED.
 *
 * Background
 * ----------
 * DELETE /slf-facilities/:id soft-deleted the SlfFacility document only. Every
 * DataSLF record keyed to that facility — submissions, the baseline container,
 * the accredited-hauler/client lists — kept `deletedAt: null`, so a deleted SLF
 * went on feeding the submissions table, the baselines list, the cell-occupancy
 * rollup, the dashboard tiles and every report derived from them.
 *
 * Verified in production: Nueva Ecija LGU Guimba was deleted on 2026-08-04 and
 * still had 70 live submissions afterwards.
 *
 * The delete route now cascades, so this cannot recur. That fix is forward-looking
 * only; facilities deleted BEFORE it landed still have live records. This script
 * repairs those.
 *
 * Guarantees
 * ----------
 *   • DRY-RUN by default — reports what it would change. Pass --apply to write.
 *   • Only touches DataSLF records whose `slfGenerator` is a facility with a
 *     non-null `deletedAt`. A record belonging to a live facility is never
 *     touched.
 *   • SOFT delete only, matching the facility's own semantics. Nothing is
 *     removed from the database.
 *   • Marks each record `deletedWithFacility: true`, so the facility's existing
 *     Restore action puts back exactly this set and nothing else — a record an
 *     admin had deleted separately stays deleted.
 *   • Idempotent — a second run finds nothing.
 *
 * Usage
 * -----
 *   node scripts/hideRecordsOfDeletedSlfs.js           # dry-run (default)
 *   node scripts/hideRecordsOfDeletedSlfs.js --apply   # write changes
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set — nothing to do.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const DataSLF = require("../models/DataSLF");
  const SlfFacility = require("../models/SlfFacility");

  const deletedFacilities = await SlfFacility.find({ deletedAt: { $ne: null } })
    .setOptions({ includeHiddenYears: true })
    .select("lgu slfName deletedAt deletedBy")
    .lean();

  console.log(`Mode      : ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`Deleted SLF facilities: ${deletedFacilities.length}\n`);

  let grandTotal = 0;
  const targets = [];
  for (const facility of deletedFacilities) {
    const live = await DataSLF.countDocuments({ slfGenerator: facility._id, deletedAt: null });
    if (!live) continue;
    targets.push({ facility, live });
    grandTotal += live;
    console.log(
      `  ${(facility.lgu || facility.slfName || String(facility._id)).slice(0, 54).padEnd(56)}` +
        ` deleted=${new Date(facility.deletedAt).toISOString().slice(0, 10)}  liveRecords=${live}`,
    );
  }

  if (!grandTotal) {
    console.log("Nothing to repair — no deleted facility has live data records.");
    await mongoose.disconnect();
    return;
  }

  console.log(`\nTotal records that would be hidden: ${grandTotal}`);
  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to hide them.");
    console.log("Restoring the facility in Trash puts them back.");
    await mongoose.disconnect();
    return;
  }

  let hidden = 0;
  for (const { facility } of targets) {
    const result = await DataSLF.updateMany(
      { slfGenerator: facility._id, deletedAt: null },
      {
        $set: {
          deletedAt: facility.deletedAt,
          deletedBy: facility.deletedBy || "cascade-repair",
          deletedWithFacility: true,
        },
      },
    );
    hidden += result.modifiedCount;
  }
  console.log(`\nHidden    : ${hidden} record(s).`);

  let left = 0;
  for (const { facility } of targets) {
    left += await DataSLF.countDocuments({ slfGenerator: facility._id, deletedAt: null });
  }
  console.log(`Remaining : ${left} (expected 0)`);
  await mongoose.disconnect();
})().catch((error) => {
  console.error("Repair failed:", error.message);
  process.exit(1);
});
