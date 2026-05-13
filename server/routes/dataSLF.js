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
const { notifyAdmin, notifyPortal, refreshAdmin } = require("../utils/socketEmit");

// Province code mapping (mirrors DataSLF model)
const PROVINCE_CODES = {
  aurora: "AU", bataan: "BA", bulacan: "BU",
  "nueva ecija": "NE", nueva_ecija: "NE",
  pampanga: "PA", tarlac: "TA", zambales: "ZA",
};
function getProvinceCode(province) {
  if (!province) return "XX";
  const key = province.toLowerCase().replace(/^province of\s+/i, "").trim();
  return PROVINCE_CODES[key] || province.substring(0, 2).toUpperCase();
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

// Submit SLF data — batch (client portal)
router.post("/", async (req, res) => {
  try {
    const { entries, submittedBy } = req.body || {};
    const items = Array.isArray(entries) ? entries : [req.body];
    const submissionId = `SUB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const saved = [];
    for (const item of items) {
      // Resolve slfGenerator from slfName if not set
      let genId = item.slfGenerator || null;
      if (!genId && item.slfName) {
        const gen = await SLFGenerator.findOne({ slfName: item.slfName });
        if (gen) genId = gen._id;
      }
      const doc = new DataSLF({
        ...item,
        slfGenerator: genId,
        submissionId,
        submittedBy: submittedBy || item.submittedBy || "",
      });
      await doc.save();
      saved.push(doc);
    }

    // Log submission transaction for each unique company
    const companies = [...new Set(saved.map((s) => s.lguCompanyName))];
    for (const company of companies) {
      const companyEntries = saved.filter((s) => s.lguCompanyName === company);
      try {
        await Transaction.create({
          submissionId,
          dataEntry: companyEntries[0]._id,
          companyName: company,
          companyType: companyEntries[0].companyType,
          submittedBy: submittedBy || "",
          type: "submission",
          description: `${companyEntries.length} entr${companyEntries.length === 1 ? "y" : "ies"} submitted by ${submittedBy || "unknown"}`,
          performedBy: submittedBy || "portal",
          meta: { entryCount: companyEntries.length, ids: companyEntries.map((e) => e.idNo) },
        });
      } catch { /* silent */ }
    }

    res.status(201).json({ message: "Data submitted successfully", data: saved });

    // Notify admins of new submission
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
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update & resubmit a reverted entry (portal user)
router.put("/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
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
        meta: { idNo: entry.idNo, comment: resubmitComment || undefined },
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
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get latest baseline info for an SLF (by assigned name) — portal
router.get("/baseline/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;

    let candidates = await DataSLF.find({
      $and: [
        { $or: [{ slfName }, { lguCompanyName: slfName }] },
        baselineDataMatch,
      ],
    })
      .setOptions({ includeHiddenYears: true })
      .sort({ createdAt: -1 })
      .lean();
    let latest = chooseBaselineRecord(candidates);

    if (!latest) {
      candidates = await DataSLF.find(baselineDataMatch)
        .setOptions({ includeHiddenYears: true })
        .sort({ createdAt: -1 })
        .lean();
      latest = chooseBaselineRecord(candidates.filter((item) => matchesBaselineName(item, slfName)));
    }

    if (!latest) return res.json(null);

    const baselineUnit = latest.baselineUnit || latest.totalVolumeAcceptedUnit || "m³";

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
      accreditedHaulers: latest.accreditedHaulers || [],
      baselineUpdateApproved: latest.baselineUpdateApproved || false,
      baselineUpdateRequested: latest.baselineUpdateRequested || false,
      savedAt: latest.updatedAt || latest.createdAt,
    });
  } catch (error) {
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
      performedBy: req.body.updatedBy || ADMIN_DISPLAY_NAME,
      meta: { entryId: entry._id, slfName: entry.slfName },
    });

    writeLog("info", "baseline.admin-update", {
      message: `Admin updated baseline for ${entry.slfName}`,
      user: req.body.updatedBy || ADMIN_DISPLAY_NAME,
      meta: { entryId: entry._id, slfName: entry.slfName },
    });

    res.json({ message: "Baseline updated", data: entry });
  } catch (error) {
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
      performedBy: ADMIN_DISPLAY_NAME,
      meta: { entryId: entry._id, slfName },
    });

    writeLog("warn", "baseline.admin-delete", {
      message: `Admin cleared baseline data for ${slfName}`,
      user: ADMIN_DISPLAY_NAME,
      meta: { entryId: entry._id, slfName },
    });

    res.json({ message: "Baseline data cleared" });
  } catch (error) {
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
        baselineUpdateApprovedBy: approvedBy || ADMIN_DISPLAY_NAME,
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
        performedBy: approvedBy || ADMIN_DISPLAY_NAME,
        meta: { slfName },
      });
    } catch { /* silent */ }

    writeLog("info", "baseline.update-approved", {
      message: `Baseline update approved for ${slfName}`,
      user: approvedBy || ADMIN_DISPLAY_NAME,
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
        performedBy: lockedBy || ADMIN_DISPLAY_NAME,
        meta: { slfName },
      });
    } catch { /* silent */ }

    writeLog("info", "baseline.locked", {
      message: `Baseline locked for ${slfName}`,
      user: lockedBy || ADMIN_DISPLAY_NAME,
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
        performedBy: rejectedBy || ADMIN_DISPLAY_NAME,
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
    entry.revertedBy = approvedBy || ADMIN_DISPLAY_NAME;
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
        performedBy: approvedBy || ADMIN_DISPLAY_NAME,
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
        performedBy: rejectedBy || ADMIN_DISPLAY_NAME,
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
    // Admin management view — respects App Settings year visibility filter
    const entries = await DataSLF.find({ deletedAt: null })
      .populate("slfGenerator")
      .sort({ createdAt: -1 })
      .lean();
    res.json(entries);
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
        performedBy: req.body.updatedBy || ADMIN_DISPLAY_NAME,
        meta: { idNo: entry.idNo, updatedFields },
      });
    } catch { /* silent */ }
    res.json(populated);
    writeLog("info", "submission.update", {
      message: `Submission ${entry.idNo} edited by admin`,
      user: req.logUser || req.body.updatedBy || ADMIN_DISPLAY_NAME,
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
        performedBy: ADMIN_DISPLAY_NAME,
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
      user: req.logUser || "admin",
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
          performedBy: ADMIN_DISPLAY_NAME,
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
      user: req.logUser || "admin",
      ip: req.ip,
      meta: { status, count: updated.length, ids: updated.map((e) => e.idNo) },
    });
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

        const parts = doc.idNo.split("-"); // ["SLF", typeCode, "XX", seq]
        if (parts.length < 4) continue;
        const typeCode = parts[1];
        const seq = parts[3];
        const newIdNo = `SLF-${typeCode}-${provCode}-${seq}`;

        // Avoid collisions — if a doc already has this exact idNo, keep a suffix
        const existing = await DataSLF.findOne({ _id: { $ne: doc._id }, idNo: newIdNo })
          .setOptions({ includeHiddenYears: true })
          .lean();
        const finalIdNo = existing ? `${newIdNo}-R` : newIdNo;

        await DataSLF.updateOne({ _id: doc._id }, { $set: { idNo: finalIdNo } });
        updated++;
      } catch (err) {
        errors.push({ id: doc._id, error: err.message });
      }
    }

    writeLog("warn", "id.repair-xx", {
      message: `Repaired ${updated} XX province code records`,
      user: ADMIN_DISPLAY_NAME,
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
        performedBy: ADMIN_DISPLAY_NAME,
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    entry.deletedAt = new Date();
    entry.deletedBy = req.logUser || "admin";
    await entry.save();
    res.json({ message: "Entry moved to trash" });
    writeLog("warn", "submission.delete", { message: `Submission soft-deleted: ${req.params.id}`, user: req.logUser || "admin", ip: req.ip });
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
        performedBy: req.logUser || "admin",
      });
    } catch { /* silent */ }
    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.restore", { message: `Submission restored: ${entry.idNo}`, user: req.logUser || "admin", ip: req.ip });
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
    writeLog("warn", "submission.permanent-delete", { message: `Submission permanently deleted: ${entry.idNo}`, user: req.logUser || "admin", ip: req.ip });
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
    const { reason, performedBy } = req.body || {};
    if (!reason) return res.status(400).json({ message: "Reason is required" });

    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    entry.status = "reverted";
    entry.revertReason = reason;
    entry.revertedBy = performedBy || ADMIN_DISPLAY_NAME;
    entry.revertedAt = new Date();
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
        performedBy: performedBy || ADMIN_DISPLAY_NAME,
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

    writeLog("info", "submission.admin-revert", {
      message: `Admin reverted ${entry.idNo}: ${reason}`,
      user: req.logUser || performedBy || "admin",
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
        performedBy: ADMIN_DISPLAY_NAME,
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.revert-approved", {
      message: `Revert approved for ${entry.idNo}`,
      user: req.logUser || "admin",
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
      performedBy: req.logUser || "admin",
      meta: { email: entry.submittedBy, subject },
    });

    writeLog("info", "submission.email-sent", {
      message: `Email sent to ${entry.submittedBy} for ${entry.idNo}: ${subject}`,
      user: req.logUser || "admin",
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

    // Broad filter — match any DataSLF entry for this SLF regardless of existing baseline data
    const filter = {
      $or: [{ slfName }, { lguCompanyName: slfName }],
    };
    const baselineOnlyFilter = {
      $and: [
        filter,
        { $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }] },
      ],
    };

    const updateFields = {
      slfName,
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
      accreditedHaulers,
      acceptsHazardousWaste,
    };
    for (const [k, v] of Object.entries(fieldMap)) {
      if (v !== undefined) updateFields[k] = v;
    }

    const updateResult = await DataSLF.updateMany(baselineOnlyFilter, { $set: updateFields });

    // If no existing records exist for this SLF, create a baseline-only record
    if (updateResult.matchedCount === 0) {
      // Resolve slfGenerator from SlfFacility if ID not provided
      let genId = slfGenerator || null;
      let facilityLgu = lguCompanyName || slfName;
      let facilityType = companyType || "LGU";

      if (!genId) {
        const facility = await SlfFacility.findOne({
          $or: [
            { lgu: { $regex: new RegExp(slfName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } },
          ],
        }).sort({ dataYear: -1 });
        if (facility) {
          genId = facility._id;
          facilityLgu = lguCompanyName || facility.lgu || slfName;
          facilityType = companyType || ((facility.ownership || "").toLowerCase().includes("private") ? "Private" : "LGU");
        }
      }

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

    const latest = await DataSLF.findOne(baselineOnlyFilter).setOptions({ includeHiddenYears: true }).sort({ createdAt: -1 });

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
    const addClient = (map, client, volume = 0, unit = "m³", truckCount = 0) => {
      const normalized = normalizeClient(client);
      if (!normalized?.clientName) return;
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
        const clients = Array.isArray(truck.selectedClients) && truck.selectedClients.length
          ? truck.selectedClients
          : [{
              clientName: truck.lguCompanyName || r.lguCompanyName || "—",
              clientType: truck.companyType || r.companyType || "Private",
              region: r.companyRegion || "",
              province: r.companyProvince || "",
              municipality: r.companyMunicipality || "",
            }];
        const splitVolume = Number(truck.actualVolume || 0) / Math.max(clients.length, 1);
        clients.forEach((client) => addClient(submissionClientMap, client, splitVolume, truck.actualVolumeUnit || r.baselineUnit || "m³", 1 / Math.max(clients.length, 1)));
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
