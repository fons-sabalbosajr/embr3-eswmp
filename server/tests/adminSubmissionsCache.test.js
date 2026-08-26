/**
 * Admin → Portal Submissions cache, and the BASELINE LOCK.
 *
 * The submissions list is a grouped aggregation re-run in full on every page
 * change, filter, search and poll — 0.9–2.8s for a 14KB page, so the cost is the
 * aggregation, not the payload. It is cached; what these tests pin is that the
 * cache cannot answer a request the handler would have answered differently.
 *
 * The one that matters most: an admin asking for dummy records must still get a
 * 403. An early version of the key resolved that request to the "default" scope,
 * which collided with the ordinary page-1 entry and served it a 200 — a cache
 * that bypassed an access-control check. That is what `askedForDummy` guards.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const serverCache = require("../utils/serverCache");
const cacheKeys = require("../utils/cacheKeys");
const { refreshAdmin } = require("../utils/socketEmit");

const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");

/** The route's key function, exercised through the real module boundary. */
const keyFnSource = source.slice(
  source.indexOf("const adminSubmissionsCacheKey"),
  source.indexOf("router.get(\"/\", optionalAuth"),
);

// ── Cache key correctness ───────────────────────────────────────────────────

test("only the light list view is cached — export and row-expand are not", () => {
  assert.match(keyFnSource, /if \(q\.mode !== "list"\) return null/);
  assert.match(keyFnSource, /if \(String\(q\.all\) === "true"\) return null/, "the export returns the whole result set");
  assert.match(keyFnSource, /if \(String\(q\.includeTrucks\) === "true"\) return null/, "row-expand ships trucks[]");
});

test("the key carries EVERY parameter that changes the result", () => {
  for (const param of [
    "grouped", "page", "limit", "status", "cellPlacement",
    "assignment", "excludeStatuses", "slfGenerator", "withTruckVolume", "cellUsage",
  ]) {
    assert.match(keyFnSource, new RegExp(`q\\.${param}`), `${param} must be in the cache key`);
  }
  assert.match(keyFnSource, /q\.search/);
});

test("the key uses the RESOLVED dummy scope, never the raw parameter", () => {
  assert.match(
    keyFnSource,
    /devWantsDummyOnly\(req\) \? "dummyOnly" : devWantsDummy\(req\) \? "dummy" : "default"/,
    "keying on ?includeDummy would let a non-developer share a developer's entry",
  );
});

test("an UNAUTHORIZED dummy request is never cached, so its 403 still happens", () => {
  assert.match(keyFnSource, /askedForDummy && !canManageTestData\(req\)/);
  assert.match(keyFnSource, /return null/);
  // And the handler it must reach still performs the rejection + audit.
  assert.match(source, /if \(rejectUnauthorizedDummyAccess\(req, res\)\) return;/);
});

test("free-text search is hashed, not concatenated into the key", () => {
  assert.match(keyFnSource, /createHash\("sha1"\)/, "a long query must not become a long Redis key");
  assert.match(keyFnSource, /\.slice\(0, 10\)/);
});

test("distinct pages, filters and scopes produce distinct keys", () => {
  // Rebuilt here from the same rules, to assert they cannot collide.
  const build = (o) => [
    o.scope || "default",
    o.grouped === false ? "flat" : "grouped",
    `p${o.page || 1}`,
    `l${o.limit || 10}`,
    o.status || "-",
  ].join(":");
  const keys = new Set([
    build({ page: 1 }), build({ page: 2 }),
    build({ page: 1, limit: 25 }),
    build({ page: 1, status: "pending" }),
    build({ page: 1, scope: "dummy" }),
    build({ page: 1, scope: "dummyOnly" }),
    build({ page: 1, grouped: false }),
  ]);
  assert.equal(keys.size, 7, "every distinct logical query needs its own entry");
});

// ── Invalidation ────────────────────────────────────────────────────────────

test("a submission write clears the table AND the tiles beside it", async () => {
  serverCache._clearLocal();
  const entries = [
    `${cacheKeys.ADMIN_SUBMISSIONS_PREFIX}:default:grouped:p1:l10:-:-:-:-:-:-:-:-`,
    cacheKeys.ADMIN_ANALYTICS_KEY,
    cacheKeys.ADMIN_SUMMARY_DASHBOARD_KEY,
  ];
  for (const key of entries) await serverCache.set(key, "pre-write", 60000);

  refreshAdmin({ app: { get: () => null } }, "submissions");
  await new Promise((r) => setImmediate(r));

  for (const key of entries) {
    assert.equal(await serverCache.get(key), undefined, `${key} must not survive a submission write`);
  }
});

test("every page of the list is cleared, not only the one that changed", async () => {
  serverCache._clearLocal();
  for (const page of [1, 2, 3]) {
    await serverCache.set(`${cacheKeys.ADMIN_SUBMISSIONS_PREFIX}:default:grouped:p${page}:l10`, page, 60000);
  }
  refreshAdmin({ app: { get: () => null } }, "submissions");
  await new Promise((r) => setImmediate(r));
  for (const page of [1, 2, 3]) {
    assert.equal(await serverCache.get(`${cacheKeys.ADMIN_SUBMISSIONS_PREFIX}:default:grouped:p${page}:l10`), undefined);
  }
});

test("an unrelated refresh target leaves the submissions cache alone", async () => {
  serverCache._clearLocal();
  const key = `${cacheKeys.ADMIN_SUBMISSIONS_PREFIX}:default:grouped:p1:l10`;
  await serverCache.set(key, "kept", 60000);
  refreshAdmin({ app: { get: () => null } }, "hauler-requests");
  await new Promise((r) => setImmediate(r));
  assert.equal(await serverCache.get(key), "kept");
});

// ── Baseline lock ───────────────────────────────────────────────────────────

const baselineRead = source.slice(
  source.indexOf('router.get("/baseline/:slfName"'),
  source.indexOf('router.get("/baselines"'),
);
const saveRoute = source.slice(
  source.indexOf('router.patch("/portal-save-baseline/:slfName"'),
  source.indexOf("module.exports"),
);

test("the lock is read from the CONTAINER when one exists, not OR'd across submissions", () => {
  assert.match(
    baselineRead,
    /const containerCandidates = matchedCandidates\.filter\(\(item\) => isBaselineOnlyRecord\(item\)\)/,
  );
  assert.match(
    baselineRead,
    /const flagSource = containerCandidates\.length \? containerCandidates : matchedCandidates/,
    "a legacy SLF with no container must keep the old across-all-records behaviour",
  );
  assert.match(baselineRead, /const anyFlag = \(field\) => flagSource\.some/);
});

test("the save REFUSES to write a locked baseline", () => {
  assert.match(saveRoute, /baseline\.locked_save_rejected/, "the attempt must be audited");
  assert.match(saveRoute, /res\.status\(409\)/);
  assert.match(saveRoute, /locked: true/);
  assert.match(
    saveRoute,
    /if \(req\.user\?\.role === "portal_user"\) \{/,
    "enforcement applies to portal callers; admins own the approve/lock endpoints",
  );
});

test("the lock is enforced for a container-less SLF too", () => {
  // The check used to be gated on `baselineOnlyIds.length`, which is EMPTY for a
  // legacy SLF whose baseline only ever lived on its submissions — eleven of the
  // seventeen live facilities. So the endpoint the guard exists to protect was
  // unguarded for exactly the SLFs most likely to reach it, and a locked baseline
  // could be overwritten by calling it directly.
  //
  // Scope now mirrors the READ (see the flagSource test above): container(s) when
  // the SLF has any, otherwise every record carrying baseline data. The two sides
  // therefore agree on "is this locked" by construction.
  assert.match(
    saveRoute,
    /const lockScopeIds = baselineOnlyIds\.length\s*\?\s*baselineOnlyIds\s*:\s*await resolveSlfRecordIds\(/,
    "no container → fall back to the SLF's baseline-carrying records",
  );
  assert.match(
    saveRoute,
    /requireBaselineData: true/,
    "an SLF with no baseline at all must resolve to an empty scope",
  );
  assert.match(
    saveRoute,
    /if \(lockScopeIds\.length && approvedCount === 0\)/,
    "an empty scope is a genuine first save, not a locked one",
  );
});

test("the baseline WRITE target excludes trashed containers, matching the read", () => {
  // The read filters `deletedAt: null` everywhere; the write did not, so a
  // container that had been moved to the trash kept absorbing baseline saves that
  // no read could ever return — the operator's Total Volume Accepted went to the
  // database and came back as the previous value. Six live facilities were in
  // that state. These two must never diverge again.
  const finder = source.slice(
    source.indexOf("async function findMatchingBaselineOnlyIds("),
    source.indexOf("async function ensurePortalAccountCanSubmit("),
  );
  assert.ok(finder.length > 0, "findMatchingBaselineOnlyIds should exist");
  assert.match(
    finder,
    /const baseFilter = \{\s*deletedAt: null,/,
    "the write target must exclude soft-deleted containers",
  );
  assert.match(
    baselineRead,
    /\{ deletedAt: null \}/,
    "the read this is aligned with filters soft-deleted records out",
  );
});

test("a NEW container never starts life without the stored Total Volume Accepted", () => {
  // The partial-update guard expresses "this edit did not provide a value" by
  // dropping the field, which preserves what is stored. On the CREATE branch
  // there is nothing to preserve, and a container is authoritative the moment it
  // exists — so an absent value there reads as "the operator has none" rather
  // than "look at the siblings". Carry the resolved value forward instead.
  assert.match(saveRoute, /if \(!\("totalVolumeAccepted" in updateFields\)\) \{/);
  assert.match(saveRoute, /baseline\.total_volume\.carried_forward/, "the carry-forward must be audited");
  assert.match(
    saveRoute,
    /const storedTotalVolume = await DataSLF\.findOne\(\{[\s\S]{0,200}deletedAt: null/,
    "seeded from LIVE records only — a trashed container is not resurrected",
  );
});

test("the lock check runs BEFORE any baseline field is written", () => {
  const check = saveRoute.indexOf("baseline.locked_save_rejected");
  const write = saveRoute.indexOf("const updateFields = {");
  assert.ok(check > -1 && write > -1 && check < write, "a rejected save must not have touched the record");
});

test("the response reports the lock state READ BACK from the database", () => {
  assert.match(saveRoute, /const persistedApproval = await DataSLF\.countDocuments\(/);
  assert.match(saveRoute, /locked: Boolean\(latest\) && persistedApproval === 0/);
  assert.doesNotMatch(
    saveRoute,
    /message: "Baseline saved and locked", data: latest \|\| null \}\)/,
    "the old response asserted a lock it never verified",
  );
});

test("the lock rule matches the Admin's mechanism — one flag, in MongoDB", () => {
  // Admin approve/lock/reject all drive the same persisted field. No second
  // locking mechanism (and no Redis lock) may be introduced alongside it.
  assert.match(source, /router\.patch\("\/baseline-update-approve\/:slfName"/);
  assert.match(source, /router\.patch\("\/baseline-update-lock\/:slfName"/);
  assert.match(source, /\$set: \{ baselineUpdateApproved: false \}/, "admin re-lock");
  assert.doesNotMatch(source, /redlock|acquireLock|SETNX|setnx/i, "no distributed lock was introduced");
});

test("saving a baseline invalidates the caches a portal operator would re-read", async () => {
  serverCache._clearLocal();
  const keys = [
    `${cacheKeys.WASTE_RECEIVED_PREFIX}:abc:Santa Rosa:all`,
    `${cacheKeys.ADMIN_SUBMISSIONS_PREFIX}:default:grouped:p1:l10`,
    cacheKeys.SUMMARY_BY_SLF_CACHE_KEY,
  ];
  for (const key of keys) await serverCache.set(key, "pre-save", 60000);
  refreshAdmin({ app: { get: () => null } }, "baselines");
  await new Promise((r) => setImmediate(r));
  for (const key of keys) assert.equal(await serverCache.get(key), undefined);
});
