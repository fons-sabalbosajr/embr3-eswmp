/**
 * A minimal in-process Redis server, just large enough to prove the cache
 * service's Redis path really works end to end.
 *
 * Why not mock ioredis: mocking the client would test the mock, not the wiring.
 * Speaking actual RESP over a real socket exercises the connection options, the
 * command encoding, the TTL argument, the SCAN cursor loop, and the UNLINK
 * pattern delete — the parts most likely to be wrong.
 *
 * Supports exactly what utils/serverCache issues: GET, SET … EX, DEL, UNLINK,
 * SCAN … MATCH … COUNT, plus the handshake commands ioredis sends on connect.
 * Not a Redis implementation; do not use it for anything else.
 */
const net = require("net");

function encode(value) {
  if (value === null || value === undefined) return "$-1\r\n";
  if (typeof value === "number") return `:${value}\r\n`;
  if (Array.isArray(value)) return `*${value.length}\r\n${value.map(encode).join("")}`;
  if (value && value.simple) return `+${value.simple}\r\n`;
  if (value && value.error) return `-${value.error}\r\n`;
  const str = String(value);
  return `$${Buffer.byteLength(str)}\r\n${str}\r\n`;
}

/** Glob → RegExp for the only pattern shape serverCache uses (`prefix*`). */
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function createFakeRedis() {
  const data = new Map(); // key -> { value, expiresAt }
  const stats = { get: 0, set: 0, scan: 0, unlink: 0, del: 0 };
  const sockets = new Set();

  const live = (key) => {
    const hit = data.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt && hit.expiresAt < Date.now()) {
      data.delete(key);
      return undefined;
    }
    return hit.value;
  };

  const run = (args) => {
    const cmd = String(args[0] || "").toUpperCase();
    switch (cmd) {
      case "INFO":
        // ioredis' ready-check parses this and refuses to go ready without
        // `loading:0`.
        return "# Server\r\nredis_version:7.0.0\r\n# Persistence\r\nloading:0\r\n";
      case "PING":
        return { simple: "PONG" };
      case "SELECT":
      case "CLIENT":
      case "QUIT":
        return { simple: "OK" };
      case "GET": {
        stats.get += 1;
        const value = live(args[1]);
        return value === undefined ? null : value;
      }
      case "SET": {
        stats.set += 1;
        let expiresAt = 0;
        const exIndex = args.findIndex((a) => String(a).toUpperCase() === "EX");
        if (exIndex > -1) expiresAt = Date.now() + Number(args[exIndex + 1]) * 1000;
        data.set(args[1], { value: args[2], expiresAt });
        return { simple: "OK" };
      }
      case "DEL":
      case "UNLINK": {
        stats[cmd === "DEL" ? "del" : "unlink"] += 1;
        let removed = 0;
        for (const key of args.slice(1)) if (data.delete(key)) removed += 1;
        return removed;
      }
      case "SCAN": {
        stats.scan += 1;
        const matchIndex = args.findIndex((a) => String(a).toUpperCase() === "MATCH");
        const re = matchIndex > -1 ? globToRegExp(args[matchIndex + 1]) : /.*/;
        const keys = [...data.keys()].filter((k) => live(k) !== undefined && re.test(k));
        // Always a single-page scan: cursor "0" means "iteration complete".
        return ["0", keys];
      }
      default:
        // HELLO and anything else ioredis probes with: an error reply is what a
        // real older Redis returns, and ioredis handles it by falling back.
        return { error: `ERR unknown command '${cmd}'` };
    }
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Parse as many complete RESP arrays as the buffer holds.
      for (;;) {
        if (buffer.length === 0 || buffer[0] !== 0x2a /* '*' */) return;
        const parsed = parseArray(buffer);
        if (!parsed) return; // incomplete — wait for more bytes
        buffer = buffer.subarray(parsed.consumed);
        socket.write(encode(run(parsed.args)));
      }
    });
  });

  return {
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
    data,
    stats,
    keys: () => [...data.keys()],
  };
}

/**
 * Parse one `*N\r\n$len\r\nval\r\n…` frame. Returns null when incomplete.
 *
 * Operates on BYTE offsets, never on a decoded string: RESP `$len` is a byte
 * count, and Region 3 data carries non-ASCII place names (Peñaranda, Sto. Niño),
 * so a character-indexed parser under-reads every frame containing one and stalls
 * waiting for bytes that already arrived.
 */
function parseArray(buffer) {
  const CRLF = "\r\n";
  let cursor = buffer.indexOf(CRLF);
  if (cursor === -1) return null;
  const count = Number(buffer.toString("latin1", 1, cursor));
  cursor += 2;
  const args = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer[cursor] !== 0x24 /* '$' */) return null;
    const lenEnd = buffer.indexOf(CRLF, cursor);
    if (lenEnd === -1) return null;
    const len = Number(buffer.toString("latin1", cursor + 1, lenEnd));
    const start = lenEnd + 2;
    if (buffer.length < start + len + 2) return null;
    args.push(buffer.toString("utf8", start, start + len));
    cursor = start + len + 2;
  }
  return { args, consumed: cursor };
}

module.exports = { createFakeRedis };
