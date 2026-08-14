/**
 * Emit a real-time notification via Socket.IO.
 * @param {import('express').Request} req - Express request (used to access `req.app.get("io")`)
 * @param {string} room - Target room ("admin-room" or `portal-${email}`)
 * @param {string} event - Event name (e.g. "notification", "data-refresh")
 * @param {object} payload - Data to send
 */
function emitToRoom(req, room, event, payload) {
  try {
    const io = req.app.get("io");
    if (io) io.to(room).emit(event, payload);
  } catch {
    /* silent – socket emit should never break the request */
  }
}

function notifyAdmin(req, payload) {
  emitToRoom(req, "admin-room", "notification", payload);
}

function notifyPortal(req, email, payload) {
  emitToRoom(req, `portal-${email}`, "notification", payload);
}

// Which cached dashboard keys a given refresh target makes stale. Every
// submission/baseline/facility/client mutation already routes through
// refreshAdmin, so this table is the single place the write side and the cache
// side agree on. Anything not listed here is left to its bounded TTL.
function staleKeysFor(target) {
  const keys = require("./cacheKeys");
  // The Portal Mini Dashboard summary is derived from submissions AND the
  // baseline, so any of these writes can change it. Invalidated by PREFIX rather
  // than by facility: the refresh target does not carry an SLF id, and clearing
  // one extra facility's summary only costs a recompute — serving a stale
  // Submitted Vol. after an operator's own submission would be a correctness bug.
  // The Admin submissions TABLE and the tiles beside it are derived from the same
  // records, so they must be invalidated together — leaving one behind is how a
  // table and its summary tiles end up disagreeing after an approval.
  const slfData = [
    keys.SUMMARY_BY_SLF_CACHE_KEY,
    keys.STATS_CACHE_PREFIX,
    keys.CELL_USAGE_CACHE_PREFIX,
    keys.WASTE_RECEIVED_PREFIX,
    keys.ADMIN_SUBMISSIONS_PREFIX,
    keys.ADMIN_ANALYTICS_KEY,
    keys.ADMIN_SUMMARY_DASHBOARD_KEY,
  ];
  switch (target) {
    case "submissions":
      return slfData;
    case "baselines":
      // Baseline saves also re-derive the client roster (syncBaselineClients),
      // which is what /slf-clients/summary counts.
      return [...slfData, keys.MODULE_STATS.slfClients];
    case "facility":
    case "slf-facilities":
      // /summary-by-slf joins facility names, so a facility rename changes it.
      return [...slfData, keys.MODULE_STATS.slfFacilities];
    case "slf-clients":
      return [keys.MODULE_STATS.slfClients];
    default:
      return [];
  }
}

function refreshAdmin(req, target) {
  // The SLF aggregations are cached; bust them the moment their source data
  // changes so admins never see stale totals after a CRUD op. Invalidation is
  // async now that the cache can be Redis-backed — fire and forget, because a
  // failed invalidation only costs the bounded TTL and must never delay or break
  // the refresh emit.
  try {
    for (const key of staleKeysFor(target)) {
      require("./serverCache").invalidate(key).catch(() => {});
    }
  } catch {
    /* cache is best-effort — never break the refresh emit */
  }
  emitToRoom(req, "admin-room", "data-refresh", { target });
}

function refreshPortal(req, email, target) {
  // Same invalidation as refreshAdmin, for the same reason. Several write paths
  // notify only the portal — an admin approving/rejecting/locking a baseline
  // emits refreshPortal(email, "baselines") without an admin-side counterpart —
  // and the portal is precisely the side that would then re-read a stale
  // Mini Dashboard. Deriving both from staleKeysFor keeps the two emit paths from
  // drifting apart.
  try {
    for (const key of staleKeysFor(target)) {
      require("./serverCache").invalidate(key).catch(() => {});
    }
  } catch {
    /* cache is best-effort — never break the refresh emit */
  }
  emitToRoom(req, `portal-${email}`, "data-refresh", { target });
}

// Broadcast to EVERY connected client (admin + all portal sessions). Used for
// global settings changes — e.g. the SLF sensitive-value masking toggle — that
// must reach all open portals at once, not one email room.
function broadcastRefresh(req, target) {
  try {
    const io = req.app.get("io");
    if (io) io.emit("data-refresh", { target });
  } catch {
    /* silent */
  }
}

module.exports = { emitToRoom, notifyAdmin, notifyPortal, refreshAdmin, refreshPortal, broadcastRefresh };
