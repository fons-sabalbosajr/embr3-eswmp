const express = require("express");
const ResidualContainment = require("../models/ResidualContainment");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// All routes here are admin data-management; require an authenticated admin.
const { authMiddleware, adminOnly } = require("../middleware/auth");
router.use(authMiddleware, adminOnly);

// ── Dashboard tile cache ──
// GET /stats is a fan-out target of the admin dashboard, which refreshes every
// 60s per open admin session and runs several aggregations per call. The result
// is a global rollup — identical for every admin — so one computation serves all
// of them. Two minutes because this module's records are maintained by hand, not
// by portal traffic; any write below invalidates the key immediately anyway, so
// the TTL is only the backstop for changes made outside this router.
const { cacheJson, invalidateOnWrite } = require("../middleware/cacheRoute");
const { MODULE_STATS, yearSeg } = require("../utils/cacheKeys");
const STATS_KEY = MODULE_STATS.residualContainment;
const STATS_TTL_MS = 120000;
router.use(invalidateOnWrite(STATS_KEY));

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await ResidualContainment.find().sort({ province: 1, municipality: 1 }).lean();
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", cacheJson((req) => `${STATS_KEY}:${yearSeg(req.query.year)}`, STATS_TTL_MS), async (req, res) => {
  try {
    const yearFilter = req.query.year ? { dataYear: Number(req.query.year) } : {};
    const [totalRecords, byProvince, byStatus, byManilaBayArea] = await Promise.all([
      ResidualContainment.countDocuments(yearFilter),
      ResidualContainment.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
        { $group: { _id: "$province", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ResidualContainment.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
        { $group: { _id: { $ifNull: ["$statusOfFacility", "Unknown"] }, count: { $sum: 1 } } },
      ]),
      ResidualContainment.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
        { $group: { _id: "$manilaBayArea", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const provinceMap = {};
    byProvince.forEach((p) => (provinceMap[p._id] = p.count));
    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));
    const mbaMap = {};
    byManilaBayArea.forEach((m) => (mbaMap[m._id] = m.count));

    res.json({ totalRecords, byProvince: provinceMap, byStatus: statusMap, byManilaBayArea: mbaMap });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single record
router.get("/:id", async (req, res) => {
  try {
    const record = await ResidualContainment.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create record
router.post("/", async (req, res) => {
  try {
    const record = new ResidualContainment(req.body);
    await record.save();
    res.status(201).json(record);
    writeLog("info", "residual-containment.create", {
      message: `RCA entry created: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk import
router.post("/bulk", async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: "No records provided" });
    }
    const saved = await ResidualContainment.insertMany(records);
    res.status(201).json({ message: `${saved.length} records imported`, count: saved.length });
    writeLog("info", "residual-containment.bulk-import", {
      message: `Bulk import: ${saved.length} records`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update record
router.put("/:id", async (req, res) => {
  try {
    const record = await ResidualContainment.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "residual-containment.update", {
      message: `RCA entry updated: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete record
router.delete("/:id", async (req, res) => {
  try {
    const record = await ResidualContainment.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "residual-containment.delete", {
      message: `RCA entry deleted: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// History: all year records for a municipality
router.get("/history/:municipality", async (req, res) => {
  try {
    const records = await ResidualContainment.find({
      municipality: { $regex: new RegExp(`^${req.params.municipality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    }).sort({ dataYear: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
