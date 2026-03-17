const express = require("express");
const TransferStation = require("../models/TransferStation");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await TransferStation.find().sort({ province: 1, municipality: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [totalRecords, byProvince, byStatus, byManilaBayArea] = await Promise.all([
      TransferStation.countDocuments(),
      TransferStation.aggregate([
        { $group: { _id: "$province", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      TransferStation.aggregate([
        { $group: { _id: { $ifNull: ["$statusOfFacility", "Unknown"] }, count: { $sum: 1 } } },
      ]),
      TransferStation.aggregate([
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
    const record = await TransferStation.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create record
router.post("/", async (req, res) => {
  try {
    const record = new TransferStation(req.body);
    await record.save();
    res.status(201).json(record);
    writeLog("info", "transfer-stations.create", {
      message: `Transfer Station entry created: ${record.municipality}, ${record.province}`,
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
    const saved = await TransferStation.insertMany(records);
    res.status(201).json({ message: `${saved.length} records imported`, count: saved.length });
    writeLog("info", "transfer-stations.bulk-import", {
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
    const record = await TransferStation.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "transfer-stations.update", {
      message: `Transfer Station entry updated: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete record
router.delete("/:id", async (req, res) => {
  try {
    const record = await TransferStation.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "transfer-stations.delete", {
      message: `Transfer Station entry deleted: ${record.municipality}, ${record.province}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
