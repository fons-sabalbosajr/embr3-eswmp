/**
 * Baseline write ownership.
 *
 * The portal's baseline save — the route a BULK hauler/client upload ultimately
 * writes through — takes its target facility from the request body. Without an
 * ownership check, a crafted call or an upload aimed at the wrong SLF could
 * overwrite another operator's Total Volume Accepted, cell entries and accredited
 * haulers. `submitEntries` has always enforced this for disposal submissions;
 * this pins the same rule on the baseline route.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const routeBody = (start, end) => {
  const from = source.indexOf(start);
  assert.ok(from > -1, `not found: ${start}`);
  const to = source.indexOf(end, from);
  assert.ok(to > from, `end not found after ${start}`);
  return source.slice(from, to);
};

const baselineSave = routeBody(
  'router.patch("/portal-save-baseline/:slfName"',
  'router.post("/baseline-update-request"',
);

test("the baseline save refuses a facility the account is not assigned to", () => {
  assert.match(baselineSave, /portalAccount\?\.assignedSlf/, "it must consult the account's assignments");
  assert.match(baselineSave, /assignedIds\.includes\(String\(genId\)\)/, "…and compare them to the TARGET facility");
  assert.match(baselineSave, /res\.status\(403\)/, "a mismatch is refused, not silently allowed");
});

test("the refusal is audited", () => {
  assert.match(baselineSave, /baseline\.ownership_rejected/);
});

test("ownership is derived from the guard's own lookup, not re-queried", () => {
  assert.match(baselineSave, /const portalAccount = await ensurePortalAccountCanSubmit\(submittedBy\)/);
});

test("the guard loads assignedSlf so the check has something to compare", () => {
  const guard = routeBody("async function ensurePortalAccountCanSubmit", "async function submitEntries");
  assert.match(guard, /assignedSlf/);
});

test("WHO is saving comes from the token, not from the request body", () => {
  // Ownership answers "which facility"; this answers "which user". Both must come
  // from the token, or a portal user could write baseline data as somebody else
  // and inherit THAT account's facility assignments.
  assert.match(baselineSave, /submittedBy: claimedSubmittedBy/, "the body value must be quarantined under its own name");
  assert.match(baselineSave, /req\.user\?\.role === "portal_user"/, "the override applies to portal callers");
  assert.match(baselineSave, /UserPortal\.findById\(req\.user\.id\)/, "identity is read from the token's account");
  assert.match(baselineSave, /submittedBy = tokenEmail/, "…and it replaces the claimed value");
});

test("a mismatched claim is audited", () => {
  assert.match(baselineSave, /baseline\.identity_rejected/);
});

test("admin and developer callers keep acting on a portal user's behalf", () => {
  // The override is scoped to portal_user. If it applied to everyone, admin
  // tooling that saves for an operator would start writing as the admin.
  const override = baselineSave.slice(
    baselineSave.indexOf("let submittedBy = claimedSubmittedBy"),
    baselineSave.indexOf("const portalAccount"),
  );
  assert.ok(override.includes('req.user?.role === "portal_user"'));
  assert.ok(!/role === "admin"/.test(override), "no admin branch — admins fall through untouched");
});

test("the submit path keeps its equivalent check — the two must not diverge", () => {
  const submit = routeBody("async function submitEntries", '// Submit SLF data — batch (client portal)');
  assert.match(submit, /assignedIds\.includes\(String\(genId\)\)/);
  assert.match(submit, /submit\.ownership_rejected/);
});
