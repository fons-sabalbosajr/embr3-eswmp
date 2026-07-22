// Controlled, idempotent cleanup for PRE-EXISTING duplicate SlfClient rows
// (created before the canonical-client model). Collapses exact normalized
// duplicates (same canonicalKey = normalizedName|type) into one canonical
// profile, merging their portal-user / hauler / baseline / location / audit data,
// and marks the rest as merged (isCanonical=false, mergedInto=survivor) so they
// are excluded from active queries. Never merges on loose name similarity —
// only exact normalized matches. Not run at startup; call explicitly.

const SlfClient = require("../models/SlfClient");
const SlfDataIssue = require("../models/SlfDataIssue");

const normalize = SlfClient.normalize;
const relKeyOf = (r) => `${String(r.portalUser || r.portalUserEmail || "")}|${r.normalizedHauler || normalize(r.hauler)}|${String(r.baselineRef || "")}`;

function completeness(c) {
  return [c.province, c.municipalityCity, c.location, c.address, c.contactPerson, c.contactNumber, c.contactEmail, c.notes]
    .filter((v) => v != null && String(v).trim() !== "").length
    + (c.portalUserRelationships || []).length;
}

async function runDuplicateCleanup({ actor = "cleanup" } = {}) {
  const summary = { groups: 0, duplicatesRemoved: 0, merged: 0, flaggedAmbiguous: 0, canonicalsAffected: 0 };

  // Only look at rows that currently claim to be canonical & active.
  const all = await SlfClient.find({ deletedAt: null, mergedInto: null }).lean();
  const groups = new Map();
  all.forEach((c) => {
    const key = c.canonicalKey || SlfClient.buildCanonicalKey({ name: c.name, type: c.type });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  });

  const ops = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    summary.groups += 1;

    // Ambiguous: >1 admin-managed rows with conflicting contact data — flag, skip.
    const adminRecs = group.filter((c) => c.source === "admin-managed");
    const conflicting = adminRecs.length > 1 &&
      new Set(adminRecs.map((c) => `${c.contactEmail}|${c.contactNumber}`)).size > 1;
    if (conflicting) {
      summary.flaggedAmbiguous += 1;
      const sig = `ambiguous_duplicate::${normalize(group[0].name)}::${group[0].type}`;
      ops.push({ issue: { signature: sig, flagType: "ambiguous_duplicate", clientName: group[0].name, clientType: group[0].type,
        description: `Ambiguous duplicate: ${group.length} records for "${group[0].name}" with conflicting admin data.`, meta: { ids: group.map((c) => String(c._id)) } } });
      continue;
    }

    // Canonical survivor: admin-managed first, then most complete, then oldest.
    const sorted = [...group].sort((a, b) => {
      const adA = a.source === "admin-managed" ? 1 : 0, adB = b.source === "admin-managed" ? 1 : 0;
      if (adA !== adB) return adB - adA;
      const cA = completeness(a), cB = completeness(b);
      if (cA !== cB) return cB - cA;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
    const canonical = sorted[0];
    const dups = sorted.slice(1);

    // Merge relationships / haulers / baselines (deduped) and fill blank location.
    const rels = new Map((canonical.portalUserRelationships || []).map((r) => [relKeyOf(r), r]));
    const haulers = new Map((canonical.haulerRelationships || []).map((h) => [h.normalizedHauler || normalize(h.hauler), h]));
    const baselines = new Set((canonical.baselineReferences || []).map(String));
    const mergedFrom = [...(canonical.mergedFrom || [])];
    const fill = { province: canonical.province, municipalityCity: canonical.municipalityCity, region: canonical.region,
      location: canonical.location, address: canonical.address, contactPerson: canonical.contactPerson,
      contactNumber: canonical.contactNumber, contactEmail: canonical.contactEmail, regionClass: canonical.regionClass };

    for (const d of dups) {
      (d.portalUserRelationships || []).forEach((r) => { if (!rels.has(relKeyOf(r))) rels.set(relKeyOf(r), r); });
      // A legacy row may carry only single-value portalUser/hauler (no relationship array).
      if (!(d.portalUserRelationships || []).length && (d.portalUser || d.hauler)) {
        const r = { portalUser: d.portalUser || null, portalUserEmail: d.portalUserEmail || "", portalUserName: d.portalUserName || "",
          hauler: d.hauler || "", normalizedHauler: normalize(d.hauler || ""), baselineRef: d.baselineRef || null, status: "active",
          firstSyncedAt: d.createdAt || new Date(), lastSyncedAt: new Date() };
        if (!rels.has(relKeyOf(r))) rels.set(relKeyOf(r), r);
      }
      (d.haulerRelationships || []).forEach((h) => { const k = h.normalizedHauler || normalize(h.hauler); if (k && !haulers.has(k)) haulers.set(k, h); });
      if (d.hauler && !haulers.has(normalize(d.hauler))) haulers.set(normalize(d.hauler), { hauler: d.hauler, normalizedHauler: normalize(d.hauler) });
      (d.baselineReferences || []).forEach((id) => baselines.add(String(id)));
      if (d.baselineRef) baselines.add(String(d.baselineRef));
      Object.keys(fill).forEach((k) => { if ((!fill[k] || String(fill[k]).trim() === "") && d[k]) fill[k] = d[k]; });
      mergedFrom.push({ clientId: d._id, name: d.name, source: d.source, mergedAt: new Date() });
    }

    const relArr = [...rels.values()];
    const distinct = new Set(relArr.map((r) => String(r.portalUser || r.portalUserEmail || "")).filter(Boolean));
    // Canonical retains the NEWEST valid sync timestamp across the merged group.
    const newestSync = [canonical, ...dups]
      .map((c) => (c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    ops.push({ update: {
      _id: canonical._id,
      set: {
        ...fill, isCanonical: true, mergedInto: null,
        portalUserRelationships: relArr,
        haulerRelationships: [...haulers.values()],
        baselineReferences: [...baselines],
        mergedFrom,
        ...(newestSync ? { lastSyncedAt: new Date(newestSync) } : {}),
        multiPortalStatus: distinct.size > 1 ? "Multiple Portal Users" : distinct.size === 1 ? "Single Portal User" : "Unassigned",
        updatedBy: actor,
      },
    } });
    // Archive the duplicates (excluded from active queries via isCanonical/mergedInto).
    dups.forEach((d) => ops.push({ archive: { _id: d._id, mergedInto: canonical._id } }));
    summary.canonicalsAffected += 1;
    summary.merged += dups.length;
    summary.duplicatesRemoved += dups.length;
  }

  // Apply.
  const bulk = [];
  for (const op of ops) {
    if (op.update) bulk.push({ updateOne: { filter: { _id: op.update._id }, update: { $set: op.update.set } } });
    else if (op.archive) bulk.push({ updateOne: { filter: { _id: op.archive._id }, update: { $set: { isCanonical: false, mergedInto: op.archive.mergedInto, status: "Inactive", updatedBy: actor } } } });
  }
  for (let i = 0; i < bulk.length; i += 500) {
    await SlfClient.bulkWrite(bulk.slice(i, i + 500), { ordered: false });
  }
  for (const op of ops) {
    if (op.issue) {
      await SlfDataIssue.updateOne({ signature: op.issue.signature },
        { $setOnInsert: { signature: op.issue.signature, status: "open", sourceModule: "duplicate-cleanup" },
          $set: { flagType: op.issue.flagType, description: op.issue.description, clientName: op.issue.clientName, clientType: op.issue.clientType, meta: op.issue.meta, lastSeenAt: new Date() } },
        { upsert: true });
    }
  }
  return summary;
}

module.exports = { runDuplicateCleanup };
