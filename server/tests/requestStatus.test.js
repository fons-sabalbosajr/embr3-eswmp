/**
 * My Requests statuses — each request is matched to ITS answer, labelled the way
 * the admin side labels it.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { annotateRequestStatuses } = require("../utils/requestStatus");

const at = (d) => new Date(`2026-10-${d}T00:00:00Z`);
const statusOf = (rows, ctx) => annotateRequestStatuses(rows, ctx).map((r) => r.requestStatus?.label);

test("an edit request answered by a REVERT reads Reverted, not Pending", () => {
  // Live: Maria Aurora's edit requests were answered with admin-revert, which
  // logs a status_change carrying the reason.
  const req = { _id: "r1", type: "submission_edit_request", dataEntry: "e1", createdAt: at(10) };
  const answers = [{ type: "status_change", dataEntry: "e1", createdAt: at(11), meta: { reason: "fix volume" } }];
  assert.deepEqual(statusOf([req], { answers, revertFlagById: new Map([["e1", false]]) }), ["Reverted"]);
});

test("an acknowledgement is not an answer to an edit request", () => {
  const req = { _id: "r1", type: "submission_edit_request", dataEntry: "e1", createdAt: at(10) };
  const answers = [{ type: "status_change", dataEntry: "e1", createdAt: at(11), meta: { status: "acknowledged" } }];
  assert.deepEqual(statusOf([req], { answers, revertFlagById: new Map([["e1", true]]) }), ["Edit Requested"]);
});

test("one entry's approval does not resolve another entry's request", () => {
  // The old rule matched by COMPANY, so this request read APPROVED.
  const req = { _id: "r1", type: "submission_edit_request", dataEntry: "e1", companyName: "LGU X", createdAt: at(10) };
  const answers = [{ type: "submission_edit_approved", dataEntry: "e2", companyName: "LGU X", createdAt: at(11) }];
  assert.deepEqual(statusOf([req], { answers, revertFlagById: new Map([["e1", true]]) }), ["Edit Requested"]);
});

test("each edit request gets its own answer, in order", () => {
  const r1 = { _id: "r1", type: "submission_edit_request", dataEntry: "e1", createdAt: at(10) };
  const r2 = { _id: "r2", type: "submission_edit_request", dataEntry: "e1", createdAt: at(20) };
  const answers = [
    { type: "submission_edit_rejected", dataEntry: "e1", createdAt: at(12) },
    { type: "submission_edit_approved", dataEntry: "e1", createdAt: at(21) },
  ];
  assert.deepEqual(statusOf([r2, r1], { answers }), ["Edit Approved", "Edit Rejected"]);
});

test("baseline requests: approved, rejected (logged under the request type), locked, pending", () => {
  const req = (d) => ({ _id: `b${d}`, type: "baseline_update_request", companyName: "Limay SLF", createdAt: at(d) });
  const rejectRow = { _id: "x", type: "baseline_update_request", companyName: "Limay SLF", createdAt: at(13), meta: { action: "rejected" } };
  const answers = [
    { type: "baseline_update_approved", companyName: "Limay SLF", createdAt: at(11) },
    rejectRow,
    { type: "baseline_locked", companyName: "Limay SLF", createdAt: at(15) },
  ];
  const rows = [req(10), req(12), rejectRow, req(14), req(16)];
  const out = annotateRequestStatuses(rows, { answers });
  assert.deepEqual(out.map((r) => r.requestStatus.label), [
    "Update Approved", "Update Rejected", "Update Rejected", "Baseline Locked", "Update Requested",
  ]);
  assert.equal(out[2].displayType, "baseline_update_rejected");
});

test("an unanswered baseline request on a facility with nothing open is Closed", () => {
  const req = { _id: "b1", type: "baseline_update_request", companyName: "Iba SLF", createdAt: at(10) };
  assert.deepEqual(statusOf([req], { baselineRequestedByCompany: new Map([["iba slf", false]]) }), ["Closed"]);
  assert.deepEqual(statusOf([req], { baselineRequestedByCompany: new Map([["iba slf", true]]) }), ["Update Requested"]);
});

test("a support ticket shows the ticket's own status", () => {
  const row = { _id: "t", type: "support_ticket", submissionId: "TKT-00048", meta: { ticketNo: "TKT-00048" }, createdAt: at(22) };
  assert.deepEqual(statusOf([row], { ticketStatusByNo: new Map([["TKT-00048", "in_progress"]]) }), ["In Progress"]);
});
