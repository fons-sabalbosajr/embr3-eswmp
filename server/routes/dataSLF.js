const express = require("express");
const crypto = require("crypto");
const DataSLF = require("../models/DataSLF");
const SLFGenerator = require("../models/SLFGenerator");
const SlfFacility = require("../models/SlfFacility");
const { sendAcknowledgementEmail, sendBulkAcknowledgeEmail, sendSubmissionEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");

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

// Submit SLF data — batch (client portal)
router.post("/", async (req, res) => {
  try {
    const { entries, submittedBy } = req.body;
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
      "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
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
      console.log("[idNo debug] slfGenerator:", entry.slfGenerator, "| facility:", facility ? { _id: facility._id, province: facility.province } : null);
      if (facility) province = facility.province;
    }
    const provCode = getProvinceCode(province);
    console.log("[idNo debug] province:", JSON.stringify(province), "| provCode:", provCode);
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

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
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
    const slfName = decodeURIComponent(req.params.slfName);

    const latest = await DataSLF.findOne({
      slfName,
      totalVolumeAccepted: { $ne: null },
    }).sort({ createdAt: -1 });

    if (!latest) return res.json(null);

    res.json({
      totalVolumeAccepted: latest.totalVolumeAccepted,
      totalVolumeAcceptedUnit: latest.totalVolumeAcceptedUnit,
      activeCellResidualVolume: latest.activeCellResidualVolume,
      activeCellResidualUnit: latest.activeCellResidualUnit,
      activeCellInertVolume: latest.activeCellInertVolume,
      activeCellInertUnit: latest.activeCellInertUnit,
      closedCellResidualVolume: latest.closedCellResidualVolume,
      closedCellResidualUnit: latest.closedCellResidualUnit,
      closedCellInertVolume: latest.closedCellInertVolume,
      closedCellInertUnit: latest.closedCellInertUnit,
      accreditedHaulers: latest.accreditedHaulers || [],
      savedAt: latest.createdAt,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get latest baseline info for ALL SLF generators — admin tab
router.get("/baselines", async (req, res) => {
  try {
    const generators = await SLFGenerator.find().sort({ slfName: 1 });
    const results = [];
    for (const gen of generators) {
      const latest = await DataSLF.findOne({
        slfGenerator: gen._id,
        totalVolumeAccepted: { $ne: null },
      }).sort({ createdAt: -1 });
      if (latest) {
        results.push({
          _id: gen._id,
          slfName: gen.slfName,
          isActive: gen.isActive,
          totalVolumeAccepted: latest.totalVolumeAccepted,
          totalVolumeAcceptedUnit: latest.totalVolumeAcceptedUnit || "m³",
          activeCellResidualVolume: latest.activeCellResidualVolume,
          activeCellResidualUnit: latest.activeCellResidualUnit || "m³",
          activeCellInertVolume: latest.activeCellInertVolume,
          activeCellInertUnit: latest.activeCellInertUnit || "m³",
          closedCellResidualVolume: latest.closedCellResidualVolume,
          closedCellResidualUnit: latest.closedCellResidualUnit || "m³",
          closedCellInertVolume: latest.closedCellInertVolume,
          closedCellInertUnit: latest.closedCellInertUnit || "m³",
          accreditedHaulers: latest.accreditedHaulers || [],
          submittedBy: latest.submittedBy,
          lastUpdated: latest.createdAt,
        });
      }
    }
    res.json(results);
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
      "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
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
    const { status } = req.body;
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
    }

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
    const { ids, status } = req.body;
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
    const entry = await DataSLF.findById(req.params.id);
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
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.deletedAt) return res.status(400).json({ message: "Entry must be soft-deleted first" });
    await DataSLF.findByIdAndDelete(req.params.id);
    res.json({ message: "Entry permanently deleted" });
    writeLog("warn", "submission.permanent-delete", { message: `Submission permanently deleted: ${entry.idNo}`, user: req.logUser || "admin", ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Request revert (portal user requests edit on approved submission)
router.patch("/:id/request-revert", async (req, res) => {
  try {
    const { reason, requestedBy } = req.body;
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
    const { reason, performedBy } = req.body;
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
    }

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
    const { subject, message } = req.body;
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

// Portal user requests baseline field update — notifies admin
router.post("/baseline-update-request", async (req, res) => {
  try {
    const { slfName, requestedBy, fields, reason } = req.body;
    if (!slfName || !requestedBy) {
      return res.status(400).json({ message: "slfName and requestedBy are required" });
    }

    // Create notification for admin
    await Notification.create({
      recipient: "admin",
      type: "baseline_update_request",
      title: `Baseline Update Request — ${slfName}`,
      message: reason || `${requestedBy} is requesting to update baseline fields: ${(fields || []).join(", ")}`,
      meta: { slfName, requestedBy, fields, reason },
    });

    // Log transaction
    await Transaction.create({
      companyName: slfName,
      submittedBy: requestedBy,
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

module.exports = router;
