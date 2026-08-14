/**
 * Route-level cache-aside for expensive READ endpoints, and the write-path hook
 * that invalidates them.
 *
 * Why middleware instead of rewriting each handler: the dashboard's fan-out hits
 * fourteen `/stats` endpoints whose bodies are large, correct, and well-tested
 * aggregations. Wrapping them leaves every line of that logic — and every
 * permission check — untouched; the handler still runs on a miss exactly as it
 * always did, and simply never runs on a hit.
 *
 * ORDER MATTERS. Mount `cacheJson` AFTER the route's auth/permission middleware
 * so an unauthorised caller is rejected before a cached body is ever reachable.
 *
 * MASKING STAYS PER-REQUEST. `demoMaskingMiddleware` wraps `res.json` globally in
 * server.js, before any router runs, so this wrapper sits OUTSIDE it: what gets
 * cached is the raw payload, and the masking wrapper still runs on every response
 * — hits included. A demo session therefore cannot be served an unmasked cached
 * body, and a real session cannot be served a masked one.
 */
const serverCache = require("../utils/serverCache");

// key -> Promise<body|undefined>. Stampede guard: while one request is computing
// a key, later requests for the SAME key wait for it rather than each running the
// aggregation. Plain in-process map, not a distributed lock — the worst case it
// leaves on the table is one recompute per process, which is fine.
const inflight = new Map();

function safeHeader(res, value) {
  if (res.headersSent) return;
  try { res.set("X-Cache", value); } catch { /* header set is diagnostic only */ }
}

/**
 * Cache a GET route's JSON body.
 *
 * @param {(req) => string|null} keyFn  Deterministic key INCLUDING every query
 *   parameter the response varies by. Return null to skip caching this request.
 * @param {number} ttlMs
 */
function cacheJson(keyFn, ttlMs) {
  return async function cacheJsonMiddleware(req, res, next) {
    let key = null;
    try { key = keyFn(req); } catch { key = null; }
    if (!key) return next();

    let cached;
    try {
      cached = await serverCache.get(key);
    } catch {
      cached = undefined; // a broken cache must never fail the request
    }
    if (cached !== undefined) {
      safeHeader(res, "HIT");
      return res.json(cached);
    }

    const pending = inflight.get(key);
    if (pending) {
      const body = await pending; // never rejects — resolves undefined on failure
      if (body !== undefined) {
        safeHeader(res, "COALESCED");
        return res.json(body);
      }
      // The leader failed or was aborted; fall through and compute it ourselves.
    }

    let settle;
    inflight.set(key, new Promise((resolve) => { settle = resolve; }));
    let settled = false;
    const finish = (body) => {
      if (settled) return; // also makes the res "close" handler below a no-op
      settled = true;
      inflight.delete(key);
      settle(body);
    };

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      // Only successful responses are cacheable — a 404/500 must not be pinned
      // for the next TTL.
      if (res.statusCode >= 200 && res.statusCode < 300) {
        serverCache.set(key, body, ttlMs).catch(() => {});
        finish(body);
      } else {
        finish(undefined);
      }
      return originalJson(body);
    };
    // Client disconnect / handler that never answers: release the waiters so they
    // recompute instead of hanging on a promise that will never settle.
    res.on("close", () => finish(undefined));

    safeHeader(res, "MISS");
    return next();
  };
}

/**
 * Invalidate `prefix` after any successful non-GET request on this router.
 *
 * `res.on("finish")` fires once the response has been fully written, which is
 * strictly AFTER the handler awaited its MongoDB write — so the cache is never
 * cleared ahead of a write that then fails and leaves the old data in place.
 * Mounting it router-wide (rather than per handler) means a write route added
 * later is covered by default instead of silently serving stale tiles.
 *
 * @param {...string} prefixes cache key prefixes this router's writes make stale
 */
function invalidateOnWrite(...prefixes) {
  return function invalidateOnWriteMiddleware(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 400) return;
      for (const prefix of prefixes) {
        serverCache.invalidate(prefix).catch(() => {});
      }
    });
    return next();
  };
}

module.exports = { cacheJson, invalidateOnWrite };
