const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // "admin" or portalUserId (ObjectId as string)
    recipient: { type: String, required: true, index: true },

    type: {
      type: String,
      enum: [
        "new_submission",     // portal user submitted new data
        "resubmission",       // portal user resubmitted reverted data
        "status_change",      // admin changed status (acknowledged/rejected)
        "reverted",           // admin reverted a submission
        "new_portal_user",    // new portal user registered
        "baseline_update_request", // portal user requests baseline field update
      ],
      required: true,
    },

    title: { type: String, required: true, trim: true },
    message: { type: String, trim: true },
    read: { type: Boolean, default: false, index: true },

    // Optional references
    submissionId: { type: String, trim: true },
    dataEntry: { type: mongoose.Schema.Types.ObjectId, ref: "DataSLF" },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
