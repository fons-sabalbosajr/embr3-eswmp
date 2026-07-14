// Server-side capacity classification — the single place thresholds live on the
// backend. Mirrors front-end/src/utils/cellVisuals.js (CAPACITY_THRESHOLDS), and
// the thresholds themselves come from the 75 / 90 cut-offs already used across
// the admin dashboards (SLF Monitoring, Cell Waste Placement, Cell Infra
// Overview). "full" and "overcapacity" extend that same scale past 100%.
//
// The Volume Analysis endpoint classifies rows HERE and ships the result, so the
// browser never re-derives thresholds for a large dataset.

const CAPACITY_THRESHOLDS = {
  elevated: 75,
  nearFull: 90,
  full: 100,
};

const CAPACITY_STATUS_KEYS = ["normal", "elevated", "nearFull", "full", "overcapacity", "unknown"];

// Classify a utilization percentage. Missing capacity → "unknown", never a
// fabricated 0% / "normal".
function getCapacityStatus(utilizationPercentage) {
  const pct = Number(utilizationPercentage);
  if (utilizationPercentage == null || !Number.isFinite(pct)) return "unknown";
  if (pct > CAPACITY_THRESHOLDS.full) return "overcapacity";
  if (pct >= CAPACITY_THRESHOLDS.full) return "full";
  if (pct >= CAPACITY_THRESHOLDS.nearFull) return "nearFull";
  if (pct >= CAPACITY_THRESHOLDS.elevated) return "elevated";
  return "normal";
}

// The same classification expressed as a Mongo aggregation expression, so rows
// can be classified (and therefore filtered/sorted) inside the pipeline rather
// than after fetching everything into Node.
function capacityStatusExpr(pctField) {
  return {
    $switch: {
      branches: [
        { case: { $eq: [pctField, null] }, then: "unknown" },
        { case: { $gt: [pctField, CAPACITY_THRESHOLDS.full] }, then: "overcapacity" },
        { case: { $gte: [pctField, CAPACITY_THRESHOLDS.full] }, then: "full" },
        { case: { $gte: [pctField, CAPACITY_THRESHOLDS.nearFull] }, then: "nearFull" },
        { case: { $gte: [pctField, CAPACITY_THRESHOLDS.elevated] }, then: "elevated" },
      ],
      default: "normal",
    },
  };
}

module.exports = { CAPACITY_THRESHOLDS, CAPACITY_STATUS_KEYS, getCapacityStatus, capacityStatusExpr };
