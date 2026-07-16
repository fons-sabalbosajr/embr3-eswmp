// Single source of truth for "system / sample" portal accounts.
//
// These are internal accounts used for demos and testing (e.g. the ESWM Portal
// User / the developer's own portal login) — NOT real SLF operator accounts. They
// exist as ordinary UserPortal records (they are not flagged `isDummy`), so a
// query that only excludes dummies still returns them. That is the source of the
// incorrect classification: without this filter they show up as legitimate portal
// users in the Portal Users list and Developer Portal Access.
//
// Views must NOT re-derive their own name/email exclusion — import from here so
// the definition stays in one place (backend-authoritative).

const SYSTEM_ACCOUNT_EMAILS = ["fonssabalbosa.27@gmail.com"];
// Matched against full name / username / company (case-insensitive, substring).
const SYSTEM_ACCOUNT_NAMES = [
  "eswm portal user",
  "ewsm portal user",
  "test portal user",
];

const norm = (v) => String(v || "").trim().toLowerCase();

// True when a portal-user record is a system/sample account (not a real operator).
function isSystemPortalAccount(user = {}) {
  if (!user) return false;
  if (SYSTEM_ACCOUNT_EMAILS.includes(norm(user.email))) return true;
  const fullName = norm(`${user.firstName || ""} ${user.lastName || ""}`);
  const fields = [fullName, norm(user.username), norm(user.companyName)];
  return SYSTEM_ACCOUNT_NAMES.some((name) =>
    fields.some((field) => field && field.includes(name)),
  );
}

// Remove system/sample accounts from a fetched list unless a developer view has
// explicitly opted in (?includeSystem=true / ?includeDummy=true).
function excludeSystemPortalAccounts(users = [], includeSystem = false) {
  if (includeSystem || !Array.isArray(users)) return users;
  return users.filter((user) => !isSystemPortalAccount(user));
}

// Developer opt-in flag from the request query.
function wantsIncludeSystem(req) {
  const q = req?.query || {};
  return (
    String(q.includeSystem || "").toLowerCase() === "true" ||
    String(q.includeDummy || "").toLowerCase() === "true"
  );
}

module.exports = {
  isSystemPortalAccount,
  excludeSystemPortalAccounts,
  wantsIncludeSystem,
};
