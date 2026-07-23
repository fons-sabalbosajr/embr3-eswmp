// One-time (re-runnable) consolidation of duplicate / stale SLF identities.
//
// WHY
// ---
// Submissions, baselines and portal assignments are linked to an SLF by the
// SlfFacility `_id`, but they ALSO store a denormalized `slfName` snapshot. When a
// facility is renamed — or a submission is written with a name captured before the
// rename — those snapshots go stale, and anything that groups by NAME (the
// Portal Submissions summary breakdown, exports, filters) shows the same SLF twice
// and double-counts its totals. That is exactly what happened to
// "Pampanga - Floridablanca Enviro Park Sanitary Landfill (Cat 4) (Private)" vs
// "Floridablanca Enviro Park - Category 4 Sanitary Landfill (Private)".
//
// WHAT IT DOES (in this order, all id-keyed and idempotent)
//   1. Re-syncs every DataSLF.slfName / lguCompanyName snapshot to the canonical
//      display name of the facility its slfGenerator points at.
//   2. Re-syncs every UserPortal.assignedSlfName entry to the same canonical name,
//      matched positionally against assignedSlf ids.
//   3. Re-links legacy DataSLF records that have NO slfGenerator but whose name
//      unambiguously matches exactly one facility.
//   4. Reports facility records that look like genuine duplicates of the SAME site
//      in the SAME dataYear, and (with --merge-facilities) reassigns their linked
//      records to the canonical facility and soft-deletes the loser.
//
// SAFETY
//   • Nothing is ever hard-deleted. Duplicate facilities are soft-deleted
//     (deletedAt) only under the explicit --merge-facilities flag, and only after
//     their submissions, baselines and portal assignments are reassigned.
//   • Facility rows that differ only by dataYear are YEAR VERSIONS, not duplicates
//     — they are always skipped and reported as such.
//   • --dry (the default posture you should run first) writes nothing.
//
// USAGE
//   node scripts/consolidateDuplicateSlf.js --dry              # preview everything
//   node scripts/consolidateDuplicateSlf.js                    # apply steps 1-3
//   node scripts/consolidateDuplicateSlf.js --dry --merge-facilities
//   node scripts/consolidateDuplicateSlf.js --merge-facilities # also apply step 4
//   node scripts/consolidateDuplicateSlf.js --json             # machine-readable
const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });
const SlfFacility = require("../models/SlfFacility");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const { bypassYearVisibility } = require("../utils/yearVisibility");
const {
  facilityDisplayName,
  normalizeSlfName,
  isSameSlfSite,
} = require("../utils/slfIdentity");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";

const DRY = process.argv.includes("--dry");
const MERGE_FACILITIES = process.argv.includes("--merge-facilities");
const AS_JSON = process.argv.includes("--json");

function log(...args) {
  if (!AS_JSON) console.log(...args);
}

// The facility row that should own the identity: newest dataYear wins, then the
// most recently updated. Never chosen by name length or by record count, so the
// result is stable across re-runs.
function chooseCanonical(facilities) {
  return [...facilities].sort((a, b) => {
    const yearDiff = (b.dataYear || 0) - (a.dataYear || 0);
    if (yearDiff !== 0) return yearDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  })[0];
}

async function consolidate() {
  const report = {
    mode: DRY ? "dry-run" : "applied",
    mergeFacilities: MERGE_FACILITIES,
    facilitiesScanned: 0,
    duplicatesFound: [],
    canonicalSelected: [],
    submissionNamesResynced: 0,
    portalNamesResynced: 0,
    orphanRecordsRelinked: 0,
    facilityRecordsReassigned: 0,
    facilitiesArchived: 0,
    skipped: [],
    changes: [],
  };

  const facilities = await SlfFacility.find({ deletedAt: null })
    .select("_id lgu ownership province barangay dataYear updatedAt")
    .setOptions({ includeHiddenYears: true })
    .lean();
  report.facilitiesScanned = facilities.length;

  // ── 1. DataSLF name snapshots — keyed on slfGenerator id, never on a name ──
  log("\n── Step 1: re-sync submission/baseline name snapshots ──");
  for (const facility of facilities) {
    const canonicalName = facilityDisplayName(facility);
    if (!canonicalName) continue;
    const staleFilter = {
      slfGenerator: facility._id,
      slfName: { $ne: canonicalName },
    };
    const stale = await DataSLF.find(staleFilter)
      .select("_id idNo slfName lguCompanyName")
      .setOptions({ includeHiddenYears: true })
      .lean();
    if (!stale.length) continue;

    log(
      `  ${facility._id} → "${canonicalName}": ${stale.length} record(s) carry a stale name`,
    );
    stale.slice(0, 10).forEach((doc) => {
      log(`      ${doc.idNo || doc._id}: "${doc.slfName}"`);
      report.changes.push({
        step: "name-resync",
        record: doc.idNo || String(doc._id),
        from: doc.slfName,
        to: canonicalName,
      });
    });
    if (stale.length > 10) log(`      … and ${stale.length - 10} more`);

    if (!DRY) {
      const result = await DataSLF.updateMany(staleFilter, {
        $set: { slfName: canonicalName },
      }).setOptions({ includeHiddenYears: true });
      report.submissionNamesResynced += result.modifiedCount || 0;
    } else {
      report.submissionNamesResynced += stale.length;
    }
  }

  // ── 2. Portal user assignment name snapshots (positional against ids) ──
  log("\n── Step 2: re-sync portal user assigned-SLF names ──");
  const facilityById = new Map(facilities.map((f) => [String(f._id), f]));
  const portalUsers = await UserPortal.find({
    assignedSlf: { $exists: true, $ne: [] },
  })
    .select("email assignedSlf assignedSlfName")
    .lean();

  for (const user of portalUsers) {
    const ids = (user.assignedSlf || []).map((id) => String(id));
    const names = Array.isArray(user.assignedSlfName)
      ? [...user.assignedSlfName]
      : [];
    let changed = false;
    ids.forEach((id, index) => {
      const facility = facilityById.get(id);
      if (!facility) return;
      const canonicalName = facilityDisplayName(facility);
      if (!canonicalName || names[index] === canonicalName) return;
      report.changes.push({
        step: "portal-name-resync",
        record: user.email,
        from: names[index] || "(unset)",
        to: canonicalName,
      });
      log(`  ${user.email}[${index}]: "${names[index] || "(unset)"}" → "${canonicalName}"`);
      names[index] = canonicalName;
      changed = true;
    });
    if (!changed) continue;
    report.portalNamesResynced += 1;
    if (!DRY) {
      await UserPortal.updateOne(
        { _id: user._id },
        { $set: { assignedSlfName: names } },
      );
    }
  }

  // ── 3. Legacy records with no facility id — re-link where UNAMBIGUOUS ──
  log("\n── Step 3: re-link records that carry no facility id ──");
  const orphans = await DataSLF.find({
    $or: [{ slfGenerator: null }, { slfGenerator: { $exists: false } }],
  })
    .select("_id idNo slfName lguCompanyName")
    .setOptions({ includeHiddenYears: true })
    .lean();

  for (const orphan of orphans) {
    const orphanKeys = [orphan.slfName, orphan.lguCompanyName]
      .map(normalizeSlfName)
      .filter(Boolean);
    if (!orphanKeys.length) continue;
    const matches = facilities.filter((facility) =>
      orphanKeys.includes(normalizeSlfName(facilityDisplayName(facility))) ||
      orphanKeys.includes(normalizeSlfName(facility.lgu)),
    );
    // Multiple facility rows for the SAME site (year versions) still resolve to a
    // single identity — pick the canonical one. Genuinely different sites do not,
    // so those are left alone rather than guessed at.
    const distinctSites = matches.filter(
      (facility, index) =>
        matches.findIndex((other) => isSameSlfSite(other, facility)) === index,
    );
    if (distinctSites.length !== 1) {
      if (matches.length) {
        report.skipped.push({
          step: "relink",
          record: orphan.idNo || String(orphan._id),
          reason: `name "${orphan.slfName}" matches ${distinctSites.length} distinct facilities — needs manual review`,
        });
      }
      continue;
    }
    const target = chooseCanonical(matches);
    const canonicalName = facilityDisplayName(target);
    log(`  ${orphan.idNo || orphan._id}: link → ${target._id} ("${canonicalName}")`);
    report.changes.push({
      step: "relink",
      record: orphan.idNo || String(orphan._id),
      from: orphan.slfName || "(unnamed)",
      to: `${canonicalName} [${target._id}]`,
    });
    report.orphanRecordsRelinked += 1;
    if (!DRY) {
      await DataSLF.updateOne(
        { _id: orphan._id },
        { $set: { slfGenerator: target._id, slfName: canonicalName } },
      ).setOptions({ includeHiddenYears: true });
    }
  }

  // ── 4. Genuine duplicate facility records for the same site + dataYear ──
  log("\n── Step 4: duplicate facility detection ──");
  const groups = [];
  for (const facility of facilities) {
    const group = groups.find((g) => isSameSlfSite(g[0], facility));
    if (group) group.push(facility);
    else groups.push([facility]);
  }

  for (const group of groups) {
    if (group.length < 2) continue;
    const byYear = new Map();
    group.forEach((facility) => {
      const year = facility.dataYear || 0;
      byYear.set(year, [...(byYear.get(year) || []), facility]);
    });

    const sameYearDupes = [...byYear.values()].filter((rows) => rows.length > 1);
    if (!sameYearDupes.length) {
      // Same site across several dataYears — this is the intended year-versioned
      // model of the SLF Data Table, NOT a duplicate. Never merge these.
      report.skipped.push({
        step: "facility-merge",
        record: facilityDisplayName(group[0]),
        reason: `${group.length} facility row(s) differ only by dataYear (${[...byYear.keys()].sort().join(", ")}) — year versions, not duplicates`,
      });
      log(
        `  SKIP "${facilityDisplayName(group[0])}": ${group.length} rows are year versions (${[...byYear.keys()].sort().join(", ")})`,
      );
      continue;
    }

    for (const rows of sameYearDupes) {
      const canonical = chooseCanonical(rows);
      const losers = rows.filter((r) => String(r._id) !== String(canonical._id));
      report.duplicatesFound.push({
        site: facilityDisplayName(canonical),
        dataYear: canonical.dataYear || null,
        records: rows.map((r) => ({
          id: String(r._id),
          name: facilityDisplayName(r),
          dataYear: r.dataYear || null,
        })),
      });
      report.canonicalSelected.push({
        site: facilityDisplayName(canonical),
        canonicalId: String(canonical._id),
        canonicalName: facilityDisplayName(canonical),
      });
      log(
        `  DUPLICATE "${facilityDisplayName(canonical)}" (dataYear ${canonical.dataYear}): keeping ${canonical._id}`,
      );

      for (const loser of losers) {
        const linkedSubmissions = await DataSLF.countDocuments({
          slfGenerator: loser._id,
        }).setOptions({ includeHiddenYears: true });
        const linkedUsers = await UserPortal.countDocuments({
          assignedSlf: loser._id,
        });
        log(
          `    ${loser._id} ("${facilityDisplayName(loser)}"): ${linkedSubmissions} submission/baseline record(s), ${linkedUsers} portal user(s)`,
        );
        report.changes.push({
          step: "facility-merge",
          record: String(loser._id),
          from: facilityDisplayName(loser),
          to: `${facilityDisplayName(canonical)} [${canonical._id}]`,
          linkedSubmissions,
          linkedUsers,
        });

        if (!MERGE_FACILITIES) {
          report.skipped.push({
            step: "facility-merge",
            record: String(loser._id),
            reason: "pass --merge-facilities to reassign and archive this record",
          });
          continue;
        }

        report.facilityRecordsReassigned += linkedSubmissions;
        if (DRY) {
          report.facilitiesArchived += 1;
          continue;
        }

        // Reassign FIRST — history is never orphaned by the archive below.
        await DataSLF.updateMany(
          { slfGenerator: loser._id },
          {
            $set: {
              slfGenerator: canonical._id,
              slfName: facilityDisplayName(canonical),
            },
          },
        ).setOptions({ includeHiddenYears: true });

        const assignedUsers = await UserPortal.find({ assignedSlf: loser._id })
          .select("assignedSlf assignedSlfName")
          .lean();
        for (const user of assignedUsers) {
          const ids = (user.assignedSlf || []).map(String);
          const names = Array.isArray(user.assignedSlfName)
            ? [...user.assignedSlfName]
            : [];
          const nextIds = [];
          const nextNames = [];
          ids.forEach((id, index) => {
            const resolved = id === String(loser._id) ? String(canonical._id) : id;
            if (nextIds.includes(resolved)) return; // already assigned — don't duplicate
            nextIds.push(resolved);
            nextNames.push(
              resolved === String(canonical._id)
                ? facilityDisplayName(canonical)
                : names[index],
            );
          });
          await UserPortal.updateOne(
            { _id: user._id },
            { $set: { assignedSlf: nextIds, assignedSlfName: nextNames } },
          );
        }

        await SlfFacility.updateOne(
          { _id: loser._id },
          {
            $set: {
              deletedAt: new Date(),
              deletedBy: "script:consolidateDuplicateSlf",
            },
          },
        ).setOptions({ includeHiddenYears: true });
        report.facilitiesArchived += 1;
      }
    }
  }

  return report;
}

async function run() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  // Historical years may be hidden app-wide; consolidation must still see them.
  const report = await bypassYearVisibility(() => consolidate());

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\n────────── SUMMARY ──────────");
    console.log(`Mode                        : ${report.mode}`);
    console.log(`Facilities scanned          : ${report.facilitiesScanned}`);
    console.log(`Duplicate facility groups   : ${report.duplicatesFound.length}`);
    console.log(`Canonical records selected  : ${report.canonicalSelected.length}`);
    console.log(`Submission names re-synced  : ${report.submissionNamesResynced}`);
    console.log(`Portal users re-synced      : ${report.portalNamesResynced}`);
    console.log(`Orphan records re-linked    : ${report.orphanRecordsRelinked}`);
    console.log(`Records reassigned (merge)  : ${report.facilityRecordsReassigned}`);
    console.log(`Facilities archived         : ${report.facilitiesArchived}`);
    console.log(`Skipped                     : ${report.skipped.length}`);
    report.skipped.forEach((s) => console.log(`   • [${s.step}] ${s.record}: ${s.reason}`));
    if (report.mode === "dry-run") {
      console.log("\nDry run — nothing was written. Re-run without --dry to apply.");
    }
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Consolidation failed:", err);
  process.exit(1);
});
