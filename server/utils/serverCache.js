// Minimal in-process TTL cache for expensive, read-mostly aggregations.
//
// This is NOT a distributed cache — it lives in the single Node process this app
// runs behind nginx, so a value set by one request is served to all clients until
// it expires or is explicitly invalidated on a write. Safe here precisely because
// the app is single-process; do not rely on it for cross-instance consistency.
//
// Two guarantees keep it honest: a bounded TTL (staleness can never exceed it) and
// explicit invalidation wired into the write paths (the common case is instant).

const store = new Map(); // key -> { value, expiresAt }

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt && hit.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

function set(key, value, ttlMs = 60000) {
  store.set(key, { value, expiresAt: ttlMs ? Date.now() + ttlMs : 0 });
}

// Drop one exact key, or every key sharing a prefix when `prefix` ends the intent
// (call with no argument to clear everything).
function invalidate(prefix) {
  if (prefix === undefined) {
    store.clear();
    return;
  }
  if (store.has(prefix)) store.delete(prefix);
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { get, set, invalidate };
