// VERA portal-user backlog detection & investigation.
//
// Detects SLF portal users with pending/overdue data updates using the app's OWN
// status rules (not a fabricated schedule), investigates the portal-side cause from
// available records + recent errors, and stores an idempotent investigation per
// (user, period, kind) that stays OPEN until the data is submitted or resolved.
//
// Backlog sources (things the user still owes / must fix):
//   • DataSLF submissions in "reverted" / "revert_requested" status — sent back for
//     correction and not yet resubmitted.
//   • PortalSubmissionQueue "draft" — saved but never submitted.
//   • PortalSubmissionQueue "failed" — a scheduled submission that errored.
// EXEMPT (never counted as backlog): acknowledged/approved/rejected records,
// soft-deleted or dummy records, and already-submitted queue items.

const mongoose = require("mongoose");

// Current reporting period as YYYY-MM (UTC). One place so every consumer agrees.
function currentReportingPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const KIND_META = {
  reverted: {
    category: "user_correctable",
    confidence: "high",
    escalate: false,
    status: "awaiting_user",
    issue: (n) => `${n} submission${n === 1 ? "" : "s"} were reverted and are awaiting correction.`,
    recommendation:
      "Open Submission History, correct each reverted entry (required fields, selected unit, cell, and reporting date), then resubmit. Reverted entries older than 24 hours block new submissions until resolved.",
  },
  draft: {
    category: "user_correctable",
    confidence: "high",
    escalate: false,
    status: "awaiting_user",
    issue: (n) => `${n} draft submission${n === 1 ? "" : "s"} have been saved but not submitted.`,
    recommendation:
      "Open Drafts & Scheduled, review each draft for completeness (required fields, unit, cell, date), and submit it.",
  },
  failed: {
    category: "api_db_failure",
    confidence: "medium",
    escalate: true,
    status: "awaiting_admin",
    issue: (n) => `${n} scheduled submission${n === 1 ? "" : "s"} failed to submit automatically.`,
    recommendation:
      "A scheduled submission failed. VERA has flagged this for an administrator to review the failure and confirm whether it is a data or system issue before the user retries.",
  },
};

// Group helper: Map<email, { count, sample }>.
function tally(rows, emailKey) {
  const m = new Map();
  for (const r of rows) {
    const email = String(r[emailKey] || "").trim().toLowerCase();
    if (!email) continue;
    if (!m.has(email)) m.set(email, { count: 0, sample: r });
    m.get(email).count += 1;
  }
  return m;
}

// Scan for backlogs, upsert investigations, and resolve cleared ones. Best-effort;
// returns { detected, resolved } counts. Safe to call on a schedule or on demand.
async function detectBacklogs() {
  const DataSLF = mongoose.model("DataSLF");
  const PortalSubmissionQueue = mongoose.model("PortalSubmissionQueue");
  const UserPortal = mongoose.model("UserPortal");
  const VeraBacklog = mongoose.model("VeraBacklogInvestigation");
  const period = currentReportingPeriod();

  // Gather the three backlog sources.
  const [reverted, drafts, failed] = await Promise.all([
    DataSLF.find({
      status: { $in: ["reverted", "revert_requested"] },
      deletedAt: null,
      isDummy: { $ne: true },
    }).select("submittedBy slfName slfGenerator idNo").lean(),
    PortalSubmissionQueue.find({ status: "draft" }).select("portalUserEmail slfName slfGenerator").lean(),
    PortalSubmissionQueue.find({ status: "failed" }).select("portalUserEmail slfName slfGenerator failureReason").lean(),
  ]);

  const groups = {
    reverted: tally(reverted, "submittedBy"),
    draft: tally(drafts, "portalUserEmail"),
    failed: tally(failed, "portalUserEmail"),
  };

  const seenSignatures = new Set();
  let detected = 0;

  for (const kind of Object.keys(groups)) {
    const meta = KIND_META[kind];
    for (const [email, { count, sample }] of groups[kind]) {
      const signature = `${email}|${period}|${kind}`;
      seenSignatures.add(signature);

      const user = await UserPortal.findOne({ email }).select("_id assignedSlfName").lean().catch(() => null);
      const slfName = sample.slfName || (user?.assignedSlfName || [])[0] || "";

      const evidence = [
        `${count} ${kind} item(s) for ${email} in reporting period ${period}.`,
      ];
      if (kind === "failed" && sample.failureReason) {
        evidence.push("A scheduled submission recorded a failure reason (kept admin-side).");
      }

      // Keep an already-open item open (don't clobber an admin-advanced status like
      // "investigating"/"escalated"); only (re)assert detection state on creation.
      const existing = await VeraBacklog.findOne({ signature }).select("status").lean();
      const nextStatus = existing && ["investigating", "escalated", "awaiting_admin", "awaiting_user"].includes(existing.status)
        ? existing.status
        : meta.status;

      await VeraBacklog.updateOne(
        { signature },
        {
          $set: {
            portalUser: user?._id || null,
            portalUserEmail: email,
            slfName,
            slfFacility: sample.slfGenerator || null,
            reportingPeriod: period,
            kind,
            pendingRecords: count,
            missingRecords: `${count} ${kind} record(s)`,
            detectedIssue: meta.issue(count),
            issueCategory: meta.category,
            evidenceReviewed: evidence,
            recommendation: meta.recommendation,
            confidence: meta.confidence,
            escalationStatus: meta.escalate ? "escalated" : "none",
            status: nextStatus,
            lastSeenAt: new Date(),
          },
          $setOnInsert: { signature },
        },
        { upsert: true },
      );
      detected += 1;
    }
  }

  // Resolve open investigations whose backlog no longer exists (submitted/cleared).
  const stillOpen = await VeraBacklog.find({
    status: { $nin: ["resolved", "submitted"] },
    reportingPeriod: period,
  }).select("signature kind").lean();
  let resolved = 0;
  for (const inv of stillOpen) {
    if (!seenSignatures.has(inv.signature)) {
      await VeraBacklog.updateOne(
        { signature: inv.signature },
        { $set: { status: inv.kind === "draft" ? "submitted" : "resolved", resolvedAt: new Date() } },
      );
      resolved += 1;
    }
  }

  return { detected, resolved, period };
}

// Open backlog investigations for the admin VERA notification bell.
async function getOpenBacklogs(limit = 50) {
  const VeraBacklog = mongoose.model("VeraBacklogInvestigation");
  return VeraBacklog.find({ status: { $nin: ["resolved", "submitted"] } })
    .sort({ escalationStatus: -1, lastSeenAt: -1 })
    .limit(limit)
    .lean();
}

module.exports = { detectBacklogs, getOpenBacklogs, currentReportingPeriod, KIND_META };
