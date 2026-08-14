const express = require("express");
const TenYearSWMPlan = require("../models/TenYearSWMPlan");
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
const STATS_KEY = MODULE_STATS.tenYearSwm;
const STATS_TTL_MS = 120000;
router.use(invalidateOnWrite(STATS_KEY));

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await TenYearSWMPlan.find().sort({ province: 1, municipality: 1 }).lean();
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", cacheJson((req) => `${STATS_KEY}:${yearSeg(req.query.year)}`, STATS_TTL_MS), async (req, res) => {
  try {
    // Year filter: when a year is explicitly passed filter by it, otherwise show all years
    const latestFilter = req.query.year ? { dataYear: Number(req.query.year) } : {};

    // Helper: build compliance $cond
    const complianceCond = {
      $cond: [
        { $regexMatch: { input: { $ifNull: ["$remarksAndRecommendation", ""] }, regex: /compliant/i } },
        {
          $cond: [
            { $regexMatch: { input: { $ifNull: ["$remarksAndRecommendation", ""] }, regex: /non/i } },
            "Non-Compliant",
            "Compliant",
          ],
        },
        "Pending",
      ],
    };

    // Helper: build renewal $cond
    const renewalCond = {
      $cond: [
        { $regexMatch: { input: { $ifNull: ["$forRenewal", ""] }, regex: /approved/i } },
        "Approved",
        {
          $cond: [
            { $regexMatch: { input: { $ifNull: ["$forRenewal", ""] }, regex: /renewal/i } },
            "For Renewal",
            "Other",
          ],
        },
      ],
    };

    const [
      totalRecords,
      byProvince,
      byCompliance,
      byManilaBayArea,
      byPlanType,
      renewalStatus,
      wasteComposition,
      diversionByProvince,
      mapData,
      yearlyTrend,
    ] = await Promise.all([
      TenYearSWMPlan.countDocuments(latestFilter),
      TenYearSWMPlan.aggregate([
        ...(Object.keys(latestFilter).length ? [{ $match: latestFilter }] : []),
        { $addFields: { _normProvince: { $replaceAll: { input: "$province", find: "Province of ", replacement: "" } } } },
        { $group: { _id: "$_normProvince", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      TenYearSWMPlan.aggregate([
        ...(Object.keys(latestFilter).length ? [{ $match: latestFilter }] : []),
        { $group: { _id: complianceCond, count: { $sum: 1 } } },
      ]),
      TenYearSWMPlan.aggregate([
        ...(Object.keys(latestFilter).length ? [{ $match: latestFilter }] : []),
        { $group: { _id: "$manilaBayArea", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      TenYearSWMPlan.aggregate([
        ...(Object.keys(latestFilter).length ? [{ $match: latestFilter }] : []),
        { $group: { _id: "$typeOfSWMPlan", count: { $sum: 1 } } },
      ]),
      TenYearSWMPlan.aggregate([
        ...(Object.keys(latestFilter).length ? [{ $match: latestFilter }] : []),
        { $group: { _id: renewalCond, count: { $sum: 1 } } },
      ]),
      TenYearSWMPlan.aggregate([
        ...(Object.keys(latestFilter).length ? [{ $match: latestFilter }] : []),
        {
          $group: {
            _id: null,
            avgBiodegradable: { $avg: { $ifNull: ["$biodegradablePercent", 0] } },
            avgRecyclable: { $avg: { $ifNull: ["$recyclablePercent", 0] } },
            avgResidual: { $avg: { $ifNull: ["$residualPercent", 0] } },
            avgSpecial: { $avg: { $ifNull: ["$specialPercent", 0] } },
            avgDiversionRate: { $avg: { $ifNull: ["$wasteDiversionRate", 0] } },
            totalWasteGen: { $sum: { $ifNull: ["$totalWasteGeneration", 0] } },
          },
        },
      ]),
      TenYearSWMPlan.aggregate([
        ...(Object.keys(latestFilter).length ? [{ $match: latestFilter }] : []),
        {
          $group: {
            _id: "$province",
            avgDiversion: { $avg: { $ifNull: ["$wasteDiversionRate", 0] } },
            totalWaste: { $sum: { $ifNull: ["$totalWasteGeneration", 0] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { avgDiversion: -1 } },
      ]),
      TenYearSWMPlan.find(
        { ...latestFilter, latitude: { $ne: null }, longitude: { $ne: null } },
        {
          municipality: 1, province: 1, latitude: 1, longitude: 1,
          manilaBayArea: 1, congressionalDistrict: 1,
          typeOfSWMPlan: 1, periodCovered: 1, yearApproved: 1,
          forRenewal: 1, remarksAndRecommendation: 1,
          focalPerson: 1, enmoAssigned: 1,
          wasteDiversionRate: 1, totalWasteGeneration: 1, pcg: 1,
          lguFinalDisposal: 1,
          biodegradablePercent: 1, recyclablePercent: 1,
          residualPercent: 1, specialPercent: 1,
          signedDocument: 1, dataYear: 1,
        }
      ).lean(),
      // Year-over-year trend aggregation
      TenYearSWMPlan.aggregate([
        {
          $group: {
            _id: { $ifNull: ["$dataYear", new Date().getFullYear()] },
            totalRecords: { $sum: 1 },
            compliant: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $regexMatch: { input: { $ifNull: ["$remarksAndRecommendation", ""] }, regex: /compliant/i } },
                      { $not: { $regexMatch: { input: { $ifNull: ["$remarksAndRecommendation", ""] }, regex: /non/i } } },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            nonCompliant: {
              $sum: {
                $cond: [
                  { $regexMatch: { input: { $ifNull: ["$remarksAndRecommendation", ""] }, regex: /non/i } },
                  1,
                  0,
                ],
              },
            },
            avgDiversionRate: { $avg: { $ifNull: ["$wasteDiversionRate", 0] } },
            totalWasteGen: { $sum: { $ifNull: ["$totalWasteGeneration", 0] } },
            avgBiodegradable: { $avg: { $ifNull: ["$biodegradablePercent", 0] } },
            avgRecyclable: { $avg: { $ifNull: ["$recyclablePercent", 0] } },
            avgResidual: { $avg: { $ifNull: ["$residualPercent", 0] } },
            avgSpecial: { $avg: { $ifNull: ["$specialPercent", 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const complianceMap = {};
    byCompliance.forEach((c) => (complianceMap[c._id] = c.count));

    const provinceMap = {};
    byProvince.forEach((p) => (provinceMap[p._id] = p.count));

    const mbaMap = {};
    byManilaBayArea.forEach((m) => (mbaMap[m._id] = m.count));

    const planTypeMap = {};
    byPlanType.forEach((p) => (planTypeMap[p._id] = p.count));

    const renewalMap = {};
    renewalStatus.forEach((r) => (renewalMap[r._id] = r.count));

    res.json({
      totalRecords,
      byProvince: provinceMap,
      byProvinceList: byProvince,
      byCompliance: complianceMap,
      byManilaBayArea: mbaMap,
      byPlanType: planTypeMap,
      renewalStatus: renewalMap,
      wasteComposition: wasteComposition[0] || {},
      diversionByProvince,
      mapData,
      yearlyTrend,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get records for a municipality across all years (for comparison)
router.get("/history/:municipality", async (req, res) => {
  try {
    const records = await TenYearSWMPlan.find({
      municipality: { $regex: new RegExp(`^${req.params.municipality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    }).sort({ dataYear: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single record
router.get("/:id", async (req, res) => {
  try {
    const record = await TenYearSWMPlan.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create record
router.post("/", async (req, res) => {
  try {
    const record = new TenYearSWMPlan(req.body);
    await record.save();
    res.status(201).json(record);
    writeLog("info", "10yr-swm.create", {
      message: `10-Year SWM Plan entry created: ${record.municipality}, ${record.province}`,
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
    const saved = await TenYearSWMPlan.insertMany(records);
    res.status(201).json({ message: `${saved.length} records imported`, count: saved.length });
    writeLog("info", "10yr-swm.bulk-import", {
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
    const record = await TenYearSWMPlan.findByIdAndUpdate(req.params.id, req.body, {
      returnDocument: "after",
    });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "10yr-swm.update", {
      message: `10-Year SWM Plan entry updated: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete record
router.delete("/:id", async (req, res) => {
  try {
    const record = await TenYearSWMPlan.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "10yr-swm.delete", {
      message: `10-Year SWM Plan entry deleted: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
