const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");
const {
  sendPortalSignupEmail,
  sendPortalResetPasswordEmail,
} = require("../utils/email");

const router = express.Router();

// Portal Sign Up — register as SLF portal user (pending approval)
router.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password, contactNumber, companyName } =
      req.body;

    const existing = await UserPortal.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = new UserPortal({
      firstName,
      lastName,
      email,
      password,
      contactNumber: contactNumber || "",
      companyName: companyName || "",
      status: "pending",
      isVerified: true, // auto-verified, admin approval is the gate
    });
    await user.save();

    // Send signup confirmation email (non-blocking)
    sendPortalSignupEmail(user.email, user.firstName).catch(() => {});

    writeLog("info", "portal.signup", {
      message: `Portal signup: ${email}`,
      user: email,
      ip: req.ip,
    });

    res
      .status(201)
      .json({
        message:
          "Registration submitted successfully. Please wait for admin approval.",
      });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal Login — only approved accounts
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await UserPortal.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.status === "pending") {
      return res
        .status(403)
        .json({
          message:
            "Your account is still pending approval. Please wait for admin approval.",
        });
    }
    if (user.status === "rejected") {
      return res
        .status(403)
        .json({
          message:
            "Your account registration has been rejected. Please contact the administrator.",
        });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, role: "portal_user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        contactNumber: user.contactNumber,
        companyName: user.companyName,
        assignedSlf: user.assignedSlf,
        assignedSlfName: user.assignedSlfName,
        role: "portal_user",
      },
    });

    writeLog("info", "portal.login", {
      message: `Portal login: ${email}`,
      user: email,
      ip: req.ip,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get current portal user
router.get("/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await UserPortal.findById(decoded.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
});

// Get submission history for the logged-in portal user
router.get("/my-submissions", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await UserPortal.findById(decoded.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const DataSLF = require("../models/DataSLF");
    const submissions = await DataSLF.find({
      submittedBy: user.email,
    }).sort({ createdAt: -1 });

    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Forgot Password — send reset link
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await UserPortal.findOne({ email: email.toLowerCase() });
    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: "If that email exists, a reset link has been sent." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetToken = resetToken;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173/eswm-pipeline";
    const resetLink = `${CLIENT_URL}/slfportal/reset-password?token=${resetToken}`;

    await sendPortalResetPasswordEmail(user.email, user.firstName, resetLink);

    writeLog("info", "portal.forgot-password", {
      message: `Password reset requested: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "If that email exists, a reset link has been sent." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Reset Password — verify token & update password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await UserPortal.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    user.password = password;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    writeLog("info", "portal.reset-password", {
      message: `Password reset completed: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Password has been reset successfully. You can now log in." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
