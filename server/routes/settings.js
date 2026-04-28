const express = require("express");
const PortalField = require("../models/PortalField");
const AppSettings = require("../models/AppSettings");
const { clearYearVisibilityCache } = require("../utils/yearVisibility");

const router = express.Router();

// ── Portal Fields ──

// Get all active fields (for client portal)
router.get("/fields", async (req, res) => {
  try {
    const fields = await PortalField.find({ isActive: true }).sort({ order: 1 });
    res.json(fields);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all fields including inactive (admin)
router.get("/fields/all", async (req, res) => {
  try {
    const fields = await PortalField.find().sort({ order: 1 });
    res.json(fields);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Seed default portal fields (creates only if none exist)
router.post("/fields/seed", async (req, res) => {
  try {
    const count = await PortalField.countDocuments();
    if (count > 0) {
      return res.json({ message: "Fields already exist", seeded: false });
    }

    const defaults = [
      { fieldName: "Date of Disposal", fieldKey: "dateOfDisposal", fieldType: "date", section: "disposal-info", order: 1, required: true },
      { fieldName: "LGU/Company Name", fieldKey: "lguCompanyName", fieldType: "text", section: "company-info", order: 2, required: true },
      { fieldName: "Company Type", fieldKey: "companyType", fieldType: "select", section: "company-info", order: 3, required: true, options: ["LGU", "Private"] },
      { fieldName: "Address", fieldKey: "address", fieldType: "text", section: "company-info", order: 4, required: false },
      { fieldName: "Disposal/Trip Ticket No.", fieldKey: "disposalTicketNo", fieldType: "text", section: "transport-info", order: 5, required: false },
      { fieldName: "Hauler", fieldKey: "hauler", fieldType: "text", section: "transport-info", order: 6, required: true },
      { fieldName: "Plate Number", fieldKey: "plateNumber", fieldType: "text", section: "transport-info", order: 7, required: true },
      { fieldName: "Truck Capacity", fieldKey: "truckCapacity", fieldType: "number", section: "transport-info", order: 8, required: false },
      { fieldName: "Actual Waste Volume", fieldKey: "actualVolume", fieldType: "number", section: "transport-info", order: 9, required: true },
      { fieldName: "Waste Type", fieldKey: "wasteType", fieldType: "select", section: "transport-info", order: 10, required: true, options: ["Residual", "Hazardous Waste"] },
      { fieldName: "Hazardous Waste Code", fieldKey: "hazWasteCode", fieldType: "select", section: "hazwaste-codes", order: 11, required: false, options: ["D401", "D402", "D403", "D404", "D405", "D406", "D407", "D408", "D409", "F601", "F602", "F603", "F604", "I101", "I102", "I103", "I104", "I201", "J201", "K301", "K302", "K303", "M501", "M502", "M503", "M504"] },
    ];

    await PortalField.insertMany(defaults);
    res.status(201).json({ message: "Default fields seeded", seeded: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create field
router.post("/fields", async (req, res) => {
  try {
    const field = new PortalField(req.body);
    await field.save();
    res.status(201).json({ message: "Field created", data: field });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update field
router.put("/fields/:id", async (req, res) => {
  try {
    const field = await PortalField.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!field) return res.status(404).json({ message: "Field not found" });
    res.json({ message: "Field updated", data: field });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete field
router.delete("/fields/:id", async (req, res) => {
  try {
    await PortalField.findByIdAndDelete(req.params.id);
    res.json({ message: "Field deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── App Settings ──

// Get app settings
router.get("/app", async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) {
      settings = await AppSettings.create({});
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update app settings
router.put("/app", async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) {
      settings = new AppSettings(req.body);
    } else {
      // Handle dashboardTabs Map specially
      if (req.body.dashboardTabs) {
        if (!settings.dashboardTabs) settings.dashboardTabs = new Map();
        for (const [key, val] of Object.entries(req.body.dashboardTabs)) {
          settings.dashboardTabs.set(key, val);
        }
        delete req.body.dashboardTabs;
      }
      Object.assign(settings, req.body);
    }
    await settings.save();
    clearYearVisibilityCache();
    res.json({ message: "Settings updated", data: settings });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update org chart
router.put("/org-chart", async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = new AppSettings();
    settings.orgChart = req.body.orgChart || [];
    await settings.save();
    res.json({ message: "Org chart updated", data: settings.orgChart });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Philippine Address API Proxy (PSGC) — with 24-hour in-memory cache ──
const _psgcCache = new Map(); // key → { data, expiresAt }
const PSGC_TTL = 24 * 60 * 60 * 1000; // 24 hours
async function fetchPsgc(url) {
  const now = Date.now();
  const cached = _psgcCache.get(url);
  if (cached && cached.expiresAt > now) return cached.data;
  const resp = await fetch(url);
  const data = await resp.json();
  _psgcCache.set(url, { data, expiresAt: now + PSGC_TTL });
  return data;
}

router.get("/address/regions", async (_req, res) => {
  try {
    const data = await fetchPsgc("https://psgc.gitlab.io/api/regions/");
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch regions", error: error.message });
  }
});

router.get("/address/provinces/:regionCode", async (req, res) => {
  try {
    const data = await fetchPsgc(`https://psgc.gitlab.io/api/regions/${encodeURIComponent(req.params.regionCode)}/provinces/`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch provinces", error: error.message });
  }
});

router.get("/address/municipalities/:provinceCode", async (req, res) => {
  try {
    const data = await fetchPsgc(`https://psgc.gitlab.io/api/provinces/${encodeURIComponent(req.params.provinceCode)}/cities-municipalities/`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch municipalities", error: error.message });
  }
});

router.get("/address/barangays/:municipalityCode", async (req, res) => {
  try {
    const data = await fetchPsgc(`https://psgc.gitlab.io/api/cities-municipalities/${encodeURIComponent(req.params.municipalityCode)}/barangays/`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch barangays", error: error.message });
  }
});

module.exports = router;
