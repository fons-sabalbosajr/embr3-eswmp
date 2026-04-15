const express = require("express");
const SupportTicket = require("../models/SupportTicket");
const Notification = require("../models/Notification");
const Transaction = require("../models/Transaction");
const { writeLog } = require("../utils/logger");
const { notifyAdmin, notifyPortal, refreshAdmin } = require("../utils/socketEmit");

const router = express.Router();

// Portal: Create a support ticket
router.post("/", async (req, res) => {
  try {
    const { portalUser, portalUserEmail, portalUserName, companyName, slfName, subject, category, priority, message } = req.body;
    if (!portalUserEmail || !subject || !message) {
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
    });
    await ticket.save();

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

    res.status(201).json({ message: "Support ticket created", data: ticket });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Get my tickets
router.get("/my-tickets/:email", async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ portalUserEmail: req.params.email })
      .sort({ createdAt: -1 });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Get all tickets (paginated)
router.get("/", async (req, res) => {
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

// Admin: Get ticket by ID
router.get("/:id", async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Reply to ticket
router.post("/:id/reply", async (req, res) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const { message, repliedBy, repliedByName, isAdmin } = req.body;
    if (!message) return res.status(400).json({ message: "Message is required" });

    ticket.replies.push({ message, repliedBy, repliedByName, isAdmin: isAdmin !== false });
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
router.patch("/:id/status", async (req, res) => {
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
router.delete("/:id", async (req, res) => {
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

    const { message, repliedBy, repliedByName } = req.body;
    if (!message) return res.status(400).json({ message: "Message is required" });

    ticket.replies.push({ message, repliedBy, repliedByName, isAdmin: false });
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

module.exports = router;
