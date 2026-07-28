const mongoose = require("mongoose");

const portalAnnouncementSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    type: { type: String, enum: ["info", "warning", "success", "error"], default: "info" },
    title: { type: String, default: "" },
    summary: { type: String, default: "" },
    message: { type: String, default: "" },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    showOnLogin: { type: Boolean, default: true },
    showInPortal: { type: Boolean, default: true },
    dismissible: { type: Boolean, default: true },
    emailSubject: { type: String, default: "" },
    emailMessage: { type: String, default: "" },
    emailLastSentAt: { type: Date, default: null },
    // Author captured once on create (preserved across edits). Display only.
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Automation Agent — configuration-only structure for a FUTURE system-steward /
// application-monitoring agent (#5). Persisting these values must never start an
// agent, poller, job, queue, or external call. The shape is deliberately extensible
// so later work can add event ingestion, alert rules, execution history,
// recommendations, remediation approvals and audit logs without a breaking change.
const automationAgentSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    // Identity
    name: { type: String, default: "" },
    description: { type: String, default: "" },
    role: { type: String, default: "System Steward and Application Monitoring Agent" },
    environmentScope: { type: String, default: "" },
    // Monitoring scope — every category inactive by default.
    monitoring: {
      frontendErrors: { type: Boolean, default: false },
      backendErrors: { type: Boolean, default: false },
      apiFailures: { type: Boolean, default: false },
      databaseHealth: { type: Boolean, default: false },
      resourceUsage: { type: Boolean, default: false },
      authIssues: { type: Boolean, default: false },
      fileUploadFailures: { type: Boolean, default: false },
      scheduledJobs: { type: Boolean, default: false },
      integrationFailures: { type: Boolean, default: false },
      securityAlerts: { type: Boolean, default: false },
    },
    // Future scheduling — stored only; no real polling is created.
    frequency: {
      type: String,
      enum: ["manual", "5m", "15m", "30m", "hourly"],
      default: "manual",
    },
    severity: {
      informational: { type: Boolean, default: true },
      warning: { type: Boolean, default: true },
      critical: { type: Boolean, default: true },
    },
    // Placeholder notification channels — no external delivery is implemented.
    notifications: {
      inApp: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      systemLogs: { type: Boolean, default: false },
      webhook: { type: Boolean, default: false },
      webhookUrl: { type: String, default: "" },
    },
    // Provider configuration — supports Anthropic (Claude) or Google Gemini.
    // The API key is NEVER stored in plain text: the operational source of truth
    // is the matching server env var (ANTHROPIC_API_KEY / GEMINI_API_KEY), and any
    // UI-entered key is kept here only as an AES-256-GCM-encrypted fallback
    // (apiKeyEnc) tagged with the provider it belongs to (apiKeyProvider), plus a
    // non-reversible hint for the UI. A stored key is only ever used for its own
    // provider, so switching providers never leaks a key to the wrong vendor.
    provider: {
      provider: { type: String, enum: ["anthropic", "gemini"], default: "anthropic" },
      model: { type: String, default: "" }, // falls back to the provider's env model
      apiKey: { type: String, default: "" }, // legacy; migrated to apiKeyEnc then cleared
      apiKeyEnc: { type: String, default: "" }, // "v1:iv:tag:cipher" (see utils/secretBox)
      apiKeyHint: { type: String, default: "" }, // e.g. "••••••••AB12" — display only
      apiKeyProvider: { type: String, default: "" }, // which provider the stored key is for
      endpoint: { type: String, default: "" }, // display only (official API is fixed)
      temperature: { type: Number, default: 0.2 },
      maxTokens: { type: Number, default: 1024 },
      requestTimeoutMs: { type: Number, default: 30000 },
    },
    // Operational agent config. Read-only allowlist of function ids the agent may
    // run; empty defaults to all read-only functions. `loggingLevel` gates how
    // much of each query is persisted in the usage log.
    systemInstruction: {
      type: String,
      default:
        "You are a read-only operations assistant for an Ecological Solid Waste " +
        "Management Pipeline (ESWMP) system. You summarize and explain the " +
        "structured data provided to you. You never modify records, never invent " +
        "data not present in the context, and you clearly flag uncertainty.",
    },
    allowedFunctions: { type: [String], default: [] },
    loggingLevel: {
      type: String,
      enum: ["none", "metadata", "full"],
      default: "metadata",
    },
    // Cost/rate ceilings. null → fall back to the AUTOMATION_AGENT_* env values.
    dailyRequestLimit: { type: Number, default: null },
    perUserRequestLimit: { type: Number, default: null },
    // Connection health (updated by the Test Connection + query flows).
    lastSuccessfulConnectionAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    lastErrorAt: { type: Date, default: null },
  },
  { _id: false }
);

// SLF Portal sensitive-value masking — one audit entry per developer change.
const slfMaskAuditSchema = new mongoose.Schema(
  {
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    changedByEmail: { type: String, default: "" },
    changedByRole: { type: String, default: "" },
    previousValue: { type: Boolean, default: false },
    newValue: { type: Boolean, default: false },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
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

    // Dev Portal Credential — lets ONLY the developer role impersonate a portal
    // user for debugging, gated behind the developer password + a hashed PIN.
    // The PIN hash is never returned by any API.
    devPortalPinHash: { type: String, default: "" },
    devPortalPinUpdatedAt: { type: Date, default: null },
    devPortalPinFailedAttempts: { type: Number, default: 0 },
    devPortalPinLockedUntil: { type: Date, default: null },

    // SLF Portal sensitive-value masking (developer-controlled global privacy
    // toggle, sits under Dev Portal Credential). Enabled → sensitive SLF Portal
    // values render as "*****". Only the developer role may change it; every
    // change is audited (who, previous → new, when).
    maskSensitiveSlfValues: { type: Boolean, default: false },
    maskSensitiveSlfValuesUpdatedAt: { type: Date, default: null },
    maskSensitiveSlfAudit: { type: [slfMaskAuditSchema], default: [] },

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

    // Automation Agent configuration (config-only; see schema note above).
    automationAgent: { type: automationAgentSchema, default: () => ({}) },

    // VERA Developer Mode — when enabled, VERA answers VERIFIED developer accounts
    // with application architecture/API/authentication/diagnostics guidance and
    // live curated operational metrics (counts, health booleans, uptime). It never
    // affects portal users or normal admins, and is always enforced server-side
    // against the developer role regardless of any client-supplied flag. Secrets,
    // credentials, env values and connection strings stay blocked for everyone.
    veraDeveloperMode: { type: Boolean, default: true },

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
