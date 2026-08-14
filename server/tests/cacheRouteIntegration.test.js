/**
 * cacheJson mounted in a REAL Express app.
 *
 * The unit tests drive a hand-rolled response object; this one pins the things
 * only Express can prove:
 *
 *  • a cached body is never reachable before the route's auth/permission
 *    middleware has run — the whole reason cacheJson mounts last in the chain;
 *  • a globally mounted `res.json` wrapper still transforms a CACHE HIT. This is
 *    the contract that keeps demo masking correct: server.js mounts
 *    demoMaskingMiddleware on /api before any router, so it wraps res.json first
 *    and cacheJson wraps it second. What gets cached is therefore the RAW payload,
 *    and the per-request transform still runs on hits. Get this backwards and a
 *    demo session's masked response would be cached and served to everyone (or a
 *    real session would be served a masked one).
 *    The transform here stands in for maskConfidentialValues, which cannot run in
 *    this test because it reads the privacy toggle from MongoDB.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const serverCache = require("../utils/serverCache");
const { cacheJson, invalidateOnWrite } = require("../middleware/cacheRoute");

const MASK = "***********";
let handlerRuns = 0;
let server;
let baseUrl;

test.before(async () => {
  const app = express();
  app.use(express.json());

  // Stand-in for demoMaskingMiddleware: mounted globally, BEFORE the router, and
  // wraps res.json per request based on who is calling.
  app.use((req, res, next) => {
    if (req.headers["x-demo"] === "true") {
      const originalJson = res.json.bind(res);
      res.json = (body) => originalJson({ ...body, tippingFee: MASK });
    }
    next();
  });

  const router = express.Router();

  // Stand-in for authMiddleware/requirePermission — mounted BEFORE cacheJson.
  router.use((req, res, next) => {
    if (req.headers.authorization !== "Bearer good") return res.status(401).json({ message: "Unauthorized" });
    next();
  });
  router.use(invalidateOnWrite("slf:dashboard:itest"));

  router.get("/stats", cacheJson((req) => `slf:dashboard:itest:${req.query.year || "all"}`, 60000), async (req, res) => {
    handlerRuns += 1;
    // `?slow=1` stands in for a real aggregation that takes long enough for a
    // second request to arrive before the first has answered. Deliberately NOT
    // part of the cache key — the point is that both requests want the same key.
    if (req.query.slow) await new Promise((r) => setTimeout(r, 120));
    res.json({ totalRecords: 3, tippingFee: 1200, year: req.query.year || "all", runs: handlerRuns });
  });

  router.post("/", (req, res) => res.status(201).json({ ok: true }));

  app.use("/api/itest", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

const call = (path, init = {}) =>
  fetch(`${baseUrl}${path}`, { ...init, headers: { authorization: "Bearer good", ...(init.headers || {}) } });

test.beforeEach(() => { serverCache._clearLocal(); handlerRuns = 0; });

test("an unauthenticated caller is rejected and never reaches the cache", async () => {
  // Warm the cache with an authorised request first.
  await call("/api/itest/stats");
  assert.equal(handlerRuns, 1);

  const res = await fetch(`${baseUrl}/api/itest/stats`); // no token
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("x-cache"), null, "the cache layer must not run before auth");
  assert.deepEqual(await res.json(), { message: "Unauthorized" });
});

test("MISS runs the handler, HIT does not — and the body is identical", async () => {
  const first = await call("/api/itest/stats");
  assert.equal(first.headers.get("x-cache"), "MISS");
  const firstBody = await first.json();

  const second = await call("/api/itest/stats");
  assert.equal(second.headers.get("x-cache"), "HIT");
  assert.deepEqual(await second.json(), firstBody);
  assert.equal(handlerRuns, 1, "the aggregation ran once for two requests");
});

test("a cache HIT is still transformed per request — masking is not cached", async () => {
  // A normal session populates the cache with the RAW payload.
  const plain = await (await call("/api/itest/stats")).json();
  assert.equal(plain.tippingFee, 1200);

  // A demo session HITS that same entry and must still get a masked value.
  const demo = await call("/api/itest/stats", { headers: { "x-demo": "true" } });
  assert.equal(demo.headers.get("x-cache"), "HIT");
  assert.equal((await demo.json()).tippingFee, MASK, "a cached body must still pass through the masking wrapper");

  // …and the demo request must not have poisoned the cache for everyone else.
  const plainAgain = await (await call("/api/itest/stats")).json();
  assert.equal(plainAgain.tippingFee, 1200, "a masked response must never be written back to the shared cache");
  assert.equal(handlerRuns, 1);
});

test("concurrent MISSes on the same key run the aggregation once", async () => {
  const responses = await Promise.all([
    call("/api/itest/stats?slow=1"),
    call("/api/itest/stats?slow=1"),
    call("/api/itest/stats?slow=1"),
    call("/api/itest/stats?slow=1"),
  ]);
  const bodies = await Promise.all(responses.map((r) => r.json()));
  assert.equal(handlerRuns, 1, "four simultaneous dashboard loads must not run four aggregations");
  for (const body of bodies) assert.equal(body.runs, 1);
  assert.ok(responses.some((r) => r.headers.get("x-cache") === "COALESCED"));
});

test("different query parameters are cached separately", async () => {
  const a = await (await call("/api/itest/stats?year=2024")).json();
  const b = await (await call("/api/itest/stats?year=2025")).json();
  assert.equal(a.year, "2024");
  assert.equal(b.year, "2025");
  assert.equal(handlerRuns, 2);
});

test("a POST invalidates the cached tiles, so the next read is fresh", async () => {
  await call("/api/itest/stats");
  assert.equal((await (await call("/api/itest/stats")).headers.get("x-cache")), "HIT");

  const write = await call("/api/itest/", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(write.status, 201);
  await new Promise((r) => setTimeout(r, 50)); // res "finish" fires after the body is written

  const after = await call("/api/itest/stats");
  assert.equal(after.headers.get("x-cache"), "MISS", "a write must not leave the dashboard serving pre-write tiles");
  assert.equal(handlerRuns, 2);
});
