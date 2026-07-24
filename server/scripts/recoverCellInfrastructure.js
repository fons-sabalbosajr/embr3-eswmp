/**
 * Inspect + recover wiped Cell Infrastructure on SlfFacility records.
 *
 * Background: a Global-Unit-Tool save in the Edit SLF Facility modal could persist
 * a payload that blanked the per-cell arrays (cellNames/cellCapacities/…). The
 * facility route now guards against empty-array wipes (see routes/slfFacilities.js)
 * and the modal reads the live form store, so this stops recurring. This script
 * recovers records already affected.
 *
 * What it does:
 *   1. Reports every SlfFacility that declares cells (numberOfCell > 0) but whose
 *      cell arrays are empty — the signature of a wipe.
 *   2. For each, looks for a RESTORE SOURCE: another SlfFacility with the same
 *      normalized province+lgu(+barangay) that still has populated cell arrays
 *      (prefers the most recently updated). This is typically the same facility's
 *      record for another dataYear.
 *   3. DRY-RUN by default (reports only). With --apply it backs up affected records
 *      to JSON first, then restores the cell arrays ONLY where the target is empty.
 *
 * It never invents data and never overwrites populated cell arrays.
 *
 * Usage:
 *   node scripts/recoverCellInfrastructure.js
 *   node scripts/recoverCellInfrastructure.js --lgu="Name of LGU"
 *   node scripts/recoverCellInfrastructure.js --apply
 *   node scripts/recoverCellInfrastructure.js --apply --out=./recovery
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const SlfFacility = require("../models/SlfFacility");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const APPLY = process.argv.includes("--apply");
const LGU_FILTER = (process.argv.find((a) => a.startsWith("--lgu=")) || "").split("=")[1] || "";
const OUT_DIR =
  (process.argv.find((a) => a.startsWith("--out=")) || "").split("=")[1] ||
  path.join(__dirname, "recovery-output");

const CELL_ARRAYS = [
  "cellNames", "cellCapacities", "cellCapacityUnits", "cellStatuses",
  "cellTypes", "cellSubmissionAllowed", "cellNotes", "cellFillValues", "cellFillUnits",
];

const norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
const identityKey = (f) => [norm(f.province), norm(f.lgu), norm(f.barangay)].join("|");
const nonEmpty = (a) => Array.isArray(a) && a.length > 0;

// "Wiped": declares cells but has no cell names AND no capacities recorded.
const looksWiped = (f) =>
  Number(f.numberOfCell) > 0 && !nonEmpty(f.cellNames) && !nonEmpty(f.cellCapacities);
// "Has data": a usable restore source.
const hasCellData = (f) => nonEmpty(f.cellNames) || nonEmpty(f.cellCapacities);

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to ${MONGODB_URI}`);
  console.log(APPLY ? "MODE: APPLY (backup then restore)" : "MODE: DRY-RUN (no writes)");

  const query = { deletedAt: null };
  if (LGU_FILTER) query.lgu = new RegExp(LGU_FILTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const all = await SlfFacility.find(query)
    .select(
      "_id lgu province barangay dataYear numberOfCell updatedAt createdAt " +
        CELL_ARRAYS.join(" "),
    )
    .lean();

  // Index potential restore sources by facility identity.
  const sourcesByIdentity = new Map();
  for (const f of all) {
    if (!hasCellData(f)) continue;
    const k = identityKey(f);
    (sourcesByIdentity.get(k) || sourcesByIdentity.set(k, []).get(k)).push(f);
  }
  const pickSource = (target) => {
    const list = (sourcesByIdentity.get(identityKey(target)) || [])
      .filter((s) => String(s._id) !== String(target._id))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    return list[0] || null;
  };

  const wiped = all.filter(looksWiped);
  const recoverable = [];
  const unrecoverable = [];
  for (const t of wiped) {
    const src = pickSource(t);
    if (src) recoverable.push({ target: t, source: src });
    else unrecoverable.push(t);
  }

  console.log("\n===== Cell Infrastructure — recovery report =====");
  console.log(`Facilities scanned:               ${all.length}`);
  console.log(`Declares cells but arrays empty:  ${wiped.length}`);
  console.log(`Recoverable (sibling source):     ${recoverable.length}`);
  console.log(`NOT recoverable automatically:    ${unrecoverable.length}`);
  for (const { target, source } of recoverable) {
    console.log(
      `  • ${target.lgu} [${target.dataYear}] (${target._id}) ← restore from ${source.lgu} [${source.dataYear}] (${source._id}), ${source.cellNames?.length || source.cellCapacities?.length} cells`,
    );
  }
  for (const t of unrecoverable) {
    console.log(`  ✗ ${t.lgu} [${t.dataYear}] (${t._id}) — no populated sibling found`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(OUT_DIR, `cell-recovery-plan-${stamp}.json`),
    JSON.stringify(
      recoverable.map((r) => ({
        targetId: String(r.target._id), targetLgu: r.target.lgu, targetYear: r.target.dataYear,
        sourceId: String(r.source._id), sourceYear: r.source.dataYear,
      })),
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, `cell-unrecoverable-${stamp}.json`),
    JSON.stringify(unrecoverable.map((t) => ({ id: String(t._id), lgu: t.lgu, dataYear: t.dataYear })), null, 2),
  );
  console.log(`\nReports written to: ${OUT_DIR}`);

  if (!APPLY) {
    console.log("\nDRY-RUN complete. Review the plan, then re-run with --apply to restore.");
    console.log("If a facility is NOT recoverable here, restore it from a mongodump backup of the `slf_facilities` collection.");
    await mongoose.disconnect();
    return;
  }

  // Back up the FULL current target docs before writing.
  const targetIds = recoverable.map((r) => r.target._id);
  const backup = await SlfFacility.find({ _id: { $in: targetIds } }).lean();
  fs.writeFileSync(path.join(OUT_DIR, `cell-backup-${stamp}.json`), JSON.stringify(backup, null, 2));
  console.log(`Backed up ${backup.length} target records before writing.`);

  let restored = 0;
  for (const { target, source } of recoverable) {
    const set = {};
    for (const key of CELL_ARRAYS) if (nonEmpty(source[key])) set[key] = source[key];
    // Only restore records STILL wiped (re-assert guard at write time).
    const res = await SlfFacility.updateOne(
      { _id: target._id, $or: [{ cellNames: { $size: 0 } }, { cellNames: { $exists: false } }] },
      { $set: set },
    );
    restored += res.modifiedCount || 0;
  }
  console.log(`\nAPPLIED. Facilities restored: ${restored} (of ${recoverable.length} planned).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Cell recovery failed:", err);
  process.exit(1);
});
