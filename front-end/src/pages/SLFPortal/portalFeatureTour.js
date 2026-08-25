// ── Feature tour: what changed this release ─────────────────────────────────
//
// A VERSIONED, one-time tour, separate from the existing "What's New Tour".
//
// WHY SEPARATE. The original tour records a single boolean (`tourDismissed`),
// so every portal user who has already dismissed it would never see anything
// again — including a workflow change that alters how they do their job. A
// release that changes a process has to be able to reach people who dismissed
// the last one, and that means the dismissal has to remember WHICH release it
// was for. `PORTAL_FEATURE_TOUR_VERSION` is that marker: bump it for the next
// change and the tour returns exactly once, for everyone.
//
// DISMISSAL, precisely. Closing the tour (the X, Esc, or clicking away) closes
// it for NOW and it may return on the next sign-in — closing something is not
// the same as saying you never want it. Two actions record the version as seen
// and stop it permanently: finishing the last step, and the explicit
// "Don't show this again" button offered on every step. What's New reopens it on
// demand either way.
//
// The step copy lives here rather than inline in index.jsx because VERA reads
// the same list to walk a user through the change on request. One source, so
// the tour and VERA can never describe the workflow differently.

export const PORTAL_FEATURE_TOUR_VERSION = "2026-08-25-uploads-baseline-completeness";

export const PORTAL_FEATURE_TOUR_TITLE = "What's new: smarter uploads & baseline fixes";

/**
 * Ordered steps. `key` maps to a target ref in index.jsx; everything the user
 * reads is here.
 *
 * `ask` is the question VERA is sent when the user chooses "Ask VERA" on that
 * step — phrased as a question about the process, not a command, because the
 * server's wantsPageData gate and the knowledge base both key off question
 * wording.
 */
export const PORTAL_FEATURE_TOUR_STEPS = [
  {
    key: "completeness",
    title: "Fix every incomplete record in one place",
    description:
      "The incomplete-records warning now opens an editor holding all of them at once — hauler office addresses, and each client's type, province, city/municipality and address. No more opening haulers one at a time to find the field that is missing. It fills in your form; Save Baseline Update still persists it.",
    ask: "Which of my haulers and clients are incomplete, and how do I complete them?",
  },
  {
    key: "special-zones",
    title: "Special economic zones are now selectable",
    description:
      "Clark Freeport Zone, Subic Bay Freeport Zone, the Freeport Area of Bataan and the other freeports now appear in a client's City/Municipality list, under their host province. They are not ordinary municipalities, so they were never in the national list — pick the zone itself rather than a neighbouring town.",
    ask: "My client is inside Clark Freeport Zone. How do I encode a special economic zone as the municipality?",
  },
  {
    key: "system-generated",
    title: "Files from your own system are understood",
    description:
      "A disposal file exported from a weighbridge or gate system records one party per trip and writes it into both the Hauler and the Client column. The upload now resolves those against your baseline and matches the rows it can, instead of rejecting every one of them.",
    ask: "My system-generated disposal file is rejected — every row says the hauler is not assigned. Why?",
  },
  {
    key: "mismatch",
    title: "Name mismatches are told apart from missing records",
    description:
      "When the baseline already holds a client under a different spelling, the preview says so and offers the fix: use the stored name for this file, or correct the client on the hauler. It no longer tells you to add a client you already have — which would have split that client's volumes across two records.",
    ask: "The upload says my client is not on the hauler, but I can see it there. What is a client name mismatch?",
  },
  {
    key: "preview-grid",
    title: "A clearer upload preview",
    description:
      "Hauler and Client now share one column, as do Truck Capacity, Volume and Unit — they are checked together, so they are shown together. Waste types carry their standard colours, and the Validation column spells out what is wrong with a row and what to do about it.",
    ask: "What do the Match and Validation columns in the upload preview mean?",
  },
  {
    key: "cell-placement",
    title: "No need to re-choose a cell that is already set",
    description:
      "When an entry has already been placed in a disposal cell — through Assign to Cell, an upload, or the entry itself — every vehicle on it inherits that placement. You are no longer asked to pick a cell for waste that is already in one.",
    ask: "Why do I still have to choose a disposal cell for each vehicle?",
  },
];

// Offered at the end of the tour and from the What's New menu. Deliberately a
// question: VERA answers from the portal knowledge base, which is keyed on how
// the user would actually ask.
export const PORTAL_FEATURE_TOUR_VERA_PROMPT =
  "Walk me through what changed in the SLF Portal in this release. " +
  "Summarize the Complete Baseline Records editor, special economic zones in the " +
  "client address picker, how system-generated disposal files are matched, what a " +
  "client name mismatch is and how to resolve it, and when a disposal cell no " +
  "longer has to be chosen per vehicle.";

export default {
  PORTAL_FEATURE_TOUR_VERSION,
  PORTAL_FEATURE_TOUR_TITLE,
  PORTAL_FEATURE_TOUR_STEPS,
  PORTAL_FEATURE_TOUR_VERA_PROMPT,
};
