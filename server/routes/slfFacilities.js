const express = require("express");
const mongoose = require("mongoose");
const SlfFacility = require("../models/SlfFacility");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const Notification = require("../models/Notification");
const { writeLog } = require("../utils/logger");
const { notifyAdmin, notifyPortal, refreshAdmin, refreshPortal } = require("../utils/socketEmit");

const router = express.Router();

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Refresh every portal user assigned to a facility so their Portal Submissions
// view + facility info reflect an admin-side SLF Data Table edit immediately.
async function refreshAssignedPortalUsers(req, facilityId, target = "facility") {
  try {
    const assigned = await UserPortal.find({ assignedSlf: facilityId })
      .select("email")
      .lean();
    assigned.forEach((pu) => pu.email && refreshPortal(req, pu.email, target));
  } catch {
    /* best-effort real-time refresh — never break the request */
  }
}

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

function isActiveCellStatus(status) {
  return ["Active Cell", "Operational", "Active"].includes(String(status || ""));
}

function normalizeCellStatus(status) {
  const value = String(status || "").trim();
  if (/^operational$/i.test(value)) return "Active Cell";
  if (/^closed$/i.test(value)) return "Used/Completed";
  if (/^reserved cell$/i.test(value)) return "Reserved Area";
  return value || "Active Cell";
}

function getDataEntryId(entry) {
  return entry?._id ? String(entry._id) : "";
}

function isSameDataEntry(left, right) {
  const leftId = getDataEntryId(left);
  const rightId = getDataEntryId(right);
  return !!leftId && !!rightId && leftId === rightId;
}

function hasTruckVolume(entry) {
  return (entry?.trucks || []).some((truck) => Number(truck?.actualVolume || 0) > 0);
}

function getPortalVolumeUnit(baseline, submissions, facility) {
  return normalizeUnit(
    submissions
      .flatMap((entry) => entry.trucks || [])
      .find((truck) => Number(truck?.actualVolume || 0) > 0 && truck.actualVolumeUnit)?.actualVolumeUnit ||
    (baseline?.activeCellEntries || []).find((entry) => Number(entry?.volume || 0) > 0 && entry.unit)?.unit ||
    baseline?.baselineUnit ||
    baseline?.activeCellResidualUnit ||
    baseline?.totalVolumeAcceptedUnit ||
    facility?.wasteReceivedUnit ||
    facility?.cellFillUnits?.find(Boolean) ||
    facility?.cellCapacityUnits?.find(Boolean) ||
    facility?.volumeCapacityUnit ||
    "m³"
  );
}

function findBestCellIndex(rows, wasteType, preferredIndex = null) {
  if (preferredIndex != null && rows[preferredIndex] && isActiveCellStatus(rows[preferredIndex].status)) return preferredIndex;
  const hazardous = isHazardousWaste(wasteType);
  const matchIndex = rows.findIndex((row) => isActiveCellStatus(row.status) && row.hazardous === hazardous);
  if (matchIndex >= 0) return matchIndex;
  const operationalIndex = rows.findIndex((row) => isActiveCellStatus(row.status));
  return operationalIndex >= 0 ? operationalIndex : 0;
}

function addVolume(rows, index, value, fromUnit, targetUnit) {
  const row = rows[index] || rows[0];
  if (!row) return;
  row.total += convertVolume(value, fromUnit, targetUnit);
}

async function enrichPortalFacilityVolumes(facilityDoc, requestedSlfName) {
  const facility = facilityDoc.toObject ? facilityDoc.toObject() : { ...facilityDoc };
  const names = [...new Set([requestedSlfName, facility.lgu].filter(Boolean))];
  const nameFilters = names.map((name) => ({ slfName: new RegExp(`^${escapeRegExp(name)}$`, "i") }));
  const filters = [{ slfGenerator: facility._id }, ...nameFilters];
  // Only pull the fields the enrichment actually needs. Fetching full submission
  // documents (with their large trucks.vehicles arrays) over the DB connection
  // made this endpoint take 30s–2min for busy SLFs, which caused the portal to
  // abort the request and show "no cells configured". The trucks.vehicles nested
  // arrays are intentionally excluded.
  // The facility scope MUST be wrapped in $and (not a top-level $or): the
  // year-visibility plugin adds its OWN top-level $or via .where(), which would
  // otherwise CLOBBER the $or scope and make this query return every SLF's
  // records (slow + wrong cell fills).
  const entries = await DataSLF.find({ deletedAt: null, $and: [{ $or: filters }] })
    .select(
      "slfGenerator slfName status createdAt totalVolumeAccepted totalVolumeAcceptedUnit " +
      "baselineUnit activeCellResidualVolume activeCellResidualUnit activeCellInertVolume " +
      "activeCellInertUnit activeCellHazardousVolume activeCellHazardousUnit activeCellEntries " +
      "trucks.actualVolume trucks.actualVolumeUnit trucks.wasteType trucks.cellIndex trucks.cellName",
    )
    .sort({ createdAt: -1 })
    .lean();

  const baseline = entries.find((entry) =>
    entry.totalVolumeAccepted != null ||
    entry.activeCellResidualVolume != null ||
    entry.activeCellInertVolume != null ||
    entry.activeCellHazardousVolume != null ||
    entry.activeCellEntries?.length
  );
  const matchingSubmissions = entries.filter((entry) =>
    ACTIVE_VOLUME_STATUSES.has(entry.status || "pending") &&
    !isSameDataEntry(entry, baseline) &&
    hasTruckVolume(entry)
  );
  const targetUnit = getPortalVolumeUnit(baseline, matchingSubmissions, facility);
  const cellCount = Math.max(Number(facility.numberOfCell || 0), facility.cellCapacities?.length || 0, 1);
  const rows = Array.from({ length: cellCount }, (_, index) => ({
    total: 0,
    status: normalizeCellStatus(facility.cellStatuses?.[index]),
    hazardous: isHazardousCell(facility.cellTypes?.[index] || "Residual"),
  }));

  if (baseline?.activeCellEntries?.length) {
    baseline.activeCellEntries.forEach((entry, orderIndex) => {
      const parsedIndex = parseCellIndex(entry.cellName);
      const targetIndex = findBestCellIndex(rows, entry.wasteType, parsedIndex != null && parsedIndex >= 0 ? parsedIndex : orderIndex);
      addVolume(rows, targetIndex, entry.volume, entry.unit || baseline.baselineUnit || targetUnit, targetUnit);
    });
  } else if (baseline) {
    [
      { value: baseline.activeCellResidualVolume, unit: baseline.activeCellResidualUnit, wasteType: "Residual" },
      { value: baseline.activeCellInertVolume, unit: baseline.activeCellInertUnit, wasteType: "Treated Hazardous Waste" },
      { value: baseline.activeCellHazardousVolume, unit: baseline.activeCellHazardousUnit, wasteType: "Hazardous Waste" },
    ].forEach((item) => addVolume(rows, findBestCellIndex(rows, item.wasteType), item.value, item.unit || baseline.baselineUnit || targetUnit, targetUnit));
  }

  matchingSubmissions.forEach((entry) => {
      (entry.trucks || []).forEach((truck) => {
        const explicitIndex = Number.isInteger(truck.cellIndex) ? truck.cellIndex : parseCellIndex(truck.cellName);
        addVolume(rows, findBestCellIndex(rows, truck.wasteType, explicitIndex), truck.actualVolume, truck.actualVolumeUnit || "tons", targetUnit);
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
    // Dummy/test SLF records are managed under Developer Settings > Dummy Data
    // Configuration and excluded from the real SLF Data Table by default.
    const filter = { deletedAt: null };
    if (req.query.includeDummy !== "true") filter.isDummy = { $ne: true };
    const records = await SlfFacility.find(filter)
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
      "volumeCapacity volumeCapacityUnit receivingVolumeCapacity receivingVolumeCapacityUnit numberOfCell cellCapacities cellCapacityUnits cellStatuses cellTypes cellSubmissionAllowed cellNotes cellFillValues cellFillUnits estimatedVolumeWaste estimatedVolumeWasteUnit actualResidualWasteReceived wasteReceivedUnit " +
      "noOfLeachatePond numberOfGasVents mrfEstablished yearStartedOperation " +
      "eccNo dischargePermit dischargePermitValidity dischargePermitStatus dischargePermits permitToOperate permitToOperateValidity permitToOperateStatus permitToOperatePermits focalPerson " +
      "receivingFacilities hasWastewaterTreatmentFacility wastewaterTreatmentFacilityType wastewaterTreatmentFacilityRemarks leachatePondDetails gasVentDetails trashSlideMeasures firePrevMeasures galleryPhotos galleryItems slfDocuments preventiveMeasureFiles scrpDetails";

    const facility = await findPortalFacility(req.params.id, req.query.slfName, selectFields);

    if (!facility) return res.status(404).json({ message: "Facility not found" });
    res.json(await enrichPortalFacilityVolumes(facility, req.query.slfName));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Update facility management details (Leachate Treatment Plant, gas vents, trash slide, fire prevention)
router.patch("/portal/:id/facility-details", async (req, res) => {
  try {
    const { leachatePondDetails, gasVentDetails, trashSlideMeasures, firePrevMeasures, hasWastewaterTreatmentFacility, wastewaterTreatmentFacilityType, wastewaterTreatmentFacilityRemarks, slfName } = req.body;
    const allowed = {};
    if (leachatePondDetails !== undefined) allowed.leachatePondDetails = leachatePondDetails;
    if (gasVentDetails !== undefined) allowed.gasVentDetails = gasVentDetails;
    if (trashSlideMeasures !== undefined) allowed.trashSlideMeasures = trashSlideMeasures;
    if (firePrevMeasures !== undefined) allowed.firePrevMeasures = firePrevMeasures;
    if (hasWastewaterTreatmentFacility !== undefined) allowed.hasWastewaterTreatmentFacility = hasWastewaterTreatmentFacility;
    if (wastewaterTreatmentFacilityType !== undefined) allowed.wastewaterTreatmentFacilityType = wastewaterTreatmentFacilityType;
    if (wastewaterTreatmentFacilityRemarks !== undefined) allowed.wastewaterTreatmentFacilityRemarks = wastewaterTreatmentFacilityRemarks;

    const existing = await findPortalFacility(req.params.id, slfName || req.query.slfName, "_id");
    if (!existing) return res.status(404).json({ message: "Facility not found" });

    const facility = await SlfFacility.findOneAndUpdate(
      { _id: existing._id, deletedAt: null },
      { $set: allowed },
      { returnDocument: "after", select: "leachatePondDetails gasVentDetails trashSlideMeasures firePrevMeasures hasWastewaterTreatmentFacility wastewaterTreatmentFacilityType wastewaterTreatmentFacilityRemarks" }
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
    const update = { ...(req.body || {}) };
    ["_id", "id", "createdAt", "updatedAt", "deletedAt", "__v"].forEach((key) => delete update[key]);
    Object.keys(update).forEach((key) => {
      if (key.startsWith("_")) delete update[key];
    });
    const record = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Record not found" });

    // Capture the SLF display name before the update so a rename can be
    // propagated to portal users and their submission/baseline records.
    const buildDisplayName = (lgu, ownership) =>
      `${lgu || ""}${ownership ? " (" + ownership + ")" : ""}`.trim();
    const prevLgu = record.lgu;
    const prevOwnership = record.ownership;
    const prevDisplayName = buildDisplayName(prevLgu, prevOwnership);

    ["leachatePondDetails", "gasVentDetails", "trashSlideMeasures", "firePrevMeasures", "scrpDetails"].forEach((key) => {
      if (!Array.isArray(update[key])) return;
      const existingRows = Array.isArray(record[key]) ? record[key] : [];
      update[key] = update[key].map((row, index) => {
        const existing = existingRows[index]?.toObject?.() || existingRows[index] || {};
        return {
          ...existing,
          ...row,
          attachments: row.attachments !== undefined ? row.attachments : existing.attachments || [],
        };
      });
    });

    record.set(update);
    await record.save();

    // Propagate an SLF/LGU rename so submissions, baseline records and portal
    // user assignments stay linked (prevents "lost" baseline data on rename).
    const newDisplayName = buildDisplayName(record.lgu, record.ownership);
    const nameChanged =
      (prevLgu || "") !== (record.lgu || "") ||
      (prevOwnership || "") !== (record.ownership || "");
    if (nameChanged && newDisplayName) {
      try {
        // 1) Submissions & baseline records linked by facility id (safe link).
        await DataSLF.updateMany(
          { slfGenerator: record._id },
          { $set: { slfName: newDisplayName } },
        );
        // 2) Legacy records without a facility id — update by exact name match first,
        //    then do a fuzzy in-memory pass to catch records saved with a different
        //    name format (e.g., an acronym vs the full long name after a rename).
        if (prevDisplayName && prevDisplayName !== newDisplayName) {
          await DataSLF.updateMany(
            {
              $or: [
                { slfGenerator: null },
                { slfGenerator: { $exists: false } },
              ],
              slfName: prevDisplayName,
            },
            { $set: { slfName: newDisplayName, slfGenerator: record._id } },
          );
        }
        // 2b) Broader fuzzy pass — load all no-generator baseline-only records and
        //     match by normalized name so renamed facilities with different name
        //     formats (e.g., short acronym vs full name) are also re-linked.
        {
          const legacyDocs = await DataSLF.find({
            $or: [{ slfGenerator: null }, { slfGenerator: { $exists: false } }],
          }).select("_id slfName lguCompanyName").lean();

          function _normalizeName(val) {
            return String(val || "")
              .replace(/\s*\(.*?\)\s*/g, " ")
              .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
              .replace(/\blgu\b/gi, " ")
              .replace(/\bmunicipality\s+of\b/gi, " ")
              .replace(/\bcity\s+of\b/gi, " ")
              .replace(/^province\s+of\s+/i, "")
              .replace(/[\u2012-\u2015-]+/g, " ")
              .replace(/[,.;:/]+/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
          }

          const nameVariants = [prevLgu, prevDisplayName, record.lgu, newDisplayName]
            .flatMap((n) => {
              const raw = String(n || "").trim();
              if (!raw) return [];
              const noParens = raw.replace(/\s*\(.*?\)\s*/g, " ").trim();
              return [raw, noParens];
            })
            .map(_normalizeName)
            .filter(Boolean);

          const idsToLink = legacyDocs
            .filter((doc) => {
              const docNorm = _normalizeName(doc.slfName || doc.lguCompanyName || "");
              return docNorm && nameVariants.includes(docNorm);
            })
            .map((doc) => doc._id);

          if (idsToLink.length > 0) {
            await DataSLF.updateMany(
              { _id: { $in: idsToLink } },
              { $set: { slfName: newDisplayName, slfGenerator: record._id } },
            );
          }
        }
        // 3) Portal users assigned to this facility — update the parallel
        //    assignedSlfName entry at the same index as the facility id.
        const portalUsers = await UserPortal.find({ assignedSlf: record._id }).select(
          "assignedSlf assignedSlfName",
        );
        for (const pu of portalUsers) {
          const ids = (pu.assignedSlf || []).map((x) => String(x));
          const idx = ids.indexOf(String(record._id));
          if (idx === -1) continue;
          const names = Array.isArray(pu.assignedSlfName)
            ? [...pu.assignedSlfName]
            : [];
          names[idx] = newDisplayName;
          pu.assignedSlfName = names;
          pu.markModified("assignedSlfName");
          await pu.save();
        }
      } catch (propErr) {
        writeLog("warn", "slfFacility.rename-propagate", {
          message: `Rename propagation issue for ${record._id}: ${propErr.message}`,
          ip: req.ip,
        });
      }
    }

    // ANY facility edit (rename, profile, cells, permits, baseline-linked fields)
    // must reflect on both sides: refresh admin views AND every assigned portal
    // user so Portal Submissions + the portal facility view update immediately.
    refreshAdmin(req, "submissions");
    refreshAdmin(req, "baselines");
    await refreshAssignedPortalUsers(req, record._id, "facility");

    res.json(record);
    writeLog("info", "slfFacility.update", {
      message: `Updated SLF: ${record.lgu}${nameChanged ? ` (renamed from "${prevDisplayName}")` : ""}`,
      ip: req.ip,
    });
  } catch (error) {
    // Surface schema/enum validation problems as a clear 400 (validated within
    // the app) instead of an opaque 500.
    if (error.name === "ValidationError" || error.name === "CastError") {
      return res.status(400).json({
        message: "Some SLF fields are invalid. Please review and try again.",
        error: error.message,
      });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update cell status (admin toggle operational/closed)
router.patch("/:id/cell-status", async (req, res) => {
  try {
    const { cellIndex, status } = req.body;
    const normalizedStatus = normalizeCellStatus(status);
    if (cellIndex == null || !["Active Cell", "Used/Completed", "Under Construction", "Reserved Area", "Not Existed"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "cellIndex and valid status required" });
    }
    const facility = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null });
    if (!facility) return res.status(404).json({ message: "Facility not found" });

    // Ensure cellStatuses array is sized correctly
    const cells = facility.numberOfCell || 0;
    if (!facility.cellStatuses || facility.cellStatuses.length < cells) {
      facility.cellStatuses = Array.from({ length: cells }, (_, i) =>
        normalizeCellStatus(facility.cellStatuses?.[i])
      );
    }
    if (cellIndex >= cells) return res.status(400).json({ message: "cellIndex out of range" });

    facility.cellStatuses[cellIndex] = normalizedStatus;
    facility.markModified("cellStatuses");
    await facility.save();

    // Reflect the cell change on both sides in real time.
    refreshAdmin(req, "submissions");
    await refreshAssignedPortalUsers(req, facility._id, "facility");

    res.json(facility);
    writeLog("info", "slfFacility.cellStatus", {
      message: `Cell ${cellIndex + 1} set to ${normalizedStatus} for ${facility.lgu}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Notify assigned portal users when an active cell reaches the configured capacity threshold.
router.post("/:id/cell-capacity-alert", async (req, res) => {
  try {
    const { cellIndex, percent, message, threshold = 80 } = req.body || {};
    const facility = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null });
    if (!facility) return res.status(404).json({ message: "Facility not found" });

    const cellNo = Number(cellIndex || 0) + 1;
    const alertMessage = String(message || "").trim() ||
      `${facility.lgu || "Assigned SLF"} Cell ${cellNo} has reached ${Number(percent || 0).toFixed(1)}% capacity. Please review disposal planning and remaining cell capacity.`;

    const assignedUsers = await UserPortal.find({
      status: "approved",
      $or: [
        { assignedSlf: facility._id },
        { assignedSlfName: facility.lgu },
        { assignedSlfName: facility.province },
      ],
    }).select("email firstName lastName companyName assignedSlf assignedSlfName").lean();

    const uniqueUsers = Array.from(new Map(
      assignedUsers.filter((user) => user.email).map((user) => [user.email, user]),
    ).values());

    const meta = {
      facilityId: facility._id,
      slfName: facility.lgu || facility.province,
      cellIndex,
      cellNo,
      percent: Number(percent || 0),
      threshold: Number(threshold || 80),
    };

    const notifications = [
      {
        recipient: "admin",
        type: "cell_capacity_alert",
        title: "SLF Cell Capacity Alert",
        message: `${facility.lgu || "SLF"} Cell ${cellNo} reached ${Number(percent || 0).toFixed(1)}% capacity. ${uniqueUsers.length} assigned portal user(s) notified.`,
        meta: { ...meta, notifiedUsers: uniqueUsers.map((user) => user.email) },
      },
      ...uniqueUsers.map((user) => ({
        recipient: user.email,
        type: "cell_capacity_alert",
        title: "SLF Cell Capacity Alert",
        message: alertMessage,
        meta,
      })),
    ];

    await Notification.insertMany(notifications);
    uniqueUsers.forEach((user) => {
      notifyPortal(req, user.email, {
        type: "cell_capacity_alert",
        title: "SLF Cell Capacity Alert",
        message: alertMessage,
        meta,
      });
    });
    notifyAdmin(req, {
      type: "cell_capacity_alert",
      title: "SLF Cell Capacity Alert",
      message: `${facility.lgu || "SLF"} Cell ${cellNo} reached ${Number(percent || 0).toFixed(1)}% capacity.`,
      meta,
    });
    refreshAdmin(req, "notifications");

    writeLog("info", "slfFacility.cellCapacityAlert", {
      message: `Cell capacity alert sent for ${facility.lgu} Cell ${cellNo}`,
      ip: req.ip,
      meta,
    });

    res.json({ message: "Cell capacity alert sent", notified: uniqueUsers.length, users: uniqueUsers });
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
