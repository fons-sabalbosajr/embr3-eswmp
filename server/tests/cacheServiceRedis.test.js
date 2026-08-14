/**
 * The cache service WITH Redis configured, spoken over a real socket to a
 * minimal RESP server (tests/helpers/fakeRedis.js).
 *
 * What this pins:
 *  • values actually reach Redis, with a TTL, and come back after the in-process
 *    tier is dropped — i.e. a second process (or a restarted one) gets the hit;
 *  • prefix invalidation really issues SCAN + UNLINK against the namespace;
 *  • Redis going away mid-flight degrades to a cache MISS and the caller's normal
 *    MongoDB path, instead of throwing or hanging the request.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeRedis } = require("./helpers/fakeRedis");

let fake;
let serverCache;
let redis;

test.before(async () => {
  fake = createFakeRedis();
  const port = await fake.listen();
  // config/redis reads the environment once, on first getClient() — set it before
  // anything requires the cache.
  process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
  delete process.env.REDIS_HOST;

  serverCache = require("../utils/serverCache");
  redis = require("../config/redis");
  redis.getClient();

  // Wait for the socket to report ready rather than sleeping a fixed amount.
  const deadline = Date.now() + 5000;
  while (!redis.isReady() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(redis.isReady(), "the fake Redis should have accepted the connection");
});

test.after(async () => {
  await redis.close();
  await fake.close();
});

test("Redis is reported enabled and ready when configured", () => {
  assert.equal(redis.isEnabled(), true);
  assert.equal(redis.isReady(), true);
});

test("a set really lands in Redis, namespaced and with a TTL", async () => {
  await serverCache.set("slf:dashboard:stats:default", { totalSubmissions: 42 }, 60000);

  const stored = fake.data.get("slf:dashboard:stats:default");
  assert.ok(stored, "the key should exist on the server, not only in memory");
  assert.deepEqual(JSON.parse(stored.value), { totalSubmissions: 42 });
  assert.ok(stored.expiresAt > Date.now(), "the entry must carry an expiry — an immortal cache is a stale cache");
});

test("a value written by one process is readable after the local tier is gone", async () => {
  await serverCache.set("slf:dashboard:summary-by-slf", [{ slfName: "Bataan" }], 60000);
  serverCache._clearLocal(); // stand in for a different process / a restart

  const before = fake.stats.get;
  const value = await serverCache.get("slf:dashboard:summary-by-slf");
  assert.deepEqual(value, [{ slfName: "Bataan" }]);
  assert.ok(fake.stats.get > before, "the value must have come back over the wire, not from memory");
});

test("prefix invalidation removes every variant from Redis", async () => {
  await serverCache.set("slf:dashboard:funded-mrf:all", 1, 60000);
  await serverCache.set("slf:dashboard:funded-mrf:2024", 2, 60000);
  await serverCache.set("slf:dashboard:trash-traps:all", 3, 60000);

  await serverCache.invalidate("slf:dashboard:funded-mrf");
  serverCache._clearLocal();

  assert.equal(await serverCache.get("slf:dashboard:funded-mrf:all"), undefined);
  assert.equal(await serverCache.get("slf:dashboard:funded-mrf:2024"), undefined);
  assert.equal(await serverCache.get("slf:dashboard:trash-traps:all"), 3, "another module's tile must be untouched");
});

test("a large payload with non-ASCII place names round-trips intact", async () => {
  // The real dashboard tiles are 45–80 KB and full of Region 3 names like
  // Peñaranda and Sto. Niño. Both properties matter: the payload spans several
  // TCP chunks, and its byte length exceeds its character length.
  const rows = Array.from({ length: 900 }, (_, i) => ({
    province: "Nueva Ecija", municipality: i % 2 ? "Peñaranda" : "Sto. Niño", count: i,
  }));
  await serverCache.set("slf:dashboard:big", rows, 60000);
  serverCache._clearLocal();

  const back = await serverCache.get("slf:dashboard:big");
  assert.equal(back.length, 900);
  assert.deepEqual(back[1], rows[1]);
  assert.deepEqual(back[899], rows[899], "the tail of a multi-chunk payload must survive");
});

test("a malformed cached payload is a miss, not a crash", async () => {
  fake.data.set("slf:dashboard:broken", { value: "{not json", expiresAt: Date.now() + 60000 });
  serverCache._clearLocal();
  assert.equal(await serverCache.get("slf:dashboard:broken"), undefined);
});

test("the in-process tier is capped short while Redis is enabled", { timeout: 20000 }, async () => {
  // Cross-process invalidation cannot reach another process's memory, so with
  // Redis on, a local copy must not outlive a few seconds even when the caller
  // asked for 10 minutes — otherwise a write on process A would leave process B
  // serving stale tiles for the full TTL.
  await serverCache.set("slf:dashboard:capped", "v1", 600000);
  assert.equal(await serverCache.get("slf:dashboard:capped"), "v1");
  assert.ok(
    fake.data.get("slf:dashboard:capped").expiresAt - Date.now() > 60000,
    "Redis itself should still hold the full requested TTL",
  );

  // Drop it server-side only — the local tier is untouched, exactly as it would
  // be when a DIFFERENT process invalidated the key.
  fake.data.delete("slf:dashboard:capped");

  const deadline = Date.now() + 12000;
  let value = await serverCache.get("slf:dashboard:capped");
  while (value !== undefined && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    value = await serverCache.get("slf:dashboard:capped");
  }
  assert.equal(value, undefined, "the local copy must expire in seconds, not in the 10 minutes requested");
});

test("Redis going down degrades to a MISS — the app keeps serving from MongoDB", async () => {
  await serverCache.set("slf:dashboard:outage", "cached", 60000);
  serverCache._clearLocal();

  await fake.close(); // the socket dies underneath us
  await new Promise((r) => setTimeout(r, 100));

  // The contract: no throw, no hang, just "not cached" — so the route runs its
  // normal query.
  const started = Date.now();
  const value = await serverCache.get("slf:dashboard:outage");
  assert.equal(value, undefined, "an unreachable Redis must read as a cache miss");
  assert.ok(Date.now() - started < 2000, "a dead Redis must not stall the request");

  // Writes and invalidations must stay silent too.
  await serverCache.set("slf:dashboard:outage", "written-during-outage", 60000);
  await serverCache.invalidate("slf:dashboard:outage");

  // …and the in-process tier still works, so the cache degrades rather than dies.
  await serverCache.set("slf:dashboard:local-only", "still-cached", 60000);
  assert.equal(await serverCache.get("slf:dashboard:local-only"), "still-cached");
});
