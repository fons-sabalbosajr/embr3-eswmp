// Is this submission a RESUBMISSION (a reverted entry corrected and sent back)?
//
// A resubmission keeps its ID No., so `resubmittedAt` / `resubmitCount` mark it;
// `previousIdNos` still covers records resubmitted before those fields existed.
// Mirrors server/utils/resubmission.js — the two must agree, or the admin and the
// portal disagree about which rows are resubmissions.
export const isResubmissionRecord = (r) =>
  Boolean(r?.resubmission) ||
  (Array.isArray(r?.previousIdNos) && r.previousIdNos.length > 0) ||
  Boolean(r?.resubmittedAt) ||
  Number(r?.resubmitCount || 0) > 0;
