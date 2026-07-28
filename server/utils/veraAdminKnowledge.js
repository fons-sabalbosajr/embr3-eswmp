// VERA admin knowledge base — guidance for authorized ADMIN users of the EMB
// Region III Admin Portal. Public, workflow-level help only: NO secrets, NO
// developer-only functionality, NO environment/config/credential details.
//
// Anything reserved for Developer users (developer portal credentials, env vars,
// API keys, secrets/tokens, DB credentials, internal prompts, server/deploy
// config, developer-only settings, debug/security internals) is deliberately
// absent here AND blocked by the RESTRICTED_TERMS guard in veraAssistant.js.
//
// Shape mirrors the portal KB: { id, category, question, keywords[], answer, related[] }.

const { SUPPORT_EMAIL } = require("../config/contact");
const ASSISTANT_NAME = "VERA";
const ASSISTANT_FULL_NAME = "Virtual Environmental Response Assistant";

// Admin section (menu key) → friendly label, for page-aware answers.
const ADMIN_PAGE_LABELS = {
  dashboard: "Dashboard",
  messaging: "Messaging",
  "slf-monitoring": "SLF Monitoring",
  "slf-waste-generators": "SLF Waste Generators (Submissions)",
  "slf-clients": "SLF Clients",
  "slf-group": "SLF Group",
  "swm-programs": "SWM Programs",
  "monitoring-assist": "Monitoring & Assistance",
  "settings-fields": "Settings",
  "10yr-plan": "10-Year SWM Plan",
  "funded-mrf": "Funded MRF",
};

const ADMIN_KNOWLEDGE_BASE = [
  {
    id: "approve-submission",
    category: "submissions",
    question: "How do I approve or acknowledge a disposal submission / schedule?",
    keywords: ["approve", "acknowledge", "accept", "disposal schedule", "submission", "review submission", "confirm"],
    answer:
      "Open SLF Waste Generators (Submissions). Select the pending submission to review its details, then use Acknowledge to accept it or Revert to send it back for correction with a reason. Reverting or rejecting notifies the portal user. Acknowledged submissions may still need their cells organized before they're complete.",
    related: ["submission-incomplete", "revert-reject", "submission-status"],
  },
  {
    id: "revert-reject",
    category: "submissions",
    question: "How do I revert or reject a submission, and what's the difference?",
    keywords: ["revert", "reject", "send back", "correction", "reason", "difference"],
    answer:
      "Revert sends a submission back to the portal user to fix and resubmit (you provide a reason). Reject marks it as not accepted and locks it. Both notify the portal user. Use Revert for correctable issues and Reject only when the submission should not proceed at all.",
    related: ["approve-submission", "submission-status"],
  },
  {
    id: "submission-incomplete",
    category: "submissions",
    question: "Why is a submission marked incomplete?",
    keywords: ["incomplete", "why incomplete", "missing", "unassigned", "not complete", "organize cells", "cells"],
    answer:
      "A submission reads as incomplete when required data is missing or its waste hasn't been fully placed into disposal cells. Common causes: transport entries without an assigned cell, a missing hazardous waste code, or a vehicle without capacity. Acknowledged submissions with unplaced waste still appear under cell organization until every record is assigned. VERA explains what 'incomplete' means but cannot confirm a specific record's live state — open the submission to see its checklist.",
    related: ["approve-submission", "submission-status"],
  },
  {
    id: "submission-status",
    category: "submissions",
    question: "What do the submission statuses mean?",
    keywords: ["status", "statuses", "pending", "acknowledged", "reverted", "rejected", "what does status mean", "meaning"],
    answer:
      "Pending = awaiting your review. Acknowledged = accepted (may still need cells organized). Revert Requested / Reverted = sent back for correction. Rejected = not accepted and locked. On the SLF Location Map these map to marker colours; the map keys each SLF to its latest disposal-calendar record.",
    related: ["map-markers", "approve-submission"],
  },
  {
    id: "update-slf-account",
    category: "accounts",
    question: "Where can I update an SLF account or facility record?",
    keywords: ["update slf", "slf account", "edit facility", "facility record", "update facility", "portal user", "account"],
    answer:
      "SLF facility records live under SLF Monitoring — open the facility to view or edit its details. Portal user accounts (the people who submit) are managed under the SLF Waste Generators / portal users area. Changes save to the facility master record and reflect on the dashboard and map.",
    related: ["dashboard-values", "prevention-review"],
  },
  {
    id: "map-markers",
    category: "dashboard",
    question: "What do the SLF Location Map markers and statuses mean?",
    keywords: ["map", "marker", "markers", "location map", "colour", "color", "legend", "gray", "no data"],
    answer:
      "Each SLF marker reflects that facility's latest Disposal Calendar record: blue ✓ acknowledged, yellow ◷ pending, orange ↻ pending resubmission, orange ↺ reverted, red ⊘ rejected, red ✕ non-operational, gray ○ no submission, and light-gray – when the SLF has no calendar record yet. The legend beside the map lists every state; markers refresh automatically when submissions change.",
    related: ["submission-status", "dashboard-values"],
  },
  {
    id: "dashboard-values",
    category: "dashboard",
    question: "How do I read the dashboard cards, charts, and filters?",
    keywords: ["dashboard", "chart", "charts", "card", "cards", "filter", "filters", "capacity gauge", "waste volume", "tons", "trends", "active users"],
    answer:
      "Dashboard analytics show Waste Submission Trends, Most Active Portal Users (ranked), and Waste Volume by SLF — waste volumes are shown in tons. Capacity gauges show each SLF's cell utilization. Use the province/status filters and the date control to narrow the view; 'See More' opens a full breakdown. Figures come from acknowledged submission data.",
    related: ["map-markers", "reports"],
  },
  {
    id: "prevention-review",
    category: "prevention",
    question: "How do I review Prevention Measures and document summaries?",
    keywords: ["prevention", "prevention measures", "fire prevention", "trash slide", "document summary", "summarize", "narrative"],
    answer:
      "Open the Prevention Measures panel from the dashboard's Prevention modal (Trash Slide / Fire Prevention). Each SLF shows its Official Prevention Measures Narrative and its uploaded documents. Use 'Generate summary' to have VERA read a supported document (PDF/DOCX/TXT) and produce a separate, clearly-labeled document summary with a source reference. Summaries are guidance from the document text, not a replacement for the official narrative; unreadable or protected files show a warning instead.",
    related: ["update-slf-account", "dashboard-values"],
  },
  {
    id: "reports",
    category: "reports",
    question: "Where can I generate a report?",
    keywords: ["report", "reports", "generate report", "export", "download", "submission report"],
    answer:
      "Reports are generated from the relevant module — submission/disposal reports from SLF Waste Generators and SLF Monitoring, and program reports from their respective SWM Program pages. Look for the export/report action in the page toolbar. Apply the filters you want first; the report reflects the current filtered view.",
    related: ["dashboard-values"],
  },
  {
    id: "lgu-reconciliation",
    category: "reconciliation",
    question: "Which LGU client records aren't linked, and how do I reconcile them?",
    keywords: [
      "unlinked", "lgu reconciliation", "reconcile", "not linked", "masterlist", "municipality",
      "served lgu", "unverified", "duplicate municipality", "coverage", "psgc", "alias",
      "why is this excluded", "manual review", "match",
    ],
    answer:
      "Open the LGUs Served tab. When some municipality clients don't match the official masterlist, a red 'Reconcile unlinked (N)' button appears — it opens the reconciliation panel. There, each unlinked record shows a finding (exact / probable / multiple / none / invalid) and masterlist suggestions with a confidence level. Accept a suggestion to link it (adds an approved alias — non-destructive — and records an audit entry), pick another masterlist entry, or flag it for manual review. Matching is deterministic first (exact name+province, then approved alias), then fuzzy WITHIN the same province only — never across provinces, and suggestions only come from the encoded masterlist. Unlinked records are excluded from the official served-LGU count until reviewed, so 'verified served' and 'unverified' are shown separately. A record is excluded from the served count when its municipality value doesn't resolve to a masterlist entry (wrong/blank province, spelling variant with no alias, or a value not in the masterlist).",
    related: ["dashboard-values", "update-slf-account"],
  },
  {
    id: "inconsistent-totals",
    category: "reconciliation",
    question: "Why might a total look inconsistent or inflated?",
    keywords: [
      "inconsistent", "mismatch", "inflated", "total different", "why total", "duplicate",
      "counts don't match", "reconcile totals", "unusual total",
    ],
    answer:
      "Served-LGU counts are by unique municipality (masterlist id), so barangays, duplicate client records, and a municipality served by several haulers/SLFs each count once — a raw client-row count will look higher than the served-municipality count, and that's expected. If a dashboard and a list seem to disagree, check whether one is counting transactions/rows and the other unique municipalities, and whether unlinked records are being excluded. For unlinked municipalities, use LGU Reconciliation. VERA points you to the authoritative view but can't confirm live figures itself.",
    related: ["lgu-reconciliation", "dashboard-values"],
  },
  {
    id: "support-tickets",
    category: "support",
    question: "Where do portal users' support tickets appear?",
    keywords: ["ticket", "tickets", "support", "help request", "portal user question", "respond"],
    answer:
      "Portal users raise tickets from VERA on the portal side; they arrive in the admin support/messaging area where you can reply and set a status (open / in progress / resolved). Use Messaging to send announcements or direct messages to portal users.",
    related: ["update-slf-account"],
  },
  {
    id: "what-is-vera-admin",
    category: "meta",
    question: "What can VERA help me with here?",
    keywords: ["what can you do", "who are you", "help me", "vera", "capabilities", "what is vera"],
    answer:
      `I'm ${ASSISTANT_NAME} (${ASSISTANT_FULL_NAME}). On the Admin Portal I explain pages, features, dashboard values, statuses, filters, and common workflows — approving submissions, updating SLF accounts, reading the map, reviewing Prevention Measures, and generating reports. I give guidance, not confirmed record data, and I can't help with developer-only or system-configuration functions.`,
    related: ["approve-submission", "dashboard-values", "map-markers"],
  },
];

// ── Developer-only knowledge (Developer Mode) ────────────────────────────────
// Descriptive, architecture-level guidance surfaced ONLY to verified developer
// accounts. NO secrets, keys, env values, connection strings, or internal prompts
// — those remain blocked for everyone by the SECRET_TERMS guard in
// veraAssistant.js. Selected only when role === "developer" (see contextFor()).
const DEVELOPER_KNOWLEDGE_BASE = [
  {
    id: "dev-architecture",
    category: "developer",
    question: "What is the application architecture?",
    keywords: ["architecture", "stack", "structure", "how is the app built", "tech stack", "overview", "components"],
    answer:
      "EMBR3 ESWMP is a React (Vite + Ant Design) single-page front-end talking to an Express/Node backend over a REST API, with MongoDB (Mongoose) for storage and Socket.IO for realtime updates. The backend is organized into routes/ (HTTP endpoints), models/ (Mongoose schemas), utils/ (shared logic — email, VERA, submission status, logging), middleware/ (auth), and services/ (sync/maintenance jobs). The front-end has an admin app (AdminHome) and an SLF portal (SLFPortal), sharing utils and components.",
    related: ["dev-apis", "dev-database"],
  },
  {
    id: "dev-apis",
    category: "developer",
    question: "How are the APIs structured?",
    keywords: ["api", "apis", "endpoint", "endpoints", "routes", "rest", "http"],
    answer:
      "APIs are Express routers mounted under /api (e.g. /api/auth, /api/portal-auth, /api/data-slf, /api/notifications, /api/vera, /api/settings). Admin and portal clients both send a Bearer JWT; requireAnyAuth verifies the signature, while adminOnly/developerOnly/requirePermission add role- and permission-scoping. VERA has /api/vera/chat, /api/vera/status, /api/vera/notifications, /api/vera/logs, and (developer-only) /api/vera/insights.",
    related: ["dev-auth", "dev-architecture"],
  },
  {
    id: "dev-auth",
    category: "developer",
    question: "How does authentication and authorization work?",
    keywords: ["auth", "authentication", "authorization", "jwt", "token", "login", "roles", "permissions", "rbac"],
    answer:
      "Auth uses signed JWTs (7-day expiry). Admin tokens carry { id, role } where role is admin or developer; portal tokens carry { id, role: 'portal_user' }. Passwords are bcrypt-hashed. Route guards live in middleware/auth.js: requireAnyAuth (any valid token), adminOnly (admin/developer), developerOnly, and requirePermission(key, level) which re-loads the fresh permission set from the DB so direct API calls can't bypass UI gates. Developer is recognized via utils/developerIdentity.js. (Actual secret values like JWT_SECRET are never disclosed.)",
    related: ["dev-apis", "dev-architecture"],
  },
  {
    id: "dev-database",
    category: "developer",
    question: "How do database operations work?",
    keywords: ["database", "db", "mongo", "mongodb", "mongoose", "schema", "models", "collection", "persistence"],
    answer:
      "Data persists in MongoDB via Mongoose models in server/models/ (User, UserPortal, DataSLF, SlfFacility, Notification, AppLog, AppSettings, etc.). Submission records (DataSLF) carry a status enum: pending | acknowledged | rejected | revert_requested | reverted, normalized through utils/submissionStatus.js. AppLog is TTL-indexed (30-day expiry). Connection health is mongoose.connection.readyState. Ask me for 'database status' to see the live connection state and document counts.",
    related: ["dev-architecture", "dev-diagnostics"],
  },
  {
    id: "dev-services",
    category: "developer",
    question: "What background services and jobs exist?",
    keywords: ["background", "service", "services", "job", "jobs", "worker", "cron", "scheduled", "sync", "queue"],
    answer:
      "Backend services live in server/services/ and utils/: slfSyncRunner and syncBaselineClients (SLF/baseline sync), cleanupDuplicateClients, scheduledSubmissionWorker (portal submission scheduling), and the driveMaintenanceGuard for Drive uploads. The Automation Agent config in AppSettings is configuration-only and does not start pollers on its own. Socket.IO broadcasts realtime data-refresh/notification events.",
    related: ["dev-diagnostics", "dev-architecture"],
  },
  {
    id: "dev-diagnostics",
    category: "developer",
    question: "How do I check logs, diagnostics, and system health?",
    keywords: ["logs", "log", "diagnostics", "health", "monitoring", "status", "metrics", "uptime", "errors", "diagnostic"],
    answer:
      "Application events are written to the AppLog collection via utils/logger.js (writeLog level/action/message/meta) and surfaced in VERA Logs (/api/vera/logs) and the admin log views. Email delivery is logged as email.sent / email.failed. For live health, ask me 'system status', 'service health', or 'database status' and I'll report curated metrics (uptime, DB connection, email/AI/socket health, submission and user counts, 24h activity) from /api/vera/insights.",
    related: ["dev-services", "dev-database"],
  },
];

const DEVELOPER_SCOPE_TERMS = [
  "architecture", "api", "apis", "endpoint", "endpoints", "route", "routes", "auth",
  "authentication", "authorization", "jwt", "token", "role", "permission", "rbac",
  "database", "db", "mongo", "mongodb", "mongoose", "schema", "model", "collection",
  "service", "services", "job", "jobs", "worker", "cron", "scheduled", "sync", "queue",
  "log", "logs", "diagnostic", "diagnostics", "health", "metric", "metrics", "uptime",
  "status", "socket", "deployment", "environment", "system", "developer",
];

const ADMIN_STARTER_QUESTIONS = [
  "How do I approve a disposal submission?",
  "What do the SLF map marker colours mean?",
  "Why is a submission marked incomplete?",
  "How do I review Prevention Measures?",
  "Which LGU records aren't linked to the masterlist?",
  "Where can I generate a report?",
];

// Admin scope vocabulary — signals an in-scope admin question when retrieval is weak.
const ADMIN_SCOPE_TERMS = [
  "admin", "dashboard", "submission", "submissions", "approve", "acknowledge", "revert",
  "reject", "slf", "facility", "portal user", "map", "marker", "prevention", "report",
  "reports", "chart", "filter", "status", "cells", "capacity", "monitoring", "ticket",
  "waste", "generator", "hauler", "client", "messaging", "settings", "account",
  "lgu", "municipality", "masterlist", "reconcile", "reconciliation", "unlinked",
  "unverified", "coverage", "served", "psgc", "duplicate",
];

const ADMIN_GREETING_REPLY =
  `Hi! I'm ${ASSISTANT_NAME}, your ${ASSISTANT_FULL_NAME}. Ask me about Admin Portal pages, dashboard values, submission workflows, the SLF map, Prevention Measures, or reports. How can I help?`;

module.exports = {
  ADMIN_KNOWLEDGE_BASE,
  ADMIN_PAGE_LABELS,
  ADMIN_STARTER_QUESTIONS,
  ADMIN_SCOPE_TERMS,
  ADMIN_GREETING_REPLY,
  DEVELOPER_KNOWLEDGE_BASE,
  DEVELOPER_SCOPE_TERMS,
  SUPPORT_EMAIL,
};
