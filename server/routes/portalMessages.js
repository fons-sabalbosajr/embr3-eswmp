const express = require("express");
const mongoose = require("mongoose");
const PortalMessage = require("../models/PortalMessage");
const UserPortal = require("../models/UserPortal");
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { resolvePortalContext, sendPortalContextError } = require("../utils/portalContext");
const { emitToRoom, notifyPortal } = require("../utils/socketEmit");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Public shape returned to the portal user (never leaks recipient internals).
function serialize(m) {
  return {
    _id: m._id,
    message: m.message,
    slfName: m.slfName || "",
    senderName: m.senderName || "EMB Region III",
    status: m.status,
    createdAt: m.createdAt,
    readAt: m.readAt || null,
  };
}

// Resolve the portal users a message should go to. Either an explicit recipient
// (portalUserId / portalUserEmail) or, when the admin acts on an SLF row, every
// portal user assigned to that SLF (by facility id or by assigned SLF name).
async function resolveRecipients({ portalUserId, portalUserEmail, slfGenerator, slfName }) {
  if (portalUserId && mongoose.Types.ObjectId.isValid(String(portalUserId))) {
    const u = await UserPortal.findById(portalUserId).select("_id email assignedSlfName");
    return u ? [u] : [];
  }
  const email = String(portalUserEmail || "").trim().toLowerCase();
  if (email) {
    const u = await UserPortal.findOne({ email }).select("_id email assignedSlfName");
    return u ? [u] : [];
  }
  const or = [];
  if (slfGenerator && mongoose.Types.ObjectId.isValid(String(slfGenerator))) {
    or.push({ assignedSlf: slfGenerator });
  }
  const name = String(slfName || "").trim();
  if (name) or.push({ assignedSlfName: name });
  if (or.length === 0) return [];
  return UserPortal.find({ $or: or }).select("_id email assignedSlfName");
}

// ── Admin: send a message to an SLF's portal user(s) ──────────────────────────
router.post("/", authMiddleware, adminOnly, async (req, res) => {
  try {
    const { portalUserId, portalUserEmail, slfGenerator, slfName, message } = req.body || {};
    const text = String(message || "").trim();
    if (!text) return res.status(400).json({ message: "Message cannot be empty." });
    if (text.length > 4000) return res.status(400).json({ message: "Message is too long (max 4000 characters)." });

    const recipients = await resolveRecipients({ portalUserId, portalUserEmail, slfGenerator, slfName });
    if (recipients.length === 0) {
      return res.status(404).json({ message: "No portal user is assigned to this SLF yet." });
    }

    const senderName = req.user?.name || req.user?.username || req.user?.email || "EMB Region III";
    const senderEmail = String(req.user?.email || "").trim().toLowerCase();
    const genId = slfGenerator && mongoose.Types.ObjectId.isValid(String(slfGenerator)) ? slfGenerator : undefined;

    const created = [];
    for (const u of recipients) {
      const doc = await PortalMessage.create({
        portalUser: u._id,
        portalUserEmail: String(u.email).toLowerCase(),
        slfGenerator: genId,
        slfName: slfName || (Array.isArray(u.assignedSlfName) ? u.assignedSlfName[0] : u.assignedSlfName) || "",
        message: text,
        senderName,
        senderEmail,
      });
      created.push(doc);
      // Near-real-time delivery: a dedicated event for instant display + the bell
      // notification. No polling — the portal listens on its own room only.
      const payload = serialize(doc);
      emitToRoom(req, `portal-${String(u.email).toLowerCase()}`, "portal-message", payload);
      notifyPortal(req, String(u.email).toLowerCase(), {
        type: "portal_message",
        title: "New message from EMB Region III",
        message: text.length > 120 ? `${text.slice(0, 117)}…` : text,
      });
    }

    writeLog("info", "portal-message.sent", {
      message: `Admin sent a message to ${created.length} portal user(s) for SLF "${slfName || genId || ""}".`,
      user: senderEmail || "admin",
      ip: req.ip,
      meta: { recipients: recipients.map((u) => u.email), slfName: slfName || undefined },
    });

    res.status(201).json({ message: "Message sent.", count: created.length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Portal user: list own active (undismissed) messages ───────────────────────
router.get("/mine", async (req, res) => {
  try {
    const ctx = await resolvePortalContext(req);
    const email = String(ctx.email).toLowerCase();
    const messages = await PortalMessage.find({
      portalUserEmail: email,
      status: { $ne: "dismissed" },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(messages.map(serialize));
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Shared owner-guarded status update (read = dismiss for session, dismissed =
// Do Not Show Again). A portal user may only mutate their OWN messages.
async function updateOwnMessageStatus(req, res, patch) {
  try {
    const ctx = await resolvePortalContext(req);
    const email = String(ctx.email).toLowerCase();
    const msg = await PortalMessage.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: "Message not found." });
    if (String(msg.portalUserEmail).toLowerCase() !== email) {
      return res.status(403).json({ message: "You may only update your own messages." });
    }
    Object.assign(msg, patch);
    await msg.save();
    res.json(serialize(msg));
  } catch (error) {
    return sendPortalContextError(res, error);
  }
}

// Dismiss for the session / mark as read.
router.patch("/:id/read", (req, res) =>
  updateOwnMessageStatus(req, res, { status: "read", readAt: new Date() }),
);

// "Do Not Show Again" — permanently dismiss for this portal user.
router.patch("/:id/dismiss", (req, res) =>
  updateOwnMessageStatus(req, res, { status: "dismissed", dismissedAt: new Date() }),
);

module.exports = router;
