const express = require("express");
const crypto = require("crypto");
const DataSLF = require("../models/DataSLF");
const SLFGenerator = require("../models/SLFGenerator");
const { sendAcknowledgementEmail, sendBulkAcknowledgeEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");
const Transaction = require("../models/Transaction");

const router = express.Router();

// Submit SLF data — batch (client portal)
router.post("/", async (req, res) => {
  try {
    const { entries, submittedBy } = req.body;
    const items = Array.isArray(entries) ? entries : [req.body];
    const submissionId = `SUB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const saved = [];
    for (const item of items) {
      const doc = new DataSLF({
        ...item,
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

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [submissions, generators, totalTrucks, byStatus, byCompanyType, wasteByType, monthlyData] =
      await Promise.all([
        DataSLF.countDocuments(),
        SLFGenerator.countDocuments(),
        DataSLF.aggregate([
          { $project: { count: { $size: { $ifNull: ["$trucks", []] } } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ]),
        DataSLF.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        DataSLF.aggregate([{ $group: { _id: "$companyType", count: { $sum: 1 } } }]),
        DataSLF.aggregate([
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

    const recentSubmissions = await DataSLF.find()
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

// Get all SLF data entries (admin)
router.get("/", async (req, res) => {
  try {
    const entries = await DataSLF.find()
      .populate("slfGenerator")
      .sort({ createdAt: -1 });
    res.json(entries);
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

    // Send acknowledgement email when admin acknowledges
    if (status === "acknowledged" && entry.submittedBy) {
      try {
        await sendAcknowledgementEmail(entry.submittedBy, {
          submissionId: entry.submissionId,
          totalEntries: 1,
          entries: [{
            idNo: entry.idNo,
            dateOfDisposal: entry.dateOfDisposal,
            lguCompanyName: entry.lguCompanyName,
            companyType: entry.companyType,
            trucks: entry.trucks,
          }],
        });
      } catch (emailErr) {
        console.error("Acknowledge email failed:", emailErr.message);
      }
    }

    writeLog("info", "submission.status", {
      message: `Submission ${entry.idNo} ${status}`,
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

    // Send bulk acknowledge email grouped by submittedBy
    if (status === "acknowledged") {
      const byEmail = {};
      for (const entry of updated) {
        if (!entry.submittedBy) continue;
        if (!byEmail[entry.submittedBy]) byEmail[entry.submittedBy] = [];
        byEmail[entry.submittedBy].push(entry);
      }
      for (const [email, entries] of Object.entries(byEmail)) {
        try {
          await sendBulkAcknowledgeEmail(email, {
            totalEntries: entries.length,
            entries: entries.map((e) => ({
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

    await DataSLF.findByIdAndDelete(req.params.id);
    res.json({ message: "Entry deleted" });
    writeLog("warn", "submission.delete", { message: `Submission deleted: ${req.params.id}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
