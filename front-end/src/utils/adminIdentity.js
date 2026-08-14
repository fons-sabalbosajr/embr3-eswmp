export const ADMIN_ALIAS = "ESWM Admin";

// Keep in sync with server/utils/developerIdentity.js DEVELOPER_EMAILS.
export const DEVELOPER_EMAILS = ["fonssabalbosa.27@gmail.com"];

const norm = (v) => String(v || "").trim().toLowerCase();

// Single source of truth for "is this user a developer?" on the front-end.
// Role is the primary signal (stored role === "developer"); a known developer
// email is a secondary signal so the built-in developer account is recognized
// consistently across the landing page, portal, and admin views.
export function isDeveloper(user = {}) {
  if (!user || typeof user !== "object") return false;
  if (norm(user.role) === "developer") return true;
  if (user.email && DEVELOPER_EMAILS.includes(norm(user.email))) return true;
  return false;
}

/**
 * May this user see/manage test (dummy) data — e.g. the Dummy Submissions tab?
 *
 * Developers manage test data. A DEMONSTRATION account also qualifies: every
 * record those views can reach is synthetic (`isDummy: true`), so this grants
 * access to nothing real, and without it a demo admin cannot see the very
 * submissions the demo account just made.
 *
 * Mirrors canManageTestData() in server/routes/dataSLF.js — the API enforces the
 * same rule, so hiding the control is presentation only, never the access check.
 */
export function canManageTestData(user = {}) {
  return isDeveloper(user) || user?.isDemo === true;
}

// True for admins and developers.
export function isAdminOrDeveloper(user = {}) {
  const r = norm(user?.role);
  return r === "admin" || r === "developer" || isDeveloper(user);
}

export function getAdminDisplayName(user = {}) {
  if (!user || typeof user !== "object") return "";
  if (isDeveloper(user)) {
    return ADMIN_ALIAS;
  }

  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || user.email || "";
}