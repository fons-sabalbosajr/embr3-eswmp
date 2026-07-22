const mongoose = require("mongoose");

// Admin → portal-user direct message (Item #4). Distinct from Notification
// (system events) and MessageThread (admin-to-admin): a targeted message an admin
// sends to a specific SLF portal user, shown to that user after login with
// dismiss / do-not-show-again controls. Visible ONLY to the intended portal user.
const portalMessageSchema = new mongoose.Schema(
  {
    // Recipient portal user. Email is the stable routing key (socket rooms are
    // keyed by portal email); the ObjectId ref is kept for joins/integrity.
    portalUser: { type: mongoose.Schema.Types.ObjectId, ref: "UserPortal", index: true },
    portalUserEmail: { type: String, required: true, trim: true, lowercase: true, index: true },

    // The SLF this message is about (context for the admin's action row).
    slfGenerator: { type: mongoose.Schema.Types.ObjectId, ref: "SlfFacility" },
    slfName: { type: String, trim: true },

    message: { type: String, required: true, trim: true, maxlength: 4000 },

    // Sender (admin) identity for display + audit.
    senderName: { type: String, trim: true },
    senderEmail: { type: String, trim: true, lowercase: true },

    // sent      → delivered, not yet opened
    // read      → user dismissed for the session / opened it (still listable)
    // dismissed → "Do Not Show Again": permanently hidden for this user
    status: { type: String, enum: ["sent", "read", "dismissed"], default: "sent", index: true },
    readAt: { type: Date },
    dismissedAt: { type: Date },
  },
  { timestamps: true },
);

// Fast lookup of a user's active (undismissed) messages, newest first.
portalMessageSchema.index({ portalUserEmail: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("PortalMessage", portalMessageSchema);
