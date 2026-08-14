/**
 * Dummy Submissions tab — classification, scoping and authorization; and the
 * demo session's privacy masking honouring the global toggle.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const mongoose = require("mongoose");

require("../models/AppSettings");
const {
  devWantsDummy,
  devWantsDummyOnly,
  rejectUnauthorizedDummyAccess,
} = require("../routes/dataSLF");
const {
  MASK,
  maskConfidentialValues,
  isGlobalPrivacyMaskingOn,
  resetPrivacyToggleCache,
} = require("../utils/demoMode");

const reqOf = (role, query = {}, extra = {}) => ({
  query,
  user: role ? { role, email: `${role}@x`, ...extra } : undefined,
});
const resStub = () => {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

// ── Authorization ───────────────────────────────────────────────────────────
test("only a developer may scope the submissions list to dummy data", () => {
  assert.equal(devWantsDummyOnly(reqOf("developer", { dummyOnly: "true" })), true);
  assert.equal(devWantsDummyOnly(reqOf("admin", { dummyOnly: "true" })), false);
  assert.equal(devWantsDummyOnly(reqOf(null, { dummyOnly: "true" })), false);
  assert.equal(devWantsDummyOnly(reqOf("developer", {})), false);
  assert.equal(devWantsDummy(reqOf("admin", { includeDummy: "true" })), false);
});

test("the API refuses a dummy-data request from a non-developer (not just hides the tab)", () => {
  for (const role of ["admin", "user", null]) {
    for (const query of [{ dummyOnly: "true" }, { includeDummy: "true" }]) {
      const res = resStub();
      const rejected = rejectUnauthorizedDummyAccess(reqOf(role, query), res);
      assert.equal(rejected, true, `${role}/${JSON.stringify(query)} must be rejected`);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.code, "DUMMY_ACCESS_DENIED");
    }
  }
});

test("a DEMO admin may see the Dummy tab — its contents are synthetic by construction", () => {
  const demoAdmin = reqOf("admin", { dummyOnly: "true" }, { isDemo: true });
  assert.equal(devWantsDummyOnly(demoAdmin), true);
  const res = resStub();
  assert.equal(rejectUnauthorizedDummyAccess(demoAdmin, res), false);
  assert.equal(res.statusCode, null);
  // A NON-demo admin is still refused.
  const plainAdmin = reqOf("admin", { dummyOnly: "true" });
  assert.equal(devWantsDummyOnly(plainAdmin), false);
  assert.equal(rejectUnauthorizedDummyAccess(plainAdmin, resStub()), true);
});

test("a developer, and any caller not asking for dummy data, passes through", () => {
  const devRes = resStub();
  assert.equal(rejectUnauthorizedDummyAccess(reqOf("developer", { dummyOnly: "true" }), devRes), false);
  assert.equal(devRes.statusCode, null);
  const adminRes = resStub();
  assert.equal(rejectUnauthorizedDummyAccess(reqOf("admin", { status: "pending" }), adminRes), false);
  assert.equal(adminRes.statusCode, null);
});

// ── Scoping: the two lists are mutually exclusive ───────────────────────────
test("actual and dummy submission scopes never overlap", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "dataSLF.js"), "utf8");
  const list = source.slice(
    source.indexOf('router.get("/", optionalAuth'),
    source.indexOf('router.get("/detail/:id"'),
  );
  assert.match(list, /if \(rejectUnauthorizedDummyAccess\(req, res\)\) return;/);
  assert.match(list, /if \(devWantsDummyOnly\(req\)\) \{\s*\n\s*filter\.isDummy = true;/);
  assert.match(list, /\} else if \(!devWantsDummy\(req\)\) \{\s*\n\s*filter\.isDummy = \{ \$ne: true \};/);
});

test("the admin UI sends dummyOnly only on the Dummy tab, and the export follows it", () => {
  const ui = fs.readFileSync(
    path.join(__dirname, "..", "..", "front-end", "src", "pages", "admin", "SubmissionSettings.jsx"),
    "utf8",
  );
  assert.match(ui, /const canSeeDummyTab = isDeveloper \|\| canManageTestData\(currentUser\)/);
  assert.match(ui, /const dummyScope = canSeeDummyTab && submissionScope === "dummy"/);
  assert.match(ui, /dummyScope \? \{ dummyOnly: "true" \} : \{\}/);
  // The old inline mixing must be gone from both the list and the export.
  assert.doesNotMatch(ui, /includeDummy: "true"/);
  assert.equal((ui.match(/\.\.\.scopeParams,/g) || []).length, 2, "list fetch + export");
});

// ── Global privacy toggle drives demo masking ───────────────────────────────
const withAppSettings = async (value, run) => {
  const AppSettings = mongoose.model("AppSettings");
  const original = AppSettings.findOne;
  AppSettings.findOne = () => ({
    select: () => ({ lean: async () => (value === undefined ? null : { maskSensitiveSlfValues: value }) }),
  });
  resetPrivacyToggleCache();
  try {
    return await run();
  } finally {
    AppSettings.findOne = original;
    resetPrivacyToggleCache();
  }
};

test("privacy toggle OFF → demo sessions are not masked", async () => {
  const on = await withAppSettings(false, () => isGlobalPrivacyMaskingOn());
  assert.equal(on, false, "masking must follow the documented global switch");
});

test("privacy toggle ON → demo sessions are masked", async () => {
  const on = await withAppSettings(true, () => isGlobalPrivacyMaskingOn());
  assert.equal(on, true);
});

test("no settings row yet → the default (off) applies", async () => {
  assert.equal(await withAppSettings(undefined, () => isGlobalPrivacyMaskingOn()), false);
});

test("a settings read failure fails CLOSED", async () => {
  const AppSettings = mongoose.model("AppSettings");
  const original = AppSettings.findOne;
  AppSettings.findOne = () => { throw new Error("db down"); };
  resetPrivacyToggleCache();
  try {
    assert.equal(await isGlobalPrivacyMaskingOn(), true, "an outage must never silently disable masking");
  } finally {
    AppSettings.findOne = original;
    resetPrivacyToggleCache();
  }
});

test("with masking ON, production figures are still hidden and demo-owned data still readable", () => {
  const masked = maskConfidentialValues([
    { slfName: "Real SLF", totalVolumeAccepted: 900 },
    { slfName: "Demonstration Valley", isDummy: true, totalVolumeAccepted: 1500 },
  ]);
  assert.equal(masked[0].totalVolumeAccepted, MASK);
  assert.equal(masked[1].totalVolumeAccepted, 1500);
});

test("the write guard is NOT gated on the privacy toggle", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "utils", "demoMode.js"), "utf8");
  const middleware = source.slice(source.indexOf("function demoMaskingMiddleware"));
  // Only res.json is wrapped conditionally; demoContext.run always executes.
  assert.match(middleware, /if \(maskingOn\) \{[\s\S]*?res\.json = \(body\)/);
  assert.match(middleware, /\.catch\(\(\) => demoContext\.run\(\{ isDemo: true \}, next\)\)/);
});

test("changing the toggle drops the cached copy", () => {
  const settings = fs.readFileSync(path.join(__dirname, "..", "routes", "settings.js"), "utf8");
  assert.match(settings, /require\("\.\.\/utils\/demoMode"\)\.resetPrivacyToggleCache\(\)/);
});
