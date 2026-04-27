const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const multer = require("multer");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");
const { uploadFileToDrive } = require("../utils/googleDrive");
const {
  sendPortalSignupEmail,
  sendPortalResetPasswordEmail,
} = require("../utils/email");

const router = express.Router();

// Multer: memory storage — files stay in RAM as Buffer for Drive upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter(req, file, cb) {
    const allowed = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Unsupported file type. Please upload an image or PDF/DOC/DOCX."));
  },
});

// Portal Sign Up — register as SLF portal user (pending approval)
// Accepts multipart/form-data with an optional verificationFile field.
router.post("/signup", upload.single("verificationFile"), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      contactNumber,
      companyName,
      officeEmail,
      pcoEmail,
    } = req.body;

    const existing = await UserPortal.findOne({ email: email?.toLowerCase() });
    if (existing) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Upload verification file to Google Drive if provided
    let verificationFileUrl = "";
    let verificationFileDriveId = "";
    let verificationFileType = "";

    if (req.file) {
      const isImage = req.file.mimetype.startsWith("image/");
      verificationFileType = isImage ? "image" : "document";
      try {
        const driveResult = await uploadFileToDrive(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
          isImage
        );
        verificationFileUrl = driveResult.viewUrl;
        verificationFileDriveId = driveResult.fileId;
      } catch (driveErr) {
        // Log but do not block registration
        writeLog("warn", "portal.signup.drive", {
          message: `Drive upload failed for ${email}: ${driveErr.message}`,
          user: email,
          ip: req.ip,
        });
        // Non-blocking — registration continues even if Drive upload fails
      }
    }

    const user = new UserPortal({
      firstName,
      lastName,
      email,
      password,
      contactNumber: contactNumber || "",
      companyName: companyName || "",
      officeEmail: officeEmail || "",
      pcoEmail: pcoEmail || "",
      verificationFileUrl,
      verificationFileDriveId,
      verificationFileType,
      status: "pending",
      isVerified: true, // auto-verified; admin approval is the gate
    });
    await user.save();

    // Send signup confirmation email (non-blocking)
    sendPortalSignupEmail(user.email, user.firstName).catch(() => {});

    // Notify admins of new portal user
    try {
      const Notification = require("../models/Notification");
      await Notification.create({
        recipient: "admin",
        type: "new_portal_user",
        title: "New Portal Registration",
        message: `${firstName} ${lastName} (${email}) registered and is pending approval`,
        meta: { email, companyName: companyName || "" },
      });
    } catch { /* silent */ }

    writeLog("info", "portal.signup", {
      message: `Portal signup: ${email}`,
      user: email,
      ip: req.ip,
    });

    res.status(201).json({
      message: "Registration submitted successfully. Please wait for admin approval.",
    });
  } catch (error) {
    if (error.message?.includes("Unsupported file type")) {
      return res.status(400).json({ message: error.message });
    }
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
      return res.status(403).json({
        message: "Your account is still pending approval. Please wait for admin approval.",
      });
    }
    if (user.status === "rejected") {
      return res.status(403).json({
        message: "Your account registration has been rejected. Please contact the administrator.",
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
      // Flag so the front-end can redirect held users to the verification form
      needsVerification: user.verificationRequired && !user.verificationSubmitted,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        contactNumber: user.contactNumber,
        companyName: user.companyName,
        officeEmail: user.officeEmail,
        pcoEmail: user.pcoEmail,
        assignedSlf: user.assignedSlf,
        assignedSlfName: user.assignedSlfName,
        verificationRequired: user.verificationRequired,
        verificationSubmitted: user.verificationSubmitted,
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
      deletedAt: null,
    })
      .populate("slfGenerator")
      .sort({ createdAt: -1 })
      .lean();

    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Forgot Password — send 6-digit reset code
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await UserPortal.findOne({ email: email.toLowerCase() });
    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({ message: "If that email exists, a reset code has been sent." });
    }

    const resetCode = crypto.randomInt(100000, 999999).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    await sendPortalResetPasswordEmail(user.email, user.firstName, resetCode);

    writeLog("info", "portal.forgot-password", {
      message: `Password reset code sent: ${user.email}`,
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

    const user = await UserPortal.findOne({
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

    const user = await UserPortal.findOne({
      email: email.toLowerCase(),
      resetToken: code,
      resetTokenExpiry: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset code" });
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

// Submit Verification Update — for held accounts to re-upload docs + update info
// Requires a valid portal JWT token.
router.post("/submit-verification", upload.single("verificationFile"), async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await UserPortal.findById(decoded.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.verificationRequired) {
      return res.status(400).json({ message: "No verification update is required for this account." });
    }

    const { officeEmail, pcoEmail } = req.body;

    // Upload new verification file if provided
    if (req.file) {
      const isImage = req.file.mimetype.startsWith("image/");
      try {
        const driveResult = await uploadFileToDrive(
          req.file.buffer,
          req.file.mimetype,
          req.file.originalname,
          isImage
        );
        user.verificationFileUrl = driveResult.viewUrl;
        user.verificationFileDriveId = driveResult.fileId;
        user.verificationFileType = isImage ? "image" : "document";
      } catch (driveErr) {
        writeLog("warn", "portal.verification.drive", {
          message: `Drive upload failed for ${user.email}: ${driveErr.message}`,
          user: user.email,
          ip: req.ip,
        });
        return res.status(502).json({ message: `File upload to Drive failed: ${driveErr.message}` });
      }
    }

    if (officeEmail) user.officeEmail = officeEmail.trim().toLowerCase();
    if (pcoEmail) user.pcoEmail = pcoEmail.trim().toLowerCase();
    user.verificationSubmitted = true;

    await user.save();

    writeLog("info", "portal.verification.submit", {
      message: `Verification update submitted: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Verification information submitted. The admin will review your update." });
  } catch (error) {
    if (error.message?.includes("Unsupported file type")) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
