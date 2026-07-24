const mongoose = require("mongoose");

// A VERA investigation of a portal user's reporting BACKLOG (pending/overdue data
// updates) for a reporting period. Idempotent per (user, period, kind) via
// `signature`, so re-scanning updates the same open item instead of duplicating.
// Kept open until the data is submitted or formally resolved.
const STATUSES = [
  "backlog_detected",
  "investigating",
  "awaiting_user",
  "awaiting_admin",
  "escalated",
  "submitted",
  "resolved",
];

const veraBacklogSchema = new mongoose.Schema(
  {
    // Stable identity for idempotent upserts: `${email}|${period}|${kind}`.
    signature: { type: String, trim: true, unique: true },

    portalUser: { type: mongoose.Schema.Types.ObjectId, ref: "UserPortal", default: null },
    portalUserEmail: { type: String, trim: true, lowercase: true, index: true },
    slfName: { type: String, trim: true, default: "" },
    slfFacility: { type: mongoose.Schema.Types.ObjectId, ref: "SlfFacility", default: null },

    // Affected reporting period, e.g. "2026-07".
    reportingPeriod: { type: String, trim: true, default: "" },
    // Backlog source: reverted | draft | failed.
    kind: { type: String, trim: true, default: "" },
    // Count / short description of the missing or pending records.
    pendingRecords: { type: Number, default: 0 },
    missingRecords: { type: String, trim: true, default: "" },

    detectedIssue: { type: String, trim: true, default: "" },
    // Reuses the ticket investigator's categories.
    issueCategory: { type: String, trim: true, default: "" },
    evidenceReviewed: { type: [String], default: [] },
    recommendation: { type: String, trim: true, default: "" },
    confidence: { type: String, enum: ["low", "medium", "high", ""], default: "" },

    escalationStatus: { type: String, enum: ["none", "escalated"], default: "none" },
    status: { type: String, enum: STATUSES, default: "backlog_detected", index: true },
    adminNotes: { type: String, trim: true, default: "" },
    resolvedBy: { type: String, trim: true, default: "" },

    lastSeenAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "vera_backlog_investigations" }
);

veraBacklogSchema.statics.STATUSES = STATUSES;
veraBacklogSchema.index({ status: 1, lastSeenAt: -1 });

module.exports = mongoose.model("VeraBacklogInvestigation", veraBacklogSchema);
