/**
 * Data recovery: restore missing DataSLF.totalVolumeAccepted ("Total Volume of
 * Waste Accepted") on portal Baseline Data records.
 *
 * Background (root cause):
 *   • The portal Baseline "Total Volume Accepted" is the canonical field
 *     DataSLF.totalVolumeAccepted (Number). It was disappearing because a partial
 *     baseline save could $set it to null (an unrelated edit carrying an empty/
 *     non-numeric value). The route now guards against that (see
 *     routes/dataSLF.js → portal-save-baseline). This script recovers values that
 *     were ALREADY lost, from sources that still hold them.
 *
 * Recovery sources, in priority order (a value is NEVER invented/estimated):
 *   1. Another DataSLF record for the SAME SLF (matched by slfGenerator, else by
 *      normalized slfName / lguCompanyName) that still has totalVolumeAccepted.
 *   2. Legacy SLFGenerator (collection `slfgenerators`) matched by normalized
 *      slfName: totalVolumeSinceOperation, else existingBaselineVolume.
 *
 * Safety:
 *   • DRY-RUN by default — prints a full report and writes NOTHING.
 *   • --apply performs a JSON backup of every record it will touch FIRST, then
 *     $sets totalVolumeAccepted only where it is currently null/undefined. It never
 *     overwrites a valid existing value, and never touches records it cannot
 *     recover from.
 *   • Writes an "unrecoverable" report so those records can be followed up manually.
 *
 * Usage:
 *   node scripts/recoverTotalVolumeAccepted.js                 # dry-run report
 *   node scripts/recoverTotalVolumeAccepted.js --apply         # backup + write
 *   node scripts/recoverTotalVolumeAccepted.js --apply --out=./recovery
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
require("dotenv").config();

const DataSLF = require("../models/DataSLF");
const SLFGenerator = require("../models/SLFGenerator");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const APPLY = process.argv.includes("--apply");
const OUT_DIR =
  (process.argv.find((a) => a.startsWith("--out=")) || "").split("=")[1] ||
  path.join(__dirname, "recovery-output");

// Mirror routes/dataSLF.js normalizeSlfName so name matching agrees with the app.
function normalizeSlfName(value) {
  return String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
    .replace(/\blgu\b/gi, " ")
    .replace(/\bmunicipality\s+of\b/gi, " ")
    .replace(/\bcity\s+of\b/gi, " ")
    .replace(/^province\s+of\s+/i, "")
    .replace(/[‒-―-]+/g, " ")
    .replace(/[,.;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A record carries baseline data (so a missing total volume is a real gap, not an
// empty record). Mirrors hasBaselineData() in the route.
function hasBaselineData(e) {
  return !!(
    e?.activeCellResidualVolume != null ||
    e?.activeCellInertVolume != null ||
    e?.activeCellHazardousVolume != null ||
    e?.closedCellResidualVolume != null ||
    e?.closedCellInertVolume != null ||
    e?.closedCellHazardousVolume != null ||
    e?.activeCellEntries?.length ||
    e?.closedCellEntries?.length ||
    e?.accreditedHaulers?.length
  );
}

const isNum = (v) => v != null && v !== "" && Number.isFinite(Number(v));
const isBaselineOnly = (e) => !(Array.isArray(e?.trucks) ? e.trucks : []).length;

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to ${MONGODB_URI}`);
  console.log(APPLY ? "MODE: APPLY (will back up then write)" : "MODE: DRY-RUN (no writes)");

  // Every DataSLF record with any baseline signal — one pass, then index in memory.
  const all = await DataSLF.find({})
    .setOptions({ includeHiddenYears: true })
    .select(
      "_id slfGenerator slfName lguCompanyName trucks totalVolumeAccepted totalVolumeAcceptedUnit baselineUnit " +
        "activeCellResidualVolume activeCellInertVolume activeCellHazardousVolume " +
        "closedCellResidualVolume closedCellInertVolume closedCellHazardousVolume " +
        "activeCellEntries closedCellEntries accreditedHaulers createdAt updatedAt",
    )
    .lean();

  // Index of same-SLF donors that still have a value.
  const donorsByGen = new Map(); // genId -> [{value, unit, updatedAt}]
  const donorsByName = new Map(); // normName -> [...]
  for (const d of all) {
    if (!isNum(d.totalVolumeAccepted)) continue;
    const donor = {
      value: Number(d.totalVolumeAccepted),
      unit: d.totalVolumeAcceptedUnit || d.baselineUnit || null,
      updatedAt: d.updatedAt || d.createdAt || 0,
    };
    if (d.slfGenerator) {
      const k = String(d.slfGenerator);
      (donorsByGen.get(k) || donorsByGen.set(k, []).get(k)).push(donor);
    }
    for (const name of [d.slfName, d.lguCompanyName]) {
      const nk = normalizeSlfName(name);
      if (nk) (donorsByName.get(nk) || donorsByName.set(nk, []).get(nk)).push(donor);
    }
  }
  const pickLatest = (arr) =>
    (arr || []).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null;

  // Legacy SLFGenerator index by normalized slfName.
  const legacy = await SLFGenerator.find({})
    .select("slfName totalVolumeSinceOperation totalVolumeSinceOperationUnit existingBaselineVolume existingBaselineUnit")
    .lean();
  const legacyByName = new Map();
  for (const g of legacy) {
    const nk = normalizeSlfName(g.slfName);
    if (nk) legacyByName.set(nk, g);
  }

  // Targets: baseline-only records the portal reads, missing the value but holding
  // other baseline data.
  const targets = all.filter(
    (d) => isBaselineOnly(d) && !isNum(d.totalVolumeAccepted) && hasBaselineData(d),
  );
  const alreadyValid = all.filter((d) => isBaselineOnly(d) && isNum(d.totalVolumeAccepted)).length;

  const recovered = [];
  const unrecoverable = [];

  for (const t of targets) {
    let source = null;
    // 1) same-SLF donor by generator id
    if (t.slfGenerator) source = pickLatest(donorsByGen.get(String(t.slfGenerator)));
    // 2) same-SLF donor by normalized name
    if (!source) {
      for (const name of [t.slfName, t.lguCompanyName]) {
        const nk = normalizeSlfName(name);
        const cand = pickLatest(donorsByName.get(nk));
        if (cand) { source = { ...cand, via: "same-slf-name" }; break; }
      }
    } else {
      source.via = "same-slf-generator";
    }
    // 3) legacy SLFGenerator
    if (!source) {
      for (const name of [t.slfName, t.lguCompanyName]) {
        const g = legacyByName.get(normalizeSlfName(name));
        if (!g) continue;
        if (isNum(g.totalVolumeSinceOperation) && Number(g.totalVolumeSinceOperation) > 0) {
          source = { value: Number(g.totalVolumeSinceOperation), unit: g.totalVolumeSinceOperationUnit, via: "legacy-totalVolumeSinceOperation" };
          break;
        }
        if (isNum(g.existingBaselineVolume) && Number(g.existingBaselineVolume) > 0) {
          source = { value: Number(g.existingBaselineVolume), unit: g.existingBaselineUnit, via: "legacy-existingBaselineVolume" };
          break;
        }
      }
    }

    if (source && isNum(source.value)) {
      recovered.push({
        _id: t._id,
        slfName: t.slfName || t.lguCompanyName || "(unknown)",
        value: Number(source.value),
        unit: source.unit || t.baselineUnit || null,
        via: source.via,
        _prevUnit: t.totalVolumeAcceptedUnit || null,
      });
    } else {
      unrecoverable.push({
        _id: String(t._id),
        slfName: t.slfName || t.lguCompanyName || "(unknown)",
        slfGenerator: t.slfGenerator ? String(t.slfGenerator) : null,
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n===== Total Volume Accepted — recovery report =====");
  console.log(`Baseline-only records scanned:        ${all.filter(isBaselineOnly).length}`);
  console.log(`Already valid (had a value):          ${alreadyValid}`);
  console.log(`Missing + baseline data (targets):    ${targets.length}`);
  console.log(`Recoverable (source found):           ${recovered.length}`);
  console.log(`NOT recoverable automatically:        ${unrecoverable.length}`);
  const bySource = recovered.reduce((m, r) => ((m[r.via] = (m[r.via] || 0) + 1), m), {});
  console.log(`Recovery sources:`, bySource);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(OUT_DIR, `recovery-plan-${stamp}.json`), JSON.stringify(recovered, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `unrecoverable-${stamp}.json`), JSON.stringify(unrecoverable, null, 2));
  console.log(`\nPlan + unrecoverable list written to: ${OUT_DIR}`);

  if (!APPLY) {
    console.log("\nDRY-RUN complete. Re-run with --apply to back up and write these values.");
    await mongoose.disconnect();
    return;
  }

  // ── Apply (backup first) ───────────────────────────────────────────────────
  const backupIds = recovered.map((r) => r._id);
  const backup = await DataSLF.find({ _id: { $in: backupIds } })
    .setOptions({ includeHiddenYears: true })
    .lean();
  fs.writeFileSync(path.join(OUT_DIR, `backup-${stamp}.json`), JSON.stringify(backup, null, 2));
  console.log(`Backed up ${backup.length} records before writing.`);

  const ops = recovered.map((r) => {
    const set = { totalVolumeAccepted: r.value };
    // Only stamp a unit when the record has none (never relabel an existing unit).
    if (!r._prevUnit && r.unit) set.totalVolumeAcceptedUnit = r.unit;
    return {
      updateOne: {
        // Re-assert the guard at write time: only fill records STILL missing a value.
        filter: {
          _id: r._id,
          $or: [{ totalVolumeAccepted: null }, { totalVolumeAccepted: { $exists: false } }],
        },
        update: { $set: set },
      },
    };
  });
  const res = ops.length ? await DataSLF.bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };
  console.log(`\nAPPLIED. Records updated: ${res.modifiedCount || 0} (of ${recovered.length} planned).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Recovery failed:", err);
  process.exit(1);
});
