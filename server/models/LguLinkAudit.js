const mongoose = require("mongoose");

// Audit trail for LGU-reconciliation decisions. Every accept/reject/manual-review
// on an unlinked municipality client is recorded here, preserving the ORIGINAL
// value for audit and the before/after masterlist relationship. Immutable log —
// rows are only ever appended.
const lguLinkAuditSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "SlfClient", default: null, index: true },
    originalValue: { type: String, trim: true, default: "" }, // client's municipality text as-entered
    originalProvince: { type: String, trim: true, default: "" },
    // The suggestion that was acted on (if any).
    suggestedMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "Region3Lgu", default: null },
    suggestedName: { type: String, trim: true, default: "" },
    confidence: { type: String, trim: true, default: "" }, // high | medium | low
    method: { type: String, trim: true, default: "" },       // exact | alias | fuzzy | manual
    // What the reviewer decided.
    decision: {
      type: String,
      enum: ["accepted", "rejected", "manual-review", "alias-added", "corrected"],
      required: true,
      index: true,
    },
    reviewer: { type: String, trim: true, default: "" },
    previousLink: { type: String, trim: true, default: "" }, // prior masterlist id/name (usually none)
    newLink: { type: String, trim: true, default: "" },      // resulting masterlist id/name
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

lguLinkAuditSchema.index({ createdAt: -1 });

module.exports = mongoose.model("LguLinkAudit", lguLinkAuditSchema);
