const express = require("express");
const mongoose = require("mongoose");
const SlfClient = require("../models/SlfClient");
const { writeLog } = require("../utils/logger");
const { refreshAdmin } = require("../utils/socketEmit");
const { authMiddleware, adminOnly, requirePermission } = require("../middleware/auth");
const { getRegion3ProvinceSet, classifyRegion } = require("../utils/region3");

const router = express.Router();

// All routes are admin data-management, gated by the granular `slfClients`
// permission (view/edit/delete) enforced on the backend so direct API calls can
// never bypass the UI gates. Developer/super-admin bypasses inside requirePermission.
router.use(authMiddleware, adminOnly);

const PERM = "slfClients";

// Short-TTL in-memory cache for the relationship map. The Region III master list +
// canonical clients change infrequently, so a 60s cache absorbs repeated modal
// opens / tab switches without re-running the join. Invalidated on any client write
// (see clearRelMapCache) so edits show immediately. Override TTL via env if needed.
const REL_MAP_TTL_MS = Number(process.env.REL_MAP_CACHE_TTL_MS ?? 60_000);
const _relMapCache = new Map(); // type -> { data, expires }
function clearRelMapCache() { _relMapCache.clear(); }
const actor = (req) => req.headers["x-user-name"] || req.headers["x-user-email"] || "admin";

// Canonical duplicate: one profile per (normalizedName + type). Manual adds may
// not create a second canonical row for the same client identity.
async function findDuplicate({ name, type, excludeId }) {
  const query = {
    canonicalKey: SlfClient.buildCanonicalKey({ name, type }),
    isCanonical: true,
    mergedInto: null,
    deletedAt: null,
  };
  if (excludeId) query._id = { $ne: excludeId };
  return SlfClient.findOne(query).lean();
}

// Sanitize the incoming body to the known fields only.
function pickBody(body = {}) {
  const out = {};
  [
    "name", "type", "portalUser", "portalUserName", "hauler", "location",
    "province", "municipalityCity", "region",
    "address", "contactPerson", "contactNumber", "contactEmail", "status", "notes",
  ].forEach((k) => {
    if (body[k] !== undefined) out[k] = body[k];
  });
  if (out.portalUser === "" || out.portalUser === undefined) out.portalUser = null;
  return out;
}

// Classify a client's region from its saved province (Region 3 master data with
// centralized fallback). Recomputed whenever province changes.
async function computeRegionClass({ province, region }) {
  const set = await getRegion3ProvinceSet();
  return classifyRegion({ province, region }, set);
}

// Keep a canonical record's single portalUserRelationship in sync with the
// legacy single-value fields on manual create/edit, so multi-portal detection
// and the relationship detail view work for admin-managed clients too.
function syncSingleRelationship(record) {
  if (record.portalUser || record.portalUserName || record.hauler) {
    const existing = (record.portalUserRelationships || [])[0] || {};
    record.portalUserRelationships = [{
      portalUser: record.portalUser || null,
      portalUserEmail: record.portalUserEmail || existing.portalUserEmail || "",
      portalUserName: record.portalUserName || "",
      hauler: record.hauler || "",
      normalizedHauler: SlfClient.normalize(record.hauler || ""),
      baselineRef: null,
      status: "active",
      firstSyncedAt: existing.firstSyncedAt || new Date(),
      lastSyncedAt: new Date(),
    }];
    if (record.hauler) {
      record.haulerRelationships = [{ hauler: record.hauler, normalizedHauler: SlfClient.normalize(record.hauler), lastSyncedAt: new Date() }];
    }
  }
}

function validate(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!String(body.name || "").trim()) errors.push("Client name is required");
  }
  if (!partial || body.type !== undefined) {
    if (!["LGU", "Private Sector"].includes(body.type)) errors.push("Client type must be LGU or Private Sector");
  }
  if (body.status !== undefined && !["Active", "Inactive"].includes(body.status)) {
    errors.push("Status must be Active or Inactive");
  }
  if (body.portalUser && !mongoose.isValidObjectId(body.portalUser)) {
    errors.push("Invalid portal user reference");
  }
  return errors;
}

// ── List all (non-deleted). Frontend handles filter/sort/pagination client-side,
//    matching the other admin management tables. ──
router.get("/", requirePermission(PERM, "view"), async (req, res) => {
  try {
    // Canonical clients only — merged/archived/deleted duplicates are excluded so
    // the table shows exactly one row per unique client.
    const records = await SlfClient.find({ deletedAt: null, isCanonical: true, mergedInto: null })
      .sort({ createdAt: -1 })
      .lean();
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Deduped unique-client counts for the SLF dashboard tiles + the four
//    Region 3 breakdown tiles. Single authoritative source (recalcCounts reads
//    the PERSISTED collection, deduped by normalized name+type). ──
router.get("/summary", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const { recalcCounts } = require("../services/syncBaselineClients");
    const counts = await recalcCounts();
    res.json(counts);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Relationship map (Item #2): canonical Active clients of one type, deduped by
//    client _id, with their DISTINCT hauler + SLF relationships, multiple-hauler /
//    multiple-SLF detection, and missing-assignment flags. For LGUs, the Region III
//    master list (region3_lgus) is the authoritative universe, so unserved LGUs are
//    derived from the master list — never only from existing clients/submissions. ──
router.get("/relationship-map", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const Region3Lgu = require("../models/Region3Lgu");
    const { normalizeName } = require("../utils/region3");
    const type = /priv/i.test(String(req.query.type || "")) ? "Private Sector" : "LGU";

    const cached = _relMapCache.get(type);
    if (cached && cached.expires > Date.now()) return res.json(cached.data);

    const clients = await SlfClient.find({
      deletedAt: null, isCanonical: true, mergedInto: null, status: "Active",
      isDummy: { $ne: true }, type,
    })
      .select("name normalizedName clientTypeLabel province municipalityCity address hauler portalUserName portalUser haulerRelationships portalUserRelationships")
      .lean();

    // Distinct by NORMALIZED value (ids where available) so the same hauler/SLF is
    // never double-counted across relationship entries.
    const distinctHaulers = (c) => {
      const m = new Map();
      const add = (h) => { const d = String(h || "").trim(); if (d) m.set(d.toLowerCase(), d); };
      add(c.hauler);
      (c.haulerRelationships || []).forEach((r) => add(r.hauler));
      (c.portalUserRelationships || []).forEach((r) => add(r.hauler));
      return [...m.values()];
    };
    const distinctSlfs = (c) => {
      const m = new Map();
      const add = (id, name) => {
        const key = String(id || "").trim() || String(name || "").trim().toLowerCase();
        if (key) m.set(key, String(name || "").trim() || "Unnamed SLF");
      };
      add(c.portalUser, c.portalUserName);
      (c.portalUserRelationships || []).forEach((r) => add(r.portalUser, r.portalUserName));
      return [...m.values()].filter(Boolean);
    };

    const rows = clients
      .map((c) => {
        const haulers = distinctHaulers(c);
        const slfs = distinctSlfs(c);
        const missingHauler = haulers.length === 0;
        const missingSlf = slfs.length === 0;
        const remarks = [];
        if (missingHauler) remarks.push("No hauler assigned");
        if (missingSlf) remarks.push("No SLF assigned");
        if (haulers.length > 1) remarks.push(`${haulers.length} haulers`);
        if (slfs.length > 1) remarks.push(`${slfs.length} SLFs`);
        return {
          _id: String(c._id),
          name: c.name,
          clientType: c.clientTypeLabel || "",
          province: c.province || "",
          municipalityCity: c.municipalityCity || c.address || "",
          haulers, slfs,
          haulerCount: haulers.length,
          slfCount: slfs.length,
          multiHauler: haulers.length > 1,
          multiSlf: slfs.length > 1,
          missingHauler, missingSlf,
          serviceStatus: missingHauler || missingSlf ? "Incomplete" : "Served",
          remarks: remarks.join(" · "),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const summary = {
      type,
      clients: rows.length,
      served: rows.filter((r) => r.serviceStatus === "Served").length,
      incomplete: rows.filter((r) => r.serviceStatus === "Incomplete").length,
      multiHauler: rows.filter((r) => r.multiHauler).length,
      multiSlf: rows.filter((r) => r.multiSlf).length,
      missingAssignments: rows.filter((r) => r.missingHauler || r.missingSlf).length,
    };

    // LGU universe comes from the Region III master list (App Settings).
    if (type === "LGU") {
      const masters = await Region3Lgu.find({ status: "Active" })
        .select("name normalizedName province municipalityCity")
        .lean();
      const servedKeys = new Set(rows.map((r) => normalizeName(r.name)).filter(Boolean));
      const unserved = masters
        .filter((m) => {
          const key = m.normalizedName || normalizeName(m.name);
          return key && !servedKeys.has(key);
        })
        .map((m) => ({ _id: String(m._id), name: m.name, province: m.province || "", municipalityCity: m.municipalityCity || "" }))
        .sort((a, b) => a.name.localeCompare(b.name));
      summary.totalMasterLgus = masters.length;
      summary.unservedCount = unserved.length;
      summary.servedCount = Math.max(0, masters.length - unserved.length);
      const payload = { rows, summary, unserved };
      _relMapCache.set(type, { data: payload, expires: Date.now() + REL_MAP_TTL_MS });
      res.json(payload);
      return;
    }

    const payload = { rows, summary, unserved: [] };
    _relMapCache.set(type, { data: payload, expires: Date.now() + REL_MAP_TTL_MS });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Baseline hauler options for the client hauler dropdown. Sources distinct
//    hauler names from every non-deleted baseline's accreditedHaulers, plus any
//    haulers already stored on client records, deduped by normalized value
//    (casing/whitespace collapsed) so the same hauler never appears twice. ──
router.get("/hauler-options", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const DataSLF = require("../models/DataSLF");
    const [baselines, clientHaulers] = await Promise.all([
      DataSLF.find({ deletedAt: null, "accreditedHaulers.0": { $exists: true } })
        .select("accreditedHaulers.haulerName")
        .lean(),
      SlfClient.find({ deletedAt: null, hauler: { $ne: "" } }).select("hauler").lean(),
    ]);
    const byNorm = new Map(); // normalized → first-seen display
    const add = (name) => {
      const display = String(name || "").trim();
      if (!display) return;
      const norm = SlfClient.normalize(display);
      if (!byNorm.has(norm)) byNorm.set(norm, display);
    };
    baselines.forEach((b) => (b.accreditedHaulers || []).forEach((h) => add(h?.haulerName)));
    clientHaulers.forEach((c) => add(c.hauler));
    const options = [...byNorm.values()].sort((a, b) => a.localeCompare(b));
    res.json(options);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Data issues (flagged records that could not be synced safely). ──
router.get("/issues", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    const filter = {};
    if (req.query.status && ["open", "resolved", "ignored"].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.flagType) filter.flagType = req.query.flagType;
    const issues = await SlfDataIssue.find(filter).sort({ status: 1, updatedAt: -1 }).lean();
    res.json(issues);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Resolve / reopen a data issue (edit permission). ──
router.patch("/issues/:id/resolve", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const SlfDataIssue = require("../models/SlfDataIssue");
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Issue not found" });
    const { status = "resolved", resolutionNotes = "" } = req.body;
    if (!["open", "resolved", "ignored"].includes(status)) return res.status(400).json({ message: "Invalid status" });
    const issue = await SlfDataIssue.findById(req.params.id);
    if (!issue) return res.status(404).json({ message: "Issue not found" });
    issue.status = status;
    issue.resolutionNotes = resolutionNotes;
    issue.resolvedAt = status === "open" ? null : new Date();
    issue.resolvedBy = status === "open" ? "" : actor(req);
    await issue.save();
    res.json(issue);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Start the baseline → SlfClient sync as a tracked job (edit permission).
//    Returns immediately with a jobId; progress streams over the socket and is
//    also pollable via GET /sync/:jobId. One running job per scope. Idempotent. ──
router.post("/sync", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const { startSyncJob } = require("../services/slfSyncRunner");
    const io = req.app.get("io");
    const emit = (event, payload) => { try { if (io) io.to("admin-room").emit(event, payload); } catch { /* ignore */ } };
    const { job, alreadyRunning } = await startSyncJob({ actor: actor(req), emit });
    if (alreadyRunning) {
      return res.status(409).json({ message: "A synchronization job is already running", jobId: String(job._id), status: job.status });
    }
    res.status(202).json({ jobId: String(job._id), status: job.status });
    writeLog("info", "slf-clients.sync.start", { message: `Baseline client sync started (job ${job._id})`, req });
  } catch (error) {
    writeLog("error", "slf-clients.sync.error", { message: `Baseline client sync failed to start: ${error.message}`, req });
    res.status(500).json({ message: "Sync failed to start", error: error.message });
  }
});

// ── Controlled duplicate cleanup migration (edit permission). Idempotent. ──
router.post("/cleanup-duplicates", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const { runDuplicateCleanup } = require("../services/cleanupDuplicateClients");
    const summary = await runDuplicateCleanup({ actor: actor(req) });
    res.json(summary);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("info", "slf-clients.cleanup", { message: `Duplicate cleanup: ${summary.duplicatesRemoved} archived across ${summary.canonicalsAffected} canonicals`, req });
  } catch (error) {
    writeLog("error", "slf-clients.cleanup.error", { message: `Duplicate cleanup failed: ${error.message}`, req });
    res.status(500).json({ message: "Cleanup failed", error: error.message });
  }
});

// ── Latest sync job (must precede /sync/:jobId). ──
router.get("/sync/latest", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfSyncJob = require("../models/SlfSyncJob");
    const job = await SlfSyncJob.findOne({ scope: "baseline-clients" }).sort({ createdAt: -1 }).lean();
    res.json(job || null);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Poll a sync job's status/progress (SSE fallback). ──
router.get("/sync/:jobId", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const SlfSyncJob = require("../models/SlfSyncJob");
    if (!mongoose.isValidObjectId(req.params.jobId)) return res.status(404).json({ message: "Job not found" });
    const job = await SlfSyncJob.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json(job);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Single record ──
router.get("/:id", requirePermission(PERM, "view"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!record) return res.status(404).json({ message: "Client not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Create ──
router.post("/", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const body = pickBody(req.body);
    const errors = validate(body);
    if (errors.length) return res.status(400).json({ message: errors.join(", ") });

    const dup = await findDuplicate({ name: body.name, type: body.type });
    if (dup) return res.status(409).json({ message: "A client with this name and type already exists" });

    const record = new SlfClient({ ...body, createdBy: actor(req), updatedBy: actor(req) });
    record.regionClass = await computeRegionClass({ province: body.province, region: body.region });
    syncSingleRelationship(record);
    await record.save();
    res.status(201).json(record);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("info", "slf-clients.create", { message: `SLF client created: ${record.name} (${record.type})`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Update ──
router.put("/:id", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Client not found" });

    const body = pickBody(req.body);
    const errors = validate(body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors.join(", ") });

    const nextName = body.name !== undefined ? body.name : record.name;
    const nextType = body.type !== undefined ? body.type : record.type;
    const dup = await findDuplicate({ name: nextName, type: nextType, excludeId: record._id });
    if (dup) return res.status(409).json({ message: "A client with this name and type already exists" });

    const provinceChanged = body.province !== undefined && body.province !== record.province;
    Object.assign(record, body);
    if (provinceChanged || body.region !== undefined) {
      record.regionClass = await computeRegionClass({ province: record.province, region: record.region });
    }
    syncSingleRelationship(record);
    record.updatedBy = actor(req);
    await record.save();
    res.json(record);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("info", "slf-clients.update", { message: `SLF client updated: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Activate / deactivate (non-destructive) — requires delete permission ──
router.patch("/:id/status", requirePermission(PERM, "delete"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const { status } = req.body;
    if (!["Active", "Inactive"].includes(status)) return res.status(400).json({ message: "Status must be Active or Inactive" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Client not found" });
    record.status = status;
    record.updatedBy = actor(req);
    await record.save();
    res.json(record);
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("warn", "slf-clients.status", { message: `SLF client ${status === "Active" ? "activated" : "deactivated"}: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Soft delete — requires delete permission ──
router.delete("/:id", requirePermission(PERM, "delete"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Client not found" });
    const record = await SlfClient.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Client not found" });
    record.deletedAt = new Date();
    record.deletedBy = actor(req);
    await record.save();
    res.json({ message: "Client deleted" });
    clearRelMapCache();
    refreshAdmin(req, "slf-clients");
    writeLog("warn", "slf-clients.delete", { message: `SLF client deleted: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
