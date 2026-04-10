const express = require("express");
const TrashTrap = require("../models/TrashTrap");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await TrashTrap.find().sort({ province: 1, municipality: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const yearFilter = req.query.year ? { dataYear: Number(req.query.year) } : {};
    const [totalRecords, byProvince, byStatus, byManilaBayArea, operationStats, mapData] =
      await Promise.all([
        TrashTrap.countDocuments(yearFilter),
        TrashTrap.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          { $addFields: { _normProvince: { $replaceAll: { input: "$province", find: "Province of ", replacement: "" } } } },
          { $group: { _id: "$_normProvince", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        TrashTrap.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          {
            $group: {
              _id: {
                $cond: [
                  { $regexMatch: { input: { $ifNull: ["$statusOfTrashTraps", ""] }, regex: /operational/i } },
                  {
                    $cond: [
                      { $regexMatch: { input: { $ifNull: ["$statusOfTrashTraps", ""] }, regex: /non/i } },
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
        TrashTrap.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          {
            $group: {
              _id: { $ifNull: ["$manilaBayArea", "Non-MBA"] },
              count: { $sum: 1 },
            },
          },
        ]),
        TrashTrap.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          {
            $group: {
              _id: null,
              totalHDPE: { $sum: { $ifNull: ["$noOfTrashTrapsHDPE", 0] } },
              totalWasteHauled: { $sum: { $ifNull: ["$estimatedVolumeWasteHauled", 0] } },
              avgWasteHauled: { $avg: { $ifNull: ["$estimatedVolumeWasteHauled", 0] } },
            },
          },
        ]),
        TrashTrap.find(
        { ...yearFilter, latitude: { $ne: null }, longitude: { $ne: null } },
          { province: 1, municipality: 1, barangay: 1, manilaBayArea: 1, latitude: 1, longitude: 1, statusOfTrashTraps: 1, noOfTrashTrapsHDPE: 1, estimatedVolumeWasteHauled: 1, focalPerson: 1, enmoAssigned: 1, dateInstalled: 1 }
        ),
      ]);

    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));
    const mbaMap = {};
    byManilaBayArea.forEach((m) => (mbaMap[m._id] = m.count));

    res.json({
      totalRecords,
      byProvinceList: byProvince,
      byStatus: statusMap,
      byManilaBayArea: mbaMap,
      operationStats: operationStats[0] || { totalHDPE: 0, totalWasteHauled: 0, avgWasteHauled: 0 },
      mapData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single record by ID
router.get("/:id", async (req, res) => {
  try {
    const record = await TrashTrap.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Not found" });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create
router.post("/", async (req, res) => {
  try {
    const record = await TrashTrap.create(req.body);
    res.status(201).json(record);
    writeLog("info", "trashTrap.create", { message: `Created trash trap: ${record.municipality}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update
router.put("/:id", async (req, res) => {
  try {
    const record = await TrashTrap.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "trashTrap.update", { message: `Updated trash trap: ${record.municipality}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete
router.delete("/:id", async (req, res) => {
  try {
    const record = await TrashTrap.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "trashTrap.delete", { message: `Deleted trash trap: ${req.params.id}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// History: all year records for a municipality
router.get("/history/:municipality", async (req, res) => {
  try {
    const records = await TrashTrap.find({
      municipality: { $regex: new RegExp(`^${req.params.municipality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    }).sort({ dataYear: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
