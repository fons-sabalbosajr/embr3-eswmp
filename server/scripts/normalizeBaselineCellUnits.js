/**
 * Merge baseline cell-entry units onto the unit the admin DECLARED for each cell.
 *
 * Portal operators used to choose a unit per baseline cell entry, so some
 * facilities ended up with cells stored in m³ while the admin side declares tons
 * (e.g. Floridablanca: 430,738.41 m³ against cells declared in tons). The live
 * read/save paths now normalize through utils/baselineCellEntries.js; this script
 * rewrites the rows ALREADY stored so every consumer (admin dashboards, reports,
 * exports) agrees, not just the two endpoints that normalize on read.
 *
 * Quantity-preserving: each volume is CONVERTED (tons = m³ × 0.5), never just
 * relabelled, so cell occupancy figures do not move. Rows whose unit cannot be
 * converted are left untouched and reported.
 *
 *   node scripts/normalizeBaselineCellUnits.js            # dry run (default)
 *   node scripts/normalizeBaselineCellUnits.js --verbose  # dry run, every change
 *   node scripts/normalizeBaselineCellUnits.js --apply    # write
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { connectMongo } = require("../config/mongo");
const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const {
  FACILITY_CELL_UNIT_SELECT,
  resolveBaselineCellEntriesForRead,
} = require("../utils/baselineCellEntries");

const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");
  await connectMongo(uri, { dnsServers: MONGODB_DNS_SERVERS });

  const records = await DataSLF.find({
    deletedAt: null,
    slfGenerator: { $ne: null },
    $or: [{ "activeCellEntries.0": { $exists: true } }, { "closedCellEntries.0": { $exists: true } }],
  })
    .setOptions({ includeHiddenYears: true })
    .select("slfGenerator slfName lguCompanyName activeCellEntries closedCellEntries")
    .lean();

  const facilityIds = [...new Set(records.map((r) => String(r.slfGenerator)))];
  const facilities = await SlfFacility.find({ _id: { $in: facilityIds } })
    .setOptions({ includeHiddenYears: true })
    .select(`lgu ${FACILITY_CELL_UNIT_SELECT}`)
    .lean();
  const facilityById = new Map(facilities.map((f) => [String(f._id), f]));

  let rowsChanged = 0;
  const pending = [];
  for (const record of records) {
    const facility = facilityById.get(String(record.slfGenerator));
    if (!facility) continue;
    const set = {};
    for (const field of ["activeCellEntries", "closedCellEntries"]) {
      const rows = record[field] || [];
      if (!rows.length) continue;
      const next = resolveBaselineCellEntriesForRead(rows, facility);
      const changes = [];
      next.forEach((row, i) => {
        const before = rows[i];
        if (row.unit !== before.unit || row.volume !== before.volume) {
          changes.push(`${field === "activeCellEntries" ? "A" : "C"} ${row.cellName || before.cellName}: ${before.volume} ${before.unit} → ${row.volume} ${row.unit}`);
        }
      });
      if (changes.length) {
        set[field] = next;
        rowsChanged += changes.length;
        if (VERBOSE || !APPLY) {
          console.log(`  ${facility.lgu} [${record._id}]`);
          changes.forEach((c) => console.log(`      ${c}`));
        }
      }
    }
    if (Object.keys(set).length) pending.push({ _id: record._id, set });
  }

  console.log(`\n${APPLY ? "APPLYING" : "DRY-RUN"} — baseline cell unit merge`);
  console.log(`  Records examined:  ${records.length}`);
  console.log(`  Rows to convert:   ${rowsChanged}`);
  console.log(`  Records to write:  ${pending.length}`);

  if (APPLY && pending.length) {
    // updateOne with $set on the arrays only — no other field is touched and the
    // document's validators/hooks are not re-run on unrelated data.
    const ops = pending.map((p) => ({ updateOne: { filter: { _id: p._id }, update: { $set: p.set } } }));
    const result = await DataSLF.bulkWrite(ops, { ordered: false });
    console.log(`  Written:           ${result.modifiedCount}`);
  } else if (!APPLY) {
    console.log("\n  Nothing written. Re-run with --apply to merge.");
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
