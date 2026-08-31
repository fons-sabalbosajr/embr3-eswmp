/**
 * Benchmark: what does a submission PAY before it writes anything?
 *
 * Every portal submission runs the same account-scoped reads before the first
 * record is saved. They are what made a 15-row upload time out, and their cost
 * depends on the account's history, not on the submission — so the only way to
 * know whether an account is safe is to run them for that account.
 *
 * This times each gate for every approved portal account and flags any that is
 * still slow. It performs the READS a submission performs and stops there: no
 * entry is validated, nothing is written, no notification is sent.
 *
 * Budget: PORTAL_GATE_MAX_TIME_MS (15s) is the ceiling ONE read is allowed
 * before it is aborted, and a submission runs several. An account whose total
 * approaches that is a report waiting to happen.
 *
 * Usage
 * -----
 *   node scripts/benchSubmitGates.js            # every approved account
 *   node scripts/benchSubmitGates.js --all      # include unapproved/dummy
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const routes = require("../routes/dataSLF");

const {
  assertNoUnorganizedPortalSubmissions,
  assertNoUnresolvedRevert,
  getAuthoritativeHaulersForEntry,
  readDeclaredCapacityMap,
} = routes;

const SHOW_ALL = process.argv.includes("--all");
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",").map((v) => v.trim()).filter(Boolean);

// Anything at or above this share of the single-read ceiling is worth acting on
// before a user finds it.
const BUDGET_MS = Number(process.env.PORTAL_GATE_MAX_TIME_MS || 15000);
const WARN_MS = Math.round(BUDGET_MS * 0.4);

/** Time an operation. A gate that REFUSES is still a completed read. */
async function timed(run) {
  const started = Date.now();
  let refusal = null;
  try {
    await run();
  } catch (error) {
    // A 409/403 is the gate doing its job; only a timeout is a failure here.
    refusal = error.statusCode ? `refused: ${error.code || error.statusCode}` : `ERROR: ${error.message}`;
  }
  return { ms: Date.now() - started, refusal };
}

/**
 * The declared-capacity read — the REAL one.
 *
 * This was a copy of the query at first, and the copy went stale the moment the
 * route changed: the benchmark went on reporting a 14 s cost for an
 * implementation that no longer existed, and said "do not deploy" about it. A
 * benchmark that mirrors the code it measures is measuring the mirror.
 */
async function capacityRead(slfGeneratorId) {
  await readDeclaredCapacityMap({ slfGenerator: slfGeneratorId });
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  const filter = SHOW_ALL ? {} : { status: "approved" };
  const accounts = await UserPortal.find(filter)
    .select("email firstName lastName status assignedSlf assignedSlfName isDummy")
    .lean();

  console.log("");
  console.log("Submit-gate benchmark (read-only)");
  console.log("=================================");
  console.log(`Accounts: ${accounts.length}   single-read ceiling: ${BUDGET_MS} ms   warn at: ${WARN_MS} ms`);
  console.log("");

  const results = [];

  for (const account of accounts) {
    const email = account.email;
    const slfId = (Array.isArray(account.assignedSlf) ? account.assignedSlf : [])[0] || null;

    const revert = await timed(() => assertNoUnresolvedRevert(email));
    const organize = await timed(() => assertNoUnorganizedPortalSubmissions(email));
    const roster = slfId
      ? await timed(() => getAuthoritativeHaulersForEntry({ slfGenerator: slfId }))
      : { ms: 0, refusal: null };
    const capacity = slfId ? await timed(() => capacityRead(slfId)) : { ms: 0, refusal: null };

    const total = revert.ms + organize.ms + roster.ms + capacity.ms;
    results.push({ email, account, revert, organize, roster, capacity, total });
  }

  results.sort((a, b) => b.total - a.total);

  let overBudget = 0;
  let warned = 0;

  for (const row of results) {
    const flag = row.total >= BUDGET_MS ? "OVER   " : row.total >= WARN_MS ? "WARN   " : "ok     ";
    if (row.total >= BUDGET_MS) overBudget += 1;
    else if (row.total >= WARN_MS) warned += 1;

    console.log(`${flag}${row.email}${row.account.isDummy ? "  [dummy]" : ""}   total ${row.total} ms`);
    console.log(
      `        revert ${row.revert.ms}ms   organize-cells ${row.organize.ms}ms   ` +
        `roster ${row.roster.ms}ms   capacities ${row.capacity.ms}ms`,
    );
    [row.revert, row.organize, row.roster, row.capacity]
      .filter((gate) => gate.refusal)
      .forEach((gate) => console.log(`        ${gate.refusal}`));
  }

  console.log("");
  console.log("Summary");
  console.log("-------");
  console.log(`Accounts benchmarked : ${results.length}`);
  console.log(`Over the ceiling     : ${overBudget}`);
  console.log(`Within ${WARN_MS}ms of it   : ${warned}`);
  console.log(`Slowest account      : ${results[0]?.email} at ${results[0]?.total} ms`);
  console.log("");
  console.log(
    overBudget === 0
      ? "PASS — every account completes its submit gates inside the ceiling."
      : "FAIL — the accounts marked OVER will still time out. Do not deploy.",
  );
  process.exitCode = overBudget === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error(`\nBenchmark failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
