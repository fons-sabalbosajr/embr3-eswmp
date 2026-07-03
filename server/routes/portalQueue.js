const express = require("express");
const PortalSubmissionQueue = require("../models/PortalSubmissionQueue");
const UserPortal = require("../models/UserPortal");
const { writeLog } = require("../utils/logger");
const dataSLFRoutes = require("./dataSLF");

const router = express.Router();
const { submitEntries } = dataSLFRoutes;

const ACTIVE_STATUSES = ["draft", "scheduled"];

// Resolve the portal user for a request. The portal is authenticated via the
// shared axios token; the email is passed explicitly (same pattern as the
// existing portal submission routes).
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
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "email is required" });
    const filter = { portalUserEmail: email };
    if (req.query.type && ["draft", "scheduled"].includes(req.query.type)) {
      filter.type = req.query.type;
    }
    if (req.query.status) filter.status = req.query.status;
    const records = await PortalSubmissionQueue.find(filter).sort({ updatedAt: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create a draft or scheduled submission.
router.post("/", async (req, res) => {
  try {
    const { type, payload, scheduledAt, submittedBy, slfName, slfGenerator } = req.body || {};
    const email = String(submittedBy || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "submittedBy (email) is required" });
    const kind = type === "scheduled" ? "scheduled" : "draft";

    if (kind === "scheduled") {
      const when = sanitizeScheduledAt(scheduledAt);
      if (!when) return res.status(400).json({ message: "A valid scheduled date/time is required." });
      if (when.getTime() <= Date.now()) {
        return res.status(400).json({ message: "Scheduled date/time must be in the future." });
      }
    }

    const portalUser = await resolvePortalUser(email);
    const record = await PortalSubmissionQueue.create({
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
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a draft/scheduled record (only while still editable).
router.put("/:id", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    const email = String(req.body?.submittedBy || "").trim().toLowerCase();
    if (email && email !== record.portalUserEmail) {
      return res.status(403).json({ message: "You can only edit your own drafts." });
    }
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
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Cancel a scheduled submission (keeps the record, marks it cancelled).
router.patch("/:id/cancel", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    if (!ACTIVE_STATUSES.includes(record.status)) {
      return res.status(400).json({ message: `A ${record.status} submission cannot be cancelled.` });
    }
    record.status = "cancelled";
    record.updatedBy = String(req.body?.submittedBy || record.portalUserEmail).toLowerCase();
    await record.save();
    writeLog("info", "portal.queue.cancel", {
      message: `Portal ${record.type} cancelled (${record.slfName || "SLF"})`,
      user: record.updatedBy,
      ip: req.ip,
      meta: { queueId: record._id },
    });
    res.json({ message: "Cancelled", data: record });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a draft/scheduled record.
router.delete("/:id", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    await record.deleteOne();
    writeLog("warn", "portal.queue.delete", {
      message: `Portal ${record.type} deleted (${record.slfName || "SLF"})`,
      user: record.portalUserEmail,
      ip: req.ip,
      meta: { queueId: record._id },
    });
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Manually submit a draft/scheduled record now. Reuses the exact same validation
// + saving logic as a normal portal submission (submitEntries).
router.post("/:id/submit", async (req, res) => {
  try {
    const record = await PortalSubmissionQueue.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
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
