const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { sendAdminResetPasswordEmail, sendAdminApprovalRequestEmail, sendAdminApprovedEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Sign Up — account pending developer approval
router.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = new User({ firstName, lastName, email, password, isVerified: true });
    await user.save();

    // Notify developer about new account pending approval
    try {
      const DEVELOPER_EMAIL = "slayerdark528@gmail.com";
      await sendAdminApprovalRequestEmail(DEVELOPER_EMAIL, firstName, lastName, email);
    } catch (emailErr) {
      console.error("Failed to send approval request email:", emailErr.message);
    }

    writeLog("info", "auth.signup", { message: `New signup: ${email}`, user: email, ip: req.ip });

    res.status(201).json({
      message: "Your account has been created and is pending approval by the developer. You will be notified via email once approved.",
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Verify Email
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: "Token is required" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isVerified) return res.json({ message: "Email already verified" });

    user.isVerified = true;
    await user.save();

    // Notify developer about new account pending approval
    try {
      const DEVELOPER_EMAIL = "slayerdark528@gmail.com";
      await sendAdminApprovalRequestEmail(DEVELOPER_EMAIL, user.firstName, user.lastName, user.email);
    } catch (emailErr) {
      console.error("Failed to send approval request email:", emailErr.message);
    }

    res.json({ message: "Email verified successfully. Your account is now pending approval by the developer." });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(400).json({ message: "Verification link has expired. Please sign up again." });
    }
    res.status(400).json({ message: "Invalid verification link" });
  }
});

// Login — only allow verified users
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      $or: [{ email: email }, { username: email }],
    });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (!user.isApproved && user.role !== "developer") {
      return res.status(403).json({ message: "Your account is pending approval by the developer. You will be notified once approved." });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        role: user.role,
        position: user.position,
        designation: user.designation,
        permissions: user.permissions,
      },
    });

    writeLog("info", "auth.login", { message: `Login: ${email}`, user: email, ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get current user
router.get("/me", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
});

// Forgot Password — send 6-digit reset code
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: "If that email exists, a reset code has been sent." });
    }

    const resetCode = crypto.randomInt(100000, 999999).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    await sendAdminResetPasswordEmail(user.email, user.firstName, resetCode);

    writeLog("info", "auth.forgot-password", {
      message: `Admin password reset code sent: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "If that email exists, a reset code has been sent." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Verify Reset Code
router.post("/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ message: "Email and code are required" });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetToken: code,
      resetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired code" });
    }

    res.json({ message: "Code verified" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Reset Password — verify code & update password
router.post("/reset-password", async (req, res) => {
  try {
    const { email, code, password } = req.body;
    if (!email || !code || !password) {
      return res.status(400).json({ message: "Email, code and new password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetToken: code,
      resetTokenExpiry: { $gt: new Date() },
    });
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset code" });
    }

    user.password = password;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    writeLog("info", "auth.reset-password", {
      message: `Admin password reset completed: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Password has been reset successfully. You can now log in." });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
