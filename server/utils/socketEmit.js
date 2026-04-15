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
  emitToRoom(req, "admin-room", "data-refresh", { target });
}

function refreshPortal(req, email, target) {
  emitToRoom(req, `portal-${email}`, "data-refresh", { target });
}

module.exports = { emitToRoom, notifyAdmin, notifyPortal, refreshAdmin, refreshPortal };
