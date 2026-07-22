const mongoose = require("mongoose");

// Persisted baseline → SlfClient synchronization job. Progress lives here (NOT in
// a global in-memory variable) so it survives restarts and is readable by any
// instance via the status endpoint. One "running" job per scope is enforced by
// the runner before starting a new one.
const STATUSES = ["pending", "running", "completed", "completed_with_issues", "failed"];
const STAGES = [
  "reading-baselines",
  "normalizing-haulers",
  "processing-clients",
  "saving-clients",
  "resolving-duplicates",
  "recalculating-summary",
  "validating-dashboard",
  "finalizing",
];

const slfSyncJobSchema = new mongoose.Schema(
  {
    scope: { type: String, trim: true, default: "baseline-clients", index: true },
    status: { type: String, enum: STATUSES, default: "pending", index: true },
    stage: { type: String, default: "" },
    stageLabel: { type: String, default: "" },
    percent: { type: Number, default: 0 },

    totalRecords: { type: Number, default: 0 },
    processedRecords: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    duplicates: { type: Number, default: 0 },
    merged: { type: Number, default: 0 },
    removed: { type: Number, default: 0 },
    flagged: { type: Number, default: 0 },

    startedBy: { type: String, trim: true, default: "" },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    errorMessage: { type: String, trim: true, default: "" },

    // Post-save validation result (see sync service).
    validation: { type: mongoose.Schema.Types.Mixed, default: null },
    // Full final summary snapshot.
    summary: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "slf_sync_jobs" }
);

slfSyncJobSchema.statics.STATUSES = STATUSES;
slfSyncJobSchema.statics.STAGES = STAGES;

module.exports = mongoose.model("SlfSyncJob", slfSyncJobSchema);
