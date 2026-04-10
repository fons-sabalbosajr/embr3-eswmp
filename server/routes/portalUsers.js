const express = require("express");
const UserPortal = require("../models/UserPortal");
const SlfFacility = require("../models/SlfFacility");
const { authMiddleware, adminOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const {
  sendPortalApprovalEmail,
  sendPortalRejectionEmail,
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

// Approve a portal user — assign SLF
router.patch("/:id/approve", async (req, res) => {
  try {
    const { assignedSlf } = req.body;

    if (!assignedSlf) {
      return res
        .status(400)
        .json({ message: "Please assign an SLF facility" });
    }

    // Verify the SLF exists
    const slf = await SlfFacility.findById(assignedSlf);
    if (!slf) {
      return res.status(404).json({ message: "SLF facility not found" });
    }

    const slfDisplayName = `${slf.lgu}${slf.ownership ? " (" + slf.ownership + ")" : ""}`;

    const user = await UserPortal.findByIdAndUpdate(
      req.params.id,
      {
        status: "approved",
        assignedSlf: slf._id,
        assignedSlfName: slfDisplayName,
        approvedBy: req.user.id,
        approvedAt: new Date(),
      },
      { returnDocument: "after" }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    // Send approval notification email (non-blocking)
    sendPortalApprovalEmail(user.email, user.firstName, slfDisplayName).catch(() => {});

    res.json({ message: "User approved successfully", data: user });
    writeLog("info", "portal.approve", {
      message: `Portal user approved: ${user.email}, assigned SLF: ${slfDisplayName}`,
      user: req.user.id,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update assigned SLF for an approved portal user
router.patch("/:id/update-slf", async (req, res) => {
  try {
    const { assignedSlf } = req.body;
    if (!assignedSlf) {
      return res.status(400).json({ message: "Please select an SLF facility" });
    }
    const slf = await SlfFacility.findById(assignedSlf);
    if (!slf) {
      return res.status(404).json({ message: "SLF facility not found" });
    }
    const slfDisplayName = `${slf.lgu}${slf.ownership ? " (" + slf.ownership + ")" : ""}`;
    const user = await UserPortal.findByIdAndUpdate(
      req.params.id,
      { assignedSlf: slf._id, assignedSlfName: slfDisplayName },
      { returnDocument: "after" }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Assigned SLF updated", data: user });
    writeLog("info", "portal.update-slf", {
      message: `Portal user ${user.email} reassigned to SLF: ${slfDisplayName}`,
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

module.exports = router;
