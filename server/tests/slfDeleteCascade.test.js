/**
 * Deleting an SLF must remove its records from the WHOLE system.
 *
 * The bug this pins: DELETE /slf-facilities/:id soft-deleted the SlfFacility
 * document and nothing else. Every DataSLF record keyed to that facility —
 * submissions, the baseline container, the accredited-hauler/client lists — kept
 * `deletedAt: null`, so a deleted SLF went on feeding the submissions table, the
 * baselines list, the cell-occupancy rollup, the dashboard tiles and every report
 * built from them. Verified in production: Nueva Ecija LGU Guimba was deleted on
 * 2026-08-04 and still had 70 live submissions afterwards.
 *
 * Every admin read filters on `deletedAt: null`, so cascading that one field is
 * what hides the SLF everywhere at once — there is no per-screen exclusion list
 * to keep in sync.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const facilities = read("routes", "slfFacilities.js");
const model = read("models", "DataSLF.js");

const routeBlock = (needle) => {
  const start = facilities.indexOf(needle);
  assert.ok(start > -1, `route not found: ${needle}`);
  const next = facilities.indexOf("\nrouter.", start + needle.length);
  return facilities.slice(start, next === -1 ? facilities.length : next);
};

test("deleting a facility soft-deletes its own data records too", () => {
  const block = routeBlock('router.delete("/:id"');
  assert.match(block, /record\.deletedAt = deletedAt/, "the facility itself is still soft-deleted");
  assert.match(
    block,
    /DataSLF\.updateMany\(\s*\{\s*slfGenerator: record\._id, deletedAt: null \}/,
    "its DataSLF records must be soft-deleted in the same request",
  );
  assert.match(block, /deletedWithFacility: true/, "the cascaded set must be marked");
});

test("the cascade is a soft delete — nothing is destroyed", () => {
  const block = routeBlock('router.delete("/:id"');
  assert.doesNotMatch(block, /deleteMany|deleteOne|findOneAndDelete|remove\(/,
    "a facility delete must never hard-delete records");
});

test("restore puts back exactly what the cascade hid, and no more", () => {
  const block = routeBlock('router.patch("/:id/restore"');
  assert.match(
    block,
    /DataSLF\.updateMany\(\s*\{\s*slfGenerator: record\._id, deletedWithFacility: true \}/,
    "restore must be scoped by the cascade marker, not by facility alone",
  );
  assert.match(block, /deletedAt: null, deletedBy: null, deletedWithFacility: false/);
  // Scoping by the marker is what stops a separately-deleted record coming back.
  assert.doesNotMatch(
    block,
    /updateMany\(\s*\{\s*slfGenerator: record\._id \}/,
    "restore must not clear deletedAt for every record of the facility",
  );
});

test("the cascade marker exists on the model with a default", () => {
  assert.match(model, /deletedWithFacility: \{ type: Boolean, default: false/);
});

test("both sides tell the admin views to re-read", () => {
  for (const needle of ['router.delete("/:id"', 'router.patch("/:id/restore"']) {
    const block = routeBlock(needle);
    assert.match(block, /refreshAdmin\(req, "submissions"\)/, `${needle} should refresh submissions`);
    assert.match(block, /refreshAdmin\(req, "facility"\)/, `${needle} should refresh facility`);
  }
});
