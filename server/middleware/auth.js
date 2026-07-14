const express = require("express");
const jwt = require("jsonwebtoken");

let writeLog = () => {};
try {
  ({ writeLog } = require("../utils/logger"));
} catch { /* logger optional */ }

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

// Require a valid JWT of EITHER realm (admin `User` or portal `UserPortal`).
// Both realms are signed with the same JWT_SECRET, so verifying the signature
// proves the caller holds a token this server issued. Used to close anonymous
// access on routes that are legitimately reached by both admin and portal
// clients (e.g. submissions), where `adminOnly` would be too strict. Does not
// hit the DB — role-scoped checks (adminOnly/developerOnly) still apply on top
// where a route is admin-only.
function requireAnyAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin" && req.user?.role !== "developer") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

function developerOnly(req, res, next) {
  if (req.user?.role !== "developer") {
    // Audit unauthorized attempts to reach developer-only tooling (e.g. dummy config).
    writeLog("warn", "access.denied.developer", {
      message: `Non-developer attempted developer-only route ${req.method} ${req.originalUrl}`,
      user: req.user?.email || req.user?.username || req.user?.id || "",
      ip: req.ip,
      meta: { role: req.user?.role || "none", path: req.originalUrl, method: req.method },
    });
    return res.status(403).json({ message: "Developer access required" });
  }
  next();
}

module.exports = { authMiddleware, requireAnyAuth, adminOnly, developerOnly };
