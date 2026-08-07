const express = require("express");
const User = require("../models/User");
const { sendAdminApprovedEmail, sendAdminRejectedEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");
const { authMiddleware, developerOnly } = require("../middleware/auth");

const router = express.Router();

// Accounts & Roles management is developer-only. Enforced here on the backend
// (not just the frontend menu) so non-developers — even with a valid admin
// token — get a 403 and cannot list, re-role, permission, or delete users.
router.use(authMiddleware, developerOnly);

// Get all users (developer)
router.get("/", async (req, res) => {
  try {
    // The demo admin is excluded so it never appears in Account Management.
    const users = await User.find({ isDemo: { $ne: true } })
      .select("-password")
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update user role
router.patch("/:id/role", async (req, res) => {
  try {
    const { role } = req.body;
    if (!["developer", "admin", "user"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { returnDocument: "after" }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Role updated", data: user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update user profile (position, designation, username)
router.patch("/:id/profile", async (req, res) => {
  try {
    const { position, designation, username } = req.body;
    const update = {};
    if (position !== undefined) update.position = position;
    if (designation !== undefined) update.designation = designation;
    if (username !== undefined) {
      if (username) {
        const existing = await User.findOne({ username, _id: { $ne: req.params.id } });
        if (existing) return res.status(400).json({ message: "Username already taken" });
      }
      update.username = username;
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Profile updated", data: user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update user permissions (developer only)
router.patch("/:id/permissions", async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!permissions || typeof permissions !== "object") {
      return res.status(400).json({ message: "Invalid permissions" });
    }
    // Use findById + save + markModified for Mixed type field
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.permissions = permissions;
    user.markModified("permissions");
    await user.save();
    const result = user.toObject();
    delete result.password;
    res.json({ message: "Permissions updated", data: result });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete user
router.delete("/:id", async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Approve user account
router.patch("/:id/approve", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isApproved: true },
      { returnDocument: "after" }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    // Send approval notification email
    try {
      await sendAdminApprovedEmail(user.email, user.firstName);
    } catch (emailErr) {
      console.error("Failed to send approval email:", emailErr.message);
    }

    writeLog("info", "users.approve", {
      message: `Account approved: ${user.email}`,
      user: user.email,
    });

    res.json({ message: "User approved", data: user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Reject (revoke approval) user account
router.patch("/:id/reject", async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isApproved: false },
      { returnDocument: "after" }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    // Send rejection notification email
    try {
      await sendAdminRejectedEmail(user.email, user.firstName, reason);
    } catch (emailErr) {
      console.error("Failed to send rejection email:", emailErr.message);
    }

    writeLog("info", "users.reject", {
      message: `Account rejected: ${user.email}${reason ? ` — ${reason}` : ""}`,
      user: user.email,
    });

    res.json({ message: "User rejected", data: user });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
