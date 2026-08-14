import { io } from "socket.io-client";

let socket = null;
// Identity the live socket actually handshook with. The server derives its rooms
// from the handshake query, so a socket opened under a different identity (or
// none) is subscribed to the WRONG rooms — returning it to a later caller means
// that caller's listeners never fire. Tracking it lets us detect the mismatch.
let socketIdentityKey = null;

const identityKeyOf = (role, identity) => {
  if (role === "portal") return `portal:${String(identity || "").trim().toLowerCase()}`;
  if (role === "admin" && identity && typeof identity === "object") {
    return `admin:${String(identity.email || "").trim().toLowerCase()}:${identity.userId || ""}`;
  }
  return `${role}:`;
};

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
  const wantedKey = identityKeyOf(role, identity);
  // Reuse only when the live socket was opened for the SAME identity. Previously
  // any existing socket was returned regardless — so whichever effect connected
  // FIRST fixed the rooms for the whole page, and a socket opened before the
  // portal user was known (or for another account) left every later listener
  // subscribed to nothing. Real-time then silently stopped while persistence and
  // reload-on-refresh kept working.
  if (socket && socketIdentityKey === wantedKey) return socket;
  if (socket && socketIdentityKey !== wantedKey) {
    try { socket.disconnect(); } catch { /* already closed */ }
    socket = null;
  }

  const query = { role };
  if (role === "portal" && identity) query.email = String(identity).trim().toLowerCase();
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
  socketIdentityKey = wantedKey;

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
    socketIdentityKey = null;
  }
}
