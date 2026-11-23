/**
 * The one-time feature tour, and VERA's ability to give the same walkthrough.
 *
 * WHY THIS EXISTS. Two things can silently break this feature, and neither
 * shows a symptom:
 *
 *   1. The dismissal. The portal's ORIGINAL tour records a single boolean, so
 *      reusing it would hide a workflow change from every user who ever
 *      dismissed the orientation — the people most likely to need telling. The
 *      marker has to be a release VERSION, and these tests pin that.
 *
 *   2. VERA's half. The tour offers "Ask VERA about this" on every step. If the
 *      knowledge base does not actually carry the new workflow, VERA answers
 *      confidently from the OLD entries and describes a process that no longer
 *      exists. So every question the tour can send is run through VERA's real
 *      retrieval and checked to land on the new material.
 *
 * Run: npm test  (from front-end/)
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import {
  PORTAL_FEATURE_TOUR_VERSION,
  PORTAL_FEATURE_TOUR_STEPS,
  PORTAL_FEATURE_TOUR_VERA_PROMPT,
} from "../portalFeatureTour.js";
import { PORTAL_FEATURE_TOUR_SEEN_PREFIX } from "../constants.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, "..", "..", "..", "..", "..", "server");
const require = createRequire(pathToFileURL(path.join(serverRoot, "package.json")));

const vera = require("./utils/veraAssistant.js");
const veraKnowledge = require("./utils/veraKnowledge.js");

// ── The tour content ────────────────────────────────────────────────────────
test("every step is complete and carries a question VERA can be asked", () => {
  assert.ok(PORTAL_FEATURE_TOUR_STEPS.length >= 3, "a tour of one step is a popup");
  const keys = new Set();
  for (const step of PORTAL_FEATURE_TOUR_STEPS) {
    assert.ok(step.key, "each step needs a key to resolve its target");
    assert.equal(keys.has(step.key), false, `duplicate step key: ${step.key}`);
    keys.add(step.key);
    assert.ok(step.title?.length > 8, `${step.key} needs a real title`);
    assert.ok(step.description?.length > 40, `${step.key} needs a real description`);
    assert.ok(step.ask?.endsWith("?"), `${step.key}'s Ask VERA text must be a question`);
  }
});

test("the version is a marker that can be compared, not a boolean", () => {
  assert.equal(typeof PORTAL_FEATURE_TOUR_VERSION, "string");
  assert.ok(PORTAL_FEATURE_TOUR_VERSION.length >= 8);
  // The server caps it at 80 chars on write; a longer value would be truncated
  // and then never match, so the tour would reappear forever.
  assert.ok(PORTAL_FEATURE_TOUR_VERSION.length <= 80);
  assert.notEqual(PORTAL_FEATURE_TOUR_VERSION, "1", "a boolean-ish marker defeats the point");
});

// ── VERA's half of the walkthrough ──────────────────────────────────────────
// The entries THIS release's tour must be able to reach. Update this set when
// PORTAL_FEATURE_TOUR_VERSION is bumped — that is the point of the test: a tour
// step whose question lands on the previous release's material walks the user
// through a workflow that no longer exists.
const NEW_ENTRY_IDS = new Set([
  "transport-entry-steps",
  "correction-draft",
  "drafts-resubmit",
  "submission-details-report",
  "submission-breakdown",
]);

test("VERA's knowledge base actually carries the new workflow", () => {
  const ids = new Set(veraKnowledge.KNOWLEDGE_BASE.map((entry) => entry.id));
  for (const id of NEW_ENTRY_IDS) {
    assert.ok(ids.has(id), `knowledge entry "${id}" is missing — VERA cannot explain it`);
  }
});

// `retrieve` returns scored wrappers: [{ entry, score }].
const idsFor = (question, limit = 3) =>
  vera.retrieve(question, veraKnowledge.KNOWLEDGE_BASE, limit).map((hit) => hit.entry.id);

test("every step's Ask VERA question retrieves the RIGHT new entry", () => {
  // Retrieval, not just presence: an entry nothing can reach is an entry VERA
  // never uses, and the tour would hand the user a generic answer instead.
  for (const step of PORTAL_FEATURE_TOUR_STEPS) {
    const ids = idsFor(step.ask);
    assert.ok(ids.length > 0, `"${step.ask}" retrieved nothing`);
    assert.ok(
      ids.some((id) => NEW_ENTRY_IDS.has(id)),
      `"${step.ask}" must reach the new material, got: ${ids.join(", ")}`,
    );
  }
});

test("the tour's overall VERA prompt reaches the what's-new entry", () => {
  const ids = idsFor(PORTAL_FEATURE_TOUR_VERA_PROMPT, 5);
  assert.ok(
    ids.some((id) => NEW_ENTRY_IDS.has(id)),
    `the walkthrough prompt must reach the new material, got: ${ids.join(", ")}`,
  );
});

test("asking about the change in plain words finds it", () => {
  // The phrasing a portal user would actually type, rather than the tour's own
  // wording — which is the only phrasing the tour itself guarantees.
  for (const question of [
    "how do the steps in add transport entry work?",
    "can I save my correction and finish it later?",
    "what does correction of mean in drafts and scheduled?",
    "does the generate report update by itself?",
    "my breakdown still shows pending after the approval",
  ]) {
    const ids = idsFor(question);
    assert.ok(
      ids.some((id) => NEW_ENTRY_IDS.has(id)),
      `"${question}" must reach the new material, got: ${ids.join(", ")}`,
    );
  }
});

test("the new entries stay in portal scope", () => {
  // looksInScope(message, hits) is the guard that decides whether VERA answers
  // at all. Checked with NO hits, the hardest case: the question must read as a
  // portal question on its own words, not only because retrieval found something.
  for (const step of PORTAL_FEATURE_TOUR_STEPS) {
    assert.equal(
      vera.looksInScope(step.ask, []),
      true,
      `"${step.ask}" must read as a portal question even with no retrieval hits`,
    );
  }
  assert.equal(vera.looksInScope(PORTAL_FEATURE_TOUR_VERA_PROMPT, []), true);
});

// ── The wiring, read off the portal ─────────────────────────────────────────
const portal = fs.readFileSync(path.join(here, "..", "index.jsx"), "utf8");

test("the tour is due when the user has not seen THIS release", () => {
  assert.match(
    portal,
    /const featureTourDue =\s*!featureTourOptOut && featureTourSeenVersion !== PORTAL_FEATURE_TOUR_VERSION;/,
    "the check must compare versions, never a boolean — and honour the opt-out",
  );
  // And it must not be tied to the ORIENTATION tour's dismissal, which would
  // hide it from everyone who dismissed that one.
  assert.doesNotMatch(portal, /featureTourDue[^\n]*tourDismissed/);
});

test('"Don\'t show this again" means NEVER, not "not until the next release"', () => {
  // The bug: the button recorded only the current release, so the tour returned
  // at the next version bump for someone who had explicitly asked it not to.
  // Two live accounts hit exactly that — their marker moved from
  // 2026-08-20-hauler-bulk-clients to 2026-08-25-uploads-baseline-completeness.
  //
  // The opt-out is now its own flag, and it outranks the version marker.
  assert.match(portal, /const optOutOfFeatureTour = useCallback\(/);
  assert.match(portal, /featureTourOptOut: true,/, "the server copy is what survives logout");
  assert.match(
    portal,
    /secureStorage\.set\(featureTourOptOutKey, "1"\)/,
    "and a local mirror, so a slow response cannot flash the tour at them",
  );
  // It still records the release too, so nothing reading the marker disagrees.
  const optOut = portal.slice(
    portal.indexOf("const optOutOfFeatureTour = useCallback("),
    portal.indexOf("// Hand the user to VERA with the question already asked"),
  );
  assert.match(optOut, /featureTourVersionSeen: PORTAL_FEATURE_TOUR_VERSION/);
});

test("the opt-out is reversible and never a one-way door", () => {
  // What's New reopens the tour regardless — same principle as the orientation
  // tour, whose dismissal deliberately does not disable its own button.
  assert.match(portal, /if \(!manual && !featureTourDue\) return;/);
  assert.match(portal, /onClick=\{\(\) => openFeatureTour\(\)\}/);
});

test("seeing it is recorded both locally and on the server", () => {
  assert.match(portal, /secureStorage\.set\(featureTourSeenKey, PORTAL_FEATURE_TOUR_VERSION\)/);
  assert.match(portal, /featureTourVersionSeen: PORTAL_FEATURE_TOUR_VERSION/);
  // The local mirror is per-user and holds the VERSION, not "1".
  assert.equal(PORTAL_FEATURE_TOUR_SEEN_PREFIX.endsWith("-"), true);
});

test("it opens at most once automatically, and never over the other tour", () => {
  assert.match(portal, /if \(!uiPrefsLoaded \|\| featureTourAutoOpenedRef\.current\) return;/);
  assert.match(portal, /featureTourAutoOpenedRef\.current = true;/);
  // …and stays reachable afterwards.
  assert.match(portal, /onClick=\{\(\) => openFeatureTour\(\)\}/, "a manual entry point exists");
});

test("an announcement that opens the orientation tour holds the feature tour back", () => {
  // Publishing an announcement whose text contains "update" / "what's new"
  // flips isPortalUpdateAnnouncement, which auto-opens the ORIENTATION tour.
  // That effect and the feature tour's auto-open run in the SAME commit, where
  // `updateTourOpen` is still the previous render's false — so the state flag
  // alone cannot stop both tours opening on top of each other. The ref is
  // claimed synchronously and is what actually holds the second one back.
  assert.match(
    portal,
    /updateTourClaimedRef\.current = true;/,
    "the orientation tour must claim the screen synchronously",
  );
  assert.match(
    portal,
    /if \(updateTourOpen \|\| updateTourClaimedRef\.current\) return;/,
    "the feature tour must check the ref, not only the state",
  );
  // The claim must happen inside openPortalUpdateTour, BEFORE its setState calls
  // — after them it would be too late for an effect in the same commit.
  const opener = portal.slice(
    portal.indexOf("const openPortalUpdateTour = useCallback("),
    portal.indexOf("// ONE place that records \"never show this again\""),
  );
  assert.ok(
    opener.indexOf("updateTourClaimedRef.current = true;") <
      opener.indexOf("setUpdateTourOpen(true);"),
    "the ref must be claimed before the state update",
  );
});

test("the section its steps point at is mounted and unfolded first", () => {
  // The baseline sections are collapsible cards. A folded card HIDES its body
  // (it stays mounted), and the tour unfolds the Accredited Haulers card before
  // it opens, or every step would anchor to something invisible.
  assert.match(portal, /key: "haulers",/);
  assert.match(portal, /slf-baseline-section-card\$\{folded \? " is-folded" : ""\}/);
  assert.match(portal, /body: folded \? \{ display: "none" \}/, "folded hides, never unmounts");
  assert.match(portal, /setCollapsedBaselineCards\(\(prev\) => prev\.filter\(\(k\) => k !== "haulers"\)\)/);
});

test("closing is dismissal, and only a deliberate act records the release as seen", () => {
  // Dismissing something in the middle of a task is not a decision never to see
  // it again. So CLOSING (X / Esc / clicking away) closes for now only, and the
  // tour may return on the next sign-in.
  assert.match(
    portal,
    /onClose=\{\(\) => setFeatureTourOpen\(false\)\}/,
    "closing must not record the version as seen",
  );
  // Finishing the last step records the RELEASE as seen — the user got the
  // walkthrough, and the next release is new information worth offering once.
  assert.match(portal, /onFinish=\{markFeatureTourSeen\}/);
  // The explicit opt-out is a different, stronger answer and calls its own
  // handler. Wiring the button to markFeatureTourSeen is the bug: that records
  // only this release, so the tour came back at the next version bump.
  assert.match(portal, /Don&apos;t show this again/);
  assert.match(portal, /onClick=\{optOutOfFeatureTour\}/);
});

test("the opt-out is on EVERY step, not only the last", () => {
  // It is rendered inside the shared step-description mapper rather than being
  // appended to one step, so a user who has seen enough on step 1 can say so.
  const start = portal.indexOf("return PORTAL_FEATURE_TOUR_STEPS.map((step) => ({");
  const end = portal.indexOf("}, [askVeraAboutFeature, optOutOfFeatureTour]);");
  assert.ok(start > -1 && end > start, "the step mapper must be locatable");
  const mapper = portal.slice(start, end);
  assert.match(mapper, /Don&apos;t show this again/);
  assert.match(mapper, /Ask VERA about this/);
});

test("steps that live on another tab switch to it before anchoring", () => {
  // The Data Entry tabs render lazily. Advancing straight to a step whose target
  // is not mounted anchors it to nothing, and antd centres a targetless step —
  // which reads as a broken tour.
  // Steps declare their tab (or a sidebar menu item) in portalFeatureTour.js.
  assert.match(portal, /tab: step\.menu \? undefined : step\.tab \|\| "baseline",/);
  assert.match(portal, /if \(tab && tab !== activeTab\) \{/);
  assert.match(portal, /setTimeout\(\(\) => setFeatureTourCurrent\(next\), 160\);/);
});

test("Ask VERA hands off with the question already asked", () => {
  assert.match(portal, /new CustomEvent\("vera:open", \{\s*\n?\s*detail: \{ ask:/);
  const chat = fs.readFileSync(path.join(here, "..", "Vera", "VeraChat.jsx"), "utf8");
  assert.match(chat, /pendingAskRef\.current = ask;/, "the chat accepts a seeded question");
  assert.match(chat, /pendingAskRef\.current = "";\s*\n\s*send\(ask\);/, "…and sends it once");
});
