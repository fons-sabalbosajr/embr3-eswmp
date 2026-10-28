const express = require("express");
const Transaction = require("../models/Transaction");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const { backfillTransactions } = require("../utils/backfillTransactions");
const { wantsIncludeDummy } = require("../utils/dummyFilter");
const SupportTicket = require("../models/SupportTicket");
const {
  annotateRequestStatuses,
  EDIT_ANSWER_TYPES,
  BASELINE_ANSWER_TYPES,
} = require("../utils/requestStatus");

const router = express.Router();

/**
 * Baseline-lifecycle transaction types.
 *
 * These describe the facility's BASELINE — the declared capacity, cell entries
 * and accredited haulers — not any single disposal submission. Kept as one list
 * so the submission thread and a baseline history can never disagree about which
 * side an event belongs to.
 */
const BASELINE_TXN_TYPES = [
  "baseline_update",
  "baseline_update_request",
  "baseline_update_approved",
  "baseline_update_rejected",
  "baseline_locked",
];

// Require an authenticated caller on every route below. Both frontends always
// send a Bearer token, so this closes anonymous read/write/delete access to the
// activity/audit log without changing client behaviour.
const { requireAnyAuth } = require("../middleware/auth");
router.use(requireAnyAuth);

// Transactions carry no isDummy flag of their own — they are an audit trail that
// links back to a submission (dataEntry / submissionId) and/or a portal account
// (submittedBy). Resolve the (small) set of dummy submissions and dummy accounts,
// then build a `$nor` clause that hides any transaction tied to them. Returns {}
// when there is nothing to exclude. This stays correct automatically as new dummy
// data is created — no per-transaction stamping or backfill required.
// Pass includeDummy=true (developer views) to skip exclusion entirely.
async function buildDummyExclusion(includeDummy) {
  if (includeDummy) return {};
  const [dummyEntries, dummyAccounts] = await Promise.all([
    DataSLF.find({ isDummy: true })
      .setOptions({ includeHiddenYears: true })
      .select("_id submissionId submittedBy")
      .lean(),
    UserPortal.find({ isDummy: true }).select("email").lean(),
  ]);
  const ids = dummyEntries.map((d) => d._id);
  const submissionIds = uniq(dummyEntries.map((d) => d.submissionId));
  const emails = [
    ...new Set(
      [
        ...dummyEntries.map((d) => d.submittedBy),
        ...dummyAccounts.map((u) => u.email),
      ]
        .map((e) => String(e || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const nor = [];
  if (ids.length) nor.push({ dataEntry: { $in: ids } });
  if (submissionIds.length) nor.push({ submissionId: { $in: submissionIds } });
  if (emails.length) nor.push({ submittedBy: { $in: emails } });
  return nor.length ? { $nor: nor } : {};
}

function getXXAlias(idNo = "") {
  const parts = String(idNo || "").split("-");
  if (parts.length >= 4 && parts[0] === "SLF" && parts[2] && parts[2] !== "XX") {
    return `SLF-${parts[1]}-XX-${parts[3]}`;
  }
  return null;
}

function uniq(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

// Backfill transactions from existing data-slf entries that have no transaction
// records. Shared with the startup backfill via utils/backfillTransactions.
router.post("/seed", async (req, res) => {
  try {
    const seeded = await backfillTransactions();
    res.json({
      message: seeded > 0 ? "Transactions seeded" : "No new entries to seed",
      seeded,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all transactions (paginated, filterable)
router.get("/", async (req, res) => {
  try {
    const { company, type, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (company) filter.companyName = company;
    if (type) filter.type = type;
    if (search) {
      // Escape user input so special characters can't break the query regex
      // (HTTP 500) or cause ReDoS. Mirrors the escaping used across the routes.
      const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { companyName: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { submissionId: { $regex: escaped, $options: "i" } },
        { submittedBy: { $regex: escaped, $options: "i" } },
      ];
    }

    // Keep dummy/test submissions and accounts out of the production report.
    Object.assign(filter, await buildDummyExclusion(wantsIncludeDummy(req)));

    const skip = (Number(page) - 1) * Number(limit);
    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Transaction.countDocuments(filter),
    ]);

    res.json({ transactions, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * GET /api/transactions/my-requests
 * The portal's "Requests" panel — every request/amendment raised BY or FOR the
 * calling portal account.
 *
 * Replaces the panel's previous use of the generic admin search
 * (`/transactions?search=<email>&limit=100`), which was the reason Request
 * Update and Refresh were slow:
 *   • `search` builds a case-insensitive $regex $or across four fields, none of
 *     which an index can serve — a collection scan of the entire audit log, run
 *     twice (find + countDocuments).
 *   • buildDummyExclusion additionally read every dummy DataSLF and UserPortal
 *     document on each call, then bolted a large $nor onto the query.
 *   • The client then discarded almost every returned row, so the request could
 *     be both slow AND incomplete once a user had >100 audit entries.
 *
 * This filters by an INDEXED (email, type, createdAt) prefix, applies the
 * dismissal rule server-side, and returns only what the panel renders.
 */
const PORTAL_REQUEST_TYPES = [
  "baseline_update_request",
  "baseline_update_approved",
  "submission_edit_request",
  "submission_edit_approved",
  "submission_edit_rejected",
  "support_ticket",
  "support_ticket_reply",
];
// Admin-initiated conversation entries are surfaced under Messages, not Requests.
const ADMIN_CONVERSATION_RE = /^admin (started|replied to) conversation\b/i;

router.get("/my-requests", async (req, res) => {
  try {
    const rawEmail = String(req.query.email || req.user?.email || "").trim();
    const email = rawEmail.toLowerCase();
    if (!email) return res.status(400).json({ message: "email is required" });

    const limit = Math.min(Number(req.query.limit) || 200, 500);

    // Two index-backed lookups instead of one unindexed regex scan. Older rows
    // stored the address with the casing the user typed, so both the normalized
    // and as-supplied forms are matched — an $in of exact terms still uses the
    // index, unlike a case-insensitive regex.
    const emailTerms = [...new Set([email, rawEmail])];
    const typeFilter = { $in: PORTAL_REQUEST_TYPES };

    const [submitted, performed] = await Promise.all([
      Transaction.find({ submittedBy: { $in: emailTerms }, type: typeFilter })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      Transaction.find({ performedBy: { $in: emailTerms }, type: typeFilter })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const byId = new Map();
    [...submitted, ...performed].forEach((row) => {
      // Dismissed by this user, or an admin conversation entry → not a request.
      if (Array.isArray(row.portalHiddenBy) && row.portalHiddenBy.includes(email)) return;
      if (ADMIN_CONVERSATION_RE.test(row.description || "")) return;
      byId.set(String(row._id), row);
    });

    const rows = [...byId.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    // Each request's status, resolved from the admin's actual answer to it (see
    // utils/requestStatus). The answers are read by the entry / facility / ticket
    // the requests name — not by this user — because an admin's revert or lock
    // is logged under the admin, not the requester.
    const entryIds = [
      ...new Set(
        rows
          .filter((r) => r.type === "submission_edit_request" && r.dataEntry)
          .map((r) => String(r.dataEntry)),
      ),
    ];
    const companies = [
      ...new Set(
        rows
          .filter((r) => r.type === "baseline_update_request" && r.companyName)
          .map((r) => r.companyName),
      ),
    ];
    const ticketNos = [
      ...new Set(
        rows
          .filter((r) => r.type === "support_ticket")
          .map((r) => String(r.meta?.ticketNo || r.submissionId || ""))
          .filter(Boolean),
      ),
    ];
    const answerQuery = [
      ...(entryIds.length ? [{ dataEntry: { $in: entryIds }, type: { $in: EDIT_ANSWER_TYPES } }] : []),
      ...(companies.length ? [{ companyName: { $in: companies }, type: { $in: BASELINE_ANSWER_TYPES } }] : []),
    ];
    const [answers, entries, tickets, knownFacilities, requestedFacilities] = await Promise.all([
      answerQuery.length
        ? Transaction.find({ $or: answerQuery })
            .select("type createdAt dataEntry companyName meta.action meta.reason meta.slfName")
            .lean()
        : [],
      entryIds.length
        ? DataSLF.find({ _id: { $in: entryIds } })
            .setOptions({ includeHiddenYears: true, includeNonOperationalSlf: true })
            .select("revertRequested")
            .lean()
        : [],
      ticketNos.length
        ? SupportTicket.find({ ticketNo: { $in: ticketNos } }).select("ticketNo status").lean()
        : [],
      // Which facilities are known, and which still have a baseline request
      // open — a request on a facility that has none open was answered.
      companies.length ? DataSLF.distinct("slfName", { slfName: { $in: companies } }) : [],
      companies.length
        ? DataSLF.distinct("slfName", { slfName: { $in: companies }, baselineUpdateRequested: true })
        : [],
    ]);

    const requestedSet = new Set(requestedFacilities.map((n) => String(n).trim().toLowerCase()));
    const transactions = annotateRequestStatuses(rows, {
      answers,
      revertFlagById: new Map(entries.map((e) => [String(e._id), Boolean(e.revertRequested)])),
      ticketStatusByNo: new Map(tickets.map((t) => [String(t.ticketNo), t.status])),
      baselineRequestedByCompany: new Map(
        knownFacilities.map((n) => {
          const key = String(n).trim().toLowerCase();
          return [key, requestedSet.has(key)];
        }),
      ),
    });

    res.json({ transactions, total: transactions.length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get distinct company names for filter dropdown
router.get("/companies", async (req, res) => {
  try {
    // Exclude dummy companies from the report's filter dropdown.
    const exclusion = await buildDummyExclusion(wantsIncludeDummy(req));
    const companies = await Transaction.distinct("companyName", exclusion);
    res.json(companies.filter(Boolean).sort());
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get transaction thread for a specific submission
router.get("/thread/:submissionId", async (req, res) => {
  try {
    const key = req.params.submissionId;
    const isObjectId = /^[a-f\d]{24}$/i.test(key);

    // Resolve the entry DETERMINISTICALLY, strongest identity first.
    //
    // The previous version issued one findOne over an $or of every identifier
    // INCLUDING `previousIdNos`. A resubmission carries its ancestor's id in
    // that array, so asking for the ORIGINAL submission could match both it and
    // its successor — and findOne, with no ordering, was free to return either.
    // When it returned the successor, this endpoint answered with a completely
    // different submission's history.
    const lookups = [];
    if (isObjectId) lookups.push({ _id: key });
    lookups.push({ idNo: key });
    lookups.push({ submissionId: key });
    // Only consult the ancestor list once nothing matches this id directly.
    lookups.push({ previousIdNos: key });

    let entry = null;
    for (const lookup of lookups) {
      // eslint-disable-next-line no-await-in-loop -- ordered fallback by design
      entry = await DataSLF.findOne(lookup)
        .setOptions({ includeHiddenYears: true })
        .select("_id submissionId idNo previousIdNos")
        .lean();
      if (entry) break;
    }

    if (!entry) return res.json([]);

    // Scope to THIS entry. `dataEntry` is the real foreign key and is present on
    // 93% of rows; the id fallbacks exist only for legacy transactions written
    // before it, and are restricted to the entry's OWN identifiers so a
    // neighbouring submission can never bleed in.
    const ownKeys = uniq([entry.submissionId, entry.idNo]);
    const filters = [{ dataEntry: entry._id }];
    if (ownKeys.length) {
      // A legacy row is one with no dataEntry at all — a row pointing at a
      // DIFFERENT entry must never be matched by its id fields.
      filters.push({ dataEntry: { $in: [null, undefined] }, submissionId: { $in: ownKeys } });
      filters.push({ dataEntry: { $in: [null, undefined] }, "meta.idNo": { $in: ownKeys } });
    }

    // A SUBMISSION's Transaction History shows what happened to that disposal
    // record — submitted, reverted, resubmitted, acknowledged, cells organized.
    // BASELINE events belong to the facility's baseline, not to any one
    // submission, and are read through their own history.
    //
    // Historical rows were filed against a submission because the baseline routes
    // stamped the newest record's submissionId/dataEntry onto them (fixed at the
    // source in routes/dataSLF.js). Excluding the baseline types here keeps those
    // already-written rows out of this thread too, so the separation holds for
    // existing data without rewriting audit history.
    const baseFilter = { $or: filters, type: { $nin: BASELINE_TXN_TYPES } };
    const transactions = await Transaction.find(baseFilter).sort({ createdAt: -1, _id: -1 }).lean();
    const seen = new Set();
    res.json(transactions.filter((txn) => {
      const id = String(txn._id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * Baseline history for one SLF — the other half of the split above.
 *
 * Baseline events are excluded from a submission's thread, so they need a home
 * of their own; without this the separation would just hide them. Scoped by SLF
 * name because a baseline belongs to the FACILITY, not to a submission — which
 * is exactly why filing these against a submission was wrong in the first place.
 */
router.get("/baseline/:slfName", async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName || "").trim();
    if (!slfName) return res.json([]);
    const rx = new RegExp(`^${slfName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const transactions = await Transaction.find({
      type: { $in: BASELINE_TXN_TYPES },
      $or: [{ companyName: rx }, { "meta.slfName": rx }],
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single transaction by ID
router.get("/:id", async (req, res) => {
  try {
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ message: "Transaction not found" });
    res.json(txn);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a transaction (admin edit)
router.put("/:id", async (req, res) => {
  try {
    const { description, companyName, submittedBy, performedBy, meta } = req.body;
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ message: "Transaction not found" });

    if (description !== undefined) txn.description = description;
    if (companyName !== undefined) txn.companyName = companyName;
    if (submittedBy !== undefined) txn.submittedBy = submittedBy;
    if (performedBy !== undefined) txn.performedBy = performedBy;
    if (meta !== undefined) txn.meta = meta;
    await txn.save();

    res.json({ message: "Transaction updated", data: txn });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete a transaction
router.delete("/:id", async (req, res) => {
  try {
    const txn = await Transaction.findByIdAndDelete(req.params.id);
    if (!txn) return res.status(404).json({ message: "Transaction not found" });
    res.json({ message: "Transaction deleted" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
