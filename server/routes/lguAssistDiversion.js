const express = require("express");
const LguAssistDiversion = require("../models/LguAssistDiversion");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await LguAssistDiversion.find().sort({ province: 1, lgu: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [totalRecords, byProvince, byStatus, wasteStats] = await Promise.all([
      LguAssistDiversion.countDocuments(),
      LguAssistDiversion.aggregate([
        { $group: { _id: "$province", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      LguAssistDiversion.aggregate([
        { $group: { _id: { $ifNull: ["$statusAccomplishment", "Unknown"] }, count: { $sum: 1 } } },
      ]),
      LguAssistDiversion.aggregate([
        {
          $group: {
            _id: null,
            avgDiversion: { $avg: { $ifNull: ["$percentageWasteDiversion", 0] } },
            totalWasteGen: { $sum: { $ifNull: ["$totalWasteGeneration", 0] } },
            totalDiverted: { $sum: { $ifNull: ["$totalWasteDiverted", 0] } },
          },
        },
      ]),
    ]);

    const provinceMap = {};
    byProvince.forEach((p) => (provinceMap[p._id] = p.count));
    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));

    res.json({
      totalRecords,
      byProvince: provinceMap,
      byStatus: statusMap,
      wasteStats: wasteStats[0] || {},
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single record
router.get("/:id", async (req, res) => {
  try {
    const record = await LguAssistDiversion.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create record
router.post("/", async (req, res) => {
  try {
    const record = new LguAssistDiversion(req.body);
    await record.save();
    res.status(201).json(record);
    writeLog("info", "lgu-assist-diversion.create", {
      message: `LGU Assistance entry created: ${record.lgu}, ${record.province}`,
      req,
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
    const saved = await LguAssistDiversion.insertMany(records);
    res.status(201).json({ message: `${saved.length} records imported`, count: saved.length });
    writeLog("info", "lgu-assist-diversion.bulk-import", {
      message: `Bulk import: ${saved.length} records`,
      req,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update record
router.put("/:id", async (req, res) => {
  try {
    const record = await LguAssistDiversion.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "lgu-assist-diversion.update", {
      message: `LGU Assistance entry updated: ${record.lgu}, ${record.province}`,
      req,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete record
router.delete("/:id", async (req, res) => {
  try {
    const record = await LguAssistDiversion.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "lgu-assist-diversion.delete", {
      message: `LGU Assistance entry deleted: ${record.lgu}, ${record.province}`,
      req,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
