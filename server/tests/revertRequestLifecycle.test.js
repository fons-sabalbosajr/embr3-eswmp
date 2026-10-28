/**
 * Edit/revert request lifecycle — a request must not outlive its answer.
 *
 * request-edit sets `revertRequested`. approve-edit and bulk-revert cleared it,
 * but the single admin-revert and the resubmit PUT did not, so a request that
 * was answered by a revert → resubmit → re-approval stayed set on an approved
 * entry. The portal then showed "Revert Requested" and hid Request Edit for
 * good (12 Maria Aurora entries, live).
 *
 * Also pinned: VERA's readiness check counts a reverted entry only when it has
 * transport entries — same scope as the submit gate.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const codeOnly = (src) =>
  src.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
const routeBlock = (src, start) => {
  const from = src.indexOf(start);
  const to = src.indexOf("\nrouter.", from + start.length);
  return codeOnly(src.slice(from, to === -1 ? undefined : to));
};

const dataSlf = read("routes", "dataSLF.js");

for (const route of [
  'router.patch("/:id/admin-revert"',
  'router.patch("/bulk-revert"',
  'router.patch("/:id/approve-edit"',
  'router.put("/:id"',
]) {
  test(`${route} clears an open edit request`, () => {
    assert.match(routeBlock(dataSlf, route), /revertRequested = false;/);
  });
}

test("readiness ignores a reverted record with no transport entries", () => {
  const src = codeOnly(read("utils", "portalReadiness.js"));
  assert.match(
    src,
    /if \(s\.status !== "reverted"\) return false;\s*if \(!Array\.isArray\(s\.trucks\) \|\| s\.trucks\.length === 0\) return false;/,
  );
});
