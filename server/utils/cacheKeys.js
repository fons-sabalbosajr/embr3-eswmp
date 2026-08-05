// Shared cache keys so the route that POPULATES a cache and the write-path that
// INVALIDATES it agree on the exact string, without either importing the other
// (which would create a require cycle through socketEmit).

module.exports = {
  // GET /api/data-slf/summary-by-slf — full-scan aggregation + facility name
  // lookup; recomputed only when submissions/baselines/facility data change.
  SUMMARY_BY_SLF_CACHE_KEY: "summary-by-slf",
  // GET /api/data-slf/stats — 8 aggregation passes over the live submissions;
  // keyed by dummy-inclusion (`stats:default` / `stats:dummy`). Same invalidation.
  STATS_CACHE_PREFIX: "stats",
  // GET /api/data-slf/cell-usage — per-cell truck-volume rollup for the SLF Data
  // Table; keyed by dummy-inclusion. Same invalidation as the two above.
  CELL_USAGE_CACHE_PREFIX: "cell-usage",
};
