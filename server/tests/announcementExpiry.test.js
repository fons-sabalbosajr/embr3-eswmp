/**
 * An expired portal announcement must not show on the SLF Portal login page.
 *
 * Production (2026-11-10): the active announcement ended 2026-08-23, but the
 * flat portalAnnouncement* copy the login page reads had lost its dates — the
 * Developer Settings save sent `portalAnnouncementStartAt/EndAt: null` on every
 * save — so the login page read it as open-ended and kept showing it.
 *
 * Source-level checks (the route needs a database); run:
 *   node --test tests/announcementExpiry.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const settingsRoute = fs.readFileSync(path.join(__dirname, "../routes/settings.js"), "utf8");
const devSettings = fs.readFileSync(path.join(__dirname, "../../front-end/src/pages/admin/DeveloperSettings.jsx"), "utf8");
const portalLogin = fs.readFileSync(path.join(__dirname, "../../front-end/src/pages/PortalLogin.jsx"), "utf8");

test("PUT /settings/app ignores the derived announcement fields", () => {
  assert.match(settingsRoute, /DERIVED_ANNOUNCEMENT_KEYS\.forEach\(\(k\) => \{ delete body\[k\]; \}\)/);
  assert.match(settingsRoute, /"portalAnnouncementEndAt"/);
});

test("reads and writes re-derive the flat copy from the active item", () => {
  const reconciles = settingsRoute.match(/reconcileActiveAnnouncement\(settings\);/g) || [];
  assert.ok(reconciles.length >= 2, "GET and PUT /app both reconcile");
  assert.match(settingsRoute, /out\.portalAnnouncementLive = isAnnouncementLive\(out\)/);
});

test("Developer Settings no longer sends announcement fields", () => {
  assert.doesNotMatch(devSettings, /portalAnnouncementEndAt:\s*\n?\s*values\.portalAnnouncementEndAt/);
  assert.match(devSettings, /k\.startsWith\("portalAnnouncement"\)/);
});

test("the login page honours the server's live flag", () => {
  assert.match(portalLogin, /data\.portalAnnouncementLive !== false/);
});

test("isAnnouncementLive: an ended window is not live", () => {
  // Pull the function out of the route source and evaluate it standalone.
  const src = settingsRoute.match(/function isAnnouncementLive[\s\S]*?\n\}/)[0];
  // eslint-disable-next-line no-new-func
  const isLive = new Function(`${src}; return isAnnouncementLive;`)();
  const now = new Date("2026-11-10T00:00:00Z").getTime();
  const base = { portalAnnouncementEnabled: true, portalAnnouncementStartAt: "2026-08-20T03:00:00Z" };
  assert.equal(isLive({ ...base, portalAnnouncementEndAt: "2026-08-23T15:00:00Z" }, now), false);
  assert.equal(isLive({ ...base, portalAnnouncementEndAt: "2026-12-01T00:00:00Z" }, now), true);
  assert.equal(isLive({ ...base, portalAnnouncementEnabled: false }, now), false);
});
