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
  // Return the existing instance whenever one exists — connected OR still
  // mid-handshake. Guarding only on `socket.connected` let concurrent effects
  // (many mount at once on the portal/admin pages) each call io() during the
  // brief connecting window, overwriting the module socket and orphaning the
  // previous instances. Orphaned sockets keep their connections, reconnect
  // timers and listener buffers alive — a steady memory grow-over-time leak.
  if (socket) return socket;

  const query = { role };
  if (role === "portal" && identity) query.email = identity;
  if (role === "admin" && identity && typeof identity === "object") {
    if (identity.email) query.email = identity.email;
    if (identity.userId) query.userId = identity.userId;
  }

  socket = io(SOCKET_URL, {
    path: "/eswm-pipeline/socket.io",
    query,
    // Start with polling then upgrade to WebSocket. Behind the /eswm-pipeline
    // reverse proxy a websocket-first connection can fail its handshake (logging
    // "WebSocket connection ... failed" in the console) before any fallback; the
    // polling→upgrade order establishes the session reliably and still uses WS.
    transports: ["polling", "websocket"],
    withCredentials: true,
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
