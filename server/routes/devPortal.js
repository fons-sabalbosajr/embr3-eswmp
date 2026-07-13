const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const AppSettings = require("../models/AppSettings");
const User = require("../models/User");
const UserPortal = require("../models/UserPortal");
const { authMiddleware, developerOnly } = require("../middleware/auth");
const { sendDevPortalPinEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");

const router = express.Router();

// Fixed override username used on the portal login page for developer debug
// access. Normal users can never use it because the override still requires a
// valid, active developer account password.
const OVERRIDE_USERNAME = "embr3dev";
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

async function getSettings() {
  let settings = await AppSettings.findOne();
  if (!settings) settings = await AppSettings.create({});
  return settings;
}

// Verify a staged dev token AND that the developer account is still active
// (real `developer` role + approved). This re-check on every stage prevents a
// suspended/deactivated developer from continuing an in-progress flow.
async function requireDevStage(req, res, stage) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    res.status(401).json({ message: "Missing developer session token." });
    return null;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.status(401).json({ message: "Invalid or expired developer session." });
    return null;
  }
  if (decoded.stage !== stage || !decoded.devId) {
    res.status(403).json({ message: "Wrong developer session stage." });
    return null;
  }
  const dev = await User.findById(decoded.devId);
  if (!dev || dev.role !== "developer" || !dev.isApproved) {
    res.status(403).json({ message: "Developer account is not active." });
    return null;
  }
  return dev;
}

/* ───────────── Developer-only PIN management (dev logged into admin) ───────── */

// Status for the Dev Portal Credential settings tab. Never returns the PIN.
router.get("/status", authMiddleware, developerOnly, async (_req, res) => {
  try {
    const s = await getSettings();
    const locked = s.devPortalPinLockedUntil && s.devPortalPinLockedUntil > new Date();
    res.json({
      pinSet: Boolean(s.devPortalPinHash),
      updatedAt: s.devPortalPinUpdatedAt,
      locked: Boolean(locked),
      lockedUntil: locked ? s.devPortalPinLockedUntil : null,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Set/update the PIN. Requires the developer's own account password.
router.post("/pin", authMiddleware, developerOnly, async (req, res) => {
  try {
    const { pin, currentPassword } = req.body || {};
    if (!/^\d{4,8}$/.test(String(pin || ""))) {
      return res.status(400).json({ message: "PIN must be 4 to 8 digits." });
    }
    const dev = await User.findById(req.user.id);
    if (!dev || dev.role !== "developer" || !dev.isApproved) {
      return res.status(403).json({ message: "Developer account is not active." });
    }
    const ok = await dev.comparePassword(String(currentPassword || ""));
    if (!ok) return res.status(401).json({ message: "Current developer password is incorrect." });

    const s = await getSettings();
    s.devPortalPinHash = await bcrypt.hash(String(pin), 10);
    s.devPortalPinUpdatedAt = new Date();
    s.devPortalPinFailedAttempts = 0;
    s.devPortalPinLockedUntil = null;
    await s.save();
    writeLog("info", "dev-portal.pin.set", { message: "Dev Portal PIN updated", user: dev.email, ip: req.ip });
    res.json({ message: "Dev Portal PIN updated." });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Generate a new PIN server-side and email it ONLY to the developer. The PIN is
// never returned in the response or written to logs.
router.post("/regenerate-pin", authMiddleware, developerOnly, async (req, res) => {
  try {
    const dev = await User.findById(req.user.id);
    if (!dev || dev.role !== "developer" || !dev.isApproved) {
      return res.status(403).json({ message: "Developer account is not active." });
    }
    const pin = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const s = await getSettings();
    s.devPortalPinHash = await bcrypt.hash(pin, 10);
    s.devPortalPinUpdatedAt = new Date();
    s.devPortalPinFailedAttempts = 0;
    s.devPortalPinLockedUntil = null;
    await s.save();

    try {
      await sendDevPortalPinEmail(dev.email, dev.firstName, pin);
    } catch (mailErr) {
      writeLog("error", "dev-portal.pin.email-failed", {
        message: `Failed to email regenerated PIN: ${mailErr.message}`,
        user: dev.email, ip: req.ip,
      });
      return res.status(502).json({
        message: "PIN was regenerated but the email could not be sent. Check the email/SMTP configuration.",
      });
    }
    writeLog("warn", "dev-portal.pin.regenerate", { message: "Dev Portal PIN regenerated and emailed", user: dev.email, ip: req.ip });
    res.json({ message: `A new PIN was emailed to ${dev.email}.` });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

/* ─────────────── Portal-login developer override flow (staged) ────────────── */

// Stage 1: verify developer email + password (must be an active developer).
// No special access username/link — authentication is the developer's own
// account credentials, gated by the Dev Portal PIN in stage 2.
router.post("/override", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const dev = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    // Uniform failure message to avoid leaking which field was wrong.
    const invalid = () => res.status(401).json({ message: "Invalid developer override credentials." });
    if (!dev || dev.role !== "developer") return invalid();
    if (!dev.isApproved) {
      return res.status(403).json({ message: "This developer account is deactivated." });
    }
    const ok = await dev.comparePassword(String(password || ""));
    if (!ok) return invalid();

    const s = await getSettings();
    if (!s.devPortalPinHash) {
      return res.status(400).json({
        message: "No Dev Portal PIN is configured. Set it under Developer > App Settings > Dev Portal Credential.",
      });
    }
    const stageToken = jwt.sign(
      { stage: "devOverride", devId: String(dev._id) },
      process.env.JWT_SECRET,
      { expiresIn: "5m" },
    );
    writeLog("info", "dev-portal.override", { message: "Dev override password verified", user: dev.email, ip: req.ip });
    res.json({ message: "Password verified. Enter your PIN to continue.", stageToken, requiresPin: true });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Stage 2: verify the PIN (requires the stage-1 token). Locks out after repeated
// failures. Validated only here on the backend against the stored hash.
router.post("/verify-pin", async (req, res) => {
  try {
    const dev = await requireDevStage(req, res, "devOverride");
    if (!dev) return;
    const s = await getSettings();
    if (!s.devPortalPinHash) return res.status(400).json({ message: "No Dev Portal PIN is configured." });
    if (s.devPortalPinLockedUntil && s.devPortalPinLockedUntil > new Date()) {
      return res.status(429).json({ message: `Too many attempts. Try again after ${new Date(s.devPortalPinLockedUntil).toLocaleTimeString()}.` });
    }
    const ok = await bcrypt.compare(String(req.body?.pin || ""), s.devPortalPinHash);
    if (!ok) {
      s.devPortalPinFailedAttempts = (s.devPortalPinFailedAttempts || 0) + 1;
      let locked = false;
      if (s.devPortalPinFailedAttempts >= MAX_PIN_ATTEMPTS) {
        s.devPortalPinLockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60000);
        s.devPortalPinFailedAttempts = 0;
        locked = true;
      }
      await s.save();
      writeLog("warn", "dev-portal.pin.fail", { message: "Dev Portal PIN attempt failed", user: dev.email, ip: req.ip });
      return res.status(401).json({
        message: locked ? `Incorrect PIN. Locked for ${PIN_LOCK_MINUTES} minutes.` : "Incorrect PIN.",
      });
    }
    s.devPortalPinFailedAttempts = 0;
    s.devPortalPinLockedUntil = null;
    await s.save();
    const sessionToken = jwt.sign(
      { stage: "devImpersonate", devId: String(dev._id) },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );
    res.json({ message: "PIN verified.", sessionToken });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Stage 3: list portal users to choose from (requires the stage-2 session).
router.get("/portal-users", async (req, res) => {
  try {
    const dev = await requireDevStage(req, res, "devImpersonate");
    if (!dev) return;
    const users = await UserPortal.find({})
      .select("firstName lastName email companyName assignedSlfName status isDummy")
      .sort({ createdAt: -1 })
      .lean();
    res.json(users);
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Stage 4: start impersonation — issue a portal session token for the chosen
// user, marked as developer debug/impersonation, and audit-log the action.
router.post("/impersonate", async (req, res) => {
  try {
    const dev = await requireDevStage(req, res, "devImpersonate");
    if (!dev) return;
    const portalUser = await UserPortal.findById(req.body?.portalUserId);
    if (!portalUser) return res.status(404).json({ message: "Portal user not found." });

    const token = jwt.sign(
      {
        id: String(portalUser._id),
        role: "portal_user",
        impersonatedBy: String(dev._id),
        debug: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );
    writeLog("warn", "dev-portal.impersonate", {
      message: `Developer ${dev.email} started portal impersonation of ${portalUser.email}`,
      user: dev.email,
      ip: req.ip,
      meta: {
        developerId: String(dev._id),
        portalUserId: String(portalUser._id),
        portalEmail: portalUser.email,
        startedAt: new Date().toISOString(),
      },
    });
    const safe = portalUser.toObject();
    delete safe.password;
    res.json({ message: "Developer debug session started.", token, user: safe, impersonation: true });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

module.exports = router;
