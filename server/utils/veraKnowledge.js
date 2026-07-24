// VERA knowledge base — the single source of truth for the Virtual Environmental
// Response Assistant that helps SLF Portal users.
//
// This replaces the old static FAQ (front-end SUPPORT_FAQ_ITEMS). Every entry is
// PUBLIC, portal-workflow guidance only — it contains NO secrets, credentials,
// environment values, internal prompts, or live record data. VERA answers strictly
// from this material (grounding), so keep it in step with the real portal workflow:
// locked baseline unit, required vehicle capacity, Review-and-Submit gating, and
// the Organize Cells rules for approved submissions with unassigned waste.
//
// Shape of each entry:
//   { id, category, question, keywords: [], answer, related: [ids] }
//
// `keywords` drive the lightweight retrieval scorer in veraAssistant.js and the
// rule-based fallback used when no AI model is configured.

const { SUPPORT_EMAIL } = require("../config/contact");
const ASSISTANT_NAME = "VERA";
const ASSISTANT_FULL_NAME = "Virtual Environmental Response Assistant";

// Human-friendly labels for the portal sections VERA can be made page-aware about.
const PAGE_LABELS = {
  dashboard: "Assigned SLF Dashboard",
  overview: "Overview",
  "data-entry": "Data Entry",
  dataentry: "Data Entry",
  baseline: "Baseline / Accredited Haulers",
  history: "Submission History",
  "organize-cells": "Organize Cells",
  organizecells: "Organize Cells",
  requests: "My Requests",
  drafts: "Drafts & Scheduled",
  profile: "Profile",
};

const KNOWLEDGE_BASE = [
  {
    id: "required-to-submit",
    category: "submission",
    question: "What information is required to submit?",
    keywords: [
      "required", "requirement", "need", "needed", "mandatory", "submit", "submission",
      "what do i need", "fields", "information", "complete",
    ],
    answer:
      "A submission needs: your Waste Generator (company) information, saved Baseline Data, the Date of Disposal, and at least one transport entry. Each transport entry requires a disposal ticket no., hauler, plate number, actual volume, waste type, and a disposal cell. A Hazardous Waste Code is required for every Treated Hazardous Waste entry. All volumes use your declared baseline unit.",
    related: ["how-to-submit", "review-submit-disabled", "validation-errors"],
  },
  {
    id: "how-to-submit",
    category: "submission",
    question: "How do I submit disposal data?",
    keywords: [
      "how to submit", "submit disposal", "send data", "file", "encode", "data entry",
      "review and submit", "review & submit", "steps to submit", "submission steps",
    ],
    answer:
      "Go to Data Entry, complete the Basic Information, Baseline, and Waste Generator Information tabs, add your transport entries, then use Review & Submit. The button stays disabled until every requirement is met — hover it to see exactly what is still missing. The server re-validates everything again when you submit.",
    related: ["required-to-submit", "review-submit-disabled"],
  },
  {
    id: "add-haulers",
    category: "haulers",
    question: "How do I add and select accredited haulers?",
    keywords: [
      "hauler", "haulers", "accredited", "add hauler", "select hauler", "vehicle",
      "plate number", "transport", "trucking",
    ],
    answer:
      "Add your accredited haulers (with their vehicles) on the Baseline / Accredited Haulers tab before your first submission. When encoding a transport entry, pick the hauler and plate number from your accredited list so the portal can validate the truck against its registered capacity.",
    related: ["hauler-clients", "vehicle-capacity", "upload-formats"],
  },
  {
    id: "hauler-clients",
    category: "haulers",
    question: "What are Hauler Clients and where do they show?",
    keywords: [
      "hauler client", "hauler clients", "client", "clients", "private sector",
      "waste generator information", "column",
    ],
    answer:
      "Hauler Clients are the private-sector clients associated with an accredited hauler. They appear in a Hauler Clients column right after the Hauler Name in your Waste Generator Information and in the admin submission view. Leave it blank if a hauler has no clients — it shows as “—”.",
    related: ["add-haulers"],
  },
  {
    id: "vehicle-capacity",
    category: "haulers",
    question: "Is Vehicle Capacity required?",
    keywords: [
      "vehicle capacity", "truck capacity", "capacity", "required capacity", "zero",
      "greater than 0", "capacity required",
    ],
    answer:
      "Every accredited-hauler vehicle must have a Vehicle Capacity greater than 0. For Truck Capacity: it is REQUIRED on every uploaded disposal row (the parser and server reject a missing or zero value), and OPTIONAL when you add a transport entry manually — any missing historical truck capacity is completed later in Organize Cells. A present value must always be greater than 0.",
    related: ["add-haulers", "organize-cells", "validation-errors"],
  },
  {
    id: "review-submit-disabled",
    category: "submission",
    question: "Why is Review & Submit disabled?",
    keywords: [
      "review submit disabled", "button disabled", "cannot submit", "can't submit",
      "greyed out", "grayed out", "why disabled", "blocked", "submit disabled",
    ],
    answer:
      "Review & Submit is disabled while any requirement is unmet — incomplete company/baseline/disposal info, a missing disposal cell or hazardous code, a vehicle without capacity, an unresolved reverted submission, or past submissions still needing Organize Cells. Hover the button for the exact checklist. The server re-validates everything again on submit.",
    related: ["required-to-submit", "validation-errors", "approved-unassigned", "edit-submitted"],
  },
  {
    id: "organize-cells",
    category: "cells",
    question: "How do I organize and assign SLF cells?",
    keywords: [
      "organize cells", "assign cell", "assign cells", "disposal cell", "cell",
      "placement", "place waste", "bulk assign", "save placement", "unassigned",
    ],
    answer:
      "Open Organize Cells from the menu. For each unassigned waste record, pick an open (active, not full) disposal cell; you can also complete any missing historical truck capacity there. Use the checkboxes and the bulk-assign bar to place many rows at once, then Save Placement.",
    related: ["approved-unassigned", "vehicle-capacity"],
  },
  {
    id: "approved-unassigned",
    category: "cells",
    question: "I have approved submissions with unassigned waste — what now?",
    keywords: [
      "approved unassigned", "approved submission", "unassigned waste", "blocked new",
      "still need cells", "cannot submit new", "organize past",
    ],
    answer:
      "Approved submissions that still contain waste not placed into a cell appear in Organize Cells. Assign the remaining records to cells (already-assigned records stay as they are, and the approved status is not reverted). Once every record is assigned, the submission drops off the list. New submissions are blocked until this is done.",
    related: ["organize-cells", "review-submit-disabled"],
  },
  {
    id: "update-baseline",
    category: "baseline",
    question: "How do I update baseline data?",
    keywords: [
      "update baseline", "baseline data", "baseline locked", "request update", "change baseline",
      "edit baseline", "locked", "my requests",
    ],
    answer:
      "Baseline data locks after your first submission. Use Request Update on the Baseline tab; an admin reviews and approves or rejects it. Track the request under My Requests.",
    related: ["edit-submitted", "statuses"],
  },
  {
    id: "edit-submitted",
    category: "submission",
    question: "How do I edit a submitted entry?",
    keywords: [
      "edit submitted", "edit submission", "change submission", "request edit", "correct",
      "reverted", "revert", "resubmit", "modify entry",
    ],
    answer:
      "Open Submission History, select the record, and send a Request Edit. The admin team approves or rejects it. If a submission is reverted, correct and resubmit it — an unresolved revert older than 24 hours blocks new submissions.",
    related: ["statuses", "review-submit-disabled", "update-baseline"],
  },
  {
    id: "statuses",
    category: "status",
    question: "How do I read Submission History and statuses?",
    keywords: [
      "status", "statuses", "history", "pending", "acknowledged", "approved", "rejected",
      "reverted", "revert requested", "submission history", "track", "what does status mean",
    ],
    answer:
      "Pending = awaiting admin review. Acknowledged/Approved = accepted (may still need cells organized). Revert Requested / Reverted = sent back for correction. Rejected = not accepted and locked. Use History to see each record's status and cell-placement progress. VERA reports what each status means but cannot confirm the live status of your specific record — check Submission History for that.",
    related: ["edit-submitted", "organize-cells"],
  },
  {
    id: "validation-errors",
    category: "errors",
    question: "Common validation errors and how to fix them",
    keywords: [
      "error", "errors", "validation", "invalid", "fix", "cannot proceed", "warning",
      "disposal cell required", "unit must be", "capacity exceeds", "vehicle capacity required",
      "organize past submissions", "red", "message",
    ],
    answer:
      "“Disposal Cell required” — pick a cell for the entry. “Unit must be <baseline>” — every entry uses your declared baseline unit. “Capacity exceeds +10%” — the entered capacity is too high versus the registered vehicle. “Vehicle Capacity required” — fill capacity on Accredited Haulers. “Organize past submissions first” — complete Organize Cells before submitting.",
    related: ["review-submit-disabled", "vehicle-capacity", "organize-cells"],
  },
  {
    id: "units-and-conversion",
    category: "errors",
    question: "What units does the portal use, and how are tons and m³ related?",
    keywords: [
      "unit", "units", "tons", "ton", "tonnes", "m3", "m³", "cubic meter", "cubic metre",
      "convert", "conversion", "volume unit", "which unit", "unit must be", "change unit",
    ],
    answer:
      "The portal works in two volume units: tons and m³ (cubic meters). Every entry must use your SLF's declared baseline unit — that is why you may see “Unit must be <baseline>”. If you need to convert between them the system uses a fixed factor: m³ = tons ÷ 0.50, and tons = m³ × 0.50. You do not convert by hand — enter the value in your declared unit and the system stores your original value and shows the converted figure where needed, so your number is never altered. If your declared unit looks wrong, ask an admin to update it with Set Field Units; a value with no unit cannot be counted and will be flagged.",
    related: ["validation-errors", "update-baseline", "vehicle-capacity"],
  },
  {
    id: "submission-not-saved",
    category: "errors",
    question: "My submission failed or didn't save — what should I do?",
    keywords: [
      "failed", "failed submission", "did not save", "didn't save", "not saved", "disappeared",
      "missing submission", "lost", "server error", "submit failed", "no confirmation",
      "double submit", "submitted twice", "duplicate",
    ],
    answer:
      "First check Submission History — it reflects what the server actually saved, so if your entry is there it was recorded (even if the confirmation was slow). If it is not there, submit again: the portal uses an idempotency key, so a retry of the same submission will not create a duplicate. If it still fails, the error is recorded for the admin team automatically; open a support ticket here in VERA with the date and SLF so an admin can check. Do not keep re-clicking Submit — wait for the result or the error message.",
    related: ["statuses", "edit-submitted", "contact-support"],
  },
  {
    id: "upload-formats",
    category: "upload",
    question: "What file formats can I upload?",
    keywords: [
      "upload", "file format", "excel", "xlsx", "xls", "csv", "import", "bulk upload",
      "spreadsheet", "attach file",
    ],
    answer:
      "The portal accepts Excel (.xlsx, .xls) and CSV files for bulk accredited-hauler and transport-entry uploads. Rows are validated on import; fix any flagged rows before adding them. Every uploaded disposal row must include a Truck Capacity greater than 0.",
    related: ["add-haulers", "vehicle-capacity", "validation-errors"],
  },
  {
    id: "contact-support",
    category: "support",
    question: "Who do I contact for help?",
    keywords: [
      "contact", "help", "support", "ticket", "email", "who to contact", "assistance",
      "human", "agent", "report", "problem",
    ],
    answer:
      `Open a support ticket right here in VERA for portal, account, or submission concerns — use the “Open a support ticket” action below. You can also email ${SUPPORT_EMAIL}. Track existing tickets under “My tickets”.`,
    related: ["statuses"],
  },
  {
    id: "what-is-vera",
    category: "meta",
    question: "What can VERA help me with?",
    keywords: [
      "what can you do", "who are you", "vera", "help me", "capabilities", "assistant",
      "what is vera", "how can you help",
    ],
    answer:
      `I'm ${ASSISTANT_NAME} (${ASSISTANT_FULL_NAME}), the SLF Portal assistant. I can explain portal features and workflows, guide you through forms, submissions, status tracking, cell organization, uploads, and common errors, and warn you about missing or risky inputs before you submit. I only cover the SLF Portal — for anything else, or to reach a person, open a support ticket.`,
    related: ["required-to-submit", "how-to-submit", "contact-support"],
  },
];

// Suggested starter questions shown in the chat when a conversation begins.
const STARTER_QUESTIONS = [
  "What information is required to submit?",
  "Why is Review & Submit disabled?",
  "How do I organize and assign SLF cells?",
  "What do the submission statuses mean?",
  "How do I fix a common validation error?",
];

// Canned, model-independent responses used by the scope guard / fallbacks.
const OUT_OF_SCOPE_REPLY =
  `I can only help with the SLF Portal — submissions, baseline data, haulers, cells, statuses, uploads, and support. I can't help with that topic. If you think this is a portal issue I've misread, rephrase it, or open a support ticket and the team will assist.`;

const CANNOT_VERIFY_REPLY =
  `I can explain how the portal works, but I can't verify live details of your specific records or account. Please check Submission History / My Requests in the portal, or open a support ticket (or email ${SUPPORT_EMAIL}) so the team can confirm.`;

const GREETING_REPLY =
  `Hi! I'm ${ASSISTANT_NAME}, your ${ASSISTANT_FULL_NAME}. Ask me about submitting disposal data, baseline updates, haulers, organizing cells, statuses, uploads, or common errors. How can I help?`;

module.exports = {
  SUPPORT_EMAIL,
  ASSISTANT_NAME,
  ASSISTANT_FULL_NAME,
  PAGE_LABELS,
  KNOWLEDGE_BASE,
  STARTER_QUESTIONS,
  OUT_OF_SCOPE_REPLY,
  CANNOT_VERIFY_REPLY,
  GREETING_REPLY,
};
