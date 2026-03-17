const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendVerificationEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Sign Up — sends verification email
router.post("/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const user = new User({ firstName, lastName, email, password, isVerified: false });
    await user.save();

    // Create a verification token (expires in 24h)
    const verifyToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "24h",
    });

    await sendVerificationEmail(email, firstName, verifyToken);

    writeLog("info", "auth.signup", { message: `New signup: ${email}`, user: email, ip: req.ip });

    res.status(201).json({
      message: "Verification email sent. Please check your inbox.",
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

    res.json({ message: "Email verified successfully. You can now log in." });
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

    if (!user.isVerified) {
      return res.status(403).json({ message: "Please verify your email before logging in" });
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

module.exports = router;
