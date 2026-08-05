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

function refreshAdmin(req, target) {
  // The SLF summary aggregation is cached in-process; bust it the moment its
  // source data changes so admins never see stale totals after a CRUD op. Every
  // submission/baseline/facility mutation already routes through here.
  if (target === "submissions" || target === "baselines" || target === "facility") {
    try {
      const cache = require("./serverCache");
      const keys = require("./cacheKeys");
      cache.invalidate(keys.SUMMARY_BY_SLF_CACHE_KEY);
      cache.invalidate(keys.STATS_CACHE_PREFIX);
      cache.invalidate(keys.CELL_USAGE_CACHE_PREFIX);
    } catch {
      /* cache is best-effort — never break the refresh emit */
    }
  }
  emitToRoom(req, "admin-room", "data-refresh", { target });
}

function refreshPortal(req, email, target) {
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
