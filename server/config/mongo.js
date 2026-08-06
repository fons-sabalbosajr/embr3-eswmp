/**
 * MongoDB connection bootstrap.
 *
 * Responsibilities:
 *   • repair Node's DNS resolver before the driver performs its SRV/TXT lookups
 *     (see config/dnsResolver.js for the Windows c-ares root cause)
 *   • connect with explicit, bounded timeouts instead of driver defaults
 *   • retry with exponential backoff + jitter, re-checking DNS between attempts
 *   • fall back to an explicit seedlist URI built from the SRV/TXT records we
 *     resolved ourselves, when the driver's own SRV path keeps failing
 *   • expose readiness so HTTP handlers can answer 503 instead of hanging on
 *     Mongoose command buffering
 */

const mongoose = require("mongoose");
const { ensureResolvable } = require("./dnsResolver");

const LOG_PREFIX = "[mongo]";

const DEFAULTS = {
  serverSelectionTimeoutMS: 15000,
  connectTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  heartbeatFrequencyMS: 10000,
  maxPoolSize: 20,
  minPoolSize: 2,
  maxIdleTimeMS: 60000,
  retryWrites: true,
  retryReads: true,
  // IPv4 first. Atlas publishes A records only, and on Windows an unreachable
  // IPv6 path otherwise costs a full connect timeout before falling back.
  family: 4,
};

const MAX_ATTEMPTS = Number(process.env.MONGODB_MAX_CONNECT_ATTEMPTS || 6);
const BASE_RETRY_DELAY_MS = Number(process.env.MONGODB_RETRY_BASE_MS || 1000);
const MAX_RETRY_DELAY_MS = Number(process.env.MONGODB_RETRY_MAX_MS || 30000);

/** Error codes that mean "DNS is the problem", so re-running the repair helps. */
const DNS_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEOUT",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ESERVFAIL",
  "EREFUSED",
  "ENODATA",
  "EAI_AGAIN",
]);

let connectPromise = null;
let listenersBound = false;
/** SRV records captured during DNS verification, reused for the direct fallback. */
let cachedSrvRecords = null;

// ── URI helpers ─────────────────────────────────────────────────────────────

function isSrvUri(uri) {
  return typeof uri === "string" && uri.startsWith("mongodb+srv://");
}

/** Split a connection string into { scheme, credentials, authority, tail }. */
function splitUri(uri) {
  const schemeEnd = uri.indexOf("://");
  const scheme = uri.slice(0, schemeEnd);
  const rest = uri.slice(schemeEnd + 3);

  const slashIndex = rest.indexOf("/");
  const queryIndex = rest.indexOf("?");
  const boundaries = [slashIndex, queryIndex].filter((i) => i !== -1);
  const authorityEnd = boundaries.length ? Math.min(...boundaries) : rest.length;

  const authority = rest.slice(0, authorityEnd);
  const tail = rest.slice(authorityEnd);

  const atIndex = authority.lastIndexOf("@");
  const credentials = atIndex === -1 ? "" : authority.slice(0, atIndex + 1);
  const hosts = atIndex === -1 ? authority : authority.slice(atIndex + 1);

  return { scheme, credentials, hosts, tail };
}

/** The SRV lookup name the driver will use for a `mongodb+srv://` URI. */
function getSrvRecordName(uri) {
  if (!isSrvUri(uri)) return "";
  const { hosts } = splitUri(uri);
  const host = hosts.split(",")[0].trim();
  return host ? `_mongodb._tcp.${host}` : "";
}

/**
 * Build the plain `mongodb://` seedlist URI that the driver would have derived
 * from the SRV + TXT records, so a connection is still possible when the
 * driver's internal SRV resolution fails but ours succeeded.
 */
function buildDirectUri(uri, srvRecords, txtOptions) {
  const { credentials, tail } = splitUri(uri);
  const hosts = srvRecords
    .slice()
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    .map((record) => `${record.name}:${record.port}`)
    .join(",");

  const pathEnd = tail.indexOf("?");
  const path = pathEnd === -1 ? tail : tail.slice(0, pathEnd);
  const originalQuery = pathEnd === -1 ? "" : tail.slice(pathEnd + 1);

  // `mongodb+srv://` implies TLS and pulls defaults from the TXT record.
  // Explicit options on the original URI must still win over TXT defaults.
  const params = new URLSearchParams();
  params.set("ssl", "true");
  for (const [key, value] of new URLSearchParams(txtOptions || "")) params.set(key, value);
  for (const [key, value] of new URLSearchParams(originalQuery)) params.set(key, value);

  return `mongodb://${credentials}${hosts}${path || "/"}?${params.toString()}`;
}

// ── connection ──────────────────────────────────────────────────────────────

function buildOptions(overrides = {}) {
  return {
    ...DEFAULTS,
    serverSelectionTimeoutMS: Number(
      process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || DEFAULTS.serverSelectionTimeoutMS,
    ),
    connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS || DEFAULTS.connectTimeoutMS),
    socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS || DEFAULTS.socketTimeoutMS),
    maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || DEFAULTS.maxPoolSize),
    minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE || DEFAULTS.minPoolSize),
    ...overrides,
  };
}

/**
 * Verify (and repair if necessary) DNS for an SRV connection string.
 * Returns true when SRV lookups are known to work.
 */
async function prepareDns(uri, fallbackServers, { quiet = false } = {}) {
  const recordName = getSrvRecordName(uri);
  if (!recordName) return true; // non-SRV URI needs no SRV lookup

  const started = Date.now();
  const result = await ensureResolvable(recordName, fallbackServers);
  const elapsed = Date.now() - started;

  if (result.records?.length) cachedSrvRecords = result.records;

  if (result.status === "repaired") {
    console.warn(
      `${LOG_PREFIX} DNS resolver repaired in ${elapsed}ms — ${result.detail}. ` +
        `Now using: ${result.servers.join(", ")}`,
    );
    return true;
  }

  if (result.status === "failed") {
    if (!quiet) {
      console.error(
        `${LOG_PREFIX} SRV lookup for ${recordName} failed after ${elapsed}ms — ${result.detail}. ` +
          "Set MONGODB_DNS_SERVERS to a reachable resolver, or use a non-SRV mongodb:// URI.",
      );
    }
    return false;
  }

  return true; // "ok" — resolver was already healthy, stay silent
}

/** Attach one-time listeners so connection loss is visible in the logs. */
function bindConnectionListeners() {
  if (listenersBound) return;
  listenersBound = true;

  const connection = mongoose.connection;
  connection.on("disconnected", () => console.warn(`${LOG_PREFIX} disconnected`));
  connection.on("reconnected", () => console.log(`${LOG_PREFIX} reconnected`));
  connection.on("error", (error) => console.error(`${LOG_PREFIX} connection error: ${error.message}`));
}

function isDnsError(error) {
  if (!error) return false;
  if (DNS_ERROR_CODES.has(error.code)) return true;
  if (error.cause && DNS_ERROR_CODES.has(error.cause.code)) return true;
  return /querySrv|queryTxt|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(error.message || "");
}

function retryDelay(attempt) {
  const exponential = Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  // Jitter avoids synchronised retry storms when several processes restart together.
  return Math.round(exponential * (0.7 + Math.random() * 0.6));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve the TXT options record ourselves so a direct seedlist URI can be built.
 * Returns "" when unavailable — an empty options string is still usable.
 */
async function resolveTxtOptions(uri) {
  const { hosts } = splitUri(uri);
  const host = hosts.split(",")[0].trim();
  if (!host) return "";
  try {
    const chunks = await require("dns").promises.resolveTxt(host);
    return chunks.map((chunk) => chunk.join("")).join("&");
  } catch {
    return "";
  }
}

/**
 * Connect to MongoDB, retrying until success or the attempt budget is spent.
 * Safe to call more than once — the in-flight promise is shared.
 */
function connectMongo(uri, { dnsServers = [], onConnected } = {}) {
  if (connectPromise) return connectPromise;

  bindConnectionListeners();

  connectPromise = (async () => {
    const options = buildOptions();
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // Re-verify DNS before every attempt: a laptop that starts on a dead
      // network may only get a usable resolver a few seconds in.
      const dnsReady = await prepareDns(uri, dnsServers, { quiet: attempt < MAX_ATTEMPTS });

      try {
        await mongoose.connect(uri, options);
        console.log(
          `${LOG_PREFIX} connected successfully${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
        );
        if (onConnected) await onConnected();
        return mongoose.connection;
      } catch (error) {
        lastError = error;

        // The driver's own SRV path failed even though ours resolved: connect
        // directly to the seedlist we already hold instead of giving up.
        if (dnsReady && isSrvUri(uri) && isDnsError(error) && cachedSrvRecords?.length) {
          try {
            const directUri = buildDirectUri(uri, cachedSrvRecords, await resolveTxtOptions(uri));
            await mongoose.connect(directUri, options);
            console.warn(
              `${LOG_PREFIX} connected via resolved seedlist (${cachedSrvRecords.length} host(s)) ` +
                "because the driver's own SRV lookup failed",
            );
            if (onConnected) await onConnected();
            return mongoose.connection;
          } catch (directError) {
            lastError = directError;
          }
        }

        if (attempt === MAX_ATTEMPTS) break;

        const delay = retryDelay(attempt);
        console.warn(
          `${LOG_PREFIX} connection attempt ${attempt}/${MAX_ATTEMPTS} failed ` +
            `(${lastError.message}). Retrying in ${Math.round(delay / 100) / 10}s…`,
        );
        await wait(delay);
      }
    }

    console.error(
      `${LOG_PREFIX} could not connect after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`,
    );
    // Allow a later call (or a manual retry endpoint) to start over.
    connectPromise = null;
    throw lastError;
  })();

  return connectPromise;
}

/** 1 = connected. Used by the readiness gate and health endpoint. */
function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectMongo,
  isMongoReady,
  // exported for tests / diagnostics
  getSrvRecordName,
  buildDirectUri,
  splitUri,
};
