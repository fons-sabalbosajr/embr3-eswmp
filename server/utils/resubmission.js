// What makes a DataSLF record a RESUBMISSION, in one place.
//
// A resubmission used to be recognisable by a re-minted ID No. (previousIdNos).
// Since PUT /data-slf/:id keeps the ID, `resubmittedAt` / `resubmitCount` are the
// marker; previousIdNos still counts for records resubmitted before that change.
// Shared by the admin Submissions list (routes/dataSLF.js) and the portal history
// (routes/portalAuth.js) so the two Remarks columns never disagree.

// The fields that carry a resubmission, for list projections.
const RESUBMISSION_FIELDS = "resubmittedAt resubmitCount resubmitComment resubmittedRevertReason";

const isResubmissionEntry = (e) =>
  (Array.isArray(e?.previousIdNos) && e.previousIdNos.length > 0) ||
  Boolean(e?.resubmittedAt) ||
  Number(e?.resubmitCount || 0) > 0;

// Same rule for aggregation pipelines. `$gt: [x, null]` is true for any Date.
const IS_RESUBMISSION_EXPR = {
  $or: [
    { $gt: [{ $size: { $ifNull: ["$previousIdNos", []] } }, 0] },
    { $gt: [{ $ifNull: ["$resubmittedAt", null] }, null] },
    { $gt: [{ $ifNull: ["$resubmitCount", 0] }, 0] },
  ],
};

/**
 * What the Remarks columns show for a resubmission, or null when the record is
 * not one. Kept OUT of the derived `remarks` flags on purpose: those are
 * fingerprinted for VERA's automatic review (veraRemarkSignature), and this is
 * context about the record, not an issue to review.
 */
function resubmissionSummary(entry) {
  if (!isResubmissionEntry(entry)) return null;
  const previous = Array.isArray(entry.previousIdNos) && entry.previousIdNos.length
    ? entry.previousIdNos[entry.previousIdNos.length - 1]
    : null;
  return {
    at: entry.resubmittedAt || (previous ? entry.updatedAt : null) || null,
    count: Math.max(Number(entry.resubmitCount || 0), 1),
    comment: entry.resubmitComment || "",
    revertReason: entry.resubmittedRevertReason || "",
    previousIdNo: previous,
  };
}

module.exports = {
  RESUBMISSION_FIELDS,
  IS_RESUBMISSION_EXPR,
  isResubmissionEntry,
  resubmissionSummary,
};
