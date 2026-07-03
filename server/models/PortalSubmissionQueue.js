const mongoose = require("mongoose");

// Stores portal submissions that a user saved as a draft or scheduled for
// automatic submission later. On successful submission the record is marked
// "submitted" and linked to the created DataSLF batch via submissionId — the
// real disposal data still lives in the DataSLF collection (single source of
// truth for Admin > Portal Submissions).
const portalSubmissionQueueSchema = new mongoose.Schema(
  {
    portalUser: { type: mongoose.Schema.Types.ObjectId, ref: "UserPortal" },
    portalUserEmail: { type: String, trim: true, lowercase: true, index: true },
    slfGenerator: { type: mongoose.Schema.Types.ObjectId, ref: "SlfFacility" },
    slfName: { type: String, trim: true },

    // "draft" — saved for later manual submission; "scheduled" — auto-submit at scheduledAt
    type: {
      type: String,
      enum: ["draft", "scheduled"],
      default: "draft",
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "submitted", "failed", "cancelled"],
      default: "draft",
      index: true,
    },

    // Full submission entry payload (same shape POST /data-slf expects as one entry).
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    scheduledAt: { type: Date },
    submittedAt: { type: Date },
    // submissionId of the DataSLF batch created on successful submission.
    resultSubmissionId: { type: String, trim: true },

    failureReason: { type: String, trim: true, default: "" },
    retryCount: { type: Number, default: 0 },

    createdBy: { type: String, trim: true },
    updatedBy: { type: String, trim: true },
    // Reference to the AppLog entry for the latest action, when available.
    lastLogRef: { type: mongoose.Schema.Types.ObjectId, ref: "AppLog" },
  },
  { timestamps: true }
);

portalSubmissionQueueSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model(
  "PortalSubmissionQueue",
  portalSubmissionQueueSchema,
  "portal_submission_queue"
);
