// Centralized portal-user permission/policy service.
//
// THE single place that answers "is portal user X allowed to do Y?". Every portal
// rule is enforced through here (route middleware `requirePortalRule` and the
// `can()` helper) so permission logic is never scattered across routes/components.
//
// Storage: rules live on the EXISTING `UserPortal.portalAccess` sub-document — we
// extend it rather than create a parallel store. Legacy fields (canSubmitDisposal,
// canEditBaseline, canUploadExcel) are preserved and mapped to rule keys, so a
// user configured before this feature keeps their exact behavior.
//
// Defaults are permissive to match prior behavior (the portal already allowed these
// actions), EXCEPT `can_change_global_unit`, which defaults to FALSE — per policy
// only a developer-authorized user may change the official global unit.

// Rule catalog. `field` is the boolean on portalAccess that stores the override;
// `default` is the effective value when a user has no explicit assignment.
const RULES = [
  { key: "can_change_baseline_data",      field: "canEditBaseline",      label: "Can change baseline data",        default: true },
  { key: "can_change_global_unit",        field: "canChangeGlobalUnit",  label: "Can change global unit",          default: false },
  { key: "can_submit_slf_data",           field: "canSubmitDisposal",    label: "Can submit SLF data",             default: true },
  { key: "can_upload_excel",              field: "canUploadExcel",       label: "Can upload Excel/CSV",            default: true },
  { key: "can_edit_submitted_data",       field: "canEditSubmitted",     label: "Can edit submitted data",         default: true },
  { key: "can_delete_submitted_data",     field: "canDeleteSubmitted",   label: "Can delete submitted data",       default: true },
  { key: "can_reopen_closed_submissions", field: "canReopenClosed",      label: "Can reopen closed submissions",   default: false },
  { key: "can_manage_cells",              field: "canManageCells",       label: "Can manage active and closed cells", default: true },
  { key: "can_create_support_tickets",    field: "canCreateTickets",     label: "Can create support tickets",      default: true },
  { key: "can_view_vera_responses",       field: "canViewVera",          label: "Can view VERA responses",         default: true },
  { key: "can_access_reports",            field: "canAccessReports",     label: "Can access selected reports",     default: true },
];

const RULE_BY_KEY = new Map(RULES.map((r) => [r.key, r]));
const RULE_KEYS = RULES.map((r) => r.key);

// Effective rules for a UserPortal doc (or plain object). Returns { key: boolean }.
// An explicit boolean on portalAccess wins; otherwise the catalog default applies.
function getPortalRules(user) {
  const access = (user && (user.portalAccess?.toObject?.() || user.portalAccess)) || {};
  const out = {};
  for (const r of RULES) {
    const stored = access[r.field];
    out[r.key] = typeof stored === "boolean" ? stored : r.default;
  }
  return out;
}

// Can this portal user perform `ruleKey`? Unknown keys deny (fail-closed).
function can(user, ruleKey) {
  if (!RULE_BY_KEY.has(ruleKey)) return false;
  return getPortalRules(user)[ruleKey] === true;
}

// Map a rule key to the portalAccess storage field (for persisting an assignment).
function fieldForRule(ruleKey) {
  return RULE_BY_KEY.get(ruleKey)?.field || null;
}

// Catalog for the developer UI (key + label + default), no storage details leaked.
function ruleCatalog() {
  return RULES.map(({ key, label, default: def }) => ({ key, label, default: def }));
}

// Express middleware: enforce a portal rule on the backend for the authenticated
// portal user. Developer tokens bypass (developer access overrides restrictions).
// Admin tokens are NOT auto-allowed on portal-user actions — these gate the portal
// realm. Denials are audited via AppLog. Use AFTER an auth middleware that sets
// req.user = { id, role }.
function requirePortalRule(ruleKey) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      // Rules constrain the PORTAL USER only. Developer and admin callers are not
      // the constrained subject and pass — developer access overrides restrictions,
      // and admin/developer-only concerns (global unit, rule config) are gated by
      // their own developerOnly middleware, not here.
      if (role !== "portal_user") return next();
      const UserPortal = require("../models/UserPortal");
      const user = await UserPortal.findById(req.user.id).select("portalAccess email").lean();
      if (!user) return res.status(401).json({ message: "Portal user not found" });
      if (can(user, ruleKey)) return next();

      try {
        const { writeLog } = require("./logger");
        writeLog("warn", "portal.rule.denied", {
          message: `Portal user lacks rule ${ruleKey} for ${req.method} ${req.originalUrl}`,
          user: user.email || req.user.id,
          ip: req.ip,
          meta: { rule: ruleKey, path: req.originalUrl, method: req.method },
        });
      } catch { /* logging is best-effort */ }

      return res.status(403).json({
        message: "Your account is not permitted to perform this action. Please contact an administrator.",
        code: "PORTAL_RULE_DENIED",
        rule: ruleKey,
      });
    } catch {
      return res.status(500).json({ message: "Permission check failed" });
    }
  };
}

module.exports = {
  RULES,
  RULE_KEYS,
  getPortalRules,
  can,
  fieldForRule,
  ruleCatalog,
  requirePortalRule,
};
