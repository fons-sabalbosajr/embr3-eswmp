// Planning Unit Access — VIEW-ONLY entry to the SLF Portal for EMB Region III's
// Planning Unit, valid until a set date (default: end of Dec 31, 2026).
//
// Same shape as the Developer Portal access (routes/devPortal.js):
//
//   1. POST /login        username + password      → 5-minute stage token
//   2. POST /verify-pin   6-digit PIN               → 15-minute picker token
//   3. GET  /portal-users the approved portal accounts to choose from
//   4. POST /open         chosen account            → portal session token
//
// The session token is NOT a developer token and NOT the portal user's token: it
// carries `role: "planning_unit"`, the chosen account as `portalContextUserId`, and
// `readOnly: true`. middleware/planningUnitGuard.js refuses every write it makes and
// every request once the access is switched off, expires, or its sessions are
// ended. utils/portalContext.js resolves its reads to the chosen account.
//
// Developer-only management (Developer Settings → Dev Portal Credential):
//   GET  /settings        status (never a hash)
//   PUT  /settings        set username / password / PIN / validity / on-off
//   POST /end-sessions    sign every Planning Unit session out now

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const PlanningUnitAccess = require("../models/PlanningUnitAccess");
const User = require("../models/User");
const UserPortal = require("../models/UserPortal");
const { authMiddleware, developerOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { listPickablePortalUsers } = require("../utils/portalUserPicker");
const { accessState, invalidatePlanningUnitCache } = require("../middleware/planningUnitGuard");

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_HOURS = 8;
const USERNAME_RE = /^[a-z0-9._-]{4,40}$/;

const fmtDate = (d) =>
  d ? new Date(d).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" }) : "";

// Lockout shared by the password and PIN steps: 5 failures → 15 minutes.
async function registerFailure(doc) {
  doc.failedAttempts = (doc.failedAttempts || 0) + 1;
  let locked = false;
  if (doc.failedAttempts >= MAX_ATTEMPTS) {
    doc.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
    doc.failedAttempts = 0;
    locked = true;
  }
  await doc.save();
  return locked;
}
const isLocked = (doc) => doc.lockedUntil && doc.lockedUntil > new Date();

// Verify a staged token: right stage, and issued under the CURRENT session version
// (ending sessions or changing a credential invalidates tokens mid-flow too).
async function requireStage(req, res, stage) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) { res.status(401).json({ message: "Missing Planning Unit session token." }); return null; }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.status(401).json({ message: "Your Planning Unit sign-in expired. Please start again." });
    return null;
  }
  if (decoded.stage !== stage || decoded.pu !== true) {
    res.status(403).json({ message: "Wrong Planning Unit session stage." });
    return null;
  }
  const doc = await PlanningUnitAccess.getSingleton();
  const state = accessState(doc);
  if (!state.ok) { res.status(403).json({ message: state.message, code: `PLANNING_UNIT_${state.reason.toUpperCase().replace(/-/g, "_")}` }); return null; }
  if (decoded.v !== doc.sessionVersion) {
    res.status(401).json({ message: "Planning Unit access was changed. Please sign in again." });
    return null;
  }
  return doc;
}

/* ───────────────────────── Sign-in flow (portal login page) ───────────────── */

router.post("/login", async (req, res) => {
  try {
    const username = String(req.body?.username || req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const invalid = () => res.status(401).json({ message: "Invalid Planning Unit credentials." });
    const doc = await PlanningUnitAccess.findOne();
    // Not configured, or a different username: an ordinary "invalid" so the login
    // page falls back to its normal error and nothing about this access leaks.
    if (!doc || !doc.username || !doc.passwordHash || username !== doc.username) return invalid();
    if (isLocked(doc)) {
      return res.status(429).json({ message: `Too many attempts. Try again after ${fmtDate(doc.lockedUntil)}.` });
    }
    const ok = await bcrypt.compare(password, doc.passwordHash);
    if (!ok) {
      const locked = await registerFailure(doc);
      writeLog("warn", "planning-unit.login.fail", { message: "Planning Unit password attempt failed", user: username, ip: req.ip });
      return locked
        ? res.status(429).json({ message: `Too many attempts. Locked for ${LOCK_MINUTES} minutes.` })
        : invalid();
    }
    // Right credentials: now it is safe to say WHY access is refused.
    const state = accessState(doc);
    if (!state.ok) {
      writeLog("warn", "planning-unit.login.refused", { message: `Planning Unit sign-in refused: ${state.reason}`, user: username, ip: req.ip });
      return res.status(403).json({ message: state.message, code: `PLANNING_UNIT_${state.reason.toUpperCase().replace(/-/g, "_")}` });
    }
    const stageToken = jwt.sign({ stage: "puLogin", pu: true, v: doc.sessionVersion }, process.env.JWT_SECRET, { expiresIn: "5m" });
    writeLog("info", "planning-unit.login", { message: "Planning Unit password verified", user: username, ip: req.ip });
    res.json({ message: "Password verified. Enter the Planning Unit PIN.", stageToken, requiresPin: true, validUntil: doc.validUntil });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.post("/verify-pin", async (req, res) => {
  try {
    const doc = await requireStage(req, res, "puLogin");
    if (!doc) return;
    if (isLocked(doc)) {
      return res.status(429).json({ message: `Too many attempts. Try again after ${fmtDate(doc.lockedUntil)}.` });
    }
    const ok = await bcrypt.compare(String(req.body?.pin || ""), doc.pinHash);
    if (!ok) {
      const locked = await registerFailure(doc);
      writeLog("warn", "planning-unit.pin.fail", { message: "Planning Unit PIN attempt failed", user: doc.username, ip: req.ip });
      return res.status(401).json({ message: locked ? `Incorrect PIN. Locked for ${LOCK_MINUTES} minutes.` : "Incorrect PIN." });
    }
    doc.failedAttempts = 0;
    doc.lockedUntil = null;
    await doc.save();
    const sessionToken = jwt.sign({ stage: "puSelect", pu: true, v: doc.sessionVersion }, process.env.JWT_SECRET, { expiresIn: "15m" });
    res.json({ message: "PIN verified.", sessionToken });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.get("/portal-users", async (req, res) => {
  try {
    const doc = await requireStage(req, res, "puSelect");
    if (!doc) return;
    res.json(await listPickablePortalUsers());
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.post("/open", async (req, res) => {
  try {
    const doc = await requireStage(req, res, "puSelect");
    if (!doc) return;
    const portalUser = await UserPortal.findById(req.body?.portalUserId);
    // Same pool as the picker: approved, real, unblocked accounts only.
    if (!portalUser || portalUser.status !== "approved" || portalUser.isDummy || portalUser.blocked) {
      return res.status(404).json({ message: "Portal account not found." });
    }
    // The session never outlives the access itself.
    const secondsLeft = Math.floor((new Date(doc.validUntil).getTime() - Date.now()) / 1000);
    const expiresIn = Math.max(60, Math.min(SESSION_HOURS * 3600, secondsLeft));
    const token = jwt.sign(
      {
        id: "planning-unit",
        role: "planning_unit",
        username: doc.username,
        email: `planning-unit:${doc.username}`,
        portalContextUserId: String(portalUser._id),
        readOnly: true,
        puv: doc.sessionVersion,
      },
      process.env.JWT_SECRET,
      { expiresIn },
    );
    doc.lastUsedAt = new Date();
    doc.lastViewedPortalUser = portalUser.email;
    await doc.save();
    writeLog("warn", "planning-unit.context.open", {
      message: `Planning Unit (${doc.username}) opened a VIEW-ONLY portal context on ${portalUser.email}`,
      user: `planning-unit:${doc.username}`,
      ip: req.ip,
      meta: { portalUserId: String(portalUser._id), portalEmail: portalUser.email, validUntil: doc.validUntil },
    });
    const safe = portalUser.toObject();
    delete safe.password;
    delete safe.resetToken;
    delete safe.resetTokenExpiry;
    res.json({
      message: "Planning Unit view opened (view-only).",
      token,
      user: safe,
      planningUnit: true,
      readOnly: true,
      validUntil: doc.validUntil,
      viewer: `Planning Unit (${doc.username})`,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

/* ─────────────────────── Developer management (admin side) ──────────────── */

function statusPayload(doc) {
  const state = accessState(doc);
  return {
    enabled: !!doc.enabled,
    username: doc.username || "",
    passwordSet: !!doc.passwordHash,
    pinSet: !!doc.pinHash,
    validUntil: doc.validUntil,
    expired: state.reason === "expired",
    active: state.ok,
    state: state.ok ? "active" : state.reason,
    locked: !!isLocked(doc),
    lockedUntil: isLocked(doc) ? doc.lockedUntil : null,
    lastUsedAt: doc.lastUsedAt,
    lastViewedPortalUser: doc.lastViewedPortalUser || "",
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy || "",
  };
}

router.get("/settings", authMiddleware, developerOnly, async (_req, res) => {
  try {
    res.json(statusPayload(await PlanningUnitAccess.getSingleton()));
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.put("/settings", authMiddleware, developerOnly, async (req, res) => {
  try {
    const { currentPassword, enabled, username, password, pin, validUntil } = req.body || {};
    const dev = await User.findById(req.user.id);
    if (!dev || dev.role !== "developer" || !dev.isApproved) {
      return res.status(403).json({ message: "Developer account is not active." });
    }
    if (!(await dev.comparePassword(String(currentPassword || "")))) {
      return res.status(401).json({ message: "Current developer password is incorrect." });
    }

    const doc = await PlanningUnitAccess.getSingleton();
    let credentialsChanged = false;

    if (username !== undefined) {
      const u = String(username || "").trim().toLowerCase();
      if (!USERNAME_RE.test(u)) {
        return res.status(400).json({ message: "Username must be 4–40 characters: letters, numbers, dot, dash or underscore (no spaces or @)." });
      }
      // Must not shadow a real portal account's sign-in name.
      const clash = await UserPortal.exists({ $or: [{ username: u }, { email: u }] });
      if (clash) return res.status(409).json({ message: "That username belongs to an SLF Portal account. Choose another." });
      if (u !== doc.username) { doc.username = u; credentialsChanged = true; }
    }
    if (password) {
      if (String(password).length < 8) return res.status(400).json({ message: "Password must be at least 8 characters." });
      doc.passwordHash = await bcrypt.hash(String(password), 10);
      credentialsChanged = true;
    }
    if (pin) {
      if (!/^\d{6}$/.test(String(pin))) return res.status(400).json({ message: "PIN must be exactly 6 digits." });
      doc.pinHash = await bcrypt.hash(String(pin), 10);
      credentialsChanged = true;
    }
    if (validUntil !== undefined) {
      const d = new Date(validUntil);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: "Valid-until date is invalid." });
      doc.validUntil = d;
    }
    if (enabled !== undefined) {
      if (enabled && (!doc.username || !doc.passwordHash || !doc.pinHash)) {
        return res.status(400).json({ message: "Set a username, password and PIN before turning Planning Unit access on." });
      }
      doc.enabled = !!enabled;
    }
    if (credentialsChanged) {
      doc.sessionVersion = (doc.sessionVersion || 1) + 1;
      doc.failedAttempts = 0;
      doc.lockedUntil = null;
    }
    doc.updatedBy = dev.email;
    await doc.save();
    invalidatePlanningUnitCache();
    writeLog("warn", "planning-unit.settings", {
      message: `Planning Unit access updated (enabled=${doc.enabled}, validUntil=${doc.validUntil?.toISOString?.()}, credentialsChanged=${credentialsChanged})`,
      user: dev.email,
      ip: req.ip,
    });
    res.json({ message: "Planning Unit access saved.", ...statusPayload(doc) });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

router.post("/end-sessions", authMiddleware, developerOnly, async (req, res) => {
  try {
    const doc = await PlanningUnitAccess.getSingleton();
    doc.sessionVersion = (doc.sessionVersion || 1) + 1;
    doc.updatedBy = req.user?.email || "";
    await doc.save();
    invalidatePlanningUnitCache();
    writeLog("warn", "planning-unit.sessions.ended", { message: "All Planning Unit sessions ended", user: req.user?.email || "", ip: req.ip });
    res.json({ message: "All Planning Unit sessions were signed out.", ...statusPayload(doc) });
  } catch (e) {
    res.status(500).json({ message: "Server error", error: e.message });
  }
});

module.exports = router;
