// Portal submission readiness — "is there anything outstanding that will stop me
// submitting a Data Entry?"
//
// The Portal already shows a `submitBlockers` checklist, but it is computed in the
// BROWSER from whatever that page happens to have loaded, so VERA could not see it
// and could only answer "why can't I submit?" in generalities. This module derives
// the same picture SERVER-side from the database, which makes it authoritative,
// available to VERA, and impossible for a client to misreport.
//
// Scope: only things that persist on the ACCOUNT or in past submissions. The
// in-progress form (date of disposal, the transport rows being typed right now)
// lives only in the browser and is deliberately not modelled here — VERA says so
// rather than pretending to know.
//
// Never throws: a readiness check must not be the reason a chat reply fails.

const SUPPORT_EMAIL_FALLBACK = "eswmr3@emb.gov.ph";

// A revert only blocks NEW submissions once it has gone unresolved for 24h — the
// same cutoff the Portal applies, kept identical so the two never disagree.
const REVERT_GRACE_MS = 24 * 60 * 60 * 1000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Reuses the ONE cell-placement rule (routes/portalAuth#summarizeCellAssignment)
// instead of restating it. Required lazily: portalAuth is a route module, and a
// lazy require keeps load order irrelevant and avoids any import cycle.
function getCellSummarizer() {
  try {
    const mod = require("../routes/portalAuth");
    return typeof mod?.summarizeCellAssignment === "function" ? mod.summarizeCellAssignment : null;
  } catch {
    return null;
  }
}

/**
 * Compute a portal user's outstanding items.
 *
 * @param {object} portalUser - a UserPortal document/lean object (the CALLER's own)
 * @returns {Promise<{ready:boolean, blockers:Array, notes:Array, checkedAt:string}>}
 */
async function getPortalReadiness(portalUser) {
  const blockers = [];
  const notes = [];
  const add = (code, message, action) => blockers.push({ code, message, action });

  if (!portalUser) {
    return {
      ready: false,
      blockers: [{ code: "no_account", message: "No portal account context.", action: "Sign in again." }],
      notes: [],
      checkedAt: new Date().toISOString(),
    };
  }

  // ── Account-level gates ────────────────────────────────────────────────────
  const status = String(portalUser.status || "").toLowerCase();
  if (status && status !== "approved" && status !== "active") {
    add(
      "account_not_approved",
      `Your portal account status is "${portalUser.status}", so submissions are not yet enabled.`,
      `Wait for EMB Region III to approve the account, or email ${SUPPORT_EMAIL_FALLBACK} if it has been pending unusually long.`,
    );
  }

  if (portalUser.verificationRequired && !portalUser.verificationSubmitted) {
    add(
      "verification_missing",
      "Your account still needs its verification document.",
      "Upload the requested verification file from the portal, then wait for EMB Region III to review it.",
    );
  }

  if (portalUser.portalAccess?.canSubmitDisposal === false) {
    add(
      "submit_permission_revoked",
      "Disposal submission has been switched off for your account by an administrator.",
      `Contact EMB Region III (${SUPPORT_EMAIL_FALLBACK}) to have submission access restored.`,
    );
  }

  const assignedIds = Array.isArray(portalUser.assignedSlf)
    ? portalUser.assignedSlf.filter(Boolean)
    : portalUser.assignedSlf
      ? [portalUser.assignedSlf]
      : [];
  if (assignedIds.length === 0) {
    add(
      "no_assigned_slf",
      "No SLF facility is assigned to your account, so there is nothing to submit against.",
      `Contact EMB Region III (${SUPPORT_EMAIL_FALLBACK}) to have your facility assigned.`,
    );
  }

  // ── Assigned facility operational status ───────────────────────────────────
  try {
    if (assignedIds.length) {
      const SlfFacility = require("../models/SlfFacility");
      const facilities = await SlfFacility.find(
        { _id: { $in: assignedIds }, deletedAt: null },
        "lgu province statusOfSLF",
      ).lean();
      const nonOp = facilities.filter((f) => /non/i.test(String(f.statusOfSLF || "")));
      if (nonOp.length) {
        const names = nonOp.map((f) => f.lgu || f.province || "your SLF").join(", ");
        add(
          "slf_non_operational",
          `${names} ${nonOp.length === 1 ? "is" : "are"} tagged non-operational and under EMB Region III verification. Submissions attempted now are saved as Drafts instead of being submitted.`,
          `Contact EMB Region III (${SUPPORT_EMAIL_FALLBACK}) about the restriction.`,
        );
      }
    }
  } catch { /* facility lookup is advisory — never fail the whole check */ }

  // ── Past submissions: unresolved reverts + Organize Cells backlog ──────────
  try {
    const DataSLF = require("../models/DataSLF");
    const summarize = getCellSummarizer();

    const submissions = await DataSLF.find(
      { submittedBy: portalUser.email, deletedAt: null, hiddenFromPortal: { $ne: true } },
      "idNo submissionId status dateOfDisposal revertedAt updatedAt trucks slfGenerator totalVolumeAccepted",
    )
      .populate("slfGenerator", "cellNames cellStatuses")
      .sort({ createdAt: -1 })
      .lean();

    const cutoff = Date.now() - REVERT_GRACE_MS;
    const staleReverts = submissions.filter((s) => {
      if (s.status !== "reverted") return false;
      const ts = s.revertedAt || s.updatedAt;
      return ts && new Date(ts).getTime() <= cutoff;
    });
    if (staleReverts.length) {
      const refs = staleReverts.slice(0, 3).map((s) => s.idNo || s.submissionId || "a submission").join(", ");
      add(
        "unresolved_revert",
        `${staleReverts.length} reverted submission${staleReverts.length === 1 ? "" : "s"} (${refs}) ${staleReverts.length === 1 ? "has" : "have"} been waiting over 24 hours for correction.`,
        "Open Submission History, correct the reverted entry using the admin's reason, and resubmit it before starting a new submission.",
      );
    }

    // Any submission still holding waste with no cell, or a truck with no capacity.
    if (summarize) {
      let subsNeedingOrganize = 0;
      let unplacedCount = 0;
      let missingCapacityCount = 0;
      const refs = [];
      for (const s of submissions) {
        if (s.status === "reverted" || s.status === "rejected") continue;
        const sum = summarize(s);
        const u = num(sum.unplacedCount);
        const m = num(sum.missingCapacityCount);
        if (u > 0 || m > 0) {
          subsNeedingOrganize += 1;
          unplacedCount += u;
          missingCapacityCount += m;
          if (refs.length < 3) refs.push(s.idNo || s.submissionId || "a submission");
        }
      }
      if (subsNeedingOrganize > 0) {
        const parts = [];
        if (unplacedCount > 0) parts.push(`${unplacedCount} entr${unplacedCount === 1 ? "y" : "ies"} with no disposal cell`);
        if (missingCapacityCount > 0) parts.push(`${missingCapacityCount} entr${missingCapacityCount === 1 ? "y" : "ies"} missing Truck Capacity`);
        add(
          "organize_cells_pending",
          `${subsNeedingOrganize} past submission${subsNeedingOrganize === 1 ? "" : "s"} (${refs.join(", ")}) still need Organize Cells — ${parts.join(" and ")}.`,
          "Open Organize Cells, assign every unplaced entry to a disposal cell, fill in any missing Truck Capacity, then save.",
        );
      }
    }

    // Baseline: Total Volume Accepted is the one hard baseline requirement.
    const hasBaselineVolume = submissions.some((s) => num(s.totalVolumeAccepted) > 0);
    if (!hasBaselineVolume) {
      notes.push(
        "No saved Baseline Data with a Total Volume Accepted was found on your past submissions. Baseline Data must carry a Total Volume Accepted before a submission can be finalised — check the Baseline Data tab.",
      );
    }
  } catch { /* submission scan is advisory — never fail the whole check */ }

  // The browser-only part of the checklist, stated plainly so VERA never implies it
  // has inspected the form the user is currently filling in.
  notes.push(
    "Fields in the form you are filling in right now (Date of Disposal, transport entries, per-entry disposal cell, hazardous waste code) are checked in the browser and are not visible to this readiness check — hover the disabled Review & Submit button for that live checklist.",
  );

  return {
    ready: blockers.length === 0,
    blockers,
    notes,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Render readiness as a grounded prompt block for VERA. Mirrors how admin insights
 * are injected: facts only, clearly delimited, no instructions from user data.
 */
function readinessToPromptBlock(readiness) {
  if (!readiness) return "";
  const lines = ["SUBMISSION READINESS (live, from this user's own account — authoritative):"];
  if (readiness.ready) {
    lines.push("- No account-level or historical blockers found. Nothing outstanding is stopping a submission.");
  } else {
    lines.push(`- ${readiness.blockers.length} outstanding item(s) MUST be cleared before a Data Entry can be submitted:`);
    readiness.blockers.forEach((b, i) => {
      lines.push(`  ${i + 1}. [${b.code}] ${b.message}`);
      if (b.action) lines.push(`     Required action: ${b.action}`);
    });
  }
  (readiness.notes || []).forEach((n) => lines.push(`- Note: ${n}`));
  return lines.join("\n");
}

// Does the question warrant pulling readiness? Keeps the DB work off unrelated chat.
// Plural/inflected forms are spelled out deliberately: an earlier version used a
// bare `\bbacklog\b`, which failed on the word users actually type — "backlogs".
const READINESS_RE = new RegExp(
  [
    "submit(?:s|ted|ting|ssion|ssions)?",
    "review\\s*&?\\s*submit",
    "block(?:ed|er|ers|ing)?",
    "disabled", "grey(?:ed)?", "gray(?:ed)?",
    "pending", "outstanding",
    "backlog(?:s|ged)?",
    "incomplete", "missing", "remaining", "unfinished",
    "left\\s+to\\s+do", "still\\s+need(?:ed|s)?", "to[\\s-]?do",
    "what\\s+do\\s+i\\s+need", "what\\s+(?:else|is)\\s+(?:left|needed|required)",
    "requirement(?:s)?", "ready", "readiness", "eligible", "eligibility",
    "organi[sz]e(?:d|s)?", "organi[sz]ation",
    "revert(?:s|ed|ing)?", "correction(?:s)?",
    "clear(?:ed|ance)?",
  ].join("|"),
  "i",
);
const READINESS_WORD_RE = new RegExp(`\\b(?:${READINESS_RE.source})\\b`, "i");

function wantsReadiness(message) {
  return READINESS_WORD_RE.test(String(message || ""));
}

module.exports = {
  getPortalReadiness,
  readinessToPromptBlock,
  wantsReadiness,
  REVERT_GRACE_MS,
};
