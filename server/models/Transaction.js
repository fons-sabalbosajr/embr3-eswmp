const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    // Links to the original submission
    submissionId: { type: String, trim: true, index: true },
    dataEntry: { type: mongoose.Schema.Types.ObjectId, ref: "DataSLF" },

    // Company info (denormalized for fast queries)
    companyName: { type: String, trim: true, index: true },
    companyType: { type: String, trim: true },
    submittedBy: { type: String, trim: true },

    // Transaction event
    type: {
      type: String,
      enum: [
        "submission",        // company submitted entries
        "email_ack_sent",    // acknowledgement email sent
        "email_ack_failed",  // acknowledgement email failed
        "status_change",     // admin changed status (acknowledged / rejected)
        "deleted",           // admin deleted entry
        "resubmission",      // portal user resubmitted after revert
        "revert_requested",  // portal user requested revert
        "revert_approved",   // admin approved revert
        "baseline_update_request", // portal user requested baseline field update
      ],
      required: true,
      index: true,
    },

    // Human-readable description
    description: { type: String, trim: true },

    // Who performed the action
    performedBy: { type: String, trim: true }, // email or admin name

    // Extra data (status, entry count, error message, etc.)
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Compound index for company-thread queries
transactionSchema.index({ companyName: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema, "transactions");
