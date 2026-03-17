const express = require("express");
const SwmEquipment = require("../models/SwmEquipment");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await SwmEquipment.find().sort({ province: 1, municipality: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [totalRecords, byProvince, byType, byManilaBayArea, equipmentStatus, mapData] =
      await Promise.all([
        SwmEquipment.countDocuments(),
        SwmEquipment.aggregate([
          { $addFields: { _normProvince: { $replaceAll: { input: "$province", find: "Province of ", replacement: "" } } } },
          { $group: { _id: "$_normProvince", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        SwmEquipment.aggregate([
          { $group: { _id: { $ifNull: ["$typeOfEquipment", "Unspecified"] }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        SwmEquipment.aggregate([
          {
            $group: {
              _id: { $ifNull: ["$manilaBayArea", "Non-MBA"] },
              count: { $sum: 1 },
            },
          },
        ]),
        SwmEquipment.aggregate([
          {
            $group: {
              _id: null,
              totalSoilEnhancer: { $sum: { $ifNull: ["$weightOfSoilEnhancer", 0] } },
              totalChairsProduced: { $sum: { $ifNull: ["$noPlasticChairProduced", 0] } },
            },
          },
        ]),
        SwmEquipment.find(
          { latitude: { $ne: null }, longitude: { $ne: null } },
          { province: 1, municipality: 1, barangay: 1, manilaBayArea: 1, latitude: 1, longitude: 1, typeOfEquipment: 1, statusOfBioShredder: 1, statusOfBioComposter: 1, statusOfCCTV: 1, statusOfPlasticChairFactory: 1, focalPerson: 1, enmoAssigned: 1 }
        ),
      ]);

    const typeMap = {};
    byType.forEach((t) => (typeMap[t._id] = t.count));
    const mbaMap = {};
    byManilaBayArea.forEach((m) => (mbaMap[m._id] = m.count));

    res.json({
      totalRecords,
      byProvinceList: byProvince,
      byType: typeMap,
      byManilaBayArea: mbaMap,
      equipmentStatus: equipmentStatus[0] || { totalSoilEnhancer: 0, totalChairsProduced: 0 },
      mapData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create
router.post("/", async (req, res) => {
  try {
    const record = await SwmEquipment.create(req.body);
    res.status(201).json(record);
    writeLog("info", "swmEquipment.create", { message: `Created equipment: ${record.municipality}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update
router.put("/:id", async (req, res) => {
  try {
    const record = await SwmEquipment.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "swmEquipment.update", { message: `Updated equipment: ${record.municipality}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete
router.delete("/:id", async (req, res) => {
  try {
    const record = await SwmEquipment.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "swmEquipment.delete", { message: `Deleted equipment: ${req.params.id}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
