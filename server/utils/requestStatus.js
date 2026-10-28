// ── The status of a portal request, as the ADMIN side would label it ─────────
//
// The portal's My Requests page used to work a status out in the browser from
// whatever rows it had loaded: a request was "resolved" when ANY later
// approval/rejection for the same COMPANY existed. So one approval resolved every
// older request from that facility, and the answers the admin actually gives but
// the page never loaded — reverting an entry in reply to its edit request,
// locking a baseline — left requests on PENDING forever (Maria Aurora: 12 edit
// requests answered by a revert months ago, all still PENDING).
//
// Here each request is matched to ITS answer: an edit request by the entry it
// is about, a baseline request by its facility — the first admin answer on that
// subject after the request. Labels are the admin's own (Submissions
// transaction history, Baseline Data, Support Tickets).

const S = (key, label, color) => ({ key, label, color });

const STATUS = {
  editPending: S("pending", "Edit Requested", "orange"),
  editApproved: S("approved", "Edit Approved", "green"),
  editRejected: S("rejected", "Edit Rejected", "red"),
  editReverted: S("reverted", "Reverted", "volcano"),
  // Answered some way that left no record of its own (a lock before locks were
  // logged, a later save), or superseded by a newer request.
  closed: S("closed", "Closed", "default"),
  baselinePending: S("pending", "Update Requested", "orange"),
  baselineApproved: S("approved", "Update Approved", "green"),
  baselineRejected: S("rejected", "Update Rejected", "red"),
  baselineLocked: S("locked", "Baseline Locked", "purple"),
  ticket: {
    open: S("open", "Open", "red"),
    in_progress: S("in_progress", "In Progress", "gold"),
    resolved: S("resolved", "Resolved", "green"),
    closed: S("closed", "Closed", "default"),
  },
  reply: S("info", "Reply", "cyan"),
};

const time = (v) => new Date(v || 0).getTime();
const companyKey = (v) => String(v || "").trim().toLowerCase();
const isBaselineRejection = (t) =>
  t.type === "baseline_update_rejected" ||
  (t.type === "baseline_update_request" && t.meta?.action === "rejected");
// An admin revert of the entry (PATCH /:id/admin-revert or bulk-revert) logs a
// status_change carrying the revert reason; an acknowledge/reject does not.
const isRevert = (t) => t.type === "revert_approved" || (t.type === "status_change" && Boolean(t.meta?.reason));

/**
 * The answers on the same subject that came after `request`, earliest first.
 *
 * Not bounded by the next request: an admin's answer to an entry or a facility
 * answers EVERY request still open on it — an operator who asked twice before
 * the approval was asked once, as far as the approval is concerned. Requests
 * answered separately still get their own answer, because each takes the first
 * one after itself.
 */
function answersFor(request, answers, sameSubject) {
  const from = time(request.createdAt);
  return answers
    .filter((t) => sameSubject(t) && time(t.createdAt) > from)
    .sort((a, b) => time(a.createdAt) - time(b.createdAt));
}

/**
 * Annotate request rows with `requestStatus` ({ key, label, color }) and, for a
 * baseline rejection logged under the request type, `displayType`.
 *
 * @param {object[]} rows      the My Requests transactions
 * @param {object}   context
 *   answers        — Transaction rows that can answer a request (any submitter)
 *   revertFlagById — Map(entryId → revertRequested) for edit requests' entries
 *   ticketStatusByNo — Map(ticketNo → SupportTicket.status)
 *   baselineRequestedByCompany — Map(lowercased facility name → whether any of
 *                    its records still carries baselineUpdateRequested). Locks
 *                    were never logged before the enum fix, so for older
 *                    requests the live flag is the only trace of an answer.
 */
function annotateRequestStatuses(
  rows = [],
  { answers = [], revertFlagById = new Map(), ticketStatusByNo = new Map(), baselineRequestedByCompany = new Map() } = {},
) {
  return rows.map((row) => {
    let requestStatus = null;
    let displayType;

    if (row.type === "submission_edit_request") {
      const entry = String(row.dataEntry || "");
      const sameEntry = (t) => entry && String(t.dataEntry || "") === entry;
      const answer = answersFor(row, answers, sameEntry).find(
        (t) => t.type === "submission_edit_approved" || t.type === "submission_edit_rejected" || isRevert(t),
      );
      if (answer?.type === "submission_edit_approved") requestStatus = STATUS.editApproved;
      else if (answer?.type === "submission_edit_rejected") requestStatus = STATUS.editRejected;
      else if (answer) requestStatus = STATUS.editReverted;
      // No answer on record: still waiting while the entry carries the flag, or
      // when the entry cannot be read. Otherwise it was closed some other way.
      else requestStatus = revertFlagById.get(entry) === false ? STATUS.closed : STATUS.editPending;
    } else if (row.type === "submission_edit_approved") {
      requestStatus = STATUS.editApproved;
    } else if (row.type === "submission_edit_rejected") {
      requestStatus = STATUS.editRejected;
    } else if (isBaselineRejection(row)) {
      requestStatus = STATUS.baselineRejected;
      displayType = "baseline_update_rejected";
    } else if (row.type === "baseline_update_request") {
      const company = companyKey(row.companyName || row.meta?.slfName);
      const sameFacility = (t) => company && companyKey(t.companyName || t.meta?.slfName) === company;
      const answer = answersFor(row, answers, sameFacility).find(
        (t) => t.type === "baseline_update_approved" || t.type === "baseline_locked" || isBaselineRejection(t),
      );
      if (answer?.type === "baseline_update_approved") requestStatus = STATUS.baselineApproved;
      else if (answer?.type === "baseline_locked") requestStatus = STATUS.baselineLocked;
      else if (answer) requestStatus = STATUS.baselineRejected;
      else requestStatus = baselineRequestedByCompany.get(company) === false ? STATUS.closed : STATUS.baselinePending;
    } else if (row.type === "baseline_update_approved") {
      requestStatus = STATUS.baselineApproved;
    } else if (row.type === "support_ticket") {
      const status = ticketStatusByNo.get(String(row.meta?.ticketNo || row.submissionId || ""));
      requestStatus = STATUS.ticket[status] || STATUS.ticket.open;
    } else if (row.type === "support_ticket_reply") {
      requestStatus = STATUS.reply;
    }

    return requestStatus ? { ...row, requestStatus, ...(displayType ? { displayType } : {}) } : row;
  });
}

// The transaction types that can answer a request, for the loader's query.
const EDIT_ANSWER_TYPES = ["submission_edit_approved", "submission_edit_rejected", "status_change", "revert_approved"];
const BASELINE_ANSWER_TYPES = ["baseline_update_approved", "baseline_update_rejected", "baseline_locked", "baseline_update_request"];

module.exports = {
  annotateRequestStatuses,
  EDIT_ANSWER_TYPES,
  BASELINE_ANSWER_TYPES,
  STATUS,
};
