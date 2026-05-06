const express = require("express");
const crypto = require("crypto");
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

const router = express.Router();

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

    const latest = await DataSLF.findOne({
      $and: [
        { $or: [{ slfName }, { lguCompanyName: slfName }] },
        baselineDataMatch,
      ],
    })
      .setOptions({ includeHiddenYears: true })
      .sort({ createdAt: -1 });

    if (!latest) return res.json(null);

    const baselineUnit = latest.baselineUnit || latest.totalVolumeAcceptedUnit || "m³";

    res.json({
      baselineUnit,
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
      { $sort: { createdAt: -1 } },
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
      performedBy: req.body.updatedBy || "admin",
      meta: { entryId: entry._id, slfName: entry.slfName },
    });

    writeLog("info", "baseline.admin-update", {
      message: `Admin updated baseline for ${entry.slfName}`,
      user: req.body.updatedBy || "admin",
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
    await DataSLF.updateOne(
      { _id: entry._id },
      {
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
      }
    );

    await Transaction.create({
      dataEntry: entry._id,
      submissionId: entry.submissionId,
      companyName: slfName,
      submittedBy: entry.submittedBy,
      type: "baseline_delete",
      description: `Admin cleared baseline data for ${slfName}`,
      performedBy: "admin",
      meta: { entryId: entry._id, slfName },
    });

    writeLog("warn", "baseline.admin-delete", {
      message: `Admin cleared baseline data for ${slfName}`,
      user: "admin",
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
        baselineUpdateApprovedBy: approvedBy || "admin",
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
        performedBy: approvedBy || "admin",
        meta: { slfName },
      });
    } catch { /* silent */ }

    writeLog("info", "baseline.update-approved", {
      message: `Baseline update approved for ${slfName}`,
      user: approvedBy || "admin",
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
        performedBy: lockedBy || "admin",
        meta: { slfName },
      });
    } catch { /* silent */ }

    writeLog("info", "baseline.locked", {
      message: `Baseline locked for ${slfName}`,
      user: lockedBy || "admin",
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
        performedBy: rejectedBy || "admin",
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
    entry.revertedBy = approvedBy || "admin";
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
        performedBy: approvedBy || "admin",
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
        performedBy: rejectedBy || "admin",
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
      "acceptsHazardousWaste",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) entry[key] = req.body[key];
    }
    await entry.save();
    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.update", {
      message: `Submission ${entry.idNo} edited by admin`,
      user: req.logUser || "admin",
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
        performedBy: "admin",
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
          performedBy: "admin",
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
        performedBy: "admin",
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
    entry.revertedBy = performedBy || "admin";
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
        performedBy: performedBy || "admin",
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
        performedBy: "admin",
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

    const updateFields = {
      baselineUpdateApproved: false,
      baselineUpdateRequested: false,
      baselineUpdateApprovedAt: null,
    };

    const fieldMap = {
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
    };
    for (const [k, v] of Object.entries(fieldMap)) {
      if (v !== undefined) updateFields[k] = v;
    }

    const updateResult = await DataSLF.updateMany(filter, { $set: updateFields });

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
          facilityLgu = facility.lgu || lguCompanyName || slfName;
          facilityType = (facility.ownership || "").toLowerCase().includes("private") ? "Private" : "LGU";
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
        dateOfDisposal: new Date(),
        submittedBy: submittedBy || slfName,
        idNo: `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`,
        status: "pending",
      });
      await newDoc.save();
    }

    const latest = await DataSLF.findOne(filter).setOptions({ includeHiddenYears: true }).sort({ createdAt: -1 });

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
      { upsert: true, new: true, timestamps: true }
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

// Portal: Get waste received breakdown (LGU R3 / LGU outside R3 / Private) for dashboard
// Region 3 Central Luzon: PSGC region code starts with "03"
router.get("/waste-received-summary/:slfName", async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName);
    const { year } = req.query;
    const match = {
      slfName: { $regex: new RegExp(`^${slfName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") },
      deletedAt: null,
      status: { $ne: "rejected" },
    };
    if (year) {
      const y = Number(year);
      match.dateOfDisposal = { $gte: new Date(`${y}-01-01`), $lte: new Date(`${y}-12-31`) };
    }

    const records = await DataSLF.find(match).select(
      "companyType companyRegion lguCompanyName trucks dateOfDisposal"
    ).lean();

    const summary = { lguR3: [], lguOutside: [], privateIndustry: [] };

    for (const r of records) {
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

    res.json({
      lguR3: agg(summary.lguR3),
      lguOutside: agg(summary.lguOutside),
      privateIndustry: agg(summary.privateIndustry),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
