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

export const PORTAL_FEATURE_TOUR_VERSION = "2026-11-10-transport-steps-corrections";

export const PORTAL_FEATURE_TOUR_TITLE = "What's new: step-by-step entries & corrections that resubmit";

/**
 * Ordered steps. `key` maps to a target in index.jsx; everything the user reads
 * is here.
 *
 * `tab` is the Data Entry tab the target lives on (the tabs render lazily, so the
 * tour switches to it first). `menu` instead names a sidebar menu item to point
 * at — for a change that lives on another screen.
 *
 * `ask` is the question VERA is sent when the user chooses "Ask VERA" on that
 * step — phrased as a question about the process, not a command, because the
 * server's wantsPageData gate and the knowledge base both key off question
 * wording.
 */
export const PORTAL_FEATURE_TOUR_STEPS = [
  {
    key: "transport-steps",
    tab: "disposal",
    title: "Add Transport Entry is now step by step",
    description:
      "Trip → Vehicles & Waste → Review. The steps work like tabs — click any of them, or use Back and Next — and every field lines up under its label. If something is missing when you save, that step turns red and the form opens on it. Editing a saved entry? Update Entry is available on every step.",
    ask: "How do I add a transport entry for my disposal trip step by step?",
  },
  {
    key: "correction-draft",
    tab: "disposal",
    title: "Save a correction as a draft, or schedule it",
    description:
      "While you correct a reverted entry, Save as Draft and Schedule now keep the correction linked to it. Finishing it later resubmits that same entry — same ID No., back to Pending — instead of filing a new submission and leaving the reverted one behind.",
    ask: "Can I save the correction of a reverted entry as a draft or schedule it?",
  },
  {
    key: "drafts-corrections",
    menu: "drafts",
    title: "Corrections in Drafts & Scheduled resubmit the original",
    description:
      "A saved correction is labelled \"Correction of SLF-…\" and submitting it says Resubmitted. If you already resubmitted that entry from Data Entry, the old copy is cancelled for you, so it can never overwrite your newer correction.",
    ask: "What happens when I submit a correction from Drafts & Scheduled?",
  },
  {
    key: "history-details",
    menu: "history",
    title: "Clearer Submission Details and a live report",
    description:
      "The tables in Submission Details now fit the window — long values wrap instead of scrolling sideways. Generate Report keeps itself up to date while it is open: approvals, reverts and new submissions appear on their own, with the time of the last update.",
    ask: "How do I read the Submission Details and generate my report?",
  },
  {
    key: "overview-breakdown",
    menu: "overview",
    title: "Your Submission Breakdown follows approvals immediately",
    description:
      "When EMB approves a resubmission, the entry moves from Pending to Approved on your Overview within seconds — no refresh, and no older figures held for a couple of minutes.",
    ask: "When does my Submission Breakdown update after EMB approves a resubmission?",
  },
];

// Offered at the end of the tour and from the What's New menu. Deliberately a
// question: VERA answers from the portal knowledge base, which is keyed on how
// the user would actually ask.
export const PORTAL_FEATURE_TOUR_VERA_PROMPT =
  "Walk me through what changed in the SLF Portal in this release. " +
  "Summarize the step-by-step Add Transport Entry form, saving the correction of a " +
  "reverted entry as a draft or scheduling it, how Drafts & Scheduled resubmits a " +
  "correction, the Submission Details tables and live report, and when the " +
  "Submission Breakdown updates after an approval.";

export default {
  PORTAL_FEATURE_TOUR_VERSION,
  PORTAL_FEATURE_TOUR_TITLE,
  PORTAL_FEATURE_TOUR_STEPS,
  PORTAL_FEATURE_TOUR_VERA_PROMPT,
};
