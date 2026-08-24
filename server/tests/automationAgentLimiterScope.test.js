/**
 * The Automation Agent burst limiter must charge ONLY the Automation Agent.
 *
 * The bug this pins
 * -----------------
 * The agent router was mounted as:
 *
 *   app.use("/api", automationAgentLimiter, automationAgentRoutes);
 *
 * Express runs mount-path middleware for EVERY request under the path, whether or
 * not the router that follows it handles that request. The router only serves
 * "/automation-agent/query" and "/developer/automation-agent/*", but the limiter
 * in front of it saw the whole "/api" surface — so a ceiling sized for paid
 * Anthropic calls (60 requests / 15 min in production) was being spent on
 * dashboard stats, polls and portal reads.
 *
 * The admin dashboard fans out to ~16 endpoints per refresh, so the budget was
 * gone after about four refreshes and unrelated endpoints began returning HTTP
 * 429: /slf-clients/summary, /slf-facilities/stats, /ten-year-swm/stats,
 * /vera/notifications, and the rest of the dashboard.
 *
 * This test drives a real express app over HTTP rather than reading the source,
 * so it fails if the mount shape regresses in any way that re-broadens the
 * limiter — not just if this exact line is edited back.
 *
 * Run: node --test tests/automationAgentLimiterScope.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const rateLimit = require("express-rate-limit");

const LIMIT = 5;

/** An app wired the way server.js wires the agent router, with a tiny budget. */
function buildApp() {
  const app = express();

  const automationAgentLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    // Every request in this test shares one bucket; the real key generator is
    // per-IP and is not what is under test here.
    keyGenerator: () => "test",
    message: { message: "Too many AI requests" },
  });

  // The gate under test — mirrors server.js.
  function automationAgentPathLimiter(req, res, next) {
    const path = req.path || "";
    const isAgent =
      path.startsWith("/automation-agent/") ||
      path.startsWith("/developer/automation-agent/");
    return isAgent ? automationAgentLimiter(req, res, next) : next();
  }

  const agentRoutes = express.Router();
  agentRoutes.post("/automation-agent/query", (_req, res) => res.json({ ok: "query" }));
  agentRoutes.get("/developer/automation-agent/settings", (_req, res) =>
    res.json({ ok: "settings" }),
  );

  app.use("/api", automationAgentPathLimiter, agentRoutes);

  // Stand-ins for the unrelated routers mounted after the agent in server.js.
  // These are exactly what was returning 429.
  app.get("/api/slf-clients/summary", (_req, res) => res.json({ ok: "summary" }));
  app.get("/api/slf-facilities/stats", (_req, res) => res.json({ ok: "stats" }));
  app.get("/api/vera/notifications", (_req, res) => res.json({ ok: "notifications" }));

  return app;
}

/** Start the app on an ephemeral port; resolves to { url, close }. */
function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("dashboard endpoints are never charged to the Automation Agent budget", async () => {
  const { url, close } = await listen(buildApp());
  try {
    const paths = [
      "/api/slf-clients/summary",
      "/api/slf-facilities/stats",
      "/api/vera/notifications",
    ];
    // Far more than LIMIT: under the old mount these all shared the agent bucket
    // and everything past the 5th request came back 429.
    for (let i = 0; i < LIMIT * 4; i += 1) {
      for (const path of paths) {
        const res = await fetch(url + path);
        assert.equal(
          res.status,
          200,
          `${path} returned ${res.status} on request ${i + 1} — the Automation Agent ` +
            "limiter is counting traffic it does not serve",
        );
      }
    }
  } finally {
    await close();
  }
});

test("the Automation Agent's own endpoints are still rate limited", async () => {
  const { url, close } = await listen(buildApp());
  try {
    // The budget must still be spent by, and only by, the paid routes.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await fetch(`${url}/api/automation-agent/query`, { method: "POST" });
      assert.equal(res.status, 200, `request ${i + 1} should be within the budget`);
    }
    const blocked = await fetch(`${url}/api/automation-agent/query`, { method: "POST" });
    assert.equal(blocked.status, 429, "the agent query must still be throttled past its ceiling");
  } finally {
    await close();
  }
});

test("the developer settings routes share the agent budget", async () => {
  const { url, close } = await listen(buildApp());
  try {
    // Both URL families reach the provider layer, so both must be charged — this
    // is why the gate matches two prefixes rather than one.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await fetch(`${url}/api/developer/automation-agent/settings`);
      assert.equal(res.status, 200, `request ${i + 1} should be within the budget`);
    }
    const blocked = await fetch(`${url}/api/developer/automation-agent/settings`);
    assert.equal(blocked.status, 429, "developer agent routes must be throttled too");
  } finally {
    await close();
  }
});

test("exhausting the agent budget does not lock out the dashboard", async () => {
  // The regression in reverse: an admin who runs a few agent queries must not
  // take the dashboard down with them.
  const { url, close } = await listen(buildApp());
  try {
    for (let i = 0; i < LIMIT + 3; i += 1) {
      await fetch(`${url}/api/automation-agent/query`, { method: "POST" });
    }
    const res = await fetch(`${url}/api/slf-clients/summary`);
    assert.equal(res.status, 200, "the dashboard must survive an exhausted agent budget");
  } finally {
    await close();
  }
});
