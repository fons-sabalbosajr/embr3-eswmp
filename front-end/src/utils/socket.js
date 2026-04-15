import { io } from "socket.io-client";

let socket = null;

// In dev mode, connect directly to the backend to avoid Vite proxy WS issues.
// In production, the browser connects to the same origin (nginx proxies).
const SOCKET_URL = import.meta.env.DEV ? "http://localhost:5000" : undefined;

/**
 * Connect to Socket.IO server.
 * @param {"admin"|"portal"} role
 * @param {string} [email] - Required for portal role
 */
export function connectSocket(role, email) {
  if (socket?.connected) return socket;

  const query = { role };
  if (role === "portal" && email) query.email = email;

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
