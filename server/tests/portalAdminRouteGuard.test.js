/**
 * Portal tokens cannot reach admin actions on /api/data-slf, and portal reads
 * are scoped to the caller's assigned SLF.
 *
 * The router is guarded by `requireAnyAuth`, which admits BOTH realms (they share
 * JWT_SECRET). Admin actions with no role check of their own were therefore
 * callable with a portal token: approving your own baseline unlock, changing a
 * submission's status, reverting/deleting any record, emptying the trash, reading
 * every SLF's baselines. These run the real router over HTTP; a refused request
 * is answered by the guard before any database work.
 *
 * Run: node --test tests/portalAdminRouteGuard.test.js
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
const UserPortal = require("../models/UserPortal");

const PORTAL_ID = new mongoose.Types.ObjectId();
const ASSIGNED_SLF_ID = String(new mongoose.Types.ObjectId());
const OTHER_SLF_ID = String(new mongoose.Types.ObjectId());
const ASSIGNED_NAME = "Bataan - LGU Balanga Sanitary Landfill Facility (LGU)";

const portalToken = jwt.sign(
  { id: String(PORTAL_ID), role: "portal_user", email: "operator@example.com" },
  process.env.JWT_SECRET,
);
// A dev-portal "stage" token carries no role; it must not pass as staff either.
const stageToken = jwt.sign({ stage: "devOverride", devId: "x" }, process.env.JWT_SECRET);

let server;
let baseUrl;
const denials = [];

test.before(async () => {
  AppLog.create = async (doc) => { denials.push(doc); return {}; };
  UserPortal.findById = () => ({
    select() { return this; },
    lean: async () => ({
      _id: PORTAL_ID,
      email: "operator@example.com",
      assignedSlf: [ASSIGNED_SLF_ID],
      assignedSlfName: [ASSIGNED_NAME],
    }),
  });
  const app = express();
  app.use(express.json());
  app.use("/api/data-slf", require("../routes/dataSLF"));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function call(method, path, bearer, body) {
  const res = await fetch(`${baseUrl}/api/data-slf${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const id = String(new mongoose.Types.ObjectId());
const ADMIN_ACTIONS = [
  ["PATCH", "/baseline-update-approve/Some%20SLF"],
  ["PATCH", "/baseline-update-lock/Some%20SLF"],
  ["PATCH", "/baseline-update-reject/Some%20SLF"],
  ["PUT", `/baselines/${id}`],
  ["DELETE", `/baselines/${id}`],
  ["GET", "/baselines"],
  ["PATCH", `/${id}/status`],
  ["PATCH", "/bulk-status"],
  ["POST", "/bulk-delete"],
  ["PATCH", "/bulk-revert"],
  ["DELETE", `/${id}`],
  ["DELETE", `/${id}/permanent`],
  ["PATCH", `/${id}/restore`],
  ["GET", "/trash/list"],
  ["PATCH", `/${id}/admin-edit`],
  ["PATCH", `/${id}/admin-revert`],
  ["PATCH", `/${id}/approve-revert`],
  ["PATCH", `/${id}/approve-edit`],
  ["PATCH", `/${id}/reject-edit`],
  ["PATCH", `/${id}/cell-assignments`],
  ["POST", "/cell-capacity-alert"],
  ["POST", `/${id}/send-email`],
  ["GET", "/"],
  ["GET", `/detail/${id}`],
  ["GET", "/summary-dashboard"],
  ["GET", "/stats"],
];

test("a portal token is refused on every admin action", async () => {
  for (const [method, path] of ADMIN_ACTIONS) {
    const { status } = await call(method, path, portalToken, method === "GET" ? undefined : {});
    assert.equal(status, 403, `${method} ${path} must refuse a portal token`);
  }
  assert.ok(denials.some((d) => d.action === "access.denied.staff"), "denials are logged for the admin");
});

test("a role-less token is refused as well", async () => {
  assert.equal((await call("PATCH", "/bulk-status", stageToken, {})).status, 403);
});

test("a portal user cannot read another SLF's baseline or waste summary", async () => {
  const other = await call("GET", `/baseline/Other%20SLF?slfId=${OTHER_SLF_ID}`, portalToken);
  assert.equal(other.status, 403);
  // Own id with somebody else's name is refused too — the summary reads both.
  const mixed = await call("GET", `/waste-received-summary/Other%20SLF?slfId=${ASSIGNED_SLF_ID}`, portalToken);
  assert.equal(mixed.status, 403);
  const otherId = await call("GET", `/waste-received-summary/${encodeURIComponent(ASSIGNED_NAME)}?slfId=${OTHER_SLF_ID}`, portalToken);
  assert.equal(otherId.status, 403);
});

test("the portal's own SLF passes the scope check", async () => {
  // Past the guard the handler needs a database; anything but 401/403 proves the
  // request was let through.
  const own = await call("GET", `/baseline/${encodeURIComponent(ASSIGNED_NAME)}?slfId=${ASSIGNED_SLF_ID}`, portalToken);
  assert.notEqual(own.status, 403);
  assert.notEqual(own.status, 401);
});
