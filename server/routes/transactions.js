const express = require("express");
const Transaction = require("../models/Transaction");
const DataSLF = require("../models/DataSLF");
const UserPortal = require("../models/UserPortal");
const { backfillTransactions } = require("../utils/backfillTransactions");
const { wantsIncludeDummy } = require("../utils/dummyFilter");

const router = express.Router();

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

    const transactions = [...byId.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

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
    const dataEntryFilters = [{ submissionId: key }, { idNo: key }, { previousIdNos: key }];
    if (isObjectId) dataEntryFilters.push({ _id: key });
    const entry = await DataSLF.findOne({ $or: dataEntryFilters })
      .setOptions({ includeHiddenYears: true })
      .select("_id submissionId idNo previousIdNos")
      .lean();

    const canonicalKeys = uniq([entry?.submissionId, entry?.idNo, key]);
    const filters = [];
    if (entry?._id) filters.push({ dataEntry: entry._id });
    if (canonicalKeys.length) {
      filters.push({ submissionId: { $in: canonicalKeys } });
      filters.push({ "meta.idNo": { $in: canonicalKeys } });
    }

    if (filters.length === 0) return res.json([]);
    const transactions = await Transaction.find({ $or: filters }).sort({ createdAt: -1, _id: -1 }).lean();
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
