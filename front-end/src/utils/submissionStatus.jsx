// SINGLE frontend source of truth for submission-status presentation +
// classification, reused by the SLF Location Map, Disposal Calendar, and the
// Disposal Activity dropdown so status→icon/colour mappings are never duplicated.
// Keys mirror server/utils/submissionStatus.js.
import {
  CheckCircleFilled,
  ClockCircleFilled,
  UndoOutlined,
  CloseCircleFilled,
  MinusCircleOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";

// Normalize a raw stored DataSLF.status to a canonical key.
export function normalizeStatus(status) {
  const v = String(status || "").toLowerCase().trim();
  if (!v || v === "pending") return "pending";
  if (v.includes("acknowledg") || v === "approved" || v === "accepted" || v === "completed") return "acknowledged";
  if (v.includes("revert")) return "reverted";
  if (v.includes("reject")) return "rejected";
  return "pending";
}

// FULL workflow classification (Disposal Activity modal): acknowledged → pending
// → reverted → rejected → none.
export function classifySlfStatus(rawStatuses = []) {
  const set = new Set(rawStatuses.map(normalizeStatus));
  if (set.has("acknowledged")) return "submitted";
  if (set.has("pending")) return "pending";
  if (set.has("reverted")) return "reverted";
  if (set.has("rejected")) return "rejected";
  return "none";
}

// MAP-ONLY classification — three states. Reverted/rejected are NOT valid map
// submissions, so a date with only reverted/rejected records resolves to
// "no-submission". Priority: acknowledged → pending → no-submission.
export function classifyMapStatus(rawStatuses = []) {
  const set = new Set(rawStatuses.map(normalizeStatus));
  if (set.has("acknowledged")) return "acknowledged";
  if (set.has("pending")) return "pending";
  return "no-submission";
}

// Presentation config keyed by the CLASSIFIED map status (submitted/pending/…)
// AND the raw per-record status (acknowledged/…). `pulse` marks statuses that
// should draw attention on the map.
// `mapStatus` maps each workflow status to one of the three MAP states.
export const STATUS_PRESENTATION = {
  submitted: { key: "submitted", label: "Submitted", color: "#1677ff", icon: CheckCircleFilled, tip: "Acknowledged submission for the selected date", pulse: true, mapStatus: "acknowledged", priority: 1 },
  acknowledged: { key: "acknowledged", label: "Acknowledged", color: "#1677ff", icon: CheckCircleFilled, tip: "Submission acknowledged", pulse: true, mapStatus: "acknowledged", priority: 1 },
  pending: { key: "pending", label: "Pending", color: "#faad14", icon: ClockCircleFilled, tip: "Submission awaiting review", pulse: true, mapStatus: "pending", priority: 2 },
  reverted: { key: "reverted", label: "Reverted", color: "#fa8c16", icon: UndoOutlined, tip: "Submission reverted for correction", pulse: false, mapStatus: "no-submission", priority: 3 },
  rejected: { key: "rejected", label: "Rejected", color: "#ff4d4f", icon: CloseCircleFilled, tip: "Submission rejected", pulse: false, mapStatus: "no-submission", priority: 4 },
  none: { key: "none", label: "No Submission", color: "#8c8c8c", icon: MinusCircleOutlined, tip: "No valid submission for the selected date", pulse: false, mapStatus: "no-submission", priority: 5 },
  unknown: { key: "unknown", label: "Submission Status Unknown", color: "#bfbfbf", icon: QuestionCircleOutlined, tip: "Submission status could not be determined", pulse: false, mapStatus: "no-submission", priority: 6 },
};

// MAP presentation keyed by the 3 map states (acknowledged/pending/no-submission).
export const MAP_PRESENTATION = {
  acknowledged: { key: "acknowledged", label: "Acknowledged Submission", color: "#1677ff", icon: CheckCircleFilled, glyph: "✓", tip: "Has an acknowledged submission for the selected date", pulse: true },
  pending: { key: "pending", label: "Pending Submission", color: "#faad14", icon: ClockCircleFilled, glyph: "◷", tip: "Has a pending initial submission for the selected date", pulse: true },
  // Pending resubmission (previously reverted, now resubmitted and awaiting review).
  // Uses the system's resubmission colour (the "reverted" orange) so it reads as
  // distinct from a pending initial submission.
  "pending-resubmission": { key: "pending-resubmission", label: "Pending Resubmission", color: "#fa8c16", icon: UndoOutlined, glyph: "↻", tip: "Has a pending resubmission (previously reverted) for the selected date", pulse: true },
  "no-submission": { key: "no-submission", label: "No Submission Today", color: "#8c8c8c", icon: MinusCircleOutlined, glyph: "○", tip: "No pending or acknowledged submission for the selected date", pulse: false },
};
export const mapPresentationFor = (key) => MAP_PRESENTATION[key] || MAP_PRESENTATION["no-submission"];

export const presentationFor = (key) => STATUS_PRESENTATION[key] || STATUS_PRESENTATION.unknown;
// Presentation for a RAW record status (used by the dropdown status icons).
export const presentationForRaw = (raw) => {
  const n = normalizeStatus(raw);
  return STATUS_PRESENTATION[n === "acknowledged" ? "acknowledged" : n] || STATUS_PRESENTATION.unknown;
};
