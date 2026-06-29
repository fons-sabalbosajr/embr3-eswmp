/**
 * One-time migration: backfill denormalized metric fields on DataSLF records.
 *
 * Computes truckCount, total/residual/hazardous volume (m³ + tons), and
 * submissionYear/Month/DateKey from each record's `trucks` array + dateOfDisposal.
 * Older records that pre-date these fields will be brought up to date so the
 * /summary-tiles and /summary-by-slf aggregations stay accurate. Existing data
 * is never altered beyond these metric fields.
 *
 * Safe to re-run. Uses batching to avoid loading the whole collection at once.
 *
 * Usage:  node scripts/backfillDataSLFMetrics.js
 *         node scripts/backfillDataSLFMetrics.js --batch=1000
 */
const mongoose = require("mongoose");
require("dotenv").config();

const DataSLF = require("../models/DataSLF");
const { computeSlfMetrics } = DataSLF;

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const BATCH = Number((process.argv.find((a) => a.startsWith("--batch=")) || "").split("=")[1]) || 500;

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected. Backfilling DataSLF metrics in batches of", BATCH);

  const cursor = DataSLF.find({})
    .setOptions({ includeHiddenYears: true })
    .select("trucks dateOfDisposal baselineUnit")
    .lean()
    .cursor();

  let ops = [];
  let processed = 0;
  let updated = 0;

  const flush = async () => {
    if (!ops.length) return;
    const res = await DataSLF.bulkWrite(ops, { ordered: false });
    updated += res.modifiedCount || 0;
    ops = [];
  };

  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    const metrics = computeSlfMetrics(doc);
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: metrics } } });
    processed += 1;
    if (ops.length >= BATCH) await flush();
  }
  await flush();

  console.log(`Done. Processed ${processed} records, updated ${updated}.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
