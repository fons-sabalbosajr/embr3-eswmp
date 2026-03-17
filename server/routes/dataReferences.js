const express = require("express");
const DataReference = require("../models/DataReference");

const router = express.Router();

// Get all active references (for frontend dropdowns)
router.get("/", async (req, res) => {
  try {
    const refs = await DataReference.find({ isActive: true }).sort({
      module: 1,
      label: 1,
    });
    res.json(refs);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all references including inactive (admin)
router.get("/all", async (req, res) => {
  try {
    const refs = await DataReference.find().sort({ module: 1, label: 1 });
    res.json(refs);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get a single reference by category slug
router.get("/:category", async (req, res) => {
  try {
    const ref = await DataReference.findOne({ category: req.params.category });
    if (!ref) return res.status(404).json({ message: "Not found" });
    res.json(ref);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create a new reference category
router.post("/", async (req, res) => {
  try {
    const ref = new DataReference(req.body);
    await ref.save();
    res.status(201).json(ref);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "A reference with that category key already exists" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a reference
router.put("/:id", async (req, res) => {
  try {
    const ref = await DataReference.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!ref) return res.status(404).json({ message: "Not found" });
    res.json(ref);
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ message: "A reference with that category key already exists" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a reference
router.delete("/:id", async (req, res) => {
  try {
    const ref = await DataReference.findByIdAndDelete(req.params.id);
    if (!ref) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
