const mongoose = require("mongoose");

// Persistent flag for a baseline/client record that could not be synchronized
// safely into SlfClient. Nothing invalid is silently discarded — it becomes a
// resolvable issue here instead. Focused collection (no existing audit/issue
// collection fits this shape) keyed by a stable `signature` so re-running the
// sync updates the same open issue rather than piling up duplicates.
const FLAG_TYPES = [
  "missing_type", // baseline client has no resolvable LGU/Private type
  "missing_hauler", // client not attached to any hauler
  "unknown_hauler", // client references a hauler absent from baseline accreditedHaulers
  "duplicate_client", // same client assignment declared more than once
  "conflicting_portal_users", // same client tied to multiple portal accounts
  "invalid_baseline", // baseline record missing required identifying fields
  "unmigrated_baseline_client", // baseline client that could not be written to SlfClient
  "ambiguous_duplicate", // possible duplicate that could not be merged automatically
  "region_unclassified", // client location could not be classified within/outside Region 3
  "validation_mismatch", // post-sync dashboard/collection totals disagreed
];

const slfDataIssueSchema = new mongoose.Schema(
  {
    // Stable identity so repeated syncs upsert the same issue (idempotent).
    signature: { type: String, trim: true, unique: true },

    flagType: { type: String, enum: FLAG_TYPES, required: true, index: true },
    description: { type: String, trim: true, default: "" },
    sourceModule: { type: String, trim: true, default: "baseline-sync" },

    // Related references (all optional depending on flag type).
    client: { type: mongoose.Schema.Types.ObjectId, ref: "SlfClient", default: null },
    baselineRef: { type: mongoose.Schema.Types.ObjectId, ref: "DataSLF", default: null },
    clientName: { type: String, trim: true, default: "" },
    clientType: { type: String, trim: true, default: "" },
    portalUserEmail: { type: String, trim: true, lowercase: true, default: "" },
    hauler: { type: String, trim: true, default: "" },
    // Free-form extra context (e.g. the conflicting portal users list).
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Lifecycle.
    status: { type: String, enum: ["open", "resolved", "ignored"], default: "open", index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, trim: true, default: "" },
    resolutionNotes: { type: String, trim: true, default: "" },
    // Bumped every sync so an issue that recurs is re-surfaced as still-open.
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "slf_data_issues" }
);

slfDataIssueSchema.statics.FLAG_TYPES = FLAG_TYPES;

module.exports = mongoose.model("SlfDataIssue", slfDataIssueSchema);
