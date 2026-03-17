const express = require("express");
const LguInitiatedMRF = require("../models/LguInitiatedMRF");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await LguInitiatedMRF.find().sort({ province: 1, municipality: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [
      totalRecords,
      byProvince,
      byMRFType,
      byStatus,
      byManilaBayArea,
      fundingStats,
      diversionByProvince,
      mapData,
    ] = await Promise.all([
      LguInitiatedMRF.countDocuments(),
      LguInitiatedMRF.aggregate([
        { $addFields: { _normProvince: { $replaceAll: { input: "$province", find: "Province of ", replacement: "" } } } },
        { $group: { _id: "$_normProvince", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      LguInitiatedMRF.aggregate([
        { $group: { _id: "$typeOfMRF", count: { $sum: 1 } } },
      ]),
      LguInitiatedMRF.aggregate([
        {
          $group: {
            _id: {
              $cond: [
                { $regexMatch: { input: { $ifNull: ["$statusOfMRF", ""] }, regex: /operational/i } },
                {
                  $cond: [
                    { $regexMatch: { input: { $ifNull: ["$statusOfMRF", ""] }, regex: /non/i } },
                    "Non-Operational",
                    "Operational",
                  ],
                },
                "Not Yet Monitored",
              ],
            },
            count: { $sum: 1 },
          },
        },
      ]),
      LguInitiatedMRF.aggregate([
        { $group: { _id: "$manilaBayArea", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      LguInitiatedMRF.aggregate([
        {
          $group: {
            _id: null,
            totalCost: { $sum: { $ifNull: ["$estimatedCost", 0] } },
            avgCost: { $avg: { $ifNull: ["$estimatedCost", 0] } },
            avgDiversionRate: { $avg: { $ifNull: ["$wasteDiversionRate", 0] } },
            totalWasteGen: { $sum: { $ifNull: ["$totalWasteGeneration", 0] } },
            totalBrgyServed: { $sum: { $ifNull: ["$noOfBrgyServed", 0] } },
          },
        },
      ]),
      LguInitiatedMRF.aggregate([
        {
          $group: {
            _id: "$province",
            avgDiversion: { $avg: { $ifNull: ["$wasteDiversionRate", 0] } },
            totalCost: { $sum: { $ifNull: ["$estimatedCost", 0] } },
            count: { $sum: 1 },
          },
        },
        { $sort: { avgDiversion: -1 } },
      ]),
      LguInitiatedMRF.find(
        { latitude: { $ne: null }, longitude: { $ne: null } },
        {
          municipality: 1, province: 1, barangay: 1,
          latitude: 1, longitude: 1,
          manilaBayArea: 1, congressionalDistrict: 1,
          typeOfMRF: 1, yearEstablished: 1, estimatedCost: 1,
          fundingSource: 1, statusOfMRF: 1, focalPerson: 1,
          enmoAssigned: 1, wasteDiversionRate: 1, totalWasteGeneration: 1,
          noOfBrgyServed: 1, signedDocument: 1,
        }
      ).lean(),
    ]);

    const provinceMap = {};
    byProvince.forEach((p) => (provinceMap[p._id] = p.count));

    const mrfTypeMap = {};
    byMRFType.forEach((m) => (mrfTypeMap[m._id] = m.count));

    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));

    const mbaMap = {};
    byManilaBayArea.forEach((m) => (mbaMap[m._id] = m.count));

    res.json({
      totalRecords,
      byProvince: provinceMap,
      byProvinceList: byProvince,
      byMRFType: mrfTypeMap,
      byStatus: statusMap,
      byManilaBayArea: mbaMap,
      fundingStats: fundingStats[0] || {},
      diversionByProvince,
      mapData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single record
router.get("/:id", async (req, res) => {
  try {
    const record = await LguInitiatedMRF.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create record
router.post("/", async (req, res) => {
  try {
    const record = new LguInitiatedMRF(req.body);
    await record.save();
    res.status(201).json(record);
    writeLog("info", "lgu-mrf.create", {
      message: `LGU Initiated MRF entry created: ${record.municipality}, ${record.province}`,
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
    const saved = await LguInitiatedMRF.insertMany(records);
    res.status(201).json({ message: `${saved.length} records imported`, count: saved.length });
    writeLog("info", "lgu-mrf.bulk-import", {
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
    const record = await LguInitiatedMRF.findByIdAndUpdate(req.params.id, req.body, {
      returnDocument: "after",
    });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "lgu-mrf.update", {
      message: `LGU Initiated MRF entry updated: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete record
router.delete("/:id", async (req, res) => {
  try {
    const record = await LguInitiatedMRF.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "lgu-mrf.delete", {
      message: `LGU Initiated MRF entry deleted: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
