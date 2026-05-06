const mongoose = require("mongoose");

const supportReplySchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true },
    repliedBy: { type: String, trim: true }, // "admin" or portal user email
    repliedByName: { type: String, trim: true },
    isAdmin: { type: Boolean, default: false },
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

    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed"],
      default: "open",
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
