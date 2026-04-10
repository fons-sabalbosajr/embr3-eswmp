const express = require("express");
const Notification = require("../models/Notification");

const router = express.Router();

// Get notifications for a recipient (admin or portal user id)
router.get("/:recipient", async (req, res) => {
  try {
    const { recipient } = req.params;
    const { page = 1, limit = 30 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ recipient })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Notification.countDocuments({ recipient }),
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
    const count = await Notification.countDocuments({
      recipient: req.params.recipient,
      read: false,
    });
    res.json({ count });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Mark single notification as read
router.patch("/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
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
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
