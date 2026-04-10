const express = require("express");
const TechnicalAssistance = require("../models/TechnicalAssistance");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await TechnicalAssistance.find().sort({ province: 1, municipality: 1, barangay: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const yearFilter = req.query.year ? { dataYear: Number(req.query.year) } : {};
    const [totalRecords, byProvince, byStatus, byFacilityType, byManilaBayArea] = await Promise.all([
      TechnicalAssistance.countDocuments(yearFilter),
      TechnicalAssistance.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
        { $group: { _id: "$province", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      TechnicalAssistance.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
        { $group: { _id: { $ifNull: ["$status", "Unknown"] }, count: { $sum: 1 } } },
      ]),
      TechnicalAssistance.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
        { $group: { _id: { $ifNull: ["$typeOfFacility", "Unknown"] }, count: { $sum: 1 } } },
      ]),
      TechnicalAssistance.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
        { $group: { _id: "$manilaBayArea", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const provinceMap = {};
    byProvince.forEach((p) => (provinceMap[p._id] = p.count));
    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));
    const facilityMap = {};
    byFacilityType.forEach((f) => (facilityMap[f._id] = f.count));
    const mbaMap = {};
    byManilaBayArea.forEach((m) => (mbaMap[m._id] = m.count));

    res.json({ totalRecords, byProvince: provinceMap, byStatus: statusMap, byFacilityType: facilityMap, byManilaBayArea: mbaMap });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single record
router.get("/:id", async (req, res) => {
  try {
    const record = await TechnicalAssistance.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create record
router.post("/", async (req, res) => {
  try {
    const record = new TechnicalAssistance(req.body);
    await record.save();
    res.status(201).json(record);
    writeLog("info", "technical-assistance.create", {
      message: `Tech Assist entry created: ${record.barangay}, ${record.municipality}`,
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
    const saved = await TechnicalAssistance.insertMany(records);
    res.status(201).json({ message: `${saved.length} records imported`, count: saved.length });
    writeLog("info", "technical-assistance.bulk-import", {
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
    const record = await TechnicalAssistance.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "technical-assistance.update", {
      message: `Tech Assist entry updated: ${record.barangay}, ${record.municipality}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete record
router.delete("/:id", async (req, res) => {
  try {
    const record = await TechnicalAssistance.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "technical-assistance.delete", {
      message: `Tech Assist entry deleted: ${record.barangay}, ${record.municipality}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// History: all year records for a municipality
router.get("/history/:municipality", async (req, res) => {
  try {
    const records = await TechnicalAssistance.find({
      municipality: { $regex: new RegExp(`^${req.params.municipality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    }).sort({ dataYear: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
