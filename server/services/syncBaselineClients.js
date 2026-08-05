// Baseline → SlfClient synchronization service (canonical-client model).
//
// Builds ONE canonical client profile per unique client (normalizedName + type),
// no matter how many haulers / portal users / baselines list it, and records the
// per-portal-user + hauler + baseline relationships ON that canonical profile.
// It then RE-QUERIES MongoDB for the authoritative counts and validates them.
// Un-syncable / suspicious records become SlfDataIssue flags (never dropped).
//
// Idempotent: matching is by canonicalKey and relationships are de-duplicated by
// (portalUser|hauler|baseline), so re-runs never add client rows or duplicate
// relationships. Existing canonicals (incl. admin-managed) are enriched in place,
// so manual data is preserved. Uses a single read of existing canonicals + one
// bulkWrite (no per-record query inside the loop).
//
// Progress is reported via onProgress() (persisted to SlfSyncJob + socket).

const SlfClient = require("../models/SlfClient");
const SlfDataIssue = require("../models/SlfDataIssue");
const UserPortal = require("../models/UserPortal");
const { getRegion3ProvinceSet, classifyRegion, REGION_CLASS, normalizeName } = require("../utils/region3");

const normalize = SlfClient.normalize;

const STAGES = [
  { key: "reading-baselines", label: "Reading baseline records" },
  { key: "normalizing-haulers", label: "Normalizing haulers" },
  { key: "processing-clients", label: "Processing clients" },
  { key: "saving-clients", label: "Saving canonical clients" },
  { key: "resolving-duplicates", label: "Resolving relationships & conflicts" },
  { key: "recalculating-summary", label: "Recalculating summary totals" },
  { key: "validating-dashboard", label: "Validating dashboard data" },
  { key: "finalizing", label: "Finalizing synchronization" },
];

function stagePercent(stageIndex, fraction = 0) {
  const f = Math.max(0, Math.min(1, fraction));
  return Math.round(((stageIndex + f) / STAGES.length) * 100);
}

function readClient(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const name = entry.trim();
    return name ? { name, rawType: "", province: "", municipalityCity: "", region: "" } : null;
  }
  if (typeof entry === "object") {
    const name = String(entry.clientName || entry.name || "").trim();
    if (!name) return null;
    return {
      name,
      rawType: String(entry.clientType || entry.type || "").trim(),
      province: String(entry.provinceName || entry.province || "").trim(),
      municipalityCity: String(entry.municipalityName || entry.municipality || "").trim(),
      region: String(entry.regionName || entry.region || "").trim(),
    };
  }
  return null;
}

function classifyType(rawType, companyTypeFallback) {
  const low = String(rawType || "").toLowerCase().replace(/[_\-\s]+/g, " ").trim();
  if (/\blgu\b/.test(low) || low.includes("local government")) return "LGU";
  if (low.includes("private")) return "Private Sector";
  if (!low && companyTypeFallback) {
    const c = String(companyTypeFallback).toLowerCase();
    if (c.includes("lgu")) return "LGU";
    if (c.includes("private")) return "Private Sector";
  }
  return null;
}

// Identity of a relationship is (portal user, hauler) — NOT the baseline that
// happened to evidence it.
//
// This key used to include baselineRef, which made every baseline document mint a
// NEW relationship entry instead of refreshing the existing one. Because the sync
// seeds prior entries back in (seedWorking below) and never prunes, the arrays grew
// without bound: measured on live data, 23,626 stored entries represented only 373
// distinct (portal user, hauler) pairs — 63x bloat, with one document already at
// 499KB. The set of baselines a client came from is not lost; it is what the
// document-level `baselineReferences` array is for. The per-relationship
// `baselineRef` now means "most recent baseline that evidenced this relationship".
const relKeyOf = (r) => `${String(r.portalUser || r.portalUserEmail || "")}|${r.normalizedHauler || ""}`;

async function runBaselineClientSync({ actor = "baseline-sync", jobId = null, onProgress = () => {} } = {}) {
  const DataSLF = require("../models/DataSLF");
  const summary = {
    baselinesScanned: 0, clientsProcessed: 0,
    created: 0, updated: 0, skipped: 0,
    duplicatesDetected: 0, duplicatesMerged: 0, duplicatesRemoved: 0, duplicatesFlagged: 0,
    relationshipsAdded: 0, flagged: 0, byFlagType: {},
    counts: null, validation: null, ranAt: new Date(),
  };
  const counts = { total: 0, processed: 0 };
  const report = (i, f) => onProgress({
    stage: STAGES[i].key, stageLabel: STAGES[i].label, percent: stagePercent(i, f),
    processed: counts.processed, total: counts.total,
    counts: { created: summary.created, updated: summary.updated, skipped: summary.skipped,
      duplicates: summary.duplicatesDetected, merged: summary.duplicatesMerged,
      removed: summary.duplicatesRemoved, flagged: summary.flagged },
  });

  const flags = [];
  const seenFlags = new Set();
  const addFlag = (f) => {
    const sig = [f.flagType, f.clientName || "", f.hauler || "", f.portalUserEmail || "", f.baselineRef || ""]
      .map((v) => normalize(String(v))).join("::");
    if (seenFlags.has(sig)) return;
    seenFlags.add(sig);
    flags.push({ ...f, signature: sig });
    summary.byFlagType[f.flagType] = (summary.byFlagType[f.flagType] || 0) + 1;
  };

  // ── Stage 1: read ──
  report(0, 0);
  const provinceSet = await getRegion3ProvinceSet();
  const portalUsers = await UserPortal.find({}).select("email firstName lastName companyName username").lean();
  const userByEmail = new Map();
  portalUsers.forEach((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    if (!email) return;
    const name = `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.companyName || u.username || u.email;
    userByEmail.set(email, { id: u._id, name });
  });
  // ONE read of existing canonical clients (not merged/deleted) → seed the map so
  // relationships accumulate and manual data is preserved.
  const existing = await SlfClient.find({ deletedAt: null, mergedInto: null }).lean();
  const canonicalMap = new Map(); // canonicalKey → working
  const seedWorking = (doc) => ({
    _id: doc._id, isNew: false, name: doc.name, type: doc.type,
    source: doc.source || "admin-managed", status: doc.status || "Active",
    province: doc.province || "", municipalityCity: doc.municipalityCity || "", region: doc.region || "",
    location: doc.location || "", isDummy: !!doc.isDummy,
    rels: new Map((doc.portalUserRelationships || []).map((r) => [relKeyOf(r), {
      portalUser: r.portalUser || null, portalUserEmail: r.portalUserEmail || "", portalUserName: r.portalUserName || "",
      hauler: r.hauler || "", normalizedHauler: r.normalizedHauler || normalize(r.hauler),
      baselineRef: r.baselineRef || null, status: r.status || "active",
      firstSyncedAt: r.firstSyncedAt || new Date(), lastSyncedAt: r.lastSyncedAt || new Date(),
    }])),
    haulers: new Map((doc.haulerRelationships || []).map((h) => [h.normalizedHauler || normalize(h.hauler), { hauler: h.hauler, normalizedHauler: h.normalizedHauler || normalize(h.hauler) }])),
    baselines: new Set((doc.baselineReferences || []).map(String)),
    provincesSeen: new Set(doc.province ? [normalizeName(doc.province)] : []),
  });
  existing.forEach((doc) => {
    const key = doc.canonicalKey || SlfClient.buildCanonicalKey({ name: doc.name, type: doc.type });
    if (!canonicalMap.has(key)) canonicalMap.set(key, seedWorking(doc));
    // else: a pre-existing duplicate row for this key — left for cleanup migration.
  });

  // Project only the three hauler sub-fields this sync reads. `accreditedHaulers`
  // is ~44% of the data-slf collection's bytes, and `vehicles` alone is ~68% of
  // each hauler entry — none of which this service touches (it walks haulerName,
  // privateSectorClients and clients). Pulling whole hauler entries made this read
  // ~16.5MB / ~197s against the live cluster, which is byte-rate bound.
  const baselines = await DataSLF.find({ deletedAt: null, "accreditedHaulers.0": { $exists: true } })
    .select(
      "accreditedHaulers.haulerName accreditedHaulers.privateSectorClients accreditedHaulers.clients" +
        " slfName lguCompanyName companyType submittedBy slfGenerator isDummy createdAt",
    )
    .sort({ createdAt: -1 }).lean();
  summary.baselinesScanned = baselines.length;
  report(0, 1); report(1, 1);

  // ── Stage 3: process clients → accumulate into canonical map ──
  // Tracks "<canonicalKey>::<relKey>" pairs whose baselineRef this run has already
  // pinned to the newest baseline, so later (older) baselines don't walk it back.
  const relBaselineClaimed = new Set();
  const typesByName = new Map(); // normalizedName → Set(type)
  counts.total = baselines.reduce((n, b) => n + (b.accreditedHaulers || []).reduce((m, h) =>
    m + (Array.isArray(h?.privateSectorClients) ? h.privateSectorClients.length : 0) + (Array.isArray(h?.clients) ? h.clients.length : 0), 0), 0);

  for (const b of baselines) {
    const email = String(b.submittedBy || "").trim().toLowerCase();
    if (!email && !b.slfName) { addFlag({ flagType: "invalid_baseline", baselineRef: b._id, description: `Baseline ${b._id} has no submittedBy and no slfName.` }); continue; }
    const owner = userByEmail.get(email);
    for (const h of (b.accreditedHaulers || [])) {
      const haulerName = String(h?.haulerName || "").trim();
      const normHauler = normalize(haulerName);
      const raws = [...(Array.isArray(h?.privateSectorClients) ? h.privateSectorClients : []), ...(Array.isArray(h?.clients) ? h.clients : [])];
      for (const raw of raws) {
        const c = readClient(raw);
        counts.processed += 1; summary.clientsProcessed += 1;
        if (counts.total && counts.processed % 25 === 0) report(2, counts.processed / counts.total);
        if (!c) continue;
        const type = classifyType(c.rawType, b.companyType);
        if (!type) { addFlag({ flagType: "missing_type", baselineRef: b._id, clientName: c.name, hauler: haulerName, portalUserEmail: email, description: `Client "${c.name}" has no resolvable LGU/Private type.` }); continue; }
        if (!haulerName) addFlag({ flagType: "missing_hauler", baselineRef: b._id, clientName: c.name, clientType: type, portalUserEmail: email, description: `Client "${c.name}" has no named hauler.` });

        const nName = normalize(c.name);
        if (!typesByName.has(nName)) typesByName.set(nName, new Set());
        typesByName.get(nName).add(type);

        const key = SlfClient.buildCanonicalKey({ name: c.name, type });
        let w = canonicalMap.get(key);
        if (!w) {
          w = { _id: null, isNew: true, name: c.name, type, source: "baseline", status: "Active",
            province: "", municipalityCity: "", region: "", location: "", isDummy: !!b.isDummy,
            rels: new Map(), haulers: new Map(), baselines: new Set(), provincesSeen: new Set() };
          canonicalMap.set(key, w);
        }
        // Fill location only when the canonical has none (preserve manual/admin values).
        if (!w.province && c.province) { w.province = c.province; }
        if (!w.municipalityCity && c.municipalityCity) w.municipalityCity = c.municipalityCity;
        if (!w.region && c.region) w.region = c.region;
        if (!w.location && (c.municipalityCity || c.province)) w.location = [c.municipalityCity, c.province].filter(Boolean).join(", ");
        if (c.province) w.provincesSeen.add(normalizeName(c.province));

        // Relationship (deduped) — preserve firstSyncedAt, bump lastSyncedAt.
        const rel = { portalUser: owner?.id || null, portalUserEmail: email, portalUserName: owner?.name || "",
          hauler: haulerName, normalizedHauler: normHauler, baselineRef: b._id, status: "active",
          firstSyncedAt: new Date(), lastSyncedAt: new Date() };
        const rk = relKeyOf(rel);
        const existingRel = w.rels.get(rk);
        if (existingRel) {
          existingRel.lastSyncedAt = new Date();
          // `baselines` is iterated newest-first, so the FIRST baseline this run sees
          // for a key is the most recent one. Adopt it once (replacing whatever stale
          // ref was seeded from the stored document), then leave it alone.
          if (!relBaselineClaimed.has(`${key}::${rk}`)) {
            existingRel.baselineRef = b._id;
            relBaselineClaimed.add(`${key}::${rk}`);
          }
          // A seeded entry keeps its original firstSyncedAt; a name that was blank
          // when first synced can still be filled in later.
          if (!existingRel.portalUserName && owner?.name) existingRel.portalUserName = owner.name;
          if (!existingRel.portalUser && owner?.id) existingRel.portalUser = owner.id;
        } else {
          relBaselineClaimed.add(`${key}::${rk}`);
          w.rels.set(rk, rel);
          summary.relationshipsAdded += 1;
        }
        if (normHauler) w.haulers.set(normHauler, { hauler: haulerName, normalizedHauler: normHauler });
        w.baselines.add(String(b._id));
      }
    }
  }
  report(2, 1);

  // ── Stage 4: bulk save canonical clients ──
  report(3, 0);
  const ops = [];
  const now = new Date();
  for (const w of canonicalMap.values()) {
    const rels = [...w.rels.values()];
    const distinct = new Set(rels.map((r) => String(r.portalUser || r.portalUserEmail || "")).filter(Boolean));
    const multiPortalStatus = distinct.size > 1 ? "Multiple Portal Users" : distinct.size === 1 ? "Single Portal User" : "Unassigned";
    const regionClass = classifyRegion({ province: w.province, region: w.region }, provinceSet);
    if (regionClass === REGION_CLASS.UNCLASSIFIED && !w.province) {
      addFlag({ flagType: "region_unclassified", clientName: w.name, clientType: w.type, description: `Client "${w.name}" has no province — cannot classify Region 3.` });
    }
    const setDoc = {
      name: w.name, normalizedName: normalize(w.name), type: w.type,
      canonicalKey: SlfClient.buildCanonicalKey({ name: w.name, type: w.type }), isCanonical: true, mergedInto: null,
      province: w.province, municipalityCity: w.municipalityCity, region: w.region, location: w.location, regionClass,
      portalUserRelationships: rels,
      haulerRelationships: [...w.haulers.values()].map((h) => ({ ...h, lastSyncedAt: now })),
      baselineReferences: [...w.baselines].map((id) => id),
      multiPortalStatus,
      // Keep legacy single-value fields pointed at the primary relationship for
      // backward-compatible display/filtering.
      portalUser: rels[0]?.portalUser || null, portalUserName: rels[0]?.portalUserName || "",
      portalUserEmail: rels[0]?.portalUserEmail || "", hauler: rels[0]?.hauler || "", normalizedHauler: rels[0]?.normalizedHauler || "",
      baselineRef: rels[0]?.baselineRef || null,
      lastSyncedAt: now, syncJobId: jobId, syncAction: w.isNew ? "created" : "updated", isDummy: w.isDummy,
    };
    if (w.isNew) {
      ops.push({ insertOne: { document: { ...setDoc, status: "Active", source: "baseline", createdBy: actor, updatedBy: actor } } });
      summary.created += 1;
    } else {
      ops.push({ updateOne: { filter: { _id: w._id }, update: { $set: { ...setDoc, updatedBy: actor } } } });
      summary.updated += 1;
    }
  }
  if (ops.length) {
    // Chunked bulkWrite (batches) to keep memory bounded on large datasets.
    for (let i = 0; i < ops.length; i += 500) {
      await SlfClient.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      report(3, Math.min(1, (i + 500) / ops.length));
    }
  }
  report(3, 1);

  // ── Stage 5: conflicts (multi-portal is normal; flag only suspicious cases) ──
  report(4, 0);
  for (const w of canonicalMap.values()) {
    const distinctUsers = new Set([...w.rels.values()].map((r) => String(r.portalUser || r.portalUserEmail || "")).filter(Boolean));
    if (distinctUsers.size > 1 && w.provincesSeen.size > 1) {
      summary.duplicatesFlagged += 1;
      addFlag({ flagType: "conflicting_portal_users", clientName: w.name, clientType: w.type,
        description: `Client "${w.name}" is linked to ${distinctUsers.size} portal users with conflicting provinces.`,
        meta: { provinces: [...w.provincesSeen], users: [...distinctUsers] } });
    }
  }
  for (const [nName, types] of typesByName.entries()) {
    if (types.size > 1) {
      addFlag({ flagType: "ambiguous_duplicate", clientName: nName, description: `Client "${nName}" appears under different client types: ${[...types].join(", ")}.`, meta: { types: [...types] } });
    }
  }
  report(4, 1);

  // ── Stage 6: recalc from persisted collection ──
  report(5, 0);
  summary.counts = await recalcCounts();
  report(5, 1);

  // ── Stage 7: validate ──
  report(6, 0);
  summary.validation = validateCounts(summary.counts);
  if (!summary.validation.ok) addFlag({ flagType: "validation_mismatch", description: `Post-sync validation mismatch: ${summary.validation.mismatches.join("; ")}`, meta: summary.counts });
  report(6, 1);

  // ── Stage 8: persist flags ──
  report(7, 0);
  for (const f of flags) {
    await SlfDataIssue.updateOne({ signature: f.signature }, {
      $setOnInsert: { signature: f.signature, status: "open", sourceModule: "baseline-sync" },
      $set: { flagType: f.flagType, description: f.description || "", baselineRef: f.baselineRef || null,
        clientName: f.clientName || "", clientType: f.clientType || "", portalUserEmail: f.portalUserEmail || "",
        hauler: f.hauler || "", meta: f.meta || {}, lastSeenAt: new Date() },
    }, { upsert: true });
  }
  summary.flagged = flags.length;
  report(7, 1);
  return summary;
}

// Authoritative counts from the PERSISTED canonical collection.
async function recalcCounts() {
  const rows = await SlfClient.aggregate([
    { $match: { deletedAt: null, isCanonical: true, mergedInto: null, status: "Active", isDummy: { $ne: true } } },
    { $group: { _id: { type: "$type", regionClass: "$regionClass" }, count: { $sum: 1 } } },
  ]);
  const out = { total: 0, lgu: 0, private: 0, withinR3: { lgu: 0, private: 0 }, outsideR3: { lgu: 0, private: 0 }, unclassified: { lgu: 0, private: 0 } };
  rows.forEach((r) => {
    const { type, regionClass } = r._id;
    out.total += r.count;
    if (type === "LGU") out.lgu += r.count; else if (type === "Private Sector") out.private += r.count;
    const bucket = regionClass === REGION_CLASS.WITHIN ? out.withinR3 : regionClass === REGION_CLASS.OUTSIDE ? out.outsideR3 : out.unclassified;
    if (type === "LGU") bucket.lgu += r.count; else if (type === "Private Sector") bucket.private += r.count;
  });
  return out;
}

function validateCounts(counts) {
  const mismatches = [];
  if (counts.lgu + counts.private !== counts.total) mismatches.push(`type sum (${counts.lgu + counts.private}) != total (${counts.total})`);
  const regionSum = counts.withinR3.lgu + counts.withinR3.private + counts.outsideR3.lgu + counts.outsideR3.private + counts.unclassified.lgu + counts.unclassified.private;
  if (regionSum !== counts.total) mismatches.push(`region sum (${regionSum}) != total (${counts.total})`);
  return { ok: mismatches.length === 0, mismatches, counts };
}

module.exports = { runBaselineClientSync, recalcCounts, validateCounts, normalize, classifyType, readClient, STAGES };
