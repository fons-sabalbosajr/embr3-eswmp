const mongoose = require("mongoose");

// Immutable audit trail for developer-controlled policy changes:
//   • portal-user rule assignments (Portal User Rules)
//   • official global unit changes (Baseline Data global unit)
// One document per individual change so history is fully reconstructable.
// Kept separate from AppLog (which has a 30-day TTL) because policy/audit history
// must be retained indefinitely.
const portalPolicyAuditSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["portal_rule", "global_unit"],
      required: true,
      index: true,
    },

    // Who made the change (developer). Role stored so a later privilege review is possible.
    changedBy: { type: String, trim: true, default: "" },
    changedById: { type: String, trim: true, default: "" },
    changedByRole: { type: String, trim: true, default: "" },

    // Target of the change.
    targetPortalUser: { type: mongoose.Schema.Types.ObjectId, ref: "UserPortal", default: null },
    targetPortalUserEmail: { type: String, trim: true, default: "" },
    // For global_unit changes: the facility/scope affected.
    targetFacility: { type: mongoose.Schema.Types.ObjectId, ref: "SlfFacility", default: null },
    affectedScope: { type: String, trim: true, default: "" },

    // What changed.
    ruleKey: { type: String, trim: true, default: "" }, // for portal_rule
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },

    reason: { type: String, trim: true, default: "" },
  },
  { timestamps: true, collection: "portal_policy_audit" }
);

portalPolicyAuditSchema.index({ type: 1, targetPortalUser: 1, createdAt: -1 });
portalPolicyAuditSchema.index({ type: 1, targetFacility: 1, createdAt: -1 });

module.exports = mongoose.model("PortalPolicyAudit", portalPolicyAuditSchema);
