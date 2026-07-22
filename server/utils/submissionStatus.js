// SINGLE source of truth for submission-status normalization + per-SLF
// classification, shared by the map endpoint (and any other server consumer) so
// the SLF Location Map and Disposal Calendar can never disagree.
//
// Stored DataSLF.status enum: "pending" | "acknowledged" | "rejected" |
// "revert_requested" | "reverted" (legacy/blank → pending). The frontend mirrors
// these keys in front-end/src/utils/submissionStatus.jsx.

function normalizeStatus(status) {
  const v = String(status || "").toLowerCase().trim();
  if (!v || v === "pending") return "pending";
  if (v.includes("acknowledg") || v === "approved" || v === "accepted" || v === "completed") return "acknowledged";
  if (v.includes("revert")) return "reverted"; // revert_requested + reverted
  if (v.includes("reject")) return "rejected";
  return "pending"; // unknown legacy value → treat as pending (needs review)
}

// Deterministic per-SLF/day status from all its records for the selected date.
// Priority: acknowledged → pending → reverted → rejected → (none). An older
// rejected/reverted record never overrides a newer acknowledged one, because the
// presence of ANY acknowledged record for the day wins.
const CLASSIFY_PRIORITY = ["acknowledged", "pending", "reverted", "rejected"];

function classifySlfStatus(normalizedStatuses = []) {
  const set = new Set(normalizedStatuses);
  if (set.has("acknowledged")) return "submitted";
  if (set.has("pending")) return "pending";
  if (set.has("reverted")) return "reverted";
  if (set.has("rejected")) return "rejected";
  return "none";
}

// MAP-ONLY 3-state classification. Reverted/rejected are NOT valid map
// submissions → a date with only those resolves to "no-submission".
// Priority: acknowledged → pending → no-submission.
function classifyMapStatus(normalizedStatuses = []) {
  const set = new Set(normalizedStatuses);
  if (set.has("acknowledged")) return "acknowledged";
  if (set.has("pending")) return "pending";
  return "no-submission";
}

module.exports = { normalizeStatus, classifySlfStatus, classifyMapStatus, CLASSIFY_PRIORITY };
