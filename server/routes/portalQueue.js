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
const { submitEntries, isDatabaseTimeout, DB_TIMEOUT_MESSAGE } = dataSLFRoutes;
const {
  resolvePortalContext,
  assertPortalWriteAllowed,
  sendPortalContextError,
} = require("../utils/portalContext");

const ACTIVE_STATUSES = ["draft", "scheduled"];

// A queue record's `payload` is a WHOLE submission — trucks, their vehicles and
// every selected client on each. Listing a user's queue used to hydrate all of
// them as Mongoose documents with no projection, no limit and an unindexed sort,
// which is why Drafts & Scheduled stalled and eventually died on the driver's
// socket timeout for anyone with a real backlog.
//
// The panel's TABLE needs none of that: it renders the facility, the status, the
// dates and the failure reason. So `?summary=1` answers with those plus a small
// precomputed digest of the payload (what the export column needs), and the full
// payload is fetched one record at a time from GET /:id when a row is opened.
const SUMMARY_FIELDS =
  "portalUserEmail slfName slfGenerator type status scheduledAt submittedAt " +
  "resultSubmissionId failureReason retryCount createdAt updatedAt";

// Hard ceiling on one page of queue records. Generous enough that no real
// operator paginates, low enough that a runaway account cannot ask the database
// for an unbounded result set.
const QUEUE_MAX_LIMIT = 1000;
const QUEUE_MAX_TIME_MS = Number(process.env.PORTAL_QUEUE_MAX_TIME_MS || 15000);

// The few payload facts the panel shows outside the detail modal (the export's
// Date of Disposal / Transport Entries / Total Volume / Unit columns).
function summarizePayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const trucks = Array.isArray(source.trucks) ? source.trucks : [];
  const totalVolume = trucks.reduce((sum, truck) => {
    const vehicles = Array.isArray(truck?.vehicles) ? truck.vehicles : [];
    return (
      sum +
      (vehicles.length
        ? vehicles.reduce((s, v) => s + Number(v?.actualVolume || 0), 0)
        : Number(truck?.actualVolume || 0))
    );
  }, 0);
  return {
    dateOfDisposal: source.dateOfDisposal || null,
    lguCompanyName: source.lguCompanyName || "",
    baselineUnit: source.baselineUnit || source.totalVolumeAcceptedUnit || "",
    truckCount: trucks.length,
    totalVolume: Number.isFinite(totalVolume) ? Number(totalVolume.toFixed(2)) : 0,
  };
}

// Statuses a record can still be WORKED ON from: edited, cancelled, or submitted
// again. `failed` belongs here — POST /:id/submit already accepts it (it refuses
// only `submitted` and `cancelled`), but the EDIT gate did not, so a rejection
// the operator could fix (an unresolved revert, a client not yet accredited, a
// missing cell) froze the record's data at exactly the state that had just been
// rejected. Retrying it unchanged could only fail again, which is what made
// "Submit Now" look broken.
//
// `submitted` and `cancelled` stay terminal.
const EDITABLE_STATUSES = [...ACTIVE_STATUSES, "failed"];

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

// Query flags arrive as strings ("1", "true"); an absent flag must read false.
function isTruthyFlag(value) {
  return value === true || value === "1" || value === "true" || value === "yes";
}

// WHICH transaction a draft is about.
//
// A draft is a work-in-progress of one facility's disposal report for one day,
// so that pair identifies it. Saving the same one again is the operator
// revising their work, not filing a second draft — see findEquivalentDraft.
// Returns "" when the payload does not identify a transaction yet (no date), in
// which case nothing is merged and a new draft is created as before.
function draftIdentity({ slfGenerator, slfName, payload }) {
  const source = payload && typeof payload === "object" ? payload : {};
  const day = String(source.dateOfDisposal || "").trim();
  if (!day) return "";
  const facility =
    String(slfGenerator || source.slfGenerator || "").trim() ||
    String(slfName || source.slfName || "").trim().toLowerCase();
  if (!facility) return "";
  return `${facility}|${day.slice(0, 10)}`;
}

/**
 * The draft this save is a revision OF, if any.
 *
 * Every "Save as Draft" click sends a fresh clientRequestId, so the idempotency
 * check above only ever caught a double-click on ONE click — an operator who
 * saved the same day's report again after editing it got a second draft, then a
 * third. Those piles are both confusing (which one is current?) and the reason a
 * queue grows big enough to be slow to load. Same facility + same disposal date,
 * still editable → update that record in place.
 *
 * Scheduled records are deliberately excluded: scheduling the same report twice
 * is a legitimate thing to do and each run has its own time.
 */
async function findEquivalentDraft(email, identity) {
  if (!identity) return null;
  const candidates = await PortalSubmissionQueue.find({
    portalUserEmail: email,
    type: "draft",
    status: { $in: ["draft", "failed"] },
  })
    .sort({ updatedAt: -1 })
    .limit(QUEUE_MAX_LIMIT)
    .select("slfGenerator slfName payload.dateOfDisposal payload.slfGenerator payload.slfName")
    .maxTimeMS(QUEUE_MAX_TIME_MS)
    .lean();
  const match = candidates.find(
    (record) =>
      draftIdentity({
        slfGenerator: record.slfGenerator,
        slfName: record.slfName,
        payload: record.payload,
      }) === identity,
  );
  return match ? PortalSubmissionQueue.findById(match._id) : null;
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

    // The sidebar's "needs attention" badge only ever wanted the NUMBER. It used
    // to download every failed record — payloads included — and call `.length`
    // on the result, on every socket event.
    if (isTruthyFlag(req.query.countOnly)) {
      const count = await PortalSubmissionQueue.countDocuments(filter).maxTimeMS(QUEUE_MAX_TIME_MS);
      return res.json({ count });
    }

    const limit = Math.min(
      QUEUE_MAX_LIMIT,
      Math.max(1, Number(req.query.limit) || QUEUE_MAX_LIMIT),
    );
    const summaryOnly = isTruthyFlag(req.query.summary);

    const query = PortalSubmissionQueue.find(filter)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .maxTimeMS(QUEUE_MAX_TIME_MS)
      .lean();
    // `payload` is excluded at the DATABASE, not after the fact — shipping it out
    // of Mongo is the cost this mode exists to avoid.
    if (summaryOnly) query.select(SUMMARY_FIELDS);

    const records = await query;
    if (summaryOnly) {
      // The digest still needs the payload, so read the handful of fields it
      // summarizes in one narrow second pass rather than the whole thing.
      const digests = await PortalSubmissionQueue.find(filter)
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select(
          "payload.dateOfDisposal payload.lguCompanyName payload.baselineUnit " +
            "payload.totalVolumeAcceptedUnit payload.trucks.actualVolume " +
            "payload.trucks.vehicles.actualVolume",
        )
        .maxTimeMS(QUEUE_MAX_TIME_MS)
        .lean();
      const byId = new Map(digests.map((d) => [String(d._id), d.payload]));
      records.forEach((record) => {
        record.payloadSummary = summarizePayload(byId.get(String(record._id)));
      });
    }
    res.json(records);
  } catch (error) {
    return sendPortalContextError(res, error);
  }
});

// One queue record in full, including its payload. The list is summary-only for
// the panel, so the detail modal and "edit this draft" read the payload here —
// one record at a time instead of every record on every page load.
router.get("/:id", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id).lean();
    if (!record) return res.status(404).json({ message: "Record not found" });
    const ctx = await ownedRecordOr403(req, res, record);
    if (!ctx) return undefined;
    res.json(record);
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

    // Re-saving the SAME transaction updates the draft that already holds it
    // instead of stacking another copy beside it.
    if (kind === "draft") {
      const identity = draftIdentity({ slfGenerator, slfName, payload });
      const existing = await findEquivalentDraft(email, identity);
      if (existing) {
        existing.payload = payload && typeof payload === "object" ? payload : {};
        if (slfName !== undefined) existing.slfName = slfName || payload?.slfName || existing.slfName;
        if (slfGenerator !== undefined) {
          existing.slfGenerator = slfGenerator || payload?.slfGenerator || existing.slfGenerator;
        }
        // A revision of a draft that had been REJECTED is the operator fixing
        // what was refused, so it rejoins the ordinary queue and the stale
        // reason goes with it — the same rule PUT /:id applies.
        if (existing.status === "failed") {
          existing.status = "draft";
          existing.failureReason = "";
        }
        existing.scheduledAt = undefined;
        existing.updatedBy = email;
        await existing.save();

        writeLog("info", "portal.queue.draft_updated", {
          message: `Portal draft updated in place (${existing.slfName || "SLF"})`,
          user: email,
          ip: req.ip,
          meta: { queueId: existing._id, identity },
        });

        return res.status(200).json({
          message: "Draft updated",
          data: existing,
          updatedExisting: true,
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
    if (!EDITABLE_STATUSES.includes(record.status)) {
      return res.status(400).json({ message: `A ${record.status} submission can no longer be edited.` });
    }

    const { type, payload, scheduledAt, slfName, slfGenerator } = req.body || {};
    // Read BEFORE anything mutates it: the `type` block below assigns
    // `record.status`, so a "was this failed?" test placed after it never fires
    // and the stale failure reason survives the edit that fixed it.
    const wasFailed = record.status === "failed";
    if (type && ["draft", "scheduled"].includes(type)) {
      record.type = type;
      record.status = type;
    }
    // Editing a FAILED record is the operator correcting what was rejected, so it
    // returns to the ordinary queue and the stale reason goes with it — otherwise
    // the row keeps reporting a failure that has already been addressed.
    // `retryCount` is deliberately kept: it is history, not state.
    if (wasFailed) {
      record.status = record.type === "scheduled" ? "scheduled" : "draft";
      record.failureReason = "";
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
    // A FAILED scheduled run can be cancelled too — it never submitted, so
    // "give up on this one" is a legitimate ending for it.
    if (!EDITABLE_STATUSES.includes(record.status)) {
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
      // A DATABASE timeout is not a rejected submission. Stamping the record
      // `failed` with the driver's raw text ("connection … :27017 timed out")
      // told the operator their data was wrong when nothing about it was, and
      // left a permanent failure on a record that would submit fine on a retry.
      if (isDatabaseTimeout?.(submitErr)) {
        writeLog("error", "portal.queue.submit_timeout", {
          message: `Portal ${record.type} submit timed out against the database`,
          user: record.portalUserEmail,
          ip: req.ip,
          meta: { queueId: record._id },
        });
        return res.status(503).json({ message: DB_TIMEOUT_MESSAGE, code: "DB_TIMEOUT", data: record });
      }
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
      // Pass the machine-readable reason through (e.g. UNRESOLVED_REVERT + the
      // blocking entry's id) so the Drafts panel can offer the fix directly.
      res.status(code).json({
        message: record.failureReason,
        data: record,
        // String codes only — a driver error's numeric `code` (e.g. 11000) is
        // not one of our rule codes.
        ...(typeof submitErr.code === "string" ? { code: submitErr.code } : {}),
        ...(submitErr.ruleContext ? { ruleContext: submitErr.ruleContext } : {}),
      });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
// Exposed for testing: the two pure rules behind the queue's behaviour — WHICH
// transaction a draft is about (so re-saving it updates rather than duplicates)
// and the payload digest the summary list ships in place of the payload itself.
module.exports.draftIdentity = draftIdentity;
module.exports.summarizePayload = summarizePayload;
module.exports.isTruthyFlag = isTruthyFlag;
