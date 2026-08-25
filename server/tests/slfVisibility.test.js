/**
 * Non-operational SLF visibility.
 *
 * A rule that HIDES data fails silently when it is wrong in either direction:
 * hide too much and records vanish with no error; hide too little and the symptom
 * is data appearing, which looks like normal behaviour. Neither shows up as a
 * failure anywhere. So the parts that decide what is hidden are pinned here.
 *
 * The trap this exists to catch: `find` casts a string to an ObjectId for a typed
 * path, but `aggregate` does not cast at all. A filter built from string ids
 * would hide correctly on every `find` and hide NOTHING on every aggregation —
 * and most of Portal Submissions reads through aggregations, so the rule would
 * look simply broken.
 *
 * Pure — no database. Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  buildSlfVisibilityFilter,
  isNonOperationalStatus,
} = require("../utils/slfVisibility");

test("only a status that reads as non-operational counts", () => {
  for (const status of ["Non-Operational", "non operational", "NON-OPERATIONAL", "Non Op"]) {
    assert.equal(isNonOperationalStatus(status), true, `${status} should count`);
  }
  // The same /non/i rule the rest of the app already applies — deliberately not
  // broadened here, so one facility cannot be non-operational in one module and
  // operational in another.
  for (const status of ["Operational", "OPERATIONAL", "", null, undefined, "Closed"]) {
    assert.equal(isNonOperationalStatus(status), false, `${JSON.stringify(status)} should not count`);
  }
});

test("nothing is hidden when nothing is non-operational", () => {
  assert.equal(buildSlfVisibilityFilter("slfGenerator", []), null);
});

test("records with NO facility reference are never hidden", () => {
  // A legacy record that predates the reference cannot be attributed to a
  // non-operational site, so hiding it would be a guess.
  const id = new mongoose.Types.ObjectId();
  const filter = buildSlfVisibilityFilter("slfGenerator", [id]);
  const branches = filter.$or.map((clause) => JSON.stringify(clause));
  assert.ok(branches.some((b) => b.includes('"$exists":false')), "missing field is kept");
  assert.ok(branches.some((b) => b.includes("null")), "explicit null is kept");
});

test("the filter carries ObjectIds, which is what makes aggregations work", () => {
  const id = new mongoose.Types.ObjectId();
  const filter = buildSlfVisibilityFilter("slfGenerator", [id]);
  const nin = filter.$or.find((clause) => clause.slfGenerator?.$nin)?.slfGenerator.$nin;
  assert.ok(Array.isArray(nin) && nin.length === 1);
  assert.ok(
    nin[0] instanceof mongoose.Types.ObjectId,
    "a string here would match nothing in an $match stage — aggregate does not cast",
  );
});

test("the filter is a top-level $or, which is why callers must compose it with $and", () => {
  // Mongoose MERGES $or arrays, so `.where(filter)` would turn this restriction
  // into an ALTERNATIVE to the caller's own conditions and match almost
  // everything. The plugin uses `.and([filter])`; this pins the shape that makes
  // that necessary, so the reason survives a refactor.
  const filter = buildSlfVisibilityFilter("slfGenerator", [new mongoose.Types.ObjectId()]);
  assert.ok(Array.isArray(filter.$or));
  assert.equal(Object.keys(filter).length, 1);
});

test("the plugin composes with $and, never $where, on both query and aggregate", () => {
  // Read off the source: this is the one property that cannot be observed without
  // a database, and getting it wrong un-hides everything.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "utils", "slfVisibility.js"), "utf8");
  assert.match(src, /this\.and\(\[filter\]\)/);
  assert.doesNotMatch(src, /this\.where\(filter\)/);
  // And the aggregate hook must inject a $match rather than append a stage at the
  // end, where it would filter AFTER grouping.
  assert.match(src, /insertAggregateMatch\(this\.pipeline\(\)/);
  assert.match(src, /pipeline\.splice\(insertIndex, 0, \{ \$match: matchStage \}\)/);
});

test("the settings screen can see through the rule it configures", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "settings.js"), "utf8");
  // Without the bypass, switching the rule on would hide the list of what it is
  // hiding — and there would be no way to review or undo it.
  assert.match(routes, /bypassSlfVisibility\(/);
  assert.match(routes, /includeNonOperationalSlf: true/);
});

test("DataSLF carries the plugin", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const model = fs.readFileSync(path.join(__dirname, "..", "models", "DataSLF.js"), "utf8");
  assert.match(model, /createSlfVisibilityPlugin\(\{ field: "slfGenerator" \}\)/);
});

test("the setting defaults to hiding nothing", () => {
  const AppSettings = require("../models/AppSettings");
  const fresh = new AppSettings({});
  assert.equal(fresh.hideNonOperationalSlfEnabled, false);
  assert.deepEqual([...(fresh.nonOperationalSlfExceptions || [])], []);
});
