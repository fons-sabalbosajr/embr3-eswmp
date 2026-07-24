const mongoose = require("mongoose");

const supportReplySchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true },
    repliedBy: { type: String, trim: true }, // "admin" or portal user email
    repliedByName: { type: String, trim: true },
    isAdmin: { type: Boolean, default: false },
    attachments: [{ type: mongoose.Schema.Types.Mixed }],
  },
  { timestamps: true }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNo: { type: String, unique: true, trim: true },
    portalUser: { type: mongoose.Schema.Types.ObjectId, ref: "UserPortal" },
    portalUserEmail: { type: String, required: true, trim: true, index: true },
    portalUserName: { type: String, trim: true },
    companyName: { type: String, trim: true },
    slfName: { type: String, trim: true },

    subject: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        "Technical Issue",
        "Data Correction",
        "Account Access",
        "Account Issue",
        "Requirements / Compliance",
        "Submission Concern",
        "General Inquiry",
        "Feature Request",
        "Other",
      ],
      default: "General Inquiry",
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
    },
    message: { type: String, required: true, trim: true },
    attachments: [{ type: mongoose.Schema.Types.Mixed }],
    source: {
      type: String,
      enum: ["portal_ticket", "admin_message"],
      default: "portal_ticket",
      index: true,
    },

    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
    },

    // VERA processing status — separate from the admin lifecycle `status` above so
    // VERA automation never overwrites an admin's manual status. Mirrors the spec
    // workflow states.
    veraStatus: {
      type: String,
      enum: ["none", "investigating", "awaiting_user", "answered_by_vera", "escalated", "resolved"],
      default: "none",
      index: true,
    },

    // VERA investigation record (one per ticket; re-running replaces it). Stores the
    // full audit of what VERA looked at and concluded, for admin review. VERA only
    // ever writes SAFE, user-facing text into `responseSent`; raw evidence detail
    // here is admin-only and never sent to the portal user.
    veraInvestigation: {
      investigatedAt: { type: Date, default: null },
      affectedModule: { type: String, trim: true, default: "" },
      investigationSummary: { type: String, trim: true, default: "" },
      // user_correctable | validation | data | permission | api_db_failure | developer_intervention | unknown
      issueCategory: { type: String, trim: true, default: "" },
      evidenceReviewed: { type: [String], default: [] },
      confidence: { type: String, enum: ["low", "medium", "high", ""], default: "" },
      // Populated when VERA could not complete the investigation (Part 6): what it
      // still needs and the safe steps offered to the user. Kept user-safe (no logs).
      investigationComplete: { type: Boolean, default: true },
      missingInformation: { type: [String], default: [] },
      suggestedNextSteps: { type: [String], default: [] },
      responseSent: { type: String, trim: true, default: "" },
      escalationStatus: { type: String, enum: ["none", "escalated"], default: "none" },
      processingStatus: { type: String, trim: true, default: "" }, // mirrors veraStatus at completion
      source: { type: String, trim: true, default: "" }, // "model" | "fallback"
    },

    replies: [supportReplySchema],

    resolvedAt: { type: Date },
    resolvedBy: { type: String, trim: true },
    closedAt: { type: Date },
    closedBy: { type: String, trim: true },
  },
  { timestamps: true }
);

// Auto-generate ticket number
supportTicketSchema.pre("save", async function () {
  if (this.isNew && !this.ticketNo) {
    const SupportTicket = mongoose.model("SupportTicket");
    const lastTicket = await SupportTicket.findOne().sort({ createdAt: -1 });
    let seq = 1;
    if (lastTicket && lastTicket.ticketNo) {
      const parts = lastTicket.ticketNo.split("-");
      const lastNum = parseInt(parts[1], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    this.ticketNo = `TKT-${String(seq).padStart(5, "0")}`;
  }
});

supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ portalUserEmail: 1, createdAt: -1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema, "support_tickets");
