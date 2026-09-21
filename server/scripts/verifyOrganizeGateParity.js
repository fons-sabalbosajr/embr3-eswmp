/**
 * Parity check: does the two-pass Organize Cells gate block EXACTLY the
 * submissions the full read blocked?
 *
 * findUnorganizedPortalSubmissions no longer ships every truck the account has
 * filed; it asks the server for per-record facts first and reads trucks only
 * for the records those facts implicate. The rule (summarizePortalOrganizeNeed)
 * is unchanged, but the first look is new code, so this runs the ORIGINAL read
 * — the full trimmed-trucks aggregation, kept verbatim below — beside the new
 * one for every portal account and compares the blocker sets. Read-only.
 *
 * Usage
 * -----
 *   node scripts/verifyOrganizeGateParity.js
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const UserPortal = require("../models/UserPortal");
const routes = require("../routes/dataSLF");

const { findUnorganizedPortalSubmissions, summarizePortalOrganizeNeed, SUBMISSION_HAS_TRUCKS } = routes;

const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);
const MAX_TIME_MS = Number(process.env.PORTAL_GATE_MAX_TIME_MS || 15000);

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The gate as it read before the two-pass change — every truck, trimmed. */
async function originalBlockers(email) {
  const trimmedTrucks = {
    $map: {
      input: { $ifNull: ["$trucks", []] },
      as: "t",
      in: {
        cellIndex: "$$t.cellIndex",
        actualVolume: "$$t.actualVolume",
        truckCapacity: "$$t.truckCapacity",
        vehicles: {
          $map: {
            input: { $ifNull: ["$$t.vehicles", []] },
            as: "v",
            in: { cellIndex: "$$v.cellIndex", actualVolume: "$$v.actualVolume", capacity: "$$v.capacity" },
          },
        },
      },
    },
  };
  const prior = await DataSLF.aggregate([
    {
      $match: {
        deletedAt: null,
        hiddenFromPortal: { $ne: true },
        submittedBy: new RegExp(`^${escapeRegExp(email)}$`, "i"),
        status: { $nin: ["reverted", "rejected"] },
        ...SUBMISSION_HAS_TRUCKS,
      },
    },
    { $project: { idNo: 1, submissionId: 1, slfGenerator: 1, trucks: trimmedTrucks } },
  ])
    .option({ maxTimeMS: MAX_TIME_MS })
    .exec();
  const facilityIds = [...new Set(prior.map((e) => e.slfGenerator && String(e.slfGenerator)).filter(Boolean))];
  if (facilityIds.length) {
    const facilities = await SlfFacility.find({ _id: { $in: facilityIds } }).select("cellNames cellStatuses").lean();
    const byId = new Map(facilities.map((f) => [String(f._id), f]));
    prior.forEach((e) => { if (e.slfGenerator) e.slfGenerator = byId.get(String(e.slfGenerator)) || null; });
  }
  return prior
    .map((entry) => ({ entry, summary: summarizePortalOrganizeNeed(entry) }))
    .filter(({ summary }) => summary.unplacedCount > 0 || summary.missingCapacityCount > 0);
}

const describe = (blockers) =>
  blockers
    .map(({ entry, summary }) => `${entry.idNo || entry.submissionId}:${summary.unplacedCount}/${summary.missingCapacityCount}`)
    .sort()
    .join(",");

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  // Every account that has ever filed a submission, not only the approved ones.
  const emails = [
    ...new Set([
      ...(await UserPortal.find({}).select("email").lean()).map((u) => u.email),
      ...(await DataSLF.distinct("submittedBy", { deletedAt: null, ...SUBMISSION_HAS_TRUCKS })),
    ].map((e) => String(e || "").trim().toLowerCase()).filter(Boolean)),
  ];

  console.log("");
  console.log("Organize Cells gate parity (read-only)");
  console.log("=====================================");
  console.log(`Accounts: ${emails.length}`);
  console.log("");

  let mismatches = 0;
  let oldTotal = 0;
  let newTotal = 0;
  for (const email of emails) {
    const t0 = Date.now();
    const before = await originalBlockers(email);
    const t1 = Date.now();
    const after = await findUnorganizedPortalSubmissions(email);
    const t2 = Date.now();
    oldTotal += t1 - t0;
    newTotal += t2 - t1;
    const same = describe(before) === describe(after);
    if (!same) mismatches += 1;
    console.log(
      `${same ? "ok      " : "MISMATCH"} ${email.padEnd(42)} blockers ${String(before.length).padStart(2)} → ${String(after.length).padStart(2)}   ` +
        `full ${String(t1 - t0).padStart(5)} ms   two-pass ${String(t2 - t1).padStart(5)} ms`,
    );
    if (!same) {
      console.log(`         full    : ${describe(before) || "(none)"}`);
      console.log(`         two-pass: ${describe(after) || "(none)"}`);
    }
  }

  console.log("");
  console.log(`Total time — full read: ${oldTotal} ms   two-pass: ${newTotal} ms`);
  console.log(mismatches === 0 ? "PASS — identical blocker sets for every account." : `FAIL — ${mismatches} account(s) differ.`);
  process.exitCode = mismatches === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(`\nParity check failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
