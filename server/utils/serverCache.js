// The single cache service for expensive, read-mostly aggregations.
//
// TWO TIERS, ONE API
//   L1 — an in-process Map. Always present. It is the whole cache when Redis is
//        not configured (exactly the behaviour this file had before Redis), and a
//        short-lived read shield in front of Redis when it is.
//   L2 — Redis, when REDIS_URL/REDIS_HOST is set. Shared across processes and
//        survives a restart, so a deploy no longer costs every admin a cold
//        dashboard.
//
// FRESHNESS. Two guarantees keep this honest, unchanged from the in-process
// original: a bounded TTL (staleness can never exceed it) and explicit
// invalidation wired into the write paths (the common case is instant).
//
// The L1 caveat: an invalidation issued by process A cannot reach process B's L1.
// So whenever Redis is enabled — the only situation in which a second process can
// exist — L1 entries are capped at L1_MAX_WITH_REDIS_MS, bounding cross-process
// staleness to a few seconds while still absorbing request bursts. With Redis off
// the app is single-process and invalidation is instant, so L1 keeps the full TTL.
//
// FAILURE. Redis is a performance layer, never a dependency. Every Redis call is
// wrapped in a timeout and a try/catch; anything that goes wrong degrades to a
// cache miss and the caller queries MongoDB as it always did.
const redis = require("../config/redis");

const REDIS_OP_TIMEOUT_MS = 250;
const L1_MAX_WITH_REDIS_MS = 5000;
const SCAN_COUNT = 200;
const SCAN_MAX_ITERATIONS = 200; // hard stop so a huge keyspace cannot pin the loop

const store = new Map(); // key -> { value, expiresAt }

/** Resolve to `fallback` if the Redis command has not answered in time. */
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => { if (done) return; done = true; clearTimeout(timer); resolve(value); },
      () => { if (done) return; done = true; clearTimeout(timer); resolve(fallback); },
    );
  });
}

/** The live client, or null when Redis is unconfigured or the socket is down. */
function liveClient() {
  try {
    return redis.isReady() ? redis.getClient() : null;
  } catch {
    return null;
  }
}

function l1Ttl(ttlMs) {
  return redis.isEnabled() ? Math.min(ttlMs, L1_MAX_WITH_REDIS_MS) : ttlMs;
}

function l1Get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt && hit.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

function l1Set(key, value, ttlMs) {
  store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
}

/**
 * Read a cached value. Resolves to `undefined` on a miss — including every kind
 * of Redis failure, so the caller's normal MongoDB path runs.
 * @returns {Promise<any|undefined>}
 */
async function get(key) {
  const local = l1Get(key);
  if (local !== undefined) return local;

  const client = liveClient();
  if (!client) return undefined;

  const raw = await withTimeout(client.get(key), REDIS_OP_TIMEOUT_MS, null);
  if (raw === null || raw === undefined) return undefined;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed payload (a truncated write, a key written by an older shape).
    // Drop it and report a miss rather than handing a route unusable data.
    withTimeout(client.del(key), REDIS_OP_TIMEOUT_MS, null).catch(() => {});
    return undefined;
  }
  if (parsed === null || parsed === undefined) return undefined;

  // Re-seat in L1 so a burst of requests hits memory instead of the socket. The
  // remaining Redis TTL is unknown here, so use the short cap — never longer.
  l1Set(key, parsed, L1_MAX_WITH_REDIS_MS);
  return parsed;
}

/**
 * Store a value under `key` for `ttlMs`. Resolves once L1 is written; the Redis
 * write is awaited but its failure is swallowed. Never throws.
 */
async function set(key, value, ttlMs = 60000) {
  if (value === undefined) return;
  l1Set(key, value, l1Ttl(ttlMs));

  const client = liveClient();
  if (!client) return;

  let payload;
  try {
    payload = JSON.stringify(value);
  } catch {
    return; // not serialisable (a cycle) — L1 already holds it, that is enough
  }
  const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));
  await withTimeout(client.set(key, payload, "EX", ttlSeconds), REDIS_OP_TIMEOUT_MS, null);
}

/** Strip the client-level keyPrefix so SCAN results can be fed back to UNLINK. */
function unprefixed(client, key) {
  const prefix = client.options?.keyPrefix || "";
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/**
 * Drop one exact key and every key sharing it as a prefix (call with no argument
 * to clear everything). Awaiting is optional — callers on a write path may fire
 * and forget, since a failed invalidation only costs the bounded TTL.
 */
async function invalidate(prefix) {
  if (prefix === undefined) {
    store.clear();
  } else {
    store.delete(prefix);
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  }

  const client = liveClient();
  if (!client) return;

  if (prefix === undefined) {
    // Deliberately NOT flushdb: this Redis may be shared with other apps, and a
    // full flush is not ours to issue. Scan our own namespace instead.
    await deleteByPattern(client, `${require("./cacheKeys").NAMESPACE}*`);
    return;
  }
  await withTimeout(client.del(prefix), REDIS_OP_TIMEOUT_MS, null);
  await deleteByPattern(client, `${prefix}*`);
}

/** SCAN + UNLINK. The only pattern-delete in the codebase; keep it that way. */
async function deleteByPattern(client, pattern) {
  const keyPrefix = client.options?.keyPrefix || "";
  let cursor = "0";
  let iterations = 0;
  do {
    const result = await withTimeout(
      client.scan(cursor, "MATCH", `${keyPrefix}${pattern}`, "COUNT", SCAN_COUNT),
      REDIS_OP_TIMEOUT_MS,
      null,
    );
    if (!result) return; // timeout/failure — the TTL remains the backstop
    const [next, keys] = result;
    cursor = next;
    if (keys.length) {
      const targets = keys.map((k) => unprefixed(client, k));
      await withTimeout(client.unlink(...targets), REDIS_OP_TIMEOUT_MS, null);
    }
    iterations += 1;
  } while (cursor !== "0" && iterations < SCAN_MAX_ITERATIONS);
}

/**
 * Cache-aside with single-flight: on a miss, only the FIRST caller runs
 * `producer`; concurrent callers for the same key await that same run instead of
 * each firing the aggregation. This is the stampede guard — deliberately a plain
 * in-process promise map, not a distributed lock, because the worst case it fails
 * to prevent is N processes doing the work once each on expiry.
 */
const inflight = new Map(); // key -> Promise<value>

async function wrap(key, ttlMs, producer) {
  const cached = await get(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const run = (async () => {
    const value = await producer();
    // Only cache a real result; `undefined` means "nothing to remember".
    if (value !== undefined) await set(key, value, ttlMs);
    return value;
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/** Test/diagnostic hook: forget every L1 entry without touching Redis. */
function _clearLocal() {
  store.clear();
  inflight.clear();
}

module.exports = { get, set, invalidate, wrap, _clearLocal };
