// Reusable dummy-data exclusion for production-facing queries.
//
// Dummy/test SLF facilities, portal accounts, and their disposal entries are
// created via Developer Settings > Dummy Data and flagged with the existing
// indexed `isDummy` boolean on the SlfFacility, UserPortal, and DataSLF models.
//
// Production dashboards, tables, reports, charts, and exports must never count
// or display those records. Only developer-menu queries may opt in by passing
// the `isDummy: true`-inclusive clause (see `excludeDummy(..., includeDummy)`).

// Matches only real records. `{ $ne: true }` also catches legacy documents
// where `isDummy` is absent or null (i.e. everything created before the flag).
const NON_DUMMY_CLAUSE = Object.freeze({ isDummy: { $ne: true } });

// Merge the non-dummy clause into an existing filter/`$match` object. Pass
// `includeDummy = true` (developer views) to return the filter untouched.
function excludeDummy(filter = {}, includeDummy = false) {
  return includeDummy ? { ...filter } : { ...filter, ...NON_DUMMY_CLAUSE };
}

// Read the developer opt-in flag from a request query (?includeDummy=true).
function wantsIncludeDummy(req) {
  return String(req?.query?.includeDummy || "").toLowerCase() === "true";
}

module.exports = { NON_DUMMY_CLAUSE, excludeDummy, wantsIncludeDummy };
