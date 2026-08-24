/**
 * Repair: make already-REVERTED submissions visible to their portal user again.
 *
 * Background
 * ----------
 * GET /portal-auth/my-submissions filters on `hiddenFromPortal: { $ne: true }`.
 * A portal user may remove one of their own submissions from their Submission
 * History (PATCH /portal-auth/my-submissions/:id/hide), which sets that flag; the
 * record stays intact and fully visible on the admin side.
 *
 * No revert path cleared the flag. So when an admin reverted a submission the user
 * had previously hidden, the record was handed back correctly in the database —
 * status "reverted", revertReason, revertedAt, a notification and an email all
 * saying "please correct and resubmit" — while the portal API kept filtering the
 * row out of the response. The user could not see it, could not open it, and could
 * not resubmit it. The unresolved-revert rule (assertNoNewSubmissionWhileReverted)
 * then blocked their NEXT submission over a record they had no way to reach.
 *
 * The revert routes now clear `hiddenFromPortal` (admin-revert, bulk-revert,
 * approve-edit, approve-revert), so this cannot recur. That fix is forward-looking
 * only: records reverted BEFORE it landed are still hidden. This script repairs
 * those.
 *
 * Guarantees
 * ----------
 *   • DRY-RUN by default — reports what it would change. Pass --apply to write.
 *   • Only ever touches records that are BOTH `status: "reverted"` AND
 *     `hiddenFromPortal: true` AND not deleted. A record the user hid that was
 *     never reverted is left alone — hiding it was their choice and still stands.
 *   • Clears ONLY `hiddenFromPortal`. Status, revert fields, volumes, trucks,
 *     baseline values, ownership and timestamps are untouched. Nothing is deleted,
 *     and `deletedAt` is never cleared, so an admin-deleted record stays deleted.
 *   • Idempotent — a second run finds nothing.
 *
 * Usage
 * -----
 *   node scripts/unhideRevertedSubmissions.js           # dry-run (default)
 *   node scripts/unhideRevertedSubmissions.js --apply   # write changes
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

// BOTH conditions are required. `status: "reverted"` alone would un-hide records
// the user hid deliberately and that no admin ever handed back.
const FILTER = {
  deletedAt: null,
  status: "reverted",
  hiddenFromPortal: true,
};

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set — nothing to do.");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const DataSLF = require("../models/DataSLF");

  const affected = await DataSLF.find(FILTER)
    .select("idNo submittedBy slfName lguCompanyName revertedAt revertReason")
    .sort({ revertedAt: -1 })
    .lean();

  console.log(`Mode      : ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`);
  console.log(`Matched   : ${affected.length} reverted submission(s) hidden from their portal user\n`);

  if (!affected.length) {
    console.log("Nothing to repair.");
    await mongoose.disconnect();
    return;
  }

  const byUser = new Map();
  affected.forEach((r) => {
    const key = r.submittedBy || "(no submittedBy)";
    byUser.set(key, (byUser.get(key) || 0) + 1);
  });
  console.log("By portal user:");
  [...byUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([email, count]) => console.log(`  ${count.toString().padStart(3)}  ${email}`));

  console.log("\nRecords:");
  affected.forEach((r) => {
    const when = r.revertedAt ? new Date(r.revertedAt).toISOString().slice(0, 10) : "unknown";
    console.log(`  ${r.idNo || r._id} | ${when} | ${r.slfName || r.lguCompanyName || "?"}`);
  });

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to clear hiddenFromPortal on these records.");
    await mongoose.disconnect();
    return;
  }

  const result = await DataSLF.updateMany(FILTER, { $set: { hiddenFromPortal: false } });
  console.log(`\nUpdated   : ${result.modifiedCount} record(s).`);

  const left = await DataSLF.countDocuments(FILTER);
  console.log(`Remaining : ${left} (expected 0)`);
  await mongoose.disconnect();
})().catch((error) => {
  console.error("Repair failed:", error.message);
  process.exit(1);
});
