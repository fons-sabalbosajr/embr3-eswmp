const express = require("express");
const AppLog = require("../models/AppLog");

const router = express.Router();

// Get logs (paginated, filterable)
router.get("/", async (req, res) => {
  try {
    const { level, search, limit = 100, skip = 0 } = req.query;
    const filter = {};
    if (level && level !== "all") filter.level = level;
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { action: regex },
        { message: regex },
        { user: regex },
      ];
    }
    const [logs, total] = await Promise.all([
      AppLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(Number(skip))
        .limit(Number(limit)),
      AppLog.countDocuments(filter),
    ]);
    res.json({ logs, total });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Clear all logs
router.delete("/", async (_req, res) => {
  try {
    await AppLog.deleteMany({});
    res.json({ message: "All logs cleared" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
