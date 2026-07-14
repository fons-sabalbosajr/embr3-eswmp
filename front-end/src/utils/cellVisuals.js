// Centralized cell TYPE / STATUS / CAPACITY visual system.
//
// Two independent axes — do not mix them:
//   • Cell TYPE   → the primary category COLOR (Residual = green, Hazardous = red…).
//   • Cell STATUS → the operational VISUAL STATE (opacity, fill style, badge, border).
//
// A gauge therefore always keeps its type colour; the status only modulates how
// that colour is presented (muted, dashed, hatched, …). This keeps "what kind of
// waste is this cell for?" and "is this cell currently operating?" separately
// readable instead of fighting over the same colour channel.
//
// The status keys below are the ACTUAL values stored on SlfFacility.cellStatuses:
//   "Active Cell" | "Used/Completed" | "Under Construction" | "Reserved Area"
//   "Not Existed" | "Operational" | "Closed" | "Reserved Cell"
// Unknown/legacy values fall back to a neutral config rather than throwing.

// ── Cell type → category colour ──────────────────────────────────────────────
// Values reuse the Ant Design palette already used across the admin app
// (#52c41a success / #cf1322 error / #fa8c16 warning), so the gauges stay
// consistent with the surrounding Tags and Progress bars.
export const CELL_TYPE_COLOR_MAP = {
  Residual: { color: "#52c41a", tag: "green", label: "Residual" },
  "Hazardous Waste": { color: "#cf1322", tag: "red", label: "Hazardous Waste" },
  "Treated Hazardous Waste": { color: "#fa8c16", tag: "volcano", label: "Treated Hazardous Waste" },
  // Legacy short form still present on older facility records.
  "Treated Haz Waste": { color: "#fa8c16", tag: "volcano", label: "Treated Haz Waste" },
};

const DEFAULT_CELL_TYPE = { color: "#8c8c8c", tag: "default", label: "Unknown" };

const HAZARD_RE = /hazard|\bhaz\b/i;
const TREATED_RE = /treated/i;

// Resolve a cell type to its colour config. Unknown types are matched by intent
// (anything mentioning "haz" is hazardous) before falling back to neutral grey.
export function getCellTypeConfig(type) {
  const key = String(type || "").trim();
  if (CELL_TYPE_COLOR_MAP[key]) return { ...CELL_TYPE_COLOR_MAP[key], isHazardous: HAZARD_RE.test(key) };
  if (!key) return { ...DEFAULT_CELL_TYPE, isHazardous: false };
  if (HAZARD_RE.test(key)) {
    const base = TREATED_RE.test(key)
      ? CELL_TYPE_COLOR_MAP["Treated Hazardous Waste"]
      : CELL_TYPE_COLOR_MAP["Hazardous Waste"];
    return { ...base, label: key, isHazardous: true };
  }
  return { ...CELL_TYPE_COLOR_MAP.Residual, label: key, isHazardous: false };
}

export function isHazardousCellType(type) {
  return getCellTypeConfig(type).isHazardous;
}

// ── Cell status → operational visual state ───────────────────────────────────
// `fill` drives how the gauge arc is drawn:
//   "solid"  — normal
//   "muted"  — drawn at reduced opacity (cell no longer receiving waste)
//   "dashed" — drawn as a dashed arc (cell not yet real / reserved)
//   "none"   — no arc at all (cell does not exist)
// `track` optionally overrides the gauge's background ring.
const CELL_STATUS_CONFIG = {
  "Active Cell": {
    key: "active",
    label: "Active Cell",
    fill: "solid",
    opacity: 1,
    color: "#52c41a",
    bg: "#f6ffed",
    tag: "green",
    badge: "success",
    disabled: false,
    description: "Currently receiving waste.",
  },
  Operational: {
    key: "active",
    label: "Operational",
    fill: "solid",
    opacity: 1,
    color: "#52c41a",
    bg: "#f6ffed",
    tag: "green",
    badge: "success",
    disabled: false,
    description: "Currently receiving waste.",
  },
  "Used/Completed": {
    key: "completed",
    label: "Used/Completed",
    fill: "muted",
    opacity: 0.55,
    color: "#722ed1",
    bg: "#f9f0ff",
    tag: "purple",
    badge: "default",
    disabled: true,
    description: "Filled and taken out of service.",
  },
  Closed: {
    key: "closed",
    label: "Closed",
    fill: "muted",
    opacity: 0.45,
    color: "#8c8c8c",
    bg: "#f5f5f5",
    tag: "default",
    badge: "default",
    disabled: true,
    description: "Closed — no longer receiving waste.",
  },
  "Under Construction": {
    key: "construction",
    label: "Under Construction",
    fill: "dashed",
    opacity: 0.7,
    color: "#faad14",
    bg: "#fffbe6",
    tag: "orange",
    badge: "processing",
    disabled: true,
    description: "Being built — not yet available.",
  },
  "Reserved Area": {
    key: "reserved",
    label: "Reserved Area",
    fill: "dashed",
    opacity: 0.6,
    color: "#1677ff",
    bg: "#e6f4ff",
    tag: "blue",
    badge: "default",
    disabled: true,
    description: "Reserved for future cell development.",
  },
  "Reserved Cell": {
    key: "reserved",
    label: "Reserved Cell",
    fill: "dashed",
    opacity: 0.6,
    color: "#1677ff",
    bg: "#e6f4ff",
    tag: "blue",
    badge: "default",
    disabled: true,
    description: "Reserved for future use.",
  },
  "Not Existed": {
    key: "not-existing",
    label: "Not Existed",
    fill: "none",
    opacity: 0.35,
    color: "#d9d9d9",
    bg: "#fafafa",
    tag: "default",
    badge: "default",
    disabled: true,
    description: "Cell does not exist.",
  },
};

const UNKNOWN_STATUS = {
  key: "unknown",
  label: "Unknown",
  fill: "solid",
  opacity: 0.8,
  color: "#8c8c8c",
  bg: "#fafafa",
  tag: "default",
  badge: "default",
  disabled: false,
  description: "",
};

// Resolve a stored cellStatus to its visual config. Never throws on an
// unrecognised value — new statuses added to the schema degrade to a readable
// neutral state instead of breaking the gauge.
export function getCellStatusConfig(status) {
  const key = String(status || "").trim();
  if (CELL_STATUS_CONFIG[key]) return CELL_STATUS_CONFIG[key];
  return { ...UNKNOWN_STATUS, label: key || "Unknown" };
}

// A "Not Existed" cell is excluded from listings and utilization entirely.
export function isNonExistentCell(status) {
  return getCellStatusConfig(status).key === "not-existing";
}

export const CELL_STATUS_OPTIONS = Object.keys(CELL_STATUS_CONFIG).map((value) => ({
  label: value,
  value,
}));

export const CELL_TYPE_OPTIONS = ["Residual", "Treated Hazardous Waste", "Hazardous Waste"].map(
  (value) => ({ label: value, value }),
);

// ── Canonical cell name ──────────────────────────────────────────────────────
// The facility's `cellNames[index]` is the ONLY source of a cell's display name.
// Submissions also carry a `cellName` copied at submit time; rendering that copy
// is what left renamed cells showing stale labels, so it is used only as a
// fallback for legacy rows that never stored a cellIndex.
//
// `cellIndex` is the relationship key — never the name.
export function resolveCellName(facility, index, storedName) {
  // NB: Number(null) === 0, so a legacy row with cellIndex: null would otherwise
  // resolve to cell 0 and display a completely different cell's name. Reject the
  // empty values explicitly before coercing.
  const hasIndex = index !== null && index !== undefined && index !== "";
  const idx = hasIndex ? Number(index) : NaN;
  if (Number.isInteger(idx) && idx >= 0) {
    const current = facility?.cellNames?.[idx];
    if (current) return String(current).trim();
    return `Cell ${idx + 1}`; // no custom name declared for this cell
  }
  return storedName ? String(storedName).trim() : "";
}

// ── Capacity utilization → analysis status ───────────────────────────────────
// Thresholds match the 75 / 90 cut-offs already used across the admin dashboards
// (SLF Monitoring, Cell Waste Placement, SLF Dashboard). "Full" and
// "Overcapacity" extend that scale past 100% for the Volume Analysis tool.
// Change them HERE — nowhere else.
export const CAPACITY_THRESHOLDS = {
  elevated: 75,
  nearFull: 90,
  full: 100,
};

export const CAPACITY_STATUS = {
  normal: { key: "normal", label: "Normal", color: "#52c41a", tag: "green", badge: "success" },
  elevated: { key: "elevated", label: "Elevated", color: "#faad14", tag: "gold", badge: "warning" },
  nearFull: { key: "nearFull", label: "Near Full", color: "#fa8c16", tag: "orange", badge: "warning" },
  full: { key: "full", label: "Full", color: "#ff4d4f", tag: "red", badge: "error" },
  overcapacity: { key: "overcapacity", label: "Overcapacity", color: "#a8071a", tag: "red", badge: "error" },
  unknown: { key: "unknown", label: "No Capacity Data", color: "#8c8c8c", tag: "default", badge: "default" },
};

// Classify a utilization percentage. `null`/NaN (capacity missing) returns the
// explicit "unknown" state — never a fabricated 0% / "Normal".
export function getCapacityStatus(utilizationPercentage) {
  const pct = Number(utilizationPercentage);
  if (utilizationPercentage == null || !Number.isFinite(pct)) return CAPACITY_STATUS.unknown;
  if (pct > CAPACITY_THRESHOLDS.full) return CAPACITY_STATUS.overcapacity;
  if (pct >= CAPACITY_THRESHOLDS.full) return CAPACITY_STATUS.full;
  if (pct >= CAPACITY_THRESHOLDS.nearFull) return CAPACITY_STATUS.nearFull;
  if (pct >= CAPACITY_THRESHOLDS.elevated) return CAPACITY_STATUS.elevated;
  return CAPACITY_STATUS.normal;
}

export const CAPACITY_STATUS_OPTIONS = [
  CAPACITY_STATUS.normal,
  CAPACITY_STATUS.elevated,
  CAPACITY_STATUS.nearFull,
  CAPACITY_STATUS.full,
  CAPACITY_STATUS.overcapacity,
].map((s) => ({ label: s.label, value: s.key }));
