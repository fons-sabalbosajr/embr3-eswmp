const mongoose = require("mongoose");

const haulerDeleteRequestSchema = new mongoose.Schema(
  {
    requestNo: { type: String, unique: true, trim: true },

    // Portal user info
    portalUserEmail: { type: String, required: true, trim: true, index: true },
    portalUserName: { type: String, trim: true },
    companyName: { type: String, trim: true },
    slfName: { type: String, trim: true },

    // Hauler being requested for deletion
    haulerKey: { type: String, trim: true },
    haulerName: { type: String, required: true, trim: true },
    officeAddress: { type: String, trim: true },

    // Reason / justification
    reason: { type: String, required: true, trim: true },

    // Letter of Intent (uploaded to Google Drive)
    letterOfIntentUrl: { type: String, trim: true },
    letterOfIntentFileId: { type: String, trim: true },
    letterOfIntentFileName: { type: String, trim: true },

    // Status
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    // Admin action
    reviewedBy: { type: String, trim: true },
    reviewedAt: { type: Date },
    adminRemarks: { type: String, trim: true },
  },
  { timestamps: true }
);

// Auto-generate request number
haulerDeleteRequestSchema.pre("save", async function () {
  if (this.isNew && !this.requestNo) {
    const HaulerDeleteRequest = mongoose.model("HaulerDeleteRequest");
    const last = await HaulerDeleteRequest.findOne().sort({ createdAt: -1 });
    let seq = 1;
    if (last && last.requestNo) {
      const parts = last.requestNo.split("-");
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    this.requestNo = `HDR-${String(seq).padStart(5, "0")}`;
  }
});

haulerDeleteRequestSchema.index({ portalUserEmail: 1, createdAt: -1 });
haulerDeleteRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("HaulerDeleteRequest", haulerDeleteRequestSchema, "hauler_delete_requests");
