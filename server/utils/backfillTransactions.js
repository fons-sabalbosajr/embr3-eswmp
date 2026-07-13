// Shared transaction-backfill logic.
//
// Reconstructs Transaction (activity-log) records for DataSLF submissions that
// predate the transaction system. Used by both the startup backfill in
// server.js and the POST /api/transactions/seed admin route so the two stay in
// sync — they previously carried identical copy-pasted logic.

const Transaction = require("../models/Transaction");
const DataSLF = require("../models/DataSLF");

const ADMIN_DISPLAY_NAME = "EMBR3 ESWMP Admin";

// Build transaction records for a set of DataSLF entries, grouped by
// submissionId. Pure — does not touch the database.
function buildBackfillTransactions(entries) {
  const groups = {};
  for (const e of entries) {
    const sid = e.submissionId || e._id.toString();
    if (!groups[sid]) groups[sid] = [];
    groups[sid].push(e);
  }

  const toInsert = [];
  for (const [sid, items] of Object.entries(groups)) {
    // Submission transaction
    toInsert.push({
      submissionId: sid,
      dataEntry: items[0]._id,
      companyName: items[0].lguCompanyName,
      companyType: items[0].companyType,
      submittedBy: items[0].submittedBy || "",
      type: "submission",
      description: `${items.length} entr${items.length === 1 ? "y" : "ies"} submitted by ${items[0].submittedBy || "unknown"}`,
      performedBy: items[0].submittedBy || "portal",
      meta: { entryCount: items.length, ids: items.map((e) => e.idNo) },
      createdAt: items[0].createdAt,
      updatedAt: items[0].createdAt,
    });

    // Email ack sent (if submittedBy exists, assume email was attempted)
    if (items[0].submittedBy) {
      toInsert.push({
        submissionId: sid,
        companyName: items[0].lguCompanyName,
        submittedBy: items[0].submittedBy,
        type: "email_ack_sent",
        description: `Acknowledgement email sent to ${items[0].submittedBy}`,
        performedBy: "system",
        meta: { email: items[0].submittedBy },
        createdAt: new Date(items[0].createdAt.getTime() + 2000),
        updatedAt: new Date(items[0].createdAt.getTime() + 2000),
      });
    }

    // Status change if not pending
    for (const e of items) {
      if (e.status && e.status !== "pending") {
        toInsert.push({
          submissionId: sid,
          dataEntry: e._id,
          companyName: e.lguCompanyName,
          companyType: e.companyType,
          submittedBy: e.submittedBy || "",
          type: "status_change",
          description: `Entry ${e.idNo} marked as ${e.status}`,
          performedBy: ADMIN_DISPLAY_NAME,
          meta: { status: e.status, idNo: e.idNo },
          createdAt: e.updatedAt || e.createdAt,
          updatedAt: e.updatedAt || e.createdAt,
        });
      }
    }
  }

  return toInsert;
}

// Find DataSLF entries with no transaction records, build the backfill records,
// and insert them. Returns the number of transaction records inserted.
async function backfillTransactions() {
  const existing = await Transaction.distinct("submissionId");
  const entries = await DataSLF.find({ submissionId: { $nin: existing } });
  if (entries.length === 0) return 0;

  const toInsert = buildBackfillTransactions(entries);
  if (toInsert.length > 0) {
    await Transaction.insertMany(toInsert);
  }
  return toInsert.length;
}

module.exports = { buildBackfillTransactions, backfillTransactions, ADMIN_DISPLAY_NAME };
