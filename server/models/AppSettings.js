const mongoose = require("mongoose");

const portalAnnouncementSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    type: { type: String, enum: ["info", "warning", "success", "error"], default: "info" },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    showOnLogin: { type: Boolean, default: true },
    showInPortal: { type: Boolean, default: true },
    dismissible: { type: Boolean, default: true },
    emailSubject: { type: String, default: "" },
    emailMessage: { type: String, default: "" },
    emailLastSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const appSettingsSchema = new mongoose.Schema(
  {
    // General
    appName: { type: String, default: "EMBR3 ESWMP" },
    appDescription: { type: String, default: "Ecological Solid Waste Management Pipeline" },

    // Theme
    theme: { type: String, enum: ["light", "dark"], default: "light" },
    primaryColor: { type: String, default: "#1a3353" },
    sidebarStyle: { type: String, enum: ["gradient", "solid"], default: "gradient" },
    siderColor: { type: String, default: "#1a3353" },
    siderColorDark: { type: String, default: "#111927" },
    headerColor: { type: String, default: "#ffffff" },
    headerColorDark: { type: String, default: "#141414" },

    // Portal
    portalTitle: { type: String, default: "SLF Generators Portal" },
    portalSubtitle: { type: String, default: "Ecological Solid Waste Management Pipeline (ESWMP) — Sanitary Landfill Monitoring System" },
    portalEnabled: { type: Boolean, default: true },
    requireEmailOnSubmit: { type: Boolean, default: true },

    // Portal Maintenance
    portalMaintenanceMode: { type: Boolean, default: false },
    portalMaintenanceReason: { type: String, default: "" },
    portalMaintenanceMessage: { type: String, default: "The portal is currently under maintenance. Please try again later." },
    portalCredentialSelfServiceEnabled: { type: Boolean, default: false },

    // Portal Announcements
    portalAnnouncementActiveId: { type: mongoose.Schema.Types.ObjectId, default: null },
    portalAnnouncements: { type: [portalAnnouncementSchema], default: [] },
    portalAnnouncementEnabled: { type: Boolean, default: false },
    portalAnnouncementType: { type: String, enum: ["info", "warning", "success", "error"], default: "info" },
    portalAnnouncementTitle: { type: String, default: "" },
    portalAnnouncementMessage: { type: String, default: "" },
    portalAnnouncementStartAt: { type: Date, default: null },
    portalAnnouncementEndAt: { type: Date, default: null },
    portalAnnouncementShowOnLogin: { type: Boolean, default: true },
    portalAnnouncementShowInPortal: { type: Boolean, default: true },
    portalAnnouncementDismissible: { type: Boolean, default: true },
    portalAnnouncementCtaLabel: { type: String, default: "" },
    portalAnnouncementCtaUrl: { type: String, default: "" },
    portalAnnouncementEmailSubject: { type: String, default: "" },
    portalAnnouncementEmailMessage: { type: String, default: "" },
    portalAnnouncementEmailLastSentAt: { type: Date, default: null },

    // Email
    emailNotificationsEnabled: { type: Boolean, default: true },
    emailFrom: { type: String, default: "" },

    // SMTP / Email transport configuration (stored in DB so admin can configure via UI)
    smtpConfigured: { type: Boolean, default: false },
    smtpProvider: {
      type: String,
      enum: ["smtp", "gmail-apppw", "gmail-oauth2", "none"],
      default: "none",
    },
    smtpHost:   { type: String, default: "" },
    smtpPort:   { type: Number, default: 587 },
    smtpUser:   { type: String, default: "" },
    smtpPass:   { type: String, default: "" }, // stored encrypted-at-rest by MongoDB; masked in API
    smtpSecure: { type: Boolean, default: false },
    smtpFrom:   { type: String, default: "" },
    emailMaintenanceMode: { type: Boolean, default: false },
    emailMaintenanceMessage: { type: String, default: "Email notifications are temporarily disabled for maintenance." },

    // Google Drive maintenance (blocks all Drive-based file uploads)
    driveMaintenanceMode: { type: Boolean, default: false },
    driveMaintenanceMessage: {
      type: String,
      default: "Google Drive is temporarily unavailable. File uploads are disabled. Please try again later.",
    },

    // Security
    sessionTimeout: { type: Number, default: 7 },        // days
    maxLoginAttempts: { type: Number, default: 5 },
    allowSignup: { type: Boolean, default: true },
    defaultRole: { type: String, enum: ["developer", "admin", "user"], default: "admin" },

    // Maintenance
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: "System is under maintenance. Please try again later." },

    // Historical data visibility
    hideHistoricalRecordsEnabled: { type: Boolean, default: false },
    hideRecordsBeforeOrEqualYear: { type: Number, default: null },
    hiddenRecordYears: { type: [Number], default: [] },

    // Baseline/submission volume analysis
    excludePreBaselineDisposalFromCellFill: { type: Boolean, default: true },
    preBaselineDisposalDetectorEnabled: { type: Boolean, default: true },

    // Truck capacity validation — max % a truck's actual waste volume may exceed
    // its stated capacity before a portal submission is blocked. Default 10%.
    // maxAllowedVolume = truckCapacity + (truckCapacity * pct / 100)
    truckCapacityAllowancePercent: { type: Number, default: 10 },

    // Dashboard Visibility & Maintenance (per-tab)
    dashboardTabs: {
      type: Map,
      of: new mongoose.Schema({
        visible: { type: Boolean, default: true },
        maintenance: { type: Boolean, default: false },
        maintenanceMessage: { type: String, default: "" },
      }, { _id: false }),
      default: {},
    },

    // Organizational Chart
    orgChart: {
      type: [{
        id: { type: String, required: true },
        name: { type: String, required: true },
        title: { type: String, default: "" },
        parentId: { type: String, default: null },
        color: { type: String, default: "#1677ff" },
        avatar: { type: String, default: "" },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AppSettings", appSettingsSchema);
