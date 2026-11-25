/**
 * Reverted entries must be REACHABLE, and resubmissions must be LABELLED.
 *
 * Live: Prime Waste Solution retried its drafts against an unresolved revert
 * (SLF-LGU-PA-0018) and tried five times to delete the reverted SLF-PVT-PA-0202
 * from its history — every message said "correct and resubmit", none of them
 * opened the entry. Pinned here:
 *   1. every refusal caused by an unresolved revert offers Edit & Resubmit of
 *      the named entry (drafts panel, submit refusal, the dashboard banner);
 *   2. a reverted row offers Resubmit, never Remove (the server refuses it);
 *   3. a GROUP row never carries per-record actions (its _id is synthetic);
 *   4. the history has a Remarks column that labels resubmissions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { portalSource } from "./portalSource.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { groupSubmissions } from "../submissionGrouping.js";
import { isResubmissionRecord } from "../../../utils/resubmission.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", ...p), "utf8");
const columns = read("columns", "historyColumns.jsx");
const drafts = read("DraftsScheduledPanel.jsx");
const dashboard = read("AssignedSlfDashboard.jsx");
const portal = portalSource();

test("a resubmission that kept its ID No. is recognised", () => {
  assert.equal(isResubmissionRecord({ previousIdNos: [] }), false);
  assert.equal(isResubmissionRecord({ resubmittedAt: "2026-10-22T03:00:00Z" }), true);
  assert.equal(isResubmissionRecord({ resubmitCount: 1 }), true);
  assert.equal(isResubmissionRecord({ previousIdNos: ["SLF-PVT-PA-0006"] }), true);
  assert.equal(isResubmissionRecord({ resubmission: { count: 1 } }), true);
});

test("an all-reverted batch becomes a group row that is NOT a record", () => {
  const rows = groupSubmissions([
    { _id: "a", submissionId: "SUB-1", status: "reverted", submittedBy: "x@y.ph", lguCompanyName: "X" },
    { _id: "b", submissionId: "SUB-1", status: "reverted", submittedBy: "x@y.ph", lguCompanyName: "X" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].isGroup, true);
  // The group inherits "reverted" — which is exactly why the actions column
  // must check isGroup first.
  assert.equal(rows[0].status, "reverted");
  assert.match(rows[0]._id, /^sid:/);
});

test("the actions column gives a group row no per-record buttons", () => {
  const actions = columns.slice(columns.indexOf('key: "actions"'));
  assert.ok(actions.indexOf("if (r.isGroup) {") < actions.indexOf("handleEditRevertedRow(r)"));
  assert.ok(actions.indexOf("if (r.isGroup) {") < actions.indexOf("handleHideSubmission(r)"));
});

test("a reverted row offers Resubmit, never Remove", () => {
  assert.match(columns, /\{needsResubmit && \(\s*<Tooltip title="Correct this entry and send it back for review">/);
  assert.match(columns, /\{!needsResubmit && \(\s*<Tooltip title="Remove from my history/);
});

test("the history's Status / Remarks column labels resubmissions", () => {
  // Status and Remarks are ONE column: the tag, then the reason beneath it.
  assert.match(columns, /title: "Status \/ Remarks",/);
  assert.match(columns, /\{renderStatusTag\(v, r\)\}\s*\{remark\}/);
  assert.match(columns, /Resubmission\{resub\.count > 1/);
  assert.match(columns, /Needs correction — Edit &amp; Resubmit/);
});

test("a draft refused for an unresolved revert opens that entry", () => {
  assert.match(drafts, /err\.response\?\.data\?\.code === "UNRESOLVED_REVERT"/);
  assert.match(drafts, /if \(r\.isConfirmed\) onResolveRevert\(blockingRevert\.id\);/);
  assert.match(portal, /onResolveRevert=\{\(id\) => stableEditRevertedRow\(\{ _id: id \}\)\}/);
});

test("the submit refusal opens the blocking entry when the server names it", () => {
  assert.match(portal, /const blockingId = err\.response\?\.data\?\.ruleContext\?\.id;/);
  assert.match(portal, /if \(blockingId\) handleEditRevertedRow\(\{ _id: blockingId \}\);/);
});

test("the dashboard banner sits OUTSIDE the collapsed card body", () => {
  // The card body is maxHeight 0 / overflow hidden; anything inside never renders.
  assert.ok(dashboard.indexOf("</Card>") < dashboard.indexOf("{revertToResolve && onResolveRevert && ("));
  assert.match(portal, /revertToResolve=\{editingRevertedId \? null : unresolvedRevert\}/);
});
