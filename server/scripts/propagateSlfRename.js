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
const SupportTicket = require("../models/SupportTicket");
const Transaction = require("../models/Transaction");
const { facilityDisplayName } = require("../utils/slfIdentity");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";

// Every snapshot is compared against the DISPLAY name — `lgu (ownership)`, the
// one string utils/slfIdentity composes and the facility PUT route propagates.
// This script used to write `lgu` alone, which for a facility with an ownership
// would have produced a third spelling instead of collapsing the second.
//
// A stale spelling is anything id-anchored that differs from the display name.
// Observed live for BESLF: the facility's `lgu` had carried a line break, and
// after it was corrected on the facility every snapshot — 97 submissions, the
// operator's assignment, 7 tickets, 14 transactions — still read
// "…Landfill\nFacility (BESLF) (Private)", so name-grouped lists showed the
// facility twice.
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Matches the display name with ANY run of whitespace (space, newline, tab)
// between its words — the only kind of variant a name can drift into without
// becoming a different name.
function whitespaceVariantRegex(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(`^\\s*${words.join("\\s+")}\\s*$`);
}

async function propagate({ dry = false, facilityId = null } = {}) {
  const facFilter = { deletedAt: null };
  if (facilityId) {
    if (!mongoose.isValidObjectId(facilityId)) throw new Error(`Invalid facility id: ${facilityId}`);
    facFilter._id = facilityId;
  }
  const facilities = await SlfFacility.find(facFilter).select("_id lgu ownership").lean();
  const report = {
    mode: dry ? "dry-run" : "applied",
    facilitiesChecked: facilities.length,
    submissionsUpdated: 0,
    portalNamesUpdated: 0,
    ticketsUpdated: 0,
    transactionsUpdated: 0,
    changes: [],
  };

  for (const f of facilities) {
    const currentName = facilityDisplayName(f);
    if (!currentName) continue;

    // The old spellings, taken only from records anchored to THIS facility id —
    // never from a free-text search — so no other facility's name can be pulled in.
    const oldNames = new Set();

    // 1) DataSLF snapshots — matched by slfGenerator ID, only where stale.
    const staleFilter = { slfGenerator: f._id, slfName: { $ne: currentName } };
    const staleCount = await DataSLF.countDocuments(staleFilter);
    if (staleCount > 0) {
      (await DataSLF.distinct("slfName", staleFilter)).forEach((n) => n && oldNames.add(n));
      // Log a sample of the affected ids (audit trail) before touching them.
      const sample = await DataSLF.find(staleFilter).select("_id idNo slfName").limit(20).lean();
      report.changes.push({
        facilityId: String(f._id),
        currentName,
        submissions: staleCount,
        staleNames: [...oldNames],
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
        if (names[idx]) oldNames.add(names[idx]);
        report.changes.push({ portalUserId: String(p._id), email: p.email, facilityId: String(f._id), from: names[idx], to: currentName });
        if (!dry) {
          names[idx] = currentName;
          await UserPortal.updateOne({ _id: p._id }, { $set: { assignedSlfName: names } });
        }
        report.portalNamesUpdated += 1;
      }
    }

    // 3) Support tickets and transactions carry the name as plain text with no
    //    facility id, so they are matched by the stale spellings found above plus
    //    the whitespace-only variants of the current name. A different name that
    //    is not one of those is left alone.
    const variantMatch = { $in: [...oldNames, whitespaceVariantRegex(currentName)] };
    const ticketFilter = { slfName: variantMatch };
    const ticketFilterStrict = { $and: [ticketFilter, { slfName: { $ne: currentName } }] };
    const ticketCount = await SupportTicket.countDocuments(ticketFilterStrict);
    if (ticketCount > 0) {
      report.changes.push({ facilityId: String(f._id), tickets: ticketCount, to: currentName });
      if (!dry) {
        const res = await SupportTicket.updateMany(ticketFilterStrict, { $set: { slfName: currentName } });
        report.ticketsUpdated += res.modifiedCount || 0;
      } else {
        report.ticketsUpdated += ticketCount;
      }
    }
    // Transaction.companyName is normally the waste GENERATOR's name; it holds
    // the SLF name only for ticket transactions (companyName || slfName). Only
    // an exact old spelling of the SLF is rewritten — a generator that happens
    // to share words with the facility does not match.
    const txnFilterStrict = { $and: [{ companyName: variantMatch }, { companyName: { $ne: currentName } }] };
    const txnCount = await Transaction.countDocuments(txnFilterStrict);
    if (txnCount > 0) {
      report.changes.push({ facilityId: String(f._id), transactions: txnCount, to: currentName });
      if (!dry) {
        const res = await Transaction.updateMany(txnFilterStrict, { $set: { companyName: currentName } });
        report.transactionsUpdated += res.modifiedCount || 0;
      } else {
        report.transactionsUpdated += txnCount;
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
      `[propagate-slf-rename] Done. Submissions ${dry ? "to update" : "updated"}: ${report.submissionsUpdated}; portal-name snapshots: ${report.portalNamesUpdated}; tickets: ${report.ticketsUpdated}; transactions: ${report.transactionsUpdated}.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { propagate };
