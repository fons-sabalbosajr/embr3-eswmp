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
  "Full Capacity": {
    key: "full",
    label: "Full Capacity",
    fill: "solid",
    opacity: 1,
    color: "#ff4d4f",
    bg: "#fff1f0",
    tag: "red",
    badge: "error",
    disabled: true,
    description: "Cell has reached full capacity.",
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
    color: "#8c8c8c",
    bg: "#f5f5f5",
    tag: "default",
    badge: "default",
    disabled: true,
    description: "Reserved for future cell development.",
  },
  "Reserved Cell": {
    key: "reserved",
    label: "Reserved Cell",
    fill: "dashed",
    opacity: 0.6,
    color: "#8c8c8c",
    bg: "#f5f5f5",
    tag: "default",
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

// ── SLF identity palette ─────────────────────────────────────────────────────
// A fixed, visually-distinct set of colours assigned deterministically to each
// SLF so the same facility keeps the same colour everywhere (gauges, charts,
// legends) instead of random inline colours. Reuse getSlfColor() — never
// hand-pick a per-SLF colour at the call site.
export const SLF_COLOR_PALETTE = [
  "#1677ff", // blue
  "#52c41a", // green
  "#722ed1", // purple
  "#fa8c16", // orange
  "#13c2c2", // cyan
  "#eb2f96", // magenta
  "#2f54eb", // geekblue
  "#a0d911", // lime
  "#fa541c", // volcano
  "#08979c", // teal
  "#9254de", // light purple
  "#d48806", // gold-dark
  "#c41d7f", // deep magenta
  "#096dd9", // deep blue
  "#389e0d", // deep green
];

// Deterministic string hash → stable palette slot across reloads.
function hashSlfKey(key) {
  const s = String(key || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Resolve an SLF's assigned palette colour.
//   key   — a stable identifier for the SLF (id, name, lgu…).
//   index — optional position in a known list; when provided it guarantees
//           distinct colours across that list (preferred for gauge groups).
export function getSlfColor(key, index = null) {
  const id = String(key ?? "").trim().toLowerCase();
  if (Number.isInteger(index) && index >= 0) {
    return SLF_COLOR_PALETTE[index % SLF_COLOR_PALETTE.length];
  }
  if (!id) return "#8c8c8c";
  return SLF_COLOR_PALETTE[hashSlfKey(id) % SLF_COLOR_PALETTE.length];
}

// ── Cell capacity gauge colour bands ─────────────────────────────────────────
// Drives the STROKE colour of an SLF cell capacity gauge. Below the warning
// band the cell shows its SLF's assigned colour; it then escalates as it fills.
// This is intentionally separate from getCapacityStatus (75/90/100 analysis
// scale) — change the gauge bands HERE only.
export const SLF_CAPACITY_BANDS = {
  warning: 70, //  70 – 79.99 %
  alarming: 80, //  80 – 94.99 %
  critical: 95, //  95 %+
};

export const SLF_CAPACITY_COLORS = {
  warning: "#faad14", // gold
  alarming: "#fa8c16", // orange
  critical: "#ff4d4f", // red
  missing: "#bfbfbf", // gray — missing / nonexistent cell
};

// Resolve the gauge stroke colour for a cell's utilization.
//   baseColor — the SLF's assigned colour, used below the warning band.
//   exists    — false ⇒ gray (nonexistent / missing cell).
// Null / NaN utilization also degrades to gray rather than a fabricated colour.
export function getSlfCapacityColor(
  utilizationPercentage,
  { baseColor = "#1677ff", exists = true } = {},
) {
  if (!exists) return SLF_CAPACITY_COLORS.missing;
  const pct = Number(utilizationPercentage);
  if (utilizationPercentage == null || !Number.isFinite(pct)) {
    return SLF_CAPACITY_COLORS.missing;
  }
  if (pct >= SLF_CAPACITY_BANDS.critical) return SLF_CAPACITY_COLORS.critical;
  if (pct >= SLF_CAPACITY_BANDS.alarming) return SLF_CAPACITY_COLORS.alarming;
  if (pct >= SLF_CAPACITY_BANDS.warning) return SLF_CAPACITY_COLORS.warning;
  return baseColor;
}

// ── Cell availability for NEW waste placement ────────────────────────────────
// THE single rule for "can this cell accept new waste?", shared by the portal
// cell selectors, submission validation, edit workflow and admin capacity views
// (the backend mirrors it in server/utils/cellAvailability.js). A cell can accept
// new waste only when it exists, is operational, is under 100% utilization, has
// positive remaining capacity, and — when a proposed volume is supplied — that
// volume fits in the remaining capacity.
//
// Status matching is tolerant: canonical config first (getCellStatusConfig),
// then a keyword fallback that survives differences in case / spacing / hyphens
// / underscores and equivalent labels ("Out of Service", "Inactive", "Used").
const NON_OPERATIONAL_RE =
  /(used|complete|closed|inactive|out.?of.?service|decommission|reserved|construction|not.?exist|full)/i;

export function isOperationalCellStatus(status) {
  const cfg = getCellStatusConfig(status);
  if (cfg.key === "active") return true;
  if (cfg.disabled) return false; // known non-operational config
  // Unknown/legacy status: block only if it clearly reads non-operational.
  return !NON_OPERATIONAL_RE.test(String(status || ""));
}

const CELL_ACCEPT_EPS = 1e-9;

// Evaluate a cell's acceptance. `capacity`/`fill` should already be in the SAME
// unit (callers normalize first). `proposedVolume` (same unit) is optional.
// Returns { ok, code, reason, remaining, utilization } — never throws.
export function getCellAcceptance({
  status,
  capacity,
  fill,
  exists = true,
  proposedVolume = null,
} = {}) {
  const cap = Number(capacity);
  const hasCap = Number.isFinite(cap) && cap > 0;
  const used = Number.isFinite(Number(fill)) ? Number(fill) : 0;
  const remaining = hasCap ? Math.max(0, cap - used) : null;
  const utilization = hasCap ? Math.round((used / cap) * 10000) / 100 : null;
  const cfg = getCellStatusConfig(status);
  const base = { remaining, utilization, statusLabel: cfg.label };
  const s = String(status || "").toLowerCase();

  if (exists === false || cfg.key === "not-existing") {
    return { ...base, ok: false, code: "missing", reason: "Nonexistent" };
  }
  if (!isOperationalCellStatus(status)) {
    const code = /used|complete/.test(s)
      ? "completed"
      : /out.?of.?service|decommission/.test(s)
        ? "outofservice"
        : cfg.key === "completed"
          ? "completed"
          : "nonoperational";
    return { ...base, ok: false, code, reason: cfg.label || "Not operational" };
  }
  if (hasCap && utilization >= 100) {
    return { ...base, ok: false, code: "full", reason: `Full (${Math.round(utilization)}%)` };
  }
  if (hasCap && remaining <= 0) {
    return { ...base, ok: false, code: "full", reason: "No remaining capacity" };
  }
  if (proposedVolume != null && hasCap) {
    const pv = Number(proposedVolume);
    if (Number.isFinite(pv) && pv > remaining + CELL_ACCEPT_EPS) {
      return { ...base, ok: false, code: "insufficient", reason: "Insufficient remaining capacity" };
    }
  }
  return { ...base, ok: true, code: "available", reason: "" };
}

export function canCellAcceptWaste(input) {
  return getCellAcceptance(input).ok;
}

// Build a disabled-state selector label, e.g. "Cell A — Full (100%)".
export function cellDisabledLabel(name, acceptance) {
  const reason = acceptance?.reason || "Unavailable";
  return `${name} — ${reason}`;
}
