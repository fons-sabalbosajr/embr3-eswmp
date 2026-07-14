const express = require("express");
const PortalSubmissionQueue = require("../models/PortalSubmissionQueue");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");
const dataSLFRoutes = require("./dataSLF");

const router = express.Router();

// Require an authenticated caller on every route below. The queue drives portal
// submissions into the admin pipeline; anonymous submit/cancel/delete must not
// be possible. Both frontends always send a Bearer token.
const { requireAnyAuth } = require("../middleware/auth");
router.use(requireAnyAuth);
const { submitEntries } = dataSLFRoutes;
const {
  resolvePortalContext,
  assertPortalWriteAllowed,
  sendPortalContextError,
} = require("../utils/portalContext");

const ACTIVE_STATUSES = ["draft", "scheduled"];

// Every route below acts on a queue record that BELONGS to someone. The caller's
// identity now comes from the token (see utils/portalContext), never from the
// request body/query — previously `submittedBy` / `?email=` were taken at face
// value while auth only checked that *a* valid token existed, so any signed-in
// portal user could read, edit, cancel, delete or submit another user's drafts
// and scheduled submissions just by naming their email or record id.
//
// Developers may act on another portal user's context; that is the privileged
// Developer Portal Mode and it is audited by resolvePortalContext.
// For READ access to a queue record.
async function ownedRecordOr403(req, res, record) {
  const ctx = await resolvePortalContext(req, {
    targetEmail: req.body?.submittedBy || req.query.email,
    targetPortalUserId: req.body?.targetPortalUserId || req.query.targetPortalUserId,
  });
  if (!ctx.isDeveloper && String(record.portalUserEmail || "").toLowerCase() !== String(ctx.email).toLowerCase()) {
    res.status(403).json({ message: "You may only act on your own drafts and scheduled submissions." });
    return null;
  }
  return ctx;
}

// For WRITE access. Ownership as above, PLUS: Developer Portal Mode is read-only,
// so a developer cannot edit, cancel, delete or submit another user's queued work
// through these endpoints. Corrections go through Submission RAW Data.
async function writableRecordOr403(req, res, record) {
  const ctx = await ownedRecordOr403(req, res, record);
  if (!ctx) return null;
  assertPortalWriteAllowed(ctx, req);
  return ctx;
}

// Resolve the portal user for a request.
async function resolvePortalUser(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  return UserPortal.findOne({ email: normalized }).select("_id email status");
}

function sanitizeScheduledAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// List a user's drafts and scheduled submissions.
router.get("/", async (req, res) => {
  try {
    // The listed email comes from the TOKEN, not the query string. A portal user
    // asking for someone else's email is rejected; a developer may target one.
    const ctx = await resolvePortalContext(req, {
      targetEmail: req.query.email,
      targetPortalUserId: req.query.targetPortalUserId,
    });
    const email = ctx.email;
    const filter = { portalUserEmail: email };
    if (req.query.type && ["draft", "scheduled"].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    if (req.query.status) filter.status = req.query.status;
    const records = await PortalSubmissionQueue.find(filter).sort({ updatedAt: -1 });
    res.json(records);
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Create a draft or scheduled submission.
router.post("/", async (req, res) => {
  try {
    const { type, payload, scheduledAt, slfName, slfGenerator, clientRequestId } = req.body || {};
    // Owner comes from the TOKEN. `submittedBy` in the body used to be trusted,
    // which let a signed-in user queue a submission AS SOMEONE ELSE — the worker
    // would then submit it under that person's name.
    const ctx = await resolvePortalContext(req, {
      targetEmail: req.body?.submittedBy,
      targetPortalUserId: req.body?.targetPortalUserId,
    });
    // WRITE: a developer inspecting an account must not queue a draft or schedule
    // a submission that would later be sent under that user's name.
    assertPortalWriteAllowed(ctx, req);
    const email = ctx.email;
    const kind = type === "scheduled" ? "scheduled" : "draft";

    if (kind === "scheduled") {
      const when = sanitizeScheduledAt(scheduledAt);
      if (!when) return res.status(400).json({ message: "A valid scheduled date/time is required." });
      if (when.getTime() <= Date.now()) {
        return res.status(400).json({ message: "Scheduled date/time must be in the future." });
      }
    }

    // Idempotency: a double-click / axios retry must not create two drafts or
    // schedule the same submission twice. The client sends a stable
    // clientRequestId per save action; a repeat returns the record it already made.
    if (clientRequestId) {
      const existing = await PortalSubmissionQueue.findOne({
        portalUserEmail: email,
        clientRequestId: String(clientRequestId),
      });
      if (existing) {
        return res.status(200).json({
          message: kind === "scheduled" ? "Submission scheduled" : "Draft saved",
          data: existing,
          deduplicated: true,
        });
      }
    }

    const portalUser = await resolvePortalUser(email);
    const record = await PortalSubmissionQueue.create({
      clientRequestId: clientRequestId ? String(clientRequestId) : undefined,
      portalUser: portalUser?._id,
      portalUserEmail: email,
      slfGenerator: slfGenerator || payload?.slfGenerator || undefined,
      slfName: slfName || payload?.slfName || "",
      type: kind,
      status: kind,
      payload: payload && typeof payload === "object" ? payload : {},
      scheduledAt: kind === "scheduled" ? sanitizeScheduledAt(scheduledAt) : undefined,
      createdBy: email,
      updatedBy: email,
    });

    writeLog("info", kind === "scheduled" ? "portal.queue.scheduled" : "portal.queue.draft", {
      message: `Portal ${kind} saved (${record.slfName || "SLF"})`,
      user: email,
      ip: req.ip,
      meta: { queueId: record._id, type: kind, scheduledAt: record.scheduledAt },
    });

    res.status(201).json({ message: kind === "scheduled" ? "Submission scheduled" : "Draft saved", data: record });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Update a draft/scheduled record (only while still editable).
router.put("/:id", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    // Ownership from the token. The old check was `if (email && email !== …)` —
    // simply omitting `submittedBy` skipped it entirely.
    const ctx = await writableRecordOr403(req, res, record);
    if (!ctx) return undefined;
    const email = ctx.email;
    if (!ACTIVE_STATUSES.includes(record.status)) {
      return res.status(400).json({ message: `A ${record.status} submission can no longer be edited.` });
    }

    const { type, payload, scheduledAt, slfName, slfGenerator } = req.body || {};
    if (type && ["draft", "scheduled"].includes(type)) {
      record.type = type;
      record.status = type;
    }
    if (payload && typeof payload === "object") record.payload = payload;
    if (slfName !== undefined) record.slfName = slfName;
    if (slfGenerator !== undefined) record.slfGenerator = slfGenerator || undefined;
    if (record.type === "scheduled") {
      const when = sanitizeScheduledAt(scheduledAt ?? record.scheduledAt);
      if (!when) return res.status(400).json({ message: "A valid scheduled date/time is required." });
      if (when.getTime() <= Date.now()) {
        return res.status(400).json({ message: "Scheduled date/time must be in the future." });
      }
      record.scheduledAt = when;
    } else {
      record.scheduledAt = undefined;
    }
    record.updatedBy = email || record.updatedBy;
    await record.save();

    writeLog("info", "portal.queue.update", {
      message: `Portal ${record.type} updated (${record.slfName || "SLF"})`,
      user: email || record.portalUserEmail,
      ip: req.ip,
      meta: { queueId: record._id, type: record.type },
    });

    res.json({ message: "Saved", data: record });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Cancel a scheduled submission (keeps the record, marks it cancelled).
router.patch("/:id/cancel", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    // Had NO ownership check at all: any signed-in user could cancel anyone's
    // scheduled submission just by knowing/guessing its id.
    const ctx = await writableRecordOr403(req, res, record);
    if (!ctx) return undefined;
    if (!ACTIVE_STATUSES.includes(record.status)) {
      return res.status(400).json({ message: `A ${record.status} submission cannot be cancelled.` });
    }
    record.status = "cancelled";
    record.updatedBy = ctx.actor;
    await record.save();
    writeLog("info", "portal.queue.cancel", {
      message: `Portal ${record.type} cancelled (${record.slfName || "SLF"})`,
      user: ctx.actor,
      ip: req.ip,
      meta: { queueId: record._id, developerContext: ctx.impersonating || undefined },
    });
    res.json({ message: "Cancelled", data: record });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Delete a draft/scheduled record.
router.delete("/:id", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    // Had NO ownership check at all — see the cancel route above.
    const ctx = await writableRecordOr403(req, res, record);
    if (!ctx) return undefined;
    await record.deleteOne();
    writeLog("warn", "portal.queue.delete", {
      message: `Portal ${record.type} deleted (${record.slfName || "SLF"})`,
      user: ctx.actor,
      ip: req.ip,
      meta: { queueId: record._id, owner: record.portalUserEmail, developerContext: ctx.impersonating || undefined },
    });
    res.json({ message: "Deleted" });
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// Manually submit a draft/scheduled record now. Reuses the exact same validation
// + saving logic as a normal portal submission (submitEntries).
router.post("/:id/submit", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    // Had NO ownership check: any signed-in user could FINALISE another user's
    // draft into a real submission under that user's name.
    const ctx = await writableRecordOr403(req, res, record);
    if (!ctx) return undefined;
    if (record.status === "submitted") {
      return res.status(400).json({ message: "This submission was already submitted." });
    }
    if (record.status === "cancelled") {
      return res.status(400).json({ message: "This submission was cancelled." });
    }
    if (!record.payload || typeof record.payload !== "object" || Object.keys(record.payload).length === 0) {
      return res.status(400).json({ message: "This draft has no submission data to submit." });
    }

    try {
      const { submissionId } = await submitEntries({
        entries: [record.payload],
        submittedBy: record.portalUserEmail,
        req,
      });
      const wasDraft = record.type === "draft";
      record.status = "submitted";
      record.submittedAt = new Date();
      record.resultSubmissionId = submissionId;
      record.failureReason = "";
      await record.save();

      // A submitted DRAFT now lives in Submission History (DataSLF), so remove it
      // from the Drafts queue entirely. Scheduled records are kept so their
      // submitted result/status stays visible in the Scheduled tab.
      let removedFromDrafts = false;
      if (wasDraft) {
        await record.deleteOne();
        removedFromDrafts = true;
      }

      writeLog("info", "portal.queue.submit", {
        message: `Portal ${wasDraft ? "draft" : record.type} submitted manually (${record.slfName || "SLF"})${removedFromDrafts ? " and removed from drafts" : ""}`,
        user: record.portalUserEmail,
        ip: req.ip,
        meta: { queueId: record._id, submissionId, removedFromDrafts },
      });
      res.json({ message: "Submitted successfully", data: record, submissionId, removedFromDrafts });
    } catch (submitErr) {
      record.status = "failed";
      record.failureReason = submitErr.message || "Submission failed";
      record.retryCount = (record.retryCount || 0) + 1;
      await record.save();
      writeLog("error", "portal.queue.submit_failed", {
        message: `Portal ${record.type} submit failed: ${record.failureReason}`,
        user: record.portalUserEmail,
        ip: req.ip,
        meta: { queueId: record._id },
      });
      const code = submitErr.statusCode || 400;
      res.status(code).json({ message: record.failureReason, data: record });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
