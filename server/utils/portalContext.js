// Resolve WHICH portal user a request is allowed to act on.
//
// Portal routes historically took the target user from the request itself
// (`?email=`, `submittedBy` in the body) while the auth middleware only checked
// that *some* valid token was present. That let an authenticated Portal User A
// pass B's email and read/create/delete B's drafts and submissions — a horizontal
// privilege escalation. This module is the single place that decides the answer.
//
// The rule:
//
//   portal_user  → ALWAYS their own context. A target in the request is ignored
//                  when it matches, and rejected when it does not.
//   developer    → may explicitly target another portal user's context (this is
//                  the privileged Developer Portal Mode). Audited.
//   admin/other  → may NOT target a portal context through these routes.
//
// Developer status is taken from the JWT role that the admin realm issues — the
// same `role === "developer"` check middleware/auth.js#developerOnly uses. An
// ordinary admin is NOT a developer.

const jwt = require("jsonwebtoken");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("./logger");

// Never leak credentials/secrets through any portal-context route.
const PORTAL_USER_SAFE_FIELDS =
  "_id firstName lastName email username contactNumber companyName status " +
  "assignedSlf assignedSlfName isVerified blocked maintenanceMode portalAccess " +
  "isDummy lastActiveAt createdAt updatedAt";

class PortalContextError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function decodeToken(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) throw new PortalContextError("No token provided", 401);
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new PortalContextError("Invalid token", 401);
  }
}

function isDeveloperToken(decoded) {
  return decoded?.role === "developer";
}

/**
 * @param {object} req
 * @param {object} [opts]
 * @param {string} [opts.targetEmail]          requested target (query/body)
 * @param {string} [opts.targetPortalUserId]   requested target by id
 * @returns {Promise<{ email, portalUser, isDeveloper, impersonating, actor }>}
 */
async function resolvePortalContext(req, { targetEmail, targetPortalUserId } = {}) {
  const decoded = decodeToken(req);
  const actor = decoded.email || decoded.username || decoded.id || "";
  const developer = isDeveloperToken(decoded);

  const requestedEmail = String(targetEmail || "").trim().toLowerCase();
  const requestedId = String(targetPortalUserId || "").trim();
  const hasTarget = !!(requestedEmail || requestedId);

  // ── Ordinary portal user: locked to their own context ─────────────────────
  if (decoded.role === "portal_user") {
    const self = await UserPortal.findById(decoded.id).select(PORTAL_USER_SAFE_FIELDS);
    if (!self) throw new PortalContextError("Portal user not found", 404);

    // A target that isn't them is a privilege-escalation attempt — refuse it
    // loudly rather than silently serving their own data, so it is auditable.
    const mismatch =
      (requestedEmail && requestedEmail !== String(self.email).toLowerCase()) ||
      (requestedId && requestedId !== String(self._id));
    if (mismatch) {
      writeLog("warn", "portal.context.denied", {
        message: "Portal user attempted to access another portal user's context",
        user: self.email,
        ip: req.ip,
        meta: { requestedEmail, requestedId, path: req.originalUrl },
      });
      throw new PortalContextError("You may only access your own portal data.", 403);
    }
    return { email: self.email, portalUser: self, isDeveloper: false, impersonating: false, actor: self.email };
  }

  // ── Developer: may explicitly target a portal context ──────────────────────
  if (developer) {
    // The context may come from the request OR be bound into the developer's own
    // token by the Dev Portal login flow (devPortal.js → /portal-context).
    //
    // That token is a DEVELOPER token carrying an explicit target — NOT a portal
    // user's authentication token. The role is still checked here before the
    // target is honoured, so a developer session can never be mistaken for the
    // portal user's own session, and revoking developer status revokes the access.
    const boundId = String(decoded.portalContextUserId || "").trim();

    // PRECEDENCE: an EXPLICIT target on the request always wins over the context
    // bound into the token. Letting the token win would mean a developer who asks
    // for user A's data silently receives user B's — and could then "correct" the
    // wrong account believing it was the one they requested. The token-bound
    // context is only the DEFAULT for a session that names no target.
    let target = null;
    if (requestedId) {
      target = await UserPortal.findById(requestedId).select(PORTAL_USER_SAFE_FIELDS);
    } else if (requestedEmail) {
      target = await UserPortal.findOne({ email: requestedEmail }).select(PORTAL_USER_SAFE_FIELDS);
    } else if (boundId) {
      target = await UserPortal.findById(boundId).select(PORTAL_USER_SAFE_FIELDS);
    } else {
      // No context chosen anywhere — Developer Portal Mode requires an explicit
      // selection, so a developer never lands on an arbitrary user's data.
      throw new PortalContextError(
        "Developer Portal Mode requires an explicit portal user context (targetPortalUserId or email).",
        400,
      );
    }
    if (!target) throw new PortalContextError("Target portal user not found", 404);

    writeLog("warn", "portal.context.developer", {
      message: `Developer viewing portal context of ${target.email}`,
      user: actor,
      ip: req.ip,
      meta: { targetPortalUserId: String(target._id), targetEmail: target.email, path: req.originalUrl },
    });
    return { email: target.email, portalUser: target, isDeveloper: true, impersonating: true, actor };
  }

  // ── Planning Unit: VIEW-ONLY context on the account chosen at sign-in ─────
  // routes/planningUnit.js issues this token; middleware/planningUnitGuard.js has
  // already refused it if the access is off, expired or revoked, and refuses every
  // write it makes. It may name another account explicitly, like a developer, so
  // the viewer can move between facilities without signing in again.
  if (decoded.role === "planning_unit") {
    const boundId = String(decoded.portalContextUserId || "").trim();
    let target = null;
    if (requestedId) target = await UserPortal.findById(requestedId).select(PORTAL_USER_SAFE_FIELDS);
    else if (requestedEmail) target = await UserPortal.findOne({ email: requestedEmail }).select(PORTAL_USER_SAFE_FIELDS);
    else if (boundId) target = await UserPortal.findById(boundId).select(PORTAL_USER_SAFE_FIELDS);
    else throw new PortalContextError("Planning Unit view requires a selected portal account.", 400);
    if (!target) throw new PortalContextError("Target portal user not found", 404);
    // Same pool the picker offers: never a pending, blocked or test account.
    if (target.status !== "approved" || target.isDummy || target.blocked) {
      throw new PortalContextError("That portal account is not available to the Planning Unit view.", 403);
    }
    return {
      email: target.email,
      portalUser: target,
      isDeveloper: false,
      isPlanningUnit: true,
      impersonating: true,
      readOnly: true,
      actor: decoded.email || "planning-unit",
    };
  }

  // ── Anyone else (incl. ordinary admins) ───────────────────────────────────
  throw new PortalContextError("Portal access requires a portal account or developer role.", 403);
}

// Developer Portal Mode has FULL CONTROL of the portal side.
//
// It used to be inspection-only: a developer viewing an operator's context was
// refused every ordinary portal write and told to go to Developer Settings →
// Submission RAW Data. That made the one role expected to fix the system the only
// role that could not use it — a developer could see an operator's broken
// submission, know the fix, and still have to reproduce it through a different
// screen. Writes are now permitted deliberately.
//
// What does NOT change is the RECORD of it. A developer write is still a write to
// somebody else's data under their name, so every one is audited at `warn` with
// the actor, the target, the route and the method. That trail is the reason this
// stays a function call at the top of each write route rather than being deleted:
// the call site is what makes the action attributable, and removing it would make
// developer edits indistinguishable from the operator's own.
//
// Call this at the top of any portal route that WRITES.
function assertPortalWriteAllowed(ctx, req) {
  if (!ctx.impersonating) return;
  // A read-only context (Planning Unit) never writes. The /api guard already
  // refuses its non-GET requests; this is the second lock on the same door.
  if (ctx.readOnly) {
    throw new PortalContextError(
      "Planning Unit access is view-only. Changes can only be made by the facility's own SLF Portal account.",
      403,
    );
  }
  writeLog("warn", "portal.context.developer-write", {
    message: `Developer wrote to ${ctx.email}'s portal data`,
    user: ctx.actor,
    ip: req?.ip,
    meta: { targetEmail: ctx.email, path: req?.originalUrl, method: req?.method },
  });
}

// Express helper: turn a PortalContextError into its response.
function sendPortalContextError(res, error) {
  if (error instanceof PortalContextError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  // Any error that already carries an HTTP status is a DELIBERATE refusal, not a
  // crash — forward it with its own message instead of flattening it to a bare
  // 500 "Server error". The demo write guard (utils/demoMode.js) throws exactly
  // this shape (`status` + `code`), and swallowing it is what turned a
  // "demonstration accounts cannot modify production records" refusal into an
  // unexplained 500 in the portal's Drafts panel.
  const status = Number(error?.statusCode || error?.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return res.status(status).json({
      message: error.message || "Request refused",
      ...(error.code ? { code: error.code } : {}),
    });
  }
  return res.status(500).json({ message: "Server error", error: error.message });
}

module.exports = {
  PortalContextError,
  PORTAL_USER_SAFE_FIELDS,
  resolvePortalContext,
  assertPortalWriteAllowed,
  sendPortalContextError,
  isDeveloperToken,
  decodeToken,
};
