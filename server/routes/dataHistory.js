const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const DataHistory = require("../models/DataHistory");
const { cacheJson, invalidateOnWrite } = require("../middleware/cacheRoute");
const { MODULE_STATS } = require("../utils/cacheKeys");

// ── Dashboard history cache ──
// GET /summary loads EVERY DataHistory document and groups them in JS on each
// call — a cost that grows with every yearly snapshot ever taken, repeated by the
// dashboard's 60s poll for data that only changes when someone takes a new
// snapshot. 5 minutes, and any write here (snapshot/delete) clears it at once.
const HISTORY_KEY = MODULE_STATS.dataHistory;
const HISTORY_TTL_MS = 300000;
router.use(invalidateOnWrite(HISTORY_KEY));

// GET /data-history — all historical records
router.get("/", authMiddleware, async (req, res) => {
  try {
    const { category, year } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (year) filter.year = Number(year);

    const records = await DataHistory.find(filter)
      .sort({ category: 1, year: 1 })
      .lean();
    res.json(records);
  } catch (err) {
    console.error("DataHistory GET error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /data-history/summary — aggregated year-over-year summary for dashboard
router.get("/summary", authMiddleware, cacheJson(() => `${HISTORY_KEY}:summary`, HISTORY_TTL_MS), async (req, res) => {
  try {
    const records = await DataHistory.find()
      .sort({ year: 1 })
      .lean();

    // Group by category, then by year
    const byCat = {};
    for (const r of records) {
      if (!byCat[r.category]) byCat[r.category] = [];
      byCat[r.category].push({
        year: r.year,
        totalRecords: r.totalRecords,
        byProvince: r.byProvince,
        byStatus: r.byStatus,
        additionalMetrics: r.additionalMetrics,
      });
    }

    res.json(byCat);
  } catch (err) {
    console.error("DataHistory summary error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /data-history/snapshot — create a snapshot from current system data
router.post("/snapshot", authMiddleware, async (req, res) => {
  try {
    const { year, category, totalRecords, byProvince, byStatus, additionalMetrics } = req.body;
    if (!year || !category) {
      return res.status(400).json({ error: "year and category are required" });
    }

    const record = await DataHistory.findOneAndUpdate(
      { year, category },
      {
        year,
        category,
        totalRecords: totalRecords || 0,
        byProvince: byProvince || [],
        byStatus: byStatus || [],
        additionalMetrics: additionalMetrics || {},
        source: "system",
      },
      { upsert: true, returnDocument: "after" }
    );

    res.json(record);
  } catch (err) {
    console.error("DataHistory snapshot error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
