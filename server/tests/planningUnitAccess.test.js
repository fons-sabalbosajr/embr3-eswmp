/**
 * Planning Unit access is VIEW-ONLY and stops when its access does.
 *
 * The Planning Unit signs in to the SLF Portal with a username + password + PIN
 * (routes/planningUnit.js) and gets a `role: "planning_unit"` token bound to one
 * portal account. middleware/planningUnitGuard.js is the lock: it must let reads
 * through, refuse every write, and refuse everything once the access is switched
 * off, past its valid-until date, or its sessions were ended. utils/portalContext
 * must resolve the token to the chosen account and mark it read-only.
 *
 * Run: node --test tests/planningUnitAccess.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const AppLog = require("../models/AppLog");
const PlanningUnitAccess = require("../models/PlanningUnitAccess");
const UserPortal = require("../models/UserPortal");
const { planningUnitGuard, accessState, invalidatePlanningUnitCache } = require("../middleware/planningUnitGuard");
const { resolvePortalContext, assertPortalWriteAllowed } = require("../utils/portalContext");

const TARGET_ID = new mongoose.Types.ObjectId();
let accessDoc;
const liveAccess = () => ({
  enabled: true,
  username: "planningunit",
  passwordHash: "x",
  pinHash: "y",
  validUntil: new Date(Date.now() + 86400000),
  sessionVersion: 3,
});
const puToken = (over = {}) => jwt.sign(
  { id: "planning-unit", role: "planning_unit", email: "planning-unit:planningunit", portalContextUserId: String(TARGET_ID), readOnly: true, puv: 3, ...over },
  process.env.JWT_SECRET,
);
const portalToken = jwt.sign({ id: String(new mongoose.Types.ObjectId()), role: "portal_user" }, process.env.JWT_SECRET);

let server;
let baseUrl;

test.before(async () => {
  AppLog.create = async () => ({});
  PlanningUnitAccess.findOne = () => ({ lean: async () => accessDoc });
  const app = express();
  app.use(express.json());
  app.use("/api", planningUnitGuard);
  app.all("/api/*splat", (req, res) => res.json({ reached: true, method: req.method }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(() => { accessDoc = liveAccess(); invalidatePlanningUnitCache(); });

const call = async (method, path, token) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === "GET" ? undefined : "{}",
  });
  return { status: res.status, body: await res.json() };
};

test("reads pass", async () => {
  const r = await call("GET", "/api/portal-auth/my-submissions", puToken());
  assert.equal(r.status, 200);
  assert.equal(r.body.reached, true);
});

test("every write is refused as view-only", async () => {
  for (const [method, path] of [
    ["POST", "/api/data-slf"],
    ["PATCH", "/api/data-slf/portal-save-baseline"],
    ["PUT", "/api/portal-queue/abc"],
    ["DELETE", "/api/portal-queue/abc"],
    ["POST", "/api/support-tickets"],
  ]) {
    const r = await call(method, path, puToken());
    assert.equal(r.status, 403, `${method} ${path}`);
    assert.equal(r.body.code, "PLANNING_UNIT_READ_ONLY");
  }
});

test("the error-report endpoint stays open so failures can still be logged", async () => {
  const r = await call("POST", "/api/logs/client-error", puToken());
  assert.equal(r.status, 200);
});

test("switched off, expired or revoked: the session ends (401)", async () => {
  accessDoc = { ...liveAccess(), enabled: false };
  assert.equal((await call("GET", "/api/portal-auth/me", puToken())).status, 401);

  accessDoc = { ...liveAccess(), validUntil: new Date(Date.now() - 1000) };
  invalidatePlanningUnitCache();
  const expired = await call("GET", "/api/portal-auth/me", puToken());
  assert.equal(expired.status, 401);
  assert.equal(expired.body.code, "PLANNING_UNIT_SESSION_ENDED");

  // "Sign out all sessions" bumped the version after this token was issued.
  accessDoc = { ...liveAccess(), sessionVersion: 4 };
  invalidatePlanningUnitCache();
  assert.equal((await call("GET", "/api/portal-auth/me", puToken())).status, 401);
});

test("other roles are untouched by the guard", async () => {
  const r = await call("POST", "/api/data-slf", portalToken);
  assert.equal(r.status, 200);
  assert.equal((await call("POST", "/api/anything")).status, 200);
});

test("accessState: default validity is the end of Dec 31, 2026 (Manila)", () => {
  const doc = new PlanningUnitAccess({});
  assert.equal(doc.validUntil.toISOString(), "2026-12-31T15:59:59.000Z");
  assert.equal(accessState({ ...liveAccess(), validUntil: doc.validUntil }, new Date("2026-12-31T15:00:00Z")).ok, true);
  assert.equal(accessState({ ...liveAccess(), validUntil: doc.validUntil }, new Date("2027-01-01T00:00:00+08:00")).reason, "expired");
  assert.equal(accessState({ ...liveAccess(), pinHash: "" }).reason, "not-configured");
});

test("portal context: resolves to the chosen account, read-only; writes refused", async () => {
  const target = { _id: TARGET_ID, email: "operator@example.com", status: "approved", isDummy: false, blocked: false };
  UserPortal.findById = () => ({ select: async () => target });
  const req = { headers: { authorization: `Bearer ${puToken()}` }, ip: "127.0.0.1", originalUrl: "/api/x" };
  const ctx = await resolvePortalContext(req);
  assert.equal(ctx.email, "operator@example.com");
  assert.equal(ctx.readOnly, true);
  assert.equal(ctx.isPlanningUnit, true);
  assert.throws(() => assertPortalWriteAllowed(ctx, req), /view-only/);

  // Never a pending / test / blocked account.
  UserPortal.findById = () => ({ select: async () => ({ ...target, isDummy: true }) });
  await assert.rejects(resolvePortalContext(req), /not available/);
});
