/**
 * Repair: backfill a valid cell IDENTIFIER (cellIndex) onto disposal waste records
 * that were stored with a cell NAME only.
 *
 * Background
 * ----------
 * A waste record counts as "assigned to a cell" only when it carries a valid
 * `cellIndex` that references an existing, non-deleted facility cell (the schema's
 * required key). Some historical submissions — including approved ones — stored a
 * `cellName` copy WITHOUT a valid `cellIndex`, so their waste was really unassigned
 * even though it looked placed. The portal now treats those as unassigned and shows
 * them in Organize Cells (see portalAuth#isValidCellRef / #summarizeCellAssignment).
 *
 * This script auto-repairs the records whose stored `cellName` can be safely mapped
 * back to a real facility cell (exact name match, or the canonical "Cell N" label),
 * setting the missing `cellIndex`. Records whose name cannot be resolved are left
 * untouched for the portal user to assign a real open cell.
 *
 * Guarantees
 * ----------
 *   • DRY-RUN by default — reports affected submissions + child records, changes
 *     nothing. Pass --apply to write.
 *   • Idempotent — only touches records that lack a valid cellIndex; re-running does
 *     nothing after a successful pass.
 *   • Never changes submission status, never overwrites an existing valid cellIndex,
 *     never creates records, never moves valid assignments.
 *   • Not specific to any account — applies to every portal submission.
 *
 * Usage
 * -----
 *   node scripts/repairCellAssignments.js                 # dry-run, all statuses
 *   node scripts/repairCellAssignments.js --status=approved
 *   node scripts/repairCellAssignments.js --apply         # write changes
 *   node scripts/repairCellAssignments.js --apply --status=approved
 *   node scripts/repairCellAssignments.js --limit=50      # sample the first N
 */
const mongoose = require("mongoose");
require("dotenv").config();

const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const APPLY = process.argv.includes("--apply");
const STATUS = (process.argv.find((a) => a.startsWith("--status=")) || "").split("=")[1] || null;
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 0;

// Mirror of portalAuth#isValidCellRef so the script and the runtime agree exactly.
function isValidCellRef(cellIndex, cellNames, cellStatuses) {
  if (cellIndex === null || cellIndex === undefined || cellIndex === "") return false;
  const idx = Number(cellIndex);
  if (!Number.isInteger(idx) || idx < 0) return false;
  const count = Math.max(
    Array.isArray(cellNames) ? cellNames.length : 0,
    Array.isArray(cellStatuses) ? cellStatuses.length : 0,
  );
  if (count > 0 && idx >= count) return false;
  const status = cellStatuses?.[idx];
  if (status && /not\s*exist/i.test(String(status))) return false;
  return true;
}

// Resolve a stored cell NAME back to a valid facility cell index. Tries an exact
// (case-insensitive) name match against the facility's cellNames first, then the
// canonical "Cell N" label. Returns null when it cannot be resolved safely.
function resolveIndexFromName(cellName, cellNames, cellStatuses) {
  const name = String(cellName || "").trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  if (Array.isArray(cellNames)) {
    for (let i = 0; i < cellNames.length; i += 1) {
      if (String(cellNames[i] || "").trim().toLowerCase() === lower) {
        return isValidCellRef(i, cellNames, cellStatuses) ? i : null;
      }
    }
  }
  const m = lower.match(/^cell\s*(\d+)$/);
  if (m) {
    const idx = Number(m[1]) - 1;
    return isValidCellRef(idx, cellNames, cellStatuses) ? idx : null;
  }
  return null;
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log(
    `Connected. Mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}` +
      `${STATUS ? ` · status=${STATUS}` : " · all statuses"}${LIMIT ? ` · limit=${LIMIT}` : ""}`,
  );

  // Cache facility cell arrays so we don't refetch per submission.
  const facilityCache = new Map();
  const getFacility = async (id) => {
    const key = String(id || "");
    if (!key) return null;
    if (facilityCache.has(key)) return facilityCache.get(key);
    const fac = await SlfFacility.findById(key).select("cellNames cellStatuses numberOfCell").lean();
    facilityCache.set(key, fac || null);
    return fac || null;
  };

  const query = { deletedAt: null };
  if (STATUS) query.status = STATUS;

  const cursor = DataSLF.find(query)
    .setOptions({ includeHiddenYears: true })
    .cursor();

  const stats = {
    scanned: 0,
    submissionsWithNameOnly: 0,
    submissionsRepaired: 0,
    childResolvable: 0,
    childUnresolvable: 0,
    byStatus: {},
  };
  const samples = [];

  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    if (LIMIT && stats.scanned >= LIMIT) break;
    stats.scanned += 1;

    const fac = await getFacility(doc.slfGenerator);
    const cellNames = fac?.cellNames;
    const cellStatuses = fac?.cellStatuses;

    let touched = false;
    let nameOnlyInThisDoc = 0;
    const detail = [];

    const fix = (rec, label) => {
      const vol = Number(rec?.actualVolume || 0);
      if (!(vol > 0)) return; // nothing to place
      if (isValidCellRef(rec.cellIndex, cellNames, cellStatuses)) return; // already valid
      // Name-only (or otherwise invalid ref) record.
      nameOnlyInThisDoc += 1;
      const resolved = resolveIndexFromName(rec.cellName, cellNames, cellStatuses);
      if (resolved === null) {
        stats.childUnresolvable += 1;
        detail.push(`${label}: "${rec.cellName || "(no name)"}" → UNRESOLVED (needs manual assignment)`);
        return;
      }
      stats.childResolvable += 1;
      detail.push(`${label}: "${rec.cellName || ""}" → cellIndex ${resolved}`);
      if (APPLY) {
        rec.cellIndex = resolved;
        // Keep the canonical current name so display stays consistent.
        if (Array.isArray(cellNames) && cellNames[resolved]) rec.cellName = String(cellNames[resolved]).trim();
        touched = true;
      }
    };

    (doc.trucks || []).forEach((truck, ti) => {
      const vehicles = Array.isArray(truck.vehicles) ? truck.vehicles : [];
      if (vehicles.length) {
        vehicles.forEach((v, vi) => fix(v, `truck ${ti + 1} / vehicle ${vi + 1}`));
      } else {
        fix(truck, `truck ${ti + 1}`);
      }
    });

    if (nameOnlyInThisDoc > 0) {
      stats.submissionsWithNameOnly += 1;
      stats.byStatus[doc.status] = (stats.byStatus[doc.status] || 0) + 1;
      if (samples.length < 25) {
        samples.push({
          idNo: doc.idNo || doc.submissionId || String(doc._id),
          status: doc.status,
          slf: doc.slfName || doc.lguCompanyName,
          nameOnly: nameOnlyInThisDoc,
          detail,
        });
      }
    }

    if (APPLY && touched) {
      doc.markModified("trucks");
      await doc.save();
      stats.submissionsRepaired += 1;
    }
  }

  console.log("\n──────── Report ────────");
  console.log(`Submissions scanned:                 ${stats.scanned}`);
  console.log(`Submissions with name-only records:  ${stats.submissionsWithNameOnly}`);
  console.log(`  by status:`, stats.byStatus);
  console.log(`Child records auto-resolvable:       ${stats.childResolvable}`);
  console.log(`Child records needing manual assign: ${stats.childUnresolvable}`);
  if (APPLY) console.log(`Submissions written:                 ${stats.submissionsRepaired}`);
  else console.log(`(DRY-RUN — nothing written. Re-run with --apply to write.)`);

  console.log("\n──────── Sample affected submissions (up to 25) ────────");
  samples.forEach((s) => {
    console.log(`\n• ${s.idNo} [${s.status}] — ${s.slf} (${s.nameOnly} name-only record(s))`);
    s.detail.forEach((d) => console.log(`    ${d}`));
  });

  await mongoose.disconnect();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("repairCellAssignments failed:", err);
  process.exit(1);
});
