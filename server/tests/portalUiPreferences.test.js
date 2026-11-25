/**
 * "Dismiss" on the portal must mean dismissed — for the tour AND the banner.
 *
 * THE DEFECTS THIS PINS.
 *   • The What's New tour recorded its dismissal in localStorage under
 *     `slf-portal-tour-dismissed-<email>`. Portal logout calls
 *     secureStorage.clearAll() → localStorage.clear(), so the preference was
 *     erased on the way out and the tour greeted the user again on the very next
 *     sign-in, however many times they had closed it.
 *   • The announcement banner's Dismiss was React state only, so it came back on
 *     every reload — and on every navigation that remounted the portal.
 *
 * The identical defect had already been found and fixed for the VERA
 * introduction by moving the flag server-side (UserPortal.veraOnboardingDismissedAt).
 *
 * THE PROPERTY THAT MATTERS MOST is not that dismissal sticks — it is that the
 * announcement one sticks *per announcement*. A global "dismissed" boolean would
 * be a regression dressed as a fix: the banner is how portal users are told about
 * maintenance windows and rollouts, so muting it forever is worse than showing it
 * twice. `a newly published announcement is shown even to a user who dismissed
 * the last one` is the test guarding that.
 *
 * Run: npm test  (from server/)
 */
const test = require("node:test");
const { portalJsxSource } = require("./helpers/portalSource");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const path = require("node:path");
const fs = require("node:fs");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
mongoose.set("bufferCommands", false);

const UserPortal = require("../models/UserPortal");
const AppLog = require("../models/AppLog");

const PORTAL_USER_ID = new mongoose.Types.ObjectId();
const EMAIL = "operator@example.com";

// Stands in for the persisted row.
let stored;
let updateCalls;

const chain = (value) => {
  const c = {
    select: () => c, sort: () => c, setOptions: () => c, populate: () => c, lean: () => c,
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (fn) => Promise.resolve(value).catch(fn),
  };
  return c;
};

const portalUserDoc = () => ({
  _id: PORTAL_USER_ID,
  email: EMAIL,
  firstName: "Ana",
  status: "active",
  isVerified: true,
  blocked: false,
  ...stored,
});

let server; let baseUrl;

test.before(async () => {
  AppLog.create = async () => ({});

  UserPortal.findById = () => chain(portalUserDoc());
  UserPortal.findOne = () => chain(portalUserDoc());
  UserPortal.findByIdAndUpdate = (id, update) => {
    updateCalls.push({ id: String(id), update });
    stored = { ...stored, ...update };
    return chain({ _id: id, ...stored });
  };

  const app = express();
  app.use(express.json());
  app.use("/api/portal-auth", require("../routes/portalAuth"));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => { if (server) await new Promise((r) => server.close(r)); });
test.beforeEach(() => {
  stored = {
    portalTourDismissedAt: null,
    portalAnnouncementDismissedVersion: null,
    portalAnnouncementDismissedAt: null,
  };
  updateCalls = [];
});

const portalToken = () =>
  jwt.sign({ id: String(PORTAL_USER_ID), email: EMAIL, role: "portal_user" }, process.env.JWT_SECRET);

// A developer inspecting this portal account — Developer Portal Mode is read-only.
const developerToken = jwt.sign(
  {
    id: String(new mongoose.Types.ObjectId()),
    email: "dev@emb.gov.ph",
    role: "developer",
    isDeveloper: true,
    portalContextUserId: String(PORTAL_USER_ID),
  },
  process.env.JWT_SECRET,
);

const call = async (method, token, body) => {
  const res = await fetch(`${baseUrl}/api/portal-auth/ui-preferences`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ── The tour ────────────────────────────────────────────────────────────────
test("a tour dismissal is persisted server-side, so logout cannot erase it", async () => {
  assert.equal((await call("GET", portalToken())).body.tourDismissed, false);

  const saved = await call("PATCH", portalToken(), { tourDismissed: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.tourDismissed, true);
  assert.ok(
    updateCalls[0].update.portalTourDismissedAt instanceof Date,
    "stamped with when the choice was made",
  );

  // A fresh sign-in is just another GET with a new token.
  assert.equal((await call("GET", portalToken())).body.tourDismissed, true);
});

// ── The announcement ────────────────────────────────────────────────────────
test("an announcement dismissal is persisted against its version", async () => {
  const saved = await call("PATCH", portalToken(), { announcementDismissedVersion: "2026-08-17T02:00:00.000Z" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.announcementDismissedVersion, "2026-08-17T02:00:00.000Z");
  assert.ok(saved.body.announcementDismissedAt, "and when");

  // Survives the reload that used to bring it straight back.
  assert.equal(
    (await call("GET", portalToken())).body.announcementDismissedVersion,
    "2026-08-17T02:00:00.000Z",
  );
});

test("a newly published announcement is shown even to a user who dismissed the last one", async () => {
  await call("PATCH", portalToken(), { announcementDismissedVersion: "v1-maintenance" });
  const { body } = await call("GET", portalToken());

  // The server reports WHICH announcement was dismissed; the portal compares it
  // against the current one. A boolean here would silently mute every future
  // notice — the failure mode this design exists to prevent.
  assert.equal(body.announcementDismissedVersion, "v1-maintenance");
  assert.notEqual(body.announcementDismissedVersion, "v2-rollout", "a new version is NOT covered");
  assert.equal(
    Object.hasOwn(body, "announcementDismissed"),
    false,
    "there must be no global dismissed flag to accidentally read instead",
  );
});

test("clearing the announcement preference makes it visible again", async () => {
  await call("PATCH", portalToken(), { announcementDismissedVersion: "v1" });
  const cleared = await call("PATCH", portalToken(), { announcementDismissedVersion: "" });
  assert.equal(cleared.body.announcementDismissedVersion, null);
  assert.equal(updateCalls.at(-1).update.portalAnnouncementDismissedAt, null, "cleared, not left stale");
});

// ── The two must not interfere ──────────────────────────────────────────────
test("dismissing one preference never clears the other", async () => {
  await call("PATCH", portalToken(), { tourDismissed: true });
  await call("PATCH", portalToken(), { announcementDismissedVersion: "v9" });

  const both = await call("GET", portalToken());
  assert.equal(both.body.tourDismissed, true, "the tour dismissal survived the announcement write");
  assert.equal(both.body.announcementDismissedVersion, "v9");

  // Only the key that was sent is written — an absent key is left alone.
  assert.deepEqual(
    Object.keys(updateCalls[1].update).sort(),
    ["portalAnnouncementDismissedAt", "portalAnnouncementDismissedVersion"],
    "the announcement write must not touch the tour field",
  );
});

test("a request carrying no preference is refused rather than writing nothing", async () => {
  const res = await call("PATCH", portalToken(), { somethingElse: true });
  assert.equal(res.status, 400);
  assert.equal(updateCalls.length, 0);
});

// ── Access control ──────────────────────────────────────────────────────────
test("an unauthenticated caller cannot read or write preferences", async () => {
  assert.equal((await call("PATCH", null, { tourDismissed: true })).status >= 400, true);
  assert.equal(updateCalls.length, 0, "nothing was written");
});

test("Developer Portal Mode cannot consume the user's tour or announcement", async () => {
  // Developer Portal Mode otherwise has FULL CONTROL of the portal side now — it
  // submits, saves baselines and deletes on the operator's behalf. This stays
  // refused because it is not an action a developer takes, it is a side effect of
  // LOOKING: inspecting an account would burn that operator's one-time tour and
  // their unread announcement, and neither can be shown again.
  for (const body of [{ tourDismissed: true }, { announcementDismissedVersion: "v1" }]) {
    const res = await call("PATCH", developerToken, body);
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.match(res.body.message, /one-time notice/i);
  }
  assert.equal(updateCalls.length, 0, "the portal user's preferences are untouched");
});

// ── "Don't show this again" is permanent, not per-release ───────────────────

test("the feature-tour opt-out is stored apart from the release marker", async () => {
  // They are different promises. The version marker means "this release has been
  // seen", which is right for finishing or closing the tour — the next release is
  // new information and should be offered once. The BUTTON says never, and
  // serving both from one field made its label untrue: two live accounts were
  // shown the tour again after clicking it, their marker having moved from
  // 2026-08-20-hauler-bulk-clients to 2026-08-25-uploads-baseline-completeness.
  updateCalls.length = 0;
  const res = await call("PATCH", portalToken(), { featureTourOptOut: true });
  assert.equal(res.status, 200);
  const { update } = updateCalls.at(-1);
  assert.ok(update.portalFeatureTourOptOutAt instanceof Date, "the opt-out is its own field");
  assert.equal(
    Object.hasOwn(update, "portalFeatureTourVersionSeen"),
    false,
    "…and does not quietly rewrite the release marker on its own",
  );
});

test("the opt-out is reversible", async () => {
  // What's New can put a user back on the tour; an opt-out must not be a one-way
  // door.
  updateCalls.length = 0;
  const res = await call("PATCH", portalToken(), { featureTourOptOut: false });
  assert.equal(res.status, 200);
  assert.equal(updateCalls.at(-1).update.portalFeatureTourOptOutAt, null);
});

test("the read reports the opt-out so the client can honour it before it flashes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "routes", "portalAuth.js"),
    "utf8",
  );
  assert.match(source, /featureTourOptOut: !!doc\?\.portalFeatureTourOptOutAt/);
  assert.match(source, /portalFeatureTourOptOutAt/, "…and is selected by the read");
  // The field must exist on the model, or findByIdAndUpdate silently drops it in
  // strict mode and the preference never persists at all.
  assert.match(
    fs.readFileSync(path.join(__dirname, "..", "models", "UserPortal.js"), "utf8"),
    /portalFeatureTourOptOutAt: \{ type: Date, default: null \}/,
  );
});

// ── Never break the portal over a preference ────────────────────────────────
test("an unreadable preference reports 'nothing dismissed' rather than failing", async () => {
  const previous = UserPortal.findById;
  UserPortal.findById = () => { throw new Error("mongo down"); };
  try {
    const res = await call("GET", portalToken());
    assert.equal(res.status, 200, "a preference read must never break portal load");
    assert.equal(res.body.tourDismissed, false);
    assert.equal(res.body.announcementDismissedVersion, null, "showing them is the safe default");
    assert.equal(res.body.unavailable, true, "…and the client is told the answer is degraded");
  } finally {
    UserPortal.findById = previous;
  }
});

// ── The browser half ────────────────────────────────────────────────────────
const portalSource = () =>
  portalJsxSource();

test("every exit from the tour records the dismissal the same way", () => {
  const source = portalSource();
  // Closing (X / Esc / mask) and finishing mean the same thing to the user, so
  // both go through ONE helper — the two used to carry duplicated inline logic,
  // which is how they drifted into writing localStorage only.
  assert.match(source, /onClose=\{dismissTourPermanently\}/);
  assert.match(source, /onFinish=\{dismissTourPermanently\}/);
  const helper = source.slice(
    source.indexOf("const dismissTourPermanently"),
    source.indexOf("const dismissTourPermanently") + 1000,
  );
  assert.match(
    helper,
    /api\.patch\("\/portal-auth\/ui-preferences", \{ tourDismissed: true \}\)/,
    "the dismissal must reach the server, not just localStorage",
  );
  assert.match(helper, /secureStorage\.set/, "the local mirror is still written for instant effect");
});

test("the banner hides only for the announcement that was actually dismissed", () => {
  const source = portalSource();
  // The comparison IS the safety property — a bare boolean here would mute every
  // future announcement.
  assert.match(
    source,
    /announcementDismissedVersion === portalAnnouncementVersion/,
    "the banner compares versions, never a global flag",
  );
  const helper = source.slice(
    source.indexOf("const dismissAnnouncement"),
    source.indexOf("const dismissAnnouncement") + 800,
  );
  assert.match(helper, /announcementDismissedVersion: portalAnnouncementVersion/, "persists the version");
  // `api` and `.patch` may sit on separate lines once the call is formatted.
  assert.match(helper, /api\s*\.patch\(\s*"\/portal-auth\/ui-preferences"/, "and persists it server-side");
});

test("an admin can still publish an announcement nobody can dismiss", () => {
  const source = portalSource();
  // portalAnnouncementDismissible is an existing admin control; persisting the
  // dismissal must not have quietly made every banner dismissible.
  assert.match(
    source,
    /portalAnnouncement\.portalAnnouncementDismissible !== false \? \(/,
    "the Dismiss button is still gated on the admin's setting",
  );
});

test("the auto-open honours the preference but the button still works", () => {
  const source = portalSource();
  // A dismissal that also disabled "What's New Tour" would leave the user with no
  // way back in, so only the AUTOMATIC opening is suppressed.
  assert.match(source, /openPortalUpdateTour\(\{ manual: false \}\)/, "the auto-open declares itself");
  assert.match(source, /if \(!manual && \(tourDismissed \|\|/, "the preference gates the automatic path only");
  assert.match(source, /onClick=\{\(\) => openPortalUpdateTour\(\)\}/, "the button opens it unconditionally");
});

test("the tour running does not discard the user's banner dismissal", () => {
  const source = portalSource();
  // The tour's first step points at the banner, so it must be on screen — but
  // revealing it is temporary, not an undo of the user's choice.
  assert.match(source, /setAnnouncementRevealed\(true\)/, "the tour reveals the banner");
  assert.match(source, /!announcementRevealed &&/, "…as an override, not by clearing the dismissal");
  const helper = source.slice(
    source.indexOf("const dismissTourPermanently"),
    source.indexOf("const dismissTourPermanently") + 1000,
  );
  assert.match(helper, /setAnnouncementRevealed\(false\)/, "and hands the banner back when it ends");
});

test("neither the tour nor the banner can flash before preferences are read", () => {
  const source = portalSource();
  assert.match(
    source,
    /portalAnnouncement && uiPrefsLoaded && !announcementDismissed/,
    "the banner waits for the preference rather than rendering and being yanked away",
  );
  const effect = source.slice(
    source.indexOf("if (!portalAnnouncement || !portalUser) return;"),
    source.indexOf("if (!portalAnnouncement || !portalUser) return;") + 700,
  );
  const guardAt = effect.indexOf("if (!uiPrefsLoaded) return;");
  const seenMarkerAt = effect.indexOf("sessionSet(key");
  assert.ok(guardAt > -1, "the effect waits for the preferences");
  assert.ok(
    guardAt < seenMarkerAt,
    "the wait must come BEFORE the announcement is marked seen, or a slow read swallows it",
  );
});
