/**
 * Admin revert → portal visibility.
 *
 * The bug this pins: an admin reverted a submission, the database held the correct
 * reverted state, the portal user got the notification and the email telling them
 * to correct and resubmit — and the row never appeared in their Submission History.
 *
 * GET /portal-auth/my-submissions filters on `hiddenFromPortal: { $ne: true }`.
 * A portal user can remove one of their own submissions from their history
 * (PATCH /portal-auth/my-submissions/:id/hide), which sets that flag. No revert
 * path cleared it, so once a submission had been hidden it stayed filtered out of
 * the API response forever — including after an admin handed it back. The
 * unresolved-revert rule (assertNoNewSubmissionWhileReverted) then blocked the
 * user's next submission over a record they could not see or reach.
 *
 * This is a QUERY-level exclusion: no amount of front-end refreshing can surface a
 * row the API does not return, which is why the fix is on the write paths.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const portalAuthSource = fs.readFileSync(path.join(__dirname, "..", "routes", "portalAuth.js"), "utf8");

/** The block of code following each `status = "reverted"` assignment. */
const revertBlocks = () => {
  const blocks = [];
  const re = /entry\.status = "reverted";/g;
  let match;
  while ((match = re.exec(source))) {
    // The handful of lines that make up the rest of that revert's mutation, up to
    // and including its save() — long enough to contain the flag reset.
    blocks.push(source.slice(match.index, match.index + 1200));
  }
  return blocks;
};

/** Source of one route handler, bounded at the next `router.` declaration. */
const routeBlock = (src, needle) => {
  const start = src.indexOf(needle);
  assert.ok(start > -1, `${needle} route should exist`);
  const next = src.indexOf("\nrouter.", start + needle.length);
  return src.slice(start, next === -1 ? src.length : next);
};

test("the portal history read hands back a reverted row even when it was hidden", () => {
  // The read is the LAST word on visibility: clearing hiddenFromPortal on every
  // revert path (the tests below) is undone the moment the user hides the row
  // again, so the guarantee has to live here too — where nothing later can
  // override it. SLF-LGU-NE-0111 is the record that proved the write-side fix
  // alone was not enough.
  const block = routeBlock(portalAuthSource, 'router.get("/my-submissions"');
  assert.match(
    block,
    /\$or: \[\{ hiddenFromPortal: \{ \$ne: true \} \}, \{ status: "reverted" \}\]/,
    "GET /my-submissions must list a reverted submission regardless of hiddenFromPortal",
  );
});

test("the portal hide action refuses a reverted row, so read and write agree", () => {
  const block = routeBlock(portalAuthSource, 'router.patch("/my-submissions/:id/hide"');
  // The flag is still what hiding sets — that mechanism has not changed.
  assert.match(
    block,
    /submission\.hiddenFromPortal = true/,
    "the portal-side hide action should still be what sets the flag",
  );
  // …but a reverted row cannot be hidden in the first place. Without this the
  // read above would silently override a choice the user was still offered.
  assert.match(
    block,
    /status \|\| ""\) === "reverted"[\s\S]{0,400}res\.status\(400\)/,
    "hiding a reverted submission must be refused, not silently ignored by the read",
  );
  // The refusal has to come BEFORE the write, or the flag is set anyway.
  assert.ok(
    block.indexOf('=== "reverted"') < block.indexOf("submission.hiddenFromPortal = true"),
    "the reverted check must guard the write, not follow it",
  );
});

test("every admin revert path un-hides the record it hands back to the portal user", () => {
  const blocks = revertBlocks();
  assert.ok(blocks.length >= 3, `expected the known revert paths, found ${blocks.length}`);
  blocks.forEach((block, i) => {
    assert.match(
      block,
      /hiddenFromPortal = false/,
      `revert path #${i + 1} sets status "reverted" without clearing hiddenFromPortal — ` +
        "a user who had hidden this submission will never see it come back",
    );
  });
});

test("approve-revert hands the entry back for editing and also un-hides it", () => {
  const block = source.slice(source.indexOf('router.patch("/:id/approve-revert"'));
  assert.ok(block.length > 0, "approve-revert route should exist");
  assert.match(block.slice(0, 1200), /entry\.status = "pending"/);
  assert.match(
    block.slice(0, 1200),
    /hiddenFromPortal = false/,
    "approve-revert returns the entry to the portal user, so it must be visible to them",
  );
});

test("every revert path tells the portal to refresh, not just the admin", () => {
  // A bell notification alone is not enough: a tab that missed the notification
  // stream only recovers on the 60s poll, and the admin list stays stale.
  const routes = [
    ['router.patch("/:id/admin-revert"', "admin-revert"],
    ['router.patch("/bulk-revert"', "bulk-revert"],
    ['router.patch("/:id/approve-edit"', "approve-edit"],
    ['router.patch("/:id/approve-revert"', "approve-revert"],
  ];
  for (const [needle, label] of routes) {
    const start = source.indexOf(needle);
    assert.ok(start > -1, `${label} route should exist`);
    // Bound the slice at the next route declaration so one route cannot borrow
    // the next one's emit and pass.
    const next = source.indexOf("\nrouter.", start + needle.length);
    const block = source.slice(start, next === -1 ? source.length : next);
    assert.match(
      block,
      /refreshPortal\(req, entry\.submittedBy, "submissions"\)/,
      `${label} must emit the portal data-refresh`,
    );
  }
});

test("un-hiding is scoped to revert and does not disturb other visibility rules", () => {
  // Guard against the lazy fix: deletedAt is a different concept (an admin
  // deletion) and a revert must never resurrect a deleted record.
  const blocks = revertBlocks();
  blocks.forEach((block, i) => {
    assert.doesNotMatch(
      block,
      /deletedAt = (null|undefined)/,
      `revert path #${i + 1} must not clear deletedAt`,
    );
  });
});
