const PortalSubmissionQueue = require("../models/PortalSubmissionQueue");
const { writeLog } = require("./logger");
const { submitEntries } = require("../routes/dataSLF");

const POLL_INTERVAL_MS = 60 * 1000; // check every minute
const MAX_RETRIES = 3;

let timer = null;
let running = false;

// Process every scheduled submission whose time has arrived. Reuses the same
// submitEntries logic as manual/portal submissions so scheduled entries appear
// in Admin > Portal Submissions exactly like normal submissions.
async function processDueScheduledSubmissions() {
  if (running) return; // avoid overlapping runs
  running = true;
  try {
    const due = await PortalSubmissionQueue.find({
      type: "scheduled",
      status: "scheduled",
      scheduledAt: { $lte: new Date() },
    }).limit(25);

    for (const record of due) {
      try {
        if (!record.payload || typeof record.payload !== "object" || Object.keys(record.payload).length === 0) {
          throw new Error("Scheduled submission has no submission data.");
        }
        const { submissionId } = await submitEntries({
          entries: [record.payload],
          submittedBy: record.portalUserEmail,
          // no req — socket emit is skipped, DB notification still created
        });
        record.status = "submitted";
        record.submittedAt = new Date();
        record.resultSubmissionId = submissionId;
        record.failureReason = "";
        await record.save();
        writeLog("info", "portal.queue.scheduled_submitted", {
          message: `Scheduled submission auto-submitted (${record.slfName || "SLF"})`,
          user: record.portalUserEmail,
          meta: { queueId: record._id, submissionId },
        });
      } catch (err) {
        record.retryCount = (record.retryCount || 0) + 1;
        record.failureReason = err.message || "Automatic submission failed";
        // Keep retrying transient failures up to MAX_RETRIES; then mark failed.
        record.status = record.retryCount >= MAX_RETRIES ? "failed" : "scheduled";
        await record.save();
        writeLog("error", "portal.queue.scheduled_failed", {
          message: `Scheduled submission failed (attempt ${record.retryCount}): ${record.failureReason}`,
          user: record.portalUserEmail,
          meta: { queueId: record._id, status: record.status },
        });

        // ── TELL THE OPERATOR ────────────────────────────────────────────────
        //
        // A scheduled submission that has exhausted its retries is finished, and
        // until now it ended in silence: the record was stamped `failed`, a line
        // went into the server log, and nothing reached the person whose data it
        // was. The only way to find out was to open Drafts & Scheduled and read
        // the Status column — so a submission the operator believed was filed
        // could sit unfiled indefinitely.
        //
        // The notification is what puts a number on their sidebar badge and a
        // line in their bell. Written on the FINAL failure only: the intermediate
        // retries are transient by definition and a notice for each would train
        // the operator to ignore them. There is no `req` here (this is a timer,
        // not a request) so no socket emit is possible — the record is persisted
        // instead, which the portal's badge feed reads on load and on its next
        // refresh. Never allowed to break the sweep.
        if (record.status === "failed" && record.portalUserEmail) {
          try {
            const Notification = require("../models/Notification");
            const UserPortal = require("../models/UserPortal");
            const portalUser = await UserPortal.findOne({
              email: String(record.portalUserEmail).trim().toLowerCase(),
            }).select("_id");
            if (portalUser) {
              await Notification.create({
                recipient: portalUser._id.toString(),
                type: "scheduled_submission_failed",
                title: "Scheduled Submission Failed",
                message: `Your scheduled submission for ${record.slfName || "your SLF"} could not be submitted after ${record.retryCount} attempts. Reason: ${record.failureReason} — open Drafts & Scheduled to correct and retry it.`,
                meta: {
                  queueId: String(record._id),
                  slfName: record.slfName,
                  failureReason: record.failureReason,
                  retryCount: record.retryCount,
                },
              });
            }
          } catch {
            /* a missed notice must never stop the queue from draining */
          }
        }
      }
    }
  } catch (err) {
    writeLog("error", "portal.queue.scheduler_error", { message: err.message });
  } finally {
    running = false;
  }
}

function startScheduledSubmissionWorker() {
  if (timer) return;
  // Run shortly after boot, then on the poll interval.
  setTimeout(processDueScheduledSubmissions, 10 * 1000);
  timer = setInterval(processDueScheduledSubmissions, POLL_INTERVAL_MS);
  console.log("Scheduled submission worker started (interval 60s).");
}

module.exports = { startScheduledSubmissionWorker, processDueScheduledSubmissions };
