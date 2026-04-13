const express = require("express");
const SlfFacility = require("../models/SlfFacility");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Get all records
router.get("/", async (req, res) => {
  try {
    const records = await SlfFacility.find().populate("slfGenerator").sort({ province: 1, lgu: 1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get facility operational info for portal users (by SlfFacility _id, with name fallback)
router.get("/portal/:id", async (req, res) => {
  try {
    const selectFields =
      "province lgu barangay category ownership statusOfSLF remainingLifeSpan " +
      "volumeCapacity numberOfCell cellCapacities cellStatuses estimatedVolumeWaste actualResidualWasteReceived " +
      "noOfLeachatePond numberOfGasVents mrfEstablished yearStartedOperation " +
      "eccNo dischargePermit permitToOperate focalPerson";

    let facility = await SlfFacility.findById(req.params.id).select(selectFields);

    // Fallback: if the ObjectId reference is stale (e.g. after re-seeding),
    // look up by slfName from the portal user and update the reference.
    if (!facility && req.query.slfName) {
      // Strip parenthetical suffixes and trim to get the core LGU name
      const rawName = req.query.slfName.replace(/\s*\(.*?\)\s*/g, "").trim();
      const nameRx = new RegExp(`^${rawName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      const cy = new Date().getFullYear();

      // Try current year first, then any year (most recent)
      facility = await SlfFacility.findOne({
        $or: [{ lgu: nameRx }, { province: nameRx }],
        dataYear: cy,
      }).select(selectFields);

      if (!facility) {
        facility = await SlfFacility.findOne({
          $or: [{ lgu: nameRx }, { province: nameRx }],
        }).sort({ dataYear: -1 }).select(selectFields);
      }

      // Update the portal user's stale reference (supports array field)
      if (facility) {
        await UserPortal.updateMany(
          { assignedSlf: req.params.id },
          { $set: { "assignedSlf.$[elem]": facility._id } },
          { arrayFilters: [{ elem: req.params.id }] }
        );
      }
    }

    if (!facility) return res.status(404).json({ message: "Facility not found" });
    res.json(facility);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const yearFilter = req.query.year ? { dataYear: Number(req.query.year) } : {};
    const [totalRecords, byProvince, byStatus, byCategory, byOwnership, byManilaBayArea, operationStats, mapData] =
      await Promise.all([
        SlfFacility.countDocuments(yearFilter),
        SlfFacility.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          { $addFields: { _normProvince: { $replaceAll: { input: "$province", find: "Province of ", replacement: "" } } } },
          { $group: { _id: "$_normProvince", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        SlfFacility.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          {
            $group: {
              _id: {
                $cond: [
                  { $regexMatch: { input: { $ifNull: ["$statusOfSLF", ""] }, regex: /operational/i } },
                  {
                    $cond: [
                      { $regexMatch: { input: { $ifNull: ["$statusOfSLF", ""] }, regex: /non/i } },
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
        SlfFacility.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          { $group: { _id: { $ifNull: ["$category", "Unspecified"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          { $group: { _id: { $ifNull: ["$ownership", "Unspecified"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          { $group: { _id: { $ifNull: ["$manilaBayArea", "Non-MBA"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        ...(Object.keys(yearFilter).length ? [{ $match: yearFilter }] : []),
          {
            $group: {
              _id: null,
              totalCapacity: { $sum: { $ifNull: ["$volumeCapacity", 0] } },
              totalLGUsServed: { $sum: { $ifNull: ["$noOfLGUServed", 0] } },
              totalCells: { $sum: { $ifNull: ["$numberOfCell", 0] } },
              totalLeachatePonds: { $sum: { $ifNull: ["$noOfLeachatePond", 0] } },
              totalGasVents: { $sum: { $ifNull: ["$numberOfGasVents", 0] } },
              totalWasteReceived: { $sum: { $ifNull: ["$actualResidualWasteReceived", 0] } },
              totalEstimatedVolume: { $sum: { $ifNull: ["$estimatedVolumeWaste", 0] } },
            },
          },
        ]),
        SlfFacility.find(
        { ...yearFilter, latitude: { $ne: null }, longitude: { $ne: null } },
          { province: 1, lgu: 1, barangay: 1, manilaBayArea: 1, latitude: 1, longitude: 1, statusOfSLF: 1, category: 1, ownership: 1, volumeCapacity: 1, noOfLGUServed: 1, focalPerson: 1, enmo: 1, yearStartedOperation: 1 }
        ),
      ]);

    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));
    const catMap = {};
    byCategory.forEach((c) => (catMap[c._id] = c.count));
    const ownMap = {};
    byOwnership.forEach((o) => (ownMap[o._id] = o.count));
    const mbaMap = {};
    byManilaBayArea.forEach((m) => (mbaMap[m._id] = m.count));

    res.json({
      totalRecords,
      byProvinceList: byProvince,
      byStatus: statusMap,
      byCategory: catMap,
      byOwnership: ownMap,
      byManilaBayArea: mbaMap,
      operationStats: operationStats[0] || {},
      mapData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create
router.post("/", async (req, res) => {
  try {
    const record = await SlfFacility.create(req.body);
    res.status(201).json(record);
    writeLog("info", "slfFacility.create", { message: `Created SLF: ${record.lgu}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update
router.put("/:id", async (req, res) => {
  try {
    const record = await SlfFacility.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json(record);
    writeLog("info", "slfFacility.update", { message: `Updated SLF: ${record.lgu}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update cell status (admin toggle operational/closed)
router.patch("/:id/cell-status", async (req, res) => {
  try {
    const { cellIndex, status } = req.body;
    if (cellIndex == null || !["Operational", "Closed"].includes(status)) {
      return res.status(400).json({ message: "cellIndex and valid status (Operational/Closed) required" });
    }
    const facility = await SlfFacility.findById(req.params.id);
    if (!facility) return res.status(404).json({ message: "Facility not found" });

    // Ensure cellStatuses array is sized correctly
    const cells = facility.numberOfCell || 0;
    if (!facility.cellStatuses || facility.cellStatuses.length < cells) {
      facility.cellStatuses = Array.from({ length: cells }, (_, i) =>
        facility.cellStatuses?.[i] || "Operational"
      );
    }
    if (cellIndex >= cells) return res.status(400).json({ message: "cellIndex out of range" });

    facility.cellStatuses[cellIndex] = status;
    facility.markModified("cellStatuses");
    await facility.save();
    res.json(facility);
    writeLog("info", "slfFacility.cellStatus", {
      message: `Cell ${cellIndex + 1} set to ${status} for ${facility.lgu}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete
router.delete("/:id", async (req, res) => {
  try {
    const record = await SlfFacility.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Record deleted" });
    writeLog("warn", "slfFacility.delete", { message: `Deleted SLF: ${req.params.id}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// History: all year records for an LGU
router.get("/history/:lgu", async (req, res) => {
  try {
    const records = await SlfFacility.find({
      lgu: { $regex: new RegExp(`^${req.params.lgu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    }).populate("slfGenerator").sort({ dataYear: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
