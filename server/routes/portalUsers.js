const express = require("express");
const UserPortal = require("../models/UserPortal");
const SlfFacility = require("../models/SlfFacility");
const SupportTicket = require("../models/SupportTicket");
const Notification = require("../models/Notification");
const Transaction = require("../models/Transaction");
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { notifyPortal, refreshAdmin } = require("../utils/socketEmit");
const {
  sendPortalApprovalEmail,
  sendPortalRejectionEmail,
  sendPortalVerificationReminderEmail,
  sendHoldAccountFollowUpEmail,
} = require("../utils/email");

const router = express.Router();

// All routes require admin auth
router.use(authMiddleware, adminOnly);

// Get all portal users
router.get("/", async (req, res) => {
  try {
    const users = await UserPortal.find()
      .select("-password")
      .populate("approvedBy", "firstName lastName email")
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Approve a portal user — assign SLF(s)
router.patch("/:id/approve", async (req, res) => {
  try {
    const { assignedSlf } = req.body;
    const slfIds = Array.isArray(assignedSlf) ? assignedSlf : assignedSlf ? [assignedSlf] : [];

    if (slfIds.length === 0) {
      return res
        .status(400)
        .json({ message: "Please assign at least one SLF facility" });
    }

    // Verify all SLFs exist
    const slfs = await SlfFacility.find({ _id: { $in: slfIds } });
    if (slfs.length !== slfIds.length) {
      return res.status(404).json({ message: "One or more SLF facilities not found" });
    }

    const slfDisplayNames = slfs.map(
      (slf) => `${slf.lgu}${slf.ownership ? " (" + slf.ownership + ")" : ""}`
    );

    const user = await UserPortal.findByIdAndUpdate(
      req.params.id,
      {
        status: "approved",
        assignedSlf: slfs.map((s) => s._id),
        assignedSlfName: slfDisplayNames,
        approvedBy: req.user.id,
        approvedAt: new Date(),
      },
      { returnDocument: "after" }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    // Send approval notification email (non-blocking)
    sendPortalApprovalEmail(user.email, user.firstName, slfDisplayNames.join(", ")).catch(() => {});

    res.json({ message: "User approved successfully", data: user });
    writeLog("info", "portal.approve", {
      message: `Portal user approved: ${user.email}, assigned SLF: ${slfDisplayNames.join(", ")}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update assigned SLF(s) for an approved portal user
router.patch("/:id/update-slf", async (req, res) => {
  try {
    const { assignedSlf } = req.body;
    const slfIds = Array.isArray(assignedSlf) ? assignedSlf : assignedSlf ? [assignedSlf] : [];

    if (slfIds.length === 0) {
      return res.status(400).json({ message: "Please select at least one SLF facility" });
    }

    const slfs = await SlfFacility.find({ _id: { $in: slfIds } });
    if (slfs.length !== slfIds.length) {
      return res.status(404).json({ message: "One or more SLF facilities not found" });
    }

    const slfDisplayNames = slfs.map(
      (slf) => `${slf.lgu}${slf.ownership ? " (" + slf.ownership + ")" : ""}`
    );

    const user = await UserPortal.findByIdAndUpdate(
      req.params.id,
      { assignedSlf: slfs.map((s) => s._id), assignedSlfName: slfDisplayNames },
      { returnDocument: "after" }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Assigned SLF updated", data: user });
    writeLog("info", "portal.update-slf", {
      message: `Portal user ${user.email} reassigned to SLF: ${slfDisplayNames.join(", ")}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Reject a portal user
router.patch("/:id/reject", async (req, res) => {
  try {
    const { reason } = req.body;

    const user = await UserPortal.findByIdAndUpdate(
      req.params.id,
      {
        status: "rejected",
        rejectedReason: reason || "",
      },
      { returnDocument: "after" }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    // Send rejection notification email (non-blocking)
    sendPortalRejectionEmail(user.email, user.firstName, reason || "").catch(() => {});

    res.json({ message: "User rejected", data: user });
    writeLog("info", "portal.reject", {
      message: `Portal user rejected: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a portal user
router.delete("/:id", async (req, res) => {
  try {
    const user = await UserPortal.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Portal user deleted" });
    writeLog("warn", "portal.delete", {
      message: `Portal user deleted: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Hold an approved account — require the user to re-upload verification docs
router.patch("/:id/hold", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.status !== "approved") {
      return res.status(400).json({ message: "Only approved accounts can be put on hold." });
    }

    user.verificationRequired = true;
    user.verificationSubmitted = false;
    await user.save();

    res.json({ message: "Account put on hold. User will be prompted to re-verify on next login.", data: user });
    writeLog("info", "portal.hold", {
      message: `Portal user held for re-verification: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Unhold an account — clear the verification requirement
router.patch("/:id/unhold", async (req, res) => {
  try {
    const user = await UserPortal.findByIdAndUpdate(
      req.params.id,
      { verificationRequired: false, verificationSubmitted: false },
      { returnDocument: "after" }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ message: "Account hold removed.", data: user });
    writeLog("info", "portal.unhold", {
      message: `Portal user hold removed: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark verification as reviewed (admin acknowledges the re-submitted docs)
router.patch("/:id/review-verification", async (req, res) => {
  try {
    const user = await UserPortal.findByIdAndUpdate(
      req.params.id,
      { verificationRequired: false, verificationSubmitted: false },
      { returnDocument: "after" }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ message: "Verification reviewed. Account hold cleared.", data: user });
    writeLog("info", "portal.review-verification", {
      message: `Verification reviewed for portal user: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Send a verification reminder email to an approved user
router.post("/:id/send-reminder", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.status !== "approved") {
      return res.status(400).json({ message: "Reminder can only be sent to approved accounts." });
    }

    await sendPortalVerificationReminderEmail(user.email, user.firstName);

    res.json({ message: `Reminder email sent to ${user.email}.` });
    writeLog("info", "portal.send-reminder", {
      message: `Verification reminder sent to portal user: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Send hold account follow-up email with document requirements
router.post("/:id/send-hold-followup", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.verificationRequired) {
      return res.status(400).json({ message: "This account is not on hold." });
    }

    await sendHoldAccountFollowUpEmail(user.email, user.firstName);

    res.json({ message: `Hold follow-up email sent to ${user.email}.` });
    writeLog("info", "portal.send-hold-followup", {
      message: `Hold follow-up email sent to portal user: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Get conversation threads for a portal user
router.get("/:id/message-threads", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const threads = await SupportTicket.find({
      $or: [
        { portalUser: user._id },
        { portalUserEmail: user.email },
      ],
    }).sort({ updatedAt: -1 });

    res.json(threads);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Start a custom conversation thread with a portal user
router.post("/:id/message-threads", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const { subject, message, category = "Requirements / Compliance", priority = "Medium" } = req.body || {};
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    const portalUserName = `${user.firstName} ${user.lastName}`.trim();
    const thread = new SupportTicket({
      portalUser: user._id,
      portalUserEmail: user.email,
      portalUserName,
      companyName: user.companyName || "",
      slfName: Array.isArray(user.assignedSlfName) ? user.assignedSlfName.join(", ") : user.assignedSlfName || "",
      subject: subject.trim(),
      category,
      priority,
      message: message.trim(),
      status: "in_progress",
    });
    await thread.save();

    try {
      await Notification.create({
        recipient: user.email,
        type: "support_ticket_reply",
        title: "Message from Admin",
        message: `Admin sent you a message: ${thread.subject}`,
        meta: { ticketNo: thread.ticketNo, portalUserEmail: user.email },
      });
      notifyPortal(req, user.email, { type: "support_ticket_reply", title: "Message from Admin", message: thread.subject });
    } catch { /* silent */ }

    try {
      await Transaction.create({
        companyName: user.companyName || user.email,
        submissionId: thread.ticketNo,
        submittedBy: user.email,
        type: "support_ticket_reply",
        description: `Admin started conversation ${thread.ticketNo}: ${thread.subject}`,
        performedBy: req.user?.email || req.user?.id || "admin",
        meta: { ticketNo: thread.ticketNo, category, priority, portalUserEmail: user.email },
      });
    } catch { /* silent */ }

    refreshAdmin(req, "tickets");
    res.status(201).json({ message: "Message thread created", data: thread });
    writeLog("info", "portal.message.create", {
      message: `Admin started message thread ${thread.ticketNo} with ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Reply to an existing portal user conversation thread
router.post("/:id/message-threads/:threadId/reply", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const thread = await SupportTicket.findOne({
      _id: req.params.threadId,
      $or: [
        { portalUser: user._id },
        { portalUserEmail: user.email },
      ],
    });
    if (!thread) return res.status(404).json({ message: "Message thread not found" });

    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ message: "Message is required" });

    thread.replies.push({
      message: message.trim(),
      repliedBy: req.user?.email || req.user?.id || "admin",
      repliedByName: req.user?.username || "Admin",
      isAdmin: true,
    });
    if (thread.status === "open") thread.status = "in_progress";
    await thread.save();

    try {
      await Notification.create({
        recipient: user.email,
        type: "support_ticket_reply",
        title: "Message from Admin",
        message: `Admin replied to ${thread.ticketNo}: ${thread.subject}`,
        meta: { ticketNo: thread.ticketNo, portalUserEmail: user.email },
      });
      notifyPortal(req, user.email, { type: "support_ticket_reply", title: "Message from Admin", message: thread.subject });
    } catch { /* silent */ }

    try {
      await Transaction.create({
        companyName: thread.companyName || user.companyName || user.email,
        submissionId: thread.ticketNo,
        submittedBy: user.email,
        type: "support_ticket_reply",
        description: `Admin replied to conversation ${thread.ticketNo}`,
        performedBy: req.user?.email || req.user?.id || "admin",
        meta: { ticketNo: thread.ticketNo, portalUserEmail: user.email },
      });
    } catch { /* silent */ }

    refreshAdmin(req, "tickets");
    res.json({ message: "Reply sent", data: thread });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
