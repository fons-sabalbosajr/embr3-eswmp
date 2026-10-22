/**
 * Backfill the resubmission trail (resubmittedAt / resubmitCount /
 * resubmitComment / resubmittedRevertReason) on DataSLF records.
 *
 * Since a resubmission keeps its ID No., `previousIdNos` stopped marking one, so
 * records resubmitted before these fields existed show as plain submissions in
 * the Remarks columns. The Transaction log has every resubmission (type
 * "resubmission", meta.comment) and every admin revert (type "status_change",
 * meta.reason), so the trail is rebuilt from there.
 *
 * Only records with NO resubmittedAt are touched; nothing else on them changes.
 *
 * Usage
 * -----
 *   node scripts/backfillResubmissionTrail.js            # dry run (default)
 *   node scripts/backfillResubmissionTrail.js --apply    # write
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");
const Transaction = require("../models/Transaction");

const APPLY = process.argv.includes("--apply");
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

async function main() {
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  const resubs = await Transaction.find({ type: "resubmission", dataEntry: { $ne: null } })
    .select("dataEntry createdAt meta.comment")
    .sort({ createdAt: 1 })
    .lean();
  const byEntry = new Map();
  for (const t of resubs) {
    const key = String(t.dataEntry);
    const cur = byEntry.get(key) || { count: 0, at: null, comment: "" };
    cur.count += 1;
    cur.at = t.createdAt;
    cur.comment = String(t.meta?.comment || "").trim();
    byEntry.set(key, cur);
  }

  const ids = [...byEntry.keys()];
  const records = await DataSLF.find({ _id: { $in: ids }, resubmittedAt: null })
    .setOptions({ includeHiddenYears: true })
    .select("_id idNo submittedBy status")
    .lean();

  // The revert each resubmission answered: the latest admin revert before it.
  const reverts = await Transaction.find({
    type: "status_change",
    dataEntry: { $in: records.map((r) => r._id) },
    "meta.reason": { $exists: true },
  })
    .select("dataEntry createdAt meta.reason")
    .sort({ createdAt: 1 })
    .lean();
  const revertsByEntry = new Map();
  for (const r of reverts) {
    const key = String(r.dataEntry);
    if (!revertsByEntry.has(key)) revertsByEntry.set(key, []);
    revertsByEntry.get(key).push(r);
  }

  const ops = records.map((rec) => {
    const trail = byEntry.get(String(rec._id));
    const answered = (revertsByEntry.get(String(rec._id)) || [])
      .filter((r) => new Date(r.createdAt) <= new Date(trail.at))
      .pop();
    const set = {
      resubmittedAt: trail.at,
      resubmitCount: trail.count,
      resubmitComment: trail.comment.slice(0, 1000),
      resubmittedRevertReason: String(answered?.meta?.reason || "").trim(),
    };
    console.log(
      `${rec.idNo || rec._id} (${rec.submittedBy}, ${rec.status}) ×${set.resubmitCount} @ ${new Date(set.resubmittedAt).toISOString()}` +
        (set.resubmitComment ? ` note="${set.resubmitComment.slice(0, 60)}"` : "") +
        (set.resubmittedRevertReason ? ` reason="${set.resubmittedRevertReason.slice(0, 60)}"` : ""),
    );
    return { updateOne: { filter: { _id: rec._id, resubmittedAt: null }, update: { $set: set } } };
  });

  console.log(`\n${ops.length} record(s) to backfill (of ${ids.length} with a resubmission transaction).`);
  if (APPLY && ops.length) {
    // bulkWrite skips the save hooks on purpose: nothing but these four fields
    // may change (no ID re-mint, no metric recompute).
    const res = await DataSLF.bulkWrite(ops, { ordered: false });
    console.log(`Applied: ${res.modifiedCount} modified.`);
  } else if (!APPLY) {
    console.log("Dry run — re-run with --apply to write.");
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
