/**
 * The ONE Redis connection for this process.
 *
 * Redis is an optional performance layer here, never a dependency: MongoDB stays
 * the source of truth and every caller degrades to a cache miss when Redis is
 * absent, unreachable, or slow. Three rules keep that promise:
 *
 *  1. OPT-IN. With no REDIS_URL/REDIS_HOST in the environment the module returns
 *     null forever and nothing ever dials out. A dev machine without Redis behaves
 *     exactly as it did before this file existed.
 *  2. NEVER BLOCK. `enableOfflineQueue: false` makes commands fail fast while the
 *     socket is down instead of queueing until they time out — a queued command on
 *     a dead Redis is strictly worse than no cache at all, because it delays the
 *     Mongo query that would have answered the request.
 *  3. NEVER THROW. Connection errors are logged (once per state change, so a flapping
 *     Redis cannot spam the log) and swallowed.
 *
 * Everything reads through utils/serverCache — no route should require this file.
 */
const DEFAULT_CONNECT_TIMEOUT_MS = 3000;

let client = null;
let initialized = false;
let ready = false;
let lastLoggedState = null;

function log(state, message) {
  if (lastLoggedState === state) return;
  lastLoggedState = state;
  // console over utils/logger: logger writes to MongoDB, and a cache-layer
  // notice must never turn into database traffic (or recurse through a cache).
  if (state === "error") console.warn(`[redis] ${message}`);
  else console.log(`[redis] ${message}`);
}

/** Resolve the connection target, or null when Redis is not configured. */
function resolveTarget() {
  const url = (process.env.REDIS_URL || "").trim();
  if (url) return { url };
  const host = (process.env.REDIS_HOST || "").trim();
  if (!host) return null;
  return {
    host,
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
  };
}

function buildOptions(extra = {}) {
  return {
    lazyConnect: true,
    // Fail fast rather than queueing behind a dead socket — see rule 2 above.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || DEFAULT_CONNECT_TIMEOUT_MS),
    // Back off to 10s so a Redis outage costs one reconnect attempt every 10
    // seconds instead of a hot retry loop for the life of the outage.
    retryStrategy: (times) => Math.min(times * 500, 10000),
    keyPrefix: process.env.REDIS_KEY_PREFIX || "",
    ...extra,
  };
}

/**
 * The shared client, or null when Redis is not configured for this deployment.
 * Safe to call on every request — construction happens exactly once.
 */
function getClient() {
  if (initialized) return client;
  initialized = true;

  const target = resolveTarget();
  if (!target) {
    log("disabled", "not configured (no REDIS_URL/REDIS_HOST) — caching stays in-process");
    return null;
  }

  try {
    const Redis = require("ioredis");
    client = target.url ? new Redis(target.url, buildOptions()) : new Redis(buildOptions(target));
  } catch (err) {
    log("error", `client could not be created: ${err.message} — caching stays in-process`);
    client = null;
    return null;
  }

  client.on("ready", () => { ready = true; log("ready", "connected"); });
  client.on("end", () => { ready = false; log("end", "disconnected — falling back to in-process cache"); });
  client.on("error", (err) => {
    ready = false;
    log("error", `unavailable (${err.message}) — falling back to in-process cache`);
  });

  // lazyConnect means nothing dials until we ask. Kick it off without awaiting so
  // server boot is never gated on Redis being up.
  client.connect().catch(() => { /* the 'error' handler already logged it */ });

  return client;
}

/** True when Redis is configured AND the socket is currently usable. */
function isReady() {
  const c = getClient();
  return Boolean(c && ready && c.status === "ready");
}

/** True when this deployment is configured to use Redis at all. */
function isEnabled() {
  return resolveTarget() !== null;
}

/** Close the connection on shutdown. Never throws. */
async function close() {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    try { client.disconnect(); } catch { /* already gone */ }
  }
  ready = false;
}

module.exports = { getClient, isReady, isEnabled, close };
