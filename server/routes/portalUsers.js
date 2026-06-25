const express = require("express");
const UserPortal = require("../models/UserPortal");
const SlfFacility = require("../models/SlfFacility");
const SupportTicket = require("../models/SupportTicket");
const Notification = require("../models/Notification");
const DataSLF = require("../models/DataSLF");
const Transaction = require("../models/Transaction");
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { notifyPortal, refreshAdmin } = require("../utils/socketEmit");
const {
  sendPortalApprovalEmail,
  sendPortalRejectionEmail,
  sendPortalVerificationReminderEmail,
  sendHoldAccountFollowUpEmail,
  sendPortalCustomEmail,
} = require("../utils/email");

const router = express.Router();

function archiveCurrentVerificationAttachment(user, { note = "", performedBy = "" } = {}) {
  if (!user?.verificationFileUrl) return false;
  const history = Array.isArray(user.verificationSubmissionHistory)
    ? user.verificationSubmissionHistory
    : [];
  const alreadyRecorded = history.some((item) => item.fileUrl === user.verificationFileUrl);
  if (!alreadyRecorded) {
    history.push({
      fileUrl: user.verificationFileUrl,
      fileDriveId: user.verificationFileDriveId || "",
      fileType: user.verificationFileType || "",
      officeEmail: user.officeEmail || "",
      pcoEmail: user.pcoEmail || "",
      action: "archived",
      note,
      performedBy,
      submittedAt: new Date(),
    });
    user.verificationSubmissionHistory = history;
  }
  user.verificationFileUrl = "";
  user.verificationFileDriveId = "";
  user.verificationFileType = "";
  return true;
}

function recordVerificationActivity(user, { action = "reviewed", note = "", performedBy = "" } = {}) {
  const history = Array.isArray(user.verificationSubmissionHistory)
    ? user.verificationSubmissionHistory
    : [];
  history.push({
    fileUrl: user.verificationFileUrl || "",
    fileDriveId: user.verificationFileDriveId || "",
    fileType: user.verificationFileType || "",
    officeEmail: user.officeEmail || "",
    pcoEmail: user.pcoEmail || "",
    action,
    note,
    performedBy,
    submittedAt: new Date(),
  });
  user.verificationSubmissionHistory = history;
}

function buildPortalActivity(user, submissions = [], transactions = [], conversations = []) {
  const items = [
    {
      type: "account_registered",
      title: "Account registered",
      description: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      createdAt: user.createdAt,
      actor: user.email,
    },
  ];
  if (user.approvedAt) {
    items.push({
      type: "account_approved",
      title: "Account approved",
      description: Array.isArray(user.assignedSlfName) ? user.assignedSlfName.join(", ") : user.assignedSlfName || "",
      createdAt: user.approvedAt,
      actor: "admin",
    });
  }
  if (user.rejectedReason) {
    items.push({
      type: "account_rejected",
      title: "Account rejected",
      description: user.rejectedReason,
      createdAt: user.updatedAt,
      actor: "admin",
    });
  }
  (user.verificationSubmissionHistory || []).forEach((entry) => {
    items.push({
      type: `verification_${entry.action || "submitted"}`,
      title: entry.action === "archived" ? "Verification attachment archived" : entry.action === "reviewed" ? "Verification reviewed" : "Verification attachment submitted",
      description: entry.note || "",
      createdAt: entry.submittedAt,
      actor: entry.performedBy || user.email,
      attachment: entry.fileUrl ? entry : null,
    });
  });
  submissions.forEach((submission) => {
    items.push({
      type: "submission",
      title: `Submission ${submission.idNo || submission.submissionId || ""}`.trim(),
      description: `${submission.lguCompanyName || ""} ${submission.status ? `(${submission.status})` : ""}`.trim(),
      createdAt: submission.createdAt,
      actor: submission.submittedBy || user.email,
    });
  });
  transactions.forEach((txn) => {
    items.push({
      type: txn.type || "transaction",
      title: txn.description || txn.type || "Transaction",
      description: txn.companyName || "",
      createdAt: txn.createdAt,
      actor: txn.performedBy || txn.submittedBy || "",
    });
  });
  conversations.forEach((thread) => {
    items.push({
      type: "conversation",
      title: `${thread.ticketNo || "Thread"} - ${thread.subject || "Conversation"}`,
      description: thread.message || "",
      createdAt: thread.createdAt,
      actor: thread.source === "admin_message" ? "admin" : thread.portalUserEmail,
      attachments: thread.attachments || [],
    });
    (thread.replies || []).forEach((reply) => {
      items.push({
        type: "conversation_reply",
        title: `Reply to ${thread.ticketNo || thread.subject || "conversation"}`,
        description: reply.message || "",
        createdAt: reply.createdAt,
        actor: reply.repliedByName || reply.repliedBy || "",
        attachments: reply.attachments || [],
      });
    });
  });
  return items
    .filter((item) => item.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getXXAlias(idNo = "") {
  const parts = String(idNo || "").split("-");
  if (parts.length >= 4 && parts[0] === "SLF" && parts[2] && parts[2] !== "XX") {
    return `SLF-${parts[1]}-XX-${parts[3]}`;
  }
  return null;
}

async function notifyPortalUserSecurityChange(req, user, { subject, message, previousEmail = "" } = {}) {
  const cleanSubject = subject || "SLF Portal Account Security Update";
  const cleanMessage =
    message ||
    "Your SLF portal account security settings were updated by the administrator. Please review your account access and contact EMB Region III if you did not expect this change.";
  const recipients = [...new Set([user.email, previousEmail].filter(Boolean))];
  await Promise.allSettled(
    recipients.map((recipient) =>
      sendPortalCustomEmail(recipient, {
        subject: cleanSubject,
        message: cleanMessage,
        firstName: user.firstName,
      }),
    ),
  );
  await Notification.create({
    recipient: user.email,
    type: "portal_user_email",
    title: cleanSubject,
    message: cleanMessage,
    meta: { portalUserId: user._id, portalUserEmail: user.email, previousEmail },
  });
  notifyPortal(req, user.email, {
    type: "portal_user_email",
    title: cleanSubject,
    message: cleanMessage,
  });
  if (previousEmail && previousEmail !== user.email) {
    notifyPortal(req, previousEmail, {
      type: "portal_user_email",
      title: cleanSubject,
      message: cleanMessage,
    });
  }
}

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
      { returnDocument: "after", runValidators: true }
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
      { returnDocument: "after", runValidators: true }
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
      { returnDocument: "after", runValidators: true }
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

    const archived = archiveCurrentVerificationAttachment(user, {
      note: user.verificationRequired
        ? "Attachment marked incorrect; new verification attachment required"
        : "Attachment archived when account was put on hold",
      performedBy: req.logUser || req.user?.email || req.user?.id || "admin",
    });
    user.verificationRequired = true;
    user.verificationSubmitted = false;
    await user.save();

    res.json({
      message: archived
        ? "Account put on hold. Previous attachment was moved to submission history."
        : "Account put on hold. User will be prompted to re-verify on next login.",
      data: user,
    });
    writeLog("info", "portal.hold", {
      message: `Portal user held for re-verification: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
      meta: { archivedAttachment: archived },
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
      { returnDocument: "after", runValidators: true }
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

// Update portal user security settings
router.patch("/:id/security", async (req, res) => {
  try {
    const {
      username,
      email,
      blocked,
      blockedReason,
      maintenanceMode,
      maintenanceReason,
      verificationRequired,
      allowCredentialSelfService,
    } = req.body || {};
    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const previousEmail = user.email;
    const previousUsername = user.username || "";
    const changedFields = [];

    if (username != null && String(username).trim().toLowerCase() !== (user.username || "")) {
      const nextUsername = String(username).trim().toLowerCase();
      if (!nextUsername) return res.status(400).json({ message: "Username is required" });
      const exists = await UserPortal.findOne({ username: nextUsername, _id: { $ne: user._id } });
      if (exists) return res.status(400).json({ message: "Username is already registered" });
      user.username = nextUsername;
      changedFields.push("username");
    }

    if (email && email.trim().toLowerCase() !== user.email) {
      const nextEmail = email.trim().toLowerCase();
      const exists = await UserPortal.findOne({ email: nextEmail, _id: { $ne: user._id } });
      if (exists) return res.status(400).json({ message: "Email is already registered" });
      user.email = nextEmail;
      changedFields.push("email");
    }
    if (typeof blocked === "boolean") {
      if (user.blocked !== blocked || user.blockedReason !== (blocked ? (blockedReason || "") : "")) changedFields.push(blocked ? "account blocked" : "account unblocked");
      user.blocked = blocked;
      user.blockedReason = blocked ? (blockedReason || "") : "";
      user.blockedAt = blocked ? new Date() : null;
      user.blockedBy = blocked ? req.user.id : null;
    }
    if (typeof maintenanceMode === "boolean") {
      if (user.maintenanceMode !== maintenanceMode || user.maintenanceReason !== (maintenanceMode ? (maintenanceReason || "") : "")) changedFields.push(maintenanceMode ? "maintenance enabled" : "maintenance disabled");
      user.maintenanceMode = maintenanceMode;
      user.maintenanceReason = maintenanceMode ? (maintenanceReason || "") : "";
      user.maintenanceAt = maintenanceMode ? new Date() : null;
    }
    if (typeof verificationRequired === "boolean") {
      if (user.verificationRequired !== verificationRequired) changedFields.push(verificationRequired ? "account hold enabled" : "account hold cleared");
      user.verificationRequired = verificationRequired;
      user.verificationSubmitted = false;
    }
    if (typeof allowCredentialSelfService === "boolean") {
      if (user.allowCredentialSelfService !== allowCredentialSelfService) {
        changedFields.push(allowCredentialSelfService ? "credential updates enabled" : "credential updates disabled");
      }
      user.allowCredentialSelfService = allowCredentialSelfService;
    }

    await user.save();
    if (previousEmail !== user.email) {
      await Promise.all([
        DataSLF.updateMany({ submittedBy: previousEmail }, { submittedBy: user.email }),
        SupportTicket.updateMany({ portalUserEmail: previousEmail }, { portalUserEmail: user.email }),
        Notification.updateMany({ recipient: previousEmail }, { recipient: user.email }),
      ]);
    }
    if (changedFields.length > 0) {
      await notifyPortalUserSecurityChange(req, user, {
        previousEmail,
        subject: "SLF Portal Account Security Settings Updated",
        message: [
          `Hello ${user.firstName || "Portal User"},`,
          "",
          "Your SLF portal account security settings were updated by the administrator.",
          `Updated setting(s): ${[...new Set(changedFields)].join(", ")}.`,
          previousUsername && previousUsername !== user.username ? `Previous username: ${previousUsername}` : "",
          previousEmail !== user.email ? `Previous email: ${previousEmail}` : "",
          "",
          "If you did not expect this update, please contact EMB Region III.",
        ].filter(Boolean).join("\n"),
      });
    }
    const safeUser = user.toObject();
    delete safeUser.password;
    res.json({ message: "Portal user security settings updated", data: safeUser });
    writeLog("info", "portal.security-update", {
      message: `Portal user security settings updated: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: manage per-user portal access (feature toggles + allowed disposal cells)
router.patch("/:id/access", async (req, res) => {
  try {
    const { canSubmitDisposal, canEditBaseline, canUploadExcel, allowedCells } =
      req.body || {};
    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const current = user.portalAccess || {};
    const next = {
      canSubmitDisposal:
        typeof canSubmitDisposal === "boolean"
          ? canSubmitDisposal
          : current.canSubmitDisposal !== false,
      canEditBaseline:
        typeof canEditBaseline === "boolean"
          ? canEditBaseline
          : current.canEditBaseline !== false,
      canUploadExcel:
        typeof canUploadExcel === "boolean"
          ? canUploadExcel
          : current.canUploadExcel !== false,
      allowedCells: Array.isArray(allowedCells)
        ? allowedCells
            .map((c) => String(c || "").trim())
            .filter(Boolean)
        : Array.isArray(current.allowedCells)
          ? current.allowedCells
          : [],
      updatedAt: new Date(),
      updatedBy: req.user?.email || req.user?.id || "admin",
    };
    user.portalAccess = next;
    user.markModified("portalAccess");
    await user.save();

    const safeUser = user.toObject();
    delete safeUser.password;
    res.json({ message: "Portal access updated", data: safeUser });
    writeLog("info", "portal.access-update", {
      message: `Portal user access updated: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin reset portal user password
router.patch("/:id/reset-password", async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const user = await UserPortal.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.password = password;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();
    await notifyPortalUserSecurityChange(req, user, {
      subject: "SLF Portal Password Reset by Administrator",
      message: `Hello ${user.firstName || "Portal User"},\n\nYour SLF portal password was reset by the administrator. Please use the new password provided to you and update it if required.\n\nIf you did not expect this update, please contact EMB Region III.`,
    });
    res.json({ message: "Portal user password reset successfully" });
    writeLog("warn", "portal.password-reset", {
      message: `Portal user password reset by admin: ${user.email}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin security warning email
router.post("/:id/security-warning", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    const { subject = "Portal Account Security Notice", message = "" } = req.body || {};
    if (!message.trim()) return res.status(400).json({ message: "Warning message is required" });

    await sendPortalCustomEmail(user.email, {
      subject: subject.trim(),
      message: message.trim(),
      firstName: user.firstName,
    });
    user.securityWarningCount = Number(user.securityWarningCount || 0) + 1;
    user.lastSecurityWarningAt = new Date();
    await user.save();
    await Notification.create({
      recipient: "admin",
      type: "portal_user_email",
      title: "Portal Security Warning Sent",
      message: `Security warning sent to ${user.email}: ${subject.trim()}`,
      meta: { portalUserId: user._id, portalUserEmail: user.email, subject: subject.trim() },
    });
    refreshAdmin(req, "notifications");
    res.json({ message: `Security warning sent to ${user.email}.`, data: user });
    writeLog("warn", "portal.security-warning", {
      message: `Security warning sent to portal user: ${user.email}`,
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
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.verificationSubmitted || user.verificationRequired) {
      recordVerificationActivity(user, {
        action: "reviewed",
        note: "Admin reviewed the latest verification attachment",
        performedBy: req.logUser || req.user?.email || req.user?.id || "admin",
      });
    }
    user.verificationRequired = false;
    user.verificationSubmitted = false;
    await user.save();

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

// Admin: Get submission tracker and conversations for a portal user
router.get("/:id/submission-history", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const [submissions, conversations] = await Promise.all([
      DataSLF.find({ submittedBy: user.email }).setOptions({ includeHiddenYears: true }).populate("slfGenerator").sort({ createdAt: -1 }).lean(),
      SupportTicket.find({ $or: [{ portalUser: user._id }, { portalUserEmail: user.email }] }).sort({ updatedAt: -1 }).lean(),
    ]);
    const submissionIds = submissions.map((submission) => submission.submissionId).filter(Boolean);
    const idNos = submissions.flatMap((submission) => [submission.idNo, getXXAlias(submission.idNo), ...(submission.previousIdNos || [])]).filter(Boolean);
    const dataEntryIds = submissions.map((submission) => submission._id).filter(Boolean);
    const txFilters = [];
    if (submissionIds.length || idNos.length) txFilters.push({ submissionId: { $in: [...submissionIds, ...idNos] } });
    if (dataEntryIds.length) txFilters.push({ dataEntry: { $in: dataEntryIds } });
    if (idNos.length) txFilters.push({ "meta.idNo": { $in: idNos } });
    if (idNos.length) txFilters.push({ "meta.ids": { $in: idNos } });
    if (idNos.length) txFilters.push({ "meta.previousIdNos": { $in: idNos } });
    const transactions = txFilters.length
      ? await Transaction.find({ $or: txFilters }).sort({ createdAt: -1 }).lean()
      : [];

    res.json({
      submissions,
      transactions,
      conversations,
      activity: buildPortalActivity(user, submissions, transactions, conversations),
      verificationHistory: user.verificationSubmissionHistory || [],
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Send editable email template to portal user
router.post("/:id/send-email", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const { subject, message, templateType = "custom" } = req.body || {};
    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ message: "Subject and message are required" });
    }

    const emailResult = await sendPortalCustomEmail(user.email, {
      subject: subject.trim(),
      message: message.trim(),
      firstName: user.firstName,
    });
    await Notification.create({
      recipient: "admin",
      type: "portal_user_email",
      title: "Portal User Email Sent",
      message: `${templateType} email sent to ${user.email}: ${subject.trim()}`,
      meta: { portalUserId: user._id, portalUserEmail: user.email, templateType, subject: subject.trim() },
    });
    refreshAdmin(req, "notifications");
    res.json({
      message: `Email sent to ${user.email}.`,
      messageId: emailResult?.messageId || null,
      accepted: emailResult?.accepted || [],
      rejected: emailResult?.rejected || [],
    });
    writeLog("info", "portal.send-email", {
      message: `Custom portal email sent to ${user.email}`,
      user: req.user.id,
      ip: req.ip,
      meta: { templateType, subject: subject.trim(), messageId: emailResult?.messageId || null },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Start a custom conversation thread with a portal user
router.post("/:id/message-threads", async (req, res) => {
  try {
    const user = await UserPortal.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const { subject, message, category = "Requirements / Compliance", priority = "Medium", attachments = [] } = req.body || {};
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
      attachments: Array.isArray(attachments) ? attachments : [],
      source: "admin_message",
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

    const { message, attachments = [] } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ message: "Message is required" });

    thread.replies.push({
      message: message.trim(),
      repliedBy: req.user?.email || req.user?.id || "admin",
      repliedByName: req.user?.username || "Admin",
      isAdmin: true,
      attachments: Array.isArray(attachments) ? attachments : [],
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

    refreshAdmin(req, "tickets");
    res.json({ message: "Reply sent", data: thread });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
