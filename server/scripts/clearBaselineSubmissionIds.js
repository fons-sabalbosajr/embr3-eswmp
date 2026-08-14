/**
 * Repair: strip the submission identity from BASELINE-ONLY records.
 *
 * Background
 * ----------
 * An SLF's baseline is stored as a DataSLF document with no transport entries —
 * that is the architecture, and those documents must be kept: they hold Total
 * Volume Accepted, the cell entries and the accredited haulers.
 *
 * PATCH /portal-save-baseline used to stamp each newly-created container with an
 * ID No. of its own (via a hand-rolled generator that also hardcoded an empty
 * province, producing "SLF-PVT-XX-0001"). An ID No. identifies a SUBMISSION, so
 * those containers surfaced in the portal's Submission History and the admin
 * Submissions table as a phantom "0 · No Waste Data · Pending" row.
 *
 * The model no longer assigns an ID No. to a record without transport entries
 * (see models/DataSLF.js#isSubmissionRecord). This script clears the ID No. from
 * the containers created before that fix, so historical data matches.
 *
 * Guarantees
 * ----------
 *   • DRY-RUN by default — reports what it would change. Pass --apply to write.
 *   • Only ever touches records with NO transport entries. A submission always has
 *     at least one (submitEntries rejects an empty trucks[]), so a real submission
 *     can never match.
 *   • Clears ONLY `idNo`. Baseline values, haulers, cell entries, company details,
 *     status, ownership and timestamps are untouched. No record is deleted.
 *   • The cleared ID is recorded in `previousIdNos` so the old reference stays
 *     traceable from the record itself.
 *   • Idempotent — a second run finds nothing.
 *
 * Usage
 * -----
 *   node scripts/clearBaselineSubmissionIds.js              # dry-run
 *   node scripts/clearBaselineSubmissionIds.js --apply      # write changes
 *   node scripts/clearBaselineSubmissionIds.js --limit=20   # sample the first N
 */
require("dotenv").config();
const mongoose = require("mongoose");

// Connect through the SAME connector the server uses, rather than calling
// mongoose.connect directly. It carries the DNS repair this project already
// needs: Node's c-ares resolver can fall back to 127.0.0.1 when a VPN/virtual
// adapter shadows the real nameservers, and every `mongodb+srv://` lookup then
// dies with "querySrv ECONNREFUSED". connectMongo re-points the resolver
// (MONGODB_DNS_SERVERS, default 8.8.8.8,1.1.1.1) and falls back to the resolved
// seedlist — which is why the app connects from this machine but a script
// calling mongoose.connect on its own does not.
const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");

const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const APPLY = process.argv.includes("--apply");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;

// No transport entries — the exact discriminator the submission views use
// (SUBMISSION_HAS_TRUCKS in routes/dataSLF.js), inverted.
const BASELINE_ONLY = {
  $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }],
  idNo: { $exists: true, $ne: null },
};

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  const query = DataSLF.find(BASELINE_ONLY)
    .setOptions({ includeHiddenYears: true })
    .select("idNo slfName lguCompanyName companyType status isDummy submittedBy createdAt")
    .sort({ createdAt: 1 })
    .lean();
  if (LIMIT > 0) query.limit(LIMIT);
  const records = await query;

  if (records.length === 0) {
    console.log("Nothing to repair — no baseline-only record carries an ID No.");
    await mongoose.disconnect();
    return;
  }

  console.log(
    `${APPLY ? "REPAIRING" : "DRY-RUN"} — ${records.length} baseline-only record(s) carry a submission ID No.\n`,
  );
  records.forEach((doc) => {
    console.log(
      `  ${doc.idNo.padEnd(20)} ${doc.isDummy ? "[SAMPLE] " : ""}` +
        `${doc.slfName || doc.lguCompanyName || "(no name)"} · ${doc.companyType || "?"} · ` +
        `${doc.status || "?"} · ${doc.submittedBy || "—"}`,
    );
  });

  if (!APPLY) {
    console.log(
      `\nDry-run only — nothing was written. Re-run with --apply to clear these ID No(s).\n` +
        `The records themselves are KEPT: they hold the SLF's baseline data.`,
    );
    await mongoose.disconnect();
    return;
  }

  let cleared = 0;
  for (const doc of records) {
    await DataSLF.updateOne(
      { _id: doc._id },
      { $unset: { idNo: "" }, $addToSet: { previousIdNos: doc.idNo } },
    ).setOptions({ includeHiddenYears: true });
    cleared += 1;
  }

  console.log(`\nCleared the ID No. on ${cleared} baseline-only record(s). No record was deleted.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Failed:", error.message);
  try {
    await mongoose.disconnect();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
