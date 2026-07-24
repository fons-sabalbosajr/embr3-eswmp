// Developer-only Portal User Rules management (App Settings › Security & Access).
// Lets a developer assign per-portal-user rules, enforced centrally by
// utils/portalPolicy.js. Every route is developer-authorized on the BACKEND — the
// UI gate is not trusted. All changes are audited (PortalPolicyAudit).

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const { authMiddleware, developerOnly } = require("../middleware/auth");
const UserPortal = require("../models/UserPortal");
const PortalPolicyAudit = require("../models/PortalPolicyAudit");
const policy = require("../utils/portalPolicy");
const { writeLog } = require("../utils/logger");

// Developer-only for the entire router. Role is taken from the verified JWT.
router.use(authMiddleware, developerOnly);

function actor(req) {
  return {
    changedBy: req.user?.email || req.user?.username || req.user?.id || "developer",
    changedById: req.user?.id || "",
    changedByRole: req.user?.role || "",
  };
}

// Rule catalog (keys + labels + defaults) for the configuration UI.
router.get("/catalog", (req, res) => {
  res.json({ rules: policy.ruleCatalog() });
});

// Search/select portal users. Returns only fields the UI needs — never passwords,
// tokens, or other sensitive developer-only settings.
router.get("/users", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const filter = { isDummy: { $ne: true } };
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }, { companyName: rx }];
    }
    const users = await UserPortal.find(filter)
      .select("firstName lastName email companyName status assignedSlfName portalAccess")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({
      users: users.map((u) => ({
        _id: u._id,
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim(),
        email: u.email,
        companyName: u.companyName || "",
        status: u.status,
        assignedSlfName: u.assignedSlfName || [],
        rules: policy.getPortalRules(u),
      })),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// A single user's current effective rules.
router.get("/:userId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const user = await UserPortal.findById(req.params.userId)
      .select("firstName lastName email companyName status portalAccess")
      .lean();
    if (!user) return res.status(404).json({ message: "Portal user not found" });
    res.json({
      user: {
        _id: user._id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        email: user.email,
        companyName: user.companyName || "",
        status: user.status,
      },
      rules: policy.getPortalRules(user),
      catalog: policy.ruleCatalog(),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Assign/update one or more rules for a user. Body: { rules: { key: bool }, reason? }.
// Each individual rule change is written to the audit trail with prev → new.
router.put("/:userId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const incoming = req.body?.rules;
    if (!incoming || typeof incoming !== "object") {
      return res.status(400).json({ message: "rules object is required" });
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    const user = await UserPortal.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "Portal user not found" });

    const before = policy.getPortalRules(user);
    if (!user.portalAccess) user.portalAccess = {};

    const changes = [];
    for (const [key, value] of Object.entries(incoming)) {
      const field = policy.fieldForRule(key);
      if (!field) continue; // ignore unknown keys (fail-closed)
      const boolVal = value === true;
      if (before[key] !== boolVal) {
        changes.push({ key, prev: before[key], next: boolVal });
        user.portalAccess[field] = boolVal;
      }
    }

    if (!changes.length) {
      return res.json({ message: "No changes", rules: before });
    }

    user.portalAccess.updatedAt = new Date();
    user.portalAccess.updatedBy = actor(req).changedBy;
    user.markModified("portalAccess");
    await user.save();

    // One audit doc per changed rule.
    try {
      await PortalPolicyAudit.insertMany(
        changes.map((c) => ({
          type: "portal_rule",
          ...actor(req),
          targetPortalUser: user._id,
          targetPortalUserEmail: user.email,
          ruleKey: c.key,
          previousValue: c.prev,
          newValue: c.next,
          reason,
        })),
      );
    } catch { /* audit is best-effort but should not block the change */ }

    writeLog("info", "portal.rule.update", {
      message: `Developer updated ${changes.length} portal rule(s) for ${user.email}`,
      user: actor(req).changedBy,
      ip: req.ip,
      meta: { userId: String(user._id), changes: changes.map((c) => `${c.key}:${c.prev}→${c.next}`) },
    });

    res.json({ message: "Rules updated", rules: policy.getPortalRules(user), changed: changes.length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Remove all custom rule assignments — reset the user to policy defaults. Audited.
router.delete("/:userId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "Reset to defaults";
    const user = await UserPortal.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: "Portal user not found" });

    const before = policy.getPortalRules(user);
    if (user.portalAccess) {
      for (const r of policy.RULES) user.portalAccess[r.field] = undefined;
      user.portalAccess.updatedAt = new Date();
      user.portalAccess.updatedBy = actor(req).changedBy;
      user.markModified("portalAccess");
      await user.save();
    }
    const after = policy.getPortalRules(user);

    try {
      const diff = policy.RULE_KEYS.filter((k) => before[k] !== after[k]).map((k) => ({
        type: "portal_rule",
        ...actor(req),
        targetPortalUser: user._id,
        targetPortalUserEmail: user.email,
        ruleKey: k,
        previousValue: before[k],
        newValue: after[k],
        reason,
      }));
      if (diff.length) await PortalPolicyAudit.insertMany(diff);
    } catch { /* best-effort */ }

    writeLog("warn", "portal.rule.reset", {
      message: `Developer reset portal rules to defaults for ${user.email}`,
      user: actor(req).changedBy,
      ip: req.ip,
      meta: { userId: String(user._id) },
    });

    res.json({ message: "Rules reset to defaults", rules: after });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Rule-change audit history for a user (most recent first).
router.get("/:userId/audit", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const items = await PortalPolicyAudit.find({ type: "portal_rule", targetPortalUser: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
