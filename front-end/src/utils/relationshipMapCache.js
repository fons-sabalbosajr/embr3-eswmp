import api from "../api";

/**
 * Shared, in-memory loader for /slf-clients/relationship-map.
 *
 * Three views in the "LGUs & Private Sectors Served" modal need this data: the
 * Summary tab (which needs BOTH types), the LGUs Served tab, and the Private
 * Sectors tab. Each used to fetch independently, so opening the modal and
 * clicking through the tabs issued four requests for two payloads — and every
 * tab switch re-fetched, which is what made the section feel slow.
 *
 * The payload is large, so it is deliberately cached in memory rather than
 * through the encrypted pageCache: AES-encrypting megabytes on every write
 * blocks the main thread, which is the freeze this is meant to remove.
 *
 * Concurrent callers share one in-flight promise, and a short TTL keeps the
 * data honest while a user works through the tabs.
 */

const TTL_MS = 2 * 60 * 1000;

const cache = new Map(); // type -> { data, at }
const inFlight = new Map(); // type -> Promise

/**
 * @param {"LGU"|"Private Sector"} type
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ rows: object[], summary: object|null }>}
 */
export function loadRelationshipMap(type, { force = false } = {}) {
  if (!force) {
    const hit = cache.get(type);
    if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data);
    const pending = inFlight.get(type);
    if (pending) return pending;
  }

  const request = api
    .get("/slf-clients/relationship-map", { params: { type } })
    .then(({ data }) => {
      const value = {
        rows: Array.isArray(data?.rows) ? data.rows : [],
        summary: data?.summary || null,
      };
      cache.set(type, { data: value, at: Date.now() });
      return value;
    })
    .finally(() => {
      inFlight.delete(type);
    });

  inFlight.set(type, request);
  return request;
}

/** Synchronous read of a still-fresh entry, for an instant first paint. */
export function peekRelationshipMap(type) {
  const hit = cache.get(type);
  return hit && Date.now() - hit.at < TTL_MS ? hit.data : null;
}

/** Drop cached payloads after a client edit so the next read is authoritative. */
export function invalidateRelationshipMap() {
  cache.clear();
}
