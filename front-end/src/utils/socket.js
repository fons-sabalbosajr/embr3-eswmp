import { io } from "socket.io-client";

let socket = null;

// In dev mode, connect directly to the backend on port 5000 using the SAME
// hostname the page was opened with — so network devices (e.g. 10.14.77.172)
// reach the server instead of their own localhost. In production, same-origin.
const SOCKET_URL = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:5000`
  : undefined;

/**
 * Connect to Socket.IO server.
 * @param {"admin"|"portal"} role
 * @param {string|object} [identity] - Portal email, or admin { email, userId }
 */
export function connectSocket(role, identity) {
  if (socket?.connected) return socket;

  const query = { role };
  if (role === "portal" && identity) query.email = identity;
  if (role === "admin" && identity && typeof identity === "object") {
    if (identity.email) query.email = identity.email;
    if (identity.userId) query.userId = identity.userId;
  }

  socket = io(SOCKET_URL, {
    path: "/eswm-pipeline/socket.io",
    query,
    transports: ["websocket", "polling"],
  });

  return socket;
}

/** Get the current socket instance (may be null). */
export function getSocket() {
  return socket;
}

/** Disconnect and clear the socket. */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
