const express = require("express");
const Transaction = require("../models/Transaction");
const DataSLF = require("../models/DataSLF");

const router = express.Router();

// Backfill transactions from existing data-slf entries that have no transaction records
router.post("/seed", async (req, res) => {
  try {
    // Get all submission IDs that already have transactions
    const existing = await Transaction.distinct("submissionId");
    const entries = await DataSLF.find({
      submissionId: { $nin: existing },
    });

    if (entries.length === 0) {
      return res.json({ message: "No new entries to seed", seeded: 0 });
    }

    // Group entries by submissionId
    const groups = {};
    for (const e of entries) {
      const sid = e.submissionId || e._id.toString();
      if (!groups[sid]) groups[sid] = [];
      groups[sid].push(e);
    }

    const toInsert = [];
    for (const [sid, items] of Object.entries(groups)) {
      // Submission transaction
      toInsert.push({
        submissionId: sid,
        dataEntry: items[0]._id,
        companyName: items[0].lguCompanyName,
        companyType: items[0].companyType,
        submittedBy: items[0].submittedBy || "",
        type: "submission",
        description: `${items.length} entr${items.length === 1 ? "y" : "ies"} submitted by ${items[0].submittedBy || "unknown"}`,
        performedBy: items[0].submittedBy || "portal",
        meta: { entryCount: items.length, ids: items.map((e) => e.idNo) },
        createdAt: items[0].createdAt,
        updatedAt: items[0].createdAt,
      });

      // Email ack sent (if submittedBy exists, assume email was attempted)
      if (items[0].submittedBy) {
        toInsert.push({
          submissionId: sid,
          companyName: items[0].lguCompanyName,
          submittedBy: items[0].submittedBy,
          type: "email_ack_sent",
          description: `Acknowledgement email sent to ${items[0].submittedBy}`,
          performedBy: "system",
          meta: { email: items[0].submittedBy },
          createdAt: new Date(items[0].createdAt.getTime() + 2000),
          updatedAt: new Date(items[0].createdAt.getTime() + 2000),
        });
      }

      // Status change if not pending
      for (const e of items) {
        if (e.status && e.status !== "pending") {
          toInsert.push({
            submissionId: sid,
            dataEntry: e._id,
            companyName: e.lguCompanyName,
            companyType: e.companyType,
            submittedBy: e.submittedBy || "",
            type: "status_change",
            description: `Entry ${e.idNo} marked as ${e.status}`,
            performedBy: "admin",
            meta: { status: e.status, idNo: e.idNo },
            createdAt: e.updatedAt || e.createdAt,
            updatedAt: e.updatedAt || e.createdAt,
          });
        }
      }
    }

    await Transaction.insertMany(toInsert);
    res.json({ message: "Transactions seeded", seeded: toInsert.length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all transactions (paginated, filterable)
router.get("/", async (req, res) => {
  try {
    const { company, type, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (company) filter.companyName = company;
    if (type) filter.type = type;
    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { submissionId: { $regex: search, $options: "i" } },
        { submittedBy: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Transaction.countDocuments(filter),
    ]);

    res.json({ transactions, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get distinct company names for filter dropdown
router.get("/companies", async (req, res) => {
  try {
    const companies = await Transaction.distinct("companyName");
    res.json(companies.filter(Boolean).sort());
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get transaction thread for a specific submission
router.get("/thread/:submissionId", async (req, res) => {
  try {
    const transactions = await Transaction.find({
      submissionId: req.params.submissionId,
    }).sort({ createdAt: 1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
