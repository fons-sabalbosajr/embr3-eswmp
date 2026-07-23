const express = require("express");
const mongoose = require("mongoose");
const Region3Lgu = require("../models/Region3Lgu");
const { normalizeName } = require("../utils/region3");
const { writeLog } = require("../utils/logger");
const { refreshAdmin } = require("../utils/socketEmit");
const { authMiddleware, adminOnly, requirePermission } = require("../middleware/auth");

const router = express.Router();
router.use(authMiddleware, adminOnly);

const PERM = "region3Lgu";
const actor = (req) => req.headers["x-user-name"] || req.headers["x-user-email"] || "admin";

// Masterlist edits change the served/unserved LGU metrics — invalidate the
// relationship-map cache so the LGUs Served tab reflects the change immediately.
const invalidateRelMap = () => {
  try { require("./slfClients").clearRelMapCache?.(); } catch { /* optional */ }
};
const LGU_TYPES = Region3Lgu.LGU_TYPES;

function pickBody(body = {}) {
  const out = {};
  ["psgcCode", "name", "lguType", "province", "municipalityCity", "region", "status", "notes", "source", "aliases"]
    .forEach((k) => { if (body[k] !== undefined) out[k] = body[k]; });
  return out;
}

function validate(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.name !== undefined) {
    if (!String(body.name || "").trim()) errors.push("LGU name is required");
  }
  if (!partial || body.province !== undefined) {
    if (!String(body.province || "").trim()) errors.push("Province is required");
  }
  if (body.lguType !== undefined && !LGU_TYPES.includes(body.lguType)) errors.push("Invalid LGU type");
  if (body.status !== undefined && !["Active", "Inactive"].includes(body.status)) errors.push("Invalid status");
  return errors;
}

// Strongest-identifier duplicate detection: PSGC code first, else normalized
// name + province + type. Returns the existing doc (lean) or null.
async function findDuplicate(rec, excludeId) {
  const psgc = String(rec.psgcCode || "").trim();
  let query;
  if (psgc) {
    query = { psgcCode: psgc };
  } else {
    query = {
      normalizedName: normalizeName(rec.name),
      normalizedProvince: normalizeName(rec.province),
      lguType: rec.lguType || "Municipality",
    };
  }
  if (excludeId) query._id = { $ne: excludeId };
  return Region3Lgu.findOne(query);
}

// ── List (frontend filters/sorts/paginates client-side). ──
router.get("/", requirePermission(PERM, "view"), async (req, res) => {
  try {
    const records = await Region3Lgu.find({}).sort({ province: 1, name: 1 }).lean();
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── CSV template (must precede /:id). ──
router.get("/template", requirePermission(PERM, "view"), (req, res) => {
  const headers = ["psgcCode", "name", "lguType", "province", "municipalityCity", "region", "status", "aliases", "notes"];
  const sample = ["031234567", "City of San Fernando", "City", "Pampanga", "San Fernando", "Region III", "Active", "SanFernando|CSF", ""];
  const csv = `${headers.join(",")}\n${sample.join(",")}\n`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=region3_lgu_template.csv");
  res.send(csv);
});

// ── Single record. ──
router.get("/:id", requirePermission(PERM, "view"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const record = await Region3Lgu.findById(req.params.id).lean();
    if (!record) return res.status(404).json({ message: "Not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Create. ──
router.post("/", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const body = pickBody(req.body);
    const errors = validate(body);
    if (errors.length) return res.status(400).json({ message: errors.join(", ") });
    const dup = await findDuplicate(body);
    if (dup) return res.status(409).json({ message: "An LGU with the same PSGC code (or name + province + type) already exists" });
    const record = new Region3Lgu({ ...body, source: body.source || "manual", createdBy: actor(req), updatedBy: actor(req) });
    await record.save();
    res.status(201).json(record);
    refreshAdmin(req, "region3-lgu"); invalidateRelMap();
    writeLog("info", "region3-lgu.create", { message: `Region 3 LGU created: ${record.name}, ${record.province}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Update. ──
router.put("/:id", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const record = await Region3Lgu.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Not found" });
    const body = pickBody(req.body);
    const errors = validate(body, { partial: true });
    if (errors.length) return res.status(400).json({ message: errors.join(", ") });
    const merged = { ...record.toObject(), ...body };
    const dup = await findDuplicate(merged, record._id);
    if (dup) return res.status(409).json({ message: "Another LGU with the same identifier already exists" });
    Object.assign(record, body);
    record.updatedBy = actor(req);
    await record.save();
    res.json(record);
    refreshAdmin(req, "region3-lgu"); invalidateRelMap();
    writeLog("info", "region3-lgu.update", { message: `Region 3 LGU updated: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Delete. ──
router.delete("/:id", requirePermission(PERM, "delete"), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const record = await Region3Lgu.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Deleted" });
    refreshAdmin(req, "region3-lgu"); invalidateRelMap();
    writeLog("warn", "region3-lgu.delete", { message: `Region 3 LGU deleted: ${record.name}`, req });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Bulk import (validated + deduped on the frontend, confirmed here). Repeated
//    imports UPDATE or SKIP existing records — never create duplicates. ──
router.post("/import", requirePermission(PERM, "edit"), async (req, res) => {
  try {
    const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!records.length) return res.status(400).json({ message: "No records provided" });
    const result = { created: 0, updated: 0, skipped: 0, invalid: 0, errors: [] };
    for (const raw of records) {
      const body = pickBody(raw);
      const errors = validate(body);
      if (errors.length) { result.invalid += 1; result.errors.push({ name: body.name || "(unnamed)", error: errors.join(", ") }); continue; }
      const dup = await findDuplicate(body);
      if (dup) {
        // Update in place (fills/overwrites with imported values), never duplicate.
        Object.assign(dup, body);
        dup.updatedBy = actor(req);
        dup.source = "import";
        await dup.save();
        result.updated += 1;
      } else {
        await Region3Lgu.create({ ...body, source: "import", createdBy: actor(req), updatedBy: actor(req) });
        result.created += 1;
      }
    }
    res.json(result);
    refreshAdmin(req, "region3-lgu"); invalidateRelMap();
    writeLog("info", "region3-lgu.import", { message: `Region 3 LGU import: +${result.created} created, ${result.updated} updated, ${result.invalid} invalid`, req });
  } catch (error) {
    res.status(500).json({ message: "Import failed", error: error.message });
  }
});

module.exports = router;
