/**
 * VERA ticket triage: a REQUEST for admin action goes to an admin, and VERA's
 * automatic reply never takes a ticket out of the admin's "open" queue.
 *
 * Production, 2026-10-30: TKT-00049 "May I kindly request edit access to our
 * Baseline Data System to add newly accredited trucks." VERA classified it
 * "unknown", asked for the page/message/time of an error that never happened,
 * and set the ticket to In Progress, so the admin "open" badge never counted it.
 * It sat for 10 days.
 *
 * Run: node --test tests/veraTicketAdminAction.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { classify, CATEGORY_META } = require("../utils/veraTicketInvestigator");

const noSignals = { errorCount: 0, permissionDenied: 0, validationWarn: 0 };
const ticket = (subject, message = "", category = "General Inquiry") => ({ subject, message, category });

test("requests for admin action are escalated, not answered with generic questions", () => {
  // Real subjects/messages from the support queue.
  const requests = [
    ticket("Needed to edit Baseline Data", "May I kindly request edit access to our Baseline Data System to add newly accredited trucks."),
    ticket("Clarification on Updating the Unit of Measurement for Truck", "May I ask for your assistance in updating the unit of measurement for the volume capacity of our truck hauler?"),
    ticket("Request for Removal of Submitted Record", "", "Data Correction"),
    ticket("Request to Unlock Basic Info Fields for Data Submission", "", "Data Correction"),
    ticket("change username", "", "Account Issue"),
    ticket("Correction of Office Email in the Profile", "", "Account Issue"),
    ticket("Approval of Entries from May 4, 2026 to May 19, 2026", "", "Technical Issue"),
    ticket("To Add Client Entries in Clients for this Vehicle Section", "", "Data Correction"),
  ];
  for (const t of requests) {
    assert.equal(classify(t, noSignals), "admin_action", `"${t.subject}" is a request an admin must act on`);
  }
  assert.equal(CATEGORY_META.admin_action.escalate, true);
  assert.equal(CATEGORY_META.admin_action.status, "escalated");
});

test("problem reports keep their diagnostic categories", () => {
  // These describe something going wrong; VERA's evidence path still handles them.
  assert.equal(classify(ticket("Unable to submit", "The submission fails with a validation message"), noSignals), "validation");
  assert.equal(classify(ticket("Concern Regarding Vehicle Selection in SLF Portal", "how do i select the vehicle"), noSignals), "user_correctable");
  assert.equal(classify(ticket("Unit must be tons error", "It says unit must be tons when I submit"), noSignals), "validation");
  // A real system error still outranks everything, including a request.
  assert.equal(
    classify(ticket("Request to fix", "saving fails with an error"), { ...noSignals, errorCount: 2 }),
    "api_db_failure",
  );
});

test("VERA's automatic reply does not move a ticket out of Open", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "routes", "supportTickets.js"), "utf8");
  const start = src.indexOf("async function runVeraInvestigation");
  const block = src.slice(start, src.indexOf("\nrouter.", start));
  assert.ok(start > -1, "runVeraInvestigation should exist");
  assert.doesNotMatch(
    block,
    /ticket\.status\s*=\s*["']in_progress["']/,
    "a bot reply must leave the ticket Open so the admin queue still counts it",
  );
});
