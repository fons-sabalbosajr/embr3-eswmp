// Item #2 — propagate a renamed SLF's name to the denormalized snapshots.
//
// DataSLF stores BOTH slfGenerator (immutable id) and a copied slfName snapshot;
// UserPortal stores assignedSlf (ids) + parallel assignedSlfName snapshots. When an
// SLF is renamed on the master record (SlfFacility.lgu), those copies go stale. This
// script refreshes them using the SLF **id** as the key — never a name match.
//
// Safe by design:
//   • ID-scoped: only records whose slfGenerator / assignedSlf id matches are touched.
//   • Idempotent: only rows whose stored name differs from the master are updated,
//     so rerunning is a no-op. No unrestricted global text replace.
//   • Dry-run first: `--dry` logs exactly what WOULD change without writing.
//   • Scope to one SLF with `--id=<facilityId>`, or run for all facilities.
//
// Usage:
//   node scripts/propagateSlfRename.js --dry                 # preview all
//   node scripts/propagateSlfRename.js --dry --id=<id>       # preview one SLF
//   node scripts/propagateSlfRename.js --id=<id>             # apply for one SLF
//   node scripts/propagateSlfRename.js                       # apply for all
const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });
const SlfFacility = require("../models/SlfFacility");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";

async function propagate({ dry = false, facilityId = null } = {}) {
  const facFilter = { deletedAt: null };
  if (facilityId) {
    if (!mongoose.isValidObjectId(facilityId)) throw new Error(`Invalid facility id: ${facilityId}`);
    facFilter._id = facilityId;
  }
  const facilities = await SlfFacility.find(facFilter).select("_id lgu").lean();
  const report = {
    mode: dry ? "dry-run" : "applied",
    facilitiesChecked: facilities.length,
    submissionsUpdated: 0,
    portalNamesUpdated: 0,
    changes: [],
  };

  for (const f of facilities) {
    const currentName = String(f.lgu || "").trim();
    if (!currentName) continue;

    // 1) DataSLF snapshots — matched by slfGenerator ID, only where stale.
    const staleFilter = { slfGenerator: f._id, slfName: { $ne: currentName } };
    const staleCount = await DataSLF.countDocuments(staleFilter);
    if (staleCount > 0) {
      // Log a sample of the affected ids (audit trail) before touching them.
      const sample = await DataSLF.find(staleFilter).select("_id idNo slfName").limit(20).lean();
      report.changes.push({
        facilityId: String(f._id),
        currentName,
        submissions: staleCount,
        sample: sample.map((s) => ({ id: String(s._id), idNo: s.idNo, from: s.slfName, to: currentName })),
      });
      if (!dry) {
        const res = await DataSLF.updateMany(staleFilter, { $set: { slfName: currentName } });
        report.submissionsUpdated += res.modifiedCount || 0;
      } else {
        report.submissionsUpdated += staleCount;
      }
    }

    // 2) UserPortal.assignedSlfName snapshots — parallel to assignedSlf ids.
    const portals = await UserPortal.find({ assignedSlf: f._id })
      .select("_id email assignedSlf assignedSlfName")
      .lean();
    for (const p of portals) {
      const ids = (p.assignedSlf || []).map(String);
      const names = [...(p.assignedSlfName || [])];
      const idx = ids.indexOf(String(f._id));
      if (idx >= 0 && names[idx] !== currentName) {
        report.changes.push({ portalUserId: String(p._id), email: p.email, facilityId: String(f._id), from: names[idx], to: currentName });
        if (!dry) {
          names[idx] = currentName;
          await UserPortal.updateOne({ _id: p._id }, { $set: { assignedSlfName: names } });
        }
        report.portalNamesUpdated += 1;
      }
    }
  }
  return report;
}

async function run() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const idArg = args.find((a) => a.startsWith("--id="));
  const facilityId = idArg ? idArg.split("=")[1] : null;

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    console.log(`[propagate-slf-rename] ${dry ? "DRY RUN — no writes" : "APPLYING"}${facilityId ? ` for facility ${facilityId}` : " (all facilities)"}`);
    const report = await propagate({ dry, facilityId });
    console.log(JSON.stringify(report, null, 2));
    console.log(
      `[propagate-slf-rename] Done. Submissions ${dry ? "to update" : "updated"}: ${report.submissionsUpdated}; portal-name snapshots: ${report.portalNamesUpdated}.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { propagate };
