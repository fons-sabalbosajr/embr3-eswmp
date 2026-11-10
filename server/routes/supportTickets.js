const express = require("express");
const SupportTicket = require("../models/SupportTicket");
const Notification = require("../models/Notification");
const Transaction = require("../models/Transaction");
const { writeLog } = require("../utils/logger");
const { notifyAdmin, notifyPortal, refreshAdmin } = require("../utils/socketEmit");
const multer = require("multer");
const { uploadFileToDrive } = require("../utils/googleDrive");
const { saveLocalUpload } = require("../utils/localUploadStorage");
const { uploadSingle } = require("../utils/uploadErrorHandler");
const { requireDriveActive } = require("../utils/driveMaintenanceGuard");

const router = express.Router();

// Require an authenticated caller on every route below. Support tickets contain
// user contact details and attachments; they must not be readable/editable
// anonymously. Both frontends always send a Bearer token.
const { requireAnyAuth, adminOnly, resolveCallerEmail } = require("../middleware/auth");
const { requirePortalRule } = require("../utils/portalPolicy");
const { investigateTicket } = require("../utils/veraTicketInvestigator");
router.use(requireAnyAuth);

// Is this ticket the calling portal user's own? Admins/developers always pass —
// they answer tickets for a living. Used by the by-id routes the portal reaches
// (thread refresh, portal reply), which previously accepted ANY ticket id from
// ANY signed-in portal account.
async function ownsTicketOr403(req, res, ticket) {
  if (req.user?.role !== "portal_user") return true;
  const callerEmail = await resolveCallerEmail(req);
  const ticketEmail = String(ticket?.portalUserEmail || "").trim().toLowerCase();
  if (callerEmail && ticketEmail && callerEmail === ticketEmail) return true;
  res.status(403).json({ message: "You can only view your own support tickets." });
  return false;
}

const MAX_TICKET_UPLOAD_MB = 15;
const MAX_TICKET_UPLOAD_BYTES = MAX_TICKET_UPLOAD_MB * 1024 * 1024;
const ticketUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TICKET_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
      return cb(null, true);
    }
    cb(new Error("Only image or PDF attachments are allowed."));
  },
});

// Portal: Upload a screenshot/proof image for a support ticket (stored in image folder)
router.post(
  "/upload",
  requireDriveActive,
  uploadSingle(ticketUpload, "file", { maxSizeMb: MAX_TICKET_UPLOAD_MB }),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file provided." });
      const isImage = req.file.mimetype.startsWith("image/");
      let url = "";
      let fileId = "";
      let storage = "drive";
      try {
        const driveResult = await uploadFileToDrive(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
          isImage,
          process.env.GDRIVE_IMAGE_FOLDER_ID
        );
        url = driveResult.viewUrl;
        fileId = driveResult.fileId;
      } catch (driveErr) {
        const local = await saveLocalUpload(req.file);
        url = local.url;
        storage = "local";
        writeLog("warn", "support.upload.local-fallback", {
          message: `Drive unavailable — ticket attachment stored locally: ${driveErr.message}`,
        });
      }
      res.json({
        url,
        fileId,
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        storage,
      });
    } catch (error) {
      res.status(500).json({ message: error.message || "Upload failed" });
    }
  }
);

// Portal: Create a support ticket
router.post("/", requirePortalRule("can_create_support_tickets"), async (req, res) => {
  try {
    const body = req.body || {};
    const { portalUserName, companyName, slfName, subject, category, priority, message, attachments = [] } = body;
    let { portalUser, portalUserEmail } = body;

    // The ticket belongs to whoever holds the token, not to whatever the client
    // wrote in the body. A portal session whose cached `portal_user` object was
    // stale or missing filed the ticket under the wrong (or an empty) address —
    // it then never appeared in that user's My Tickets, and the admin queue
    // showed an owner nobody could reply to. Admin/developer callers (who file
    // on a user's behalf) keep the body's identity.
    if (req.user?.role === "portal_user") {
      const callerEmail = await resolveCallerEmail(req);
      if (callerEmail) portalUserEmail = callerEmail;
      if (req.user.id) portalUser = req.user.id;
    }
    if (!portalUserEmail || !String(subject || "").trim() || !String(message || "").trim()) {
      return res.status(400).json({ message: "Email, subject, and message are required" });
    }

    const ticket = new SupportTicket({
      portalUser,
      portalUserEmail,
      portalUserName,
      companyName,
      slfName,
      subject,
      category: category || "General Inquiry",
      priority: priority || "Medium",
      message,
      attachments: Array.isArray(attachments) ? attachments : [],
    });
    // Retries the ticket number on a concurrent-insert collision (see the model).
    await SupportTicket.saveWithTicketNo(ticket);

    // Notify admin
    try {
      await Notification.create({
        recipient: "admin",
        type: "support_ticket",
        title: "New Support Ticket",
        message: `${portalUserName || portalUserEmail} raised a concern: ${subject}`,
        meta: { ticketNo: ticket.ticketNo, category, priority, portalUserEmail },
      });
    } catch { /* silent */ }
    notifyAdmin(req, { type: "support_ticket", title: "New Support Ticket", message: `${portalUserName || portalUserEmail} raised a concern` });
    refreshAdmin(req, "tickets");

    // Log transaction
    try {
      await Transaction.create({
        companyName: companyName || slfName || portalUserEmail,
        submissionId: ticket.ticketNo,
        submittedBy: portalUserEmail,
        type: "support_ticket",
        description: `Support ticket ${ticket.ticketNo} created: ${subject}`,
        performedBy: portalUserEmail,
        meta: { ticketNo: ticket.ticketNo, category, priority },
      });
    } catch { /* silent */ }

    writeLog("info", "support.create", {
      message: `Support ticket ${ticket.ticketNo} created by ${portalUserEmail}`,
      user: portalUserEmail,
      meta: { ticketNo: ticket.ticketNo },
    });

    // The ticket is SAVED — tell the user so now.
    //
    // VERA's investigation reads the account's 30-day activity log and recent
    // submissions, and it used to run before this response. The operator sat on a
    // spinner for the whole of it, and when those reads were slow the request
    // timed out client-side on a ticket that had in fact been filed — so they
    // filed it again. VERA's reply reaches them over the socket
    // (notifyPortal "support_ticket_reply", which the portal already refetches
    // on), which is how an admin's reply reaches them too.
    res.status(201).json({ message: "Support ticket created", data: ticket });

    // Best-effort, after the response: ticket creation must never fail — or
    // wait — on the investigation.
    runVeraInvestigation(ticket, req).catch((veraErr) => {
      writeLog("warn", "support.vera.auto-reply.failed", {
        message: `VERA could not auto-reply to ${ticket.ticketNo}: ${veraErr.message}`,
        user: portalUserEmail,
        meta: { ticketNo: ticket.ticketNo },
      });
    });
  } catch (error) {
    // A failed ticket is exactly the event an admin most needs to see in App
    // Logs — the user could not reach them any other way.
    writeLog("error", "support.create.failed", {
      message: `Support ticket could not be created: ${error.message}`,
      user: req.body?.portalUserEmail || "",
      ip: req.ip,
      meta: { code: error.code, name: error.name },
    });
    // A schema rejection (unknown category/priority, empty field) is the
    // caller's to fix; it was answered as a bare 500 "Server error".
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Get my tickets
router.get("/my-tickets/:email", async (req, res) => {
  try {
    // Case-insensitive exact match so a mixed-case stored email still resolves
    // the portal user's own tickets (they otherwise come up empty).
    const email = String(req.params.email || "").trim();
    if (req.user?.role === "portal_user") {
      // The caller's address comes from the token when it carries one and from
      // their account when it does not. Reading it straight off the token was
      // what made this refuse EVERY portal user: portal tokens carried no
      // `email` claim, so this compared "" against the requested address and
      // answered 403 "You can only view your own support tickets" — the exact
      // message operators were seeing instead of their ticket list.
      const callerEmail = await resolveCallerEmail(req);
      if (!callerEmail || callerEmail !== email.toLowerCase()) {
        return res.status(403).json({ message: "You can only view your own support tickets." });
      }
    }
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const { page = 1, limit = 10, search = "", status = "all", sortField = "createdAt", sortOrder = "descend" } = req.query;
    const filter = {
      portalUserEmail: new RegExp(`^${escaped}$`, "i"),
    };
    if (status && status !== "all") filter.status = status;
    if (search) {
      const pattern = { $regex: String(search).trim(), $options: "i" };
      filter.$or = [
        { ticketNo: pattern },
        { subject: pattern },
        { category: pattern },
        { priority: pattern },
        { message: pattern },
      ];
    }
    const allowedSortFields = new Set(["createdAt", "updatedAt", "ticketNo", "subject", "status", "priority", "category"]);
    const safeSortField = allowedSortFields.has(String(sortField)) ? String(sortField) : "createdAt";
    const sortDirection = String(sortOrder).toLowerCase() === "ascend" || String(sortOrder).toLowerCase() === "asc" ? 1 : -1;
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const skip = (safePage - 1) * safeLimit;
    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter).sort({ [safeSortField]: sortDirection }).skip(skip).limit(safeLimit),
      SupportTicket.countDocuments(filter),
    ]);
    res.json({ tickets, total, page: safePage, limit: safeLimit });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Get all tickets (paginated)
// `adminOnly` — this returns EVERY user's tickets, contact details and
// attachments. It was reachable by any authenticated caller, so a portal user
// could list the whole queue instead of just their own (/my-tickets/:email).
router.get("/", adminOnly, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status && status !== "all") filter.status = status;
    if (search) {
      filter.$or = [
        { ticketNo: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { portalUserEmail: { $regex: search, $options: "i" } },
        { portalUserName: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      SupportTicket.countDocuments(filter),
    ]);
    res.json({ tickets, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get ticket by ID. The portal reads this to refresh a thread after replying, so
// it stays open to portal users — but only for their OWN ticket.
router.get("/:id", async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    if (!(await ownsTicketOr403(req, res, ticket))) return undefined;
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Reply to ticket. A reply is posted as EMB — a portal user's own reply
// goes through /:id/portal-reply, which files it as theirs.
router.post("/:id/reply", adminOnly, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const { message, repliedBy, repliedByName, isAdmin, attachments = [] } = req.body;
    if (!message) return res.status(400).json({ message: "Message is required" });

    ticket.replies.push({ message, repliedBy, repliedByName, isAdmin: isAdmin !== false, attachments: Array.isArray(attachments) ? attachments : [] });
    if (ticket.status === "open") ticket.status = "in_progress";
    await ticket.save();

    // Notify portal user
    try {
      await Notification.create({
        recipient: ticket.portalUser?.toString() || ticket.portalUserEmail,
        type: "support_ticket_reply",
        title: "Support Ticket Reply",
        message: `Admin replied to your ticket ${ticket.ticketNo}: ${ticket.subject}`,
        meta: { ticketNo: ticket.ticketNo },
      });
    } catch { /* silent */ }
    notifyPortal(req, ticket.portalUserEmail, { type: "support_ticket_reply", title: "Support Ticket Reply" });
    refreshAdmin(req, "tickets");

    try {
      await Transaction.create({
        companyName: ticket.companyName || ticket.slfName || ticket.portalUserEmail,
        submissionId: ticket.ticketNo,
        submittedBy: ticket.portalUserEmail,
        type: "support_ticket_reply",
        description: `Admin replied to support ticket ${ticket.ticketNo}`,
        performedBy: repliedBy || "admin",
        meta: { ticketNo: ticket.ticketNo },
      });
    } catch { /* silent */ }

    res.json({ message: "Reply added", data: ticket });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Update ticket status
router.patch("/:id/status", adminOnly, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const { status, updatedBy } = req.body;
    ticket.status = status;
    if (status === "resolved") {
      ticket.resolvedAt = new Date();
      ticket.resolvedBy = updatedBy || "admin";
    }
    if (status === "closed") {
      ticket.closedAt = new Date();
      ticket.closedBy = updatedBy || "admin";
    }
    await ticket.save();

    res.json({ message: "Status updated", data: ticket });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Delete ticket
router.delete("/:id", adminOnly, async (req, res) => {
  try {
    await SupportTicket.findByIdAndDelete(req.params.id);
    res.json({ message: "Ticket deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Add reply from portal user
router.post("/:id/portal-reply", async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    // A portal user may only add to their own thread — the id alone used to be
    // enough to post into somebody else's conversation.
    if (!(await ownsTicketOr403(req, res, ticket))) return undefined;

    const { message, repliedBy, repliedByName, attachments = [] } = req.body;
    if (!message) return res.status(400).json({ message: "Message is required" });

    ticket.replies.push({ message, repliedBy, repliedByName, isAdmin: false, attachments: Array.isArray(attachments) ? attachments : [] });
    await ticket.save();

    // Notify admin
    try {
      await Notification.create({
        recipient: "admin",
        type: "support_ticket",
        title: "Support Ticket Update",
        message: `${repliedByName || repliedBy} replied to ticket ${ticket.ticketNo}`,
        meta: { ticketNo: ticket.ticketNo },
      });
    } catch { /* silent */ }
    notifyAdmin(req, { type: "support_ticket", title: "Ticket Update", message: `${repliedByName || repliedBy} replied to ticket ${ticket.ticketNo}` });
    refreshAdmin(req, "tickets");

    res.json({ message: "Reply added", data: ticket });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── VERA: investigate a ticket, reply, and record the result (admin/developer) ──
// Runs the evidence-first investigation, posts VERA's SAFE user-facing reply to the
// thread (visible to the portal user), and stores the admin-only investigation
// record + processing status. Never claims a fix; escalates when warranted.
async function runVeraInvestigation(ticket, req) {
  ticket.veraStatus = "investigating";
  await ticket.save();

  const result = await investigateTicket(ticket);

  // Post VERA's reply to the conversation (preserves the full thread/audit trail).
  ticket.replies.push({
    message: result.response,
    repliedBy: "vera",
    repliedByName: "VERA (Virtual Environmental Response Assistant)",
    isAdmin: true,
  });
  // The ticket stays OPEN. VERA's reply is automatic and lands a moment after the
  // ticket is filed; moving it to In Progress here took every new ticket out of
  // the admin's "open" count before anyone had seen it. TKT-00049 (a request for
  // baseline edit access) sat unanswered for 10 days that way. Only a human
  // admin reply (/:id/reply) or an explicit status change moves it forward.

  ticket.veraStatus = result.processingStatus;
  ticket.veraInvestigation = {
    investigatedAt: new Date(),
    affectedModule: result.affectedModule,
    investigationSummary: result.investigationSummary,
    issueCategory: result.issueCategory,
    investigationComplete: result.investigationComplete !== false,
    missingInformation: result.missingInformation || [],
    suggestedNextSteps: result.suggestedNextSteps || [],
    evidenceReviewed: result.evidenceReviewed,
    confidence: result.confidence,
    responseSent: result.response,
    escalationStatus: result.escalate ? "escalated" : "none",
    processingStatus: result.processingStatus,
    source: result.source,
  };
  await ticket.save();

  // Notify the portal user (their ticket thread refetches on this event) + admins.
  try {
    await Notification.create({
      recipient: ticket.portalUser?.toString() || ticket.portalUserEmail,
      type: "support_ticket_reply",
      title: "VERA replied to your ticket",
      message: `VERA responded to ${ticket.ticketNo}: ${ticket.subject}`,
      meta: { ticketNo: ticket.ticketNo, vera: true },
    });
  } catch { /* silent */ }
  notifyPortal(req, ticket.portalUserEmail, { type: "support_ticket_reply", title: "VERA replied to your ticket" });
  if (result.escalate) {
    notifyAdmin(req, { type: "support_ticket", title: "VERA escalated a ticket", message: `${ticket.ticketNo} escalated for review` });
  }
  refreshAdmin(req, "tickets");

  writeLog("info", "support.vera.investigate", {
    message: `VERA investigated ${ticket.ticketNo}: ${result.issueCategory} (${result.escalate ? "escalated" : "answered"})`,
    user: req.user?.email || "vera",
    meta: { ticketNo: ticket.ticketNo, category: result.issueCategory, escalated: result.escalate },
  });

  return result;
}

router.post("/:id/vera-investigate", adminOnly, async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    const result = await runVeraInvestigation(ticket, req);
    res.json({ message: "VERA investigation complete", data: ticket, result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Process the current highest-priority OPEN ticket not yet handled by VERA — the
// capability test entry point ("the current urgent open ticket").
router.post("/vera-investigate-urgent", adminOnly, async (req, res) => {
  try {
    const PRIORITY_ORDER = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    const candidates = await SupportTicket.find({
      status: { $in: ["open", "in_progress"] },
      veraStatus: { $in: ["none", "investigating", null] },
    }).sort({ createdAt: 1 }).limit(100);
    if (!candidates.length) return res.status(404).json({ message: "No eligible open ticket to investigate" });
    candidates.sort((a, b) =>
      (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
      new Date(a.createdAt) - new Date(b.createdAt));
    const ticket = candidates[0];
    const result = await runVeraInvestigation(ticket, req);
    res.json({ message: `VERA processed ${ticket.ticketNo}`, ticketNo: ticket.ticketNo, data: ticket, result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
