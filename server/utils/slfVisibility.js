// ── Non-operational SLF visibility ──────────────────────────────────────────
//
// THE RULE. When a facility is no longer operational, its data and records are
// hidden from the Portal Submissions module — baselines, submissions, summaries,
// reports and cell placements alike. A closed site's history should not sit in
// the working lists an operator reviews every day.
//
// WHY A PLUGIN, not a filter per endpoint. Portal Submissions is seven tabs over
// a dozen endpoints, all reading DataSLF through different queries and
// aggregations. Filtering each one by hand guarantees that the next endpoint
// added forgets to — and a rule about hiding data fails SILENTLY when it is
// forgotten, because the symptom is data appearing, which looks like normal
// behaviour. Applied once on the model, every current and future query inherits
// it. This mirrors utils/yearVisibility exactly, for exactly the same reason.
//
// WHAT IS NOT HIDDEN, deliberately:
//   • The FACILITY record itself. SLF Monitoring is where a facility's status is
//     reviewed and set — hiding non-operational facilities there would remove the
//     screen you use to mark one operational again, and there would be no way
//     back. Only the facility's DATA is hidden.
//   • Anything, when the setting is off. It defaults OFF: this hides real records
//     from real reports, so it is an explicit choice an admin makes in
//     App Settings → Data Maintenance → Non-Operational SLFs, not a default that
//     silently changes what past reports contain.
//   • Facilities the admin has listed as exceptions — a site that is closed but
//     still under review, whose records have to stay visible.

const { AsyncLocalStorage } = require("async_hooks");
const AppSettings = require("../models/AppSettings");

const CACHE_TTL_MS = 15000;

// Bypass scope, for the code that must see hidden facilities BY DEFINITION: the
// settings screen that lists what is being hidden, and any facility-status
// workflow. Without it, turning the rule on would hide the controls for turning
// it off.
const _bypassStore = new AsyncLocalStorage();

/** Run `fn` (must return a Promise) with non-operational filtering disabled. */
function bypassSlfVisibility(fn) {
  return _bypassStore.run(true, fn);
}

let cachedConfig = { enabled: false, hiddenIds: [], expiresAt: 0 };

function clearSlfVisibilityCache() {
  cachedConfig = { enabled: false, hiddenIds: [], expiresAt: 0 };
}

/** True when a stored status reads as non-operational. */
function isNonOperationalStatus(statusOfSLF) {
  return /non/i.test(String(statusOfSLF || ""));
}

/**
 * The facilities whose data is currently hidden.
 *
 * Resolved from the facility records rather than stored, so marking a site
 * non-operational takes effect on its own — there is no second list to keep in
 * step, and no way for the two to disagree.
 */
async function getSlfVisibilityConfig() {
  if (Date.now() < cachedConfig.expiresAt) return cachedConfig;

  const settings = await AppSettings.findOne()
    .select("hideNonOperationalSlfEnabled nonOperationalSlfExceptions")
    .lean()
    .catch(() => null);

  if (!settings?.hideNonOperationalSlfEnabled) {
    cachedConfig = { enabled: false, hiddenIds: [], expiresAt: Date.now() + CACHE_TTL_MS };
    return cachedConfig;
  }

  const exceptions = new Set(
    (Array.isArray(settings.nonOperationalSlfExceptions) ? settings.nonOperationalSlfExceptions : [])
      .map((id) => String(id || ""))
      .filter(Boolean),
  );

  let hiddenIds = [];
  try {
    // Required lazily: this module is loaded by the DataSLF schema, and requiring
    // a model at the top would create a load-order cycle.
    const SlfFacility = require("../models/SlfFacility");
    const facilities = await bypassSlfVisibility(() =>
      SlfFacility.find({ deletedAt: null }).select("_id statusOfSLF").lean(),
    );
    // ObjectIds, NOT strings. `find` would cast a string for a typed path, but
    // `aggregate` does not cast at all — a `$nin` of strings against an ObjectId
    // field matches nothing, so every aggregation would quietly hide nothing
    // while every `find` hid correctly. Most of Portal Submissions reads through
    // aggregations, so that failure would look like the rule simply not working.
    hiddenIds = facilities
      .filter((facility) => isNonOperationalStatus(facility.statusOfSLF))
      .filter((facility) => !exceptions.has(String(facility._id)))
      .map((facility) => facility._id);
  } catch {
    // A lookup failure must not hide everything OR reveal everything abruptly —
    // it falls back to hiding nothing, which is the same as the setting being
    // off, and the next call retries.
    hiddenIds = [];
  }

  cachedConfig = { enabled: true, hiddenIds, expiresAt: Date.now() + CACHE_TTL_MS };
  return cachedConfig;
}

/**
 * The filter clause. Records with NO facility reference are never hidden: a
 * legacy record that predates the reference cannot be attributed to a
 * non-operational site, and hiding it would be a guess.
 */
function buildSlfVisibilityFilter(field, hiddenIds) {
  if (!hiddenIds.length) return null;
  return {
    $or: [
      { [field]: { $exists: false } },
      { [field]: null },
      { [field]: { $nin: hiddenIds } },
    ],
  };
}

function insertAggregateMatch(pipeline, matchStage) {
  if (!matchStage) return;
  const insertIndex =
    pipeline.length > 0 && (pipeline[0].$geoNear || pipeline[0].$search) ? 1 : 0;
  pipeline.splice(insertIndex, 0, { $match: matchStage });
}

/**
 * Hide the data of non-operational facilities on every query of a model.
 *
 * @param {string} field            the schema path holding the facility id
 * @param {string} [optionName]     query option that opts a call OUT of the rule
 */
function createSlfVisibilityPlugin({ field, optionName = "includeNonOperationalSlf" }) {
  return function slfVisibilityPlugin(schema) {
    // Mongoose 9+ async middleware: do NOT accept or call `next`.
    async function applyQueryVisibility() {
      if (_bypassStore.getStore()) return;
      const options = this.getOptions ? this.getOptions() : this.options || {};
      if (options?.[optionName]) return;

      const config = await getSlfVisibilityConfig();
      if (!config.enabled || !config.hiddenIds.length) return;

      // `.and([filter])`, NOT `.where(filter)` — the filter is itself a top-level
      // `$or`, and Mongoose MERGES `$or` arrays, which would turn the rule into an
      // ALTERNATIVE to the caller's own conditions instead of a restriction. The
      // same trap is documented at length in utils/yearVisibility.
      const filter = buildSlfVisibilityFilter(field, config.hiddenIds);
      if (filter) this.and([filter]);
    }

    [
      "countDocuments",
      "find",
      "findOne",
      "findOneAndDelete",
      "findOneAndReplace",
      "findOneAndUpdate",
    ].forEach((hook) => schema.pre(hook, applyQueryVisibility));

    schema.pre("aggregate", async function applyAggregateVisibility() {
      if (_bypassStore.getStore()) return;
      const options = this.options || {};
      if (options?.[optionName]) return;

      const config = await getSlfVisibilityConfig();
      if (!config.enabled || !config.hiddenIds.length) return;

      insertAggregateMatch(this.pipeline(), buildSlfVisibilityFilter(field, config.hiddenIds));
    });
  };
}

module.exports = {
  bypassSlfVisibility,
  clearSlfVisibilityCache,
  getSlfVisibilityConfig,
  isNonOperationalStatus,
  buildSlfVisibilityFilter,
  createSlfVisibilityPlugin,
};
