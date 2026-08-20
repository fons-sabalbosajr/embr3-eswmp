// ── Feature tour: what changed in Accredited Haulers ────────────────────────
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
// The step copy lives here rather than inline in index.jsx because VERA reads
// the same list to walk a user through the change on request. One source, so
// the tour and VERA can never describe the workflow differently.

export const PORTAL_FEATURE_TOUR_VERSION = "2026-08-20-hauler-bulk-clients";

export const PORTAL_FEATURE_TOUR_TITLE = "What's new: bulk hauler & client updates";

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
    key: "hauler-upload",
    title: "Upload haulers in bulk — now with client locations",
    description:
      "The Accredited Haulers upload now carries Client Region, Client Province and Client City/Municipality, so a bulk update can record everything the Add Hauler form asks for. Province is what classifies a client inside or outside Region 3.",
    ask: "What columns does the Accredited Haulers Excel upload accept now, and which are required?",
  },
  {
    key: "hauler-export",
    title: "Export Hauler Data is now an editable worksheet",
    description:
      "The export writes the exact columns the uploader reads. Download it, correct it in Excel, and upload it straight back — it no longer has to be retyped into a separate template.",
    ask: "How do I use Export Hauler Data to update my haulers in bulk?",
  },
  {
    key: "hauler-guide",
    title: "The format guide explains rows, not just columns",
    description:
      "Upload Excel/CSV opens a guide with a worked example. It answers the question that trips most people up: how many rows a hauler needs when it serves several clients.",
    ask: "My hauler serves five clients. How many rows should my upload file have?",
  },
  {
    key: "hauler-client-list",
    title: "Update one hauler's clients on their own",
    description:
      "Each hauler row has a new client-list action. It opens that hauler with Export Client List and Upload Client List — a six-column sheet with no Hauler Name, so a bulk client update cannot land on the wrong hauler.",
    ask: "How do I upload a client list for just one hauler?",
  },
  {
    key: "vera-assessment",
    title: "VERA reviews your file before you import",
    description:
      "When a preview validates cleanly, VERA checks it for things that are legal but probably wrong — a hauler or client name that nearly matches one you already have, an implausible truck capacity, a new client with no province. It never blocks your import.",
    ask: "What does VERA check when I upload haulers or a client list?",
  },
];

// Offered at the end of the tour and from the What's New menu. Deliberately a
// question: VERA answers from the portal knowledge base, which is keyed on how
// the user would actually ask.
export const PORTAL_FEATURE_TOUR_VERA_PROMPT =
  "Walk me through what changed in the Accredited Haulers section today. " +
  "Summarize the new bulk upload columns, the Export Hauler Data worksheet, the " +
  "per-hauler client list upload, and what VERA checks before an import.";

export default {
  PORTAL_FEATURE_TOUR_VERSION,
  PORTAL_FEATURE_TOUR_TITLE,
  PORTAL_FEATURE_TOUR_STEPS,
  PORTAL_FEATURE_TOUR_VERA_PROMPT,
};
