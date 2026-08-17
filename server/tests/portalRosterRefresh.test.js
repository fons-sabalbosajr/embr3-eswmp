/**
 * An admin edit to a facility's client roster must reach that facility's portal.
 *
 * THE DEFECT THIS PINS. The chain is four links long and it was broken in two
 * places at once, which is why it failed silently rather than loudly:
 *
 *   1. admin edits a hauler client
 *   2. notifyHaulerClientChange emits refreshPortal(email, "hauler-clients")  ✓
 *   3. staleKeysFor("hauler-clients") → fell through to []                    ✗
 *      …so nothing invalidated the 2-minute waste-received cache the portal's
 *      Clients Served card reads. It only appeared to work because the same
 *      function also calls refreshAdmin("baselines"), which does clear it —
 *      one link relying on a sibling call to do its job.
 *   4. the portal's socket handler listed facility/submissions/baselines and
 *      NOT "hauler-clients"                                                   ✗
 *      …so the event arrived and was dropped on the floor, and the card kept
 *      showing the pre-edit roster until the page was reloaded by hand.
 *
 * Both ends are asserted here because a fix to either one alone still leaves the
 * card stale, and neither end can tell that the other is broken.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const keys = require("../utils/cacheKeys");
const socketEmitSource = fs.readFileSync(path.join(__dirname, "..", "utils", "socketEmit.js"), "utf8");
const dataSlf = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
const portalIndex = fs.readFileSync(
  path.join(__dirname, "..", "..", "front-end", "src", "pages", "SLFPortal", "index.jsx"),
  "utf8",
);

// staleKeysFor is module-private; exercise it through the public emitters with a
// stubbed cache so the REAL table is what gets tested, not a copy of it.
function keysInvalidatedFor(target) {
  const invalidated = [];
  const cachePath = require.resolve("../utils/serverCache");
  const realCache = require("../utils/serverCache");
  const originalInvalidate = realCache.invalidate;
  realCache.invalidate = async (key) => { invalidated.push(key); };
  try {
    delete require.cache[require.resolve("../utils/socketEmit")];
    const emit = require("../utils/socketEmit");
    const req = { app: { get: () => null } }; // no io — only the cache side matters
    emit.refreshPortal(req, "operator@example.com", target);
  } finally {
    realCache.invalidate = originalInvalidate;
    assert.ok(cachePath, "serverCache resolved");
  }
  return invalidated;
}

// ── Link 3: the cache table ─────────────────────────────────────────────────
test("a hauler-clients refresh invalidates the caches the portal cards read", () => {
  const invalidated = keysInvalidatedFor("hauler-clients");

  // The Clients Served card is counted and listed from this summary.
  assert.ok(
    invalidated.includes(keys.WASTE_RECEIVED_PREFIX),
    "the waste-received summary caches the client roster for 2 minutes",
  );
  // The roster also feeds the baselines aggregation and the client rollup.
  assert.ok(invalidated.includes(keys.BASELINES_CACHE_PREFIX));
  assert.ok(invalidated.includes(keys.MODULE_STATS.slfClients));
  assert.notEqual(invalidated.length, 0, "this used to invalidate nothing at all");
});

test("it does not depend on a sibling call to clear its own cache", () => {
  // notifyHaulerClientChange happens to also emit refreshAdmin("baselines"),
  // which clears the same keys. That is what masked the bug. The "hauler-clients"
  // target must stand on its own, so moving or removing the sibling cannot
  // silently reintroduce a stale card.
  const notify = dataSlf.slice(
    dataSlf.indexOf("function notifyHaulerClientChange"),
    dataSlf.indexOf("function notifyHaulerClientChange") + 700,
  );
  assert.match(notify, /refreshPortal\(req, user\.email, "hauler-clients"\)/, "the portal is told");
  // …and the target carries its own invalidation, proven by the test above.
  assert.match(socketEmitSource, /case "hauler-clients":/, "the table has an explicit case");
});

// ── Link 4: the portal listens ──────────────────────────────────────────────
test("the portal acts on a hauler-clients refresh", () => {
  assert.match(
    portalIndex,
    /const ROSTER_TARGETS = \["facility", "submissions", "baselines", "hauler-clients"\];/,
    "the target the admin actually emits must be handled",
  );
  assert.match(portalIndex, /if \(!target \|\| ROSTER_TARGETS\.includes\(target\)\)/);
});

test("the portal refetches the client roster, not just the submissions", () => {
  // Refreshing slfInfo and the submission list left the Clients Served card
  // untouched — its data comes from a separate fetch that nothing re-ran.
  assert.match(portalIndex, /setWasteReceivedRefresh\(\(n\) => n \+ 1\);/, "a refresh is requested");
  assert.match(portalIndex, /const \[wasteReceivedRefresh, setWasteReceivedRefresh\] = useState\(0\);/);
  // The effect that owns the fetch has to react to it.
  assert.match(
    portalIndex,
    /\}, \[activeMenu, activeSlfId, activeSlfName, wasteReceivedRefresh\]\);/,
    "the waste-received effect depends on the counter",
  );
});

test("an admin-driven refresh bypasses the freshness window", () => {
  // The 30s menu cache exists to skip refetching data NOTHING has touched. When
  // an admin has just touched it, honouring that window would serve the stale
  // roster for another 30 seconds.
  const effect = portalIndex.slice(
    portalIndex.indexOf('if (activeMenu === "overview" && activeSlfName)'),
    portalIndex.indexOf('if (activeMenu === "overview" && activeSlfName)') + 1200,
  );
  assert.match(effect, /const invalidated = wasteReceivedRefresh !== lastWasteRefreshRef\.current;/);
  assert.match(effect, /\} else if \(isMenuDataFresh\(key\)\) \{/, "the window applies only when nothing changed");
  // And the client-side cache entry is dropped, or the refetch is handed back
  // exactly the payload it is trying to replace.
  assert.match(effect, /invalidateCache\(`\$\{PORTAL_WASTE_RECEIVED_CACHE_KEY\}/);
});

// ── The other targets still behave ──────────────────────────────────────────
test("the existing refresh targets are unchanged", () => {
  ["submissions", "baselines", "facility"].forEach((target) => {
    const invalidated = keysInvalidatedFor(target);
    assert.ok(
      invalidated.includes(keys.WASTE_RECEIVED_PREFIX),
      `${target} still clears the waste-received cache`,
    );
  });
  // A target with nothing to invalidate still returns nothing.
  assert.deepEqual(keysInvalidatedFor("something-else"), []);
});
