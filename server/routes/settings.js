const express = require("express");
const PortalField = require("../models/PortalField");
const AppSettings = require("../models/AppSettings");
const UserPortal = require("../models/UserPortal");
const { clearYearVisibilityCache } = require("../utils/yearVisibility");
const { sendPortalAnnouncementEmail } = require("../utils/email");
const { authMiddleware, adminOnly } = require("../middleware/auth");

const router = express.Router();

function serializeAnnouncement(item = {}) {
  return {
    _id: item._id,
    enabled: item.enabled !== false,
    type: item.type || item.portalAnnouncementType || "info",
    title: item.title || item.portalAnnouncementTitle || "",
    message: item.message || item.portalAnnouncementMessage || "",
    startAt: item.startAt ?? item.portalAnnouncementStartAt ?? null,
    endAt: item.endAt ?? item.portalAnnouncementEndAt ?? null,
    showOnLogin: item.showOnLogin ?? item.portalAnnouncementShowOnLogin ?? true,
    showInPortal: item.showInPortal ?? item.portalAnnouncementShowInPortal ?? true,
    dismissible: item.dismissible ?? item.portalAnnouncementDismissible ?? true,
    emailSubject: item.emailSubject || item.portalAnnouncementEmailSubject || "",
    emailMessage: item.emailMessage || item.portalAnnouncementEmailMessage || "",
    emailLastSentAt: item.emailLastSentAt || item.portalAnnouncementEmailLastSentAt || null,
  };
}

function syncCurrentAnnouncement(settings, item) {
  const ann = serializeAnnouncement(item || {});
  settings.portalAnnouncementActiveId = item?._id || null;
  settings.portalAnnouncementEnabled = !!ann.enabled;
  settings.portalAnnouncementType = ann.type;
  settings.portalAnnouncementTitle = ann.title;
  settings.portalAnnouncementMessage = ann.message;
  settings.portalAnnouncementStartAt = ann.startAt || null;
  settings.portalAnnouncementEndAt = ann.endAt || null;
  settings.portalAnnouncementShowOnLogin = ann.showOnLogin !== false;
  settings.portalAnnouncementShowInPortal = ann.showInPortal !== false;
  settings.portalAnnouncementDismissible = ann.dismissible !== false;
  settings.portalAnnouncementCtaLabel = "";
  settings.portalAnnouncementCtaUrl = "";
  settings.portalAnnouncementEmailSubject = ann.emailSubject || "";
  settings.portalAnnouncementEmailMessage = ann.emailMessage || "";
}

function clearCurrentAnnouncement(settings) {
  settings.portalAnnouncementActiveId = null;
  settings.portalAnnouncementEnabled = false;
  settings.portalAnnouncementTitle = "";
  settings.portalAnnouncementMessage = "";
  settings.portalAnnouncementCtaLabel = "";
  settings.portalAnnouncementCtaUrl = "";
}

function migrateLegacyAnnouncement(settings) {
  if ((settings.portalAnnouncements || []).length || !settings.portalAnnouncementTitle && !settings.portalAnnouncementMessage) return;
  const legacy = {
    enabled: !!settings.portalAnnouncementEnabled,
    type: settings.portalAnnouncementType || "info",
    title: settings.portalAnnouncementTitle || "",
    message: settings.portalAnnouncementMessage || "",
    startAt: settings.portalAnnouncementStartAt || null,
    endAt: settings.portalAnnouncementEndAt || null,
    showOnLogin: settings.portalAnnouncementShowOnLogin !== false,
    showInPortal: settings.portalAnnouncementShowInPortal !== false,
    dismissible: settings.portalAnnouncementDismissible !== false,
    emailSubject: settings.portalAnnouncementEmailSubject || "",
    emailMessage: settings.portalAnnouncementEmailMessage || "",
    emailLastSentAt: settings.portalAnnouncementEmailLastSentAt || null,
  };
  settings.portalAnnouncements.push(legacy);
  if (legacy.enabled) settings.portalAnnouncementActiveId = settings.portalAnnouncements[0]._id;
}

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
    migrateLegacyAnnouncement(settings);
    if (settings.isModified?.()) await settings.save();
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

router.get("/app/portal-announcements", authMiddleware, adminOnly, async (_req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = await AppSettings.create({});
    migrateLegacyAnnouncement(settings);
    await settings.save();
    res.json((settings.portalAnnouncements || []).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/app/portal-announcements", authMiddleware, adminOnly, async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = await AppSettings.create({});
    const item = serializeAnnouncement(req.body);
    if (!item.title?.trim() || !item.message?.trim()) {
      return res.status(400).json({ message: "Title and message are required." });
    }
    if (item.enabled) settings.portalAnnouncements.forEach((ann) => { ann.enabled = false; });
    settings.portalAnnouncements.push(item);
    const savedItem = settings.portalAnnouncements[settings.portalAnnouncements.length - 1];
    if (item.enabled) syncCurrentAnnouncement(settings, savedItem);
    await settings.save();
    clearYearVisibilityCache();
    res.status(201).json({ message: "Announcement created", data: savedItem, settings });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.put("/app/portal-announcements/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = await AppSettings.create({});
    const item = settings.portalAnnouncements.id(req.params.id);
    if (!item) return res.status(404).json({ message: "Announcement not found" });
    const update = serializeAnnouncement(req.body);
    if (!update.title?.trim() || !update.message?.trim()) {
      return res.status(400).json({ message: "Title and message are required." });
    }
    if (update.enabled) settings.portalAnnouncements.forEach((ann) => { if (!ann._id.equals(item._id)) ann.enabled = false; });
    Object.assign(item, update);
    if (item.enabled) syncCurrentAnnouncement(settings, item);
    else if (String(settings.portalAnnouncementActiveId || "") === String(item._id)) clearCurrentAnnouncement(settings);
    await settings.save();
    clearYearVisibilityCache();
    res.json({ message: "Announcement updated", data: item, settings });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.delete("/app/portal-announcements/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = await AppSettings.create({});
    const item = settings.portalAnnouncements.id(req.params.id);
    if (!item) return res.status(404).json({ message: "Announcement not found" });
    const wasActive = String(settings.portalAnnouncementActiveId || "") === String(item._id);
    item.deleteOne();
    if (wasActive) clearCurrentAnnouncement(settings);
    await settings.save();
    clearYearVisibilityCache();
    res.json({ message: "Announcement deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Email current or supplied portal announcement to approved portal users
router.post("/app/portal-announcement/email", authMiddleware, adminOnly, async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = await AppSettings.create({});

    const announcement = {
      id: req.body.announcementId,
      title: req.body.title ?? settings.portalAnnouncementTitle,
      message: req.body.message ?? settings.portalAnnouncementMessage,
      subject:
        req.body.subject ||
        settings.portalAnnouncementEmailSubject ||
        settings.portalAnnouncementTitle ||
        "SLF Portal Announcement",
      emailMessage:
        req.body.emailMessage ||
        settings.portalAnnouncementEmailMessage ||
        settings.portalAnnouncementMessage,
      ctaLabel: req.body.ctaLabel ?? settings.portalAnnouncementCtaLabel,
      ctaUrl: req.body.ctaUrl ?? settings.portalAnnouncementCtaUrl,
    };

    if (!announcement.emailMessage || !String(announcement.emailMessage).trim()) {
      return res.status(400).json({ message: "Announcement email message is required." });
    }

    const users = await UserPortal.find({
      status: "approved",
      email: { $exists: true, $ne: "" },
    }).select("email firstName");

    const results = await Promise.allSettled(
      users.map((user) =>
        sendPortalAnnouncementEmail(user.email, {
          subject: announcement.subject,
          title: announcement.title,
          message: announcement.emailMessage,
          firstName: user.firstName,
          ctaLabel: announcement.ctaLabel,
          ctaUrl: announcement.ctaUrl,
        }),
      ),
    );

    const sentAt = new Date();
    settings.portalAnnouncementEmailLastSentAt = sentAt;
    if (announcement.id) {
      const item = settings.portalAnnouncements.id(announcement.id);
      if (item) item.emailLastSentAt = sentAt;
    }
    await settings.save();

    const sent = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - sent;
    res.json({ message: "Announcement email processed", sent, failed, total: users.length });
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
