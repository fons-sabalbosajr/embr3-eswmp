const express = require("express");
const PortalField = require("../models/PortalField");
const AppSettings = require("../models/AppSettings");
const UserPortal = require("../models/UserPortal");
const { clearYearVisibilityCache } = require("../utils/yearVisibility");
const {
  bypassSlfVisibility,
  clearSlfVisibilityCache,
  isNonOperationalStatus,
} = require("../utils/slfVisibility");
const { sendPortalAnnouncementEmail } = require("../utils/email");
const { verifyDriveAccess, getDriveConfigStatus } = require("../utils/googleDrive");
const { invalidateDriveMaintenanceCache } = require("../utils/driveMaintenanceGuard");
const { authMiddleware, adminOnly, developerOnly } = require("../middleware/auth");
const { refreshAdmin, broadcastRefresh } = require("../utils/socketEmit");
const { writeLog } = require("../utils/logger");
const { NON_DUMMY_CLAUSE } = require("../utils/dummyFilter");

const serverCache = require("../utils/serverCache");
const { cacheJson, invalidateOnWrite } = require("../middleware/cacheRoute");
const { PORTAL_FIELDS_CACHE_KEY, PSGC_PREFIX } = require("../utils/cacheKeys");
const { specialZoneOptions, isSpecialZoneCode } = require("../utils/specialZones");
const {
  buildProvinceOptions,
  isRegionBucketCode,
  provincelessLgus,
  regionCodeFromBucket,
} = require("../utils/psgcAddress");

const router = express.Router();

// The active portal field definitions are read on EVERY portal Data Entry load
// and change only when an admin edits them here. Cached for 10 minutes, and
// invalidated after any successful write on this router — deliberately router-wide
// rather than per field route, so a settings write can never leave the portal
// rendering a stale form. Over-invalidating a single small key costs nothing.
const PORTAL_FIELDS_TTL_MS = 600000;
router.use(invalidateOnWrite(PORTAL_FIELDS_CACHE_KEY));

function serializeAnnouncement(item = {}) {
  return {
    _id: item._id,
    enabled: item.enabled !== false,
    type: item.type || item.portalAnnouncementType || "info",
    priority: ["low", "normal", "high", "urgent"].includes(item.priority) ? item.priority : "normal",
    title: item.title || item.portalAnnouncementTitle || "",
    summary: item.summary || "",
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

// The flat portalAnnouncement* fields are a DERIVED COPY of the active item in
// portalAnnouncements[] — the login page and the portal read them. They used to
// be writable through PUT /settings/app, and the Developer Settings save sent
// `portalAnnouncementStartAt/EndAt: null` on every save (no form field holds
// them), so the copy lost its dates while keeping `enabled: true`. The login
// page then read an announcement that ended 2026-08-23 as open-ended and kept
// showing it. These keys are now stripped from that write, and the copy is
// re-derived from the item on every read and write.
const DERIVED_ANNOUNCEMENT_KEYS = [
  "portalAnnouncementActiveId", "portalAnnouncementEnabled", "portalAnnouncementType",
  "portalAnnouncementTitle", "portalAnnouncementMessage", "portalAnnouncementStartAt",
  "portalAnnouncementEndAt", "portalAnnouncementShowOnLogin", "portalAnnouncementShowInPortal",
  "portalAnnouncementDismissible", "portalAnnouncementCtaLabel", "portalAnnouncementCtaUrl",
];

function reconcileActiveAnnouncement(settings) {
  const list = settings.portalAnnouncements || [];
  if (!list.length) return;
  const activeId = String(settings.portalAnnouncementActiveId || "");
  const item = (activeId && list.find((a) => String(a._id) === activeId)) || list.find((a) => a.enabled);
  if (!item || item.enabled === false) {
    if (settings.portalAnnouncementEnabled || settings.portalAnnouncementActiveId) clearCurrentAnnouncement(settings);
    return;
  }
  syncCurrentAnnouncement(settings, item);
}

/** Enabled AND inside its start/end window, judged by the server clock. */
function isAnnouncementLive(out, now = Date.now()) {
  if (!out?.portalAnnouncementEnabled) return false;
  const start = out.portalAnnouncementStartAt ? new Date(out.portalAnnouncementStartAt).getTime() : null;
  const end = out.portalAnnouncementEndAt ? new Date(out.portalAnnouncementEndAt).getTime() : null;
  return (!start || start <= now) && (!end || end >= now);
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
router.get("/fields", cacheJson(() => PORTAL_FIELDS_CACHE_KEY, PORTAL_FIELDS_TTL_MS), async (req, res) => {
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
router.post("/fields/seed", authMiddleware, adminOnly, async (req, res) => {
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
router.post("/fields", authMiddleware, adminOnly, async (req, res) => {
  try {
    const field = new PortalField(req.body);
    await field.save();
    refreshAdmin(req, "settings");
    res.status(201).json({ message: "Field created", data: field });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update field
router.put("/fields/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    const field = await PortalField.findByIdAndUpdate(req.params.id, req.body, { returnDocument: "after" });
    if (!field) return res.status(404).json({ message: "Field not found" });
    refreshAdmin(req, "settings");
    res.json({ message: "Field updated", data: field });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete field
router.delete("/fields/:id", authMiddleware, adminOnly, async (req, res) => {
  try {
    await PortalField.findByIdAndDelete(req.params.id);
    refreshAdmin(req, "settings");
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
    reconcileActiveAnnouncement(settings);
    if (settings.isModified?.()) await settings.save();
    // Use flattenMaps so Mongoose Map fields (e.g. dashboardTabs) serialize as plain objects
    const out = settings.toObject({ flattenMaps: true });
    out.portalAnnouncementLive = isAnnouncementLive(out);
    if (out.smtpPass) out.smtpPass = "••••••••";
    // #5: never return the Automation Agent API key in plain text — expose only
    // whether one is stored so the UI can show a "stored" hint.
    if (out.automationAgent?.provider) {
      // Never expose the API key (encrypted or legacy) or its ciphertext blob.
      out.automationAgent.apiKeySet = !!(out.automationAgent.provider.apiKeyEnc || out.automationAgent.provider.apiKey);
      out.automationAgent.provider.apiKey = "";
      out.automationAgent.provider.apiKeyEnc = "";
    }
    // The masking audit trail carries changer emails (PII) — never expose it on
    // the public settings read. The boolean flag itself IS public (the portal
    // needs it); the audit is available only via the developer-only endpoint.
    if (out.maskSensitiveSlfAudit) delete out.maskSensitiveSlfAudit;
    res.json(out);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update app settings
router.put("/app", authMiddleware, adminOnly, async (req, res) => {
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
      // #5: a blank Automation Agent API key must NOT wipe a previously stored key
      // (the GET route masks it, so a normal round-trip sends it empty).
      if (req.body.automationAgent) {
        const incoming = req.body.automationAgent;
        if (incoming.provider && !String(incoming.provider.apiKey || "").trim()) {
          incoming.provider.apiKey = settings.automationAgent?.provider?.apiKey || "";
        }
      }
      const body = { ...req.body };
      DERIVED_ANNOUNCEMENT_KEYS.forEach((k) => { delete body[k]; });
      Object.assign(settings, body);
      reconcileActiveAnnouncement(settings);
    }
    await settings.save();
    clearYearVisibilityCache();
    clearSlfVisibilityCache();
    const outData = settings.toObject({ flattenMaps: true });
    outData.portalAnnouncementLive = isAnnouncementLive(outData);
    if (outData.automationAgent?.provider) {
      outData.automationAgent.apiKeySet = !!(outData.automationAgent.provider.apiKeyEnc || outData.automationAgent.provider.apiKey);
      outData.automationAgent.provider.apiKey = "";
      outData.automationAgent.provider.apiKeyEnc = "";
    }
    if (outData.maskSensitiveSlfAudit) delete outData.maskSensitiveSlfAudit;
    refreshAdmin(req, "settings");
    res.json({ message: "Settings updated", data: outData });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── SLF Portal sensitive-value masking (developer-only) ──────────────────────
// Global privacy toggle. When ON, sensitive SLF Portal values render as "*****"
// across every portal surface. Only the developer role may change it, and every
// change is audited. Portal users can never override it (this is the only write
// path, and it is developer-gated). A change broadcasts to ALL open portals +
// the admin so the flag updates in real time without a page reload.
router.get("/slf-masking", authMiddleware, developerOnly, async (_req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = await AppSettings.create({});
    const audit = (settings.maskSensitiveSlfAudit || [])
      .slice(-25)
      .reverse()
      .map((a) => ({
        changedByEmail: a.changedByEmail || "",
        changedByRole: a.changedByRole || "",
        previousValue: !!a.previousValue,
        newValue: !!a.newValue,
        at: a.at,
      }));
    res.json({
      maskSensitiveSlfValues: !!settings.maskSensitiveSlfValues,
      updatedAt: settings.maskSensitiveSlfValuesUpdatedAt || null,
      audit,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.put("/slf-masking", authMiddleware, developerOnly, async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = await AppSettings.create({});
    const next = !!req.body?.maskSensitiveSlfValues;
    const prev = !!settings.maskSensitiveSlfValues;
    if (next !== prev) {
      settings.maskSensitiveSlfValues = next;
      settings.maskSensitiveSlfValuesUpdatedAt = new Date();
      settings.maskSensitiveSlfAudit.push({
        changedBy: req.user?.id || null,
        changedByEmail: req.user?.email || req.user?.username || "",
        changedByRole: req.user?.role || "",
        previousValue: prev,
        newValue: next,
        at: new Date(),
      });
      // Keep the audit trail bounded.
      if (settings.maskSensitiveSlfAudit.length > 200) {
        settings.maskSensitiveSlfAudit = settings.maskSensitiveSlfAudit.slice(-200);
      }
      await settings.save();
      // Demo-session response masking answers to this same toggle — drop its
      // cached copy so the change takes effect on the next request instead of
      // after the TTL.
      require("../utils/demoMode").resetPrivacyToggleCache();
      writeLog("info", "settings.slfMasking.updated", {
        message: `SLF sensitive-value masking ${next ? "enabled" : "disabled"}`,
        user: req.user?.email || req.user?.id || "",
        meta: { previousValue: prev, newValue: next },
      });
      // Real-time: every portal + admin re-reads settings.
      broadcastRefresh(req, "app-settings");
      refreshAdmin(req, "settings");
    }
    res.json({ maskSensitiveSlfValues: next, updatedAt: settings.maskSensitiveSlfValuesUpdatedAt || null });
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
    // Author captured once at creation; serializeAnnouncement never emits it, so
    // subsequent PUT edits (Object.assign) preserve this value.
    savedItem.createdBy = req.user?.email || req.user?.username || req.user?.id || "";
    if (item.enabled) syncCurrentAnnouncement(settings, savedItem);
    await settings.save();
    clearYearVisibilityCache();
    clearSlfVisibilityCache();
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
    clearSlfVisibilityCache();
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
    clearSlfVisibilityCache();
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

    // Never send production announcement emails to dummy/test accounts.
    const users = await UserPortal.find({
      status: "approved",
      email: { $exists: true, $ne: "" },
      ...NON_DUMMY_CLAUSE,
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

// ── Email / SMTP configuration (admin-only) ──────────────────────────────────

const SMTP_PASS_MASK = "••••••••";

// Strip the real password from settings before sending to the client
function maskSmtpPass(settings) {
  const obj = settings?.toObject ? settings.toObject() : { ...settings };
  if (obj.smtpPass) obj.smtpPass = SMTP_PASS_MASK;
  return obj;
}

// Save SMTP config — never overwrite pass if the client sends the mask placeholder
router.put("/app/email-config", authMiddleware, adminOnly, async (req, res) => {
  try {
    const {
      smtpProvider, smtpHost, smtpPort, smtpUser, smtpPass,
      smtpSecure, smtpFrom, smtpConfigured, emailNotificationsEnabled, emailFrom,
    } = req.body;

    let settings = await AppSettings.findOne();
    if (!settings) settings = new AppSettings();

    if (typeof smtpConfigured === "boolean") settings.smtpConfigured = smtpConfigured;
    if (smtpProvider !== undefined) settings.smtpProvider = smtpProvider;
    if (smtpHost     !== undefined) settings.smtpHost = smtpHost;
    if (smtpPort     !== undefined) settings.smtpPort = Number(smtpPort) || 587;
    if (smtpUser     !== undefined) settings.smtpUser = smtpUser;
    if (smtpSecure   !== undefined) settings.smtpSecure = !!smtpSecure;
    if (smtpFrom     !== undefined) settings.smtpFrom = smtpFrom;
    if (emailNotificationsEnabled !== undefined) settings.emailNotificationsEnabled = !!emailNotificationsEnabled;
    if (emailFrom    !== undefined) settings.emailFrom = emailFrom;
    if (typeof req.body.emailMaintenanceMode === "boolean") settings.emailMaintenanceMode = req.body.emailMaintenanceMode;
    if (req.body.emailMaintenanceMessage !== undefined) settings.emailMaintenanceMessage = req.body.emailMaintenanceMessage;
    // Only update password if a real value (not the mask) is provided
    if (smtpPass && smtpPass !== SMTP_PASS_MASK) settings.smtpPass = smtpPass;

    await settings.save();

    // Invalidate email transporter cache so next send picks up new config
    try { require("../utils/email").invalidateEmailCache(); } catch { /* no-op */ }

    res.json({ message: "Email config saved", data: maskSmtpPass(settings.toObject({ flattenMaps: true })) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Test SMTP connection and optionally send a test email
router.post("/app/email-test", authMiddleware, adminOnly, async (req, res) => {
  try {
    const nodemailer = require("nodemailer");
    const {
      smtpProvider, smtpHost, smtpPort, smtpUser, smtpPass,
      smtpSecure, smtpFrom, sendTestTo,
    } = req.body;

    // If caller sends the mask, look up the real pass from DB
    let realPass = smtpPass;
    if (!realPass || realPass === SMTP_PASS_MASK) {
      const s = await AppSettings.findOne();
      realPass = s?.smtpPass || "";
    }

    let transport;
    if (smtpProvider === "gmail-apppw" || (!smtpHost && !smtpProvider)) {
      transport = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 587, secure: false,
        auth: { user: smtpUser || process.env.EMAIL_USER, pass: realPass || process.env.EMAIL_APP_PASS },
        tls: { rejectUnauthorized: false },
      });
    } else if (smtpProvider === "gmail-oauth2") {
      const clientId = process.env.GDRIVE_CLIENT_ID;
      const clientSecret = process.env.GDRIVE_CLIENT_SECRET;
      const refreshToken = realPass || process.env.GMAIL_REFRESH_TOKEN;
      if (!clientId || !clientSecret || !refreshToken) {
        return res.status(400).json({ message: "OAuth2 credentials incomplete. Set GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in .env." });
      }
      transport = nodemailer.createTransport({
        service: "gmail",
        auth: { type: "OAuth2", user: smtpUser || process.env.EMAIL_USER, clientId, clientSecret, refreshToken },
      });
    } else {
      if (!smtpHost || !smtpUser || !realPass) {
        return res.status(400).json({ message: "SMTP host, username, and password are required." });
      }
      const port = Number(smtpPort) || 587;
      transport = nodemailer.createTransport({
        host: smtpHost, port, secure: smtpSecure === true || smtpSecure === "true" || port === 465,
        auth: { user: smtpUser, pass: realPass },
        tls: { rejectUnauthorized: false },
      });
    }

    await transport.verify();

    if (sendTestTo) {
      const fromAddr = smtpFrom || smtpUser || process.env.EMAIL_USER;
      await transport.sendMail({
        from: `"VERA — EMBR3 ESWMP (Test)" <${fromAddr}>`,
        to: sendTestTo,
        subject: "EMBR3 ESWMP — SMTP Test Email",
        html: `<p style="font-family:sans-serif">This is a test email from <strong>EMBR3 ESWMP</strong>.<br>
               Your SMTP configuration is working correctly.<br><br>
               <small style="color:#888">Sent at ${new Date().toISOString()} via ${smtpHost || "Gmail"}</small></p>`,
      });
      return res.json({ message: `Connection verified and test email sent to ${sendTestTo}.` });
    }

    res.json({ message: "SMTP connection verified successfully." });
  } catch (error) {
    res.status(400).json({ message: `Connection failed: ${error.message}` });
  }
});

router.post("/app/drive-test", authMiddleware, adminOnly, async (_req, res) => {
  try {
    const result = await verifyDriveAccess();
    res.json({
      message: `Google Drive connection verified via ${result.client}.`,
      data: result,
    });
  } catch (error) {
    // Safe, credential-free reason. Flag re-authentication when the OAuth refresh
    // token is expired/revoked so the developer gets an actionable next step.
    const reason = driveErrorReason(error);
    const needsReauth = /invalid_grant|expired|revoked|401/i.test(
      `${error?.message || ""} ${reason}`,
    );
    res.status(400).json({
      ok: false,
      needsReauth,
      message: needsReauth
        ? `Drive test failed: ${reason} Re-authenticate Google Drive — regenerate GDRIVE_REFRESH_TOKEN and ensure the OAuth consent screen is published to Production (Testing-mode tokens expire).`
        : `Drive test failed: ${reason}`,
    });
  }
});

// Perform a real test upload to each configured Drive folder. Creates a tiny
// timestamped text file, uploads it, then immediately deletes it so no test
// junk accumulates. Returns per-folder results so the admin can confirm each
// folder is truly writable before going live.
// Sample file generators for the developer Drive test upload. Drive stores raw
// bytes so these are lightweight but valid enough to confirm a real upload.
function buildDriveTestFile(fileType, timestamp) {
  const base = `eswmp-test-${timestamp}`;
  switch (fileType) {
    case "image":
      return {
        name: `${base}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64"
        ),
      };
    case "pdf":
      return {
        name: `${base}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from(
          `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\nEMBR3 ESWMP test PDF ${timestamp}`
        ),
      };
    case "excel":
      return {
        name: `${base}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from(`Field,Value\nTest,EMBR3 ESWMP\nGenerated,${timestamp}\n`),
      };
    case "text":
    default:
      return {
        name: `${base}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(
          `EMBR3 ESWMP Drive test upload — ${timestamp}\nThis file was created by the developer Test Upload tool.`
        ),
      };
  }
}

const DRIVE_FOLDER_TARGETS = () => [
  { key: "images", label: "Images Folder", id: process.env.GDRIVE_IMAGE_FOLDER_ID },
  { key: "documents", label: "Documents Folder", id: process.env.GDRIVE_DOCS_FOLDER_ID },
  { key: "haulerLoi", label: "Hauler LOI Folder", id: process.env.GDRIVE_HAULER_LOI_FOLDER_ID },
];

// Map a Google Drive error to a safe, human-readable reason (no credentials).
function driveErrorReason(err) {
  const status = err?.response?.status || err?.code;
  const raw = err?.response?.data?.error || err?.errors?.[0]?.reason || err?.message || "";
  const msg = String(raw).toLowerCase();
  if (msg.includes("invalid_grant")) return "Expired or revoked OAuth refresh token.";
  if (status === 401) return "Invalid or expired OAuth credentials.";
  if (status === 403) return "No permission to write to this folder.";
  if (status === 404) return "Folder not found (invalid folder ID).";
  if (msg.includes("stream")) return "Upload stream error.";
  return `Google Drive API error: ${err?.message || "unknown"}`;
}

router.post("/app/drive-test-upload", authMiddleware, developerOnly, async (req, res) => {
  const logUser = req.user?.email || req.user?.username || req.user?.id || "";
  try {
    const { getDriveClients } = require("../utils/googleDrive");
    const { Readable } = require("stream");

    const allowedTypes = ["text", "image", "pdf", "excel"];
    const fileType = allowedTypes.includes(req.body?.fileType) ? req.body.fileType : "text";
    const keep = req.body?.keep === true;
    const folderKey = req.body?.folder; // optional: images|documents|haulerLoi|all

    let clients;
    try {
      clients = getDriveClients();
    } catch (credErr) {
      writeLog("error", "drive.test-upload.failed", {
        message: `Drive test upload failed (credentials): ${credErr.message}`,
        user: logUser, ip: req.ip,
      });
      return res.status(400).json({ ok: false, message: driveErrorReason(credErr) });
    }
    const drive = clients[0].drive;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sample = buildDriveTestFile(fileType, timestamp);

    let targets = DRIVE_FOLDER_TARGETS();
    if (folderKey && folderKey !== "all") {
      targets = targets.filter((t) => t.key === folderKey);
    }

    const results = [];
    for (const target of targets) {
      const steps = {
        folderAccess: false,
        upload: false,
        metadata: false,
        viewUrl: false,
        cleanup: keep ? null : false,
      };
      if (!target.id) {
        results.push({ ...target, success: false, steps, message: "Missing folder ID (not configured)." });
        continue;
      }
      let fileId = null;
      try {
        // 1) Folder access
        await drive.files.get({ fileId: target.id, fields: "id,name", supportsAllDrives: true });
        steps.folderAccess = true;

        // 2) Real upload
        const created = await drive.files.create({
          requestBody: {
            name: keep ? `[TEST] ${sample.name}` : sample.name,
            parents: [target.id],
            description: keep ? "EMBR3 ESWMP developer test file — safe to delete." : undefined,
          },
          media: { mimeType: sample.mimeType, body: Readable.from(sample.buffer) },
          fields: "id,name,webViewLink,mimeType,size",
          supportsAllDrives: true,
        });
        fileId = created.data.id;
        steps.upload = true;

        // 3) Metadata retrieval (proves the file really exists)
        const meta = await drive.files.get({
          fileId,
          fields: "id,name,mimeType,size,webViewLink",
          supportsAllDrives: true,
        });
        steps.metadata = true;
        steps.viewUrl = Boolean(meta.data.webViewLink);

        // 4) Optional cleanup
        if (!keep) {
          await drive.files.delete({ fileId, supportsAllDrives: true });
          steps.cleanup = true;
        }

        results.push({
          ...target,
          success: true,
          steps,
          fileId: keep ? fileId : undefined,
          fileName: meta.data.name,
          mimeType: meta.data.mimeType,
          size: meta.data.size ? Number(meta.data.size) : sample.buffer.length,
          webViewLink: keep ? meta.data.webViewLink : undefined,
          message: keep
            ? "Uploaded and kept (marked as test file)."
            : "Upload, metadata, and cleanup all succeeded.",
        });
      } catch (err) {
        if (fileId && !keep) {
          await drive.files.delete({ fileId, supportsAllDrives: true }).catch(() => {});
        }
        results.push({ ...target, success: false, steps, message: driveErrorReason(err) });
      }
    }

    const allOk = results.length > 0 && results.every((r) => r.success);
    writeLog(allOk ? "info" : "warn", allOk ? "drive.test-upload" : "drive.test-upload.failed", {
      message: allOk
        ? `Drive test upload succeeded (${fileType}, keep=${keep})`
        : `Drive test upload had failures: ${results.filter((r) => !r.success).map((r) => r.label).join(", ")}`,
      user: logUser, ip: req.ip,
      meta: { fileType, keep, results: results.map((r) => ({ key: r.key, success: r.success })) },
    });

    res.json({
      ok: allOk,
      message: allOk
        ? `Real ${fileType} file uploaded successfully to ${results.length} folder(s).`
        : `Some folders failed: ${results.filter((r) => !r.success).map((r) => r.label).join(", ")}`,
      fileType,
      keep,
      results,
      client: clients[0].name,
    });
  } catch (error) {
    writeLog("error", "drive.test-upload.failed", {
      message: `Drive test upload error: ${error.message}`,
      user: logUser, ip: req.ip,
    });
    res.status(400).json({ ok: false, message: `Test upload failed: ${error.message}` });
  }
});

// Report Google Drive configuration status without hitting the network. Lets the
// admin UI show a readable error when required env vars are missing.
router.get("/app/drive-status", authMiddleware, adminOnly, (_req, res) => {
  try {
    const status = getDriveConfigStatus();
    res.json({
      ok: status.ok,
      authMethod: status.authMethod,
      hasServiceAccountFallback: status.hasServiceAccountFallback,
      folders: status.folders,
      missing: status.missing,
      message: status.ok
        ? `Google Drive configuration is complete (auth: ${status.authMethod}).`
        : `Google Drive configuration incomplete. Missing: ${status.missing.join(", ")}.`,
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: `Drive status check failed: ${error.message}` });
  }
});

// Save Drive maintenance mode config
router.put("/app/drive-config", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { driveMaintenanceMode, driveMaintenanceMessage } = req.body;
    let settings = await AppSettings.findOne();
    if (!settings) settings = new AppSettings();
    if (typeof driveMaintenanceMode === "boolean") settings.driveMaintenanceMode = driveMaintenanceMode;
    if (driveMaintenanceMessage !== undefined) settings.driveMaintenanceMessage = driveMaintenanceMessage;
    await settings.save();
    // Bust the drive maintenance cache immediately
    invalidateDriveMaintenanceCache();
    res.json({
      message: "Drive config saved",
      driveMaintenanceMode: settings.driveMaintenanceMode,
      driveMaintenanceMessage: settings.driveMaintenanceMessage,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update org chart
router.put("/org-chart", authMiddleware, adminOnly, async (req, res) => {
  try {
    let settings = await AppSettings.findOne();
    if (!settings) settings = new AppSettings();
    settings.orgChart = req.body.orgChart || [];
    await settings.save();
    refreshAdmin(req, "settings");
    res.json({ message: "Org chart updated", data: settings.orgChart });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * The non-operational facilities and what hiding each one costs.
 *
 * The settings screen needs to show WHICH facilities the rule covers and how many
 * records each would take out of Portal Submissions — turning on a switch labelled
 * only "hide non-operational SLFs" is asking an admin to hide an unknown quantity
 * of real data.
 *
 * Read inside `bypassSlfVisibility` on purpose: this is the one screen that must
 * see through the rule it configures. Without it, switching the rule on would hide
 * the list of what it is hiding, and there would be no way to review or undo it.
 */
router.get("/app/non-operational-slf", authMiddleware, adminOnly, async (_req, res) => {
  try {
    const DataSLF = require("../models/DataSLF");
    const SlfFacility = require("../models/SlfFacility");
    const settings = await AppSettings.findOne()
      .select("hideNonOperationalSlfEnabled nonOperationalSlfExceptions")
      .lean();

    const { facilities, counts } = await bypassSlfVisibility(async () => {
      const all = await SlfFacility.find({ deletedAt: null })
        .select("lgu province ownership statusOfSLF")
        .lean();
      const nonOperational = all.filter((f) => isNonOperationalStatus(f.statusOfSLF));
      if (!nonOperational.length) return { facilities: [], counts: new Map() };
      const grouped = await DataSLF.aggregate([
        { $match: { slfGenerator: { $in: nonOperational.map((f) => f._id) }, deletedAt: null } },
        { $group: { _id: "$slfGenerator", records: { $sum: 1 } } },
      ]).option({ includeHiddenYears: true, includeNonOperationalSlf: true });
      return {
        facilities: nonOperational,
        counts: new Map(grouped.map((row) => [String(row._id), row.records])),
      };
    });

    const exceptions = new Set(
      (settings?.nonOperationalSlfExceptions || []).map((id) => String(id)),
    );
    res.json({
      enabled: !!settings?.hideNonOperationalSlfEnabled,
      facilities: facilities
        .map((facility) => ({
          _id: facility._id,
          lgu: facility.lgu || "",
          province: facility.province || "",
          ownership: facility.ownership || "",
          statusOfSLF: facility.statusOfSLF || "",
          recordCount: counts.get(String(facility._id)) || 0,
          // Listed as an exception → its data stays visible despite the rule.
          alwaysVisible: exceptions.has(String(facility._id)),
        }))
        .sort((a, b) => a.province.localeCompare(b.province) || a.lgu.localeCompare(b.lgu)),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Philippine Address API Proxy (PSGC) — 24-hour cache ──
// A miss here costs an EXTERNAL network round trip (psgc.gitlab.io), not a Mongo
// query, so it is the most expensive miss in the app and the one most worth
// keeping across restarts — which the shared cache does once Redis is configured.
// The upstream data is effectively immutable, hence the long TTL and no
// invalidation path; the URL is the key, so every level of the address cascade
// gets its own entry. `wrap` gives it single-flight too: a portal page that opens
// the address picker for the first time fires one upstream request, not one per
// concurrent user.
const PSGC_TTL = 24 * 60 * 60 * 1000; // 24 hours
async function fetchPsgc(url) {
  return serverCache.wrap(`${PSGC_PREFIX}:${url}`, PSGC_TTL, async () => {
    const resp = await fetch(url);
    return resp.json();
  });
}

router.get("/address/regions", async (_req, res) => {
  try {
    const data = await fetchPsgc("https://psgc.gitlab.io/api/regions/");
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch regions", error: error.message });
  }
});

/**
 * EVERY province nationwide, in one request.
 *
 * For editors that fix many records at once — the baseline completion modal —
 * where the region is not being chosen and walking Region → Province for each row
 * would be 17 round trips to populate one dropdown. PSGC serves the flat list
 * directly, so this is a single cached call.
 *
 * The province-less region buckets are appended for the same reason they exist on
 * the per-region route: without them a Metro Manila client has nothing to select.
 * They are built from the regions list rather than re-derived per region, since a
 * bucket is only offered where a region actually has province-less LGUs.
 */
router.get("/address/provinces", async (_req, res) => {
  try {
    const [provinces, regions] = await Promise.all([
      fetchPsgc("https://psgc.gitlab.io/api/provinces/"),
      fetchPsgc("https://psgc.gitlab.io/api/regions/").catch(() => []),
    ]);
    const buckets = [];
    await Promise.all(
      (Array.isArray(regions) ? regions : []).map(async (region) => {
        const code = encodeURIComponent(region.code);
        const lgus = await fetchPsgc(
          `https://psgc.gitlab.io/api/regions/${code}/cities-municipalities/`,
        ).catch(() => []);
        if (!provincelessLgus(lgus).length) return;
        const regionProvinces = (Array.isArray(provinces) ? provinces : []).filter(
          (province) => province.regionCode === region.code,
        );
        buckets.push(...buildProvinceOptions(regionProvinces, lgus, region).filter((o) => o.isRegionBucket));
      }),
    );
    res.json([...(Array.isArray(provinces) ? provinces : []), ...buckets]);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch provinces", error: error.message });
  }
});

/**
 * Provinces of a region, plus a bucket for the LGUs that belong to no province.
 *
 * NCR has no provinces at all — its 17 cities hang off legislative DISTRICTS, a
 * different level of the PSGC hierarchy — so this used to answer with an empty
 * array and the cascade dead-ended on a required field. Two other regions have a
 * single province-less city each (Isabela City, Cotabato City) that was likewise
 * unreachable. See utils/psgcAddress.
 *
 * The region's own city list is fetched on every call to detect that condition
 * rather than exceptions being hardcoded — PSGC reassigns LGUs between regions,
 * so a hardcoded list would go stale silently. It costs nothing in practice: it
 * goes through the same 24-hour single-flight cache as everything else here, so
 * it is one extra upstream request per region per day, and none at all once warm.
 */
router.get("/address/provinces/:regionCode", async (req, res) => {
  try {
    const regionCode = req.params.regionCode;
    const encoded = encodeURIComponent(regionCode);
    const [provinces, regionLgus, region] = await Promise.all([
      fetchPsgc(`https://psgc.gitlab.io/api/regions/${encoded}/provinces/`),
      // Both are additive: if either lookup fails the real province list still
      // goes out, exactly as it did before this bucket existed.
      fetchPsgc(`https://psgc.gitlab.io/api/regions/${encoded}/cities-municipalities/`).catch(() => []),
      fetchPsgc(`https://psgc.gitlab.io/api/regions/${encoded}/`).catch(() => ({})),
    ]);
    res.json(buildProvinceOptions(provinces, regionLgus, { ...region, code: regionCode }));
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch provinces", error: error.message });
  }
});

/**
 * Cities/municipalities of a province, optionally with the special economic zones
 * hosted by it appended.
 *
 * `?includeSpecialZones=1` is OPT-IN, not the default, because a zone carries a
 * synthetic `SZ-…` code rather than a PSGC one: a cascade that continues down to
 * Barangay would then ask PSGC for the barangays of a code it has never heard of.
 * Only the pickers that stop at City/Municipality — the client address forms —
 * ask for them. See utils/specialZones for why PSGC cannot supply these at all.
 */
router.get("/address/municipalities/:provinceCode", async (req, res) => {
  try {
    // The province-less bucket from the route above. Its members live in the
    // REGION's city list, not in any province's, so that is what is filtered.
    // Handled before the special-zone branch because it must work for every
    // caller, including the facility-address cascade that does not opt in.
    if (isRegionBucketCode(req.params.provinceCode)) {
      const regionCode = encodeURIComponent(regionCodeFromBucket(req.params.provinceCode));
      const regionLgus = await fetchPsgc(`https://psgc.gitlab.io/api/regions/${regionCode}/cities-municipalities/`);
      return res.json(provincelessLgus(regionLgus));
    }
    const data = await fetchPsgc(`https://psgc.gitlab.io/api/provinces/${encodeURIComponent(req.params.provinceCode)}/cities-municipalities/`);
    if (!/^(1|true|yes)$/i.test(String(req.query.includeSpecialZones || ""))) {
      return res.json(data);
    }
    // Zones are keyed by province NAME, and the caller only has the code — so the
    // province is resolved through the same cached proxy rather than by hardcoding
    // PSGC codes here, which would silently stop matching if PSGC re-issued one.
    let provinceName = "";
    try {
      const province = await fetchPsgc(`https://psgc.gitlab.io/api/provinces/${encodeURIComponent(req.params.provinceCode)}/`);
      provinceName = province?.name || "";
    } catch { /* zones are additive — a lookup failure must not lose the PSGC list */ }
    const zones = provinceName ? specialZoneOptions(provinceName) : [];
    res.json([...(Array.isArray(data) ? data : []), ...zones]);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch municipalities", error: error.message });
  }
});

router.get("/address/barangays/:municipalityCode", async (req, res) => {
  try {
    // A special zone has no PSGC barangays. Answering with an empty list is the
    // honest result and keeps the caller on its normal path; forwarding the
    // synthetic code upstream would only produce a 404 rendered as a load error.
    if (isSpecialZoneCode(req.params.municipalityCode)) return res.json([]);
    const data = await fetchPsgc(`https://psgc.gitlab.io/api/cities-municipalities/${encodeURIComponent(req.params.municipalityCode)}/barangays/`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch barangays", error: error.message });
  }
});

module.exports = router;
