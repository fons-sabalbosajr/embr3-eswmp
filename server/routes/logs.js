const express = require("express");
const AppLog = require("../models/AppLog");
const { writeLog } = require("../utils/logger");

const router = express.Router();

router.post("/client-error", async (req, res) => {
  try {
    const {
      message = "Client error",
      source = "portal",
      user = "",
      path = "",
      stack = "",
      meta = {},
    } = req.body || {};
    await writeLog("error", `${source}.client-error`, {
      message,
      user,
      ip: req.ip,
      meta: {
        path,
        stack: stack ? String(stack).slice(0, 4000) : "",
        ...meta,
      },
    });
    res.json({ message: "Logged" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

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
