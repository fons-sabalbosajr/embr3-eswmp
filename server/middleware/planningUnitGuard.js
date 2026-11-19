// Planning Unit sessions are VIEW-ONLY, and stop the moment their access does.
//
// Mounted once on /api, before every router, so no route (including one added
// later) can be written to by a `role: "planning_unit"` token. Two checks:
//
//   1. The access is still live: switched on, not past its valid-until date, and
//      the token was issued under the current session version ("End all sessions"
//      and every credential change bump it). Otherwise 401, and the portal signs
//      the viewer out.
//   2. The request reads. GET / HEAD / OPTIONS pass; every other method is refused
//      with 403 PLANNING_UNIT_READ_ONLY, except the error-report endpoint the
//      front-end uses when something breaks.
//
// Tokens of every other role pass straight through, untouched.

const jwt = require("jsonwebtoken");

let writeLog = () => {};
try {
  ({ writeLog } = require("../utils/logger"));
} catch { /* logger optional */ }

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Paths are relative to the /api mount.
const WRITE_ALLOWLIST = [/^\/logs\/client-error\/?$/];

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long" }) : "";

/** Is the Planning Unit access usable right now? */
function accessState(doc, now = new Date()) {
  if (!doc) return { ok: false, reason: "not-configured", message: "Planning Unit access is not set up." };
  if (!doc.username || !doc.passwordHash || !doc.pinHash) {
    return { ok: false, reason: "not-configured", message: "Planning Unit access is not set up yet." };
  }
  if (!doc.enabled) return { ok: false, reason: "disabled", message: "Planning Unit access is turned off. Please contact the EMB Region III system administrator." };
  if (doc.validUntil && now > new Date(doc.validUntil)) {
    return { ok: false, reason: "expired", message: `Planning Unit access expired on ${fmtDate(doc.validUntil)}.` };
  }
  return { ok: true, reason: "active", message: "" };
}

// The access document, cached briefly: this runs on every Planning Unit request.
// Saves through routes/planningUnit.js clear it, so a switch-off is immediate on
// this process and within CACHE_MS on any other.
const CACHE_MS = 15000;
let cache = { doc: null, at: 0 };
function invalidatePlanningUnitCache() { cache = { doc: null, at: 0 }; }
async function loadAccess() {
  if (cache.doc && Date.now() - cache.at < CACHE_MS) return cache.doc;
  const PlanningUnitAccess = require("../models/PlanningUnitAccess");
  const doc = await PlanningUnitAccess.findOne().lean();
  cache = { doc, at: Date.now() };
  return doc;
}

async function planningUnitGuard(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return next();
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(); // the route's own auth answers an invalid token
  }
  if (decoded?.role !== "planning_unit") return next();

  try {
    const doc = await loadAccess();
    const state = accessState(doc);
    if (!state.ok || decoded.puv !== doc.sessionVersion) {
      return res.status(401).json({
        message: state.ok
          ? "Your Planning Unit session was ended. Please sign in again."
          : state.message,
        code: "PLANNING_UNIT_SESSION_ENDED",
      });
    }
  } catch {
    return res.status(503).json({ message: "Could not verify Planning Unit access. Please retry." });
  }

  if (READ_METHODS.has(req.method)) return next();
  if (WRITE_ALLOWLIST.some((rx) => rx.test(req.path || ""))) return next();

  writeLog("warn", "planning-unit.write.blocked", {
    message: `Planning Unit write refused: ${req.method} ${req.originalUrl}`,
    user: decoded.email || "planning-unit",
    ip: req.ip,
    meta: { method: req.method, path: req.originalUrl, portalContextUserId: decoded.portalContextUserId },
  });
  return res.status(403).json({
    message: "Planning Unit access is view-only. Changes can only be made by the facility's own SLF Portal account.",
    code: "PLANNING_UNIT_READ_ONLY",
  });
}

module.exports = { planningUnitGuard, accessState, invalidatePlanningUnitCache, READ_METHODS };
