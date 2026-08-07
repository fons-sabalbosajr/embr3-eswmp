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
    if (!/^\d{6}$/.test(String(pin || ""))) {
      return res.status(400).json({ message: "PIN must be exactly 6 digits." });
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
    // Only ACTUAL, active portal users — exclude dummy/seed/test accounts,
    // blocked/disabled accounts, and any not-yet-approved (pending/rejected)
    // accounts. Enforced here (backend) so direct API access can't bypass it.
    const users = await UserPortal.find({
      status: "approved",
      isDummy: { $ne: true },
      blocked: { $ne: true },
    })
      .select("firstName lastName email companyName assignedSlf assignedSlfName status isDummy")
      // The picker identifies an account by its landfill + province, and province
      // lives on the facility, not on the portal user — so it is resolved here
      // rather than making the client fetch facilities just to draw a label.
      .populate("assignedSlf", "province lgu")
      .lean();

    const withProvince = users.map((u) => {
      const facilities = Array.isArray(u.assignedSlf) ? u.assignedSlf : [];
      const provinces = [
        ...new Set(facilities.map((f) => f?.province).filter(Boolean)),
      ];
      return { ...u, province: provinces.join(", ") };
    });

    // Sort by primary landfill name, then account name — clearer than createdAt.
    const label = (u) =>
      (Array.isArray(u.assignedSlfName) ? u.assignedSlfName[0] : u.assignedSlfName) ||
      u.companyName || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || "";
    withProvince.sort((a, b) => label(a).localeCompare(label(b)));
    res.json(withProvince);
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

// Stage 4: open a Developer Portal CONTEXT on the chosen portal user.
//
// This does NOT impersonate the user's authentication token. It issues a token
// that is explicitly the DEVELOPER's (`role: "developer"`, `id` = the developer)
// carrying an explicit target context (`portalContextUserId`). Every portal route
// resolves that through utils/portalContext, which re-checks the developer role
// before honouring the target — so:
//
//   • the session can never be mistaken for the portal user's own session,
//   • revoking the developer's role immediately revokes this access,
//   • Developer Portal Mode is READ-ONLY (assertPortalWriteAllowed blocks writes
//     to the target's data through ordinary portal endpoints),
//   • every context resolution is audited.
router.post("/impersonate", async (req, res) => {
  try {
    const dev = await requireDevStage(req, res, "devImpersonate");
    if (!dev) return;
    const portalUser = await UserPortal.findById(req.body?.portalUserId);
    if (!portalUser) return res.status(404).json({ message: "Portal user not found." });

    const token = jwt.sign(
      {
        id: String(dev._id),          // the DEVELOPER — not the portal user
        role: "developer",            // authorization is developer, explicitly
        email: dev.email,
        portalContextUserId: String(portalUser._id), // the explicit target context
        debug: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" },
    );
    writeLog("warn", "dev-portal.context.open", {
      message: `Developer ${dev.email} opened a read-only portal context on ${portalUser.email}`,
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
    delete safe.resetToken;
    delete safe.resetTokenExpiry;
    res.json({
      message: "Developer portal context opened (read-only).",
      token,
      user: safe,
      impersonation: true,       // kept: the Portal client already reads this flag
      developerContext: true,
      readOnly: true,
      developerEmail: dev.email,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

module.exports = router;
