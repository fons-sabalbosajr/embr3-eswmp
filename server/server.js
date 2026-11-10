// Force IPv4-first DNS resolution — fixes ENOTFOUND for googleapis.com on
// Windows/Node 17+ where IPv6 is preferred but may be unreachable on LAN.
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const os = require("os");
const http = require("http");
require("dotenv").config();

// Demo write isolation must be registered BEFORE any model is compiled — the
// route requires below pull in the models, and mongoose.plugin() only applies
// to schemas created after the call. Moving this lower silently disarms it.
require("./utils/demoMode").installDemoWriteGuard(require("mongoose"));

const authRoutes = require("./routes/auth");
const slfGeneratorRoutes = require("./routes/slfGenerators");
const dataSLFRoutes = require("./routes/dataSLF");
const settingsRoutes = require("./routes/settings");
const usersRoutes = require("./routes/users");
const logsRoutes = require("./routes/logs");
const transactionsRoutes = require("./routes/transactions");
const tenYearSwmPlanRoutes = require("./routes/tenYearSwmPlan");
const fundedMRFRoutes = require("./routes/fundedMRF");
const lguInitiatedMRFRoutes = require("./routes/lguInitiatedMRF");
const trashTrapRoutes = require("./routes/trashTraps");
const swmEquipmentRoutes = require("./routes/swmEquipment");
const slfFacilityRoutes = require("./routes/slfFacilities");
const slfClientRoutes = require("./routes/slfClients");
const region3LguRoutes = require("./routes/region3Lgu");
const dataReferenceRoutes = require("./routes/dataReferences");
const openDumpsiteRoutes = require("./routes/openDumpsites");
const residualContainmentRoutes = require("./routes/residualContainment");
const projectDescScopingRoutes = require("./routes/projectDescScoping");
const transferStationRoutes = require("./routes/transferStations");
const lguAssistDiversionRoutes = require("./routes/lguAssistDiversion");
const technicalAssistanceRoutes = require("./routes/technicalAssistance");
const portalAuthRoutes = require("./routes/portalAuth");
const portalUsersRoutes = require("./routes/portalUsers");
const dataHistoryRoutes = require("./routes/dataHistory");
const notificationRoutes = require("./routes/notifications");
const supportTicketRoutes = require("./routes/supportTickets");
const haulerDeleteRequestRoutes = require("./routes/haulerDeleteRequests");
const uploadRoutes = require("./routes/upload");
const messageRoutes = require("./routes/messages");
const automationAgentRoutes = require("./routes/automationAgent");
const veraRoutes = require("./routes/vera");

const app = express();
const server = http.createServer(app);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30 * 60 * 1000);
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 60 * 1000;
const PORT = process.env.PORT || 5000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/embr3_eswmp";
const MONGODB_DNS_SERVERS = (process.env.MONGODB_DNS_SERVERS || "8.8.8.8,1.1.1.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173/eswm-pipeline";

const { connectMongo, isMongoReady } = require("./config/mongo");

// Middleware — build allowed CORS origins dynamically
function getAllowedOrigins() {
  const origins = new Set();
  // Always allow the configured CLIENT_URL origin
  try { origins.add(new URL(CLIENT_URL).origin); } catch {}
  // Always allow localhost variants
  origins.add("http://localhost:5173");
  origins.add("http://127.0.0.1:5173");
  // Production origin(s). Comma-separated ALLOWED_ORIGINS env overrides/extends;
  // the live domain is included as a safe default so Socket.IO/CORS keep working
  // even if CLIENT_URL/ALLOWED_ORIGINS are not set in the deployment environment.
  (process.env.ALLOWED_ORIGINS || "https://embr3-onlinesystems.cloud")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      try { origins.add(new URL(value).origin); }
      catch { origins.add(value); }
    });
  // Auto-detect the current network IP so CORS survives IP changes
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        origins.add(`http://${iface.address}:5173`);
      }
    }
  }
  return [...origins];
}
const allowedOrigins = getAllowedOrigins();
// Trust the reverse proxy in front of the app (Cloudflare / nginx) so req.ip
// reflects the real client. A specific hop count is used instead of `true`:
// `true` trusts every hop, which lets clients spoof X-Forwarded-For to bypass
// IP-based rate limiting (express-rate-limit ERR_ERL_PERMISSIVE_TRUST_PROXY).
// Override TRUST_PROXY_HOPS in the env if the deployment has a different number
// of proxies in front of it (set to 0 for direct/local with no proxy).
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);
app.set("trust proxy", Number.isFinite(TRUST_PROXY_HOPS) ? TRUST_PROXY_HOPS : 1);

// Security headers. CSP is left to the front-end host (this server returns JSON
// + serves uploaded media to the SPA on a different origin), and cross-origin
// resource policy is relaxed so that media can be loaded by the client.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Throttle authentication endpoints against credential brute-forcing.
// A resilient key generator falls back to the socket address (and normalizes
// IPv6 via ipKeyGenerator) so a request with an undefined req.ip can't crash
// the limiter (express-rate-limit ERR_ERL_UNDEFINED_IP_ADDRESS).
const { ipKeyGenerator } = rateLimit;
const IS_PROD = process.env.NODE_ENV === "production";
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Separate dev/prod ceilings. Production stays strict against credential
  // brute-forcing; development is generous so repeated testing — including the
  // developer sign-in, which first fails /portal-auth/login before falling back
  // to /dev-portal/override (two auth hits per attempt) — doesn't trip HTTP 429.
  // Override with AUTH_RATE_MAX.
  max: Number(process.env.AUTH_RATE_MAX ?? (IS_PROD ? 50 : 500)),
  // Only FAILED attempts count toward the brute-force budget; a successful login
  // no longer consumes the allowance, so normal use can't lock out a real user.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please wait a few minutes and try again." },
  keyGenerator: (req) =>
    ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown"),
});

// Portal READ traffic (/me, /my-submissions, /my-submissions/batch, notifications,
// facility info…) is high-frequency by design: the Portal refreshes on socket
// events, polls the history tab, and re-pulls after every cell save. Throttling all
// of that with the strict `authLimiter` (50/15min, meant for credential brute-force
// on login/signup/reset) made normal use trip HTTP 429. This generous limiter is
// applied to the whole portal-auth router; the sensitive credential endpoints inside
// it re-apply `authLimiter` on top, so brute-force protection is preserved without
// starving legitimate reads. Configurable via PORTAL_READ_RATE_MAX.
const portalReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PORTAL_READ_RATE_MAX ?? 1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please slow down and try again shortly." },
  keyGenerator: (req) =>
    ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown"),
});

// Automation Agent burst limiter — each request can trigger a paid Anthropic
// call, so cap request bursts per IP on top of the per-user/global DAILY limits
// enforced in the route from the usage log. Configurable via
// AUTOMATION_AGENT_RATE_MAX (requests / 15 min / IP).
const automationAgentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTOMATION_AGENT_RATE_MAX ?? (IS_PROD ? 60 : 300)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many AI requests, please slow down and try again shortly." },
  keyGenerator: (req) =>
    ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown"),
});

// VERA chatbot burst limiter — portal-user facing, so a more generous ceiling than
// the admin automation agent. Per-user DAILY limits are enforced in the route.
const veraLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.VERA_RATE_MAX ?? (IS_PROD ? 120 : 400)),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many chat requests, please slow down and try again shortly." },
  keyGenerator: (req) =>
    ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown"),
});

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (e.g. server-to-server, curl)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// ── Socket.IO setup ──
const { Server: SocketIO } = require("socket.io");
const io = new SocketIO(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  path: "/eswm-pipeline/socket.io",
});

io.on("connection", (socket) => {
  const { role } = socket.handshake.query || {};
  if (role === "admin") {
    socket.join("admin-room");
    const email = socket.handshake.query.email;
    const userId = socket.handshake.query.userId;
    if (email) socket.join(`admin-${email}`);
    if (userId) socket.join(`admin-${userId}`);
  }
  if (role === "portal") {
    // Normalize the room name. Every emitter targets
    // `portal-${email.toLowerCase()}` (see utils/socketEmit.js and
    // routes/portalMessages.js), but the JOIN used the raw handshake value — so a
    // client connecting with any capitalisation joined a room nothing ever
    // published to. The message still persisted and appeared on the next reload,
    // which is exactly what "does not reflect in real time" looks like.
    const email = String(socket.handshake.query.email || "").trim().toLowerCase();
    if (email) socket.join(`portal-${email}`);
  }
  socket.on("disconnect", () => {});
});

// Make io accessible to routes via req.app
app.set("io", io);
app.use((_req, res, next) => {
  if (process.env.NODE_ENV !== "production") return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === "object" && "error" in body) {
      const { error, ...safe } = body;
      return originalJson(safe);
    }
    return originalJson(body);
  };
  next();
});

app.use((req, _res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      if (decoded.id) {
        const User = require("./models/User");
        const UserPortal = require("./models/UserPortal");
        User.findById(decoded.id)
          .select("email")
          .then((u) => {
            if (u) {
              req.logUser = u.email;
              return;
            }
            return UserPortal.findById(decoded.id)
              .select("email")
              .then((p) => {
                if (p) req.logUser = p.email;
              });
          })
          .catch(() => {})
          .finally(() => next());
        return;
      }
    } catch { /* invalid token */ }
  }
  next();
});

// ── MongoDB ──
// Startup maintenance runs *after* the connection is reported healthy and is
// deliberately not awaited by the connect promise: backfills/merges can take
// seconds on a large database, and the HTTP server must not be held back by
// them. Each step is isolated so one failure cannot abort the rest.
async function runStartupMaintenance() {
  const steps = [
    [
      "scheduled submission worker",
      () => require("./utils/scheduledSubmissionWorker").startScheduledSubmissionWorker(),
    ],
    [
      "transaction backfill",
      async () => {
        const { backfillTransactions } = require("./utils/backfillTransactions");
        const seeded = await backfillTransactions();
        if (seeded > 0) console.log(`Backfilled ${seeded} transaction records.`);
      },
    ],
    ["Bataan SLF merge", () => require("./utils/mergeBataanSlf").mergeBataanSlf()],
    ["dummy cell backfill", () => require("./utils/dummyCells").backfillDummyCells()],
    [
      "cell occupancy provenance backfill",
      async () => {
        const { backfillCellOccupancy } = require("./utils/backfillCellOccupancy");
        const updated = await backfillCellOccupancy();
        if (updated > 0) console.log(`Backfilled baseline/submitted split for ${updated} facilities.`);
      },
    ],
  ];

  for (const [label, run] of steps) {
    try {
      await run();
    } catch (err) {
      console.error(`Startup maintenance — ${label} failed:`, err.message);
    }
  }
}

connectMongo(MONGODB_URI, {
  dnsServers: MONGODB_DNS_SERVERS,
  onConnected: () => {
    // Detached on purpose — see runStartupMaintenance().
    runStartupMaintenance();
  },
}).catch(() => {
  // connectMongo already logged the failure with actionable detail. The HTTP
  // server stays up so /api/health reports the outage instead of the process
  // dying silently; the readiness gate below answers 503 until Mongo is back.
});

// Readiness gate: without it, requests that arrive before the database is up
// sit in Mongoose's command buffer until it times out (10s each), which looks
// like a hang. Answer immediately and honestly instead.
const MONGO_GATE_EXEMPT = /^\/api\/health/;
app.use("/api", (req, res, next) => {
  if (isMongoReady() || MONGO_GATE_EXEMPT.test(req.originalUrl)) return next();
  res.status(503).json({
    message: "Database is starting up. Please retry in a moment.",
    code: "DB_UNAVAILABLE",
  });
});

// Demonstration sessions get confidential numerics masked on the way OUT, for
// every /api route including any added later. Mounted before the route table so
// there is no window in which a new endpoint returns raw figures to a demo user.
app.use("/api", require("./utils/demoMode").demoMaskingMiddleware);

// Routes
app.get("/api/health", (req, res) => {
  // Reports the database separately from the process so a monitor can tell
  // "server down" apart from "server up, database still connecting".
  const database = isMongoReady() ? "connected" : "disconnected";
  res.json({
    status: database === "connected" ? "ok" : "degraded",
    message: "Server is running",
    database,
  });
});
app.get("/api/health/email", async (req, res) => {
  try {
    const { verifyTransporter } = require("./utils/email");
    await verifyTransporter();
    res.json({ status: "ok", message: "SMTP connected", user: process.env.EMAIL_USER || "(not set)" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message, user: process.env.EMAIL_USER || "(not set)" });
  }
});
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/slf-generators", slfGeneratorRoutes);
app.use("/api/data-slf", dataSLFRoutes);
app.use("/api/settings", settingsRoutes);
// Automation Agent — settings/test (developer) + query (admin/developer). DAILY
// per-user/global limits are enforced inside the route from the usage log; the
// burst limiter below guards the paid Anthropic call.
//
// The router has to be mounted at "/api" because its two URL families do not
// share a prefix ("/developer/automation-agent/*" and "/automation-agent/query").
// Passing the limiter to app.use() here was the bug: Express runs mount-path
// middleware for EVERY request under the path, whether or not the router that
// follows it handles that request. With the mount at "/api", a limiter sized for
// paid AI calls (60 req / 15 min in production) was therefore counting the entire
// API surface — every dashboard stat, every poll, every portal read.
//
// The admin dashboard alone fans out to ~16 endpoints per refresh, so the budget
// was exhausted after roughly four refreshes and unrelated endpoints started
// returning HTTP 429 (/slf-clients/summary, /*/stats, /vera/notifications …).
//
// Gating by path keeps the mount where it has to be while charging only the two
// route families that actually reach Anthropic — the same approach
// `sensitivePortalAuthLimiter` below takes for the portal-auth router.
function automationAgentPathLimiter(req, res, next) {
  // req.path is relative to the "/api" mount ("/automation-agent/query",
  // "/developer/automation-agent/settings", "/slf-clients/summary", …).
  const path = req.path || "";
  const isAgent =
    path.startsWith("/automation-agent/") ||
    path.startsWith("/developer/automation-agent/");
  return isAgent ? automationAgentLimiter(req, res, next) : next();
}
app.use("/api", automationAgentPathLimiter, automationAgentRoutes);
// VERA chatbot (portal-user + admin). Burst limiter guards the router; per-user
// DAILY limit is enforced inside the route from the usage log.
app.use("/api/vera", veraLimiter, veraRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/logs", logsRoutes);
app.use("/api/transactions", transactionsRoutes);
app.use("/api/ten-year-swm", tenYearSwmPlanRoutes);
app.use("/api/funded-mrf", fundedMRFRoutes);
app.use("/api/lgu-initiated-mrf", lguInitiatedMRFRoutes);
app.use("/api/trash-traps", trashTrapRoutes);
app.use("/api/swm-equipment", swmEquipmentRoutes);
app.use("/api/slf-facilities", slfFacilityRoutes);
app.use("/api/slf-clients", slfClientRoutes);
app.use("/api/region3-lgu", region3LguRoutes);
app.use("/api/data-references", dataReferenceRoutes);
app.use("/api/open-dumpsites", openDumpsiteRoutes);
app.use("/api/residual-containment", residualContainmentRoutes);
app.use("/api/project-desc-scoping", projectDescScopingRoutes);
app.use("/api/transfer-stations", transferStationRoutes);
app.use("/api/lgu-assist-diversion", lguAssistDiversionRoutes);
app.use("/api/technical-assistance", technicalAssistanceRoutes);
// Brute-force protection stays on the credential-changing endpoints only; the rest
// of the portal-auth router (high-frequency reads) uses the generous limiter. A
// path prefix list keeps this in one place instead of decorating every route.
const SENSITIVE_PORTAL_AUTH_PREFIXES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/verify-reset-code",
  "/reset-password",
  "/credentials/request-code",
  "/credentials/update",
  "/submit-verification",
];
function sensitivePortalAuthLimiter(req, res, next) {
  // req.path is relative to the mount path ("/login", "/me", …) inside app.use.
  const path = req.path || "";
  const isSensitive = SENSITIVE_PORTAL_AUTH_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
  return isSensitive ? authLimiter(req, res, next) : next();
}

app.use("/api/portal-auth", sensitivePortalAuthLimiter, portalReadLimiter, portalAuthRoutes);
app.use("/api/porta-auth", sensitivePortalAuthLimiter, portalReadLimiter, portalAuthRoutes); // Backward compatibility for previously stored typo URLs
app.use("/api/portal-users", portalUsersRoutes);
app.use("/api/data-history", dataHistoryRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/support-tickets", supportTicketRoutes);
app.use("/api/hauler-delete-requests", haulerDeleteRequestRoutes);
app.use("/api/upload", uploadRoutes);
// Profile pictures — admin and portal users change their own (Drive images › Profile Pictures).
app.use("/api/profile-photo", require("./routes/profilePhoto"));
app.use("/api/messages", messageRoutes);
app.use("/api/dummy-data", require("./routes/dummyData"));
app.use("/api/slf-data-files", require("./routes/slfDataFiles"));
app.use("/api/portal-queue", require("./routes/portalQueue"));
app.use("/api/portal-messages", require("./routes/portalMessages"));
app.use("/api/dev-portal", require("./routes/devPortal"));
// Developer-only Portal User Rules configuration (router enforces authMiddleware +
// developerOnly on every route).
app.use("/api/portal-user-rules", require("./routes/portalUserRules"));
// Developer-only raw submission maintenance + volume analysis. The router itself
// applies authMiddleware + developerOnly to every route.
app.use("/api/raw-submissions", require("./routes/rawSubmissions"));


app.use((err, req, res, _next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  const isProd = process.env.NODE_ENV === "production";
  res.status(err.status || 500).json({
    message: "Server error",
    ...(isProd ? {} : { error: err.message }),
  });
});

// Error handler. Mounted after the routes so anything a route forwards with
// next(err) — notably the demo write guard's DEMO_WRITE_BLOCKED — surfaces with
// its intended status instead of collapsing into a generic 500.
// eslint-disable-next-line no-unused-vars
app.use("/api", (err, req, res, next) => {
  const status = err?.status || 500;
  if (status >= 500) console.error("[api]", err);
  res.status(status).json({
    message: status >= 500 ? "Internal server error" : err.message,
    ...(err?.code ? { code: err.code } : {}),
  });
});

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

try {
  const { getDriveConfigStatus } = require("./utils/googleDrive");
  const driveStatus = getDriveConfigStatus();
  if (driveStatus.ok) {
    console.log(`Google Drive config OK (auth: ${driveStatus.authMethod}).`);
  } else {
    console.warn(
      "\n[Google Drive] Configuration incomplete — uploads will fall back to " +
        "local storage until fixed."
    );
    console.warn(`  Missing: ${driveStatus.missing.join(", ")}`);
    console.warn(
      "  Set the values in server/.env, then restart. See server/.env.example.\n"
    );
  }
} catch (err) {
  console.warn("[Google Drive] Config check skipped:", err.message);
}

// Open the ONE Redis connection for this process, if the deployment configures
// one. Deliberately not awaited and deliberately after the Mongo/Drive checks:
// Redis is a cache layer, so the server must boot and serve normally whether it
// connects or not (utils/serverCache falls back to its in-process tier).
require("./config/redis").getClient();

// Listen on 0.0.0.0 so the server is accessible over the network
server.listen(PORT, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log(`\nServer is running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}\n`);
});

// Release the Redis socket on shutdown so a restart does not leave a connection
// lingering until the server-side timeout. Everything else here is already
// process-scoped, so this is the only handle worth closing explicitly.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    require("./config/redis").close().finally(() => process.exit(0));
  });
}
