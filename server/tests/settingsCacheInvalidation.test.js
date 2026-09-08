/**
 * An App Settings save must invalidate the reads it changes the answer of.
 *
 * The bug this pins: `staleKeysFor("settings")` fell through to `default: []`, so
 * `PUT /settings/app` — which already cleared the in-process year/SLF visibility
 * caches — invalidated no cached RESPONSE at all. Three stored settings change
 * what the same records answer without touching one of them:
 *
 *   • excludePreBaselineDisposalFromCellFill — decides which disposals count
 *     toward cell fill, i.e. the whole of GET /cell-occupancy;
 *   • the year-visibility filter and the non-operational-SLF rule — these change
 *     which RECORDS every SLF read can see at all;
 *   • the truck-capacity allowance — the "Exceeded truck capacity" admin remark.
 *
 * So an admin could toggle a rule and watch every figure keep the pre-change
 * value until each cache's TTL happened to lapse. That silence is also what made
 * the cell-occupancy TTL unsafe to lengthen: without this, a longer TTL would
 * have stretched the staleness from one minute to ten.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const keys = require("../utils/cacheKeys");

const settingsSource = fs.readFileSync(path.join(__dirname, "..", "routes", "settings.js"), "utf8");

// staleKeysFor is module-private; exercise it through the public emitter with a
// stubbed cache so the REAL table is what gets tested, not a copy of it.
function keysInvalidatedFor(target) {
  const invalidated = [];
  const realCache = require("../utils/serverCache");
  const originalInvalidate = realCache.invalidate;
  realCache.invalidate = async (key) => { invalidated.push(key); };
  try {
    delete require.cache[require.resolve("../utils/socketEmit")];
    const emit = require("../utils/socketEmit");
    emit.refreshAdmin({ app: { get: () => null } }, target);
  } finally {
    realCache.invalidate = originalInvalidate;
  }
  return invalidated;
}

test("a settings save invalidates the SLF reads whose answer it changes", () => {
  const invalidated = keysInvalidatedFor("settings");

  assert.notEqual(invalidated.length, 0, "this used to invalidate nothing at all");
  // The pre-baseline rule is read on every occupancy computation.
  assert.ok(
    invalidated.includes(keys.CELL_PLACEMENT_PREFIX),
    "cell occupancy is computed under excludePreBaselineDisposalFromCellFill",
  );
  // Year visibility and the non-operational-SLF rule change which records these see.
  assert.ok(invalidated.includes(keys.BASELINES_CACHE_PREFIX));
  assert.ok(invalidated.includes(keys.ADMIN_SUBMISSIONS_PREFIX));
  assert.ok(invalidated.includes(keys.WASTE_RECEIVED_PREFIX));
  // Year visibility is global, so every module's dashboard tiles move with it.
  assert.ok(
    invalidated.includes(keys.DASHBOARD_PREFIX),
    "the dashboard prefix sweeps every module's tiles in one call",
  );
});

test("PUT /settings/app emits the target that carries that invalidation", () => {
  // Clearing the in-process plugin caches is only half of it — the cached
  // responses BUILT from them are the half that was missed.
  const route = settingsSource.slice(
    settingsSource.indexOf('router.put("/app", authMiddleware, adminOnly'),
    settingsSource.indexOf('router.put("/slf-masking"'),
  );
  assert.match(route, /clearYearVisibilityCache\(\)/);
  assert.match(route, /clearSlfVisibilityCache\(\)/);
  assert.match(route, /refreshAdmin\(req, "settings"\)/, "the emit is what reaches staleKeysFor");
});

test("the cell-occupancy TTL rests on that invalidation, not on being short", () => {
  const dataSlf = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  assert.match(
    dataSlf,
    /const CELL_OCCUPANCY_TTL_MS = 10 \* 60 \* 1000;/,
    "the TTL is a named backstop, not an inline number",
  );
  assert.match(
    dataSlf,
    /router\.get\("\/cell-occupancy", cacheJson\(cellOccupancyAllKey, CELL_OCCUPANCY_TTL_MS\)/,
  );
});
