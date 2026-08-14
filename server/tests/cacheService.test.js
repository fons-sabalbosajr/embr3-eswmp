/**
 * The cache service and the route middleware, with Redis NOT configured.
 *
 * This is the configuration every developer machine and the current production
 * server run in, so it is the one that must not regress: the app has to behave
 * exactly as it did when utils/serverCache was a plain in-process Map.
 *
 * The Redis-backed path is covered separately in cacheServiceRedis.test.js.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");

// Must be asserted BEFORE requiring the cache: config/redis decides once.
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const serverCache = require("../utils/serverCache");
const { cacheJson, invalidateOnWrite } = require("../middleware/cacheRoute");
const redis = require("../config/redis");

/** Minimal Express-shaped response that records what was sent. */
function fakeRes() {
  const listeners = {};
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    sent: false,
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.sent = true; (listeners.finish || []).forEach((fn) => fn()); return this; },
    on(event, fn) { (listeners[event] ||= []).push(fn); },
    emit(event) { (listeners[event] || []).forEach((fn) => fn()); },
  };
  return res;
}

/** Drive one middleware → handler pair the way Express would. */
async function invoke(middleware, handler, req) {
  const res = fakeRes();
  await new Promise((resolve) => {
    middleware(req, res, () => { Promise.resolve(handler(req, res)).then(resolve, resolve); })
      // The middleware answers from cache without calling next().
      ?.then?.(() => { if (res.sent) resolve(); }, resolve);
    setImmediate(() => { if (res.sent) resolve(); });
  });
  // Give a cache-hit path that resolved via setImmediate a tick to settle.
  await new Promise((r) => setImmediate(r));
  return res;
}

test.beforeEach(() => serverCache._clearLocal());

test("Redis is OFF unless configured — nothing dials out", () => {
  assert.equal(redis.isEnabled(), false);
  assert.equal(redis.isReady(), false);
  assert.equal(redis.getClient(), null);
});

test("get/set round-trips through the in-process tier", async () => {
  assert.equal(await serverCache.get("slf:test:a"), undefined, "cold key must miss");
  await serverCache.set("slf:test:a", { total: 7 }, 60000);
  assert.deepEqual(await serverCache.get("slf:test:a"), { total: 7 });
});

test("an expired entry reports a miss rather than stale data", async () => {
  await serverCache.set("slf:test:ttl", "old", 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(await serverCache.get("slf:test:ttl"), undefined);
});

test("invalidate clears the exact key AND every key sharing the prefix", async () => {
  await serverCache.set("slf:dashboard:stats:default", 1, 60000);
  await serverCache.set("slf:dashboard:stats:dummy", 2, 60000);
  await serverCache.set("slf:dashboard:other", 3, 60000);

  await serverCache.invalidate("slf:dashboard:stats");

  assert.equal(await serverCache.get("slf:dashboard:stats:default"), undefined);
  assert.equal(await serverCache.get("slf:dashboard:stats:dummy"), undefined);
  assert.equal(await serverCache.get("slf:dashboard:other"), 3, "an unrelated key must survive");
});

test("wrap runs the producer ONCE for concurrent callers (stampede guard)", async () => {
  let runs = 0;
  const producer = async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 30));
    return { runs };
  };
  const results = await Promise.all([
    serverCache.wrap("slf:test:wrap", 60000, producer),
    serverCache.wrap("slf:test:wrap", 60000, producer),
    serverCache.wrap("slf:test:wrap", 60000, producer),
  ]);
  assert.equal(runs, 1, "three concurrent callers must trigger one aggregation");
  assert.deepEqual(results, [{ runs: 1 }, { runs: 1 }, { runs: 1 }]);
});

test("wrap does not pin a failure — the next caller retries", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error("mongo blew up");
    return "recovered";
  };
  await assert.rejects(() => serverCache.wrap("slf:test:flaky", 60000, flaky));
  assert.equal(await serverCache.wrap("slf:test:flaky", 60000, flaky), "recovered");
});

test("cacheJson: first request MISSes and runs the handler, second is served from cache", async () => {
  let handlerRuns = 0;
  const middleware = cacheJson(() => "slf:test:route", 60000);
  const handler = async (_req, res) => { handlerRuns += 1; res.json({ count: handlerRuns }); };

  const first = await invoke(middleware, handler, {});
  assert.equal(first.headers["X-Cache"], "MISS");
  assert.deepEqual(first.body, { count: 1 });

  const second = await invoke(middleware, handler, {});
  assert.equal(second.headers["X-Cache"], "HIT");
  assert.deepEqual(second.body, { count: 1 });
  assert.equal(handlerRuns, 1, "the aggregation must not run again on a hit");
});

test("cacheJson does NOT cache a non-2xx response", async () => {
  let handlerRuns = 0;
  const middleware = cacheJson(() => "slf:test:err", 60000);
  const handler = async (_req, res) => { handlerRuns += 1; res.status(500).json({ message: "Server error" }); };

  await invoke(middleware, handler, {});
  const second = await invoke(middleware, handler, {});
  assert.equal(second.headers["X-Cache"], "MISS", "a 500 must not be pinned for the TTL");
  assert.equal(handlerRuns, 2);
});

test("cacheJson keys must separate the variants a route responds differently for", async () => {
  const keyFn = (req) => `slf:test:year:${req.query.year || "all"}`;
  const middleware = cacheJson(keyFn, 60000);
  const handler = async (req, res) => res.json({ year: req.query.year || "all" });

  await invoke(middleware, handler, { query: { year: "2024" } });
  const other = await invoke(middleware, handler, { query: { year: "2025" } });
  assert.deepEqual(other.body, { year: "2025" }, "2025 must never be answered from the 2024 entry");
});

test("cacheJson skips caching entirely when the key function returns null", async () => {
  let handlerRuns = 0;
  const middleware = cacheJson(() => null, 60000);
  const handler = async (_req, res) => { handlerRuns += 1; res.json({ n: handlerRuns }); };
  await invoke(middleware, handler, {});
  await invoke(middleware, handler, {});
  assert.equal(handlerRuns, 2);
});

test("invalidateOnWrite clears AFTER a successful write, and leaves reads alone", async () => {
  await serverCache.set("slf:dashboard:funded-mrf:all", { totalRecords: 1 }, 60000);

  const middleware = invalidateOnWrite("slf:dashboard:funded-mrf");
  const res = fakeRes();
  await new Promise((resolve) => middleware({ method: "POST" }, res, resolve));
  res.statusCode = 201;
  res.json({ ok: true }); // fires "finish", as Express does once the body is written
  await new Promise((r) => setImmediate(r));

  assert.equal(await serverCache.get("slf:dashboard:funded-mrf:all"), undefined);
});

test("invalidateOnWrite does NOT clear when the write failed", async () => {
  await serverCache.set("slf:dashboard:funded-mrf:all", { totalRecords: 1 }, 60000);

  const middleware = invalidateOnWrite("slf:dashboard:funded-mrf");
  const res = fakeRes();
  await new Promise((resolve) => middleware({ method: "PUT" }, res, resolve));
  res.statusCode = 500;
  res.json({ message: "Server error" });
  await new Promise((r) => setImmediate(r));

  assert.deepEqual(
    await serverCache.get("slf:dashboard:funded-mrf:all"),
    { totalRecords: 1 },
    "a failed write must not drop a cache entry that still matches the database",
  );
});

test("invalidateOnWrite ignores GET so a read can never clear the cache", async () => {
  await serverCache.set("slf:dashboard:funded-mrf:all", { totalRecords: 1 }, 60000);
  const middleware = invalidateOnWrite("slf:dashboard:funded-mrf");
  const res = fakeRes();
  await new Promise((resolve) => middleware({ method: "GET" }, res, resolve));
  res.json({ ok: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await serverCache.get("slf:dashboard:funded-mrf:all"), { totalRecords: 1 });
});

test("the refresh targets that mutate SLF data invalidate the right dashboard keys", async () => {
  const keys = require("../utils/cacheKeys");
  const { refreshAdmin } = require("../utils/socketEmit");
  const req = { app: { get: () => null } }; // no socket.io — emit is a no-op

  for (const key of [keys.SUMMARY_BY_SLF_CACHE_KEY, `${keys.STATS_CACHE_PREFIX}:default`, `${keys.CELL_USAGE_CACHE_PREFIX}:default`]) {
    await serverCache.set(key, "stale", 60000);
  }
  await serverCache.set(`${keys.MODULE_STATS.slfFacilities}:all:default`, "stale", 60000);

  refreshAdmin(req, "submissions");
  await new Promise((r) => setImmediate(r));
  assert.equal(await serverCache.get(keys.SUMMARY_BY_SLF_CACHE_KEY), undefined);
  assert.equal(await serverCache.get(`${keys.STATS_CACHE_PREFIX}:default`), undefined);
  assert.equal(await serverCache.get(`${keys.CELL_USAGE_CACHE_PREFIX}:default`), undefined);

  refreshAdmin(req, "facility");
  await new Promise((r) => setImmediate(r));
  assert.equal(await serverCache.get(`${keys.MODULE_STATS.slfFacilities}:all:default`), undefined);
});

test("cache keys are namespaced and carry their parameters", () => {
  const keys = require("../utils/cacheKeys");
  assert.ok(keys.SUMMARY_BY_SLF_CACHE_KEY.startsWith("slf:"));
  assert.ok(Object.values(keys.MODULE_STATS).every((k) => k.startsWith("slf:")));
  assert.equal(keys.yearSeg("2024"), "2024");
  assert.equal(keys.yearSeg(undefined), "all");
  assert.equal(keys.yearSeg("not-a-year"), "all", "a junk year must not produce an ambiguous key");
  assert.notEqual(keys.MODULE_STATS.fundedMrf, keys.MODULE_STATS.lguInitiatedMrf);
});
