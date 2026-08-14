/**
 * Backfill: persist the authoritative `cellIndex` on baseline cell entries.
 *
 * Background
 * ----------
 * `cellIndex` is the stable relationship between a baseline row and the admin's
 * cell configuration on SlfFacility; `cellName` is only a snapshot of the label
 * at save time. PATCH /portal-save-baseline used to store the rows verbatim from
 * the request body, and the body carried a name with no index — so most stored
 * rows have no durable relationship at all.
 *
 * Both live paths now resolve through utils/cellNaming#resolveBaselineCellEntries:
 * the read binds rows on the way out, and the save binds them before writing. So
 * the application is already correct. This script closes the remaining gap by
 * writing the resolved index onto the rows that predate that fix, so the
 * relationship is durable in the database rather than recomputed on every read.
 *
 * Guarantees
 * ----------
 *   • DRY-RUN by default — reports what it would change. Pass --apply to write.
 *   • Uses THE SAME resolver as the application (resolveBaselineCellEntries), so
 *     the backfill can never disagree with what the portal displays.
 *   • Never invents an index. A row whose name matches no configured cell — and
 *     is not the positional "Cell N" convention — is reported as AMBIGUOUS and
 *     left exactly as it is, for an admin to map by hand.
 *   • Never overwrites an existing in-range index. Those rows are already
 *     authoritative and are counted as ALREADY VALID.
 *   • Only ever writes `activeCellEntries` / `closedCellEntries`. Volumes, units,
 *     waste types, haulers, company details, status and timestamps are untouched,
 *     and no record is created or deleted.
 *   • Idempotent — a second run finds nothing to change.
 *
 * Usage
 * -----
 *   node scripts/backfillBaselineCellIndex.js               # dry-run summary
 *   node scripts/backfillBaselineCellIndex.js --verbose     # + per-row detail
 *   node scripts/backfillBaselineCellIndex.js --ambiguous   # list only the unresolved
 *   node scripts/backfillBaselineCellIndex.js --apply       # write changes
 *   node scripts/backfillBaselineCellIndex.js --limit=20    # sample the first N records
 */
require("dotenv").config();
const mongoose = require("mongoose");

// Same connector the server uses — it carries the DNS repair this project needs
// for mongodb+srv lookups. See clearBaselineSubmissionIds.js for the detail.
const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const { resolveBaselineCellEntries, facilityCellCount } = require("../utils/cellNaming");

const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const AMBIGUOUS_ONLY = process.argv.includes("--ambiguous");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;

const HAS_CELL_ENTRIES = {
  deletedAt: null,
  $or: [{ "activeCellEntries.0": { $exists: true } }, { "closedCellEntries.0": { $exists: true } }],
};

/** Classify one row against the facility, without changing anything. */
function classifyRow(row, facility, resolved) {
  const count = facilityCellCount(facility);
  const existing = row?.cellIndex;
  const hasExisting = existing !== null && existing !== undefined && existing !== "";
  const existingNum = hasExisting ? Number(existing) : NaN;

  if (!facility) return "noFacility";
  if (!count) return "noCells";
  if (Number.isInteger(existingNum) && existingNum >= 0 && existingNum < count) return "alreadyValid";
  if (resolved.cellIndex === null || resolved.cellIndex === undefined) return "ambiguous";
  return "resolvable";
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  await connectMongo(process.env.MONGODB_URI, { dnsServers: MONGODB_DNS_SERVERS });

  const query = DataSLF.find(HAS_CELL_ENTRIES)
    .setOptions({ includeHiddenYears: true })
    .select("slfGenerator slfName lguCompanyName activeCellEntries closedCellEntries")
    .sort({ createdAt: 1 })
    .lean();
  if (LIMIT > 0) query.limit(LIMIT);
  const records = await query;

  // One read per DISTINCT facility, not per record.
  const facilityIds = [...new Set(records.map((r) => String(r.slfGenerator || "")).filter(Boolean))];
  const facilities = await SlfFacility.find({ _id: { $in: facilityIds } })
    .select("numberOfCell cellNames cellTypes cellStatuses cellCapacities lgu province")
    .lean();
  const facilityById = new Map(facilities.map((f) => [String(f._id), f]));

  const stats = { rows: 0, alreadyValid: 0, resolvable: 0, ambiguous: 0, noFacility: 0, noCells: 0 };
  const pending = []; // records that actually need a write
  const ambiguousRows = [];

  for (const record of records) {
    const facility = facilityById.get(String(record.slfGenerator || "")) || null;
    let recordChanged = false;
    const next = {};

    for (const field of ["activeCellEntries", "closedCellEntries"]) {
      const rows = Array.isArray(record[field]) ? record[field] : [];
      if (!rows.length) continue;
      const resolvedRows = resolveBaselineCellEntries(rows, facility);
      next[field] = resolvedRows;

      rows.forEach((row, i) => {
        stats.rows += 1;
        const resolved = Array.isArray(resolvedRows) ? resolvedRows[i] : row;
        const verdict = classifyRow(row, facility, resolved || row);
        stats[verdict] += 1;

        if (verdict === "ambiguous") {
          ambiguousRows.push({
            id: String(record._id),
            slf: record.slfName || record.lguCompanyName || "(no name)",
            facility: facility ? `${facility.province || "?"} - ${facility.lgu || "?"}` : "(no facility)",
            field,
            cellName: row?.cellName || "(blank)",
            volume: row?.volume,
            configured: (facility?.cellNames || []).map((n, idx) => n || `Cell ${idx + 1}`),
          });
        }
        if (verdict === "resolvable") recordChanged = true;
      });
    }

    if (recordChanged) pending.push({ _id: record._id, slf: record.slfName || record.lguCompanyName, next });
  }

  if (AMBIGUOUS_ONLY) {
    console.log(`\nAMBIGUOUS ROWS — ${ambiguousRows.length} row(s) need a human decision.\n`);
    for (const row of ambiguousRows) {
      console.log(`  ${row.facility}`);
      console.log(`    row "${row.cellName}" (${row.field}, volume ${row.volume ?? "—"}) on record ${row.id}`);
      console.log(`    admin cells: ${row.configured.length ? row.configured.join(" · ") : "(none configured)"}\n`);
    }
    await mongoose.disconnect();
    return;
  }

  console.log(`\n${APPLY ? "APPLYING" : "DRY-RUN"} — baseline cell index backfill\n`);
  console.log(`  Records examined:              ${records.length}`);
  console.log(`  Cell rows examined:            ${stats.rows}`);
  console.log(`  Already valid (has an index):  ${stats.alreadyValid}`);
  console.log(`  Safely resolvable:             ${stats.resolvable}`);
  console.log(`  Ambiguous (needs a human):     ${stats.ambiguous}`);
  console.log(`  Facility not found:            ${stats.noFacility}`);
  console.log(`  Facility declares no cells:    ${stats.noCells}`);
  console.log(`\n  Records that would be written: ${pending.length}`);

  if (VERBOSE) {
    console.log("\n  ── rows that cannot be resolved automatically ──");
    for (const row of ambiguousRows.slice(0, 50)) {
      console.log(`    "${row.cellName}" · ${row.facility} · admin cells: ${row.configured.join(" · ") || "(none)"}`);
    }
    if (ambiguousRows.length > 50) console.log(`    …and ${ambiguousRows.length - 50} more (use --ambiguous)`);
  }

  if (!APPLY) {
    console.log(
      "\nDry-run only — nothing was written." +
        "\nRe-run with --apply to persist the resolved cellIndex values." +
        "\nAmbiguous rows are NEVER written: they keep their stored name and stay unbound," +
        "\nso the application continues to treat them as unmapped rather than guessing a cell.\n",
    );
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  for (const item of pending) {
    const set = {};
    for (const [field, value] of Object.entries(item.next)) set[field] = value;
    if (!Object.keys(set).length) continue;
    await DataSLF.updateOne({ _id: item._id }, { $set: set })
      .setOptions({ includeHiddenYears: true, timestamps: false });
    updated += 1;
  }

  console.log(`\nUpdated ${updated} record(s). No record was created or deleted.`);
  console.log(`${stats.ambiguous} row(s) were deliberately left unbound for an admin to map.\n`);
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
