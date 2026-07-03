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
