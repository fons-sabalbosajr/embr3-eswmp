const express = require("express");
const SLFGenerator = require("../models/SLFGenerator");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Create SLF facility
router.post("/", async (req, res) => {
  try {
    const entry = new SLFGenerator(req.body);
    await entry.save();
    res.status(201).json({ message: "SLF facility created", data: entry });
    writeLog("info", "slf.create", { message: `SLF created: ${entry.slfName}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all SLF facilities
router.get("/", async (req, res) => {
  try {
    const entries = await SLFGenerator.find().sort({ createdAt: -1 });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single SLF facility
router.get("/:id", async (req, res) => {
  try {
    const entry = await SLFGenerator.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Not found" });
    res.json(entry);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update SLF facility
router.put("/:id", async (req, res) => {
  try {
    const entry = await SLFGenerator.findByIdAndUpdate(req.params.id, req.body, {
      returnDocument: "after",
      runValidators: true,
    });
    if (!entry) return res.status(404).json({ message: "Not found" });
    res.json({ message: "SLF facility updated", data: entry });
    writeLog("info", "slf.update", { message: `SLF updated: ${entry.slfName}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete SLF facility
router.delete("/:id", async (req, res) => {
  try {
    const entry = await SLFGenerator.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ message: "Not found" });
    res.json({ message: "SLF facility deleted" });
    writeLog("warn", "slf.delete", { message: `SLF deleted: ${entry.slfName}`, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
