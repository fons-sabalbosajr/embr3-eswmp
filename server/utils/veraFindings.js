// Deterministic VERA findings for the admin VERA notification bell. These are
// computed by backend queries + deterministic validation (never by the model),
// then surfaced as sanitized, role-appropriate notifications. Cached briefly so
// polling the bell never triggers repeated scans.
//
// Severity model: informational | recommendation | warning | critical.
// Model-generated *suggestions* are never "critical" — only deterministic system
// validation is. (Everything here is deterministic.)

const { matchClient } = require("./lguMatch");

let _cache = { at: 0, data: null };
const TTL_MS = Number(process.env.VERA_FINDINGS_TTL_MS) || 60_000;

async function computeAdminFindings() {
  const SlfClient = require("../models/SlfClient");
  const Region3Lgu = require("../models/Region3Lgu");
  const AppSettings = require("../models/AppSettings");
  const agent = require("./automationAgent");

  const findings = [];
  const now = new Date();

  // ── Unlinked LGU records (reconciliation) ──────────────────────────────────
  try {
    const [masters, clients] = await Promise.all([
      Region3Lgu.find({ status: "Active", lguType: { $in: ["Municipality", "City"] } })
        .select("name normalizedName province normalizedProvince municipalityCity psgcCode lguType aliases").lean(),
      SlfClient.find({ deletedAt: null, isCanonical: true, mergedInto: null, status: "Active", isDummy: { $ne: true }, type: "LGU" })
        .select("name municipalityCity province").lean(),
    ]);
    let unlinked = 0, highConfidence = 0, needsReview = 0;
    clients.forEach((c) => {
      const r = matchClient({ municipality: c.municipalityCity, province: c.province, name: c.name }, masters);
      const deterministic = r.classification === "exact" || (r.suggestions[0] && r.suggestions[0].method === "alias");
      if (deterministic) return;
      unlinked += 1;
      if (r.classification === "high") highConfidence += 1;
      else if (["multiple", "none", "invalid"].includes(r.classification)) needsReview += 1;
    });
    if (unlinked > 0) {
      findings.push({
        id: `lgu-unlinked-${unlinked}`,
        category: "lgu-reconciliation",
        severity: "recommendation",
        title: "Unlinked LGU records",
        message: `${unlinked} LGU client record${unlinked === 1 ? "" : "s"} need masterlist reconciliation${highConfidence ? ` — ${highConfidence} have a high-confidence match ready` : ""}. Open LGUs Served → Reconcile unlinked.`,
        actionUrl: "lgu-reconciliation",
        createdAt: now,
      });
    }
    if (needsReview > 0) {
      findings.push({
        id: `lgu-review-${needsReview}`,
        category: "data-quality",
        severity: "warning",
        title: "LGU records need manual review",
        message: `${needsReview} municipality value${needsReview === 1 ? "" : "s"} have no reliable / multiple possible masterlist matches and require a manual decision.`,
        actionUrl: "lgu-reconciliation",
        createdAt: now,
      });
    }
  } catch { /* non-blocking */ }

  // ── VERA provider health ───────────────────────────────────────────────────
  try {
    const settings = await AppSettings.findOne().lean().catch(() => null);
    const operational = agent.isOperational(settings?.automationAgent || {});
    if (!operational) {
      findings.push({
        id: "vera-help-library-mode",
        category: "vera-health",
        severity: "informational",
        title: "VERA is in help-library mode",
        message: "No AI provider is configured, so VERA answers from its built-in knowledge base. Configure the provider in settings to enable AI-phrased replies.",
        actionUrl: "",
        createdAt: now,
      });
    }
  } catch { /* non-blocking */ }

  return findings;
}

// Cached accessor (role gating is enforced by the route, not here).
async function getAdminFindings() {
  if (_cache.data && Date.now() - _cache.at < TTL_MS) return _cache.data;
  const data = await computeAdminFindings();
  _cache = { at: Date.now(), data };
  return data;
}

function clearFindingsCache() { _cache = { at: 0, data: null }; }

module.exports = { getAdminFindings, clearFindingsCache };
