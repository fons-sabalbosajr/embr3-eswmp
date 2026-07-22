// Orchestrates baseline → SlfClient sync as a tracked, persisted job.
//
// Creates an SlfSyncJob (progress lives in Mongo, not an in-memory global),
// runs the sync detached, streams progress over the socket, and enforces one
// running job per scope so two syncs never race on the same collection.

const SlfSyncJob = require("../models/SlfSyncJob");
const { runBaselineClientSync } = require("./syncBaselineClients");

/**
 * @param {object} opts
 * @param {string} opts.actor - who started the job.
 * @param {string} [opts.scope]
 * @param {(event:string,payload:object)=>void} [opts.emit] - socket emit bound to admin-room.
 * @returns {Promise<{job?:object, alreadyRunning?:boolean}>}
 */
async function startSyncJob({ actor, scope = "baseline-clients", emit = () => {} }) {
  // Concurrency guard — one active job per scope.
  const active = await SlfSyncJob.findOne({ scope, status: { $in: ["pending", "running"] } }).lean();
  if (active) return { alreadyRunning: true, job: active };

  const job = await SlfSyncJob.create({
    scope, status: "running", startedBy: actor,
    stage: "reading-baselines", stageLabel: "Reading baseline records", percent: 0,
  });

  // Detach — the HTTP request returns immediately with the job id.
  setImmediate(async () => {
    const onProgress = async (p) => {
      try {
        await SlfSyncJob.updateOne({ _id: job._id }, {
          $set: {
            stage: p.stage, stageLabel: p.stageLabel, percent: p.percent,
            processedRecords: p.processed, totalRecords: p.total,
            created: p.counts.created, updated: p.counts.updated, skipped: p.counts.skipped,
            duplicates: p.counts.duplicates, merged: p.counts.merged, removed: p.counts.removed,
            flagged: p.counts.flagged,
          },
        });
      } catch { /* progress persistence is best-effort */ }
      emit("slf-sync-progress", { jobId: String(job._id), status: "running", ...p });
    };

    try {
      const summary = await runBaselineClientSync({ actor, jobId: job._id, onProgress });
      const hasIssues = summary.flagged > 0 || (summary.validation && !summary.validation.ok);
      const status = hasIssues ? "completed_with_issues" : "completed";
      await SlfSyncJob.updateOne({ _id: job._id }, {
        $set: {
          status, percent: 100, completedAt: new Date(),
          validation: summary.validation, summary,
          created: summary.created, updated: summary.updated, skipped: summary.skippedAdminManaged,
          duplicates: summary.duplicatesDetected, merged: summary.duplicatesMerged,
          removed: summary.duplicatesRemoved, flagged: summary.flagged,
          totalRecords: summary.clientsProcessed, processedRecords: summary.clientsProcessed,
        },
      });
      emit("slf-sync-progress", { jobId: String(job._id), status, percent: 100, summary });
      emit("data-refresh", { target: "slf-clients" });
    } catch (err) {
      await SlfSyncJob.updateOne({ _id: job._id }, {
        $set: { status: "failed", errorMessage: err.message || "Sync failed", completedAt: new Date() },
      });
      emit("slf-sync-progress", { jobId: String(job._id), status: "failed", error: err.message || "Sync failed" });
    }
  });

  return { job };
}

module.exports = { startSyncJob };
