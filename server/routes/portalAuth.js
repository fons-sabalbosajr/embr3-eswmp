const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const multer = require("multer");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");
const { uploadFileToDrive } = require("../utils/googleDrive");
const {
  saveVerificationFile,
  resolveVerificationFile,
} = require("../utils/verificationFileStorage");
const { uploadSingle } = require("../utils/uploadErrorHandler");
const {
  sendPortalSignupEmail,
  sendPortalResetPasswordEmail,
  sendPortalCustomEmail,
} = require("../utils/email");
const { notifyAdmin } = require("../utils/socketEmit");
const Notification = require("../models/Notification");

const router = express.Router();

async function getPortalUserFromToken(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ message: "No token provided" });
    return null;
  }
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await UserPortal.findById(decoded.id);
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return null;
  }
  return user;
}

async function getCredentialUpdateUser(req, res) {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) return getPortalUserFromToken(req, res);

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) {
    res.status(400).json({ message: "Registered email is required" });
    return null;
  }
  const user = await UserPortal.findOne({ email });
  if (!user) {
    res.status(404).json({ message: "Portal user account not found" });
    return null;
  }
  return user;
}

function ensureCredentialSelfServiceEnabled(user, res) {
  if (!user?.allowCredentialSelfService) {
    res.status(403).json({ message: "Portal credential updates are currently disabled." });
    return false;
  }
  return true;
}

async function saveVerificationAttachment(req, file, email, logContext) {
  const isImage = file.mimetype.startsWith("image/");
  try {
    const driveResult = await uploadFileToDrive(
      file.buffer,
      file.mimetype,
      file.originalname,
      isImage
    );
    return {
      url: driveResult.viewUrl,
      driveId: driveResult.fileId,
      fileType: isImage ? "image" : "document",
    };
  } catch (driveErr) {
    writeLog("warn", `${logContext}.drive`, {
      message: `Drive upload failed for ${email}: ${driveErr.message}`,
      user: email,
      ip: req.ip,
    });

    const localResult = await saveVerificationFile(file);
    writeLog("info", `${logContext}.local-fallback`, {
      message: `Drive unavailable — verification file stored locally for ${email}`,
      user: email,
      ip: req.ip,
      meta: { fileName: localResult.fileName },
    });
    console.info(`[portal-auth] Verification file saved locally (Drive unavailable) — ${localResult.fileName}`);

    return {
      url: localResult.url,
      driveId: "",
      fileType: isImage ? "image" : "document",
    };
  }
}

function recordVerificationSubmission(user, { action = "submitted", note = "", performedBy = "" } = {}) {
  if (!user.verificationFileUrl) return;
  const history = Array.isArray(user.verificationSubmissionHistory)
    ? user.verificationSubmissionHistory
    : [];
  const alreadyRecorded = history.some(
    (item) => item.fileUrl === user.verificationFileUrl && item.action === action
  );
  if (alreadyRecorded) return;
  history.push({
    fileUrl: user.verificationFileUrl,
    fileDriveId: user.verificationFileDriveId || "",
    fileType: user.verificationFileType || "",
    officeEmail: user.officeEmail || "",
    pcoEmail: user.pcoEmail || "",
    action,
    note,
    performedBy,
    submittedAt: new Date(),
  });
  user.verificationSubmissionHistory = history;
}

router.get("/verification-files/:fileName", (req, res) => {
  try {
    const filePath = resolveVerificationFile(req.params.fileName);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.sendFile(filePath, (error) => {
      if (error && !res.headersSent) {
        res.status(error.statusCode === 404 ? 404 : 500).json({ message: "File not found" });
      }
    });
  } catch {
    res.status(400).json({ message: "Invalid file path" });
  }
});

// Multer: memory storage — files stay in RAM as Buffer for Drive upload
const MAX_UPLOAD_MB = 200;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
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
router.get("/check-existing", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const username = String(req.query.username || "").trim().toLowerCase();
    if (!email && !username) return res.status(400).json({ message: "Email or username is required." });
    const existing = await UserPortal.findOne({
      $or: [
        email ? { email } : null,
        username ? { username } : null,
      ].filter(Boolean),
    }).select("email username status");
    res.json({
      exists: !!existing,
      emailMatch: !!existing && !!email && existing.email === email,
      usernameMatch: !!existing && !!username && existing.username === username,
      status: existing?.status || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/signup", uploadSingle(upload, "verificationFile", { maxSizeMb: MAX_UPLOAD_MB }), async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      username,
      password,
      contactNumber,
      companyName,
      officeEmail,
      pcoEmail,
    } = req.body;

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedUsername = String(username || normalizedEmail.split("@")[0] || "")
      .trim()
      .toLowerCase();
    const existing = await UserPortal.findOne({
      $or: [
        { email: normalizedEmail },
        ...(normalizedUsername ? [{ username: normalizedUsername }] : []),
      ],
    });
    if (existing) {
      return res.status(400).json({ message: "Email or username already registered" });
    }

    // Upload verification file to Google Drive if provided
    let verificationFileUrl = "";
    let verificationFileDriveId = "";
    let verificationFileType = "";

    if (req.file) {
      try {
        const storedFile = await saveVerificationAttachment(req, req.file, email, "portal.signup");
        verificationFileUrl = storedFile.url;
        verificationFileDriveId = storedFile.driveId;
        verificationFileType = storedFile.fileType;
      } catch (fileErr) {
        // Log but do not block registration
        writeLog("warn", "portal.signup.file", {
          message: `Verification file storage failed for ${email}: ${fileErr.message}`,
          user: email,
          ip: req.ip,
        });
        // Non-blocking — registration continues even if attachment storage fails
      }
    }

    const user = new UserPortal({
      firstName,
      lastName,
      email: normalizedEmail,
      username: normalizedUsername,
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
    recordVerificationSubmission(user, {
      action: "submitted",
      note: "Initial portal registration attachment",
      performedBy: normalizedEmail,
    });
    await user.save();

    // Send signup confirmation email (non-blocking)
    sendPortalSignupEmail(user.email, user.firstName).catch(() => {});

    // Notify admins of new portal user
    try {
      await Notification.create({
        recipient: "admin",
        type: "new_portal_user",
        title: "New Portal Registration",
        message: `${firstName} ${lastName} (${email}) registered and is pending approval`,
        meta: { email, companyName: companyName || "" },
      });
      notifyAdmin(req, { type: "new_portal_user", title: "New Portal Registration", message: `${firstName} ${lastName} (${email}) registered and is pending approval` });
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
    const loginId = String(email || "").trim().toLowerCase();

    const user = await UserPortal.findOne({
      $or: [{ email: loginId }, { username: loginId }],
    });
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
    if (user.blocked) {
      return res.status(403).json({
        message: user.blockedReason || "Your portal account is blocked. Please contact the administrator.",
      });
    }
    if (user.maintenanceMode) {
      return res.status(403).json({
        message: user.maintenanceReason || "Your portal account is temporarily under maintenance. Please contact the administrator.",
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
      // Flag so the front-end can keep held users out of the portal until admin review clears the hold.
      needsVerification: user.verificationRequired,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        contactNumber: user.contactNumber,
        companyName: user.companyName,
        officeEmail: user.officeEmail,
        pcoEmail: user.pcoEmail,
        assignedSlf: user.assignedSlf,
        assignedSlfName: user.assignedSlfName,
        verificationRequired: user.verificationRequired,
        verificationSubmitted: user.verificationSubmitted,
        allowCredentialSelfService: user.allowCredentialSelfService,
        status: user.status,
        isVerified: user.isVerified,
        role: "portal_user",
      },
    });

    writeLog("info", "portal.login", {
      message: `Portal login: ${loginId}`,
      user: loginId,
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
    if (user.blocked) {
      return res.status(403).json({ message: user.blockedReason || "Portal account blocked" });
    }
    if (user.maintenanceMode) {
      return res.status(403).json({ message: user.maintenanceReason || "Portal account under maintenance" });
    }

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

    sendPortalResetPasswordEmail(user.email, user.firstName, resetCode).catch((emailErr) => {
      console.error("Failed to send portal reset password email:", emailErr.message);
    });

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
// Request verification code before changing logged-in portal credentials
router.post("/credentials/request-code", async (req, res) => {
  try {
    const user = await getCredentialUpdateUser(req, res);
    if (!user) return;
    if (!ensureCredentialSelfServiceEnabled(user, res)) return;
    if (user.blocked) {
      return res.status(403).json({ message: user.blockedReason || "Portal account blocked" });
    }
    if (user.maintenanceMode) {
      return res.status(403).json({ message: user.maintenanceReason || "Portal account under maintenance" });
    }

    const { username, password } = req.body || {};
    const nextUsername = String(username || user.username || "").trim().toLowerCase();
    if (!nextUsername) return res.status(400).json({ message: "Username is required" });
    if (password && String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const existing = await UserPortal.findOne({ username: nextUsername, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ message: "Username is already registered" });
    if ((user.username || "") === nextUsername && !password) {
      return res.status(400).json({ message: "Enter a new username or password before requesting a code" });
    }

    const resetCode = crypto.randomInt(100000, 999999).toString();
    user.resetToken = resetCode;
    user.resetTokenExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    sendPortalCustomEmail(user.email, {
      subject: "SLF Portal Credential Verification Code",
      firstName: user.firstName,
      message: `Use this verification code to update your SLF portal credentials: ${resetCode}\n\nThis code will expire in 10 minutes. If you did not request a credential update, please contact EMB Region III immediately.`,
    }).catch((emailErr) => {
      console.error("Failed to send portal credential verification code:", emailErr.message);
    });

    writeLog("info", "portal.credentials.request-code", {
      message: `Credential change code sent: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Verification code sent to your registered email." });
  } catch (error) {
    res.status(error.name === "JsonWebTokenError" ? 401 : 500).json({
      message: error.name === "JsonWebTokenError" ? "Invalid token" : "Server error",
      error: error.message,
    });
  }
});

// Verify code and update logged-in portal credentials
router.post("/credentials/update", async (req, res) => {
  try {
    const user = await getCredentialUpdateUser(req, res);
    if (!user) return;
    if (!ensureCredentialSelfServiceEnabled(user, res)) return;
    if (user.blocked) {
      return res.status(403).json({ message: user.blockedReason || "Portal account blocked" });
    }
    if (user.maintenanceMode) {
      return res.status(403).json({ message: user.maintenanceReason || "Portal account under maintenance" });
    }

    const { username, password, code } = req.body || {};
    const nextUsername = String(username || "").trim().toLowerCase();
    if (!nextUsername || !code) {
      return res.status(400).json({ message: "Username and verification code are required" });
    }
    if (password && String(password).length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    if (user.resetToken !== String(code).trim() || !user.resetTokenExpiry || user.resetTokenExpiry <= new Date()) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }
    const existing = await UserPortal.findOne({ username: nextUsername, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ message: "Username is already registered" });
    if ((user.username || "") === nextUsername && !password) {
      return res.status(400).json({ message: "Enter a new username or password before saving credentials" });
    }

    const changed = [];
    if (user.username !== nextUsername) {
      user.username = nextUsername;
      changed.push("username");
    }
    if (password) {
      user.password = password;
      changed.push("password");
    }
    user.allowCredentialSelfService = false;
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    await Notification.create({
      recipient: user.email,
      type: "portal_user_email",
      title: "Portal Credentials Updated",
      message: `Your SLF portal ${changed.join(" and ") || "credentials"} were updated successfully. Please log in again.`,
      meta: { portalUserId: user._id, portalUserEmail: user.email, changed },
    });

    writeLog("info", "portal.credentials.update", {
      message: `Portal credentials updated: ${user.email}`,
      user: user.email,
      ip: req.ip,
      meta: { changed },
    });

    res.json({ message: "Credentials updated. Please log in again." });
  } catch (error) {
    res.status(error.name === "JsonWebTokenError" ? 401 : 500).json({
      message: error.name === "JsonWebTokenError" ? "Invalid token" : "Server error",
      error: error.message,
    });
  }
});

router.post("/submit-verification", uploadSingle(upload, "verificationFile", { maxSizeMb: MAX_UPLOAD_MB }), async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "No token provided" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await UserPortal.findById(decoded.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.verificationRequired) {
      return res.status(400).json({ message: "No verification update is required for this account." });
    }
    if (user.verificationSubmitted) {
      return res.status(400).json({ message: "Your verification documents are already submitted and awaiting admin review." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a verification attachment before submitting." });
    }

    const { officeEmail, pcoEmail } = req.body;

    // Upload new verification file if provided
    try {
      const storedFile = await saveVerificationAttachment(req, req.file, user.email, "portal.verification");
      user.verificationFileUrl = storedFile.url;
      user.verificationFileDriveId = storedFile.driveId;
      user.verificationFileType = storedFile.fileType;
    } catch (fileErr) {
      writeLog("error", "portal.verification.file", {
        message: `Verification file storage failed for ${user.email}: ${fileErr.message}`,
        user: user.email,
        ip: req.ip,
      });
      return res.status(500).json({ message: "File upload failed. Please try again." });
    }

    if (officeEmail) user.officeEmail = officeEmail.trim().toLowerCase();
    if (pcoEmail) user.pcoEmail = pcoEmail.trim().toLowerCase();
    user.verificationSubmitted = true;
    recordVerificationSubmission(user, {
      action: "submitted",
      note: "Re-verification attachment submitted for admin review",
      performedBy: user.email,
    });

    await user.save();

    // Notify admin that verification docs were submitted
    try {
      await Notification.create({
        recipient: "admin",
        type: "portal_verification_submitted",
        title: "Verification Documents Submitted",
        message: `${user.firstName} ${user.lastName} (${user.email}) has submitted their verification documents for review.`,
        meta: { email: user.email },
      });
      notifyAdmin(req, { type: "portal_verification_submitted", title: "Verification Docs Submitted", message: `${user.firstName} ${user.lastName} submitted verification docs` });
    } catch { /* silent */ }

    writeLog("info", "portal.verification.submit", {
      message: `Verification update submitted: ${user.email}`,
      user: user.email,
      ip: req.ip,
    });

    res.json({ message: "Verification information submitted. Please wait for admin review before accessing the portal." });
  } catch (error) {
    if (error.message?.includes("Unsupported file type")) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
