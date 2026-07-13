const express = require("express");
const PortalField = require("../models/PortalField");
const AppSettings = require("../models/AppSettings");
const UserPortal = require("../models/UserPortal");
const { clearYearVisibilityCache } = require("../utils/yearVisibility");
const { sendPortalAnnouncementEmail } = require("../utils/email");
const { verifyDriveAccess, getDriveConfigStatus } = require("../utils/googleDrive");
const { invalidateDriveMaintenanceCache } = require("../utils/driveMaintenanceGuard");
const { authMiddleware, adminOnly, developerOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { NON_DUMMY_CLAUSE } = require("../utils/dummyFilter");

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
    // Use flattenMaps so Mongoose Map fields (e.g. dashboardTabs) serialize as plain objects
    const out = settings.toObject({ flattenMaps: true });
    if (out.smtpPass) out.smtpPass = "••••••••";
    res.json(out);
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
    res.json({ message: "Settings updated", data: settings.toObject({ flattenMaps: true }) });
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
        from: `"EMBR3 ESWMP (Test)" <${fromAddr}>`,
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
