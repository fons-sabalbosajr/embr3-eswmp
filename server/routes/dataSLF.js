const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const DataSLF = require("../models/DataSLF");
const SLFGenerator = require("../models/SLFGenerator");
const SlfFacility = require("../models/SlfFacility");
const { sendAcknowledgementEmail, sendBulkAcknowledgeEmail, sendSubmissionEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const UserPortal = require("../models/UserPortal");
const { notifyAdmin, notifyPortal, refreshAdmin } = require("../utils/socketEmit");
const { authMiddleware, developerOnly } = require("../middleware/auth");

// Province code mapping (mirrors DataSLF model)
const PROVINCE_CODES = {
  aurora: "AU", bataan: "BA", bulacan: "BU",
  "nueva ecija": "NE", nueva_ecija: "NE",
  pampanga: "PA", tarlac: "TA", zambales: "ZA",
};
const PSGC_PROVINCE_CODES = DataSLF.PSGC_PROVINCE_CODES || {};
function getProvinceCode(province) {
  if (!province) return "XX";
  const raw = String(province).trim();
  if (PSGC_PROVINCE_CODES[raw]) return PSGC_PROVINCE_CODES[raw];
  const key = raw.toLowerCase().replace(/^province of\s+/i, "").replace(/[_-]+/g, " ").trim();
  return PROVINCE_CODES[key] || raw.substring(0, 2).toUpperCase();
}

function getNameVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const noParens = raw.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const withoutPrefix = noParens
    .replace(/^province\s+of\s+/i, "")
    .replace(/^(local\s+governm\s*ent\s+unit|lgu|municipality\s+of|city\s+of)\s*[-:\u2012-\u2015]?\s*/i, "")
    .trim();
  const firstCommaPart = withoutPrefix.split(",")[0]?.trim();
  return [...new Set([raw, noParens, withoutPrefix, firstCommaPart].filter(Boolean))];
}

function normalizeSlfName(value) {
  return String(value || "")
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

function getBaselineNameKeys(item) {
  return [item?.slfName, item?.lguCompanyName]
    .flatMap((name) => getNameVariants(name))
    .map((name) => normalizeSlfName(name))
    .filter(Boolean);
}

function matchesBaselineName(item, requestedName) {
  const requestedKeys = getNameVariants(requestedName).map((name) => normalizeSlfName(name)).filter(Boolean);
  const itemKeys = getBaselineNameKeys(item);
  return requestedKeys.some((key) => itemKeys.includes(key));
}

async function softDeleteOverdueReverted(req) {
  const dueEntries = await DataSLF.find({
    deletedAt: null,
    status: "reverted",
    temporaryDeleteAfter: { $lte: new Date() },
  }).limit(100);

  for (const entry of dueEntries) {
    entry.deletedAt = new Date();
    entry.deletedBy = "system-overdue-revert";
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "deleted",
        description: `Overdue reverted entry ${entry.idNo} moved to Deleted Submissions`,
        performedBy: "system-overdue-revert",
        meta: { idNo: entry.idNo, temporaryDeleteAfter: entry.temporaryDeleteAfter },
      });
      await Notification.create({
        recipient: "admin",
        type: "submission_temp_deleted",
        title: "Reverted Submission Temporarily Deleted",
        message: `${entry.idNo || "A reverted submission"} was moved to Deleted Submissions after the follow-up deadline passed.`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, submittedBy: entry.submittedBy, temporaryDeleteAfter: entry.temporaryDeleteAfter },
      });
      notifyAdmin(req, {
        type: "submission_temp_deleted",
        title: "Reverted Submission Temporarily Deleted",
        message: `${entry.idNo || "A reverted submission"} was moved to Deleted Submissions.`,
      });
    } catch { /* silent */ }
  }
}

async function markSubmissionNotificationsRead(entries) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  if (list.length === 0) return;

  const dataEntryIds = list.map((entry) => entry._id).filter(Boolean);
  const submissionIds = [...new Set(list.map((entry) => entry.submissionId).filter(Boolean))];
  const filters = [];
  if (dataEntryIds.length > 0) filters.push({ dataEntry: { $in: dataEntryIds } });
  if (submissionIds.length > 0) filters.push({ submissionId: { $in: submissionIds } });
  if (filters.length === 0) return;

  await Notification.updateMany(
    {
      recipient: "admin",
      read: false,
      type: { $in: ["new_submission", "resubmission", "submission_edit_request"] },
      $or: filters,
    },
    { $set: { read: true } }
  );
}

const router = express.Router();
const ADMIN_DISPLAY_NAME = "EMBR3 ESWMP Admin";

function getRequestActor(req, fallback = ADMIN_DISPLAY_NAME) {
  const headerName = String(req.get("x-user-name") || "").trim();
  const headerEmail = String(req.get("x-user-email") || "").trim();
  return headerName || headerEmail || req.logUser || fallback;
}

const baselineDataMatch = {
  $or: [
    { totalVolumeAccepted: { $exists: true, $ne: null } },
    { activeCellResidualVolume: { $exists: true, $ne: null } },
    { activeCellInertVolume: { $exists: true, $ne: null } },
    { activeCellHazardousVolume: { $exists: true, $ne: null } },
    { closedCellResidualVolume: { $exists: true, $ne: null } },
    { closedCellInertVolume: { $exists: true, $ne: null } },
    { closedCellHazardousVolume: { $exists: true, $ne: null } },
    { "activeCellEntries.0": { $exists: true } },
    { "closedCellEntries.0": { $exists: true } },
    { "accreditedHaulers.0": { $exists: true } },
  ],
};

function hasTruckVolume(entry) {
  return (entry?.trucks || []).some((truck) => Number(truck?.actualVolume || 0) > 0);
}

function chooseBaselineRecord(entries = []) {
  return entries.find((entry) => !hasTruckVolume(entry)) || entries[0] || null;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBaselineData(entry) {
  return !!(
    entry?.totalVolumeAccepted != null ||
    entry?.activeCellResidualVolume != null ||
    entry?.activeCellInertVolume != null ||
    entry?.activeCellHazardousVolume != null ||
    entry?.closedCellResidualVolume != null ||
    entry?.closedCellInertVolume != null ||
    entry?.closedCellHazardousVolume != null ||
    entry?.activeCellEntries?.length ||
    entry?.closedCellEntries?.length ||
    entry?.accreditedHaulers?.length
  );
}

function normalizeUnit(unit) {
  return String(unit || "m³").replace("m3", "m³");
}

function sanitizeClient(client) {
  if (typeof client === "string") {
    return {
      clientName: client.trim(),
      clientType: "Private",
      region: "",
      regionName: "",
      province: "",
      provinceName: "",
      municipality: "",
      municipalityName: "",
    };
  }
  if (!client || typeof client !== "object") return null;
  return {
    clientName: String(client.clientName || "").trim(),
    clientType: String(client.clientType || "Private").trim() || "Private",
    region: String(client.region || "").trim(),
    regionName: String(client.regionName || "").trim(),
    province: String(client.province || "").trim(),
    provinceName: String(client.provinceName || "").trim(),
    municipality: String(client.municipality || "").trim(),
    municipalityName: String(client.municipalityName || "").trim(),
  };
}

function sanitizeVehicle(vehicle, fallbackUnit = "m³") {
  if (!vehicle || typeof vehicle !== "object") return null;
  return {
    plateNumber: String(vehicle.plateNumber || vehicle.plateNo || vehicle.plate || "").trim(),
    vehicleType: String(vehicle.vehicleType || vehicle.type || "").trim(),
    capacity:
      vehicle.capacity == null || Number.isNaN(Number(vehicle.capacity))
        ? null
        : Number(vehicle.capacity),
    capacityUnit: normalizeUnit(vehicle.capacityUnit || vehicle.truckCapacityUnit || fallbackUnit),
    selectedClients: Array.isArray(vehicle.selectedClients)
      ? vehicle.selectedClients.map(sanitizeClient).filter(Boolean)
      : [],
  };
}

function sanitizeAccreditedHaulers(haulers = [], fallbackUnit = "m³") {
  if (!Array.isArray(haulers)) return [];
  return haulers.map((hauler) => {
    const vehicles = Array.isArray(hauler?.vehicles)
      ? hauler.vehicles.map((vehicle) => sanitizeVehicle(vehicle, fallbackUnit)).filter(Boolean)
      : [];
    const primaryVehicle = vehicles[0] || sanitizeVehicle(hauler, fallbackUnit) || {};
    return {
      haulerName: String(hauler?.haulerName || hauler?.name || "").trim(),
      numberOfTrucks: Math.max(Number(hauler?.numberOfTrucks || 0), vehicles.length) || null,
      officeAddress: String(hauler?.officeAddress || "").trim(),
      plateNumber: primaryVehicle.plateNumber || "",
      vehicleType: primaryVehicle.vehicleType || "",
      capacity: primaryVehicle.capacity ?? null,
      capacityUnit: normalizeUnit(primaryVehicle.capacityUnit || fallbackUnit),
      vehicles,
      privateSectorClients: Array.isArray(hauler?.privateSectorClients)
        ? hauler.privateSectorClients.map(sanitizeClient).filter(Boolean)
        : [],
    };
  });
}

async function findMatchingBaselineOnlyIds({ slfName, slfGenerator, lguCompanyName }) {
  const namesToMatch = [...new Set([slfName, lguCompanyName].filter(Boolean))];
  const baseFilter = {
    $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }],
  };
  const directOr = [];

  if (slfGenerator && mongoose.Types.ObjectId.isValid(String(slfGenerator))) {
    directOr.push({ slfGenerator });
  }
  namesToMatch.forEach((name) => {
    directOr.push({ slfName: name });
    directOr.push({ lguCompanyName: name });
  });

  let candidates = [];
  if (directOr.length > 0) {
    candidates = await DataSLF.find({ $and: [baseFilter, { $or: directOr }] })
      .select("_id slfGenerator slfName lguCompanyName")
      .lean();
  }

  let matches = candidates.filter((item) => {
    if (slfGenerator && String(item.slfGenerator || "") === String(slfGenerator)) {
      return true;
    }
    return namesToMatch.some((name) => matchesBaselineName(item, name));
  });

  if (matches.length === 0 && namesToMatch.length > 0) {
    const fallbackCandidates = await DataSLF.find(baseFilter)
      .select("_id slfGenerator slfName lguCompanyName")
      .lean();
    matches = fallbackCandidates.filter((item) => {
      if (slfGenerator && String(item.slfGenerator || "") === String(slfGenerator)) {
        return true;
      }
      return namesToMatch.some((name) => matchesBaselineName(item, name));
    });
  }

  return [...new Set(matches.map((item) => String(item._id)).filter(Boolean))];
}

async function ensurePortalAccountCanSubmit(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  const portalUser = await UserPortal.findOne({ email: normalizedEmail }).select("verificationRequired verificationSubmitted status");
  if (!portalUser) return null;
  if (portalUser.status !== "approved") {
    const error = new Error("Your portal account is not approved for submissions.");
    error.statusCode = 403;
    throw error;
  }
  if (portalUser.verificationRequired) {
    const error = new Error("Your account is on hold for verification. Please complete the verification process before using the portal.");
    error.statusCode = 403;
    throw error;
  }
  return portalUser;
}

// Submit SLF data — batch (client portal)
router.post("/", async (req, res) => {
  try {
    const { entries, submittedBy } = req.body || {};
    await ensurePortalAccountCanSubmit(submittedBy);
    const items = Array.isArray(entries) ? entries : [req.body];
    const submissionId = `SUB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    // Cache SLFGenerator lookups so repeated slfNames in a batch don't re-query.
    const genCache = new Map();
    const saved = [];
    for (const item of items) {
      // Resolve slfGenerator from slfName if not set
      let genId = item.slfGenerator || null;
      if (!genId && item.slfName) {
        const cacheKey = String(item.slfName).trim().toLowerCase();
        if (genCache.has(cacheKey)) {
          genId = genCache.get(cacheKey);
        } else {
          const gen = await SLFGenerator.findOne({ slfName: item.slfName }).select("_id").lean();
          genId = gen?._id || null;
          genCache.set(cacheKey, genId);
        }
      }
      const doc = new DataSLF({
        ...item,
        slfGenerator: genId,
        submissionId,
        submittedBy: submittedBy || item.submittedBy || "",
      });
      // idNo generation must stay sequential to avoid duplicate sequence numbers.
      await doc.save();
      saved.push(doc);
    }

    // Respond immediately — audit logging, notifications and socket refresh are
    // non-critical and run after the response so the user isn't blocked on them.
    res.status(201).json({ message: "Data submitted successfully", data: saved });

    (async () => {
      try {
        // One transaction per unique company, written in a single round trip.
        const companies = [...new Set(saved.map((s) => s.lguCompanyName))];
        const txnDocs = companies.map((company) => {
          const companyEntries = saved.filter((s) => s.lguCompanyName === company);
          return {
            submissionId,
            dataEntry: companyEntries[0]._id,
            companyName: company,
            companyType: companyEntries[0].companyType,
            submittedBy: submittedBy || "",
            type: "submission",
            description: `${companyEntries.length} entr${companyEntries.length === 1 ? "y" : "ies"} submitted by ${submittedBy || "unknown"}`,
            performedBy: submittedBy || "portal",
            meta: { entryCount: companyEntries.length, ids: companyEntries.map((e) => e.idNo) },
          };
        });
        if (txnDocs.length) await Transaction.insertMany(txnDocs, { ordered: false });
      } catch { /* silent */ }

      try {
        await Notification.create({
          recipient: "admin",
          type: "new_submission",
          title: "New Submission",
          message: `${submittedBy || "A portal user"} submitted ${saved.length} entr${saved.length === 1 ? "y" : "ies"} (${saved[0]?.lguCompanyName || "Unknown"})`,
          submissionId,
          dataEntry: saved[0]?._id,
          meta: { entryCount: saved.length, companyName: saved[0]?.lguCompanyName, submittedBy },
        });
      } catch { /* silent */ }
      notifyAdmin(req, { type: "new_submission", title: "New Submission", message: `${submittedBy || "A portal user"} submitted ${saved.length} entries` });
      refreshAdmin(req, "submissions");

      writeLog("info", "submission.create", {
        message: `New submission: ${saved.length} entries by ${submittedBy || "unknown"}`,
        user: submittedBy || "",
        ip: req.ip,
        meta: { submissionId: saved[0]?.submissionId, count: saved.length },
      });
    })();
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update & resubmit a reverted entry (portal user)
router.put("/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    await ensurePortalAccountCanSubmit(entry.submittedBy);
    if (entry.status !== "reverted" && entry.status !== "pending") {
      return res.status(400).json({ message: "Only reverted or pending entries can be updated" });
    }

    const allowedFields = [
      "dateOfDisposal", "lguCompanyName", "companyType", "address",
      "companyRegion", "companyProvince", "companyMunicipality", "companyBarangay",
      "trucks", "accreditedHaulers", "slfGenerator", "slfName",
      "baselineUnit", "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "activeCellHazardousVolume", "activeCellHazardousUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
      "closedCellHazardousVolume", "closedCellHazardousUnit",
      "activeCellEntries", "closedCellEntries",
      "acceptsHazardousWaste",
    ];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) entry[field] = req.body[field];
    }
    entry.status = "pending";
    entry.revertReason = "";
    entry.revertedBy = "";
    entry.revertedAt = undefined;

    // Regenerate idNo based on current companyType and SLF province
    const previousIdNo = entry.idNo;
    let province = "";
    if (entry.slfGenerator) {
      const facility = await SlfFacility.findById(entry.slfGenerator).select("province");
      if (facility) province = facility.province;
    }
    const provCode = getProvinceCode(province);
    const typeCode = entry.companyType === "Private" ? "PVT" : entry.companyType === "LGU" ? "LGU" : "OTH";
    const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-`);
    const lastDoc = await DataSLF.findOne({ idNo: pattern, _id: { $ne: entry._id } }).sort({ idNo: -1 });
    let seq = 1;
    if (lastDoc && lastDoc.idNo) {
      const parts = lastDoc.idNo.split("-");
      const lastNum = parseInt(parts[3], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    entry.idNo = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
    if (!Array.isArray(entry.previousIdNos)) entry.previousIdNos = [];
    if (previousIdNo && previousIdNo !== entry.idNo && !entry.previousIdNos.includes(previousIdNo)) {
      entry.previousIdNos.push(previousIdNo);
    }

    await entry.save();

    const resubmitComment = typeof req.body.resubmitComment === "string" ? req.body.resubmitComment.trim() : "";

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "resubmission",
        description: resubmitComment
          ? `Resubmitted updated entry ${entry.idNo} — "${resubmitComment}"`
          : `Resubmitted updated entry ${entry.idNo}`,
        performedBy: entry.submittedBy || "portal",
        meta: { idNo: entry.idNo, previousIdNo, comment: resubmitComment || undefined },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id)
      .setOptions({ includeHiddenYears: true })
      .populate("slfGenerator");
    res.json(populated);

    // Notify admins of resubmission
    try {
      await Notification.create({
        recipient: "admin",
        type: "resubmission",
        title: "Resubmission",
        message: `${entry.submittedBy || "A portal user"} resubmitted entry ${entry.idNo} (${entry.lguCompanyName || ""})`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, companyName: entry.lguCompanyName },
      });
    } catch { /* silent */ }
    notifyAdmin(req, { type: "resubmission", title: "Resubmission", message: `${entry.submittedBy} resubmitted ${entry.idNo}` });
    refreshAdmin(req, "submissions");

    writeLog("info", "submission.resubmit", {
      message: `Entry ${entry.idNo} resubmitted after revert`,
      user: entry.submittedBy || "portal",
      ip: req.ip,
      meta: { id: entry._id },
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get latest baseline info for an SLF (by assigned name or facility id) — portal
router.get("/baseline/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    // Optional: SlfFacility _id passed by the portal so lookup works even when
    // the facility was renamed and the stored slfName no longer matches.
    const slfId = req.query.slfId;
    const slfObjectId =
      slfId && mongoose.Types.ObjectId.isValid(String(slfId))
        ? new mongoose.Types.ObjectId(String(slfId))
        : null;

    const nameOrFilters = [
      ...(slfObjectId ? [{ slfGenerator: slfObjectId }] : []),
      { slfName },
      { lguCompanyName: slfName },
    ];

    let candidates = await DataSLF.find({
      $and: [{ $or: nameOrFilters }, baselineDataMatch],
    })
      .setOptions({ includeHiddenYears: true })
      .sort({ createdAt: -1 })
      .lean();

    // Prefer records that match by facility id (most reliable link after a rename).
    let matchedCandidates = candidates;
    if (
      slfObjectId &&
      candidates.some((c) => String(c.slfGenerator || "") === String(slfObjectId))
    ) {
      matchedCandidates = candidates.filter(
        (c) => String(c.slfGenerator || "") === String(slfObjectId),
      );
    }
    let latest = chooseBaselineRecord(matchedCandidates);

    if (!latest) {
      candidates = await DataSLF.find(baselineDataMatch)
        .setOptions({ includeHiddenYears: true })
        .sort({ createdAt: -1 })
        .lean();
      matchedCandidates = candidates.filter((item) => {
        if (slfObjectId && String(item.slfGenerator || "") === String(slfObjectId))
          return true;
        return matchesBaselineName(item, slfName);
      });
      latest = chooseBaselineRecord(matchedCandidates);
    }

    if (!latest) return res.json(null);

    const baselineUnit = latest.baselineUnit || latest.totalVolumeAcceptedUnit || "m³";
    const haulerSource =
      matchedCandidates.find((item) => item?.accreditedHaulers?.length > 0 && !hasTruckVolume(item)) ||
      matchedCandidates.find((item) => item?.accreditedHaulers?.length > 0) ||
      latest;

    res.json({
      baselineUnit,
      lguCompanyName: latest.lguCompanyName,
      companyType: latest.companyType,
      address: latest.address,
      companyRegion: latest.companyRegion,
      companyProvince: latest.companyProvince,
      companyMunicipality: latest.companyMunicipality,
      companyBarangay: latest.companyBarangay,
      totalVolumeAccepted: latest.totalVolumeAccepted,
      totalVolumeAcceptedUnit: latest.totalVolumeAcceptedUnit || baselineUnit,
      activeCellResidualVolume: latest.activeCellResidualVolume,
      activeCellResidualUnit: latest.activeCellResidualUnit || baselineUnit,
      activeCellInertVolume: latest.activeCellInertVolume,
      activeCellInertUnit: latest.activeCellInertUnit || baselineUnit,
      activeCellHazardousVolume: latest.activeCellHazardousVolume,
      activeCellHazardousUnit: latest.activeCellHazardousUnit || baselineUnit,
      closedCellResidualVolume: latest.closedCellResidualVolume,
      closedCellResidualUnit: latest.closedCellResidualUnit || baselineUnit,
      closedCellInertVolume: latest.closedCellInertVolume,
      closedCellInertUnit: latest.closedCellInertUnit || baselineUnit,
      closedCellHazardousVolume: latest.closedCellHazardousVolume,
      closedCellHazardousUnit: latest.closedCellHazardousUnit || baselineUnit,
      acceptsHazardousWaste: latest.acceptsHazardousWaste || false,
      activeCellEntries: latest.activeCellEntries || [],
      closedCellEntries: latest.closedCellEntries || [],
      accreditedHaulers: haulerSource.accreditedHaulers || [],
      baselineUpdateApproved: latest.baselineUpdateApproved || false,
      baselineUpdateRequested: latest.baselineUpdateRequested || false,
      savedAt: latest.updatedAt || latest.createdAt,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get latest baseline info for ALL SLF generators — admin tab
router.get("/baselines", async (req, res) => {
  try {
    // Aggregate from DataSLF directly — covers both SLFGenerator and SlfFacility refs
    // Include soft-deleted records since baseline is facility-level data
    // Match any record that has baseline data: totalVolumeAccepted set, OR activeCellEntries/closedCellEntries present
    const latestPerSlf = await DataSLF.aggregate([
      {
        $match: baselineDataMatch,
      },
      {
        $addFields: {
          _truckVolumeTotal: {
            $sum: {
              $map: {
                input: { $ifNull: ["$trucks", []] },
                as: "truck",
                in: { $ifNull: ["$$truck.actualVolume", 0] },
              },
            },
          },
        },
      },
      { $addFields: { _hasTruckVolume: { $gt: ["$_truckVolumeTotal", 0] } } },
      { $sort: { _hasTruckVolume: 1, createdAt: -1 } },
      {
        $group: {
          _id: { $ifNull: ["$slfName", "$lguCompanyName"] },
          doc: { $first: "$$ROOT" },
          _anyUpdateRequested: { $max: { $ifNull: ["$baselineUpdateRequested", false] } },
          _anyUpdateApproved: { $max: { $ifNull: ["$baselineUpdateApproved", false] } },
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$doc",
              { baselineUpdateRequested: "$_anyUpdateRequested", baselineUpdateApproved: "$_anyUpdateApproved" },
            ],
          },
        },
      },
      { $sort: { slfName: 1 } },
    ]);

    const results = latestPerSlf.map((d) => {
      const baselineUnit = d.baselineUnit || d.totalVolumeAcceptedUnit || "m³";
      return ({
      _id: d._id,
      slfGenerator: d.slfGenerator,
      slfName: d.slfName || d.lguCompanyName || "Unknown",
      lguCompanyName: d.lguCompanyName,
      baselineUnit,
      totalVolumeAccepted: d.totalVolumeAccepted,
      totalVolumeAcceptedUnit: d.totalVolumeAcceptedUnit || baselineUnit,
      activeCellResidualVolume: d.activeCellResidualVolume,
      activeCellResidualUnit: d.activeCellResidualUnit || baselineUnit,
      activeCellInertVolume: d.activeCellInertVolume,
      activeCellInertUnit: d.activeCellInertUnit || baselineUnit,
      activeCellHazardousVolume: d.activeCellHazardousVolume,
      activeCellHazardousUnit: d.activeCellHazardousUnit || baselineUnit,
      closedCellResidualVolume: d.closedCellResidualVolume,
      closedCellResidualUnit: d.closedCellResidualUnit || baselineUnit,
      closedCellInertVolume: d.closedCellInertVolume,
      closedCellInertUnit: d.closedCellInertUnit || baselineUnit,
      closedCellHazardousVolume: d.closedCellHazardousVolume,
      closedCellHazardousUnit: d.closedCellHazardousUnit || baselineUnit,
      acceptsHazardousWaste: d.acceptsHazardousWaste || false,
      accreditedHaulers: d.accreditedHaulers || [],
      activeCellEntries: d.activeCellEntries || [],
      closedCellEntries: d.closedCellEntries || [],
      submittedBy: d.submittedBy,
      baselineUpdateApproved: d.baselineUpdateApproved || false,
      baselineUpdateRequested: d.baselineUpdateRequested || false,
      lastUpdated: d.updatedAt || d.createdAt,
    });
    });

    res.json(results);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin update baseline data for a specific DataSLF record
router.put("/baselines/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Baseline record not found" });

    const fields = [
      "baselineUnit",
      "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "activeCellHazardousVolume", "activeCellHazardousUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
      "closedCellHazardousVolume", "closedCellHazardousUnit",
      "acceptsHazardousWaste",
      "accreditedHaulers",
      "activeCellEntries",
      "closedCellEntries",
    ];
    for (const f of fields) {
      if (req.body[f] !== undefined) entry[f] = req.body[f];
    }
    await entry.save();

    await Transaction.create({
      dataEntry: entry._id,
      submissionId: entry.submissionId,
      companyName: entry.slfName,
      submittedBy: entry.submittedBy,
      type: "baseline_update",
      description: `Admin updated baseline data for ${entry.slfName}`,
      performedBy: req.body.updatedBy || getRequestActor(req),
      meta: { entryId: entry._id, slfName: entry.slfName },
    });

    writeLog("info", "baseline.admin-update", {
      message: `Admin updated baseline for ${entry.slfName}`,
      user: req.body.updatedBy || getRequestActor(req),
      meta: { entryId: entry._id, slfName: entry.slfName },
    });

    res.json({ message: "Baseline updated", data: entry });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin delete baseline data for a specific DataSLF record (clears baseline fields)
router.delete("/baselines/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Baseline record not found" });

    const slfName = entry.slfName || entry.lguCompanyName;

    // Clear baseline data from ALL DataSLF documents for this SLF so the
    // aggregation in GET /baselines no longer returns any row for this SLF.
    const baselineClear = {
      $unset: {
        baselineUnit: "",
        totalVolumeAccepted: "",
        totalVolumeAcceptedUnit: "",
        activeCellResidualVolume: "",
        activeCellResidualUnit: "",
        activeCellInertVolume: "",
        activeCellInertUnit: "",
        activeCellHazardousVolume: "",
        activeCellHazardousUnit: "",
        closedCellResidualVolume: "",
        closedCellResidualUnit: "",
        closedCellInertVolume: "",
        closedCellInertUnit: "",
        closedCellHazardousVolume: "",
        closedCellHazardousUnit: "",
        baselineUpdateRequestedAt: "",
        baselineUpdateApprovedAt: "",
        baselineUpdateApprovedBy: "",
      },
      $set: {
        acceptsHazardousWaste: false,
        activeCellEntries: [],
        closedCellEntries: [],
        accreditedHaulers: [],
        baselineUpdateRequested: false,
        baselineUpdateApproved: false,
      },
    };

    // Update all documents belonging to this SLF (matching by slfName or lguCompanyName)
    await DataSLF.updateMany(
      { $or: [{ slfName }, { lguCompanyName: slfName }] },
      baselineClear
    );

    await Transaction.create({
      dataEntry: entry._id,
      submissionId: entry.submissionId,
      companyName: slfName,
      submittedBy: entry.submittedBy,
      type: "baseline_delete",
      description: `Admin cleared baseline data for ${slfName}`,
      performedBy: getRequestActor(req),
      meta: { entryId: entry._id, slfName },
    });

    writeLog("warn", "baseline.admin-delete", {
      message: `Admin cleared baseline data for ${slfName}`,
      user: getRequestActor(req),
      meta: { entryId: entry._id, slfName },
    });

    res.json({ message: "Baseline data cleared" });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin approve baseline update request
router.patch("/baseline-update-approve/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    const { approvedBy } = req.body || {};

    const filter = {
      $and: [
        { $or: [{ slfName }, { lguCompanyName: slfName }] },
        baselineDataMatch,
      ],
    };

    // Update ALL docs for this company so aggregation always picks up the flag
    await DataSLF.updateMany(filter, {
      $set: {
        baselineUpdateApproved: true,
        baselineUpdateApprovedAt: new Date(),
        baselineUpdateApprovedBy: approvedBy || getRequestActor(req),
        baselineUpdateRequested: false,
      },
    });

    const latest = await DataSLF.findOne(filter).sort({ createdAt: -1 });
    if (!latest) return res.status(404).json({ message: "Baseline not found" });

    // Notify the portal user
    try {
      await Notification.create({
        recipient: latest.submittedBy,
        type: "baseline_update_approved",
        title: "Baseline Update Approved",
        message: `Your baseline update request for ${slfName} has been approved. You may now update your baseline data.`,
        meta: { slfName },
      });
    } catch { /* silent */ }
    notifyPortal(req, latest.submittedBy, { type: "baseline_update_approved", title: "Baseline Update Approved" });

    // Log transaction
    try {
      await Transaction.create({
        submissionId: latest.submissionId,
        dataEntry: latest._id,
        companyName: slfName,
        submittedBy: latest.submittedBy,
        type: "baseline_update_approved",
        description: `Admin approved baseline update request for ${slfName}`,
        performedBy: approvedBy || getRequestActor(req),
        meta: { slfName },
      });
    } catch { /* silent */ }

    writeLog("info", "baseline.update-approved", {
      message: `Baseline update approved for ${slfName}`,
      user: approvedBy || getRequestActor(req),
    });

    res.json({ message: "Baseline update approved", data: latest });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin revoke baseline update approval (re-lock)
router.patch("/baseline-update-lock/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    const { lockedBy } = req.body || {};

    const filter = {
      $and: [
        { $or: [{ slfName }, { lguCompanyName: slfName }] },
        baselineDataMatch,
      ],
    };

    const result = await DataSLF.updateMany(filter, {
      $set: { baselineUpdateApproved: false },
    });

    if (result.matchedCount === 0) return res.status(404).json({ message: "Baseline not found" });

    const latest = await DataSLF.findOne(filter).sort({ createdAt: -1 });

    // Notify the portal user in real time
    if (latest?.submittedBy) {
      try {
        await Notification.create({
          recipient: latest.submittedBy,
          type: "baseline_locked",
          title: "Baseline Locked",
          message: `Your baseline data for ${slfName} has been locked by an admin.`,
          meta: { slfName },
        });
      } catch { /* silent */ }
      notifyPortal(req, latest.submittedBy, { type: "baseline_locked", title: "Baseline Locked" });
    }

    // Log transaction
    try {
      await Transaction.create({
        submissionId: latest?.submissionId,
        dataEntry: latest?._id,
        companyName: slfName,
        submittedBy: latest?.submittedBy,
        type: "baseline_locked",
        description: `Admin locked baseline data for ${slfName}`,
        performedBy: lockedBy || getRequestActor(req),
        meta: { slfName },
      });
    } catch { /* silent */ }

    writeLog("info", "baseline.locked", {
      message: `Baseline locked for ${slfName}`,
      user: lockedBy || getRequestActor(req),
    });

    res.json({ message: "Baseline re-locked" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin reject baseline update request
router.patch("/baseline-update-reject/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    const { rejectedBy, reason } = req.body || {};

    const filter = {
      $and: [
        { $or: [{ slfName }, { lguCompanyName: slfName }] },
        baselineDataMatch,
      ],
    };

    // Clear flags on ALL matching docs
    await DataSLF.updateMany(filter, {
      $set: { baselineUpdateRequested: false, baselineUpdateApproved: false },
    });

    const latest = await DataSLF.findOne(filter).sort({ createdAt: -1 });
    if (!latest) return res.status(404).json({ message: "Baseline not found" });

    // Notify the portal user
    try {
      await Notification.create({
        recipient: latest.submittedBy,
        type: "baseline_update_rejected",
        title: "Baseline Update Request Rejected",
        message: `Your baseline update request for ${slfName} has been rejected.${reason ? " Reason: " + reason : ""}`,
        meta: { slfName, reason },
      });
    } catch { /* silent */ }
    notifyPortal(req, latest.submittedBy, { type: "baseline_update_rejected", title: "Baseline Update Rejected" });

    // Log transaction
    try {
      await Transaction.create({
        submissionId: latest.submissionId,
        dataEntry: latest._id,
        companyName: slfName,
        submittedBy: latest.submittedBy,
        type: "baseline_update_request",
        description: `Admin rejected baseline update request for ${slfName}${reason ? ": " + reason : ""}`,
        performedBy: rejectedBy || getRequestActor(req),
        meta: { slfName, reason, action: "rejected" },
      });
    } catch { /* silent */ }

    res.json({ message: "Baseline update request rejected", data: latest });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Request submission edit (for acknowledged entries)
router.patch("/:id/request-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (entry.status !== "acknowledged") {
      return res.status(400).json({ message: "Only approved entries can request edits" });
    }

    const { reason, requestedBy } = req.body || {};
    await ensurePortalAccountCanSubmit(requestedBy || entry.submittedBy);
    entry.revertRequested = true;
    entry.revertReason = reason;
    entry.revertRequestedAt = new Date();
    await entry.save();

    // Notify admin
    try {
      await Notification.create({
        recipient: "admin",
        type: "submission_edit_request",
        title: "Submission Edit Request",
        message: `${requestedBy || "A portal user"} requested to edit submission ${entry.idNo}`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, reason, requestedBy },
      });
    } catch { /* silent */ }
    notifyAdmin(req, { type: "submission_edit_request", title: "Edit Request", message: `${requestedBy} requested edit for ${entry.idNo}` });
    refreshAdmin(req, "submissions");

    // Log transaction
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "submission_edit_request",
        description: `Portal user requested edit for ${entry.idNo}: ${reason}`,
        performedBy: requestedBy || "portal",
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }

    res.json({ message: "Edit request submitted", data: entry });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Approve submission edit request (revert the entry so portal user can edit)
router.patch("/:id/approve-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const { approvedBy, reason } = req.body || {};
    entry.status = "reverted";
    entry.revertedBy = approvedBy || getRequestActor(req);
    entry.revertedAt = new Date();
    entry.revertReason = reason || entry.revertReason || "Edit request approved by admin";
    entry.revertRequested = false;
    await entry.save();

    // Notify portal user
    try {
      await Notification.create({
        recipient: entry.submittedBy,
        type: "submission_edit_approved",
        title: "Edit Request Approved",
        message: `Your edit request for submission ${entry.idNo} has been approved. You may now edit and resubmit.`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }
    notifyPortal(req, entry.submittedBy, { type: "submission_edit_approved", title: "Edit Approved" });
    refreshAdmin(req, "submissions");

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "submission_edit_approved",
        description: `Admin approved edit request for ${entry.idNo}`,
        performedBy: approvedBy || getRequestActor(req),
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json({ message: "Edit request approved", data: populated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Reject submission edit request
router.patch("/:id/reject-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const { rejectedBy, reason } = req.body || {};
    entry.revertRequested = false;
    entry.revertReason = "";
    await entry.save();

    // Notify portal user
    try {
      await Notification.create({
        recipient: entry.submittedBy,
        type: "submission_edit_rejected",
        title: "Edit Request Rejected",
        message: `Your edit request for submission ${entry.idNo} was rejected. Reason: ${reason || "Not specified"}`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }
    notifyPortal(req, entry.submittedBy, { type: "submission_edit_rejected", title: "Edit Rejected" });
    refreshAdmin(req, "submissions");

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "submission_edit_rejected",
        description: `Admin rejected edit request for ${entry.idNo}: ${reason || "No reason"}`,
        performedBy: rejectedBy || getRequestActor(req),
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json({ message: "Edit request rejected", data: populated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [submissions, generators, totalTrucks, byStatus, byCompanyType, wasteByType, monthlyData] =
      await Promise.all([
        DataSLF.countDocuments({ deletedAt: null }),
        SLFGenerator.countDocuments(),
        DataSLF.aggregate([
          { $match: { deletedAt: null } },
          { $project: { count: { $size: { $ifNull: ["$trucks", []] } } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ]),
        DataSLF.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
        DataSLF.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: "$companyType", count: { $sum: 1 } } }]),
        DataSLF.aggregate([
          { $match: { deletedAt: null } },
          { $unwind: "$trucks" },
          {
            $group: {
              _id: "$trucks.wasteType",
              totalVolume: { $sum: { $ifNull: ["$trucks.actualVolume", 0] } },
              count: { $sum: 1 },
            },
          },
        ]),
        DataSLF.aggregate([
          { $match: { deletedAt: null } },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
              },
              count: { $sum: 1 },
              totalVolume: {
                $sum: {
                  $reduce: {
                    input: { $ifNull: ["$trucks", []] },
                    initialValue: 0,
                    in: { $add: ["$$value", { $ifNull: ["$$this.actualVolume", 0] }] },
                  },
                },
              },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          { $limit: 12 },
        ]),
      ]);

    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));

    const companyMap = {};
    byCompanyType.forEach((c) => (companyMap[c._id] = c.count));

    const recentSubmissions = await DataSLF.find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("idNo lguCompanyName companyType status createdAt trucks");

    res.json({
      submissions,
      generators,
      totalTrucks: totalTrucks[0]?.total || 0,
      byStatus: statusMap,
      byCompanyType: companyMap,
      wasteByType,
      monthlyData,
      recentSubmissions,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Aggregated stats per SLF generator (for Waste Generators tab tiles)
router.get("/generator-summary", async (req, res) => {
  try {
    const summary = await DataSLF.aggregate([
      { $match: { slfGenerator: { $ne: null }, deletedAt: null } },
      {
        $group: {
          _id: "$slfGenerator",
          totalEntries: { $sum: 1 },
          pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          acknowledgedCount: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          totalTrucks: { $sum: { $size: { $ifNull: ["$trucks", []] } } },
          totalVolume: {
            $sum: {
              $reduce: {
                input: { $ifNull: ["$trucks", []] },
                initialValue: 0,
                in: { $add: ["$$value", { $ifNull: ["$$this.actualVolume", 0] }] },
              },
            },
          },
          lguCount: { $sum: { $cond: [{ $eq: ["$companyType", "LGU"] }, 1, 0] } },
          privateCount: { $sum: { $cond: [{ $eq: ["$companyType", "Private"] }, 1, 0] } },
          lastSubmission: { $max: "$createdAt" },
        },
      },
    ]);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all SLF data entries (admin) — excludes soft-deleted
router.get("/", async (req, res) => {
  try {
    await softDeleteOverdueReverted(req);
    // Admin management view — respects App Settings year visibility filter
    const listMode = req.query.mode === "list";
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 100);
    const paginated = listMode && limit > 0;
    const filter = { deletedAt: null };
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();
    const includeTrucks = String(req.query.includeTrucks || "").toLowerCase() === "true";
    const withTruckVolume = String(req.query.withTruckVolume || "").toLowerCase() === "true";

    if (listMode && status && status !== "all") {
      filter.status = status;
    }
    if (listMode && withTruckVolume) {
      filter["trucks.actualVolume"] = { $gt: 0 };
    }
    if (listMode && search) {
      const rx = new RegExp(escapeRegExp(search), "i");
      filter.$or = [
        { idNo: rx },
        { submissionId: rx },
        { lguCompanyName: rx },
        { companyType: rx },
        { slfName: rx },
        { submittedBy: rx },
      ];
    }

    let query = DataSLF.find(filter)
      .populate("slfGenerator")
      .sort({ createdAt: -1 });
    if (listMode) {
      query = query.select(
        "slfGenerator slfName submissionId idNo previousIdNos dateOfDisposal lguCompanyName companyType address companyRegion companyProvince companyMunicipality companyBarangay trucks status revertRequested editRequested submittedBy createdAt updatedAt baselineUnit totalVolumeAccepted totalVolumeAcceptedUnit activeCellEntries closedCellEntries",
      );
    }
    if (paginated) {
      query = query.skip((page - 1) * limit).limit(limit);
    }
    const [entries, total] = await Promise.all([
      query.lean(),
      paginated ? DataSLF.countDocuments(filter) : Promise.resolve(null),
    ]);
    if (paginated) {
      res.json({
        data: entries.map((entry) => ({
          ...entry,
          truckCount: Array.isArray(entry.trucks) ? entry.trucks.length : 0,
          trucks: includeTrucks ? entry.trucks : [],
        })),
        total,
        page,
        limit,
      });
      return;
    }
    res.json(entries);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/detail/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null })
      .populate("slfGenerator")
      .lean();
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    res.json(entry);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/cell-capacity-alert", async (req, res) => {
  try {
    const { submissionIds = [], message, cellName, slfName, performedBy } = req.body || {};
    const ids = Array.isArray(submissionIds) ? submissionIds.filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ message: "Select at least one submission." });

    const entries = await DataSLF.find({ _id: { $in: ids }, deletedAt: null })
      .select("idNo submissionId lguCompanyName submittedBy slfName")
      .lean();
    const recipients = [...new Set(entries.map((entry) => entry.submittedBy).filter(Boolean))];
    if (recipients.length === 0) return res.status(400).json({ message: "No portal user email found for selected submissions." });

    const text = message || `The landfill cell${cellName ? ` (${cellName})` : ""}${slfName ? ` at ${slfName}` : ""} is nearing capacity. Please coordinate with EMB Region III before the next disposal.`;
    await Notification.insertMany(recipients.map((email) => ({
      recipient: email,
      type: "cell_capacity_alert",
      title: "Landfill Cell Capacity Alert",
      message: text,
      submissionId: entries.find((entry) => entry.submittedBy === email)?.submissionId,
      meta: {
        cellName,
        slfName,
        submissionIds: entries.filter((entry) => entry.submittedBy === email).map((entry) => entry.submissionId || entry.idNo),
      },
    })));
    recipients.forEach((email) => notifyPortal(req, email, {
      type: "cell_capacity_alert",
      title: "Landfill Cell Capacity Alert",
      message: text,
      meta: { cellName, slfName },
    }));
    await Transaction.create({
      submissionId: entries[0]?.submissionId || entries[0]?.idNo || "cell-capacity-alert",
      companyName: slfName || entries[0]?.slfName || entries[0]?.lguCompanyName || "",
      type: "cell_capacity_alert",
      description: `Cell capacity alert sent to ${recipients.length} portal user(s)${cellName ? ` for ${cellName}` : ""}`,
      performedBy: performedBy || getRequestActor(req),
      meta: { recipients, cellName, slfName, submissionIds: ids },
    });
    notifyAdmin(req, {
      type: "cell_capacity_alert",
      title: "Cell Capacity Alert Sent",
      message: `Alert sent to ${recipients.length} portal user(s).`,
    });
    res.json({ message: "Cell capacity alert sent.", recipients: recipients.length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: assign submitted truck volumes to specific active SLF cells.
router.patch("/:id/cell-assignments", async (req, res) => {
  try {
    const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null });
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    assignments.forEach((assignment) => {
      const truckIndex = Number(assignment.truckIndex);
      if (!Number.isInteger(truckIndex) || truckIndex < 0 || truckIndex >= entry.trucks.length) return;
      const cellIndex = assignment.cellIndex === null || assignment.cellIndex === undefined || assignment.cellIndex === ""
        ? undefined
        : Number(assignment.cellIndex);
      if (cellIndex !== undefined && (!Number.isInteger(cellIndex) || cellIndex < 0)) return;
      const cellName = cellIndex === undefined ? "" : (assignment.cellName || `Cell ${cellIndex + 1}`);
      const cellType = assignment.cellType || "";
      // Per-vehicle assignment when a vehicleIndex is supplied (new model).
      const vehicleIndex =
        assignment.vehicleIndex === null || assignment.vehicleIndex === undefined
          ? null
          : Number(assignment.vehicleIndex);
      const truck = entry.trucks[truckIndex];
      if (
        Number.isInteger(vehicleIndex) &&
        Array.isArray(truck.vehicles) &&
        vehicleIndex >= 0 &&
        vehicleIndex < truck.vehicles.length
      ) {
        truck.vehicles[vehicleIndex].cellIndex = cellIndex;
        truck.vehicles[vehicleIndex].cellName = cellName;
        truck.vehicles[vehicleIndex].cellType = cellType;
        // Keep the truck-level cell in sync with the first vehicle for legacy views.
        if (vehicleIndex === 0) {
          truck.cellIndex = cellIndex;
          truck.cellName = cellName;
          truck.cellType = cellType;
        }
        return;
      }
      truck.cellIndex = cellIndex;
      truck.cellName = cellName;
      truck.cellType = cellType;
      // Mirror to all vehicles so per-vehicle cell-fill stays consistent.
      if (Array.isArray(truck.vehicles)) {
        truck.vehicles.forEach((veh) => {
          veh.cellIndex = cellIndex;
          veh.cellName = cellName;
          veh.cellType = cellType;
        });
      }
    });
    entry.markModified("trucks");
    await entry.save();

    await Transaction.create({
      submissionId: entry.submissionId || entry.idNo,
      dataEntry: entry._id,
      companyName: entry.lguCompanyName,
      companyType: entry.companyType,
      submittedBy: entry.submittedBy || "",
      type: "cell_assignment",
      description: `Updated cell assignment for ${entry.idNo || entry.lguCompanyName}`,
      performedBy: getRequestActor(req, "admin"),
      meta: { idNo: entry.idNo, assignments },
    });

    notifyAdmin(req, {
      type: "baseline_update",
      title: "SLF Cell Assignment Updated",
      message: `${entry.idNo || entry.lguCompanyName} waste placement was assigned to active cells`,
      meta: { idNo: entry.idNo, dataEntry: entry._id },
    });
    refreshAdmin(req, "submissions");
    res.json({ message: "Cell assignments updated", data: entry });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: the submitter organizes their own past submission waste into open
// cells. Validates ownership via submittedBy and applies per-vehicle (or
// truck-level) cell placements.
router.patch("/:id/portal-cell-assignments", async (req, res) => {
  try {
    const { submittedBy, assignments } = req.body || {};
    const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null });
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (
      !submittedBy ||
      String(entry.submittedBy || "").trim().toLowerCase() !==
        String(submittedBy).trim().toLowerCase()
    ) {
      return res.status(403).json({ message: "You can only organize your own submissions." });
    }
    const list = Array.isArray(assignments) ? assignments : [];
    list.forEach((assignment) => {
      const truckIndex = Number(assignment.truckIndex);
      if (!Number.isInteger(truckIndex) || truckIndex < 0 || truckIndex >= entry.trucks.length) return;
      const truck = entry.trucks[truckIndex];
      const cellIndex =
        assignment.cellIndex === null || assignment.cellIndex === undefined || assignment.cellIndex === ""
          ? undefined
          : Number(assignment.cellIndex);
      if (cellIndex !== undefined && (!Number.isInteger(cellIndex) || cellIndex < 0)) return;
      const cellName = cellIndex === undefined ? "" : (assignment.cellName || `Cell ${cellIndex + 1}`);
      const cellType = assignment.cellType || "";
      const vehicleIndex =
        assignment.vehicleIndex === null || assignment.vehicleIndex === undefined
          ? null
          : Number(assignment.vehicleIndex);
      if (
        Number.isInteger(vehicleIndex) &&
        Array.isArray(truck.vehicles) &&
        vehicleIndex >= 0 &&
        vehicleIndex < truck.vehicles.length
      ) {
        truck.vehicles[vehicleIndex].cellIndex = cellIndex;
        truck.vehicles[vehicleIndex].cellName = cellName;
        truck.vehicles[vehicleIndex].cellType = cellType;
        if (vehicleIndex === 0) {
          truck.cellIndex = cellIndex;
          truck.cellName = cellName;
          truck.cellType = cellType;
        }
        return;
      }
      truck.cellIndex = cellIndex;
      truck.cellName = cellName;
      truck.cellType = cellType;
      if (Array.isArray(truck.vehicles)) {
        truck.vehicles.forEach((veh) => {
          veh.cellIndex = cellIndex;
          veh.cellName = cellName;
          veh.cellType = cellType;
        });
      }
    });
    entry.markModified("trucks");
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId || entry.idNo,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy || "",
        type: "cell_assignment",
        description: `Portal user organized waste placement for ${entry.idNo || entry.lguCompanyName}`,
        performedBy: submittedBy,
        meta: { idNo: entry.idNo, portal: true },
      });
    } catch { /* silent */ }
    refreshAdmin(req, "submissions");
    res.json({ message: "Cell placement saved", data: entry });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a submission (admin edit)
router.patch("/:id/admin-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    const allowed = [
      "dateOfDisposal", "lguCompanyName", "companyType", "address",
      "companyRegion", "companyProvince", "companyMunicipality", "companyBarangay",
      "trucks", "accreditedHaulers", "slfGenerator", "slfName",
      "baselineUnit", "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "activeCellHazardousVolume", "activeCellHazardousUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
      "closedCellHazardousVolume", "closedCellHazardousUnit",
      "activeCellEntries", "closedCellEntries",
      "acceptsHazardousWaste",
    ];
    const updatedFields = allowed.filter((key) => req.body[key] !== undefined);
    for (const key of allowed) {
      if (req.body[key] !== undefined) entry[key] = req.body[key];
    }
    await entry.save();
    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "admin_edit",
        description: `Admin edited submission ${entry.idNo}`,
        performedBy: req.body.updatedBy || getRequestActor(req),
        meta: { idNo: entry.idNo, updatedFields },
      });
    } catch { /* silent */ }
    res.json(populated);
    writeLog("info", "submission.update", {
      message: `Submission ${entry.idNo} edited by admin`,
      user: req.body.updatedBy || getRequestActor(req),
      ip: req.ip,
      meta: { id: entry._id, idNo: entry.idNo },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update status (acknowledge/reject)
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body || {};
    const entry = await DataSLF.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: "after" }
    ).populate("slfGenerator");
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    res.json(entry);

    if (status === "acknowledged") {
      markSubmissionNotificationsRead(entry).catch(() => {});
    }

    // Notify portal user of status change
    if (entry.submittedBy) {
      try {
        const UserPortal = require("../models/UserPortal");
        const portalUser = await UserPortal.findOne({ email: entry.submittedBy });
        if (portalUser) {
          await Notification.create({
            recipient: portalUser._id.toString(),
            type: "status_change",
            title: status === "acknowledged" ? "Submission Acknowledged" : "Submission Rejected",
            message: `Your submission ${entry.idNo} (${entry.lguCompanyName || ""}) has been ${status}`,
            submissionId: entry.submissionId,
            dataEntry: entry._id,
            meta: { idNo: entry.idNo, status, companyName: entry.lguCompanyName },
          });
        }
      } catch { /* silent */ }
      notifyPortal(req, entry.submittedBy, { type: "status_change", title: status === "acknowledged" ? "Submission Acknowledged" : "Submission Rejected" });
    }
    refreshAdmin(req, "submissions");

    // Log status change transaction
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "status_change",
        description: `Entry ${entry.idNo} marked as ${status}`,
        performedBy: getRequestActor(req),
        meta: { status, idNo: entry.idNo },
      });
    } catch { /* silent */ }

    // Send acknowledgement email only when ALL entries in this submission are acknowledged
    if (status === "acknowledged" && entry.submittedBy && entry.submissionId) {
      try {
        const siblingEntries = await DataSLF.find({ submissionId: entry.submissionId });
        const allAcknowledged = siblingEntries.every((e) => e.status === "acknowledged");
        if (allAcknowledged) {
          await sendAcknowledgementEmail(entry.submittedBy, {
            submissionId: entry.submissionId,
            totalEntries: siblingEntries.length,
            entries: siblingEntries.map((e) => ({
              idNo: e.idNo,
              dateOfDisposal: e.dateOfDisposal,
              lguCompanyName: e.lguCompanyName,
              companyType: e.companyType,
              trucks: e.trucks,
            })),
          });
        }
      } catch (emailErr) {
        console.error("Acknowledge email failed:", emailErr.message);
      }
    }

    writeLog("info", "submission.status", {
      message: `Submission ${entry.idNo} ${status}`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { id: entry._id, status },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk update status (acknowledge/reject multiple entries)
router.patch("/bulk-status", async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No entries selected" });
    }
    if (!["acknowledged", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    await DataSLF.updateMany({ _id: { $in: ids } }, { status });

    const updated = await DataSLF.find({ _id: { $in: ids } }).populate("slfGenerator");

    if (status === "acknowledged") {
      markSubmissionNotificationsRead(updated).catch(() => {});
    }

    // Log transactions
    for (const entry of updated) {
      try {
        await Transaction.create({
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          companyName: entry.lguCompanyName,
          companyType: entry.companyType,
          submittedBy: entry.submittedBy,
          type: "status_change",
          description: `Entry ${entry.idNo} marked as ${status} (bulk)`,
          performedBy: getRequestActor(req),
          meta: { status, idNo: entry.idNo, bulk: true },
        });
      } catch { /* silent */ }
    }

    // Send bulk acknowledge email grouped by submittedBy + submissionId (one email per submission)
    if (status === "acknowledged") {
      const bySubmission = {};
      for (const entry of updated) {
        if (!entry.submittedBy || !entry.submissionId) continue;
        const key = `${entry.submittedBy}::${entry.submissionId}`;
        if (!bySubmission[key]) bySubmission[key] = { email: entry.submittedBy, submissionId: entry.submissionId, entries: [] };
        bySubmission[key].entries.push(entry);
      }
      for (const { email, submissionId, entries } of Object.values(bySubmission)) {
        // Only send if all entries in this submission are now acknowledged
        const allInSubmission = await DataSLF.find({ submissionId });
        const allAcknowledged = allInSubmission.every((e) => e.status === "acknowledged");
        if (!allAcknowledged) continue;
        try {
          await sendBulkAcknowledgeEmail(email, {
            submissionId,
            totalEntries: allInSubmission.length,
            entries: allInSubmission.map((e) => ({
              idNo: e.idNo,
              dateOfDisposal: e.dateOfDisposal,
              lguCompanyName: e.lguCompanyName,
              companyType: e.companyType,
              trucks: e.trucks,
            })),
          });
        } catch (emailErr) {
          console.error("Bulk acknowledge email failed:", emailErr.message);
        }
      }
    }

    res.json({ message: `${updated.length} entries ${status}`, data: updated });
    writeLog("info", "submission.bulk-status", {
      message: `Bulk ${status}: ${updated.length} entries`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { status, count: updated.length, ids: updated.map((e) => e.idNo) },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk soft-delete selected submissions
router.post("/bulk-delete", async (req, res) => {
  try {
    const { ids, performedBy } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No entries selected" });
    }

    const entries = await DataSLF.find({ _id: { $in: ids }, deletedAt: null });
    for (const entry of entries) {
      entry.deletedAt = new Date();
      entry.deletedBy = performedBy || getRequestActor(req, "admin");
      await entry.save();
      try {
        await Transaction.create({
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          companyName: entry.lguCompanyName,
          companyType: entry.companyType,
          submittedBy: entry.submittedBy,
          type: "deleted",
          description: `Entry ${entry.idNo} deleted (bulk)`,
          performedBy: performedBy || getRequestActor(req, "admin"),
          meta: { idNo: entry.idNo, bulk: true },
        });
      } catch { /* silent */ }
    }

    refreshAdmin(req, "submissions");
    writeLog("warn", "submission.bulk-delete", {
      message: `Bulk deleted ${entries.length} submissions`,
      user: performedBy || getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { count: entries.length, ids: entries.map((entry) => entry.idNo) },
    });
    res.json({ message: `${entries.length} entries moved to trash`, data: entries });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk admin revert selected submissions back to the portal user
router.patch("/bulk-revert", async (req, res) => {
  try {
    const { ids, reason, performedBy } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No entries selected" });
    }
    if (!reason?.trim()) {
      return res.status(400).json({ message: "Reason is required" });
    }

    const entries = await DataSLF.find({ _id: { $in: ids }, deletedAt: null });
    const updated = [];
    for (const entry of entries) {
      entry.status = "reverted";
      entry.revertReason = reason.trim();
      entry.revertedBy = performedBy || getRequestActor(req);
      entry.revertedAt = new Date();
      entry.revertRequested = false;
      await entry.save();
      updated.push(entry);

      try {
        await Transaction.create({
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          companyName: entry.lguCompanyName,
          companyType: entry.companyType,
          submittedBy: entry.submittedBy,
          type: "status_change",
          description: `Admin reverted submission ${entry.idNo} (bulk): ${reason.trim()}`,
          performedBy: performedBy || getRequestActor(req),
          meta: { idNo: entry.idNo, reason: reason.trim(), bulk: true },
        });
      } catch { /* silent */ }

      if (entry.submittedBy) {
        try {
          await Notification.create({
            recipient: entry.submittedBy,
            type: "reverted",
            title: "Submission Reverted",
            message: `Your submission ${entry.idNo} has been reverted. Reason: ${reason.trim()}`,
            submissionId: entry.submissionId,
            dataEntry: entry._id,
            meta: { idNo: entry.idNo, reason: reason.trim(), bulk: true },
          });
        } catch { /* silent */ }
        notifyPortal(req, entry.submittedBy, { type: "reverted", title: "Submission Reverted" });
      }
    }

    const populated = await DataSLF.find({ _id: { $in: updated.map((entry) => entry._id) } }).populate("slfGenerator");
    refreshAdmin(req, "submissions");
    writeLog("info", "submission.bulk-revert", {
      message: `Bulk reverted ${updated.length} submissions`,
      user: performedBy || getRequestActor(req),
      ip: req.ip,
      meta: { reason: reason.trim(), ids: updated.map((entry) => entry.idNo) },
    });
    res.json({ message: `${updated.length} entries reverted`, data: populated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Repair XX province codes in existing idNo values
// Derives correct province from companyProvince (PSGC code) or companyType-scoped lookup
router.post("/repair-xx-ids", async (req, res) => {
  try {
    const PSGC_MAP = DataSLF.PSGC_PROVINCE_CODES || {};
    const SlfFacility = require("../models/SlfFacility");

    // Province name → abbreviation (same as DataSLF.js)
    const PROVINCE_NAME_MAP = {
      aurora: "AU", bataan: "BA", bulacan: "BU",
      "nueva ecija": "NE", nueva_ecija: "NE",
      pampanga: "PA", tarlac: "TA", zambales: "ZA",
    };
    const getProvCode = (name) => {
      if (!name) return null;
      const key = name.toLowerCase().replace(/^province of\s+/i, "").trim();
      return PROVINCE_NAME_MAP[key] || null;
    };

    // Fetch all records that have an XX province code in idNo
    const xxDocs = await DataSLF.find({ idNo: /^SLF-\w+-XX-/ })
      .setOptions({ includeHiddenYears: true })
      .lean();

    if (xxDocs.length === 0) {
      return res.json({ message: "No XX records found.", updated: 0 });
    }

    let updated = 0;
    const errors = [];
    const sequenceCache = new Map();
    const assignedIds = new Set();

    const getSequenceKey = (typeCode, provCode) => `${typeCode}-${provCode}`;
    const getMaxSequence = async (typeCode, provCode) => {
      const key = getSequenceKey(typeCode, provCode);
      if (sequenceCache.has(key)) return sequenceCache.get(key);

      const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-(\\d{4,})(?:\\D.*)?$`);
      const docs = await DataSLF.find({ idNo: pattern })
        .setOptions({ includeHiddenYears: true })
        .select("idNo")
        .lean();
      const maxSeq = docs.reduce((max, item) => {
        const match = String(item.idNo || "").match(pattern);
        const seq = match ? Number(match[1]) : 0;
        return Number.isFinite(seq) && seq > max ? seq : max;
      }, 0);
      sequenceCache.set(key, maxSeq);
      return maxSeq;
    };

    const getNextIdNo = async (typeCode, provCode) => {
      const key = getSequenceKey(typeCode, provCode);
      let seq = await getMaxSequence(typeCode, provCode);
      let candidate;
      do {
        seq += 1;
        candidate = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
      } while (
        assignedIds.has(candidate) ||
        (await DataSLF.exists({ idNo: candidate }).setOptions({ includeHiddenYears: true }))
      );
      sequenceCache.set(key, seq);
      assignedIds.add(candidate);
      return candidate;
    };

    for (const doc of xxDocs) {
      try {
        let provCode = null;

        // 1. Try facility province
        if (doc.slfGenerator) {
          const facility = await SlfFacility.findById(doc.slfGenerator).select("province").lean();
          if (facility?.province) provCode = getProvCode(facility.province);
        }

        // 2. Try companyProvince PSGC code
        if (!provCode && doc.companyProvince) {
          provCode = PSGC_MAP[doc.companyProvince] || null;
        }

        // 3. Try another approved doc for the same SLF
        if (!provCode) {
          const filter = doc.slfGenerator
            ? { slfGenerator: doc.slfGenerator, idNo: { $exists: true, $not: /XX/ } }
            : doc.slfName
            ? { slfName: doc.slfName, idNo: { $exists: true, $not: /XX/ } }
            : null;
          if (filter) {
            const sibling = await DataSLF.findOne(filter)
              .setOptions({ includeHiddenYears: true })
              .sort({ createdAt: -1 })
              .lean();
            if (sibling?.idNo) {
              const parts = sibling.idNo.split("-");
              if (parts.length >= 4 && parts[2] !== "XX") provCode = parts[2];
            }
          }
        }

        if (!provCode) continue; // skip if still unknown

        const oldIdNo = doc.idNo;
        const parts = oldIdNo.split("-"); // ["SLF", typeCode, "XX", seq]
        if (parts.length < 4) continue;
        const typeCode = parts[1];
        const finalIdNo = await getNextIdNo(typeCode, provCode);

        const submissionId = doc.submissionId || doc._id.toString();
        await DataSLF.updateOne(
          { _id: doc._id },
          {
            $set: { idNo: finalIdNo, submissionId },
            $addToSet: { previousIdNos: oldIdNo },
          }
        );
        await Transaction.updateMany(
          {
            $or: [
              { dataEntry: doc._id },
              { submissionId: oldIdNo },
              { submissionId: doc._id.toString() },
              { "meta.idNo": oldIdNo },
              { "meta.ids": oldIdNo },
            ],
          },
          {
            $set: {
              dataEntry: doc._id,
              submissionId,
              "meta.idNo": finalIdNo,
            },
            $addToSet: { "meta.previousIdNos": oldIdNo },
          }
        );
        await Transaction.create({
          submissionId,
          dataEntry: doc._id,
          companyName: doc.lguCompanyName,
          companyType: doc.companyType,
          submittedBy: doc.submittedBy,
          type: "admin_edit",
          description: `Fixed province code ID from ${oldIdNo} to ${finalIdNo}`,
          performedBy: getRequestActor(req),
          meta: { idNo: finalIdNo, previousIdNo: oldIdNo, repairXX: true },
        });
        updated++;
      } catch (err) {
        errors.push({ id: doc._id, error: err.message });
      }
    }

    writeLog("warn", "id.repair-xx", {
      message: `Repaired ${updated} XX province code records`,
      user: getRequestActor(req),
      meta: { total: xxDocs.length, updated, errors: errors.length },
    });

    res.json({
      message: `Repaired ${updated} of ${xxDocs.length} XX records.`,
      updated,
      skipped: xxDocs.length - updated - errors.length,
      errors,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Repair existing ID No. TYPE segment mismatches (PVT vs LGU).
// Developer-only. Uses the SLF facility OWNERSHIP together with province and the
// SLF name as a strict identity condition so records are only re-typed when the
// correct facility is confidently matched.
router.post("/repair-type-ids", authMiddleware, developerOnly, async (req, res) => {
  try {
    const typeCodeForCompanyType = (companyType) => {
      const value = String(companyType || "").trim().toLowerCase();
      if (value === "private" || value === "pvt") return "PVT";
      if (value === "lgu") return "LGU";
      return null;
    };
    // Derive the PVT/LGU type from a facility's ownership classification.
    const typeCodeForOwnership = (ownership) => {
      const o = String(ownership || "").toLowerCase();
      if (!o) return null;
      if (/private|pvt|corporat|company/.test(o)) return "PVT";
      if (/lgu|government|gov't|govt|public|municipal|city|provincial|barangay/.test(o))
        return "LGU";
      return null;
    };

    // Load all facilities once and index by normalized SLF name (latest year wins).
    const facilities = await SlfFacility.find({ deletedAt: null })
      .select("lgu province ownership dataYear")
      .lean();
    const facilityById = new Map();
    const facilityByName = new Map();
    facilities.forEach((f) => {
      facilityById.set(String(f._id), f);
      getNameVariants(f.lgu).forEach((variant) => {
        const key = normalizeSlfName(variant);
        if (!key) return;
        const prev = facilityByName.get(key);
        if (!prev || (f.dataYear || 0) > (prev.dataYear || 0))
          facilityByName.set(key, f);
      });
    });

    // Strictly resolve the facility for a submission using slfGenerator, then a
    // name match validated against the submission's province.
    const resolveFacility = (doc) => {
      if (doc.slfGenerator && facilityById.has(String(doc.slfGenerator)))
        return facilityById.get(String(doc.slfGenerator));
      const nameKeys = getNameVariants(doc.slfName).map(normalizeSlfName).filter(Boolean);
      for (const key of nameKeys) {
        const f = facilityByName.get(key);
        if (!f) continue;
        // Province must agree when both are known (strict condition).
        const docProv = doc.companyProvince
          ? getProvinceCode(doc.companyProvince)
          : null;
        const facProv = f.province ? getProvinceCode(f.province) : null;
        if (docProv && facProv && docProv !== facProv) continue;
        return f;
      }
      return null;
    };

    const docs = await DataSLF.find({ idNo: /^SLF-(PVT|LGU)-/ })
      .setOptions({ includeHiddenYears: true })
      .lean();

    let updated = 0;
    let skipped = 0;
    const errors = [];
    const sequenceCache = new Map();
    const assignedIds = new Set();

    const getNextIdNo = async (typeCode, provCode) => {
      const key = `${typeCode}-${provCode}`;
      let seq = sequenceCache.get(key);
      if (seq == null) {
        const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-(\\d{4,})`);
        const existing = await DataSLF.find({ idNo: pattern })
          .setOptions({ includeHiddenYears: true })
          .select("idNo")
          .lean();
        seq = existing.reduce((max, item) => {
          const match = String(item.idNo || "").match(pattern);
          const n = match ? Number(match[1]) : 0;
          return n > max ? n : max;
        }, 0);
      }
      let candidate;
      do {
        seq += 1;
        candidate = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
      } while (
        assignedIds.has(candidate) ||
        (await DataSLF.exists({ idNo: candidate }).setOptions({ includeHiddenYears: true }))
      );
      sequenceCache.set(key, seq);
      assignedIds.add(candidate);
      return candidate;
    };

    for (const doc of docs) {
      try {
        const parts = String(doc.idNo).split("-");
        if (parts.length < 4 || parts[0] !== "SLF") continue;
        const currentType = parts[1];
        const provCode = parts[2];

        // Strict identity: require a confidently-matched facility (slfGenerator
        // or name+province) so we never re-type the wrong SLF's records.
        const facility = resolveFacility(doc);
        if (!facility) {
          skipped++;
          continue;
        }

        // The submission's companyType drives the type; fall back to the
        // facility ownership when companyType is missing/ambiguous.
        const desiredType =
          typeCodeForCompanyType(doc.companyType) ||
          typeCodeForOwnership(facility.ownership);
        if (!desiredType || desiredType === currentType) {
          if (!desiredType) skipped++;
          continue;
        }

        const oldIdNo = doc.idNo;
        const finalIdNo = await getNextIdNo(desiredType, provCode);
        await DataSLF.updateOne(
          { _id: doc._id },
          {
            $set: { idNo: finalIdNo },
            $addToSet: { previousIdNos: oldIdNo },
          },
        );
        await Transaction.updateMany(
          {
            $or: [
              { dataEntry: doc._id },
              { "meta.idNo": oldIdNo },
              { "meta.ids": oldIdNo },
            ],
          },
          {
            $set: { "meta.idNo": finalIdNo },
            $addToSet: { "meta.previousIdNos": oldIdNo },
          },
        );
        await Transaction.create({
          submissionId: doc.submissionId || doc._id.toString(),
          dataEntry: doc._id,
          companyName: doc.lguCompanyName,
          companyType: doc.companyType,
          submittedBy: doc.submittedBy,
          type: "admin_edit",
          description: `Fixed ID No. type from ${oldIdNo} to ${finalIdNo} (${currentType}→${desiredType}; ownership: ${facility.ownership || "n/a"})`,
          performedBy: getRequestActor(req),
          meta: { idNo: finalIdNo, previousIdNo: oldIdNo, repairType: true, ownership: facility.ownership || "" },
        });
        updated++;
      } catch (err) {
        errors.push({ id: doc._id, error: err.message });
      }
    }

    writeLog("warn", "id.repair-type", {
      message: `Repaired ${updated} ID No. type mismatches (PVT/LGU)`,
      user: getRequestActor(req),
      meta: { total: docs.length, updated, skipped, errors: errors.length },
    });

    res.json({
      message: `Repaired ${updated} PVT/LGU ID No. mismatch(es).${skipped ? ` ${skipped} skipped (SLF could not be strictly identified by ownership/province/name).` : ""}`,
      updated,
      skipped,
      errors,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete entry
router.delete("/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    // Log deletion transaction before removing
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "deleted",
        description: `Entry ${entry.idNo} deleted`,
        performedBy: getRequestActor(req),
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    entry.deletedAt = new Date();
    entry.deletedBy = getRequestActor(req, "admin");
    await entry.save();
    res.json({ message: "Entry moved to trash" });
    writeLog("warn", "submission.delete", { message: `Submission soft-deleted: ${req.params.id}`, user: getRequestActor(req, "admin"), ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Deleted Submissions Management ──

// Get all soft-deleted submissions
router.get("/trash/list", async (req, res) => {
  try {
    const entries = await DataSLF.find({ deletedAt: { $ne: null } })
      .setOptions({ includeHiddenYears: true })
      .populate("slfGenerator")
      .sort({ deletedAt: -1 });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Restore a soft-deleted submission
router.patch("/:id/restore", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id).setOptions({ includeHiddenYears: true });
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.deletedAt) return res.status(400).json({ message: "Entry is not deleted" });
    entry.deletedAt = null;
    entry.deletedBy = null;
    await entry.save();
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "status_change",
        description: `Entry ${entry.idNo} restored from trash`,
        performedBy: getRequestActor(req, "admin"),
      });
    } catch { /* silent */ }
    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.restore", { message: `Submission restored: ${entry.idNo}`, user: getRequestActor(req, "admin"), ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Permanently delete a submission
router.delete("/:id/permanent", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id).setOptions({ includeHiddenYears: true });
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.deletedAt) return res.status(400).json({ message: "Entry must be soft-deleted first" });
    await DataSLF.findByIdAndDelete(req.params.id).setOptions({ includeHiddenYears: true });
    res.json({ message: "Entry permanently deleted" });
    writeLog("warn", "submission.permanent-delete", { message: `Submission permanently deleted: ${entry.idNo}`, user: getRequestActor(req, "admin"), ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Request revert (portal user requests edit on approved submission)
router.patch("/:id/request-revert", async (req, res) => {
  try {
    const { reason, requestedBy } = req.body || {};
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (entry.status !== "acknowledged") {
      return res.status(400).json({ message: "Only approved submissions can request a revert" });
    }

    entry.revertRequested = true;
    entry.revertReason = reason || "";
    entry.revertRequestedAt = new Date();
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "revert_requested",
        description: `Revert requested for ${entry.idNo}: ${reason || "No reason provided"}`,
        performedBy: requestedBy || entry.submittedBy || "portal",
        meta: { reason, idNo: entry.idNo },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.revert-request", {
      message: `Revert requested for ${entry.idNo}`,
      user: requestedBy || entry.submittedBy || "portal",
      ip: req.ip,
      meta: { id: entry._id, reason },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin-initiated revert (admin sends submission back to portal user for correction)
router.patch("/:id/admin-revert", async (req, res) => {
  try {
    const { reason, performedBy, sendFollowUp, followUpSubject, followUpMessage, temporaryDeleteAfterDays = 3 } = req.body || {};
    if (!reason) return res.status(400).json({ message: "Reason is required" });

    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    entry.status = "reverted";
    entry.revertReason = reason;
    entry.revertedBy = performedBy || getRequestActor(req);
    entry.revertedAt = new Date();
    if (sendFollowUp) {
      const days = Math.max(1, Number(temporaryDeleteAfterDays) || 3);
      entry.revertFollowUpSubject = followUpSubject || "Follow-Up Required: Reverted SLF Submission";
      entry.revertFollowUpMessage = followUpMessage || "Please update and resubmit your reverted SLF submission.";
      entry.revertFollowUpSentAt = new Date();
      entry.temporaryDeleteAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "status_change",
        description: `Admin reverted submission ${entry.idNo}: ${reason}`,
        performedBy: performedBy || getRequestActor(req),
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);

    // Notify portal user of revert
    if (entry.submittedBy) {
      try {
        const UserPortal = require("../models/UserPortal");
        const portalUser = await UserPortal.findOne({ email: entry.submittedBy });
        if (portalUser) {
          await Notification.create({
            recipient: portalUser._id.toString(),
            type: "reverted",
            title: "Submission Reverted",
            message: `Your submission ${entry.idNo} (${entry.lguCompanyName || ""}) has been reverted. Reason: ${reason}`,
            submissionId: entry.submissionId,
            dataEntry: entry._id,
            meta: { idNo: entry.idNo, reason, companyName: entry.lguCompanyName },
          });
        }
      } catch { /* silent */ }
      notifyPortal(req, entry.submittedBy, { type: "reverted", title: "Submission Reverted" });
    }
    refreshAdmin(req, "submissions");

    // Send revert notification email to portal user
    if (entry.submittedBy) {
      try {
        await sendSubmissionEmail(entry.submittedBy, {
          subject: "Submission Reverted",
          message: `Your submission ${entry.idNo} (${entry.lguCompanyName || ""}) has been reverted by the administrator.\n\nReason: ${reason}\n\nPlease log in to the portal to review the entry, make necessary corrections, and resubmit.`,
          submissionId: entry.submissionId,
          companyName: entry.lguCompanyName,
        });
      } catch (emailErr) {
        writeLog("warn", "submission.revert-email-failed", {
          message: `Failed to send revert email to ${entry.submittedBy}`,
          meta: { id: entry._id, error: emailErr.message },
        });
      }
    }

    if (sendFollowUp && entry.submittedBy) {
      try {
        const deadline = entry.temporaryDeleteAfter ? entry.temporaryDeleteAfter.toLocaleDateString("en-US") : "the deadline";
        const templateData = {
          "{{idNo}}": entry.idNo || entry.submissionId || "your submission",
          "{{companyName}}": entry.lguCompanyName || "your facility",
          "{{reason}}": reason,
          "{{deadline}}": deadline,
        };
        const renderTemplate = (text = "") => Object.entries(templateData).reduce((output, [token, value]) => output.split(token).join(value), text);
        await sendSubmissionEmail(entry.submittedBy, {
          subject: renderTemplate(entry.revertFollowUpSubject),
          message: renderTemplate(entry.revertFollowUpMessage),
          submissionId: entry.submissionId || entry.idNo,
          companyName: entry.lguCompanyName,
        });
        await Notification.create({
          recipient: "admin",
          type: "submission_revert_followup",
          title: "Revert Follow-Up Sent",
          message: `Follow-up email sent to ${entry.submittedBy} for ${entry.idNo}.`,
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          meta: { idNo: entry.idNo, submittedBy: entry.submittedBy, temporaryDeleteAfter: entry.temporaryDeleteAfter },
        });
        refreshAdmin(req, "notifications");
      } catch (emailErr) {
        writeLog("warn", "submission.revert-followup-email-failed", {
          message: `Failed to send revert follow-up email to ${entry.submittedBy}`,
          meta: { id: entry._id, error: emailErr.message },
        });
      }
    }

    writeLog("info", "submission.admin-revert", {
      message: `Admin reverted ${entry.idNo}: ${reason}`,
      user: performedBy || getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { id: entry._id, reason },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Approve revert (admin reverts submission to pending so portal user can edit)
router.patch("/:id/approve-revert", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.revertRequested) {
      return res.status(400).json({ message: "No revert has been requested for this entry" });
    }

    entry.status = "pending";
    entry.revertRequested = false;
    entry.revertReason = "";
    entry.revertRequestedAt = undefined;
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "revert_approved",
        description: `Revert approved for ${entry.idNo}, status set to pending`,
        performedBy: getRequestActor(req),
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.revert-approved", {
      message: `Revert approved for ${entry.idNo}`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { id: entry._id },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Send email to portal user regarding a submission
router.post("/:id/send-email", async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) {
      return res.status(400).json({ message: "Subject and message are required" });
    }
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.submittedBy) {
      return res.status(400).json({ message: "No email address found for this submission" });
    }

    await sendSubmissionEmail(entry.submittedBy, {
      subject,
      message,
      submissionId: entry.submissionId || entry.idNo,
      companyName: entry.lguCompanyName,
    });

    // Log transaction
    await Transaction.create({
      submissionId: entry.submissionId,
      dataEntry: entry._id,
      companyName: entry.lguCompanyName,
      submittedBy: entry.submittedBy,
      type: "email_ack_sent",
      description: `Email sent to ${entry.submittedBy}: ${subject}`,
      performedBy: getRequestActor(req, "admin"),
      meta: { email: entry.submittedBy, subject },
    });

    writeLog("info", "submission.email-sent", {
      message: `Email sent to ${entry.submittedBy} for ${entry.idNo}: ${subject}`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
    });

    res.json({ message: "Email sent successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal user saves updated baseline data (after admin approval OR initial baseline save) — re-locks the record
router.patch("/portal-save-baseline/:slfName", async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName);
    const {
      submittedBy,
      slfGenerator,
      lguCompanyName,
      companyType,
      address,
      companyRegion,
      companyProvince,
      companyMunicipality,
      companyBarangay,
      baselineUnit,
      totalVolumeAccepted, totalVolumeAcceptedUnit,
      activeCellResidualVolume, activeCellResidualUnit,
      activeCellInertVolume, activeCellInertUnit,
      activeCellHazardousVolume, activeCellHazardousUnit,
      closedCellResidualVolume, closedCellResidualUnit,
      closedCellInertVolume, closedCellInertUnit,
      closedCellHazardousVolume, closedCellHazardousUnit,
      activeCellEntries, closedCellEntries,
      accreditedHaulers,
      acceptsHazardousWaste,
    } = req.body || {};

    if (!slfName) return res.status(400).json({ message: "slfName is required" });
    await ensurePortalAccountCanSubmit(submittedBy);

    let genId = slfGenerator || null;
    let facilityLgu = lguCompanyName || slfName;
    let facilityType = companyType || "LGU";

    if (!genId) {
      const exactSlfName = new RegExp(`^${escapeRegExp(slfName)}$`, "i");
      const exactCompanyName = lguCompanyName
        ? new RegExp(`^${escapeRegExp(lguCompanyName)}$`, "i")
        : null;
      const facility = await SlfFacility.findOne({
        $or: [
          { lgu: exactSlfName },
          ...(exactCompanyName ? [{ lgu: exactCompanyName }] : []),
        ],
      }).sort({ dataYear: -1 });
      if (facility) {
        genId = facility._id;
        facilityLgu = lguCompanyName || facility.lgu || slfName;
        facilityType = companyType || ((facility.ownership || "").toLowerCase().includes("private") ? "Private" : "LGU");
      }
    }

    const baselineOnlyIds = await findMatchingBaselineOnlyIds({
      slfName,
      slfGenerator: genId,
      lguCompanyName,
    });

    const updateFields = {
      slfName,
      ...(genId ? { slfGenerator: genId } : {}),
      baselineUpdateApproved: false,
      baselineUpdateRequested: false,
      baselineUpdateApprovedAt: null,
    };

    const fieldMap = {
      baselineUnit,
      lguCompanyName,
      companyType,
      address,
      companyRegion,
      companyProvince,
      companyMunicipality,
      companyBarangay,
      totalVolumeAccepted, totalVolumeAcceptedUnit,
      activeCellResidualVolume, activeCellResidualUnit,
      activeCellInertVolume, activeCellInertUnit,
      activeCellHazardousVolume, activeCellHazardousUnit,
      closedCellResidualVolume, closedCellResidualUnit,
      closedCellInertVolume, closedCellInertUnit,
      closedCellHazardousVolume, closedCellHazardousUnit,
      activeCellEntries, closedCellEntries,
      accreditedHaulers: accreditedHaulers
        ? sanitizeAccreditedHaulers(accreditedHaulers, baselineUnit || totalVolumeAcceptedUnit || "m³")
        : accreditedHaulers,
      acceptsHazardousWaste,
    };
    for (const [k, v] of Object.entries(fieldMap)) {
      if (v !== undefined) updateFields[k] = v;
    }

    const updateResult = baselineOnlyIds.length > 0
      ? await DataSLF.updateMany({ _id: { $in: baselineOnlyIds } }, { $set: updateFields })
      : { matchedCount: 0 };

    // If no existing records exist for this SLF, create a baseline-only record
    if (updateResult.matchedCount === 0) {
      const provCode = getProvinceCode("");
      const typeCode = facilityType === "Private" ? "PVT" : "LGU";
      const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-`);
      const lastDoc = await DataSLF.findOne({ idNo: pattern }).sort({ idNo: -1 });
      let seq = 1;
      if (lastDoc?.idNo) {
        const parts = lastDoc.idNo.split("-");
        const lastNum = parseInt(parts[3], 10);
        if (!isNaN(lastNum)) seq = lastNum + 1;
      }

      const newDoc = new DataSLF({
        ...updateFields,
        slfGenerator: genId,
        slfName,
        lguCompanyName: facilityLgu,
        companyType: facilityType,
        address,
        companyRegion,
        companyProvince,
        companyMunicipality,
        companyBarangay,
        dateOfDisposal: new Date(),
        submittedBy: submittedBy || slfName,
        idNo: `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`,
        status: "pending",
      });
      await newDoc.save();
    }

    const latest = baselineOnlyIds.length > 0
      ? await DataSLF.findOne({ _id: { $in: baselineOnlyIds } })
          .setOptions({ includeHiddenYears: true })
          .sort({ updatedAt: -1, createdAt: -1 })
      : await DataSLF.findOne({
          $and: [
            { $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }] },
            ...(genId && mongoose.Types.ObjectId.isValid(String(genId))
              ? [{ slfGenerator: genId }]
              : [{ slfName }]),
          ],
        })
          .setOptions({ includeHiddenYears: true })
          .sort({ updatedAt: -1, createdAt: -1 });

    // Log transaction
    await Transaction.create({
      dataEntry: latest?._id,
      submissionId: latest?.submissionId,
      companyName: slfName,
      submittedBy: submittedBy || slfName,
      type: "baseline_update",
      description: `Portal user saved updated baseline data for ${slfName}`,
      performedBy: submittedBy || slfName,
      meta: { slfName },
    });

    writeLog("info", "baseline.portal-save", {
      message: `Portal user saved baseline update for ${slfName}`,
      user: submittedBy || slfName,
      ip: req.ip,
    });

    try {
      await Notification.create({
        recipient: "admin",
        type: "baseline_update",
        title: "Baseline Data Updated",
        message: `${submittedBy || slfName} has saved updated baseline data for ${slfName}.`,
        submissionId: latest?.submissionId,
        dataEntry: latest?._id,
        meta: { slfName, submittedBy: submittedBy || slfName },
      });
    } catch { /* silent */ }

    // Notify admin of the update
    notifyAdmin(req, {
      type: "baseline_update",
      title: "Baseline Data Updated",
      message: `${submittedBy || slfName} has saved updated baseline data for ${slfName}.`,
    });
    refreshAdmin(req, "baselines");

    res.json({ message: "Baseline saved and locked" });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal user requests baseline field update — notifies admin
router.post("/baseline-update-request", async (req, res) => {
  try {
    const { slfName, requestedBy, fields, reason } = req.body || {};
    if (!slfName || !requestedBy) {
      return res.status(400).json({ message: "slfName and requestedBy are required" });
    }
    await ensurePortalAccountCanSubmit(requestedBy);

    // Upsert notification — update existing unread one instead of creating duplicates
    await Notification.findOneAndUpdate(
      { recipient: "admin", type: "baseline_update_request", "meta.slfName": slfName, read: false },
      {
        $set: {
          title: `Baseline Update Request — ${slfName}`,
          message: reason || `${requestedBy} is requesting to update baseline fields: ${(fields || []).join(", ")}`,
          meta: { slfName, requestedBy, fields, reason },
        },
        $setOnInsert: { recipient: "admin", type: "baseline_update_request" },
      },
      { upsert: true, returnDocument: "after", timestamps: true }
    );

    notifyAdmin(req, { type: "baseline_update_request", title: "Baseline Update Request", message: `${requestedBy} requested baseline update for ${slfName}` });
    refreshAdmin(req, "baselines");

    // Mark ALL baseline entries for this company as having a pending update request
    // updateMany ensures the aggregation picks up the flag regardless of which doc is $first
    const filter = {
      $or: [{ slfName }, { lguCompanyName: slfName }],
    };
    await DataSLF.updateMany(filter, {
      $set: {
        baselineUpdateRequested: true,
        baselineUpdateRequestedAt: new Date(),
        baselineUpdateRequestReason: reason || "",
        baselineUpdateApproved: false,
      },
    });
    const latestEntry = await DataSLF.findOne(filter).setOptions({ includeHiddenYears: true }).sort({ createdAt: -1 });

    // Log transaction
    await Transaction.create({
      companyName: slfName,
      submittedBy: requestedBy,
      submissionId: latestEntry?.submissionId || undefined,
      type: "baseline_update_request",
      description: `Baseline update request: ${(fields || []).join(", ")}`,
      performedBy: requestedBy,
      meta: { fields, reason },
    });

    writeLog("info", "baseline.update-request", {
      message: `Baseline update request from ${requestedBy} for ${slfName}`,
      ip: req.ip,
    });

    res.json({ message: "Request sent to admin" });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Get waste received breakdown by baseline clients and submitted client selections.
// Region 3 Central Luzon: PSGC region code starts with "03".
router.get("/waste-received-summary/:slfName", async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName);
    const { year, slfId } = req.query;
    const requestedNames = getNameVariants(slfName);
    const requestedRegexes = requestedNames.map((name) => new RegExp(`^${escapeRegExp(name)}$`, "i"));

    let facilities = [];
    if (slfId && mongoose.isValidObjectId(slfId)) {
      const selectedFacility = await SlfFacility.findOne({ _id: slfId, deletedAt: null })
        .select("_id lgu province")
        .lean();
      if (selectedFacility) facilities = [selectedFacility];
    }
    if (!facilities.length && requestedRegexes.length) {
      facilities = await SlfFacility.find({
        deletedAt: null,
        lgu: { $in: requestedRegexes },
      }).select("_id lgu province").lean();
    }
    if (!facilities.length && requestedRegexes.length) {
      facilities = await SlfFacility.find({
        deletedAt: null,
        province: { $in: requestedRegexes },
      }).select("_id lgu province").lean();
    }
    const facilityIds = facilities.map((facility) => facility._id);
    const facilityNameKeys = new Set(
      facilities
        .flatMap((facility) => getNameVariants(facility.lgu))
        .map((name) => normalizeSlfName(name))
        .filter(Boolean),
    );
    const selectedMunicipalityKeys = new Set(
      facilities
        .flatMap((facility) => getNameVariants(facility.lgu))
        .map((name) => normalizeSlfName(name))
        .filter(Boolean),
    );
    const identityNames = (slfId && facilities.length
      ? [
          ...facilities.flatMap((facility) => getNameVariants(facility.lgu)),
          ...requestedNames.filter((name) => facilityNameKeys.has(normalizeSlfName(name))),
        ]
      : [
          ...requestedNames,
          ...facilities.flatMap((facility) => getNameVariants(facility.lgu)),
        ]).filter(Boolean);
    const nameRegexes = [...new Set(identityNames)].map((name) => new RegExp(`^${escapeRegExp(name)}$`, "i"));

    const match = {
      $or: [
        ...nameRegexes.map((regex) => ({ slfName: regex })),
        ...(facilityIds.length ? [{ slfGenerator: { $in: facilityIds } }] : []),
      ],
      deletedAt: null,
      status: { $ne: "rejected" },
    };
    if (match.$or.length === 0) {
      match.slfName = { $regex: new RegExp(`^${escapeRegExp(slfName)}`, "i") };
      delete match.$or;
    }
    if (year) {
      const y = Number(year);
      match.dateOfDisposal = { $gte: new Date(`${y}-01-01`), $lte: new Date(`${y}-12-31`) };
    }

    const records = await DataSLF.find(match).select(
      "companyType companyRegion companyProvince companyMunicipality lguCompanyName trucks dateOfDisposal accreditedHaulers baselineUnit totalVolumeAccepted totalVolumeAcceptedUnit activeCellEntries activeCellResidualVolume activeCellResidualUnit activeCellInertVolume activeCellInertUnit activeCellHazardousVolume activeCellHazardousUnit closedCellEntries closedCellResidualVolume closedCellResidualUnit closedCellInertVolume closedCellInertUnit closedCellHazardousVolume closedCellHazardousUnit"
    ).lean();

    const summary = { lguR3: [], lguOutside: [], privateIndustry: [] };
    const baselineClientMap = new Map();
    const submissionClientMap = new Map();
    const baselineVolumeRows = [];
    const baselineTotals = { m3: 0, tons: 0 };

    const clientKey = (client) => [
      client.clientName || client.company || "—",
      client.clientType || client.companyType || "Private",
      client.region || client.companyRegion || "",
      client.province || client.companyProvince || "",
      client.municipality || "",
    ].join("|");
    const normalizeClient = (client, fallback = {}) => {
      if (!client) return null;
      if (typeof client === "string") {
        return {
          clientName: client,
          clientType: fallback.clientType || "Private",
          region: fallback.region || "",
          regionName: fallback.regionName || "",
          province: fallback.province || "",
          provinceName: fallback.provinceName || "",
          municipality: fallback.municipality || "",
          municipalityName: fallback.municipalityName || "",
        };
      }
      return {
        clientName: client.clientName || client.company || client.lguCompanyName || fallback.clientName || "—",
        clientType: client.clientType || client.companyType || fallback.clientType || "Private",
        region: client.region || client.companyRegion || fallback.region || "",
        regionName: client.regionName || client.companyRegionName || fallback.regionName || "",
        province: client.province || client.companyProvince || fallback.province || "",
        provinceName: client.provinceName || client.companyProvinceName || fallback.provinceName || "",
        municipality: client.municipality || client.companyMunicipality || fallback.municipality || "",
        municipalityName: client.municipalityName || client.companyMunicipalityName || fallback.municipalityName || "",
      };
    };
    const getClientMunicipalityKeys = (client = {}) => [
      client.municipalityName,
      /^\d+$/.test(String(client.municipality || "")) ? "" : client.municipality,
    ]
      .flatMap((value) => getNameVariants(value))
      .map((value) => normalizeSlfName(value))
      .filter(Boolean);
    const clientMatchesSelectedMunicipality = (client) => {
      if (!selectedMunicipalityKeys.size) return true;
      const keys = getClientMunicipalityKeys(client);
      if (!keys.length) return true;
      return keys.some((key) => selectedMunicipalityKeys.has(key));
    };
    const addClient = (map, client, volume = 0, unit = "m³", truckCount = 0, options = {}) => {
      const normalized = normalizeClient(client);
      if (!normalized?.clientName) return;
      if (options.filterMunicipality && !clientMatchesSelectedMunicipality(normalized)) return;
      const key = clientKey(normalized);
      if (!map.has(key)) {
        map.set(key, { ...normalized, totalM3: 0, totalTons: 0, entries: 0, truckCount: 0 });
      }
      const row = map.get(key);
      const normalizedUnit = String(unit || "m³").replace("m3", "m³");
      if (normalizedUnit === "tons") row.totalTons += Number(volume || 0);
      else row.totalM3 += Number(volume || 0);
      if (volume || truckCount) row.entries += 1;
      row.truckCount += truckCount;
    };

    const addBaselineVolume = (label, volume = 0, unit = "m³", wasteType = "Residual") => {
      const amount = Number(volume || 0);
      if (amount <= 0) return;
      const normalizedUnit = String(unit || "m³").replace("m3", "m³");
      const row = {
        clientName: label || "Baseline Utilization",
        clientType: "Baseline",
        wasteType,
        totalM3: normalizedUnit === "tons" ? 0 : amount,
        totalTons: normalizedUnit === "tons" ? amount : 0,
        entries: 1,
        truckCount: 0,
      };
      baselineVolumeRows.push(row);
      if (normalizedUnit === "tons") baselineTotals.tons += amount;
      else baselineTotals.m3 += amount;
    };

    const baseline = chooseBaselineRecord(records.filter(hasBaselineData));
    if (baseline?.activeCellEntries?.length) {
      baseline.activeCellEntries.forEach((entry, index) => {
        addBaselineVolume(
          entry.cellName || `Active Cell ${index + 1}`,
          entry.volume,
          entry.unit || baseline.baselineUnit || baseline.activeCellResidualUnit || "m³",
          entry.wasteType || "Residual",
        );
      });
    } else if (baseline) {
      [
        { label: "Active Cell - Residual", value: baseline.activeCellResidualVolume, unit: baseline.activeCellResidualUnit, wasteType: "Residual" },
        { label: "Active Cell - Inert", value: baseline.activeCellInertVolume, unit: baseline.activeCellInertUnit, wasteType: "Inert/Hazardous Waste" },
        { label: "Active Cell - Hazardous", value: baseline.activeCellHazardousVolume, unit: baseline.activeCellHazardousUnit, wasteType: "Hazardous Waste" },
      ].forEach((entry) => addBaselineVolume(entry.label, entry.value, entry.unit || baseline.baselineUnit || "m³", entry.wasteType));
    }

    for (const r of records) {
      (r.accreditedHaulers || []).forEach((hauler) => {
        const clients = [
          ...(Array.isArray(hauler.privateSectorClients) ? hauler.privateSectorClients : hauler.privateSectorClients ? [hauler.privateSectorClients] : []),
          ...(Array.isArray(hauler.clients) ? hauler.clients : []),
        ];
        clients.forEach((client) => addClient(baselineClientMap, client));
      });

      const totalVol = (r.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
      const isR3 = (r.companyRegion || "").startsWith("03");
      const item = {
        company: r.lguCompanyName || "—",
        region: r.companyRegion || "",
        totalVolume: totalVol,
        date: r.dateOfDisposal,
        entries: r.trucks?.length || 0,
      };
      if (r.companyType === "LGU") {
        if (isR3) summary.lguR3.push(item);
        else summary.lguOutside.push(item);
      } else {
        summary.privateIndustry.push(item);
      }

      (r.trucks || []).forEach((truck) => {
        const vehicleClients = (truck.vehicles || []).flatMap((vehicle) =>
          Array.isArray(vehicle.selectedClients) ? vehicle.selectedClients : [],
        );
        const clients = Array.isArray(truck.selectedClients) && truck.selectedClients.length
          ? truck.selectedClients
          : vehicleClients.length
            ? vehicleClients
            : [{
                clientName: truck.lguCompanyName || r.lguCompanyName || "—",
                clientType: truck.companyType || r.companyType || "Private",
                region: r.companyRegion || "",
                province: r.companyProvince || "",
                municipality: r.companyMunicipality || "",
              }];
        const splitVolume = Number(truck.actualVolume || 0) / Math.max(clients.length, 1);
        clients.forEach((client) => addClient(
          submissionClientMap,
          client,
          splitVolume,
          truck.actualVolumeUnit || r.baselineUnit || "m³",
          1 / Math.max(clients.length, 1),
          { filterMunicipality: true },
        ));
      });
    }

    // Aggregate duplicates per company
    const agg = (arr) => {
      const map = {};
      for (const i of arr) {
        if (!map[i.company]) map[i.company] = { company: i.company, region: i.region, totalVolume: 0, entries: 0 };
        map[i.company].totalVolume += i.totalVolume;
        map[i.company].entries += i.entries;
      }
      return Object.values(map).sort((a, b) => b.totalVolume - a.totalVolume);
    };

    const byClientVolume = (a, b) => (b.totalM3 + b.totalTons) - (a.totalM3 + a.totalTons);
    const baselineClients = Array.from(baselineClientMap.values()).sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)));
    const baselineRows = baselineClients.length ? [...baselineClients, ...baselineVolumeRows] : baselineVolumeRows;
    const submissionClients = Array.from(submissionClientMap.values()).sort(byClientVolume);

    res.json({
      lguR3: agg(summary.lguR3),
      lguOutside: agg(summary.lguOutside),
      privateIndustry: agg(summary.privateIndustry),
      baselineClients: baselineRows,
      baselineCellBreakdown: baselineVolumeRows,
      baselineTotals,
      submissionClients,
      clientBreakdown: submissionClients,
      totals: submissionClients.reduce((acc, row) => {
        acc.m3 += row.totalM3 || 0;
        acc.tons += row.totalTons || 0;
        acc.trucks += row.truckCount || 0;
        return acc;
      }, { m3: 0, tons: 0, trucks: 0 }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
