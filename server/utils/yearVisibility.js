const { AsyncLocalStorage } = require("async_hooks");
const AppSettings = require("../models/AppSettings");

const CACHE_TTL_MS = 15000;

// Used to bypass year-visibility filtering within a specific async call scope
const _bypassStore = new AsyncLocalStorage();

/**
 * Run `fn` (must return a Promise) with year-visibility filtering disabled.
 * All Mongoose queries executed inside fn will skip the dataYear filter.
 */
function bypassYearVisibility(fn) {
  return _bypassStore.run(true, fn);
}

let cachedConfig = {
  enabled: false,
  cutoffYear: null,
  hiddenYears: [],
  expiresAt: 0,
};

function clearYearVisibilityCache() {
  cachedConfig = {
    enabled: false,
    cutoffYear: null,
    hiddenYears: [],
    expiresAt: 0,
  };
}

async function getYearVisibilityConfig() {
  if (Date.now() < cachedConfig.expiresAt) {
    return cachedConfig;
  }

  const settings = await AppSettings.findOne()
    .select("hideHistoricalRecordsEnabled hideRecordsBeforeOrEqualYear hiddenRecordYears")
    .lean();

  const hiddenYears = Array.isArray(settings?.hiddenRecordYears)
    ? [...new Set(settings.hiddenRecordYears.map((y) => Number(y)).filter((y) => Number.isInteger(y)))]
    : [];

  cachedConfig = {
    enabled: !!settings?.hideHistoricalRecordsEnabled,
    cutoffYear:
      settings?.hideRecordsBeforeOrEqualYear != null
        ? Number(settings.hideRecordsBeforeOrEqualYear)
        : null,
    hiddenYears,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return cachedConfig;
}

function buildDataYearFilter({ cutoffYear, hiddenYears }) {
  const valueClauses = [];

  if (cutoffYear != null && !Number.isNaN(cutoffYear)) {
    valueClauses.push({ dataYear: { $gt: cutoffYear } });
  }

  if (Array.isArray(hiddenYears) && hiddenYears.length > 0) {
    valueClauses.push({ dataYear: { $nin: hiddenYears } });
  }

  if (valueClauses.length === 0) return null;

  const valueRule = valueClauses.length === 1 ? valueClauses[0] : { $and: valueClauses };

  return {
    $or: [
      { dataYear: { $exists: false } },
      { dataYear: null },
      valueRule,
    ],
  };
}

function buildDateFieldYearFilter(fieldName, { cutoffYear, hiddenYears }) {
  const valueClauses = [];

  if (cutoffYear != null && !Number.isNaN(cutoffYear)) {
    valueClauses.push({ [fieldName]: { $gt: new Date(cutoffYear, 11, 31, 23, 59, 59, 999) } });
  }

  if (Array.isArray(hiddenYears) && hiddenYears.length > 0) {
    valueClauses.push({
      $nor: hiddenYears.map((year) => ({
        [fieldName]: {
          $gte: new Date(year, 0, 1, 0, 0, 0, 0),
          $lte: new Date(year, 11, 31, 23, 59, 59, 999),
        },
      })),
    });
  }

  if (valueClauses.length === 0) return null;

  const valueRule = valueClauses.length === 1 ? valueClauses[0] : { $and: valueClauses };

  return {
    $or: [
      { [fieldName]: { $exists: false } },
      { [fieldName]: null },
      valueRule,
    ],
  };
}

function insertAggregateMatch(pipeline, matchStage) {
  if (!matchStage) return;

  const insertIndex =
    pipeline.length > 0 && (pipeline[0].$geoNear || pipeline[0].$search) ? 1 : 0;

  pipeline.splice(insertIndex, 0, { $match: matchStage });
}

function createYearVisibilityPlugin({
  optionName = "includeHiddenYears",
  buildFindFilter,
  buildAggregateFilter,
}) {
  return function yearVisibilityPlugin(schema) {
    // Mongoose 9+ async middleware: do NOT accept or call `next`.
    // Just resolve the Promise to continue, or throw to abort.
    async function applyQueryVisibility() {
      if (_bypassStore.getStore()) return;
      const options = this.getOptions ? this.getOptions() : this.options || {};
      if (options?.[optionName]) return;

      const config = await getYearVisibilityConfig();
      const hasCutoff = config.cutoffYear != null && !Number.isNaN(config.cutoffYear);
      const hasHiddenYears = Array.isArray(config.hiddenYears) && config.hiddenYears.length > 0;
      // Filter activates whenever a cutoff OR hidden years are configured.
      // Hiding a year in App Settings hides those records across the entire app.
      if (!hasCutoff && !hasHiddenYears) return;

      const filter = buildFindFilter(config);
      if (filter) this.where(filter);
    }

    [
      "countDocuments",
      "find",
      "findOne",
      "findOneAndDelete",
      "findOneAndReplace",
      "findOneAndUpdate",
    ].forEach((hook) => {
      schema.pre(hook, applyQueryVisibility);
    });

    schema.pre("aggregate", async function applyAggregateVisibility() {
      if (_bypassStore.getStore()) return;
      if (this.options?.[optionName]) return;

      const config = await getYearVisibilityConfig();
      const hasCutoff = config.cutoffYear != null && !Number.isNaN(config.cutoffYear);
      const hasHiddenYears = Array.isArray(config.hiddenYears) && config.hiddenYears.length > 0;
      if (!hasCutoff && !hasHiddenYears) return;

      insertAggregateMatch(this.pipeline(), buildAggregateFilter(config));
    });
  };
}

const dataYearVisibilityPlugin = createYearVisibilityPlugin({
  buildFindFilter: buildDataYearFilter,
  buildAggregateFilter: buildDataYearFilter,
});

function dateFieldYearVisibilityPlugin(fieldName) {
  return createYearVisibilityPlugin({
    buildFindFilter: (config) => buildDateFieldYearFilter(fieldName, config),
    buildAggregateFilter: (config) => buildDateFieldYearFilter(fieldName, config),
  });
}

module.exports = {
  clearYearVisibilityCache,
  bypassYearVisibility,
  dataYearVisibilityPlugin,
  dateFieldYearVisibilityPlugin,
  getYearVisibilityConfig,
};