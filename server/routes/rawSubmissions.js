// Submission RAW Data — developer-only maintenance tooling.
//
// Lets a developer inspect and correct raw DataSLF submission records (chiefly
// the identifier fields that submission glitches corrupt: idNo, submissionId,
// slfGenerator, …) and run a capacity/volume analysis over them.
//
// Every route is gated by authMiddleware + developerOnly. The UI also hides the
// tab for non-developers, but THAT IS NOT the access control — this is.
//
// Auditing reuses the two systems already in place:
//   • Transaction — the per-submission audit trail (before/after field values)
//   • writeLog/AppLog — the app-wide action log
// No third audit system is introduced.

const express = require("express");
const mongoose = require("mongoose");
const DataSLF = require("../models/DataSLF");
const SlfFacility = require("../models/SlfFacility");
const Transaction = require("../models/Transaction");
const { authMiddleware, developerOnly } = require("../middleware/auth");
const { writeLog } = require("../utils/logger");
const { refreshAdmin } = require("../utils/socketEmit");
const { getCapacityStatus, capacityStatusExpr, CAPACITY_STATUS_KEYS } = require("../utils/capacityStatus");

const router = express.Router();

// Developer-only, always. Applied to every route in this file.
router.use(authMiddleware, developerOnly);

const TON_PER_M3 = DataSLF.TON_PER_M3 || 0.2;

function actor(req) {
  return req.user?.email || req.user?.username || req.user?.id || "developer";
}

// ── Editable field policy ────────────────────────────────────────────────────
// ONLY these may be written through this tool. Everything else — audit metadata
// (createdAt/updatedAt/previousIdNos), soft-delete markers, revert/approval
// workflow state, and the denormalized metrics (which are recomputed from
// `trucks` on save) — is system-managed and silently ignored if submitted.
//
// `trucks` is deliberately NOT editable here: it drives the volume metrics and
// cell placement, and a malformed edit would corrupt capacity accounting. Volume
// corrections belong in the existing submission editor.
const EDITABLE_FIELDS = {
  // Identifiers — the actual point of this tool.
  idNo: { type: "string", maxLength: 64 },
  submissionId: { type: "string", maxLength: 64 },
  slfGenerator: { type: "objectId", nullable: true },
  slfName: { type: "string", maxLength: 300 },
  // Classification / ownership
  lguCompanyName: { type: "string", maxLength: 300 },
  companyType: { type: "enum", values: ["LGU", "Private"] },
  status: {
    type: "enum",
    values: ["pending", "acknowledged", "rejected", "revert_requested", "reverted"],
  },
  // Location
  address: { type: "string", maxLength: 500 },
  companyRegion: { type: "string", maxLength: 120 },
  companyProvince: { type: "string", maxLength: 120 },
  companyMunicipality: { type: "string", maxLength: 120 },
  companyBarangay: { type: "string", maxLength: 120 },
  // Dates / attribution
  dateOfDisposal: { type: "date" },
  submittedBy: { type: "string", maxLength: 200 },
};

// Validate + coerce a patch against EDITABLE_FIELDS. Returns { values, errors }.
// An invalid ObjectId is rejected outright rather than being cast to null — a
// silently-broken reference is exactly the corruption this tool exists to fix.
function validatePatch(body = {}) {
  const values = {};
  const errors = [];

  for (const [field, rule] of Object.entries(EDITABLE_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const raw = body[field];

    if (raw === null || raw === "") {
      if (rule.nullable) values[field] = null;
      else if (rule.type === "string") values[field] = "";
      else errors.push(`${field} may not be empty`);
      continue;
    }

    if (rule.type === "objectId") {
      if (!mongoose.Types.ObjectId.isValid(String(raw))) {
        errors.push(`${field} is not a valid ObjectId`);
        continue;
      }
      values[field] = new mongoose.Types.ObjectId(String(raw));
    } else if (rule.type === "enum") {
      if (!rule.values.includes(raw)) {
        errors.push(`${field} must be one of: ${rule.values.join(", ")}`);
        continue;
      }
      values[field] = raw;
    } else if (rule.type === "date") {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        errors.push(`${field} is not a valid date`);
        continue;
      }
      values[field] = d;
    } else if (rule.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        errors.push(`${field} must be a number`);
        continue;
      }
      values[field] = n;
    } else {
      const s = String(raw);
      if (rule.maxLength && s.length > rule.maxLength) {
        errors.push(`${field} must be at most ${rule.maxLength} characters`);
        continue;
      }
      values[field] = s.trim();
    }
  }

  // Reject unknown/protected keys loudly instead of quietly dropping them, so a
  // developer never believes they changed a field that was actually ignored.
  const rejected = Object.keys(body).filter(
    (k) => !Object.prototype.hasOwnProperty.call(EDITABLE_FIELDS, k),
  );

  return { values, errors, rejected };
}

// Expose the policy so the UI can build its form from the same source of truth.
router.get("/schema", (_req, res) => {
  res.json({
    editable: Object.entries(EDITABLE_FIELDS).map(([name, rule]) => ({ name, ...rule })),
    capacityStatuses: CAPACITY_STATUS_KEYS,
  });
});

// ── Filter options (for the UI dropdowns) ────────────────────────────────────
// Small distinct lists — not the submissions themselves.
router.get("/filter-options", async (_req, res) => {
  try {
    const [facilities, years, statuses] = await Promise.all([
      SlfFacility.find({ deletedAt: null }).select("lgu province").sort({ lgu: 1 }).lean(),
      DataSLF.distinct("submissionYear", { deletedAt: null }),
      DataSLF.distinct("status", { deletedAt: null }),
    ]);
    res.json({
      facilities: facilities.map((f) => ({ _id: String(f._id), name: f.lgu || "", province: f.province || "" })),
      years: years.filter((y) => Number.isInteger(y)).sort((a, b) => b - a),
      statuses: statuses.filter(Boolean),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Build the shared Mongo filter from the query string. Everything is applied
// server-side — the browser never receives the full collection.
function buildFilter(query = {}) {
  const filter = {};

  if (String(query.includeDeleted) !== "true") filter.deletedAt = null;
  if (String(query.includeDummy) !== "true") filter.isDummy = { $ne: true };

  if (query.submissionId) {
    // Matches the human ID No., the submissionId, or a previously-held ID.
    const rx = new RegExp(String(query.submissionId).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ idNo: rx }, { submissionId: rx }, { previousIdNos: rx }];
  }
  if (query.slfGenerator && mongoose.Types.ObjectId.isValid(String(query.slfGenerator))) {
    filter.slfGenerator = new mongoose.Types.ObjectId(String(query.slfGenerator));
  }
  if (query.companyType) filter.companyType = query.companyType;
  if (query.status) filter.status = query.status;
  if (query.lguCompanyName) {
    filter.lguCompanyName = new RegExp(
      String(query.lguCompanyName).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
  }
  if (query.year) {
    const y = Number(query.year);
    if (Number.isInteger(y)) filter.submissionYear = y;
  }
  if (query.month) {
    const m = Number(query.month);
    if (Number.isInteger(m)) filter.submissionMonth = m;
  }
  if (query.dateFrom || query.dateTo) {
    filter.dateOfDisposal = {};
    if (query.dateFrom) filter.dateOfDisposal.$gte = new Date(query.dateFrom);
    if (query.dateTo) filter.dateOfDisposal.$lte = new Date(query.dateTo);
  }
  return filter;
}

// ── VOLUME ANALYSIS ──────────────────────────────────────────────────────────
// Submitted waste volume vs. the SLF cell capacity it was disposed into.
//
// Semantics are the app's existing ones, not new formulas:
//   • submitted volume  — trucks[].actualVolume, the same field computeSlfMetrics
//                         sums, converted to m³ with the model's TON_PER_M3.
//   • used capacity     — SlfFacility.cellFillValues[i]  (what Cell Infra
//                         Overview already treats as the cell's used capacity)
//   • capacity          — SlfFacility.cellCapacities[i]
//   • utilization       — used / capacity * 100      (UNclamped, so >100 shows)
//   • overcapacity      — max(0, used - capacity)
//
// Everything — including the classification, filtering, sorting and paging — runs
// in the aggregation. The browser receives one page of already-analysed rows.
//
// Registered BEFORE "/:id" so Express doesn't route it as an id.

// `arr[idx]`, guarding the negative index $indexOfArray returns on a miss
// ($arrayElemAt with -1 silently yields the LAST element).
const elemAt = (arrExpr, idxExpr) => ({
  $cond: [
    { $eq: [idxExpr, null] },
    null,
    { $arrayElemAt: [{ $ifNull: [arrExpr, []] }, idxExpr] },
  ],
});

// Normalize a (value, unit) pair to m³ using the model's conversion ratio.
const toM3 = (valExpr, unitExpr) => ({
  $let: {
    vars: { v: valExpr, u: { $toLower: { $ifNull: [unitExpr, "m³"] } } },
    in: {
      $cond: [
        { $not: [{ $isNumber: "$$v" }] },
        null,
        { $cond: [{ $eq: ["$$u", "tons"] }, { $divide: ["$$v", TON_PER_M3] }, "$$v"] },
      ],
    },
  },
});

const hasCapacity = {
  $and: [{ $isNumber: "$capacityM3" }, { $gt: ["$capacityM3", 0] }, { $isNumber: "$usedM3" }],
};

router.get("/volume-analysis", async (req, res) => {
  try {
    const startedAt = Date.now();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const sortKey = ["utilizationPercentage", "overcapacityAmountM3", "submittedVolumeM3", "dateOfDisposal"].includes(
      req.query.sortBy,
    )
      ? req.query.sortBy
      : "utilizationPercentage";
    const sortDir = String(req.query.sortDir) === "asc" ? 1 : -1;

    // Post-analysis filters (they depend on computed fields).
    const postMatch = {};
    if (req.query.analysisStatus) postMatch.analysisStatus = req.query.analysisStatus;
    if (req.query.cellType) postMatch.cellType = new RegExp(String(req.query.cellType), "i");

    const pipeline = [
      { $match: buildFilter(req.query) },
      { $unwind: "$trucks" },
      { $match: { "trucks.actualVolume": { $gt: 0 } } },
      {
        $lookup: {
          from: "slf_facilities",
          localField: "slfGenerator",
          foreignField: "_id",
          as: "_fac",
          pipeline: [
            {
              $project: {
                lgu: 1,
                province: 1,
                cellNames: 1,
                cellCapacities: 1,
                cellCapacityUnits: 1,
                cellFillValues: 1,
                cellFillUnits: 1,
                cellTypes: 1,
                cellStatuses: 1,
              },
            },
          ],
        },
      },
      { $addFields: { _fac: { $arrayElemAt: ["$_fac", 0] } } },
      {
        $addFields: {
          // Trucks reference their cell by index; older rows only carry the name.
          _cellIdx: {
            $let: {
              vars: {
                idx: {
                  $cond: [
                    { $isNumber: "$trucks.cellIndex" },
                    "$trucks.cellIndex",
                    {
                      $indexOfArray: [
                        { $ifNull: ["$_fac.cellNames", []] },
                        { $ifNull: ["$trucks.cellName", " "] },
                      ],
                    },
                  ],
                },
              },
              in: { $cond: [{ $gte: ["$$idx", 0] }, "$$idx", null] },
            },
          },
          _volM3: toM3("$trucks.actualVolume", "$trucks.actualVolumeUnit"),
        },
      },
      // One row per (submission, cell): a submission that split its trucks across
      // two cells produces two analysis rows.
      {
        $group: {
          _id: { submission: "$_id", cellIndex: "$_cellIdx" },
          idNo: { $first: "$idNo" },
          submissionId: { $first: "$submissionId" },
          slfGenerator: { $first: "$slfGenerator" },
          slfName: { $first: "$slfName" },
          lguCompanyName: { $first: "$lguCompanyName" },
          companyType: { $first: "$companyType" },
          status: { $first: "$status" },
          dateOfDisposal: { $first: "$dateOfDisposal" },
          truckCellName: { $first: "$trucks.cellName" },
          submittedVolumeM3: { $sum: "$_volM3" },
          _fac: { $first: "$_fac" },
        },
      },
      {
        $addFields: {
          submissionRef: "$_id.submission",
          cellIndex: "$_id.cellIndex",
          slfLabel: { $ifNull: ["$_fac.lgu", "$slfName"] },
          slfProvince: "$_fac.province",
          cellName: {
            $ifNull: ["$truckCellName", elemAt("$_fac.cellNames", "$_id.cellIndex")],
          },
          cellType: elemAt("$_fac.cellTypes", "$_id.cellIndex"),
          cellStatus: elemAt("$_fac.cellStatuses", "$_id.cellIndex"),
          capacityM3: toM3(
            elemAt("$_fac.cellCapacities", "$_id.cellIndex"),
            elemAt("$_fac.cellCapacityUnits", "$_id.cellIndex"),
          ),
          usedM3: toM3(
            elemAt("$_fac.cellFillValues", "$_id.cellIndex"),
            elemAt("$_fac.cellFillUnits", "$_id.cellIndex"),
          ),
        },
      },
      {
        $addFields: {
          utilizationPercentage: {
            $cond: [hasCapacity, { $multiply: [{ $divide: ["$usedM3", "$capacityM3"] }, 100] }, null],
          },
          overcapacityAmountM3: {
            $cond: [hasCapacity, { $max: [0, { $subtract: ["$usedM3", "$capacityM3"] }] }, null],
          },
          remainingCapacityM3: {
            $cond: [hasCapacity, { $subtract: ["$capacityM3", "$usedM3"] }, null],
          },
        },
      },
      { $addFields: { analysisStatus: capacityStatusExpr("$utilizationPercentage") } },
      ...(Object.keys(postMatch).length ? [{ $match: postMatch }] : []),
      { $project: { _fac: 0, truckCellName: 0 } },
      {
        // One pass produces the page, the total, and the status breakdown.
        $facet: {
          rows: [{ $sort: { [sortKey]: sortDir, _id: 1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
          total: [{ $count: "count" }],
          summary: [
            {
              $group: {
                _id: "$analysisStatus",
                count: { $sum: 1 },
                overcapacityM3: { $sum: { $ifNull: ["$overcapacityAmountM3", 0] } },
              },
            },
          ],
        },
      },
    ];

    const [result] = await DataSLF.aggregate(pipeline)
      .option({ includeHiddenYears: true })
      .allowDiskUse(true);

    const total = result?.total?.[0]?.count || 0;
    const summary = Object.fromEntries(
      (result?.summary || []).map((s) => [s._id, { count: s.count, overcapacityM3: s.overcapacityM3 }]),
    );
    const durationMs = Date.now() - startedAt;

    if (durationMs > 3000) {
      writeLog("warn", "volume-analysis.slow", {
        message: `Volume analysis took ${durationMs}ms (${total} rows)`,
        user: actor(req),
        meta: { durationMs, total },
      });
    }

    res.json({
      rows: result?.rows || [],
      total,
      page,
      pageSize,
      summary,
      durationMs,
      unit: "m³",
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── LIST: paginated, projected, server-filtered ──────────────────────────────
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const filter = buildFilter(req.query);

    const sortField = ["createdAt", "dateOfDisposal", "idNo", "slfName", "status"].includes(req.query.sortBy)
      ? req.query.sortBy
      : "createdAt";
    const sortDir = String(req.query.sortDir) === "asc" ? 1 : -1;

    // Projection: list columns only — never the trucks[] payload.
    const [rows, total] = await Promise.all([
      DataSLF.find(
        filter,
        "idNo submissionId slfGenerator slfName lguCompanyName companyType companyProvince address " +
          "dateOfDisposal status submittedBy isDummy deletedAt createdAt updatedAt " +
          "truckCount totalVolumeM3 totalVolumeTons submissionYear submissionMonth",
      )
        .setOptions({ includeHiddenYears: true })
        .sort({ [sortField]: sortDir })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      DataSLF.countDocuments(filter).setOptions({ includeHiddenYears: true }),
    ]);

    res.json({ rows, total, page, pageSize });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── READ one: the full raw document ──────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }
    const doc = await DataSLF.findById(req.params.id)
      .setOptions({ includeHiddenYears: true })
      .lean();
    if (!doc) return res.status(404).json({ message: "Submission not found" });
    res.json(doc);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── UPDATE: validated, audited field-level correction ────────────────────────
router.put("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }

    const { values, errors, rejected } = validatePatch(req.body);
    if (errors.length) return res.status(400).json({ message: "Validation failed", errors });
    if (!Object.keys(values).length) {
      return res.status(400).json({
        message: rejected.length
          ? `No editable fields in request. Rejected (system-managed): ${rejected.join(", ")}`
          : "No editable fields in request.",
      });
    }

    const before = await DataSLF.findById(req.params.id)
      .setOptions({ includeHiddenYears: true })
      .lean();
    if (!before) return res.status(404).json({ message: "Submission not found" });

    // A re-pointed slfGenerator must reference a facility that actually exists —
    // otherwise the "fix" silently creates a dangling reference.
    if (values.slfGenerator) {
      const exists = await SlfFacility.exists({ _id: values.slfGenerator });
      if (!exists) {
        return res.status(400).json({ message: "slfGenerator does not reference an existing SLF facility" });
      }
    }
    // idNo is the submission's public identity — never let two records collide.
    if (values.idNo && values.idNo !== before.idNo) {
      const clash = await DataSLF.exists({ idNo: values.idNo, _id: { $ne: before._id } })
        .setOptions({ includeHiddenYears: true });
      if (clash) return res.status(409).json({ message: `ID No. ${values.idNo} is already in use` });
    }

    // Only fields that actually changed become an audit entry.
    const changedFields = Object.keys(values).filter(
      (k) => String(before[k] ?? "") !== String(values[k] ?? ""),
    );
    if (!changedFields.length) {
      return res.json({ message: "No changes.", changedFields: [], submission: before });
    }

    const update = { $set: values };
    // Preserve ID history the same way the repair tooling does.
    if (values.idNo && values.idNo !== before.idNo) {
      update.$addToSet = { previousIdNos: before.idNo };
    }

    const after = await DataSLF.findByIdAndUpdate(req.params.id, update, { new: true })
      .setOptions({ includeHiddenYears: true })
      .lean();

    const changes = changedFields.map((field) => ({
      field,
      previousValue: before[field] ?? null,
      newValue: after[field] ?? null,
    }));

    // Audit → existing Transaction trail (per-submission) + AppLog (app-wide).
    await Transaction.create({
      submissionId: after.submissionId || after.idNo || String(after._id),
      dataEntry: after._id,
      companyName: after.lguCompanyName,
      companyType: after.companyType,
      submittedBy: after.submittedBy,
      type: "admin_edit",
      description: `RAW data edit — ${changedFields.join(", ")}`,
      performedBy: actor(req),
      meta: { rawDataEdit: true, changedFields, changes, idNo: after.idNo },
    });
    writeLog("warn", "raw-submission.update", {
      message: `RAW submission ${before.idNo || before._id} edited (${changedFields.join(", ")})`,
      user: actor(req),
      ip: req.ip,
      meta: { submissionId: String(before._id), changes },
    });

    refreshAdmin(req, "submissions");
    res.json({ message: `Updated ${changedFields.length} field(s).`, changedFields, changes, submission: after });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── DELETE: soft by default (the schema supports it), hard only on demand ─────
router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }
    const doc = await DataSLF.findById(req.params.id)
      .setOptions({ includeHiddenYears: true })
      .lean();
    if (!doc) return res.status(404).json({ message: "Submission not found" });

    // Hard delete is irreversible, so it requires an explicit confirmation token
    // echoing the record's own ID No. — a stray `?hard=true` cannot destroy data.
    const hard = String(req.query.hard) === "true";
    if (hard) {
      const expected = doc.idNo || String(doc._id);
      if (String(req.query.confirm || "") !== expected) {
        return res.status(400).json({
          message: `Hard delete requires ?confirm=<ID No.>. Expected "${expected}".`,
        });
      }
      await DataSLF.deleteOne({ _id: doc._id });
      writeLog("error", "raw-submission.hard-delete", {
        message: `RAW submission ${expected} PERMANENTLY deleted`,
        user: actor(req),
        ip: req.ip,
        meta: { submissionId: String(doc._id), idNo: doc.idNo, snapshot: doc },
      });
      refreshAdmin(req, "submissions");
      return res.json({ message: `Permanently deleted ${expected}.`, hard: true });
    }

    await DataSLF.updateOne(
      { _id: doc._id },
      { $set: { deletedAt: new Date(), deletedBy: actor(req) } },
    );
    await Transaction.create({
      submissionId: doc.submissionId || doc.idNo || String(doc._id),
      dataEntry: doc._id,
      companyName: doc.lguCompanyName,
      companyType: doc.companyType,
      submittedBy: doc.submittedBy,
      type: "admin_edit",
      description: "RAW data soft delete",
      performedBy: actor(req),
      meta: { rawDataDelete: true, soft: true, idNo: doc.idNo },
    });
    writeLog("warn", "raw-submission.soft-delete", {
      message: `RAW submission ${doc.idNo || doc._id} soft-deleted`,
      user: actor(req),
      ip: req.ip,
      meta: { submissionId: String(doc._id), idNo: doc.idNo },
    });
    refreshAdmin(req, "submissions");
    res.json({ message: `Soft-deleted ${doc.idNo || doc._id}. It can still be restored.`, hard: false });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Restore a soft-deleted record (the counterpart that makes soft delete useful).
router.post("/:id/restore", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }
    const doc = await DataSLF.findById(req.params.id).setOptions({ includeHiddenYears: true }).lean();
    if (!doc) return res.status(404).json({ message: "Submission not found" });
    if (!doc.deletedAt) return res.status(400).json({ message: "Submission is not deleted" });

    await DataSLF.updateOne({ _id: doc._id }, { $set: { deletedAt: null, deletedBy: null } });
    writeLog("warn", "raw-submission.restore", {
      message: `RAW submission ${doc.idNo || doc._id} restored`,
      user: actor(req),
      ip: req.ip,
      meta: { submissionId: String(doc._id), idNo: doc.idNo },
    });
    refreshAdmin(req, "submissions");
    res.json({ message: `Restored ${doc.idNo || doc._id}.` });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
module.exports.buildFilter = buildFilter;
module.exports.TON_PER_M3 = TON_PER_M3;
module.exports.getCapacityStatusFn = getCapacityStatus;
module.exports.capacityStatusExprFn = capacityStatusExpr;
