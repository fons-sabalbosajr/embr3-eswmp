// Single source of truth for "is this user a developer?" across the backend.
//
// The admin JWT carries { id, role } and role === "developer" is authoritative.
// When a fuller user record (with an email) is available — e.g. loaded from the
// DB — a known developer email also counts, so the built-in developer account is
// recognized consistently everywhere (admin routes, VERA, dev tooling) instead of
// each route re-deriving its own ad-hoc check.
//
// Keep this list in sync with SYSTEM_ACCOUNT_EMAILS in systemPortalAccounts.js.

const DEVELOPER_EMAILS = ["fonssabalbosa.27@gmail.com"];

const norm = (v) => String(v || "").trim().toLowerCase();

// True when the user is a developer. Role is the primary signal; email is a
// secondary signal only used when present on the object.
function isDeveloper(user = {}) {
  if (!user || typeof user !== "object") return false;
  if (norm(user.role) === "developer") return true;
  if (user.email && DEVELOPER_EMAILS.includes(norm(user.email))) return true;
  return false;
}

// True for admins and developers (the union used by admin-only surfaces).
function isAdminOrDeveloper(user = {}) {
  const r = norm(user?.role);
  return r === "admin" || r === "developer" || isDeveloper(user);
}

// Express guard: 403s non-developers and returns false; returns true otherwise.
// Mirrors the inline pattern used across VERA/dev routes.
function ensureDeveloper(req, res) {
  if (!isDeveloper(req.user)) {
    res.status(403).json({ message: "Developer access required" });
    return false;
  }
  return true;
}

module.exports = { isDeveloper, isAdminOrDeveloper, ensureDeveloper, DEVELOPER_EMAILS };
