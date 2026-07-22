// Automation Agent — read-only function allowlist.
//
// Every entry is a NON-mutating data gatherer. Nothing here writes, updates,
// deletes, acknowledges, reverts, changes operational status, sends a message,
// modifies settings, or runs an arbitrary query. Each function:
//   • reads a bounded slice of real (non-dummy, non-deleted) records with .lean(),
//   • returns compact structured JSON built through the sanitizing/masking helpers
//     in agentContext.js, and
//   • declares the data categories it touches (recorded in the usage log).
//
// The query endpoint validates the requested function id against FUNCTION_IDS and
// runs ONLY the matching entry — a frontend can never reach the database directly.

const { excludeDummy } = require("./dummyFilter");
const {
  clampLimit,
  resolveDateWindow,
  shapeSubmission,
  maskNum,
} = require("./agentContext");

// Real records only (exclude dummy + soft-deleted).
const liveMatch = (extra = {}) => excludeDummy({ deletedAt: null, ...extra });

function DataSLF() {
  return require("../models/DataSLF");
}

// Statuses that require follow-up / action on the admin side.
const ACTION_STATUSES = ["reverted", "revert_requested", "rejected"];

const REGISTRY = {
  summarize_pending: {
    label: "Summarize pending submissions",
    description: "Counts and lists SLF submissions currently awaiting review (status pending).",
    categories: ["submissions", "status"],
    run: async ({ params, masking }) => {
      const limit = clampLimit(params.limit, 50, 200);
      const docs = await DataSLF()
        .find(liveMatch({ status: "pending" }))
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const total = await DataSLF().countDocuments(liveMatch({ status: "pending" }));
      const byCompany = {};
      docs.forEach((d) => {
        const k = d.lguCompanyName || "(unknown)";
        byCompany[k] = (byCompany[k] || 0) + 1;
      });
      return {
        totalPending: total,
        returned: docs.length,
        byCompany,
        submissions: docs.map((d) => shapeSubmission(d, masking)),
      };
    },
  },

  identify_overdue_missing: {
    label: "Identify overdue / missing action items",
    description:
      "Finds submissions that need action (reverted / revert requested / rejected) and pending submissions older than a staleness threshold.",
    categories: ["submissions", "status", "timeliness"],
    run: async ({ params, masking }) => {
      const limit = clampLimit(params.limit, 50, 200);
      const staleDays = Math.min(Math.max(Number(params.staleDays) || 7, 1), 180);
      const staleBefore = new Date(Date.now() - staleDays * 864e5);

      const action = await DataSLF()
        .find(liveMatch({ status: { $in: ACTION_STATUSES } }))
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      const stalePending = await DataSLF()
        .find(liveMatch({ status: "pending", createdAt: { $lt: staleBefore } }))
        .sort({ createdAt: 1 })
        .limit(limit)
        .lean();

      return {
        staleThresholdDays: staleDays,
        actionRequiredCount: action.length,
        stalePendingCount: stalePending.length,
        actionRequired: action.map((d) => shapeSubmission(d, masking)),
        stalePending: stalePending.map((d) => shapeSubmission(d, masking)),
      };
    },
  },

  explain_status_issues: {
    label: "Explain status issues",
    description:
      "Lists submissions in a problem state (reverted / revert requested / rejected) with their sanitized reasons so issues can be explained.",
    categories: ["submissions", "status"],
    run: async ({ params, masking }) => {
      const limit = clampLimit(params.limit, 50, 200);
      const docs = await DataSLF()
        .find(liveMatch({ status: { $in: ACTION_STATUSES } }))
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      const byStatus = {};
      docs.forEach((d) => {
        byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      });
      return {
        byStatus,
        returned: docs.length,
        submissions: docs.map((d) => shapeSubmission(d, masking)),
      };
    },
  },

  summarize_disposal_activity: {
    label: "Summarize disposal activity",
    description:
      "Aggregates disposal activity over a bounded date window: submission counts by status and (unless masked) total waste volume.",
    categories: ["submissions", "disposal-volume"],
    run: async ({ params, masking }) => {
      const { from, to, days } = resolveDateWindow(params);
      const docs = await DataSLF()
        .find(liveMatch({ dateOfDisposal: { $gte: from, $lte: to } }))
        .select("status dateOfDisposal totalVolumeTons totalVolumeM3 truckCount companyType")
        .lean();
      const byStatus = {};
      let tons = 0;
      let m3 = 0;
      let trucks = 0;
      docs.forEach((d) => {
        byStatus[d.status || "pending"] = (byStatus[d.status || "pending"] || 0) + 1;
        tons += Number(d.totalVolumeTons || 0);
        m3 += Number(d.totalVolumeM3 || 0);
        trucks += Number(d.truckCount || 0);
      });
      return {
        window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
        submissionCount: docs.length,
        byStatus,
        truckCount: trucks,
        totalVolumeTons: maskNum(Number(tons.toFixed(2)), masking),
        totalVolumeM3: maskNum(Number(m3.toFixed(2)), masking),
      };
    },
  },

  detect_inconsistencies: {
    label: "Detect data inconsistencies",
    description:
      "Flags likely data quality issues: batches mixing tons and m³ units, trucks whose actual volume exceeds stated capacity, and submissions with unassigned (unplaced) waste.",
    categories: ["submissions", "data-quality", "disposal-volume", "capacity"],
    run: async ({ params, masking }) => {
      const limit = clampLimit(params.limit, 100, 300);
      const docs = await DataSLF()
        .find(liveMatch({}))
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const mixedUnit = [];
      const overCapacity = [];
      docs.forEach((d) => {
        const hasTons = Number(d.totalVolumeTons || 0) > 0;
        const hasM3 = Number(d.totalVolumeM3 || 0) > 0;
        if (hasTons && hasM3) mixedUnit.push(shapeSubmission(d, masking));
        const over = (d.trucks || []).some((t) => {
          const cap = Number(t?.truckCapacity);
          const act = Number(t?.actualVolume);
          return cap > 0 && act > cap;
        });
        if (over) overCapacity.push(shapeSubmission(d, masking));
      });
      return {
        scanned: docs.length,
        mixedUnitCount: mixedUnit.length,
        overCapacityCount: overCapacity.length,
        mixedUnit: mixedUnit.slice(0, 50),
        overCapacity: overCapacity.slice(0, 50),
      };
    },
  },

  generate_admin_briefing: {
    label: "Generate admin briefing",
    description:
      "A compact operational snapshot combining pending totals, action-required items, recent disposal activity, and inconsistency counts.",
    categories: ["submissions", "status", "disposal-volume", "data-quality"],
    run: async ({ params, masking }) => {
      const { from, to, days } = resolveDateWindow({ days: params.days || 7 });
      const [pending, action, recent, docs] = await Promise.all([
        DataSLF().countDocuments(liveMatch({ status: "pending" })),
        DataSLF().countDocuments(liveMatch({ status: { $in: ACTION_STATUSES } })),
        DataSLF()
          .find(liveMatch({ dateOfDisposal: { $gte: from, $lte: to } }))
          .select("status totalVolumeTons totalVolumeM3 truckCount")
          .lean(),
        DataSLF().find(liveMatch({})).sort({ createdAt: -1 }).limit(200).lean(),
      ]);
      let tons = 0;
      let m3 = 0;
      recent.forEach((d) => {
        tons += Number(d.totalVolumeTons || 0);
        m3 += Number(d.totalVolumeM3 || 0);
      });
      const mixed = docs.filter(
        (d) => Number(d.totalVolumeTons || 0) > 0 && Number(d.totalVolumeM3 || 0) > 0
      ).length;
      const over = docs.filter((d) =>
        (d.trucks || []).some((t) => Number(t?.truckCapacity) > 0 && Number(t?.actualVolume) > Number(t?.truckCapacity))
      ).length;
      return {
        window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
        pendingTotal: pending,
        actionRequiredTotal: action,
        recentSubmissionCount: recent.length,
        recentVolumeTons: maskNum(Number(tons.toFixed(2)), masking),
        recentVolumeM3: maskNum(Number(m3.toFixed(2)), masking),
        inconsistencies: { mixedUnitBatches: mixed, overCapacityBatches: over },
      };
    },
  },

  draft_portal_user_message: {
    label: "Draft a portal-user message",
    description:
      "Gathers a bounded status summary for one named company so a message to that portal user can be DRAFTED. This only prepares a draft — it never sends anything.",
    categories: ["submissions", "status"],
    run: async ({ params, masking }) => {
      const company = String(params.companyName || "").trim();
      if (!company) {
        return { error: "companyName is required to draft a message.", draftOnly: true };
      }
      const limit = clampLimit(params.limit, 20, 50);
      const docs = await DataSLF()
        .find(liveMatch({ lguCompanyName: new RegExp(`^${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }))
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const byStatus = {};
      docs.forEach((d) => {
        byStatus[d.status || "pending"] = (byStatus[d.status || "pending"] || 0) + 1;
      });
      return {
        draftOnly: true,
        company,
        recentCount: docs.length,
        byStatus,
        submissions: docs.map((d) => shapeSubmission(d, masking)),
      };
    },
  },
};

const FUNCTION_IDS = Object.keys(REGISTRY);

// Public metadata for the settings UI (id, label, description, categories) — no
// implementation details.
const FUNCTION_CATALOG = FUNCTION_IDS.map((id) => ({
  id,
  label: REGISTRY[id].label,
  description: REGISTRY[id].description,
  categories: REGISTRY[id].categories,
}));

function isAllowed(functionId, allowedFunctions) {
  if (!FUNCTION_IDS.includes(functionId)) return false;
  // Empty allowlist → all read-only functions permitted.
  if (!Array.isArray(allowedFunctions) || allowedFunctions.length === 0) return true;
  return allowedFunctions.includes(functionId);
}

// Run one allowlisted function → { data, categories }. Throws on unknown id.
async function runFunction(functionId, { params = {}, masking = false }) {
  const fn = REGISTRY[functionId];
  if (!fn) throw new Error("Unknown function");
  const data = await fn.run({ params, masking });
  return { data, categories: fn.categories, label: fn.label };
}

module.exports = { REGISTRY, FUNCTION_IDS, FUNCTION_CATALOG, isAllowed, runFunction };
