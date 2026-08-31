/**
 * Audit: which portal accounts are at risk of a submission timeout?
 *
 * A submission's cost is dominated by what the gates READ ABOUT THE ACCOUNT, not
 * by the size of the submission — which is why a 15-row upload could time out.
 * There are two drivers, and this measures both for every portal account:
 *
 *   1. accreditedHaulers weight (per FACILITY)
 *      The array is deliberately copied onto every baseline-carrying record, and
 *      each copy holds every hauler's vehicles AND all of its clients. The submit
 *      path reads it twice — once for the authoritative roster, once for declared
 *      truck capacities. Prime Waste Solution: 22 records × ~232 KB = 5,099 KB,
 *      pulled twice per submit.
 *
 *   2. Organize-Cells gate weight (per ACCOUNT)
 *      assertNoUnorganizedPortalSubmissions reads every submission the account
 *      has ever filed that is not deleted, hidden, reverted or rejected.
 *
 * Both are now projected/aggregated down (see routes/dataSLF.js), so the numbers
 * below are what the OLD code would have moved per submit and what the NEW code
 * moves. Run it before and after a deploy to confirm the difference on real data.
 *
 * READ-ONLY. It opens no write, and it prints no client names or e-mail bodies —
 * only counts, sizes and the account identifier needed to act on a row.
 *
 * Usage
 * -----
 *   node scripts/auditPortalSubmitCost.js              # accounts at risk
 *   node scripts/auditPortalSubmitCost.js --all        # every account
 *   node scripts/auditPortalSubmitCost.js --json       # machine-readable
 */
require("dotenv").config();
const mongoose = require("mongoose");

const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");

const SHOW_ALL = process.argv.includes("--all");
const AS_JSON = process.argv.includes("--json");
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

// Above this, one submit was moving enough data to be at the mercy of the link.
const RISK_KB = Number(process.env.AUDIT_RISK_KB || 512);

const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const fmtKb = (bytes) => `${kb(bytes).toLocaleString()} KB`;

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  // ── 1. accreditedHaulers weight per facility ──────────────────────────────
  // $bsonSize on the array itself is the exact number of bytes the OLD read
  // pulled for that record; summing over a facility's records is what one submit
  // moved, and it paid it twice.
  const facilityWeight = await DataSLF.aggregate([
    { $match: { "accreditedHaulers.0": { $exists: true } } },
    {
      $group: {
        _id: { $ifNull: ["$slfGenerator", "$slfName"] },
        slfName: { $first: "$slfName" },
        records: { $sum: 1 },
        bytes: { $sum: { $bsonSize: { a: "$accreditedHaulers" } } },
        haulerCopies: { $sum: { $size: { $ifNull: ["$accreditedHaulers", []] } } },
      },
    },
    { $sort: { bytes: -1 } },
  ]).option({ maxTimeMS: 120000 });

  const weightByFacility = new Map(facilityWeight.map((row) => [String(row._id), row]));

  // ── 2. Organize-Cells gate weight per account ─────────────────────────────
  // The same filter the gate uses, counted rather than fetched.
  const gateWeight = await DataSLF.aggregate([
    {
      $match: {
        deletedAt: null,
        hiddenFromPortal: { $ne: true },
        status: { $nin: ["reverted", "rejected"] },
        submittedBy: { $nin: [null, ""] },
      },
    },
    {
      $group: {
        _id: { $toLower: { $trim: { input: "$submittedBy" } } },
        submissions: { $sum: 1 },
        truckRows: { $sum: { $size: { $ifNull: ["$trucks", []] } } },
        // What the gate's projection moves now (the six numeric fields), against
        // what selecting `trucks` whole used to move.
        projectedBytes: {
          $sum: {
            $add: [
              { $multiply: [{ $size: { $ifNull: ["$trucks", []] } }, 48] },
              64,
            ],
          },
        },
        fullTruckBytes: { $sum: { $bsonSize: { t: { $ifNull: ["$trucks", []] } } } },
      },
    },
  ]).option({ maxTimeMS: 120000 });

  const gateByEmail = new Map(gateWeight.map((row) => [String(row._id), row]));

  // ── 3. Join onto the accounts ─────────────────────────────────────────────
  const accounts = await UserPortal.find({})
    .select("email firstName lastName companyName status assignedSlf assignedSlfName isDummy")
    .lean();

  const rows = accounts.map((account) => {
    const email = String(account.email || "").trim().toLowerCase();
    const gate = gateByEmail.get(email) || { submissions: 0, truckRows: 0, projectedBytes: 0, fullTruckBytes: 0 };

    // An account may be assigned several facilities; a submission pays for the
    // one it targets, so the worst of them is the number that matters.
    const assigned = Array.isArray(account.assignedSlf) ? account.assignedSlf : [];
    const facilities = assigned
      .map((id) => weightByFacility.get(String(id)))
      .filter(Boolean);
    const byName = weightByFacility.get(String(account.assignedSlfName || ""));
    if (!facilities.length && byName) facilities.push(byName);

    const worst = facilities.sort((a, b) => b.bytes - a.bytes)[0] || null;
    const rosterBytes = worst?.bytes || 0;

    return {
      email: account.email,
      name: `${account.firstName || ""} ${account.lastName || ""}`.trim(),
      company: account.companyName || "",
      status: account.status,
      isDummy: !!account.isDummy,
      facility: worst?.slfName || account.assignedSlfName || "(none assigned)",
      baselineRecords: worst?.records || 0,
      haulerCopies: worst?.haulerCopies || 0,
      // OLD: roster read + capacity read, both pulling the whole array.
      beforeBytes: rosterBytes * 2 + gate.fullTruckBytes,
      // NEW: the roster is unioned server-side and the capacity map projects two
      // fields; both are now a small fraction, and the gate is projected.
      afterBytesApprox: Math.round(rosterBytes * 0.02) + gate.projectedBytes,
      submissions: gate.submissions,
      truckRows: gate.truckRows,
    };
  });

  rows.sort((a, b) => b.beforeBytes - a.beforeBytes);
  const atRisk = rows.filter((row) => kb(row.beforeBytes) >= RISK_KB);
  const shown = SHOW_ALL ? rows : atRisk;

  if (AS_JSON) {
    console.log(JSON.stringify({ riskThresholdKb: RISK_KB, atRisk: atRisk.length, rows: shown }, null, 2));
    return;
  }

  console.log("");
  console.log("Portal submission cost audit");
  console.log("============================");
  console.log(`Accounts: ${rows.length}   At risk (>${RISK_KB} KB per submit, before fix): ${atRisk.length}`);
  console.log("");

  if (!shown.length) {
    console.log("No account moves more than the risk threshold. Nothing to act on.");
  }

  for (const row of shown) {
    const flag = kb(row.beforeBytes) >= RISK_KB ? "AT RISK" : "ok";
    console.log(`${flag.padEnd(8)} ${row.email}${row.isDummy ? "  [dummy]" : ""}`);
    console.log(`         facility: ${row.facility}`);
    console.log(
      `         baseline records carrying haulers: ${row.baselineRecords}` +
        `   hauler copies: ${row.haulerCopies}`,
    );
    console.log(
      `         submissions the gate reads: ${row.submissions}   truck rows: ${row.truckRows}`,
    );
    console.log(
      `         per submit — before: ${fmtKb(row.beforeBytes)}   after: ~${fmtKb(row.afterBytesApprox)}`,
    );
    console.log("");
  }

  const worstBefore = rows[0];
  if (worstBefore) {
    console.log("Heaviest account before the fix:");
    console.log(`  ${worstBefore.email} — ${fmtKb(worstBefore.beforeBytes)} per submit`);
    console.log(`  after: ~${fmtKb(worstBefore.afterBytesApprox)}`);
  }
}

main()
  .catch((error) => {
    console.error(`\nAudit failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
