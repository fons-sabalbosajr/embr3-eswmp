// Turn ONE Drafts & Scheduled record into a real submission. Shared by the
// manual "Submit now" route (routes/portalQueue.js) and the scheduled worker
// (utils/scheduledSubmissionWorker.js) so the two can never disagree.
//
// A record that is the correction of a reverted entry (`resubmitOf`) RESUBMITS
// that entry in place — same record, same ID No., back to Pending — exactly as
// Edit & Resubmit in Data Entry does. Every other record files a new submission.
// Before this, both paths always filed a new submission, so a correction saved
// as a draft or scheduled duplicated the volume and left the reverted entry
// reverted (and, after 24 h, blocking every later submission).

/**
 * @returns {Promise<{ submissionId: string, resubmittedIdNo?: string }>}
 * Throws errors carrying `statusCode` for refusals.
 */
async function submitQueueRecord(record, req = null) {
  // Required lazily: routes/dataSLF requires half the app.
  const { submitEntries, resubmitEntry } = require("../routes/dataSLF");
  if (!record?.resubmitOf) {
    return submitEntries({ entries: [record.payload], submittedBy: record.portalUserEmail, req });
  }

  // PUT /data-slf/:id is gated by this portal rule; the queue path must be too,
  // or saving a correction as a draft would route around an admin restriction.
  const UserPortal = require("../models/UserPortal");
  const { can } = require("./portalPolicy");
  const owner = await UserPortal.findOne({ email: String(record.portalUserEmail || "").trim().toLowerCase() })
    .select("portalAccess email")
    .lean();
  if (!owner || !can(owner, "can_edit_submitted_data")) {
    throw Object.assign(
      new Error("Your account is not permitted to resubmit corrected entries. Please contact an administrator."),
      { statusCode: 403, code: "PORTAL_RULE_DENIED" },
    );
  }

  const populated = await resubmitEntry({
    id: record.resubmitOf,
    body: record.payload,
    ownerEmail: record.portalUserEmail,
    // A saved correction must not overwrite a resubmission that already went in.
    requireReverted: true,
    req,
  });
  return { submissionId: populated.submissionId, resubmittedIdNo: populated.idNo };
}

module.exports = { submitQueueRecord };
