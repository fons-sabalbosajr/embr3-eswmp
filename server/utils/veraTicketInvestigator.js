// VERA support-ticket investigator.
//
// Runs a deterministic, evidence-first investigation on a support ticket BEFORE
// composing a reply, then produces a SAFE, user-facing response grounded in the
// VERA knowledge base. It never fabricates a resolution, never claims an issue is
// "fixed" (the system can't confirm that here), and never leaks logs, stack traces,
// credentials, or DB internals into the user-facing text — raw evidence is kept in
// the admin-only investigation record.
//
// Reuses existing infrastructure: AppLog (activity/errors), DataSLF (the user's
// submissions), the ticket's own history, and utils/veraAssistant for grounded
// KB phrasing. No new model provider calls are required (fallback KB is always
// available); if a provider is configured the route may pass it through.

const vera = require("./veraAssistant");

// Map a ticket to the most likely affected portal module from its category + text.
function detectModule(ticket) {
  const t = `${ticket.subject || ""} ${ticket.message || ""} ${ticket.category || ""}`.toLowerCase();
  if (/baseline/.test(t)) return "SLF Baseline";
  if (/unit|tons|m³|m3|cubic|convert/.test(t)) return "Units / Conversion";
  if (/cell|placement|organize/.test(t)) return "Cell Waste Placement";
  if (/upload|excel|csv|import/.test(t)) return "Bulk Upload";
  if (/hauler|truck|vehicle|plate/.test(t)) return "Accredited Haulers";
  if (/login|password|access|account|verify/.test(t)) return "Account / Access";
  if (/submit|submission|disposal|revert|reject|acknowledg/.test(t)) return "SLF Submissions";
  return "SLF Portal";
}

// Human labels + user-facing lead-ins per issue category. Escalating categories
// tell the user an admin/developer will follow up (no fabricated fix).
const CATEGORY_META = {
  user_correctable: {
    label: "User-correctable",
    confidence: "high",
    escalate: false,
    status: "answered_by_vera",
    lead: "This looks like something you can resolve directly. Here's how:",
  },
  validation: {
    label: "Validation",
    confidence: "high",
    escalate: false,
    status: "answered_by_vera",
    lead: "Your submission is being stopped by a validation rule. Here's what it means and how to clear it:",
  },
  data: {
    label: "Data issue",
    confidence: "medium",
    escalate: false,
    status: "answered_by_vera",
    lead: "This appears to be a data-entry or record issue. Here's what to check:",
  },
  permission: {
    label: "Permission",
    confidence: "high",
    escalate: false,
    status: "answered_by_vera",
    lead: "This action is restricted for your account by an administrator setting:",
  },
  api_db_failure: {
    label: "API / database failure",
    confidence: "medium",
    escalate: true,
    status: "escalated",
    lead: "We detected a system error affecting your recent activity. This is not something you did wrong.",
  },
  developer_intervention: {
    label: "Needs developer",
    confidence: "low",
    escalate: true,
    status: "escalated",
    lead: "This needs a closer look from our technical team.",
  },
  unknown: {
    label: "Needs more information",
    confidence: "low",
    escalate: false,
    status: "awaiting_user",
    lead: "I need a little more detail to help accurately.",
  },
};

// Ceiling on ONE evidence read. See the note on the AppLog query below.
const EVIDENCE_MAX_TIME_MS = Number(process.env.VERA_EVIDENCE_MAX_TIME_MS || 8000);

// Gather evidence for the ticket's portal user. All queries are best-effort and
// degrade to empty so the investigation never crashes on a data-source hiccup.
async function gatherEvidence(ticket) {
  const evidence = [];
  const facts = {
    errorCount: 0, permissionDenied: 0, validationWarn: 0, recentSubmissions: 0,
    lastError: "", logsAvailable: false, submissionsAvailable: false, signals: 0,
  };
  const email = String(ticket.portalUserEmail || "").trim();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    const AppLog = require("../models/AppLog");
    const logs = await AppLog.find({
      user: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      createdAt: { $gte: since },
      level: { $in: ["warn", "error"] },
    })
      .select("level action message createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      // A case-insensitive match cannot use the index, so on a large log this is
      // a scan. Bounded so a slow evidence read degrades to "unavailable" — which
      // this investigator already handles by answering with the supportive
      // Awaiting-User fallback — instead of holding the ticket thread open.
      .maxTimeMS(EVIDENCE_MAX_TIME_MS)
      .lean();

    facts.logsAvailable = true;
    for (const l of logs) {
      if (l.level === "error") facts.errorCount += 1;
      if (/rule\.denied|access\.denied|permission/i.test(l.action)) facts.permissionDenied += 1;
      if (/validation|capacity|unit/i.test(`${l.action} ${l.message}`)) facts.validationWarn += 1;
      if (l.level === "error" && !facts.lastError) facts.lastError = l.action; // action only — never the raw message
    }
    facts.signals += logs.length;
    evidence.push(`Activity log: ${logs.length} warning/error events in 30 days (${facts.errorCount} errors, ${facts.permissionDenied} permission-denied, ${facts.validationWarn} validation-related).`);
  } catch { evidence.push("Activity log: unavailable."); }

  try {
    const DataSLF = require("../models/DataSLF");
    const subs = await DataSLF.find({ submittedBy: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), deletedAt: null })
      .select("status createdAt idNo")
      .sort({ createdAt: -1 })
      .limit(10)
      .maxTimeMS(EVIDENCE_MAX_TIME_MS)
      .lean();
    facts.submissionsAvailable = true;
    facts.recentSubmissions = subs.length;
    const reverted = subs.filter((s) => s.status === "reverted" || s.status === "rejected").length;
    facts.signals += subs.length;
    evidence.push(`Submissions: ${subs.length} recent (${reverted} reverted/rejected).`);
    facts.revertedSubmissions = reverted;
  } catch { evidence.push("Submissions: unavailable."); }

  evidence.push(`Ticket history: ${(ticket.replies || []).length} prior repl${(ticket.replies || []).length === 1 ? "y" : "ies"}; priority ${ticket.priority || "Medium"}.`);
  return { evidence, facts };
}

// True when VERA lacks enough to reach a confident conclusion: an evidence source
// was inaccessible, or there were no usable signals AND the ticket text is vague.
function isInsufficientEvidence(ticket, facts, category) {
  const text = `${ticket.subject || ""} ${ticket.message || ""}`.trim();
  const sourceInaccessible = !facts.logsAvailable || !facts.submissionsAvailable;
  const noSignals = facts.signals === 0;
  const vague = text.length < 25;
  return category === "unknown" && (sourceInaccessible || noSignals || vague);
}

// The supportive, user-safe fallback when the investigation could not be completed.
// Explains the gap WITHOUT exposing internals, lists what's missing + safe steps,
// keeps the ticket open (Awaiting User), and never fabricates a cause or a fix.
function buildInsufficientEvidenceResult(ticket, facts, affectedModule) {
  const missingInformation = [];
  if (!facts.logsAvailable || !facts.submissionsAvailable) {
    missingInformation.push("Recent system activity for your account could not be reviewed automatically.");
  }
  missingInformation.push("The exact page/screen where the problem happened.");
  missingInformation.push("The exact message or behavior you saw, and what you did just before it.");
  missingInformation.push("The affected submission's reference number, date, selected unit, and any attachment.");

  const suggestedNextSteps = [
    "Reopen the affected submission and verify the required fields, selected unit, and date.",
    "Re-check any values you entered against your declared baseline unit (tons or m³).",
    "Try the action once more; if it fails, note the exact wording of the message.",
    "Reply to this ticket with a screenshot or a short description of the steps that led to the issue.",
  ];

  const response = [
    "VERA was unable to confirm the exact cause using the available information.",
    `Please review the affected item in ${affectedModule} and verify the required fields, selected unit, date, and any attached supporting details. You may reply to this ticket with a screenshot or a description of the action you performed before the issue occurred.`,
    "This ticket will remain open while you prepare the additional details — there's no rush. Once you reply, VERA (or an administrator) will continue the investigation.",
  ].join("\n\n");

  return {
    affectedModule,
    issueCategory: "insufficient_evidence",
    issueCategoryLabel: "Needs more information",
    investigationComplete: false,
    investigationSummary:
      `Investigation could not be completed for ${affectedModule}: ` +
      `${!facts.logsAvailable ? "activity log inaccessible; " : ""}` +
      `${!facts.submissionsAvailable ? "submission history inaccessible; " : ""}` +
      `${facts.signals === 0 ? "no usable evidence signals; " : ""}`.trim().replace(/;$/, ".") +
      " Awaiting additional details from the user.",
    missingInformation,
    suggestedNextSteps,
    evidenceReviewed: [],
    confidence: "low",
    escalate: false,
    processingStatus: "awaiting_user",
    response,
    source: "fallback",
  };
}

// Deterministic classification from the gathered facts + ticket text.
function classify(ticket, facts) {
  const t = `${ticket.subject || ""} ${ticket.message || ""}`.toLowerCase();
  // A real system error affecting the user's recent activity outweighs everything.
  if (facts.errorCount >= 1 && /fail|error|save|submit|crash|500|not work/.test(t)) return "api_db_failure";
  if (facts.permissionDenied >= 1 || /permission|not allowed|restricted|can'?t (submit|edit|access)|blocked/.test(t)) return "permission";
  if (facts.validationWarn >= 1 || /validation|invalid|unit must|capacity|required field|disposal cell required/.test(t)) return "validation";
  if (/unit|tons|m³|m3|convert|conversion/.test(t)) return "validation";
  if (ticket.category === "Data Correction" || /wrong (value|number|data)|correction|duplicate|missing record/.test(t)) return "data";
  if (/how do i|how to|where is|cannot find|steps|guide/.test(t)) return "user_correctable";
  if (facts.errorCount >= 3) return "developer_intervention";
  return "unknown";
}

// Build the SAFE user-facing response, grounded in the KB. Never includes raw log
// text, stack traces, or internal identifiers.
function buildResponse(ticket, category, meta) {
  const grounded = (() => {
    try {
      // KB-grounded guidance for the ticket's own wording (rule-based, no fabrication).
      const q = `${ticket.subject || ""}. ${ticket.message || ""}`.slice(0, 300);
      return vera.fallbackFor(q, "portal_user");
    } catch { return ""; }
  })();

  const parts = [meta.lead];
  if (grounded && !/i can only help|out of scope/i.test(grounded)) {
    parts.push(grounded.replace(/\n\n\(From .*?\)$/i, "").trim());
  }
  if (meta.escalate) {
    parts.push(
      "I've flagged this for the administrators/technical team to review, and they'll follow up on this ticket. I can't confirm a fix from here — you'll get an update on this thread."
    );
  } else if (category === "unknown") {
    parts.push(
      "Could you share: (1) the exact page you were on, (2) the exact message or behavior you saw, and (3) roughly when it happened? That will let me pinpoint the cause."
    );
  } else {
    parts.push("If this doesn't resolve it, reply here and I'll escalate it to an administrator.");
  }
  return parts.filter(Boolean).join("\n\n");
}

// Run the full investigation. Returns the record fields + the reply text to post.
async function investigateTicket(ticket) {
  const affectedModule = detectModule(ticket);
  const { evidence, facts } = await gatherEvidence(ticket);
  const category = classify(ticket, facts);

  // Part 6: when the investigation cannot be completed, return the supportive
  // fallback (Awaiting User) instead of a fabricated answer.
  if (isInsufficientEvidence(ticket, facts, category)) {
    return buildInsufficientEvidenceResult(ticket, facts, affectedModule);
  }

  const meta = CATEGORY_META[category] || CATEGORY_META.unknown;
  const response = buildResponse(ticket, category, meta);

  const summary =
    `Affected module: ${affectedModule}. Classified as ${meta.label} from ` +
    `${facts.errorCount} error(s), ${facts.permissionDenied} permission-denied, ` +
    `${facts.validationWarn} validation event(s), ${facts.recentSubmissions} recent submission(s). ` +
    (meta.escalate ? "Escalated for admin/developer review." : "Answered with grounded portal guidance.");

  return {
    affectedModule,
    issueCategory: category,
    issueCategoryLabel: meta.label,
    investigationComplete: true,
    investigationSummary: summary,
    missingInformation: [],
    suggestedNextSteps: [],
    evidenceReviewed: evidence,
    confidence: meta.confidence,
    escalate: meta.escalate,
    processingStatus: meta.status, // veraStatus value
    response,
    source: "fallback",
  };
}

module.exports = { investigateTicket, detectModule, classify, CATEGORY_META };
