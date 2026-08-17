const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    // Isolates demonstration/dummy activity from production transaction history,
    // matching the flag every other collection uses. Without it, a transaction
    // written during a demo would be indistinguishable from a real one, since
    // the demo write guard can only stamp models that expose this field.
    isDummy: { type: Boolean, default: false, index: true },

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
        "baseline_update_approved", // admin approved baseline update request
        "baseline_update",   // admin updated baseline data
        "baseline_delete",   // admin cleared baseline data
        "admin_edit",        // admin edited a portal submission
        "cell_assignment",   // admin assigned submitted waste to SLF cells
        "support_ticket",    // portal user raised a support concern
        "support_ticket_reply", // admin replied to support ticket
        "submission_edit_request", // portal user requested edit on approved submission
        "submission_edit_approved", // admin approved edit request
        "submission_edit_rejected", // admin rejected edit request
        "hauler_delete_request",  // portal user submitted hauler deletion request
        "hauler_delete_approved", // admin approved hauler deletion request
        "hauler_delete_rejected", // admin rejected hauler deletion request
        "cell_capacity_alert", // admin notified portal users that a cell is nearing capacity
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

    // Portal users who dismissed this entry from their own "My Requests" list.
    // Admin audit views ignore this — the transaction is never actually deleted,
    // it is only hidden from the listed portal users.
    portalHiddenBy: [{ type: String, trim: true, lowercase: true }],
  },
  { timestamps: true }
);

// Compound index for company-thread queries
transactionSchema.index({ companyName: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ createdAt: -1 });
// Portal "My Requests": served by GET /transactions/my-requests, which selects a
// fixed set of request types for ONE portal account. Without these the query fell
// back to a case-insensitive regex $or across four fields — a collection scan of
// the whole audit log on every open and on every socket refresh.
transactionSchema.index({ submittedBy: 1, type: 1, createdAt: -1 });
transactionSchema.index({ performedBy: 1, type: 1, createdAt: -1 });
// Batch idempotency: bulk cell organization (POST /data-slf/portal-cell-assignments/bulk)
// asks "has this batchId already been applied?" before writing anything. Without
// this the lookup fell back to {type,createdAt} and scanned every bulk record ever
// written, on the hot path of an operation the user is waiting on. Sparse — only
// batched writes carry a batchId.
transactionSchema.index({ "meta.batchId": 1 }, { sparse: true });

module.exports = mongoose.model("Transaction", transactionSchema, "transactions");
