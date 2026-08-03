const express = require("express");
const mongoose = require("mongoose");
const SlfFacility = require("../models/SlfFacility");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const Notification = require("../models/Notification");
const { writeLog } = require("../utils/logger");
const { notifyAdmin, notifyPortal, refreshAdmin, refreshPortal } = require("../utils/socketEmit");
const { NON_DUMMY_CLAUSE } = require("../utils/dummyFilter");
const { isSameSlfSite, facilityDisplayName } = require("../utils/slfIdentity");
const { normalizeUnit: normalizeUnitStrict } = require("../utils/volumeUnits");
const PortalPolicyAudit = require("../models/PortalPolicyAudit");

const router = express.Router();

// The facility unit fields that together define the SLF's official "global unit".
const UNIT_FIELDS = [
  "wasteReceivedUnit", "volumeCapacityUnit", "receivingVolumeCapacityUnit",
  "estimatedVolumeWasteUnit", "baselineUnit",
];
// The single configured global unit for a facility ("" when none is set yet), read
// from the same fields "Set Field Units" writes. Array unit fields count too.
function configuredGlobalUnit(rec) {
  for (const f of UNIT_FIELDS) {
    const u = normalizeUnitStrict(rec?.[f]);
    if (u) return u;
  }
  for (const arr of [rec?.cellCapacityUnits, rec?.cellFillUnits]) {
    const u = normalizeUnitStrict((Array.isArray(arr) ? arr : []).find(Boolean));
    if (u) return u;
  }
  return "";
}
// The global unit an incoming update WOULD set ("" when the update touches no unit
// field). Used to detect a unit change and compare against the configured unit.
function incomingGlobalUnit(update) {
  for (const f of UNIT_FIELDS) {
    if (update[f] !== undefined) {
      const u = normalizeUnitStrict(update[f]);
      if (u) return u;
    }
  }
  for (const key of ["cellCapacityUnits", "cellFillUnits"]) {
    if (Array.isArray(update[key])) {
      const u = normalizeUnitStrict(update[key].find(Boolean));
      if (u) return u;
    }
  }
  return "";
}

// SECONDARY safeguard only — the primary defence against duplicate SLFs is that
// every relationship (submissions, baselines, portal assignments) is keyed on the
// facility `_id`, so a renamed SLF can never split into two. This catches the
// remaining human path: someone typing a second facility row for a site that
// already exists under a differently-worded name, in the SAME dataYear. Rows that
// differ only by dataYear are the intended year-versioned model and are allowed.
async function findDuplicateSiteFacility(candidate, { excludeId = null } = {}) {
  if (!candidate?.lgu) return null;
  const year = candidate.dataYear ?? new Date().getFullYear();
  const filter = { deletedAt: null, dataYear: year };
  if (excludeId) filter._id = { $ne: excludeId };
  // Dummy/test facilities live in their own space and never collide with real ones.
  if (candidate.isDummy) filter.isDummy = true;
  else filter.isDummy = { $ne: true };
  if (candidate.province) filter.province = candidate.province;

  const peers = await SlfFacility.find(filter)
    .select("_id lgu ownership province dataYear")
    .setOptions({ includeHiddenYears: true })
    .lean();
  return peers.find((peer) => isSameSlfSite(peer, candidate)) || null;
}

// Require an authenticated caller on every route below. Closes anonymous access
// to facility master data (create/update/delete included). Both frontends
// always send a Bearer token.
const { requireAnyAuth, adminOnly } = require("../middleware/auth");
const { validateBody } = require("../utils/validate");
router.use(requireAnyAuth);

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

const ACTIVE_VOLUME_STATUSES = new Set(["pending", "acknowledged", "revert_requested"]);

// Conversion comes from the shared module. The local copy this replaced defaulted
// a MISSING source unit to "tons", while every other copy in the app defaulted to
// "m³" — the same unlabelled value was therefore counted 25× apart depending on
// which code path saw it. The shared convertVolume refuses to guess.
const { convertVolume, normalizeUnit: strictUnit } = require("../utils/volumeUnits");

// Display label only — a missing unit still renders as m³, as before.
function normalizeUnit(unit) {
  return String(unit || "m³").replace("m3", "m³");
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

const CELL_INFRA_ARRAYS = [
  "cellNames", "cellCapacities", "cellCapacityUnits", "cellStatuses",
  "cellTypes", "cellSubmissionAllowed", "cellNotes", "cellFillValues", "cellFillUnits",
];
const PROTECTED_CELL_STATUSES = new Set(["Used/Completed", "Under Construction", "Reserved Area", "Not Existed"]);

function mergeCellInfrastructureUpdate(update, record) {
  const preserved = [];
  const touchesCells = CELL_INFRA_ARRAYS.some((key) => Array.isArray(update[key])) || update.numberOfCell !== undefined;
  if (!touchesCells) return preserved;

  const existingCount = Math.max(
    Number(record.numberOfCell || 0),
    ...CELL_INFRA_ARRAYS.map((key) => (Array.isArray(record[key]) ? record[key].length : 0)),
  );
  const incomingCount = Number(update.numberOfCell || 0);
  const targetCount = incomingCount > 0 ? incomingCount : existingCount;
  if (targetCount > 0) update.numberOfCell = targetCount;

  for (const key of CELL_INFRA_ARRAYS) {
    if (Array.isArray(update[key]) && update[key].length === 0 && Array.isArray(record[key]) && record[key].length > 0) {
      delete update[key];
      preserved.push(key);
    }
  }

  const mergeArray = (key, resolver) => {
    if (!Array.isArray(update[key])) return;
    const incoming = update[key];
    const existing = Array.isArray(record[key]) ? record[key] : [];
    update[key] = Array.from({ length: targetCount }, (_, index) =>
      resolver(incoming[index], existing[index], index),
    );
  };

  mergeArray("cellNames", (next, prev) => {
    const incoming = String(next ?? "").trim();
    const existing = String(prev ?? "").trim();
    if (!incoming && existing) {
      preserved.push(`cellNames.${preserved.length}`);
      return existing;
    }
    return incoming;
  });
  mergeArray("cellStatuses", (next, prev) => {
    const incoming = normalizeCellStatus(next);
    const existing = normalizeCellStatus(prev);
    if (incoming === "Active Cell" && PROTECTED_CELL_STATUSES.has(existing)) {
      preserved.push(`cellStatuses.${preserved.length}`);
      return existing;
    }
    return incoming;
  });
  mergeArray("cellCapacities", (next, prev) => {
    if ((next === null || next === undefined || next === "") && prev !== null && prev !== undefined && prev !== "") return prev;
    return next;
  });
  mergeArray("cellFillValues", (next, prev) => {
    if ((next === null || next === undefined || next === "") && prev !== null && prev !== undefined && prev !== "") return prev;
    return next;
  });
  mergeArray("cellSubmissionAllowed", (next, prev, index) => {
    const status = normalizeCellStatus(update.cellStatuses?.[index] ?? record.cellStatuses?.[index]);
    if (!isActiveCellStatus(status)) return false;
    if (next === undefined && prev !== undefined) return prev;
    return next !== false;
  });
  mergeArray("cellTypes", (next, prev) => next || prev || "Residual");
  mergeArray("cellNotes", (next, prev) => next ?? prev ?? "");
  mergeArray("cellCapacityUnits", (next, prev) => normalizeUnitStrict(next) || normalizeUnitStrict(prev) || "tons");
  mergeArray("cellFillUnits", (next, prev) => normalizeUnitStrict(next) || normalizeUnitStrict(prev) || "tons");

  return preserved;
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
  const converted = convertVolume(value, fromUnit, targetUnit);
  if (converted === null) {
    // Unit missing or unconvertible: EXCLUDE it from the capacity total rather
    // than guessing a unit (`total += null` would also have produced NaN). The
    // count is surfaced so the record can be flagged instead of silently dropped.
    row.unconvertible = (row.unconvertible || 0) + 1;
    return;
  }
  row.total += converted;
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
      "volumeCapacity volumeCapacityUnit receivingVolumeCapacity receivingVolumeCapacityUnit numberOfCell cellNames cellCapacities cellCapacityUnits cellStatuses cellTypes cellSubmissionAllowed cellNotes cellFillValues cellFillUnits estimatedVolumeWaste estimatedVolumeWasteUnit actualResidualWasteReceived wasteReceivedUnit " +
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
    refreshAdmin(req, "facility");
    await refreshAssignedPortalUsers(req, existing._id, "facility");
    res.json(facility);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const yearFilter = req.query.year ? { dataYear: Number(req.query.year) } : {};
    // Exclude dummy/test facilities from every dashboard tile, map point, and
    // drill-down (capacity, waste received, trash-slide, fire-prevention,
    // leachate, gas vents). Developer views may opt in via ?includeDummy=true.
    const dummyFilter = req.query.includeDummy === "true" ? {} : NON_DUMMY_CLAUSE;
    const baseFilter = { deletedAt: null, ...yearFilter, ...dummyFilter };

    // Match the SLF Data Table's record set exactly: it deduplicates by
    // province|lgu|barangay and keeps only the latest dataYear per facility.
    // Aggregate the same deduped set here so every dashboard tile counts the
    // same facilities the table shows — not every historical yearly record.
    const dedupRows = await SlfFacility.aggregate([
      { $match: baseFilter },
      {
        $addFields: {
          _dedupKey: {
            $let: {
              vars: {
                parts: {
                  $filter: {
                    input: [
                      { $ifNull: ["$province", ""] },
                      { $ifNull: ["$lgu", ""] },
                      { $ifNull: ["$barangay", ""] },
                    ],
                    cond: { $ne: ["$$this", ""] },
                  },
                },
              },
              in: {
                $cond: [
                  { $eq: [{ $size: "$$parts" }, 0] },
                  { $toString: "$_id" },
                  {
                    $toLower: {
                      $reduce: {
                        input: "$$parts",
                        initialValue: "",
                        in: {
                          $cond: [
                            { $eq: ["$$value", ""] },
                            "$$this",
                            { $concat: ["$$value", "|", "$$this"] },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
          _dy: { $ifNull: ["$dataYear", 0] },
        },
      },
      { $sort: { _dy: -1, _id: 1 } },
      { $group: { _id: "$_dedupKey", keepId: { $first: "$_id" } } },
    ]);
    const dedupedIds = dedupRows.map((d) => d.keepId);
    // Every metric below is scoped to this deduped facility set.
    const scopedFilter = { _id: { $in: dedupedIds } };

    const [totalRecords, byProvince, byStatus, byCategory, byOwnership, byManilaBayArea, operationStats, mapData, managementData] =
      await Promise.all([
        Promise.resolve(dedupedIds.length),
        SlfFacility.aggregate([
        { $match: scopedFilter },
          { $addFields: { _normProvince: { $replaceAll: { input: "$province", find: "Province of ", replacement: "" } } } },
          { $group: { _id: "$_normProvince", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        SlfFacility.aggregate([
        { $match: scopedFilter },
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
        { $match: scopedFilter },
          { $group: { _id: { $ifNull: ["$category", "Unspecified"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        { $match: scopedFilter },
          { $group: { _id: { $ifNull: ["$ownership", "Unspecified"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        { $match: scopedFilter },
          { $group: { _id: { $ifNull: ["$manilaBayArea", "Non-MBA"] }, count: { $sum: 1 } } },
        ]),
        SlfFacility.aggregate([
        { $match: scopedFilter },
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
              totalTrashSlideDocuments: {
                $sum: {
                  $reduce: {
                    input: { $ifNull: ["$trashSlideMeasures", []] },
                    initialValue: 0,
                    in: { $add: ["$$value", { $size: { $ifNull: ["$$this.attachments", []] } }] },
                  },
                },
              },
              totalFirePrevDocuments: {
                $sum: {
                  $reduce: {
                    input: { $ifNull: ["$firePrevMeasures", []] },
                    initialValue: 0,
                    in: { $add: ["$$value", { $size: { $ifNull: ["$$this.attachments", []] } }] },
                  },
                },
              },
              totalPreventiveMeasureFiles: { $sum: { $size: { $ifNull: ["$preventiveMeasureFiles", []] } } },
              preventionDocumentFacilities: {
                $sum: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $add: [
                            {
                              $reduce: {
                                input: { $ifNull: ["$trashSlideMeasures", []] },
                                initialValue: 0,
                                in: { $add: ["$$value", { $size: { $ifNull: ["$$this.attachments", []] } }] },
                              },
                            },
                            {
                              $reduce: {
                                input: { $ifNull: ["$firePrevMeasures", []] },
                                initialValue: 0,
                                in: { $add: ["$$value", { $size: { $ifNull: ["$$this.attachments", []] } }] },
                              },
                            },
                            { $size: { $ifNull: ["$preventiveMeasureFiles", []] } },
                          ],
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              trashSlideFacilities: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$trashSlideMeasures", []] } }, 0] }, 1, 0] } },
              firePreventionFacilities: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$firePrevMeasures", []] } }, 0] }, 1, 0] } },
            },
          },
        ]),
        SlfFacility.find(
        { ...scopedFilter, latitude: { $ne: null }, longitude: { $ne: null } },
          { province: 1, lgu: 1, barangay: 1, manilaBayArea: 1, latitude: 1, longitude: 1, statusOfSLF: 1, category: 1, ownership: 1, volumeCapacity: 1, noOfLGUServed: 1, focalPerson: 1, enmo: 1, yearStartedOperation: 1, galleryPhotos: 1, galleryItems: 1 }
        ),
        // Per-facility management details for dashboard drill-down modals
        SlfFacility.find(scopedFilter, {
          province: 1, lgu: 1, statusOfSLF: 1, dataYear: 1,
          noOfLeachatePond: 1, numberOfGasVents: 1,
          numberOfCell: 1, cellCapacities: 1, cellCapacityUnits: 1, cellStatuses: 1, cellTypes: 1, cellFillValues: 1, cellFillUnits: 1,
          leachatePondDetails: 1, gasVentDetails: 1,
          trashSlideMeasures: 1, firePrevMeasures: 1, preventiveMeasureFiles: 1,
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
      operationStats: {
        ...(operationStats[0] || {}),
        totalPreventionDocuments:
          (operationStats[0]?.totalTrashSlideDocuments || 0) +
          (operationStats[0]?.totalFirePrevDocuments || 0) +
          (operationStats[0]?.totalPreventiveMeasureFiles || 0),
      },
      mapData,
      managementData,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create
router.post("/", validateBody({
  lgu: { type: "string", required: true, maxLength: 200 },
  province: { type: "string", maxLength: 100 },
  latitude: { type: "number", min: -90, max: 90 },
  longitude: { type: "number", min: -180, max: 180 },
  volumeCapacity: { type: "number", min: 0 },
  receivingVolumeCapacity: { type: "number", min: 0 },
  yearStartedOperation: { type: "number", min: 1900, max: 2200 },
  noOfLGUServed: { type: "number", min: 0 },
}), async (req, res) => {
  try {
    // Block an accidental second facility row for a site that already exists in
    // this data year under a differently-worded name (see findDuplicateSiteFacility).
    // `?allowDuplicate=true` is the deliberate override for two genuinely separate
    // facilities that happen to normalize alike.
    if (req.query.allowDuplicate !== "true") {
      const duplicate = await findDuplicateSiteFacility(req.body);
      if (duplicate) {
        return res.status(409).json({
          message: `"${facilityDisplayName(duplicate)}" already exists for ${duplicate.dataYear} and appears to be the same SLF. Edit that record instead, or resubmit with allowDuplicate=true if these are genuinely different facilities.`,
          code: "DUPLICATE_SLF",
          existingId: String(duplicate._id),
          existingName: facilityDisplayName(duplicate),
          dataYear: duplicate.dataYear,
        });
      }
    }
    const record = await SlfFacility.create(req.body);
    // Same as the update path: tell every admin view to reload from the server so
    // a newly created facility is never left living only in one client's state.
    refreshAdmin(req, "submissions");
    refreshAdmin(req, "baselines");
    res.status(201).json(record);
    writeLog("info", "slfFacility.create", { message: `Created SLF: ${record.lgu}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update
router.put("/:id", adminOnly, async (req, res) => {
  try {
    const update = { ...(req.body || {}) };
    ["_id", "id", "createdAt", "updatedAt", "deletedAt", "__v"].forEach((key) => delete update[key]);
    Object.keys(update).forEach((key) => {
      if (key.startsWith("_")) delete update[key];
    });
    const record = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null });
    if (!record) return res.status(404).json({ message: "Record not found" });

    // ── Global unit lock ──────────────────────────────────────────────────────
    // Once an official global unit is configured for a facility, only an
    // admin/developer caller on this admin-only route may change it. Portal users
    // still cannot reach this route. Unit changes are audited because they affect
    // table, modal, export and capacity displays.
    const prevUnit = configuredGlobalUnit(record);
    const nextUnit = incomingGlobalUnit(update);
    const unitIsChanging = !!nextUnit && !!prevUnit && nextUnit !== prevUnit;
    if (unitIsChanging && req.user?.role !== "admin" && req.user?.role !== "developer") {
      writeLog("warn", "unit.change.denied", {
        message: `Non-developer attempted to change global unit ${prevUnit} → ${nextUnit} for facility ${req.params.id}`,
        user: req.user?.email || req.user?.id || "",
        ip: req.ip,
        meta: { facilityId: req.params.id, from: prevUnit, to: nextUnit, role: req.user?.role },
      });
      return res.status(403).json({
        message: "The official global unit is locked. Only an authorized admin or developer may change it.",
        code: "GLOBAL_UNIT_LOCKED",
        currentUnit: prevUnit,
      });
    }

    // Renaming/re-yearing a facility onto another existing facility's identity
    // would recreate the duplicate this fix removes — reject it the same way a
    // duplicate create is rejected.
    if (req.query.allowDuplicate !== "true" && (update.lgu || update.dataYear || update.ownership)) {
      const duplicate = await findDuplicateSiteFacility(
        {
          lgu: update.lgu ?? record.lgu,
          ownership: update.ownership ?? record.ownership,
          province: update.province ?? record.province,
          dataYear: update.dataYear ?? record.dataYear,
          isDummy: update.isDummy ?? record.isDummy,
        },
        { excludeId: record._id },
      );
      if (duplicate) {
        return res.status(409).json({
          message: `"${facilityDisplayName(duplicate)}" already exists for ${duplicate.dataYear} and appears to be the same SLF. Merge into that record instead, or resubmit with allowDuplicate=true if these are genuinely different facilities.`,
          code: "DUPLICATE_SLF",
          existingId: String(duplicate._id),
          existingName: facilityDisplayName(duplicate),
          dataYear: duplicate.dataYear,
        });
      }
    }

    // Capture the SLF display name before the update so a rename can be
    // propagated to portal users and their submission/baseline records.
    const buildDisplayName = (lgu, ownership) =>
      `${lgu || ""}${ownership ? " (" + ownership + ")" : ""}`.trim();
    const prevLgu = record.lgu;
    const prevOwnership = record.ownership;
    const prevDisplayName = buildDisplayName(prevLgu, prevOwnership);
    // Cell names BEFORE the update, so a rename can be cascaded to the copies
    // stored on existing submissions (see the propagation block after save()).
    const prevCellNames = [...(record.cellNames || [])];

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

    const preservedCellArrays = mergeCellInfrastructureUpdate(update, record);
    if (preservedCellArrays.length) {
      writeLog("warn", "slfFacility.cell_wipe_prevented", {
        message: `Preserved ${preservedCellArrays.join(", ")} for ${record.lgu || record._id} during cell infrastructure update`,
        ip: req.ip,
        meta: { facilityId: String(record._id), preserved: preservedCellArrays },
      });
    }

    record.set(update);
    await record.save();

    // Audit a global-unit change (previous → new, scope, who).
    if (unitIsChanging && (req.user?.role === "admin" || req.user?.role === "developer")) {
      try {
        await PortalPolicyAudit.create({
          type: "global_unit",
          changedBy: req.user?.email || req.user?.id || "developer",
          changedById: req.user?.id || "",
          changedByRole: req.user?.role || "",
          targetFacility: record._id,
          affectedScope: `Facility ${facilityDisplayName(record) || record._id} (all unit fields, cells, submissions display)`,
          previousValue: prevUnit,
          newValue: nextUnit,
          reason: typeof req.body?.unitChangeReason === "string" ? req.body.unitChangeReason.trim() : "",
        });
      } catch { /* audit is best-effort */ }
      writeLog("info", "unit.change", {
        message: `Developer changed global unit ${prevUnit} → ${nextUnit} for facility ${record._id}`,
        user: req.user?.email || req.user?.id || "",
        ip: req.ip,
        meta: { facilityId: String(record._id), from: prevUnit, to: nextUnit },
      });
    }

    // ── Propagate a CELL rename across the app ────────────────────────────────
    //
    // A submission stores `cellIndex` (canonical) AND a `cellName` copy taken at
    // submit time. Everything that renders from the index already follows a rename,
    // but the stored COPY does not — so exports, reports, admin history tables and
    // any other consumer reading `truck.cellName` kept showing the old label
    // forever. Rewrite the copies for the cells that actually changed, keyed on the
    // canonical index, so the new name is effective everywhere at once.
    //
    // Keyed on cellIndex — never on the old name — so a cell renamed twice, or two
    // cells that once shared a label, can't be confused with each other.
    try {
      const nextCellNames = record.cellNames || [];
      const renamed = [];
      const cellCount = Math.max(prevCellNames.length, nextCellNames.length);
      for (let i = 0; i < cellCount; i += 1) {
        const before = String(prevCellNames[i] || "").trim();
        const after = String(nextCellNames[i] || "").trim();
        // Only act on a real rename. An emptied name falls back to the derived
        // "Cell N" everywhere, so push that rather than a blank label.
        if (before !== after) renamed.push({ index: i, name: after || `Cell ${i + 1}` });
      }

      if (renamed.length) {
        const ops = [];
        for (const { index, name } of renamed) {
          // Truck-level placement.
          ops.push({
            updateMany: {
              filter: { slfGenerator: record._id, "trucks.cellIndex": index },
              update: { $set: { "trucks.$[t].cellName": name } },
              arrayFilters: [{ "t.cellIndex": index }],
            },
          });
          // Per-vehicle placement (a truck can split its load across cells).
          ops.push({
            updateMany: {
              filter: { slfGenerator: record._id, "trucks.vehicles.cellIndex": index },
              update: { $set: { "trucks.$[].vehicles.$[v].cellName": name } },
              arrayFilters: [{ "v.cellIndex": index }],
            },
          });
        }
        const result = await DataSLF.bulkWrite(ops, { ordered: false });
        writeLog("info", "slf.cell-rename", {
          message: `Cell rename propagated to submissions for ${record.lgu || record._id}`,
          ip: req.ip,
          meta: {
            facilityId: String(record._id),
            renamed,
            submissionsUpdated: result?.modifiedCount ?? 0,
          },
        });
      }
    } catch (err) {
      // A failed cascade must not fail the facility save — the canonical index is
      // still correct, and every index-resolved view already shows the new name.
      writeLog("error", "slf.cell-rename.failed", {
        message: `Cell rename propagation failed: ${err.message}`,
        meta: { facilityId: String(record._id) },
      });
    }

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
router.patch("/:id/cell-status", adminOnly, async (req, res) => {
  try {
    const { cellIndex, status } = req.body;
    const idx = Number(cellIndex);
    const normalizedStatus = normalizeCellStatus(status);
    if (!Number.isInteger(idx) || idx < 0 || !["Active Cell", "Used/Completed", "Under Construction", "Reserved Area", "Not Existed"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "cellIndex and valid status required" });
    }
    const facility = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null })
      .select("numberOfCell cellStatuses cellCapacities lgu")
      .lean();
    if (!facility) return res.status(404).json({ message: "Facility not found" });
    const cells = Math.max(Number(facility.numberOfCell || 0), facility.cellStatuses?.length || 0, facility.cellCapacities?.length || 0);
    if (idx >= cells) return res.status(400).json({ message: "cellIndex out of range" });

    const set = { [`cellStatuses.${idx}`]: normalizedStatus };
    if (!isActiveCellStatus(normalizedStatus)) set[`cellSubmissionAllowed.${idx}`] = false;
    const updated = await SlfFacility.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: set },
      { new: true },
    );
    if (!updated) return res.status(404).json({ message: "Facility not found" });

    refreshAdmin(req, "submissions");
    await refreshAssignedPortalUsers(req, updated._id, "facility");
    res.json(updated);
    writeLog("info", "slfFacility.cellStatus", {
      message: `Cell ${idx + 1} set to ${normalizedStatus} for ${updated.lgu}`,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update per-cell portal availability without saving the whole facility document.
router.patch("/:id/cell-submission-allowed", adminOnly, async (req, res) => {
  try {
    const { cellIndex, allowed } = req.body || {};
    const idx = Number(cellIndex);
    if (!Number.isInteger(idx) || idx < 0 || typeof allowed !== "boolean") {
      return res.status(400).json({ message: "cellIndex and allowed are required." });
    }
    const facility = await SlfFacility.findOne({ _id: req.params.id, deletedAt: null })
      .select("numberOfCell cellStatuses cellCapacities lgu")
      .lean();
    if (!facility) return res.status(404).json({ message: "Facility not found" });
    const cells = Math.max(Number(facility.numberOfCell || 0), facility.cellStatuses?.length || 0, facility.cellCapacities?.length || 0);
    if (idx >= cells) return res.status(400).json({ message: "cellIndex out of range" });
    const status = normalizeCellStatus(facility.cellStatuses?.[idx]);
    if (allowed && !isActiveCellStatus(status)) {
      return res.status(400).json({ message: `Only active/open cells can allow portal submissions. Current status: ${status}.` });
    }
    const updated = await SlfFacility.findOneAndUpdate(
      { _id: req.params.id, deletedAt: null },
      { $set: { [`cellSubmissionAllowed.${idx}`]: allowed } },
      { new: true },
    );
    if (!updated) return res.status(404).json({ message: "Facility not found" });

    refreshAdmin(req, "submissions");
    await refreshAssignedPortalUsers(req, updated._id, "facility");
    res.json(updated);
    writeLog("info", "slfFacility.cellSubmissionAllowed", {
      message: `Cell ${idx + 1} portal submission ${allowed ? "enabled" : "disabled"} for ${updated.lgu}`,
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

// ── Prevention Measures: narrative + secure document summaries (admin only) ──
//
// Collect this facility's Prevention-Measures documents (Fire Prevention, Trash
// Slide Measures, and flat Preventive Measures files) with their narrative and a
// derived file name. Only URLs that belong to THIS facility are ever considered —
// the summary endpoint refuses any URL not in this list (no cross-SLF leakage).
function collectPreventionDocs(facility) {
  const docs = [];
  const fileNameOf = (url) => {
    try {
      const clean = String(url || "").split("?")[0].split("#")[0];
      const seg = decodeURIComponent(clean.split("/").pop() || "");
      return seg || "document";
    } catch { return "document"; }
  };
  const pushNested = (arr, docType) =>
    (Array.isArray(arr) ? arr : []).forEach((m) => {
      const narrative = [m?.measure, m?.description].filter(Boolean).join(" — ");
      (Array.isArray(m?.attachments) ? m.attachments : []).forEach((url) => {
        if (url) docs.push({ url, fileName: fileNameOf(url), docType, narrative: narrative || "" });
      });
    });
  pushNested(facility.firePrevMeasures, "Fire Prevention");
  pushNested(facility.trashSlideMeasures, "Trash Slide Measures");
  (Array.isArray(facility.preventiveMeasureFiles) ? facility.preventiveMeasureFiles : []).forEach((url) => {
    if (url) docs.push({ url, fileName: fileNameOf(url), docType: "Preventive Measures", narrative: "" });
  });
  return docs;
}

// Official narrative entries (manually entered) per prevention category.
function collectPreventionNarratives(facility) {
  const out = [];
  const add = (arr, docType) =>
    (Array.isArray(arr) ? arr : []).forEach((m) => {
      if (m?.measure || m?.description) {
        out.push({ docType, measure: m.measure || "", description: m.description || "", status: m.status || "" });
      }
    });
  add(facility.firePrevMeasures, "Fire Prevention");
  add(facility.trashSlideMeasures, "Trash Slide Measures");
  return out;
}

// GET the Prevention-Measures view model for a facility: official narratives,
// the source documents (with metadata), and any cached VERA summaries — pruned to
// documents that currently belong to this facility.
router.get("/:id/prevention-measures", adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid id" });
    const facility = await SlfFacility.findById(req.params.id)
      .select("lgu slfName firePrevMeasures trashSlideMeasures preventiveMeasureFiles preventionSummaries")
      .lean();
    if (!facility) return res.status(404).json({ message: "Facility not found" });

    const documents = collectPreventionDocs(facility);
    const validUrls = new Set(documents.map((d) => d.url));
    const summaries = (facility.preventionSummaries || []).filter((s) => validUrls.has(s.fileUrl));

    const AppSettings = require("../models/AppSettings");
    const agent = require("../utils/automationAgent");
    const settings = await AppSettings.findOne().lean().catch(() => null);
    const aiAvailable = agent.isOperational(settings?.automationAgent || {});

    res.json({
      slfName: facility.slfName || facility.lgu || "",
      narratives: collectPreventionNarratives(facility),
      documents,
      summaries,
      aiAvailable,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// POST generate / refresh the VERA summary for ONE prevention document.
// Body: { fileUrl }. The URL MUST belong to this facility (isolation). Extraction
// failures and low confidence are surfaced as warnings — never a fabricated
// summary. The result is cached (keyed by fileUrl) so a replaced document (new
// URL) is re-summarized automatically.
router.post("/:id/prevention-summary", adminOnly, async (req, res) => {
  const controller = new AbortController();
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid id" });
    const fileUrl = String(req.body?.fileUrl || "").trim();
    if (!fileUrl) return res.status(400).json({ message: "fileUrl is required" });

    const facility = await SlfFacility.findById(req.params.id);
    if (!facility) return res.status(404).json({ message: "Facility not found" });

    // Isolation: the URL must be one of THIS facility's prevention documents.
    const docs = collectPreventionDocs(facility);
    const doc = docs.find((d) => d.url === fileUrl);
    if (!doc) return res.status(403).json({ message: "That document does not belong to this facility." });

    const AppSettings = require("../models/AppSettings");
    const agent = require("../utils/automationAgent");
    const { extractFromUrl } = require("../utils/docExtract");
    const { summarizeDocument } = require("../utils/preventionSummary");

    const settings = await AppSettings.findOne();
    const agentConfig = settings?.automationAgent || {};
    if (!agent.isOperational(agentConfig)) {
      return res.status(200).json({ ok: false, code: "unavailable", message: "The AI summary service is not configured. The document metadata and official narrative are still available." });
    }

    // Extract text (validates size/type/permission; refuses encrypted/corrupt).
    const extracted = await extractFromUrl(fileUrl);
    const slfName = facility.slfName || facility.lgu || "";

    const upsertSummary = async (entry) => {
      const list = facility.preventionSummaries || [];
      const idx = list.findIndex((s) => s.fileUrl === fileUrl);
      const record = {
        fileUrl,
        fileName: doc.fileName,
        docType: doc.docType,
        summary: entry.summary || "",
        confidence: entry.confidence || "",
        warning: entry.warning || "",
        model: entry.model || "",
        generatedAt: new Date(),
        generatedBy: req.user?.email || req.user?.id || "",
      };
      if (idx >= 0) list[idx] = record; else list.push(record);
      facility.preventionSummaries = list;
      facility.markModified("preventionSummaries");
      await facility.save();
      return record;
    };

    if (!extracted.ok) {
      // No reliable text → cache a warning (no fabricated summary).
      const record = await upsertSummary({ confidence: extracted.meta?.ext ? "low" : "", warning: extracted.warning });
      return res.json({ ok: true, degraded: true, summary: null, warning: extracted.warning, code: extracted.code, record });
    }

    const abortTimer = setTimeout(() => controller.abort(), agent.resolveTimeoutMs(agentConfig) + 2000);
    let result;
    try {
      result = await summarizeDocument({ text: extracted.text, docName: doc.fileName, slfName, agentConfig, signal: controller.signal });
    } finally {
      clearTimeout(abortTimer);
    }

    if (!result.ok) {
      return res.status(200).json({ ok: false, code: result.code, message: result.message });
    }
    const record = await upsertSummary({
      summary: result.summary,
      confidence: extracted.confidence,
      warning: extracted.warning,
      model: result.model,
    });
    writeLog("info", "prevention.summary.generated", {
      message: `Prevention summary generated for ${slfName}`,
      user: req.user?.email || req.user?.id || "",
      meta: { facilityId: String(facility._id), docType: doc.docType },
    });
    res.json({ ok: true, summary: result.summary, warning: extracted.warning, sourceDocument: doc.fileName, record });
  } catch (error) {
    const { sanitizeError } = require("../utils/aiErrors");
    const { message, code } = sanitizeError(error, "", "anthropic");
    res.status(200).json({ ok: false, code, message });
  }
});

module.exports = router;
