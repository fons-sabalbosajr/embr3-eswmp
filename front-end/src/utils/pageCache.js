/**
 * pageCache — Encrypted stale-while-revalidate cache for admin pages.
 *
 * All storage goes through secureStorage which uses AES-256 encryption
 * (via CryptoJS) with obfuscated storage keys, so cached data is never
 * readable in plaintext from browser DevTools or storage inspection.
 *
 * Stale-while-revalidate (SWR) strategy:
 *  • If the cached entry is fresh  → serve it immediately, skip the network.
 *  • If the cached entry is stale  → serve it immediately (no blank screen),
 *    then silently refresh in the background.
 *  • If no cache at all            → call onStart, fetch, call onEnd.
 *
 * Usage example:
 *
 *   import { fetchWithCache, invalidateCache } from "../utils/pageCache";
 *
 *   const load = useCallback(async (force = false) => {
 *     await fetchWithCache(CACHE_KEY, () => api.get("/my-data").then(r => r.data), {
 *       ttl: CACHE_TTL,
 *       force,
 *       onData:  (data) => setRecords(data.map(r => ({ ...r, ...computeFields(r) }))),
 *       onError: ()     => Swal.fire("Error", "Failed to load", "error"),
 *       onStart: ()     => setLoading(true),
 *       onEnd:   ()     => setLoading(false),
 *     });
 *   }, []);
 */
import secureStorage from "./secureStorage";

export const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/** Read a cache entry. Returns null when absent. */
function readEntry(key) {
  return secureStorage.getJSON(key); // { data, ts }
}

/** Write a cache entry with a fresh timestamp. */
function writeEntry(key, data) {
  secureStorage.setJSON(key, { data, ts: Date.now() });
}

/** Returns true when the entry exists and is within ttl. */
function isFresh(entry, ttl) {
  return !!entry?.data && Date.now() - entry.ts < ttl;
}

/**
 * Stale-while-revalidate fetch.
 *
 * @param {string}   key       Unique encrypted cache key (human-readable; obfuscated internally)
 * @param {Function} fetcher   async () => data[]  — makes the actual API call
 * @param {object}   opts
 * @param {number}   [opts.ttl=5min]  Max age before data is considered stale
 * @param {boolean}  [opts.force]     Bypass cache and always fetch fresh
 * @param {Function} [opts.onData]    (data: any) => void  — called whenever fresh/cached data is ready
 * @param {Function} [opts.onError]   (err: Error) => void — called if the network request fails
 * @param {Function} [opts.onStart]   () => void           — called before a network request
 * @param {Function} [opts.onEnd]     () => void           — called after a network request (success or fail)
 */
export async function fetchWithCache(key, fetcher, {
  ttl = DEFAULT_TTL,
  force = false,
  onData,
  onError,
  onStart,
  onEnd,
} = {}) {
  if (!force) {
    const entry = readEntry(key);

    // ── FRESH cache ───────────────────────────────────────────────────────────
    if (isFresh(entry, ttl)) {
      if (onData) onData(entry.data);
      return entry.data;
    }

    // ── STALE cache ───────────────────────────────────────────────────────────
    // Serve old data right away so the UI isn't blank, then refresh silently.
    if (entry?.data) {
      if (onData) onData(entry.data); // show stale data immediately (no spinner)
      // Background refresh — no onStart/onEnd so the UI stays interactive
      try {
        const freshData = await fetcher();
        writeEntry(key, freshData);
        if (onData) onData(freshData);
      } catch (err) {
        if (onError) onError(err);
      }
      return entry?.data;
    }
  }

  // ── NO cache (or force) ───────────────────────────────────────────────────
  if (onStart) onStart();
  try {
    const data = await fetcher();
    writeEntry(key, data);
    if (onData) onData(data);
    return data;
  } catch (err) {
    if (onError) onError(err);
    throw err;
  } finally {
    if (onEnd) onEnd();
  }
}

/** Remove a single cache entry. */
export function invalidateCache(key) {
  secureStorage.remove(key);
}

/** Remove multiple cache entries at once. */
export function invalidateCaches(...keys) {
  keys.forEach((k) => secureStorage.remove(k));
}

/** Read cached data synchronously (returns null if absent/expired). */
export function getCachedData(key, ttl = DEFAULT_TTL) {
  const entry = readEntry(key);
  if (!entry?.data) return null;
  if (Date.now() - entry.ts > ttl) return null;
  return entry.data;
}
