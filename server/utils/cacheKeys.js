// Shared cache keys so the route that POPULATES a cache and the write-path that
// INVALIDATES it agree on the exact string, without either importing the other
// (which would create a require cycle through socketEmit).
//
// Every key lives under one namespace so a shared Redis instance can be swept by
// pattern without touching another application's keys, and so `redis-cli --scan
// --pattern 'slf:*'` shows the whole cache at a glance.
//
// Keys must be DETERMINISTIC and must carry every parameter the response depends
// on. Where a route varies by year or by dummy-inclusion, that variance is in the
// key — an ambiguous key returns the wrong data to the wrong caller.

const NAMESPACE = "slf:";

/** Build a namespaced key from its parts. `dashboardKey("stats", "default")`. */
const key = (...parts) => NAMESPACE + parts.filter((p) => p !== undefined && p !== null && p !== "").join(":");

/** Normalise a `?year=` query value into a key segment. */
const yearSeg = (year) => {
  const n = Number(year);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : "all";
};

module.exports = {
  NAMESPACE,
  key,
  yearSeg,

  // ── SLF submissions (routes/dataSLF.js) ──
  // GET /api/data-slf/summary-by-slf — full-scan aggregation + facility name
  // lookup; recomputed only when submissions/baselines/facility data change.
  SUMMARY_BY_SLF_CACHE_KEY: `${NAMESPACE}dashboard:summary-by-slf`,
  // GET /api/data-slf/stats — 8 aggregation passes over the live submissions;
  // keyed by dummy-inclusion (`…:stats:default` / `…:stats:dummy`).
  STATS_CACHE_PREFIX: `${NAMESPACE}dashboard:stats`,
  // GET /api/data-slf/cell-usage — per-cell truck-volume rollup for the SLF Data
  // Table; keyed by dummy-inclusion. Same invalidation as the two above.
  CELL_USAGE_CACHE_PREFIX: `${NAMESPACE}dashboard:cell-usage`,
  // GET /api/data-slf/cell-placement-overview/:facilityId — the Cell Waste
  // Placement tab's per-cell fill panel. One facility's occupancy rollup, keyed
  // by facility id + the pre-baseline-exclusion setting that changes the answer.
  // Derived from submissions AND the baseline, so it is invalidated by the same
  // writes as the rest of `slfData` in socketEmit.staleKeysFor.
  CELL_PLACEMENT_PREFIX: `${NAMESPACE}admin:cell-placement`,
  // GET /api/data-slf/baselines — a full-collection aggregation (match on ten
  // possible baseline fields, blocking $sort, $group per SLF) that three pages
  // load on mount: Submission Summary, SLF Monitoring and the Baseline Data tab.
  // The underlying data changes only on a baseline save/approve/lock/reject, all
  // of which already route through refreshAdmin/refreshPortal("baselines"), so
  // the invalidation is exact. Keyed by dummy scope — a developer's inline
  // SAMPLE baselines must never be served to an ordinary admin.
  BASELINES_CACHE_PREFIX: `${NAMESPACE}admin:baselines`,
  // Plate → declared truck capacity, per SLF, read by the portal's Organize Cell
  // Placement modal to pre-fill a capacity the operator already encoded on their
  // baseline.
  //
  // It is derived from `accreditedHaulers`, which is deliberately duplicated onto
  // every one of an SLF's baseline-carrying records and is by far the largest
  // thing on the document — measured on production, 5,099 KB across one
  // facility's 22 records. Rebuilding the index meant re-reading all of it on
  // every open of the modal. Cached per facility set and invalidated by the same
  // baseline/submission writes as the rest of `slfData`, so a newly declared
  // plate is offered as soon as it is saved.
  PORTAL_FLEET_CAPACITY_PREFIX: `${NAMESPACE}portal:fleet-capacity`,

  // ── Dashboard module stats (one prefix per collection) ──
  // Each is the `/stats` (or `/summary`) fan-out target of the admin dashboard.
  // The prefix is what the module's own write paths invalidate, so a POST/PUT/
  // DELETE on that collection clears every year/dummy variant of its tile data.
  DASHBOARD_PREFIX: `${NAMESPACE}dashboard:`,
  MODULE_STATS: {
    slfFacilities: `${NAMESPACE}dashboard:slf-facilities`,
    tenYearSwm: `${NAMESPACE}dashboard:ten-year-swm`,
    fundedMrf: `${NAMESPACE}dashboard:funded-mrf`,
    lguInitiatedMrf: `${NAMESPACE}dashboard:lgu-initiated-mrf`,
    trashTraps: `${NAMESPACE}dashboard:trash-traps`,
    swmEquipment: `${NAMESPACE}dashboard:swm-equipment`,
    openDumpsites: `${NAMESPACE}dashboard:open-dumpsites`,
    residualContainment: `${NAMESPACE}dashboard:residual-containment`,
    projectDescScoping: `${NAMESPACE}dashboard:project-desc-scoping`,
    technicalAssistance: `${NAMESPACE}dashboard:technical-assistance`,
    transferStations: `${NAMESPACE}dashboard:transfer-stations`,
    lguAssistDiversion: `${NAMESPACE}dashboard:lgu-assist-diversion`,
    dataHistory: `${NAMESPACE}dashboard:data-history`,
    slfClients: `${NAMESPACE}dashboard:slf-clients-summary`,
  },

  // ── Reference / master data (long TTL, small write surface) ──
  // Active portal field definitions — read on every portal Data Entry load,
  // written only by the four admin field-settings routes.
  PORTAL_FIELDS_CACHE_KEY: `${NAMESPACE}reference:portal-fields`,
  // GET /api/data-slf?mode=list — Admin → Portal Submissions. A grouped
  // aggregation re-run in full on every page change, filter change, search and
  // poll; measured at 0.9–2.8s for a 14KB page, so the cost is the aggregation,
  // not the payload. Keyed by every filter/sort/page parameter AND by the
  // RESOLVED dummy scope (see adminSubmissionsCacheKey — a caller who is not a
  // developer must never share a key with one who is).
  ADMIN_SUBMISSIONS_PREFIX: `${NAMESPACE}admin:submissions`,
  // The rollup tiles beside that table. Both are global — no query parameters and
  // no user context — so one entry serves every admin.
  ADMIN_ANALYTICS_KEY: `${NAMESPACE}admin:analytics-summary`,
  ADMIN_SUMMARY_DASHBOARD_KEY: `${NAMESPACE}admin:summary-dashboard`,
  // GET /api/logs/analyze — VERA log detection. ~1.7s of aggregation over the
  // selected window, re-run whenever an admin reopens the panel. The LOG LIST is
  // deliberately not cached (see routes/logs.js) — only this analysis is.
  LOG_ANALYSIS_PREFIX: `${NAMESPACE}admin:log-analysis`,
  // GET /api/data-slf/waste-received-summary/:slfName — the Portal Mini
  // Dashboard's figures (Submitted Vol., the baseline/submitted charts, the
  // client and hauler breakdowns). Measured at 3.5–8s per call on the larger
  // facilities, and identical for every operator of the same SLF: the route
  // reads only :slfName, ?slfId and ?year, never req.user. Keyed by all three.
  WASTE_RECEIVED_PREFIX: `${NAMESPACE}portal:waste-received`,
  // Drive file name/type for legacy media URLs (routes/upload.js). Immutable for
  // a stored file, and a miss costs a Google Drive round trip.
  MEDIA_META_PREFIX: `${NAMESPACE}media-meta`,
  // PSGC address lookups. These proxy an EXTERNAL API (psgc.gitlab.io), so a miss
  // costs a network round trip, not a Mongo query — and the data is effectively
  // immutable. Keyed by the upstream URL.
  PSGC_PREFIX: `${NAMESPACE}reference:psgc`,
};
