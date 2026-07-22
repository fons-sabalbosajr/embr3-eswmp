/**
 * Controlled, idempotent duplicate-SlfClient cleanup (CLI wrapper).
 * Collapses exact normalized duplicate client rows into one canonical profile.
 * Safe to re-run. Does NOT run at startup.
 *
 * Usage:  node scripts/cleanupDuplicateClients.js [--json]
 */
const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });
const { runDuplicateCleanup } = require("../services/cleanupDuplicateClients");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const AS_JSON = process.argv.includes("--json");

async function run() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const summary = await runDuplicateCleanup({ actor: "cli:cleanupDuplicateClients" });
  console.log(AS_JSON ? JSON.stringify(summary, null, 2) : `Cleanup complete: ${JSON.stringify(summary)}`);
  await mongoose.disconnect();
}
run().catch((err) => { console.error("Cleanup failed:", err); process.exit(1); });
