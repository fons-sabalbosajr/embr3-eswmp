/**
 * Baseline → SlfClient synchronization (CLI wrapper).
 *
 * Reads portal baseline accredited haulers + clients, upserts SlfClient records,
 * flags un-syncable records as SlfDataIssue, and prints a summary. Idempotent —
 * safe to run repeatedly; it never creates duplicates. This does NOT run on
 * startup; invoke it explicitly.
 *
 * Usage:  node scripts/syncBaselineClients.js
 *         node scripts/syncBaselineClients.js --json
 */
const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });

const { runBaselineClientSync } = require("../services/syncBaselineClients");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const AS_JSON = process.argv.includes("--json");

async function run() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const summary = await runBaselineClientSync({ actor: "cli:syncBaselineClients" });
  if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("Baseline → SlfClient sync complete:");
    console.log(`  Baselines scanned:      ${summary.baselinesScanned}`);
    console.log(`  Clients processed:      ${summary.clientsProcessed}`);
    console.log(`  Created:                ${summary.created}`);
    console.log(`  Updated:                ${summary.updated}`);
    console.log(`  Skipped (admin-managed): ${summary.skippedAdminManaged}`);
    console.log(`  Flagged issues:         ${summary.flagged}`);
    console.log(`  By flag type:           ${JSON.stringify(summary.byFlagType)}`);
  }
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
