/**
 * MIGRATION: collapse duplicated SlfClient.portalUserRelationships entries.
 *
 * Why this exists
 * ---------------
 * relKeyOf in services/syncBaselineClients.js used to include `baselineRef`, so
 * every baseline document that mentioned a client appended a NEW relationship entry
 * rather than refreshing the existing one. The sync seeds prior entries back in and
 * never prunes, so the arrays grew without bound — measured on live data, 23,626
 * stored entries represented only 373 distinct (portal user, hauler) pairs (63x
 * bloat), with a single document already at 499KB. Because MongoDB delivery here is
 * byte-rate bound, that bloat was the dominant cost of every client-facing read.
 *
 * relKeyOf has since been fixed to key on (portal user, hauler). This script
 * collapses the ALREADY-STORED duplicates to match.
 *
 * What it preserves
 * -----------------
 *   • one entry per (portalUser || portalUserEmail, normalizedHauler || hauler)
 *   • firstSyncedAt  → the EARLIEST across the collapsed group (when we first saw it)
 *   • lastSyncedAt   → the LATEST across the group (when we last confirmed it)
 *   • baselineRef    → from the most recently synced entry in the group, matching the
 *                      new "most recent baseline that evidenced this" semantics
 *   • portalUserName / portalUser / hauler → first non-empty value found
 *   • status         → "active" if ANY entry in the group is active, else the newest
 *
 * Nothing is dropped that isn't a duplicate: the set of contributing baselines is
 * already tracked separately in the document-level `baselineReferences` array, and
 * this script back-fills any baselineRef it collapses into that array so no baseline
 * linkage is lost.
 *
 * Usage:
 *   node scripts/collapsePortalUserRelationships.js            (DRY RUN — reports only)
 *   node scripts/collapsePortalUserRelationships.js --apply    (writes the changes)
 *   node scripts/collapsePortalUserRelationships.js --apply --verbose
 */
const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });

const SlfClient = require("../models/SlfClient");

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

const normalize = (v) =>
  String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Must stay in lockstep with relKeyOf in services/syncBaselineClients.js.
const relKeyOf = (r) =>
  `${String(r.portalUser || r.portalUserEmail || "")}|${r.normalizedHauler || normalize(r.hauler)}`;

const time = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * Collapse one relationship array. Returns { rels, extraBaselineRefs }.
 * Pure — no I/O — so it is trivially checkable against the counts printed below.
 */
function collapse(relationships = []) {
  const groups = new Map(); // relKey -> merged entry
  const extraBaselineRefs = [];

  for (const rel of relationships) {
    if (!rel) continue;
    const key = relKeyOf(rel);
    if (rel.baselineRef) extraBaselineRefs.push(String(rel.baselineRef));

    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        portalUser: rel.portalUser || null,
        portalUserEmail: rel.portalUserEmail || "",
        portalUserName: rel.portalUserName || "",
        hauler: rel.hauler || "",
        normalizedHauler: rel.normalizedHauler || normalize(rel.hauler),
        baselineRef: rel.baselineRef || null,
        status: rel.status || "active",
        firstSyncedAt: rel.firstSyncedAt || rel.lastSyncedAt || new Date(),
        lastSyncedAt: rel.lastSyncedAt || rel.firstSyncedAt || new Date(),
      });
      continue;
    }

    // Widen the observed window rather than letting whichever entry sorted last win.
    if (time(rel.firstSyncedAt) && time(rel.firstSyncedAt) < time(current.firstSyncedAt)) {
      current.firstSyncedAt = rel.firstSyncedAt;
    }
    // The newest entry defines the surviving baselineRef — the new field semantics.
    if (time(rel.lastSyncedAt) >= time(current.lastSyncedAt)) {
      current.lastSyncedAt = rel.lastSyncedAt || current.lastSyncedAt;
      if (rel.baselineRef) current.baselineRef = rel.baselineRef;
    }
    // Fill gaps from any entry that happens to carry the value.
    if (!current.portalUser && rel.portalUser) current.portalUser = rel.portalUser;
    if (!current.portalUserEmail && rel.portalUserEmail) current.portalUserEmail = rel.portalUserEmail;
    if (!current.portalUserName && rel.portalUserName) current.portalUserName = rel.portalUserName;
    if (!current.hauler && rel.hauler) current.hauler = rel.hauler;
    // An active relationship anywhere in the group keeps the client active.
    if (String(rel.status || "").toLowerCase() === "active") current.status = "active";
  }

  return { rels: [...groups.values()], extraBaselineRefs };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  console.log(`Connected. Mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}\n`);

  // Every client, including soft-deleted/merged ones — the bloat is on those too and
  // a later restore/merge would otherwise drag it back in.
  const clients = await SlfClient.find({})
    .select("name type portalUserRelationships baselineReferences")
    .lean();

  let scanned = 0;
  let changed = 0;
  let relsBefore = 0;
  let relsAfter = 0;
  let baselineRefsAdded = 0;
  const ops = [];
  const worst = [];

  for (const client of clients) {
    scanned += 1;
    const before = Array.isArray(client.portalUserRelationships) ? client.portalUserRelationships : [];
    relsBefore += before.length;
    if (before.length === 0) continue;

    const { rels, extraBaselineRefs } = collapse(before);
    relsAfter += rels.length;

    // Preserve every baseline linkage the collapsed entries carried.
    const existingRefs = new Set((client.baselineReferences || []).map(String));
    const mergedRefs = new Set([...existingRefs, ...extraBaselineRefs]);
    const gainedRefs = mergedRefs.size - existingRefs.size;

    if (rels.length === before.length && gainedRefs === 0) continue;

    changed += 1;
    baselineRefsAdded += gainedRefs;
    worst.push({ name: client.name, type: client.type, before: before.length, after: rels.length });

    ops.push({
      updateOne: {
        filter: { _id: client._id },
        update: {
          $set: {
            portalUserRelationships: rels,
            baselineReferences: [...mergedRefs].map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
      },
    });
  }
  worst.sort((a, b) => b.before - a.before);
  console.log("Top 10 most-bloated client records:");
  worst.slice(0, 10).forEach((w) => {
    console.log(`  ${String(w.before).padStart(5)} -> ${String(w.after).padStart(3)}   ${w.type} :: ${w.name}`);
  });
  if (VERBOSE) {
    console.log("\nAll changed records:");
    worst.forEach((w) => console.log(`  ${String(w.before).padStart(5)} -> ${String(w.after).padStart(3)}   ${w.name}`));
  }

  console.log(`\nClients scanned:            ${scanned}`);
  console.log(`Clients needing collapse:   ${changed}`);
  console.log(`Relationship entries before: ${relsBefore}`);
  console.log(`Relationship entries after:  ${relsAfter}`);
  console.log(`Reduction:                   ${relsBefore ? (100 - (relsAfter / relsBefore) * 100).toFixed(1) : 0}%`);
  console.log(`baselineReferences recovered: ${baselineRefsAdded}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written. Re-run with --apply to commit.");
    await mongoose.disconnect();
    return;
  }

  if (!ops.length) {
    console.log("\nNothing to do.");
    await mongoose.disconnect();
    return;
  }

  // Chunked so one oversized bulk payload can't blow the 16MB command limit.
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const res = await SlfClient.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    written += res.modifiedCount || 0;
    console.log(`  wrote ${Math.min(i + CHUNK, ops.length)}/${ops.length}`);
  }
  console.log(`\nDone. Documents modified: ${written}`);

  // Post-write confirmation, read back from the database rather than assumed.
  const after = await SlfClient.aggregate([
    { $group: { _id: null, total: { $sum: { $size: { $ifNull: ["$portalUserRelationships", []] } } }, docs: { $sum: 1 } } },
  ]);
  console.log(`Verified in DB: ${after[0]?.total ?? 0} relationship entries across ${after[0]?.docs ?? 0} clients.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
