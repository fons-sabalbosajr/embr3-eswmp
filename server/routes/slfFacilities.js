const express = require("express");
const mongoose = require("mongoose");
const SlfFacility = require("../models/SlfFacility");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");

const router = express.Router();

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function findPortalFacility(id, slfName, selectFields) {
  let facility = null;
  if (mongoose.isValidObjectId(id)) {
    facility = await SlfFacility.findOne({ _id: id, deletedAt: null }).select(selectFields);
  }
  if (facility || !slfName) return facility;

  const rawName = String(slfName).replace(/\s*\(.*?\)\s*/g, "").trim();
  const nameRx = new RegExp(`^${escapeRegExp(rawName)}$`, "i");
  const cy = new Date().getFullYear();

  facility = await SlfFacility.findOne({
    $or: [{ lgu: nameRx }, { province: nameRx }],
    deletedAt: null,
    dataYear: cy,
  }).select(selectFields);

  if (!facility) {
    facility = await SlfFacility.findOne({
      $or: [{ lgu: nameRx }, { province: nameRx }],
      deletedAt: null,
    }).sort({ dataYear: -1 }).select(selectFields);
  }

  if (facility && mongoose.isValidObjectId(id)) {
    await UserPortal.updateMany(
      { assignedSlf: id },
      { $set: { "assignedSlf.$[elem]": facility._id } },
      { arrayFilters: [{ elem: id }] }
    );
  }

  return facility;
}

const TON_PER_M3 = 0.2;
const ACTIVE_VOLUME_STATUSES = new Set(["pending", "acknowledged", "revert_requested"]);

function normalizeUnit(unit) {
  return String(unit || "m³").replace("m3", "m³");
}

function convertVolume(value, fromUnit = "tons", toUnit = fromUnit) {
  const number = Number(value || 0);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit || from);
  if (!number || from === to) return number;
  if (from === "tons" && to === "m³") return number / TON_PER_M3;
  if (from === "m³" && to === "tons") return number * TON_PER_M3;
  return number;
}

function parseCellIndex(cellName) {
  const match = String(cellName || "").match(/(?:cell\s*)?(\d+)/i);
  return match ? Number(match[1]) - 1 : null;
}

function isHazardousWaste(wasteType) {
  return /haz|inert/i.test(String(wasteType || ""));
}

function isHazardousCell(cellType) {
  return /haz|inert/i.test(String(cellType || ""));
}

function findBestCellIndex(rows, wasteType, preferredIndex = null) {
  if (preferredIndex != null && rows[preferredIndex]) return preferredIndex;
  const hazardous = isHazardousWaste(wasteType);
  const matchIndex = rows.findIndex((row) => row.status !== "Closed" && row.hazardous === hazardous);
  if (matchIndex >= 0) return matchIndex;
  const operationalIndex = rows.findIndex((row) => row.status === "Operational");
  return operationalIndex >= 0 ? operationalIndex : 0;
}

function addVolume(rows, index, value, fromUnit, targetUnit) {
  const row = rows[index] || rows[0];
  if (!row) return;
  row.total += convertVolume(value, fromUnit, targetUnit);
}

async function enrichPortalFacilityVolumes(facilityDoc, requestedSlfName) {
  const facility = facilityDoc.toObject ? facilityDoc.toObject() : { ...facilityDoc };
  const targetUnit = normalizeUnit(facility.volumeCapacityUnit || facility.wasteReceivedUnit || "m³");
  const cellCount = Math.max(Number(facility.numberOfCell || 0), facility.cellCapacities?.length || 0, 1);
  const rows = Array.from({ length: cellCount }, (_, index) => ({
    total: 0,
    status: facility.cellStatuses?.[index] || "Operational",
    hazardous: isHazardousCell(facility.cellTypes?.[index] || "Residual"),
  }));

  const names = [requestedSlfName, facility.lgu, facility.province].filter(Boolean);
  const nameFilters = names.flatMap((name) => [{ slfName: name }, { lguCompanyName: name }]);
  const filters = [{ slfGenerator: facility._id }, ...nameFilters];
  const entries = await DataSLF.find({ deletedAt: null, $or: filters }).sort({ createdAt: -1 }).lean();

  const baseline = entries.find((entry) =>
    entry.totalVolumeAccepted != null ||
    entry.activeCellResidualVolume != null ||
    entry.activeCellInertVolume != null ||
    entry.activeCellHazardousVolume != null ||
    entry.activeCellEntries?.length
  );

  if (baseline?.activeCellEntries?.length) {
    baseline.activeCellEntries.forEach((entry, orderIndex) => {
      const parsedIndex = parseCellIndex(entry.cellName);
      const targetIndex = findBestCellIndex(rows, entry.wasteType, parsedIndex != null && parsedIndex >= 0 ? parsedIndex : orderIndex);
      addVolume(rows, targetIndex, entry.volume, baseline.baselineUnit || targetUnit, targetUnit);
    });
  } else if (baseline) {
    [
      { value: baseline.activeCellResidualVolume, unit: baseline.activeCellResidualUnit, wasteType: "Residual" },
      { value: baseline.activeCellInertVolume, unit: baseline.activeCellInertUnit, wasteType: "Treated Hazardous Waste" },
      { value: baseline.activeCellHazardousVolume, unit: baseline.activeCellHazardousUnit, wasteType: "Hazardous Waste" },
    ].forEach((item) => addVolume(rows, findBestCellIndex(rows, item.wasteType), item.value, item.unit || baseline.baselineUnit || targetUnit, targetUnit));
  }

  entries
    .filter((entry) => ACTIVE_VOLUME_STATUSES.has(entry.status || "pending"))
    .forEach((entry) => {
      (entry.trucks || []).forEach((truck) => {
        addVolume(rows, findBestCellIndex(rows, truck.wasteType), truck.actualVolume, truck.actualVolumeUnit || "tons", targetUnit);
      });
    });

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (total <= 0) return facility;

  return {
    ...facility,
    actualResidualWasteReceived: total,
    wasteReceivedUnit: targetUnit,
    cellFillValues: rows.map((row) => row.total),
    cellFillUnits: rows.map(() => targetUnit),
  };
}

// Get all records (admin management view — respects App Settings year visibility filter)
router.get("/", async (req, res) => {
  try {
    const records = await SlfFacility.find({ deletedAt: null })
      .populate("slfGenerator")
      .sort({ province: 1, lgu: 1 });
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
      "volumeCapacity volumeCapacityUnit receivingVolumeCapacity receivingVolumeCapacityUnit numberOfCell cellCapacities cellCapacityUnits cellStatuses cellTypes cellNotes cellFillValues cellFillUnits estimatedVolumeWaste estimatedVolumeWasteUnit actualResidualWasteReceived wasteReceivedUnit " +
      "noOfLeachatePond numberOfGasVents mrfEstablished yearStartedOperation " +
      "eccNo dischargePermit permitToOperate focalPerson " +
      "leachatePondDetails gasVentDetails trashSlideMeasures firePrevMeasures galleryPhotos slfDocuments";

    const facility = await findPortalFacility(req.params.id, req.query.slfName, selectFields);

    if (!facility) return res.status(404).json({ message: "Facility not found" });
    res.json(await enrichPortalFacilityVolumes(facility, req.query.slfName));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Update facility management details (leachate ponds, gas vents, trash slide, fire prevention)
router.patch("/portal/:id/facility-details", async (req, res) => {
  try {
    const { leachatePondDetails, gasVentDetails, trashSlideMeasures, firePrevMeasures, slfName } = req.body;
    const allowed = {};
    if (leachatePondDetails !== undefined) allowed.leachatePondDetails = leachatePondDetails;
    if (gasVentDetails !== undefined) allowed.gasVentDetails = gasVentDetails;
    if (trashSlideMeasures !== undefined) allowed.trashSlideMeasures = trashSlideMeasures;
    if (firePrevMeasures !== undefined) allowed.firePrevMeasures = firePrevMeasures;

    const existing = await findPortalFacility(req.params.id, slfName || req.query.slfName, "_id");
    if (!existing) return res.status(404).json({ message: "Facility not found" });

    const facility = await SlfFacility.findOneAndUpdate(
      { _id: existing._id, deletedAt: null },
      { $set: allowed },
      { new: true, select: "leachatePondDetails gasVentDetails trashSlideMeasures firePrevMeasures" }
    );
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
    const baseFilter = { deletedAt: null, ...yearFilter };
    const [totalRecords, byProvince, byStatus, byCategory, byOwnership, byManilaBayArea, operationStats, mapData, managementData] =
      await Promise.all([
        SlfFacility.countDocuments(baseFilter),
        SlfFacility.aggregate([
        { $match: baseFilter },
          { $addFields: { _normProvince: { $replaceAll: { input: "$province", find: "Province of ", replacement: "" } } } },
          { $group: { _id: "$_normProvince", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        SlfFacility.aggregate([
        { $match: baseFilter },
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
        { $match: baseFilter },
          { $group: { _id: { $ifNull: ["$category", "Unspecified"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        { $match: baseFilter },
          { $group: { _id: { $ifNull: ["$ownership", "Unspecified"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        { $match: baseFilter },
          { $group: { _id: { $ifNull: ["$manilaBayArea", "Non-MBA"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        { $match: baseFilter },
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
              totalTrashSlideMeasures: { $sum: { $size: { $ifNull: ["$trashSlideMeasures", []] } } },
              totalFirePrevMeasures: { $sum: { $size: { $ifNull: ["$firePrevMeasures", []] } } },
              trashSlideFacilities: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$trashSlideMeasures", []] } }, 0] }, 1, 0] } },
              firePreventionFacilities: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$firePrevMeasures", []] } }, 0] }, 1, 0] } },
            },
          },
        ]),
        SlfFacility.find(
        { ...baseFilter, latitude: { $ne: null }, longitude: { $ne: null } },
          { province: 1, lgu: 1, barangay: 1, manilaBayArea: 1, latitude: 1, longitude: 1, statusOfSLF: 1, category: 1, ownership: 1, volumeCapacity: 1, noOfLGUServed: 1, focalPerson: 1, enmo: 1, yearStartedOperation: 1 }
        ),
        // Per-facility management details for dashboard drill-down modals
        SlfFacility.find(baseFilter, {
          province: 1, lgu: 1, statusOfSLF: 1, dataYear: 1,
          noOfLeachatePond: 1, numberOfGasVents: 1,
          numberOfCell: 1, cellCapacities: 1, cellCapacityUnits: 1, cellStatuses: 1, cellTypes: 1, cellFillValues: 1, cellFillUnits: 1,
          leachatePondDetails: 1, gasVentDetails: 1,
          trashSlideMeasures: 1, firePrevMeasures: 1,
          noOfLGUServed: 1, actualResidualWasteReceived: 1, ownership: 1, category: 1, volumeCapacity: 1, volumeCapacityUnit: 1, receivingVolumeCapacity: 1, receivingVolumeCapacityUnit: 1,
        }).sort({ province: 1, lgu: 1 }),
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
      managementData,
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
    const record = await SlfFacility.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      req.body,
      { returnDocument: "after" }
    );
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
    if (cellIndex == null || !["Operational", "Closed", "Under Construction", "Reserved Cell"].includes(status)) {
      return res.status(400).json({ message: "cellIndex and valid status (Operational/Closed/Under Construction/Reserved Cell) required" });
    }
    const facility = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null });
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
    const record = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Record not found" });

    record.deletedAt = new Date();
    record.deletedBy = req.logUser || "admin";
    await record.save();

    res.json({ message: "Record moved to trash" });
    writeLog("warn", "slfFacility.delete", { message: `Soft-deleted SLF: ${req.params.id}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// List soft-deleted SLF records
router.get("/trash/list", async (req, res) => {
  try {
    const records = await SlfFacility.find({ deletedAt: { $ne: null } })
      .setOptions({ includeHiddenYears: true })
      .populate("slfGenerator")
      .sort({ deletedAt: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Restore a soft-deleted SLF record
router.patch("/:id/restore", async (req, res) => {
  try {
    const record = await SlfFacility.findById(req.params.id).setOptions({ includeHiddenYears: true });
    if (!record) return res.status(404).json({ message: "Record not found" });
    if (!record.deletedAt) return res.status(400).json({ message: "Record is not deleted" });

    record.deletedAt = null;
    record.deletedBy = null;
    await record.save();

    const populated = await SlfFacility.findById(record._id)
      .setOptions({ includeHiddenYears: true })
      .populate("slfGenerator");
    res.json(populated);
    writeLog("info", "slfFacility.restore", { message: `Restored SLF: ${record._id}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Permanently delete a soft-deleted SLF record
router.delete("/:id/permanent", async (req, res) => {
  try {
    const record = await SlfFacility.findById(req.params.id).setOptions({ includeHiddenYears: true });
    if (!record) return res.status(404).json({ message: "Record not found" });
    if (!record.deletedAt) return res.status(400).json({ message: "Record must be soft-deleted first" });

    await SlfFacility.deleteOne({ _id: req.params.id }).setOptions({ includeHiddenYears: true });
    res.json({ message: "Record permanently deleted" });
    writeLog("warn", "slfFacility.permanent-delete", { message: `Permanently deleted SLF: ${record._id}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// History: all year records for an LGU (bypass visibility so admin sees all years)
router.get("/history/:lgu", async (req, res) => {
  try {
    const records = await SlfFacility.find({
      lgu: { $regex: new RegExp(`^${req.params.lgu.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      deletedAt: null,
    }).setOptions({ includeHiddenYears: true }).populate("slfGenerator").sort({ dataYear: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
