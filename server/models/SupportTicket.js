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

// Auto-generate ticket number.
//
// The next number is read from the HIGHEST existing ticketNo, not from the most
// recently created row: the two are the same only while every ticket is filed
// one at a time. Zero-padding keeps the lexical sort numeric up to TKT-99999.
// The read-then-insert is still not atomic — two tickets filed in the same
// instant (a double-click, or a portal ticket landing while an admin message
// thread is created) can both compute the same number, and the unique index
// then rejects the second as E11000, which the route surfaced as a bare
// "Server error". `saveWithTicketNo` below is the retry that turns that
// collision into the next free number.
supportTicketSchema.pre("save", async function () {
  if (!this.ticketNo) {
    const SupportTicket = mongoose.model("SupportTicket");
    const lastTicket = await SupportTicket.findOne({ ticketNo: /^TKT-\d+$/ })
      .sort({ ticketNo: -1 })
      .select("ticketNo")
      .lean();
    let seq = 1;
    if (lastTicket && lastTicket.ticketNo) {
      const parts = lastTicket.ticketNo.split("-");
      const lastNum = parseInt(parts[1], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    this.ticketNo = `TKT-${String(seq).padStart(5, "0")}`;
  }
});

// Save a NEW ticket, regenerating its number when a concurrent insert took it.
// Any other error, and a collision that persists across `attempts`, is thrown
// unchanged so the caller's error handling is unaffected.
supportTicketSchema.statics.saveWithTicketNo = async function saveWithTicketNo(ticket, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await ticket.save();
    } catch (error) {
      const tookNumber =
        error?.code === 11000 &&
        (error.keyPattern?.ticketNo || /ticketNo/.test(String(error.message || "")));
      if (!tookNumber || attempt >= attempts) throw error;
      ticket.ticketNo = undefined; // the pre-save hook assigns the next free one
    }
  }
};

supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index({ portalUserEmail: 1, createdAt: -1 });

module.exports = mongoose.model("SupportTicket", supportTicketSchema, "support_tickets");
