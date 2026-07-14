const express = require("express");
const Notification = require("../models/Notification");
const { notifyPortal, refreshAdmin } = require("../utils/socketEmit");

const router = express.Router();

// Require an authenticated caller on every route below. Prevents anonymous
// callers from reading or deleting any recipient's notifications by guessing an
// email/id (was fully open). Both frontends always send a Bearer token.
const { requireAnyAuth } = require("../middleware/auth");
router.use(requireAnyAuth);

const TEST_ADMIN_MESSAGE_REGEX =
  /^(admin (sent you a message|replied to .*?):\s*)?(test|testing|test message|test notification|sample message)(\s*\d*)?$/i;

function excludeTestAdminMessages(filter = {}) {
  return {
    ...filter,
    $and: [
      ...(filter.$and || []),
      {
        $nor: [
          {
            type: { $in: ["admin_message", "message_from_admin", "support_ticket_reply"] },
            $or: [
              { title: TEST_ADMIN_MESSAGE_REGEX },
              { message: TEST_ADMIN_MESSAGE_REGEX },
            ],
          },
        ],
      },
    ],
  };
}

// Admin: Get all notifications (paginated, filterable) — must be before /:recipient
router.get("/all/manage", async (req, res) => {
  try {
    const { page = 1, limit = 50, type, recipient, search, dateFrom, dateTo } = req.query;
    const filter = {};
    if (type && type !== "all") filter.type = type;
    if (recipient && recipient !== "all") filter.recipient = recipient;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } },
        { recipient: { $regex: search, $options: "i" } },
      ];
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }
    const query = excludeTestAdminMessages(filter);
    const skip = (Number(page) - 1) * Number(limit);
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Notification.countDocuments(query),
      Notification.countDocuments(excludeTestAdminMessages({ recipient: "admin", read: false })),
    ]);
    res.json({ notifications, total, unreadCount, page: Number(page), limit: Number(limit) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk delete notifications
router.post("/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ message: "ids array required" });
    // Find affected portal recipients before deleting
    const affected = await Notification.find({ _id: { $in: ids }, recipient: { $ne: "admin" } }).distinct("recipient");
    await Notification.deleteMany({ _id: { $in: ids } });
    // Notify affected portal users
    for (const email of affected) {
      notifyPortal(req, email, { type: "notification_deleted" });
    }
    res.json({ success: true, message: `${ids.length} notifications deleted` });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk mark notifications as read
router.patch("/bulk-read", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ message: "ids array required" });
    const result = await Notification.updateMany(
      { _id: { $in: ids }, read: false },
      { read: true }
    );
    // Tell the admin bell to re-read the authoritative unread count from the DB.
    refreshAdmin(req, "notifications");
    res.json({ success: true, modified: result.modifiedCount || 0 });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get notifications for a recipient (admin or portal user id)
router.get("/:recipient", async (req, res) => {
  try {
    const { recipient } = req.params;
    const { page = 1, limit = 30, dateFrom, dateTo } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = excludeTestAdminMessages({ recipient });
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient, read: false }),
    ]);

    res.json({ notifications, total, unreadCount });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get unread count only
router.get("/:recipient/unread-count", async (req, res) => {
  try {
    const count = await Notification.countDocuments(excludeTestAdminMessages({
      recipient: req.params.recipient,
      read: false,
    }));
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark single notification as read
router.patch("/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    // Keep the admin bell's unread count in sync with the DB.
    refreshAdmin(req, "notifications");
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark all as read for a recipient
router.patch("/:recipient/read-all", async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.params.recipient, read: false },
      { read: true }
    );
    // Keep the admin bell's unread count in sync with the DB.
    refreshAdmin(req, "notifications");
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a single notification
router.delete("/:id", async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (notif) {
      const recipient = notif.recipient;
      await notif.deleteOne();
      if (recipient && recipient !== "admin") {
        notifyPortal(req, recipient, { type: "notification_deleted" });
      }
    }
    res.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete all read notifications for a recipient
router.delete("/:recipient/clear-read", async (req, res) => {
  try {
    const { recipient } = req.params;
    const result = await Notification.deleteMany({ recipient, read: true });
    if (recipient !== "admin" && result.deletedCount > 0) {
      notifyPortal(req, recipient, { type: "notification_deleted" });
    }
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
