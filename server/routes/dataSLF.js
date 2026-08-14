const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const DataSLF = require("../models/DataSLF");
const SLFGenerator = require("../models/SLFGenerator");
const SlfFacility = require("../models/SlfFacility");
const { sendAcknowledgementEmail, sendBulkAcknowledgeEmail, sendSubmissionEmail } = require("../utils/email");
const { writeLog } = require("../utils/logger");
const Transaction = require("../models/Transaction");
const Notification = require("../models/Notification");
const UserPortal = require("../models/UserPortal");
const Region3Lgu = require("../models/Region3Lgu");
// Shared municipality/region resolution — the SAME masterlist matcher and
// Region III classifier the LGU dashboard uses, so a client's municipality is
// classified identically in both modules.
const { matchClient } = require("../utils/lguMatch");
const { getRegion3ProvinceSet, classifyRegion } = require("../utils/region3");
const { notifyAdmin, notifyPortal, refreshAdmin, refreshPortal } = require("../utils/socketEmit");
const { cacheJson } = require("../middleware/cacheRoute");
const {
  SUMMARY_BY_SLF_CACHE_KEY,
  STATS_CACHE_PREFIX,
  CELL_USAGE_CACHE_PREFIX,
  WASTE_RECEIVED_PREFIX,
  ADMIN_SUBMISSIONS_PREFIX,
  ADMIN_ANALYTICS_KEY,
  ADMIN_SUMMARY_DASHBOARD_KEY,
  CELL_PLACEMENT_PREFIX,
  BASELINES_CACHE_PREFIX,
} = require("../utils/cacheKeys");
const { isBataanSlfName } = require("../utils/mergeBataanSlf");
const {
  isOperationalStatus,
  cellExists,
  evaluateFacilityCellAcceptance,
  toBaseM3,
} = require("../utils/cellAvailability");
const { authMiddleware, requireAnyAuth, adminOnly, developerOnly, requirePermission } = require("../middleware/auth");
const { requirePortalRule } = require("../utils/portalPolicy");
const { resolveTotalVolumeForUpdate } = require("../utils/baselineVolume");
const {
  computeCellOccupancy,
  applyPreBaselineRule,
  preBaselineExclusionEnabled,
  OCCUPANCY_CALC_VERSION,
  OCCUPANCY_ENTRY_FIELDS,
  ACTIVE_VOLUME_STATUSES,
  normalizeCellStatus,
  isActiveCellStatus,
  displayUnit,
} = require("../utils/cellOccupancy");
const {
  resolveCellName,
  collectCellNames,
  applyResolvedCellNames,
  applyResolvedCellNamesToAll,
  resolveBaselineCellEntries,
} = require("../utils/cellNaming");
const { todayRange } = require("../utils/appTime");
const { NON_DUMMY_CLAUSE } = require("../utils/dummyFilter");
const {
  validateWasteGeneration,
  validateTransportUnits,
  validateTruckCapacityElevation,
} = require("../utils/wasteGenerationValidation");
// Named to avoid colliding with this file's own `normalizeVolumeUnit`, which is a
// lenient SANITIZER for Excel-imported free text (it always yields a unit). These
// are the strict shared helpers: they return "" / null rather than guessing.
const {
  normalizeUnit: strictNormalizeUnit,
  convertVolume: convertVolumeStrict,
  TON_PER_M3,
  toM3Expr,
} = require("../utils/volumeUnits");
const {
  normalizeWasteType: normalizeWasteCategory,
  isHazardousWasteType,
} = require("../utils/wasteCategories");
const jwt = require("jsonwebtoken");

// Optional auth: decode the JWT when present so role-aware behaviour (e.g.
// exposing dummy/sample submissions only to developers) is possible on routes
// that don't otherwise require a token. Never rejects — req.user stays undefined
// for anonymous/token-less callers.
function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      /* ignore invalid token — treat as anonymous */
    }
  }
  next();
}

// Push the unit the PORTAL declared (its baseline "Unit of Measurement") onto the
// linked SLF facility, so the admin side reads the same declared unit.
//
// The portal is the source of truth for the WASTE VOLUME unit: it is where the
// operator declares what they are reporting in. The admin, however, reads the unit
// off the facility (`wasteReceivedUnit`, `cellFillUnits`) — so without this the two
// sides could disagree about what a number means.
//
// Deliberately limited to the fields the portal actually owns:
//   • wasteReceivedUnit / estimatedVolumeWasteUnit — waste RECEIVED (portal-declared)
//   • cellFillUnits[]                              — how full a cell is (portal-driven)
// It never touches cellCapacityUnits / volumeCapacityUnit: those describe capacities
// the ADMIN entered, and re-labelling them without converting the values would
// silently reinterpret every capacity in the facility.
//
// Existing cellFillValues are CONVERTED into the new unit so the stored numbers stay
// truthful rather than merely being re-labelled.
async function syncFacilityDeclaredUnit(slfGeneratorId, declaredUnit) {
  const unit = strictNormalizeUnit(declaredUnit);
  if (!slfGeneratorId || !unit) return;
  try {
    const facility = await SlfFacility.findById(slfGeneratorId).select(
      "wasteReceivedUnit estimatedVolumeWasteUnit cellFillUnits cellFillValues",
    );
    if (!facility) return;
    if (strictNormalizeUnit(facility.wasteReceivedUnit) === unit) return; // already agrees

    const fills = facility.cellFillValues || [];
    const fillUnits = facility.cellFillUnits || [];
    const convertedFills = fills.map((value, i) => {
      const from = strictNormalizeUnit(fillUnits[i] || facility.wasteReceivedUnit);
      const converted = convertVolumeStrict(value, from, unit);
      // Unconvertible (missing/unknown unit) → leave the value untouched rather
      // than writing a guessed number.
      return converted === null ? value : converted;
    });

    facility.wasteReceivedUnit = unit;
    facility.estimatedVolumeWasteUnit = unit;
    facility.cellFillValues = convertedFills;
    facility.cellFillUnits = fills.map(() => unit);
    await facility.save();

    writeLog("info", "slf.unit-sync", {
      message: `Facility declared unit synced to portal unit "${unit}"`,
      meta: { facilityId: String(slfGeneratorId), unit },
    });
  } catch (err) {
    // Never fail a submission because the unit sync failed — the submission's own
    // units are stored on the record and every read path normalizes from them.
    writeLog("error", "slf.unit-sync.failed", {
      message: `Facility unit sync failed: ${err.message}`,
      meta: { facilityId: String(slfGeneratorId) },
    });
  }
}

// Returns the portal user id a DEVELOPER-context token is pointed at, or null.
// Used to refuse portal WRITES from a read-only Developer Portal Mode session
// (see utils/portalContext.js). Never throws on a bad/absent token.
function getDeveloperPortalContext(req) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded?.role === "developer" && decoded?.portalContextUserId) {
      return String(decoded.portalContextUserId);
    }
  } catch {
    /* not our problem here — the route's own auth handles invalid tokens */
  }
  return null;
}

/**
 * May this caller see test/dummy data?
 *
 * Developers manage test data. A DEMO admin also qualifies: everything it can
 * reach in the dummy views is synthetic by construction (`isDummy: true`), so
 * this grants access to nothing real — and without it a demonstration cannot
 * show its own submission, which is the point of the demo environment.
 */
function canManageTestData(req) {
  return req.user?.role === "developer" || req.user?.isDemo === true;
}

// Only authorized callers may opt into seeing dummy/sample submissions inline.
function devWantsDummy(req) {
  return canManageTestData(req) &&
    String(req.query.includeDummy || "").toLowerCase() === "true";
}

// The Dummy Submissions tab: return ONLY test/demo records.
function devWantsDummyOnly(req) {
  return canManageTestData(req) &&
    String(req.query.dummyOnly || "").toLowerCase() === "true";
}

/**
 * Reject a dummy-data request from a caller who may not manage test data.
 *
 * Hiding the tab in the UI is not access control — the endpoint has to refuse
 * too, or anyone can read (or enumerate) test records by adding the query
 * parameter by hand. Returns true when the request was rejected.
 */
function rejectUnauthorizedDummyAccess(req, res) {
  const asked =
    String(req.query.includeDummy || "").toLowerCase() === "true" ||
    String(req.query.dummyOnly || "").toLowerCase() === "true";
  if (!asked) return false;
  if (canManageTestData(req)) return false;
  writeLog("warn", "submissions.dummy_access_denied", {
    message: "Unauthorized request for dummy/test submissions",
    user: req.logUser || req.user?.email || "",
    ip: req.ip,
    meta: { role: req.user?.role || "none", includeDummy: req.query.includeDummy, dummyOnly: req.query.dummyOnly },
  });
  res.status(403).json({
    message: "Test/dummy submissions are restricted to developer and demonstration accounts.",
    code: "DUMMY_ACCESS_DENIED",
  });
  return true;
}

const SLF_GENERATOR_REF_FIELDS = "_id lgu ownership slfName province dataYear cellNames";

// Province code mapping (mirrors DataSLF model)
const PROVINCE_CODES = {
  aurora: "AU", bataan: "BA", bulacan: "BU",
  "nueva ecija": "NE", nueva_ecija: "NE",
  pampanga: "PA", tarlac: "TA", zambales: "ZA",
};
const PSGC_PROVINCE_CODES = DataSLF.PSGC_PROVINCE_CODES || {};
function getProvinceCode(province) {
  if (!province) return "XX";
  const raw = String(province).trim();
  if (PSGC_PROVINCE_CODES[raw]) return PSGC_PROVINCE_CODES[raw];
  const key = raw.toLowerCase().replace(/^province of\s+/i, "").replace(/[_-]+/g, " ").trim();
  return PROVINCE_CODES[key] || raw.substring(0, 2).toUpperCase();
}

/**
 * Recompute and PERSIST a facility's per-cell occupancy.
 *
 * The calculation itself lives in utils/cellOccupancy.js and is shared with the
 * portal facility endpoint. This function previously carried its own copy that
 * counted portal trucks ONLY — the baseline (totalVolumeAccepted /
 * activeCell*Volume / activeCellEntries) was never included, and trucks without
 * an explicit in-range cellIndex were dropped entirely. Because these are the
 * values written to SlfFacility, every consumer that reads the stored document
 * (admin dashboard, portal tiles) saw a smaller total than the portal facility
 * endpoint computed — the "Submitted Volume does not match Baseline Breakdown"
 * defect. There is now exactly one implementation.
 */
async function refreshFacilityCellOccupancy(req, facilityId) {
  if (!facilityId || !mongoose.Types.ObjectId.isValid(String(facilityId))) return null;
  const facility = await SlfFacility.findById(facilityId)
    .select(
      "numberOfCell cellNames cellStatuses cellTypes cellCapacities cellCapacityUnits " +
      // cellFillValues + cellFillOverridden are READ here, not just written: a
      // cell whose Waste in Cell an admin declared keeps that figure through the
      // recompute. Without them in the projection the override was invisible to
      // computeCellOccupancy and the next submission wiped it.
      "cellFillValues cellFillOverridden cellFillUnits wasteReceivedUnit volumeCapacityUnit",
    )
    .lean();
  if (!facility) return null;
  const cellCount = Math.max(
    Number(facility.numberOfCell || 0),
    facility.cellNames?.length || 0,
    facility.cellStatuses?.length || 0,
    facility.cellCapacities?.length || 0,
  );
  if (cellCount <= 0) return null;

  const entries = await DataSLF.find({
    slfGenerator: facility._id,
    deletedAt: null,
    isDummy: { $ne: true },
  })
    // `dateOfDisposal` is what the pre-baseline rule compares against.
    .select(`${OCCUPANCY_ENTRY_FIELDS} dateOfDisposal`)
    .sort({ createdAt: -1 })
    .lean();

  // The PERSISTED figures must be the same ones every reader computes. Applying
  // the pre-baseline rule only on the read side left this function writing
  // cellFillValues that included submissions the dashboards excluded — so the
  // portal's capacity gate and the admin's gauges disagreed for exactly the
  // facilities whose disposals predate their baseline encoding.
  const { counted } = applyPreBaselineRule(entries, {
    exclude: await preBaselineExclusionEnabled(),
  });
  const occupancy = computeCellOccupancy(facility, counted, { unitSource: entries });
  const updated = await SlfFacility.findByIdAndUpdate(
    facility._id,
    {
      $set: {
        cellFillValues: occupancy.cellFillValues,
        cellFillUnits: occupancy.cellFillUnits,
        actualResidualWasteReceived: occupancy.totalVolume,
        wasteReceivedUnit: occupancy.unit,
        // Persisted provenance split so the dashboards can colour baseline vs
        // submitted contributions without re-deriving (and re-diverging).
        cellFillBaselineValues: occupancy.cellFillBaselineValues,
        cellFillSubmittedValues: occupancy.cellFillSubmittedValues,
        baselineVolumeTotal: occupancy.baselineTotal,
        submittedVolumeTotal: occupancy.submittedTotal,
        // Stamped so the repair sweep can tell figures written by the CURRENT
        // calculation from ones an older version left behind.
        cellOccupancyVersion: OCCUPANCY_CALC_VERSION,
      },
    },
    { returnDocument: "after" },
  ).lean();
  refreshAdmin(req, "facility");
  const assigned = await UserPortal.find({ assignedSlf: facility._id }).select("email").lean().catch(() => []);
  assigned.forEach((pu) => pu.email && refreshPortal(req, pu.email, "facility"));
  return updated;
}

/**
 * Refresh occupancy for a set of facilities, de-duplicated.
 *
 * Every lifecycle event that changes whether a submission's volume COUNTS —
 * submit, resubmit, revert/acknowledge, delete/restore, cell assignment — has to
 * land here, because `cellFillValues` is a persisted denormalization that the
 * capacity gate and the dashboard gauges both read.
 *
 * Best-effort by design: a failure to refresh a derived figure must never fail
 * the user's actual operation. The next event (or the Organize Cells path)
 * recomputes from scratch anyway.
 */
async function refreshOccupancyForFacilities(req, facilityIds = []) {
  const unique = [...new Set(
    (Array.isArray(facilityIds) ? facilityIds : [facilityIds])
      .map((id) => (id ? String(id) : ""))
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id)),
  )];
  for (const id of unique) {
    try {
      await refreshFacilityCellOccupancy(req, id);
    } catch (error) {
      writeLog("warn", "cell_occupancy.refresh_failed", {
        message: `Could not refresh cell occupancy for facility ${id}: ${error.message}`,
        meta: { facilityId: id },
      });
    }
  }
}

function getNameVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const noParens = raw.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const withoutPrefix = noParens
    .replace(/^province\s+of\s+/i, "")
    .replace(/^(local\s+governm\s*ent\s+unit|lgu|municipality\s+of|city\s+of)\s*[-:\u2012-\u2015]?\s*/i, "")
    .trim();
  const firstCommaPart = withoutPrefix.split(",")[0]?.trim();
  return [...new Set([raw, noParens, withoutPrefix, firstCommaPart].filter(Boolean))];
}

function normalizeSlfName(value) {
  return String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
    .replace(/\blgu\b/gi, " ")
    .replace(/\bmunicipality\s+of\b/gi, " ")
    .replace(/\bcity\s+of\b/gi, " ")
    .replace(/^province\s+of\s+/i, "")
    .replace(/[\u2012-\u2015-]+/g, " ")
    .replace(/[,.;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getBaselineNameKeys(item) {
  return [item?.slfName, item?.lguCompanyName]
    .flatMap((name) => getNameVariants(name))
    .map((name) => normalizeSlfName(name))
    .filter(Boolean);
}

function matchesBaselineName(item, requestedName) {
  const requestedKeys = getNameVariants(requestedName).map((name) => normalizeSlfName(name)).filter(Boolean);
  const itemKeys = getBaselineNameKeys(item);
  return requestedKeys.some((key) => itemKeys.includes(key));
}

function matchesSlfIdentity(item, requestedName) {
  if (matchesBaselineName(item, requestedName)) return true;
  if (isBataanSlfName(requestedName)) {
    return isBataanSlfName(item?.slfName) || isBataanSlfName(item?.lguCompanyName);
  }
  return false;
}

const isResubmissionEntry = (e) =>
  Array.isArray(e?.previousIdNos) && e.previousIdNos.length > 0;

const isSlfNonOperational = (statusOfSLF) => /non/i.test(String(statusOfSLF || ""));

// STRICT chronological order: newest submission first.
//
// Replaces `resubmissionFirst`, which ranked unacknowledged records ahead of
// acknowledged ones and compared updatedAt for resubmissions against createdAt
// for everything else. That made the list non-chronological AND made a row move
// when it was approved. `_id` breaks ties deterministically (ObjectIds are
// monotonic), so the order is identical across refreshes and pages.
const chronologicalNewestFirst = (a, b) => {
  const at = new Date(a?.createdAt || a?.updatedAt || 0).getTime() || 0;
  const bt = new Date(b?.createdAt || b?.updatedAt || 0).getTime() || 0;
  if (at !== bt) return bt - at;
  return String(b?._id || "").localeCompare(String(a?._id || ""));
};

async function resolveSlfRecordIds(slfName, { requireBaselineData = false, slfGenerator = null } = {}) {
  const variants = getNameVariants(slfName);
  if (variants.length === 0 && !slfGenerator) return [];

  const orClauses = [];
  variants.forEach((name) => {
    const rx = new RegExp(`^${escapeRegExp(name)}`, "i");
    orClauses.push({ slfName: rx });
    orClauses.push({ lguCompanyName: rx });
  });
  if (slfGenerator && mongoose.Types.ObjectId.isValid(String(slfGenerator))) {
    orClauses.push({ slfGenerator });
  }
  // For the merged BESLF site, widen the candidate scan to every Bataan-ish record
  // so aliases that don't share a prefix are still considered.
  if (isBataanSlfName(slfName)) {
    orClauses.push({ slfName: /bataan/i });
    orClauses.push({ lguCompanyName: /bataan/i });
  }
  if (orClauses.length === 0) return [];

  // The identity fields are all this needs; whether a record HAS baseline data is
  // reduced to one boolean in the database.
  //
  // This used to project the full baseline payload — activeCellEntries,
  // closedCellEntries and the whole accreditedHaulers array — for every candidate
  // just so hasBaselineData() could test them in JS. Measured on production data
  // that was 773 KB across 62 documents and 392 ms; the projection below is
  // 13 KB and 56 ms for the same result. Baseline approval calls this on every
  // request, so it was the bulk of the wait.
  const candidates = await DataSLF.aggregate([
    { $match: { $or: orClauses } },
    {
      $project: {
        slfName: 1,
        lguCompanyName: 1,
        slfGenerator: 1,
        _hasBaseline: {
          $or: [
            { $ne: [{ $ifNull: ["$totalVolumeAccepted", null] }, null] },
            { $ne: [{ $ifNull: ["$activeCellResidualVolume", null] }, null] },
            { $ne: [{ $ifNull: ["$activeCellInertVolume", null] }, null] },
            { $ne: [{ $ifNull: ["$activeCellHazardousVolume", null] }, null] },
            { $ne: [{ $ifNull: ["$closedCellResidualVolume", null] }, null] },
            { $ne: [{ $ifNull: ["$closedCellInertVolume", null] }, null] },
            { $ne: [{ $ifNull: ["$closedCellHazardousVolume", null] }, null] },
            { $gt: [{ $size: { $ifNull: ["$activeCellEntries", []] } }, 0] },
            { $gt: [{ $size: { $ifNull: ["$closedCellEntries", []] } }, 0] },
            { $gt: [{ $size: { $ifNull: ["$accreditedHaulers", []] } }, 0] },
          ],
        },
      },
    },
  ]).option({ includeHiddenYears: true });

  const matched = candidates.filter((item) => {
    if (slfGenerator && String(item.slfGenerator || "") === String(slfGenerator)) return true;
    return matchesSlfIdentity(item, slfName);
  });
  const finalMatched = requireBaselineData ? matched.filter((item) => item._hasBaseline) : matched;
  return [...new Set(finalMatched.map((item) => String(item._id)).filter(Boolean))];
}

/**
 * Re-align the ID No. sequence for one `SLF-TYPE-PROV-` prefix against what is
 * ACTUALLY in the database. Run after a record is permanently deleted, because
 * that is the only point at which a sequence number is genuinely released.
 *
 * What it repairs: DUPLICATE ID Nos. Two records sharing an ID is the one broken
 * state — it makes an ID ambiguous in search, exports, transactions and e-mails.
 * The OLDEST record keeps the ID (it is the one already referenced elsewhere);
 * every later duplicate is moved to the next free number in the prefix and its
 * old value is recorded in `previousIdNos`, the same trail a companyType-driven
 * ID change already leaves.
 *
 * What it deliberately does NOT do: renumber records to close gaps. An ID No. is
 * a permanent business reference — it is quoted in Transactions, Notifications,
 * follow-up e-mails and printed reports — so a gap left by a deleted submission
 * is correct history, not damage. Compacting the sequence would silently
 * invalidate every one of those references.
 *
 * A soft delete does NOT call this: a trashed record still owns its ID and can
 * be restored.
 */
async function realignIdNoSequence(idNo) {
  const parts = String(idNo || "").split("-");
  if (parts.length < 4 || parts[0] !== "SLF") return { prefix: null, repaired: [] };
  const prefix = `SLF-${parts[1]}-${parts[2]}-`;

  const siblings = await DataSLF.find({ idNo: new RegExp(`^${escapeRegExp(prefix)}`) })
    .setOptions({ includeHiddenYears: true })
    .select("idNo createdAt")
    .lean();
  if (siblings.length < 2) return { prefix, repaired: [] };

  const seqOf = (value) => {
    const n = parseInt(String(value || "").split("-")[3], 10);
    return Number.isFinite(n) ? n : null;
  };
  // Oldest first, so the record that has carried the ID longest keeps it.
  siblings.sort((a, b) => {
    const at = new Date(a.createdAt || 0).getTime();
    const bt = new Date(b.createdAt || 0).getTime();
    if (at !== bt) return at - bt;
    return String(a._id).localeCompare(String(b._id));
  });

  const used = new Set(siblings.map((doc) => seqOf(doc.idNo)).filter((n) => n !== null));
  let highest = used.size ? Math.max(...used) : 0;
  const taken = new Set();
  const repaired = [];

  for (const doc of siblings) {
    if (!taken.has(doc.idNo)) {
      taken.add(doc.idNo);
      continue;
    }
    do {
      highest += 1;
    } while (used.has(highest));
    used.add(highest);
    const nextIdNo = `${prefix}${String(highest).padStart(4, "0")}`;
    await DataSLF.updateOne(
      { _id: doc._id },
      { $set: { idNo: nextIdNo }, $push: { previousIdNos: doc.idNo } },
    ).setOptions({ includeHiddenYears: true });
    taken.add(nextIdNo);
    repaired.push({ _id: String(doc._id), from: doc.idNo, to: nextIdNo });
  }

  return { prefix, repaired };
}

async function softDeleteOverdueReverted(req) {
  const dueEntries = await DataSLF.find({
    deletedAt: null,
    status: "reverted",
    temporaryDeleteAfter: { $lte: new Date() },
    // Never sweep a baseline container into the trash — it holds the SLF's Total
    // Volume Accepted, cell entries and accredited haulers, and it is not a
    // submission that can expire.
    ...SUBMISSION_HAS_TRUCKS,
  }).limit(100);

  for (const entry of dueEntries) {
    entry.deletedAt = new Date();
    entry.deletedBy = "system-overdue-revert";
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "deleted",
        description: `Overdue reverted entry ${entry.idNo} moved to Deleted Submissions`,
        performedBy: "system-overdue-revert",
        meta: { idNo: entry.idNo, temporaryDeleteAfter: entry.temporaryDeleteAfter },
      });
      await Notification.create({
        recipient: "admin",
        type: "submission_temp_deleted",
        title: "Reverted Submission Temporarily Deleted",
        message: `${entry.idNo || "A reverted submission"} was moved to Deleted Submissions after the follow-up deadline passed.`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, submittedBy: entry.submittedBy, temporaryDeleteAfter: entry.temporaryDeleteAfter },
      });
      notifyAdmin(req, {
        type: "submission_temp_deleted",
        title: "Reverted Submission Temporarily Deleted",
        message: `${entry.idNo || "A reverted submission"} was moved to Deleted Submissions.`,
      });
    } catch { /* silent */ }
  }
}

async function markSubmissionNotificationsRead(entries) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  if (list.length === 0) return;

  const dataEntryIds = list.map((entry) => entry._id).filter(Boolean);
  const submissionIds = [...new Set(list.map((entry) => entry.submissionId).filter(Boolean))];
  const filters = [];
  if (dataEntryIds.length > 0) filters.push({ dataEntry: { $in: dataEntryIds } });
  if (submissionIds.length > 0) filters.push({ submissionId: { $in: submissionIds } });
  if (filters.length === 0) return;

  await Notification.updateMany(
    {
      recipient: "admin",
      read: false,
      type: { $in: ["new_submission", "resubmission", "submission_edit_request"] },
      $or: filters,
    },
    { $set: { read: true } }
  );
}

const router = express.Router();

// Require an authenticated caller (admin or portal realm) on every route below.
// This is the core submissions surface, reached by both frontends, both of
// which always send a Bearer token — so this closes anonymous read/bulk-delete/
// revert/status access without changing client behaviour. Role-scoped checks
// (developerOnly on the repair routes) still apply on top. The per-route
// optionalAuth calls remain harmless: req.user is already populated here.
router.use(requireAnyAuth);

const ADMIN_DISPLAY_NAME = "EMBR3 ESWMP Admin";

function getRequestActor(req, fallback = ADMIN_DISPLAY_NAME) {
  // Prefer the server-verified identity (resolved from the JWT against the DB in
  // server.js) so the audit actor can't be spoofed. The X-User-* headers are
  // client-supplied and only used as a display fallback for older/tokenless
  // callers; never let them override a verified email.
  const verified = String(req.logUser || "").trim();
  if (verified) return verified;
  const headerName = String(req.get("x-user-name") || "").trim();
  const headerEmail = String(req.get("x-user-email") || "").trim();
  return headerName || headerEmail || fallback;
}

// A SUBMISSION always carries at least one transport entry — `submitEntries`
// rejects an empty trucks[] outright ("At least one truck entry is required").
// A record with NO trucks is therefore never a submission: it is the baseline-only
// container that PATCH /portal-save-baseline writes the SLF's baseline into.
//
// Those containers were being listed by both submission views, which is where the
// phantom "SLF-…-0001 / SAMPLE / 0 / No Waste Data / Pending" row came from after
// every first baseline save — on real portal accounts as well as the demo one.
// Baselines have their own admin page; they must not appear as submissions or
// count towards submission totals.
const SUBMISSION_HAS_TRUCKS = { "trucks.0": { $exists: true } };

const baselineDataMatch = {
  $or: [
    { totalVolumeAccepted: { $exists: true, $ne: null } },
    { activeCellResidualVolume: { $exists: true, $ne: null } },
    { activeCellInertVolume: { $exists: true, $ne: null } },
    { activeCellHazardousVolume: { $exists: true, $ne: null } },
    { closedCellResidualVolume: { $exists: true, $ne: null } },
    { closedCellInertVolume: { $exists: true, $ne: null } },
    { closedCellHazardousVolume: { $exists: true, $ne: null } },
    { "activeCellEntries.0": { $exists: true } },
    { "closedCellEntries.0": { $exists: true } },
    { "accreditedHaulers.0": { $exists: true } },
  ],
};

// Exactly the fields GET /baselines returns (plus the internal `_hasTruckVolume`
// ranking flag). Applied as a $project before the aggregation's $sort/$group so
// those stages never carry the `trucks[]` array — see the pipeline for why.
const BASELINE_PROJECTION = {
  _hasTruckVolume: 1,
  createdAt: 1,
  updatedAt: 1,
  slfGenerator: 1,
  slfName: 1,
  lguCompanyName: 1,
  companyType: 1,
  isDummy: 1,
  baselineUnit: 1,
  totalVolumeAccepted: 1,
  totalVolumeAcceptedUnit: 1,
  activeCellResidualVolume: 1,
  activeCellResidualUnit: 1,
  activeCellInertVolume: 1,
  activeCellInertUnit: 1,
  activeCellHazardousVolume: 1,
  activeCellHazardousUnit: 1,
  closedCellResidualVolume: 1,
  closedCellResidualUnit: 1,
  closedCellInertVolume: 1,
  closedCellInertUnit: 1,
  closedCellHazardousVolume: 1,
  closedCellHazardousUnit: 1,
  acceptsHazardousWaste: 1,
  accreditedHaulers: 1,
  activeCellEntries: 1,
  closedCellEntries: 1,
  submittedBy: 1,
  baselineUpdateApproved: 1,
  baselineUpdateRequested: 1,
};

// The portal read adds the General Information (company address) columns on top of
// the admin projection. GET /baseline/:slfName RETURNS address / companyRegion /
// companyProvince / companyMunicipality / companyBarangay, but the projection did
// not select them — so every one of those came back `undefined`, the Portal's
// company form initialized empty on reload, and the saved address "disappeared".
// It also made the Review & Submit blockage report General Information as
// incomplete for data that is actually persisted.
// `accreditedHaulers` is dropped down to ONE subfield here, and the full array is
// fetched afterwards for the single record that wins the haulerSource election.
//
// The array is deliberately duplicated onto every one of an SLF's records (see
// mergeAccreditedHaulerCopies), and it carries each hauler's vehicles AND its
// private-sector clients — so it is by far the largest thing on the document.
// Measured on production data: Prime Waste Solution's 22 baseline-carrying records
// hold 5,099 KB of accreditedHaulers against 14 KB of cell entries, and this read
// pulled all of it (up to 50 records) on every Data Entry load just to use ONE
// record's copy. That is 99.7% of the payload, discarded. It is also why Data
// Entry timed out (HTTP 500) for that facility.
//
// Projecting `accreditedHaulers.haulerName` keeps `.length` intact, which is all
// the selection below and hasBaselineData() ever inspect. Same trick, and same
// reason, as the 773 KB → 13 KB projection fix in findBaselineCandidates above.
const { accreditedHaulers: _fullHaulers, ...BASELINE_PROJECTION_SANS_HAULERS } = BASELINE_PROJECTION;
const PORTAL_BASELINE_SELECT = {
  ...BASELINE_PROJECTION_SANS_HAULERS,
  "accreditedHaulers.haulerName": 1,
  "trucks.actualVolume": 1,
  address: 1,
  companyRegion: 1,
  companyProvince: 1,
  companyMunicipality: 1,
  companyBarangay: 1,
};

function hasTruckVolume(entry) {
  // Vehicle-aware: a multi-vehicle trip records its volume per VEHICLE and leaves
  // the truck level at 0. Reading only the truck made such a submission look like
  // it carried no waste — which, where this is used to pick a baseline record,
  // meant a real submission could be chosen as the SLF's baseline container.
  // Same rule as utils/cellOccupancy.js and DataSLF.computeSlfMetrics.
  return (entry?.trucks || []).some(
    (truck) =>
      Number(truck?.actualVolume || 0) > 0 ||
      (truck?.vehicles || []).some((v) => Number(v?.actualVolume || 0) > 0),
  );
}

// A doc is "baseline-only" when it carries no transport entries at all. This is
// exactly the set `findMatchingBaselineOnlyIds` writes to, so the READ below must
// prefer the same set — otherwise the portal saves a baseline edit onto doc A while
// GET /baseline keeps serving doc B, and the edited cell name / waste type / volume
// silently reverts on reload.
function isBaselineOnlyRecord(entry) {
  return !(Array.isArray(entry?.trucks) ? entry.trucks : []).length;
}

// Mongo-side twin of isBaselineOnlyRecord(), so the read can ask for the
// containers DIRECTLY instead of hoping they fall inside a recency window.
const BASELINE_ONLY_FILTER = {
  $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }],
};

/**
 * Resolve one baseline field across a facility's records, newest first.
 *
 * Only used when the SLF has NO baseline-only container (a legacy facility whose
 * baseline was only ever duplicated onto its submissions). There is no
 * authoritative record to read, and the newest submission usually carries none of
 * the baseline columns — which is why reading the whole payload off a single
 * chosen record returned an empty Total Volume Accepted / address / cell entries
 * for those SLFs.
 *
 * `undefined` and `null` mean "this record does not carry the field" and fall
 * through. An empty string does NOT: a cleared address is a real value, and
 * falling through would resurrect the old one.
 */
function carriesBaselineValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null;
}

/**
 * Candidate order for the portal baseline read: every baseline-only CONTAINER
 * first (most recently written first), then the recency window with those
 * containers removed.
 *
 * The containers are fetched by their own query rather than being hoped for
 * inside a `createdAt: -1` window, because a container is created on the FIRST
 * baseline save and is therefore the OLDEST document the facility owns — on a
 * busy SLF it sorts last, not first.
 */
function orderBaselineCandidates(containers = [], recent = []) {
  const containerIds = new Set(containers.map((item) => String(item?._id)));
  return [
    ...containers,
    ...recent.filter((item) => !containerIds.has(String(item?._id))),
  ];
}

/**
 * Decide which record each baseline field is read from.
 *
 * With a container present it is authoritative and nothing falls through — it is
 * the only record the portal writes baseline values to, so it is also the only
 * one that can express a DELETION. Without one, each field comes from the newest
 * record that actually carries it.
 *
 * Pure — exported at the bottom of this file so the rule can be tested without a
 * database.
 */
function makeBaselineFieldReader(matchedCandidates = [], latest = null) {
  const hasContainer = isBaselineOnlyRecord(latest);
  const readOrder = hasContainer
    ? [latest]
    : [latest, ...matchedCandidates.filter((item) => item !== latest)];
  const sourceFor = (field) =>
    readOrder.find((item) => carriesBaselineValue(item?.[field])) || latest;
  return {
    hasContainer,
    sourceFor,
    valueOf: (field) => sourceFor(field)?.[field],
    // A volume and the unit it was recorded in must come from the SAME record —
    // pairing a value with another record's unit would silently misreport it.
    unitFor: (field, unitField, fallbackUnit) =>
      sourceFor(field)?.[unitField] || fallbackUnit,
  };
}

function chooseBaselineRecord(entries = []) {
  return (
    entries.find(isBaselineOnlyRecord) ||
    entries.find((entry) => !hasTruckVolume(entry)) ||
    entries[0] ||
    null
  );
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBaselineData(entry) {
  return !!(
    entry?.totalVolumeAccepted != null ||
    entry?.activeCellResidualVolume != null ||
    entry?.activeCellInertVolume != null ||
    entry?.activeCellHazardousVolume != null ||
    entry?.closedCellResidualVolume != null ||
    entry?.closedCellInertVolume != null ||
    entry?.closedCellHazardousVolume != null ||
    entry?.activeCellEntries?.length ||
    entry?.closedCellEntries?.length ||
    entry?.accreditedHaulers?.length
  );
}

function normalizeUnit(unit) {
  return String(unit || "m³").replace("m3", "m³");
}

// Nested arrays that hold a submission's ENTIRE trucks / haulers / cell-entry
// payload. An edit that changes a single scalar field must never blank one of
// these out — a degenerate empty array (from a failed detail preload, a partial
// client payload, or stale lean list state) would silently wipe every existing
// truck/hauler/entry. That is exactly the "editing one field removes other saved
// data" data-loss symptom. Guard against it: an incoming `[]` is ignored when the
// stored value already has data, so a field edit can never delete unrelated saved
// records. A genuine clear still happens through the dedicated delete/revert flows.
const PARTIAL_UPDATE_PROTECTED_ARRAYS = [
  "trucks",
  "accreditedHaulers",
  "activeCellEntries",
  "closedCellEntries",
];

// Apply an allow-listed partial update to a DataSLF doc without ever wiping a
// protected nested array to empty. Returns the list of fields whose empty payload
// was skipped (for logging). Shared by the admin-edit and portal-resubmit handlers
// so both enforce the same "preserve existing values not being edited" rule.
function applyEntryUpdates(entry, body, allowedFields, req, action) {
  const skipped = [];
  for (const key of allowedFields) {
    if (body[key] === undefined) continue;
    const incoming = body[key];
    if (
      PARTIAL_UPDATE_PROTECTED_ARRAYS.includes(key) &&
      Array.isArray(incoming) &&
      incoming.length === 0 &&
      Array.isArray(entry[key]) &&
      entry[key].length > 0
    ) {
      skipped.push(key);
      continue;
    }
    entry[key] = incoming;
  }
  if (skipped.length) {
    writeLog("warn", `${action}.array_wipe_prevented`, {
      message: `Ignored empty ${skipped.join(", ")} on ${entry.idNo || entry._id} to preserve existing saved data`,
      user: getRequestActor(req, "system"),
      ip: req?.ip,
      meta: { id: String(entry._id), idNo: entry.idNo, skipped },
    });
  }
  return skipped;
}

// Summarize how many truck rows in a submission have a cell assigned. Used by
// the admin list to show a "Cells Assigned" badge without shipping full trucks.
function computeCellPlacementSummary(entry) {
  const trucks = Array.isArray(entry?.trucks) ? entry.trucks : [];
  const denormTotal = entry?.truckCount ?? trucks.length;
  if (trucks.length === 0) {
    return { placed: 0, total: denormTotal || 0, known: false };
  }
  const placed = trucks.filter(
    (t) => t?.cellName || (Array.isArray(t?.vehicles) && t.vehicles.some((v) => v?.cellName))
  ).length;
  return { placed, total: trucks.length, known: true };
}

function isValidPortalCellRef(entry, cellIndex) {
  if (cellIndex === null || cellIndex === undefined || cellIndex === "") return false;
  const idx = Number(cellIndex);
  if (!Number.isInteger(idx) || idx < 0) return false;
  const facility = entry?.slfGenerator && typeof entry.slfGenerator === "object" ? entry.slfGenerator : null;
  const names = facility?.cellNames || [];
  const statuses = facility?.cellStatuses || [];
  const count = Math.max(Array.isArray(names) ? names.length : 0, Array.isArray(statuses) ? statuses.length : 0);
  if (count > 0 && idx >= count) return false;
  if (statuses?.[idx] && /not\s*exist/i.test(String(statuses[idx]))) return false;
  return true;
}

function summarizePortalOrganizeNeed(entry) {
  let unplacedCount = 0;
  let missingCapacityCount = 0;
  const isPositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  for (const truck of Array.isArray(entry?.trucks) ? entry.trucks : []) {
    const vehicles = (Array.isArray(truck?.vehicles) ? truck.vehicles : []).filter((v) => Number(v?.actualVolume || 0) > 0);
    if (vehicles.length) {
      for (const vehicle of vehicles) {
        if (!isValidPortalCellRef(entry, vehicle?.cellIndex)) unplacedCount += 1;
        if (!isPositive(vehicle?.capacity) && !isPositive(truck?.truckCapacity)) missingCapacityCount += 1;
      }
    } else if (Number(truck?.actualVolume || 0) > 0) {
      if (!isValidPortalCellRef(entry, truck?.cellIndex)) unplacedCount += 1;
      if (!isPositive(truck?.truckCapacity)) missingCapacityCount += 1;
    }
  }
  return { unplacedCount, missingCapacityCount };
}

async function assertNoUnorganizedPortalSubmissions(submittedBy) {
  const email = String(submittedBy || "").trim();
  if (!email) return;
  const prior = await DataSLF.find({
    deletedAt: null,
    hiddenFromPortal: { $ne: true },
    submittedBy: new RegExp(`^${escapeRegExp(email)}$`, "i"),
    status: { $nin: ["reverted", "rejected"] },
  })
    .select("idNo submissionId dateOfDisposal status trucks truckCount submittedBy slfGenerator")
    .populate({ path: "slfGenerator", select: "cellNames cellStatuses" })
    .lean();
  const blockers = prior
    .map((entry) => ({ entry, summary: summarizePortalOrganizeNeed(entry) }))
    .filter(({ summary }) => summary.unplacedCount > 0 || summary.missingCapacityCount > 0);
  if (!blockers.length) return;
  const listed = blockers
    .slice(0, 5)
    .map(({ entry, summary }) => {
      const parts = [];
      if (summary.unplacedCount > 0) parts.push(`${summary.unplacedCount} unassigned waste entr${summary.unplacedCount === 1 ? "y" : "ies"}`);
      if (summary.missingCapacityCount > 0) parts.push(`${summary.missingCapacityCount} missing truck capacit${summary.missingCapacityCount === 1 ? "y" : "ies"}`);
      return `${entry.idNo || entry.submissionId || "Submission"}: ${parts.join(", ")}`;
    })
    .join(" | ");
  const more = blockers.length > 5 ? ` (+${blockers.length - 5} more)` : "";
  const error = new Error(`Organize Cells must be completed before submitting a new transaction. ${listed}${more}`);
  error.statusCode = 409;
  error.code = "ORGANIZE_CELLS_REQUIRED";
  throw error;
}

// Collect the distinct cell names a submission's waste was placed into. The list
// query already selects trucks.cellName / trucks.vehicles.cellName, so this adds
// the assigned-cell labels to the admin list without shipping full trucks.
// A submission stores both `cellIndex` (the canonical relationship to the
// facility's cell infrastructure) and `cellName` (a copy of the label as it read
// at submit time). Rendering the copy is what made renamed cells show stale names
// forever, so the index wins whenever we have it and the facility's live
// `cellNames` array is the source of truth.
//
// Legacy rows that only ever stored a name (no cellIndex) keep working: they fall
// back to the stored copy, so historical relationships stay intact.
// Compute admin-review "remarks" for a submission from existing fields (never
// stored — always derived so they can't go stale). Covers truck-capacity and
// cell-placement attention flags. Cell near-full/full are cell-level and require
// facility fill data, so they are surfaced in the Cell Waste Placement view.
// TON_PER_M3 comes from the shared volumeUnits module (imported above) — the
// single source of truth for the m³ ↔ tons factor.
function toComparableVolume(value, fromUnit, toUnit) {
  const num = Number(value || 0);
  const from = normalizeUnit(fromUnit || "m³");
  const to = normalizeUnit(toUnit || from);
  if (!num || from === to) return num;
  if (from === "tons" && to === "m³") return num / TON_PER_M3;
  if (from === "m³" && to === "tons") return num * TON_PER_M3;
  return num;
}
// Persist an unexpected 500 from an SLF CRUD handler to AppLog so it becomes
// visible to admins (App Logs + the VERA notification bell, which surfaces recent
// error-level SLF failures). Best-effort — never throws, never blocks the response.
function logSlfCrudError(req, action, error, meta = {}) {
  writeLog("error", action, {
    message: `SLF CRUD failure (${action}): ${error?.message || "unknown error"}`,
    user: getRequestActor(req, "system"),
    ip: req?.ip,
    meta: { ...meta, error: error?.message },
  });
}

function computeSubmissionRemarks(entry, allowancePct = 10) {
  const remarks = [];
  const trucks = Array.isArray(entry?.trucks) ? entry.trucks : [];
  const pct = Number.isFinite(Number(allowancePct)) && Number(allowancePct) >= 0 ? Number(allowancePct) : 10;

  let noCapacity = false;
  let exceeded = false;
  const evalRow = (vol, volUnit, cap, capUnit) => {
    const volume = Number(vol || 0);
    if (!(volume > 0)) return;
    if (!(Number(cap) > 0)) { noCapacity = true; return; }
    const volInCap = toComparableVolume(volume, volUnit || capUnit || "m³", capUnit || "m³");
    const maxAllowed = Number(cap) + (Number(cap) * pct) / 100;
    if (volInCap > maxAllowed + 1e-9) exceeded = true;
  };
  for (const truck of trucks) {
    const vehs = (truck?.vehicles || []).filter((v) => Number(v?.actualVolume || 0) > 0 || v?.plateNumber);
    if (vehs.length) {
      vehs.forEach((v) =>
        evalRow(v.actualVolume, v.actualVolumeUnit, v.capacity ?? truck?.truckCapacity, v.capacityUnit || truck?.truckCapacityUnit),
      );
    } else {
      evalRow(truck?.actualVolume, truck?.actualVolumeUnit, truck?.truckCapacity, truck?.truckCapacityUnit);
    }
  }
  if (exceeded) remarks.push({ text: "Exceeded truck capacity", level: "error" });
  if (noCapacity) remarks.push({ text: "No truck capacity", level: "warning" });

  const placement = computeCellPlacementSummary(entry);
  if (placement.known && placement.total > 0) {
    if (placement.placed === 0) {
      remarks.push({ text: "Missing cell placement", level: "error" });
    } else if (placement.placed < placement.total) {
      remarks.push({ text: "Missing cell placement", level: "warning" });
      remarks.push({ text: "Cell used for waste placement", level: "info" });
    } else {
      remarks.push({ text: "Cell used for waste placement", level: "info" });
    }
  }
  return remarks;
}

// Coerce any incoming unit string to one of the schema-allowed enum values so a
// stray label (e.g. "cubic meters") can never trigger a Mongoose ValidationError
// (which would surface to the portal user as a 500 server error).
const VALID_VOLUME_UNITS = new Set(["tons", "m³", "m3"]);
function normalizeVolumeUnit(unit, fallback = "m³") {
  const normalized = normalizeUnit(unit || fallback);
  if (VALID_VOLUME_UNITS.has(normalized)) return normalized;
  const low = String(unit || "").toLowerCase();
  if (low.includes("ton")) return "tons";
  return "m³";
}

// The truck-level wasteType field is a strict enum. Portal disposal dropdowns
// always send a valid value, but Excel-imported rows carry free text. Map common
// variants to the enum and fall back to "Residual" for anything unrecognized so
// the save never fails with an enum ValidationError. Delegates to the shared
// canonical definition (server/utils/wasteCategories) so the portal, backend and
// admin classify a load identically.
function normalizeTruckWasteType(value) {
  return normalizeWasteCategory(value);
}

// Validate + normalize a numeric volume/capacity. Pushes a readable message to
// `errors` for negative or non-numeric values so the caller can return a 400.
function coerceVolume(value, label, errors) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) {
    errors.push(`${label} is not a valid number.`);
    return undefined;
  }
  if (n < 0) {
    errors.push(`${label} cannot be negative.`);
    return undefined;
  }
  return n;
}

// Normalize + validate the trucks array of a submission entry. Prevents 500s
// from enum/type mismatches and collects human-readable validation errors.
function sanitizeTrucksForSave(trucks, fallbackUnit, errors) {
  if (!Array.isArray(trucks)) return trucks;
  return trucks.map((truck, ti) => {
    if (!truck || typeof truck !== "object") return truck;
    const cleaned = { ...truck };
    if (cleaned.wasteType !== undefined) {
      cleaned.wasteType = normalizeTruckWasteType(cleaned.wasteType);
    }
    if (cleaned.truckCapacityUnit) cleaned.truckCapacityUnit = normalizeVolumeUnit(cleaned.truckCapacityUnit, fallbackUnit);
    if (cleaned.actualVolumeUnit) cleaned.actualVolumeUnit = normalizeVolumeUnit(cleaned.actualVolumeUnit, fallbackUnit);

    const av = coerceVolume(cleaned.actualVolume, `Truck ${ti + 1} actual volume`, errors);
    if (av !== undefined) cleaned.actualVolume = av;
    const tc = coerceVolume(cleaned.truckCapacity, `Truck ${ti + 1} capacity`, errors);
    if (tc !== undefined) cleaned.truckCapacity = tc;

    if (Array.isArray(cleaned.vehicles)) {
      cleaned.vehicles = cleaned.vehicles.map((vehicle, vi) => {
        if (!vehicle || typeof vehicle !== "object") return vehicle;
        const cv = { ...vehicle };
        // Per-vehicle wasteType is where the portal actually stores each load's
        // classification. Normalize it to the canonical category (same as the truck
        // level) so hazardous loads carried on a vehicle are never miscounted as
        // residual by the metrics/summary aggregations.
        if (cv.wasteType !== undefined) {
          cv.wasteType = normalizeTruckWasteType(cv.wasteType);
        }
        if (cv.capacityUnit) cv.capacityUnit = normalizeVolumeUnit(cv.capacityUnit, fallbackUnit);
        if (cv.actualVolumeUnit) cv.actualVolumeUnit = normalizeVolumeUnit(cv.actualVolumeUnit, fallbackUnit);
        const vv = coerceVolume(cv.actualVolume, `Truck ${ti + 1} vehicle ${vi + 1} volume`, errors);
        if (vv !== undefined) cv.actualVolume = vv;
        const vc = coerceVolume(cv.capacity, `Truck ${ti + 1} vehicle ${vi + 1} capacity`, errors);
        if (vc !== undefined) cv.capacity = vc;
        return cv;
      });
    }
    return cleaned;
  });
}

// Normalize the enum-constrained unit fields at the top level of an entry so a
// bad unit string never triggers a 500.
const ENTRY_UNIT_FIELDS = [
  "baselineUnit", "totalVolumeAcceptedUnit", "currentCellVolumeUnit",
  "activeCellResidualUnit", "activeCellInertUnit", "activeCellHazardousUnit",
  "closedCellResidualUnit", "closedCellInertUnit", "closedCellHazardousUnit",
];

// Sanitize + validate a full submission entry. Returns the cleaned entry and
// pushes any validation errors so the route can return a clear 400 response
// instead of a Mongoose 500.
function sanitizeSubmissionEntry(item, errors) {
  if (!item || typeof item !== "object") return item;
  const fallbackUnit = normalizeVolumeUnit(item.baselineUnit || "m³");
  const cleaned = { ...item };
  ENTRY_UNIT_FIELDS.forEach((field) => {
    if (cleaned[field]) cleaned[field] = normalizeVolumeUnit(cleaned[field], fallbackUnit);
  });
  if (Array.isArray(cleaned.trucks)) {
    cleaned.trucks = sanitizeTrucksForSave(cleaned.trucks, fallbackUnit, errors);
  }
  // Normalize cell-entry units (free-text wasteType is fine here)
  ["activeCellEntries", "closedCellEntries"].forEach((key) => {
    if (Array.isArray(cleaned[key])) {
      cleaned[key] = cleaned[key].map((entry, ci) => {
        if (!entry || typeof entry !== "object") return entry;
        const ce = { ...entry };
        if (ce.unit) ce.unit = normalizeVolumeUnit(ce.unit, fallbackUnit);
        const v = coerceVolume(ce.volume, `${key === "activeCellEntries" ? "Active" : "Closed"} cell entry ${ci + 1} volume`, errors);
        if (v !== undefined) ce.volume = v;
        return ce;
      });
    }
  });
  return cleaned;
}

const isMissingRequiredText = (value) =>
  value === null || value === undefined || String(value).trim() === "";

const hasPositiveRequiredNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
};

function sanitizeClient(client) {
  if (typeof client === "string") {
    return {
      clientName: client.trim(),
      clientType: "Private",
      clientAddress: "",
      region: "",
      regionName: "",
      province: "",
      provinceName: "",
      municipality: "",
      municipalityName: "",
    };
  }
  if (!client || typeof client !== "object") return null;
  return {
    clientName: String(client.clientName || "").trim(),
    clientType: String(client.clientType || "Private").trim() || "Private",
    // Carried through so a bulk-uploaded / admin-corrected Client Address survives
    // the save instead of being stripped by this whitelist.
    clientAddress: String(client.clientAddress || client.address || "").trim(),
    region: String(client.region || "").trim(),
    regionName: String(client.regionName || "").trim(),
    province: String(client.province || "").trim(),
    provinceName: String(client.provinceName || "").trim(),
    municipality: String(client.municipality || "").trim(),
    municipalityName: String(client.municipalityName || "").trim(),
  };
}

const normalizeRelationshipText = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
const clientRelationshipValues = (client) => {
  if (typeof client === "string") return [client];
  if (!client || typeof client !== "object") return [];
  return [client.clientName, client.name, client.clientCode, client.code, client.clientId, client.id, client._id, client.key];
};
const haulerClientPool = (hauler) => [
  ...(Array.isArray(hauler?.privateSectorClients) ? hauler.privateSectorClients : []),
  ...(Array.isArray(hauler?.clients) ? hauler.clients : []),
  ...(Array.isArray(hauler?.vehicles) ? hauler.vehicles.flatMap((vehicle) => vehicle?.selectedClients || []) : []),
];

// Canonical identity of a client inside ONE hauler's lists: the normalized client
// name — the same key GET /hauler-clients already collapses its duplicated copies
// by. Everything else (client type, region/province codes, which array the copy was
// stored in, whether it was stored as a bare string) is detail that must never
// split one client into two "ambiguous" candidates.
const clientIdentityKey = (client) => {
  if (typeof client === "string") return normalizeRelationshipText(client);
  if (!client || typeof client !== "object") return "";
  return normalizeRelationshipText(client.clientName || client.name);
};

// An SLF's accreditedHaulers array is deliberately DUPLICATED across every one of
// its baseline documents (see the Hauler Clients CRUD block below), and one hauler
// lists the same client in `privateSectorClients`, in `clients` and again on each
// vehicle's `selectedClients`. Counting those copies as separate records is what
// made submission fail with "Hauler/Client is duplicated or ambiguous under this
// SLF" — the entity is one, the rows are many.
//
// Collapse to ONE record per distinct hauler (normalized name) whose client pool is
// the UNION of every copy's clients, de-duplicated by canonical client identity.
// Unioning also fixes the mirror-image failure: reading only the first copy made a
// client added by the newest baseline read as "not assigned to this hauler".
//
// Pure — exported at the bottom of this file so the relationship rules can be
// tested without a database.
function mergeAccreditedHaulerCopies(haulers = []) {
  const byHauler = new Map();
  (Array.isArray(haulers) ? haulers : []).forEach((hauler) => {
    const key = normalizeRelationshipText(hauler?.haulerName || hauler?.name);
    if (!key) return;
    let merged = byHauler.get(key);
    if (!merged) {
      merged = { haulerName: hauler?.haulerName || hauler?.name || "", clientPool: new Map() };
      byHauler.set(key, merged);
    }
    haulerClientPool(hauler).forEach((client) => {
      const clientKey = clientIdentityKey(client);
      if (!clientKey || merged.clientPool.has(clientKey)) return;
      merged.clientPool.set(clientKey, client);
    });
  });

  return [...byHauler.values()].map((entry) => ({
    haulerName: entry.haulerName,
    clients: [...entry.clientPool.values()],
  }));
}

async function getAuthoritativeHaulersForEntry(item) {
  const query = item?.slfGenerator
    ? { slfGenerator: item.slfGenerator, "accreditedHaulers.0": { $exists: true } }
    : { slfName: item?.slfName, "accreditedHaulers.0": { $exists: true } };
  const baselines = await DataSLF.find(query).select("accreditedHaulers createdAt").sort({ createdAt: -1 }).lean();
  const savedHaulers = baselines.flatMap((baseline) => baseline.accreditedHaulers || []);
  return mergeAccreditedHaulerCopies(
    savedHaulers.length
      ? savedHaulers
      : Array.isArray(item?.accreditedHaulers)
        ? item.accreditedHaulers
        : [],
  );
}

async function validateUploadedClientRelationships(item) {
  const issues = [];
  const trucks = Array.isArray(item?.trucks) ? item.trucks : [];
  const uploadRows = trucks
    .map((truck, index) => ({ truck, index }))
    .filter(({ truck }) => String(truck?.entrySource || "").trim().toLowerCase() === "upload");
  if (!uploadRows.length) return issues;

  const haulers = await getAuthoritativeHaulersForEntry(item);
  for (const { truck, index } of uploadRows) {
    const rowLabel = `Row ${index + 1}`;
    const selectedClients = Array.isArray(truck?.selectedClients) && truck.selectedClients.length
      ? truck.selectedClients
      : (Array.isArray(truck?.vehicles) ? truck.vehicles.flatMap((vehicle) => vehicle?.selectedClients || []) : []);
    const client = selectedClients.find((c) => normalizeRelationshipText(c?.clientName || c));
    if (!client) {
      issues.push(`${rowLabel} — Client is required for uploaded disposal entries.`);
      continue;
    }

    const haulerName = normalizeRelationshipText(truck?.hauler);
    const haulerMatches = haulers.filter((hauler) => normalizeRelationshipText(hauler?.haulerName || hauler?.name) === haulerName);
    if (haulerMatches.length === 0) {
      issues.push(`${rowLabel} — Hauler "${truck?.hauler || ""}" is not assigned under this SLF.`);
      continue;
    }
    if (haulerMatches.length > 1) {
      issues.push(`${rowLabel} — Hauler "${truck?.hauler || ""}" is duplicated or ambiguous under this SLF.`);
      continue;
    }

    const clientTargetValues = clientRelationshipValues(client).map(normalizeRelationshipText).filter(Boolean);
    const candidates = (haulerMatches[0].clients || []).filter((candidate) => {
      const values = clientRelationshipValues(candidate).map(normalizeRelationshipText).filter(Boolean);
      return values.some((value) => clientTargetValues.includes(value));
    });
    const activeCandidates = candidates.filter(
      (candidate) => String(candidate?.status || candidate?.active || "active").toLowerCase() !== "inactive" && candidate?.isActive !== false,
    );
    if (activeCandidates.length === 0) {
      const clientName = client?.clientName || client;
      issues.push(`${rowLabel} — Client "${clientName}" is not assigned to hauler "${truck?.hauler || ""}" under this SLF.`);
      continue;
    }
    if (activeCandidates.length > 1) {
      const clientName = client?.clientName || client;
      issues.push(`${rowLabel} — Client "${clientName}" is duplicated or ambiguous for hauler "${truck?.hauler || ""}" under this SLF.`);
    }
  }
  return issues;
}

function sanitizeVehicle(vehicle, fallbackUnit = "m³") {
  if (!vehicle || typeof vehicle !== "object") return null;
  return {
    plateNumber: String(vehicle.plateNumber || vehicle.plateNo || vehicle.plate || "").trim(),
    vehicleType: String(vehicle.vehicleType || vehicle.type || "").trim(),
    capacity:
      vehicle.capacity == null || Number.isNaN(Number(vehicle.capacity))
        ? null
        : Number(vehicle.capacity),
    capacityUnit: normalizeUnit(vehicle.capacityUnit || vehicle.truckCapacityUnit || fallbackUnit),
    selectedClients: Array.isArray(vehicle.selectedClients)
      ? vehicle.selectedClients.map(sanitizeClient).filter(Boolean)
      : [],
  };
}

function sanitizeAccreditedHaulers(haulers = [], fallbackUnit = "m³") {
  if (!Array.isArray(haulers)) return [];
  return haulers.map((hauler) => {
    const vehicles = Array.isArray(hauler?.vehicles)
      ? hauler.vehicles.map((vehicle) => sanitizeVehicle(vehicle, fallbackUnit)).filter(Boolean)
      : [];
    const primaryVehicle = vehicles[0] || sanitizeVehicle(hauler, fallbackUnit) || {};
    return {
      haulerName: String(hauler?.haulerName || hauler?.name || "").trim(),
      numberOfTrucks: Math.max(Number(hauler?.numberOfTrucks || 0), vehicles.length) || null,
      officeAddress: String(hauler?.officeAddress || "").trim(),
      plateNumber: primaryVehicle.plateNumber || "",
      vehicleType: primaryVehicle.vehicleType || "",
      capacity: primaryVehicle.capacity ?? null,
      capacityUnit: normalizeUnit(primaryVehicle.capacityUnit || fallbackUnit),
      vehicles,
      privateSectorClients: Array.isArray(hauler?.privateSectorClients)
        ? hauler.privateSectorClients.map(sanitizeClient).filter(Boolean)
        : [],
    };
  });
}

async function findMatchingBaselineOnlyIds({ slfName, slfGenerator, lguCompanyName }) {
  const namesToMatch = [...new Set([slfName, lguCompanyName].filter(Boolean))];
  const baseFilter = {
    $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }],
  };
  const directOr = [];

  if (slfGenerator && mongoose.Types.ObjectId.isValid(String(slfGenerator))) {
    directOr.push({ slfGenerator });
  }
  namesToMatch.forEach((name) => {
    directOr.push({ slfName: name });
    directOr.push({ lguCompanyName: name });
  });

  let candidates = [];
  if (directOr.length > 0) {
    candidates = await DataSLF.find({ $and: [baseFilter, { $or: directOr }] })
      .select("_id slfGenerator slfName lguCompanyName")
      .lean();
  }

  let matches = candidates.filter((item) => {
    if (slfGenerator && String(item.slfGenerator || "") === String(slfGenerator)) {
      return true;
    }
    return namesToMatch.some((name) => matchesSlfIdentity(item, name));
  });

  if (matches.length === 0 && namesToMatch.length > 0) {
    const fallbackCandidates = await DataSLF.find(baseFilter)
      .select("_id slfGenerator slfName lguCompanyName")
      .lean();
    matches = fallbackCandidates.filter((item) => {
      if (slfGenerator && String(item.slfGenerator || "") === String(slfGenerator)) {
        return true;
      }
      return namesToMatch.some((name) => matchesSlfIdentity(item, name));
    });
  }

  return [...new Set(matches.map((item) => String(item._id)).filter(Boolean))];
}

async function ensurePortalAccountCanSubmit(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  const portalUser = await UserPortal.findOne({ email: normalizedEmail }).select("verificationRequired verificationSubmitted status isDummy assignedSlf");
  if (!portalUser) return null;
  if (portalUser.status !== "approved") {
    const error = new Error("Your portal account is not approved for submissions.");
    error.statusCode = 403;
    error.code = "ACCOUNT_NOT_APPROVED";
    throw error;
  }
  if (portalUser.verificationRequired) {
    const error = new Error("Your account is on hold for verification. Please complete the verification process before using the portal.");
    error.statusCode = 403;
    error.code = "ACCOUNT_VERIFICATION_REQUIRED";
    throw error;
  }
  return portalUser;
}

/**
 * Core submission logic shared by the portal POST route, the draft/scheduled
 * queue (manual + automatic submit) and the scheduler. Validates + normalizes
 * every entry, persists DataSLF docs, and fires audit/notification side effects.
 *
 * @param {object} params
 * @param {object[]} params.entries   - Submission entry payload(s)
 * @param {string}   params.submittedBy - Portal user email
 * @param {object}   [params.req]      - Express req (optional; enables socket emits + ip)
 * @returns {Promise<{ saved: object[], submissionId: string }>}
 * @throws  {Error} with statusCode 400/403 on validation/permission failure
 */
// Block a NEW submission when the portal user has a reverted submission that has
// stayed unresolved for 24h+. "Unresolved" = still status "reverted" (a resubmit
// via PUT /:id flips it back to "pending", clearing the block). Users with no
// reverted submissions — or whose reverts are within 24h — are never blocked.
const REVERT_ACTION_GRACE_MS = 24 * 60 * 60 * 1000;
async function assertNoUnresolvedRevert(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;
  const cutoff = new Date(Date.now() - REVERT_ACTION_GRACE_MS);
  const stale = await DataSLF.findOne({
    submittedBy: normalizedEmail,
    status: "reverted",
    deletedAt: null,
    // Only a real submission can be "corrected and resubmitted". Baseline
    // containers used to surface in the submissions list, so admins reverted
    // some of them — and because a container carries no waste data there is
    // nothing to correct, which left those portal users permanently blocked from
    // submitting with no way out. Verified in production: at least one account is
    // in exactly that state. See SUBMISSION_HAS_TRUCKS.
    ...SUBMISSION_HAS_TRUCKS,
  })
    .setOptions({ includeHiddenYears: true })
    .select("idNo revertedAt updatedAt")
    .sort({ revertedAt: 1 })
    .lean();
  if (!stale) return;
  const revertedAt = stale.revertedAt || stale.updatedAt;
  if (revertedAt && new Date(revertedAt) <= cutoff) {
    const error = new Error(
      `You have a reverted submission${stale.idNo ? ` (${stale.idNo})` : ""} that has been unresolved for over 24 hours. Please correct and resubmit the reverted submission before submitting a new one.`,
    );
    error.statusCode = 409;
    // Machine-readable reason so the Portal can show the right rule modal + action
    // (Edit and Resubmit), instead of parsing the human message (#2).
    error.code = "UNRESOLVED_REVERT";
    error.ruleContext = { idNo: stale.idNo || null };
    throw error;
  }
}

async function submitEntries({ entries, submittedBy, req, idempotencyKey = null } = {}) {
  // Idempotency: if this exact request was already processed, return the saved
  // records instead of creating duplicates (protects against retries / lost
  // responses / double-clicks). Keyed by a client-supplied X-Idempotency-Key.
  if (idempotencyKey) {
    const prior = await DataSLF.find({ idempotencyKey, deletedAt: null }).lean();
    if (prior.length) return { saved: prior, submissionId: prior[0].submissionId, idempotent: true };
  }
  const portalAccount = await ensurePortalAccountCanSubmit(submittedBy);
  await assertNoUnresolvedRevert(submittedBy);
  await assertNoUnorganizedPortalSubmissions(submittedBy);
  const submitterIsDummy = Boolean(portalAccount?.isDummy);
  const items = Array.isArray(entries) ? entries : entries ? [entries] : [];
  if (items.length === 0) {
    const error = new Error("No submission data was provided.");
    error.statusCode = 400;
    throw error;
  }

  // Validate + normalize every entry up front so an invalid entry can't cause a
  // partial save or a Mongoose 500.
  const validationErrors = [];
  const sanitizedItems = items.map((item, idx) => {
    const errs = [];
    const cleaned = sanitizeSubmissionEntry(item, errs);
    if (errs.length) {
      validationErrors.push(`${items.length > 1 ? `Entry ${idx + 1}: ` : ""}${errs.join(" ")}`);
    }
    return cleaned;
  });
  if (validationErrors.length) {
    const error = new Error(validationErrors.join(" | "));
    error.statusCode = 400;
    throw error;
  }

  const uploadClientIssues = [];
  for (let idx = 0; idx < sanitizedItems.length; idx += 1) {
    const itemIssues = await validateUploadedClientRelationships(sanitizedItems[idx]);
    itemIssues.forEach((message) => {
      uploadClientIssues.push(`${sanitizedItems.length > 1 ? `Entry ${idx + 1}: ` : ""}${message}`);
    });
  }
  if (uploadClientIssues.length) {
    const error = new Error(uploadClientIssues.slice(0, 8).join(" | ") + (uploadClientIssues.length > 8 ? ` (+${uploadClientIssues.length - 8} more)` : ""));
    error.statusCode = 400;
    error.validationIssues = uploadClientIssues.map((message) => ({ tab: "waste-generation-information", field: "client", message }));
    throw error;
  }

  const requiredSubmissionIssues = [];
  sanitizedItems.forEach((item, idx) => {
    const entryPrefix = sanitizedItems.length > 1 ? `Entry ${idx + 1}: ` : "";
    const missingGeneral = [];
    if (isMissingRequiredText(item?.lguCompanyName)) missingGeneral.push("Company Name");
    if (isMissingRequiredText(item?.companyRegion)) missingGeneral.push("Region");
    if (isMissingRequiredText(item?.companyProvince)) missingGeneral.push("Province");
    if (isMissingRequiredText(item?.companyMunicipality)) missingGeneral.push("City/Municipality");
    if (missingGeneral.length) {
      requiredSubmissionIssues.push(`${entryPrefix}General Information is incomplete — ${missingGeneral.join(", ")} required.`);
    }
    if (!hasPositiveRequiredNumber(item?.totalVolumeAccepted)) {
      requiredSubmissionIssues.push(`${entryPrefix}Baseline Data is incomplete — Total Volume Accepted is required.`);
    }
  });
  if (requiredSubmissionIssues.length) {
    const error = new Error(requiredSubmissionIssues.join(" | "));
    error.statusCode = 400;
    error.validationIssues = requiredSubmissionIssues.map((message) => ({ tab: "required-submission-data", message }));
    throw error;
  }

  // ── Waste Generation Information: every field required for FINAL submission ──
  // This is the AUTHORITATIVE gate. The Portal runs the same rules to highlight the
  // offending fields before uploading, but that is a convenience — a request that
  // reaches here with an incomplete truck (e.g. a truck with no disposal cell) is
  // rejected outright, so a submission can never be partially finalized. Truck
  // Capacity is REQUIRED for UPLOADED rows (truck.entrySource === "upload") and
  // OPTIONAL for manually-entered rows; a present value must always be > 0. Missing
  // capacity on already-saved historical records is completed via Organize Cells.
  //
  // Drafts and queued/scheduled entries do NOT come through here; they are stored
  // in PortalSubmissionQueue and are only validated when the scheduler promotes
  // them to a real submission via this same route.
  const wasteGenIssues = [];
  sanitizedItems.forEach((item, idx) => {
    validateWasteGeneration(item?.trucks).forEach((i) => {
      wasteGenIssues.push({ ...i, entryIndex: sanitizedItems.length > 1 ? idx : null });
    });
  });
  if (wasteGenIssues.length) {
    const summary = wasteGenIssues
      .slice(0, 8)
      .map((i) => `${i.truckIndex != null ? `Truck ${i.truckIndex + 1}: ` : ""}${i.message}`)
      .join(" | ");
    const error = new Error(
      `Waste Generation Information is incomplete. ${summary}${wasteGenIssues.length > 8 ? ` (+${wasteGenIssues.length - 8} more)` : ""}`,
    );
    error.statusCode = 400;
    // Field-specific feedback so the Portal can focus the offending input.
    error.validationIssues = wasteGenIssues;
    throw error;
  }

  // ── Declared baseline unit + truck-capacity elevation (authoritative gate) ──
  // Every transport-entry unit must match the entry's declared baseline unit, and
  // no truck/vehicle capacity may exceed its registered (accredited-hauler)
  // capacity by more than 10%. The Portal runs the same rules for inline feedback;
  // this server-side check is what actually blocks a mismatched/over-capacity
  // submission. Declared capacities are read from the SLF's own baseline haulers,
  // never trusted from the client payload.
  const declaredCapacityCache = new Map(); // slf key -> Map(plate -> declared capacity)
  const getDeclaredCapacityMap = async (item) => {
    const slfName = item?.slfName ? String(item.slfName).trim() : "";
    const key = (item?.slfGenerator && String(item.slfGenerator)) || slfName.toLowerCase();
    if (!key) return new Map();
    if (declaredCapacityCache.has(key)) return declaredCapacityCache.get(key);
    const query = item?.slfGenerator
      ? { slfGenerator: item.slfGenerator, "accreditedHaulers.0": { $exists: true } }
      : { slfName: item.slfName, "accreditedHaulers.0": { $exists: true } };
    const baselines = await DataSLF.find(query).select("accreditedHaulers").lean();
    const map = new Map();
    baselines.forEach((b) => {
      (b.accreditedHaulers || []).forEach((h) => {
        (h.vehicles || []).forEach((v) => {
          const plate = String(v?.plateNumber || "").trim().toLowerCase();
          const cap = Number(v?.capacity);
          if (plate && Number.isFinite(cap) && cap > 0 && !map.has(plate)) {
            map.set(plate, cap);
          }
        });
      });
    });
    declaredCapacityCache.set(key, map);
    return map;
  };

  const transportIssues = [];
  for (let idx = 0; idx < sanitizedItems.length; idx += 1) {
    const item = sanitizedItems[idx];
    const entryIndex = sanitizedItems.length > 1 ? idx : null;
    validateTransportUnits(item?.trucks, item?.baselineUnit).forEach((i) => {
      transportIssues.push({ ...i, entryIndex });
    });
    const capMap = await getDeclaredCapacityMap(item);
    const getDeclared = (_hauler, plate) =>
      capMap.get(String(plate || "").trim().toLowerCase()) || null;
    validateTruckCapacityElevation(item?.trucks, getDeclared).forEach((i) => {
      transportIssues.push({ ...i, entryIndex });
    });
  }
  if (transportIssues.length) {
    const summary = transportIssues
      .slice(0, 8)
      .map((i) => `${i.truckIndex != null ? `Truck ${i.truckIndex + 1}: ` : ""}${i.message}`)
      .join(" | ");
    const error = new Error(
      `Transport entry validation failed. ${summary}${transportIssues.length > 8 ? ` (+${transportIssues.length - 8} more)` : ""}`,
    );
    error.statusCode = 400;
    error.validationIssues = transportIssues;
    throw error;
  }

  const submissionId = `SUB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

  const genCache = new Map();
  const facilityDummyCache = new Map();
  const facilityCellCache = new Map(); // genId -> facility cell arrays (lean)
  const saved = [];
  for (const item of sanitizedItems) {
    let genId = item.slfGenerator || null;
    if (!genId && item.slfName) {
      const cacheKey = String(item.slfName).trim().toLowerCase();
      if (genCache.has(cacheKey)) {
        genId = genCache.get(cacheKey);
      } else {
        const gen = await SLFGenerator.findOne({ slfName: item.slfName }).select("_id").lean();
        genId = gen?._id || null;
        genCache.set(cacheKey, genId);
      }
    }

    // Determine whether the target facility is a dummy/test facility.
    let facilityIsDummy = false;
    if (genId) {
      const key = String(genId);
      if (facilityDummyCache.has(key)) {
        facilityIsDummy = facilityDummyCache.get(key);
      } else {
        const fac = await SlfFacility.findById(genId).select("isDummy").lean();
        facilityIsDummy = Boolean(fac?.isDummy);
        facilityDummyCache.set(key, facilityIsDummy);
      }
    }

    // Enforce isolation: dummy accounts submit ONLY against dummy facilities,
    // and real accounts must never submit against a dummy facility.
    if (submitterIsDummy && genId && !facilityIsDummy) {
      const error = new Error("Dummy accounts can only submit against their assigned dummy SLF facility.");
      error.statusCode = 403;
      throw error;
    }
    if (submitterIsDummy && !genId) {
      const error = new Error("This dummy account has no assigned dummy SLF facility. Assign one in Dummy Data Config.");
      error.statusCode = 400;
      throw error;
    }
    if (!submitterIsDummy && facilityIsDummy) {
      const error = new Error("A real portal account cannot submit against a dummy SLF facility.");
      error.statusCode = 403;
      throw error;
    }

    // ── Ownership enforcement ──
    // A portal user may submit ONLY against a facility they are assigned to. This
    // is enforced on the backend so a crafted request cannot place waste into (or
    // read the cells of) another portal user's landfill. Skipped only when the
    // account has no assignment recorded (nothing to compare against) or is a
    // dummy account (which has its own dummy-facility isolation above).
    if (!submitterIsDummy && genId && Array.isArray(portalAccount?.assignedSlf) && portalAccount.assignedSlf.length) {
      const assignedIds = portalAccount.assignedSlf.map((id) => String(id));
      if (!assignedIds.includes(String(genId))) {
        writeLog("warn", "submit.ownership_rejected", {
          message: `Portal user attempted to submit against a facility they are not assigned to`,
          user: submittedBy || item.submittedBy || "",
          ip: req?.ip,
          meta: { operation: "submit", slfGenerator: String(genId), submissionId },
        });
        const error = new Error("You can only submit waste volumes for the SLF facility assigned to your account.");
        error.statusCode = 403;
        throw error;
      }
    }

    // ── Authoritative cell-availability revalidation (concurrency-safe gate) ──
    // Re-load the facility's CURRENT cell state and reject any placement into a
    // nonexistent, non-operational, full, or over-capacity cell. This runs on the
    // freshest data so a cell that filled up (or was closed) after the portal
    // built its form cannot be written to. Mirrors the front-end availability rule.
    if (genId) {
      const key = String(genId);
      let facCells = facilityCellCache.get(key);
      if (facCells === undefined) {
        facCells = await SlfFacility.findById(genId)
          .select(
            "numberOfCell cellStatuses cellNames cellCapacities cellFillValues cellCapacityUnits cellFillUnits volumeCapacityUnit wasteReceivedUnit",
          )
          .lean();
        facilityCellCache.set(key, facCells || null);
      }
      if (facCells) {
        const cellIssues = [];
        (Array.isArray(item.trucks) ? item.trucks : []).forEach((truck, ti) => {
          const rows =
            Array.isArray(truck?.vehicles) && truck.vehicles.length
              ? truck.vehicles
              : [truck];
          rows.forEach((row) => {
            const ci =
              row?.cellIndex ?? (row === truck ? truck?.cellIndex : undefined);
            const vol = Number(row?.actualVolume || 0);
            if (ci === null || ci === undefined || ci === "" || !(vol > 0)) return;
            const acc = evaluateFacilityCellAcceptance(
              facCells,
              ci,
              vol,
              row?.actualVolumeUnit || item?.baselineUnit || "m³",
            );
            if (!acc.ok) {
              const name = facCells?.cellNames?.[Number(ci)] || `Cell ${Number(ci) + 1}`;
              cellIssues.push(`Truck ${ti + 1} · ${name}: ${acc.reason}`);
            }
          });
        });
        if (cellIssues.length) {
          writeLog("warn", "cell_availability_rejected", {
            message: cellIssues.join(" | "),
            user: submittedBy || item.submittedBy || "",
            ip: req?.ip,
            meta: {
              operation: "submit",
              slfGenerator: key,
              submissionId,
              issues: cellIssues,
            },
          });
          const error = new Error(
            `The selected cell no longer has enough available capacity. ${cellIssues.join(
              " | ",
            )} Refresh the cell list and select another operational cell.`,
          );
          error.statusCode = 409;
          throw error;
        }
      }
    }

    const doc = new DataSLF({
      ...item,
      slfGenerator: genId,
      submissionId,
      submittedBy: submittedBy || item.submittedBy || "",
      isDummy: submitterIsDummy || facilityIsDummy,
      dummyPortalUserId: submitterIsDummy ? portalAccount?._id : undefined,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    await doc.save();
    saved.push(doc);
  }

  // The unit the portal DECLARED on this submission becomes the facility's declared
  // waste-volume unit, so the admin side reads the same unit the operator chose.
  {
    const withUnit = saved.find((s) => s.slfGenerator && (s.baselineUnit || s.totalVolumeAcceptedUnit));
    if (withUnit) {
      await syncFacilityDeclaredUnit(
        withUnit.slfGenerator,
        withUnit.baselineUnit || withUnit.totalVolumeAcceptedUnit,
      );
    }
  }

  // Waste that just landed in a cell has to reach the facility's occupancy NOW.
  // This used to run ONLY when someone opened Organize Cells, so between a
  // submission and the next organize the stored cellFillValues under-reported the
  // real load — measured across production: 8 of 16 facilities were stale, one
  // showing a cell as empty while it held 52.97. Cell-availability gating and the
  // admin gauges both read those stored values, so a full cell could keep
  // accepting waste. computeCellOccupancy RECOMPUTES from the live records rather
  // than incrementing, so calling it here is idempotent and can never double-count.
  await refreshOccupancyForFacilities(req, saved.map((s) => s.slfGenerator));

  // Fire-and-forget side effects (audit trail, admin notification, socket, log).
  (async () => {
    try {
      const companies = [...new Set(saved.map((s) => s.lguCompanyName))];
      const txnDocs = companies.map((company) => {
        const companyEntries = saved.filter((s) => s.lguCompanyName === company);
        return {
          submissionId,
          dataEntry: companyEntries[0]._id,
          companyName: company,
          companyType: companyEntries[0].companyType,
          submittedBy: submittedBy || "",
          type: "submission",
          description: `${companyEntries.length} entr${companyEntries.length === 1 ? "y" : "ies"} submitted by ${submittedBy || "unknown"}`,
          performedBy: submittedBy || "portal",
          meta: { entryCount: companyEntries.length, ids: companyEntries.map((e) => e.idNo) },
        };
      });
      if (txnDocs.length) await Transaction.insertMany(txnDocs, { ordered: false });
    } catch { /* silent */ }

    try {
      await Notification.create({
        recipient: "admin",
        type: "new_submission",
        title: "New Submission",
        message: `${submittedBy || "A portal user"} submitted ${saved.length} entr${saved.length === 1 ? "y" : "ies"} (${saved[0]?.lguCompanyName || "Unknown"})`,
        submissionId,
        dataEntry: saved[0]?._id,
        meta: { entryCount: saved.length, companyName: saved[0]?.lguCompanyName, submittedBy },
      });
    } catch { /* silent */ }
    if (req) {
      notifyAdmin(req, { type: "new_submission", title: "New Submission", message: `${submittedBy || "A portal user"} submitted ${saved.length} entries` });
      refreshAdmin(req, "submissions");
    }

    writeLog("info", "submission.create", {
      message: `New submission: ${saved.length} entries by ${submittedBy || "unknown"}`,
      user: submittedBy || "",
      ip: req?.ip || "",
      meta: { submissionId, count: saved.length },
    });
  })();

  return { saved, submissionId };
}

// Submit SLF data — batch (client portal)
router.post("/", optionalAuth, requirePortalRule("can_submit_slf_data"), async (req, res) => {
  try {
    // A developer holding a read-only portal context must never be able to create
    // a REAL submission under the inspected user's name. This is the single most
    // consequential portal write, so it is refused explicitly rather than relying
    // on the client hiding the button.
    const devContext = getDeveloperPortalContext(req);
    if (devContext) {
      writeLog("warn", "portal.context.write-blocked", {
        message: `Developer blocked from submitting as portal user (context ${devContext})`,
        user: req.headers.authorization ? "developer" : "",
        ip: req.ip,
        meta: { path: req.originalUrl },
      });
      return res.status(403).json({
        message:
          "Developer Portal Mode is read-only. Use Developer Settings → Submission RAW Data to correct records.",
      });
    }

    const { entries, submittedBy } = req.body || {};
    const items = Array.isArray(entries) ? entries : [req.body];
    const idempotencyKey = String(req.headers["x-idempotency-key"] || "").trim() || null;

    // Item #2: block OFFICIAL submission when the target SLF is tagged
    // non-operational (its cell is subject to EMB Region III verification). The
    // entries are saved as DRAFTS instead of becoming official records, so the
    // restriction cannot be bypassed by calling the API directly (never rely on a
    // disabled button alone). The Portal surfaces the reason from the code below.
    const targetSlfId = items.find((e) => e && e.slfGenerator)?.slfGenerator;
    if (targetSlfId && mongoose.Types.ObjectId.isValid(String(targetSlfId))) {
      const facility = await SlfFacility.findById(targetSlfId).select("statusOfSLF slfName");
      if (facility && isSlfNonOperational(facility.statusOfSLF)) {
        const PortalSubmissionQueue = require("../models/PortalSubmissionQueue");
        const email = String(submittedBy || "").trim().toLowerCase();
        const pu = email ? await UserPortal.findOne({ email }).select("_id") : null;
        const drafts = await PortalSubmissionQueue.insertMany(
          items.map((entry) => ({
            portalUser: pu?._id,
            portalUserEmail: email,
            slfGenerator: entry?.slfGenerator || targetSlfId,
            slfName: entry?.slfName || facility.slfName || "",
            type: "draft",
            status: "draft",
            payload: entry && typeof entry === "object" ? entry : {},
            createdBy: email || "portal",
          })),
          { ordered: false },
        );
        writeLog("warn", "submission.blocked.non-operational", {
          message: `Submission for non-operational SLF "${facility.slfName || targetSlfId}" saved as draft (not officially submitted).`,
          user: email || "portal",
          ip: req.ip,
          meta: { slfId: String(targetSlfId), draftCount: drafts.length },
        });
        return res.status(202).json({
          savedAsDraft: true,
          code: "SLF_NON_OPERATIONAL",
          message:
            "Your assigned SLF is currently tagged as non-operational and its cell is subject to EMB Region III verification. New submissions cannot be officially submitted while this restriction is active, so your entry was saved as a Draft.",
          data: drafts,
        });
      }
    }

    const { saved, idempotent } = await submitEntries({ entries: items, submittedBy, req, idempotencyKey });
    res.status(idempotent ? 200 : 201).json({
      message: idempotent ? "Submission already processed" : "Data submitted successfully",
      data: saved,
      idempotent: !!idempotent,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        // Machine-readable rule code + context so the Portal can render a consistent
        // rule modal with the correct next-step action (#2).
        ...(error.code ? { code: error.code } : {}),
        ...(error.ruleContext ? { ruleContext: error.ruleContext } : {}),
        // Field-specific Waste Generation feedback (tab / truckIndex / field), so
        // the Portal can point at the exact input instead of failing silently.
        ...(error.validationIssues ? { validationIssues: error.validationIssues } : {}),
      });
    }
    // Unexpected failure of a real submission — record it so it surfaces to admins
    // (App Logs + VERA notification bell) instead of failing silently for the user.
    logSlfCrudError(req, "submission.create.error", error, { submittedBy: req.body?.submittedBy });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update & resubmit a reverted entry (portal user)
router.put("/:id", optionalAuth, requirePortalRule("can_edit_submitted_data"), async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    await ensurePortalAccountCanSubmit(entry.submittedBy);
    if (entry.status !== "reverted" && entry.status !== "pending") {
      return res.status(400).json({ message: "Only reverted or pending entries can be updated" });
    }

    const allowedFields = [
      "dateOfDisposal", "lguCompanyName", "companyType", "address",
      "companyRegion", "companyProvince", "companyMunicipality", "companyBarangay",
      "trucks", "accreditedHaulers", "slfGenerator", "slfName",
      "currentCellVolume", "currentCellVolumeUnit", "cellStatus",
      "baselineUnit", "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "activeCellHazardousVolume", "activeCellHazardousUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
      "closedCellHazardousVolume", "closedCellHazardousUnit",
      "activeCellEntries", "closedCellEntries",
      "acceptsHazardousWaste",
    ];
    // Normalize + validate the incoming payload (units, wasteType enum, volumes)
    // so a resubmission can't fail with a Mongoose 500 or store invalid data.
    const updateErrors = [];
    const sanitizedBody = sanitizeSubmissionEntry(req.body || {}, updateErrors);
    if (updateErrors.length) {
      return res.status(400).json({ message: updateErrors.join(" ") });
    }
    applyEntryUpdates(entry, sanitizedBody, allowedFields, req, "submission.resubmit");
    entry.status = "pending";
    entry.revertReason = "";
    entry.revertedBy = "";
    entry.revertedAt = undefined;

    // Regenerate idNo based on current companyType and SLF province
    const previousIdNo = entry.idNo;
    let province = "";
    if (entry.slfGenerator) {
      const facility = await SlfFacility.findById(entry.slfGenerator).select("province");
      if (facility) province = facility.province;
    }
    const provCode = getProvinceCode(province);
    const typeCode = entry.companyType === "Private" ? "PVT" : entry.companyType === "LGU" ? "LGU" : "OTH";
    const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-`);
    const lastDoc = await DataSLF.findOne({ idNo: pattern, _id: { $ne: entry._id } }).sort({ idNo: -1 });
    let seq = 1;
    if (lastDoc && lastDoc.idNo) {
      const parts = lastDoc.idNo.split("-");
      const lastNum = parseInt(parts[3], 10);
      if (!isNaN(lastNum)) seq = lastNum + 1;
    }
    entry.idNo = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
    if (!Array.isArray(entry.previousIdNos)) entry.previousIdNos = [];
    if (previousIdNo && previousIdNo !== entry.idNo && !entry.previousIdNos.includes(previousIdNo)) {
      entry.previousIdNos.push(previousIdNo);
    }

    await entry.save();

    // A resubmission updates this record IN PLACE (volumes and cell placements may
    // both have changed) and flips it back to `pending`, so it starts counting
    // again. Recomputed, never incremented — the pre-revert volume cannot be
    // double-counted alongside the corrected one.
    await refreshOccupancyForFacilities(req, [entry.slfGenerator]);

    const resubmitComment = typeof req.body.resubmitComment === "string" ? req.body.resubmitComment.trim() : "";

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "resubmission",
        description: resubmitComment
          ? `Resubmitted updated entry ${entry.idNo} — "${resubmitComment}"`
          : `Resubmitted updated entry ${entry.idNo}`,
        performedBy: entry.submittedBy || "portal",
        meta: { idNo: entry.idNo, previousIdNo, comment: resubmitComment || undefined },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id)
      .setOptions({ includeHiddenYears: true })
      .populate("slfGenerator");
    res.json(populated);

    // Notify admins of resubmission
    try {
      await Notification.create({
        recipient: "admin",
        type: "resubmission",
        title: "Resubmission",
        message: `${entry.submittedBy || "A portal user"} resubmitted entry ${entry.idNo} (${entry.lguCompanyName || ""})`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, companyName: entry.lguCompanyName },
      });
    } catch { /* silent */ }
    notifyAdmin(req, { type: "resubmission", title: "Resubmission", message: `${entry.submittedBy} resubmitted ${entry.idNo}` });
    refreshAdmin(req, "submissions");

    writeLog("info", "submission.resubmit", {
      message: `Entry ${entry.idNo} resubmitted after revert`,
      user: entry.submittedBy || "portal",
      ip: req.ip,
      meta: { id: entry._id },
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    logSlfCrudError(req, "submission.resubmit.error", error, { id: req.params.id });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get latest baseline info for an SLF (by assigned name or facility id) — portal
router.get("/baseline/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    // Optional: SlfFacility _id passed by the portal so lookup works even when
    // the facility was renamed and the stored slfName no longer matches.
    const slfId = req.query.slfId;
    const slfObjectId =
      slfId && mongoose.Types.ObjectId.isValid(String(slfId))
        ? new mongoose.Types.ObjectId(String(slfId))
        : null;

    const nameOrFilters = [
      ...(slfObjectId ? [{ slfGenerator: slfObjectId }] : []),
      { slfName },
      { lguCompanyName: slfName },
    ];

    const identityFilter = slfObjectId
      ? { slfGenerator: slfObjectId }
      : { $or: nameOrFilters };

    // TWO reads, deliberately.
    //
    // The recency window alone silently lost the baseline. PATCH
    // /portal-save-baseline writes an SLF's baseline values into its BASELINE-ONLY
    // containers (findMatchingBaselineOnlyIds → updateMany), and a container is
    // created on the FIRST baseline save — so it is the OLDEST document the
    // facility owns. Every disposal submission made afterwards is newer, so on a
    // busy SLF the `createdAt: -1` window never reached it: Zambales - Iba's
    // container ranked 79th of 80 and Nueva Ecija - Santa Rosa's 68th of 69. The
    // portal then hydrated Data Entry from whatever submission happened to sort
    // first — one that carries no baseline columns at all — and every field came
    // up empty, including a Total Volume Accepted that is stored and intact.
    //
    // Asking for the containers directly makes the read window irrelevant to
    // correctness: it can only ever add fallback material now, never decide the
    // answer. Containers are at most a handful per facility.
    // The facility rides along in the SAME round trip rather than waiting for the
    // baseline to be chosen first. The portal always sends ?slfId, so the id is
    // known up front; only a caller that omits it pays for a follow-up lookup
    // (handled after `latest` is resolved, below).
    const facilityCellSelect = "numberOfCell cellNames cellTypes cellStatuses cellCapacities";
    const [containers, recent, facilityById] = await Promise.all([
      DataSLF.find({
        $and: [{ deletedAt: null }, identityFilter, BASELINE_ONLY_FILTER, baselineDataMatch],
      })
        .setOptions({ includeHiddenYears: true })
        .select(PORTAL_BASELINE_SELECT)
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(20)
        .lean(),
      DataSLF.find({ $and: [{ deletedAt: null }, identityFilter, baselineDataMatch] })
        .setOptions({ includeHiddenYears: true })
        .select(PORTAL_BASELINE_SELECT)
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      slfObjectId
        ? SlfFacility.findById(slfObjectId).select(facilityCellSelect).lean().catch(() => null)
        : Promise.resolve(null),
    ]);

    // Containers first (most recently written first), then the recency window with
    // the containers removed — `chooseBaselineRecord` picks the first container it
    // sees, and the rest stay available as fallback for a facility that has none.
    let candidates = orderBaselineCandidates(containers, recent);

    // Prefer records that match by facility id (most reliable link after a rename).
    let matchedCandidates = candidates;
    if (
      slfObjectId &&
      candidates.some((c) => String(c.slfGenerator || "") === String(slfObjectId))
    ) {
      matchedCandidates = candidates.filter(
        (c) => String(c.slfGenerator || "") === String(slfObjectId),
      );
    }
    let latest = chooseBaselineRecord(matchedCandidates);

    if (!latest && !slfObjectId) {
      candidates = await DataSLF.find({ $and: [{ deletedAt: null }, baselineDataMatch] })
        .setOptions({ includeHiddenYears: true })
        .select(PORTAL_BASELINE_SELECT)
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();
      matchedCandidates = candidates.filter((item) => {
        if (slfObjectId && String(item.slfGenerator || "") === String(slfObjectId))
          return true;
        return matchesBaselineName(item, slfName);
      });
      latest = chooseBaselineRecord(matchedCandidates);
    }

    if (!latest) return res.json(null);

    // ── Where each field is read from ──────────────────────────────────────────
    //
    // When the SLF HAS a baseline-only container, that container is authoritative
    // and every field is read from it verbatim. It is the only record the portal
    // writes baseline values to, so it is also the only record that can represent
    // a DELETION — falling back to an older submission's copy would resurrect a
    // cell entry or an address the operator had just removed.
    //
    // When it has NONE (a legacy SLF whose baseline was only ever duplicated onto
    // its submissions) there is no authoritative record, so each field is taken
    // from the newest record that actually carries it. Reading everything off a
    // single chosen record is what left Limay, Porac, Floridablanca and Prime
    // Waste Solution reporting no Total Volume Accepted while the figure sat on a
    // sibling record. Nothing here can hide a deletion, because without a
    // container the portal has never had anywhere to record one.
    const { hasContainer, valueOf, unitFor } = makeBaselineFieldReader(
      matchedCandidates,
      latest,
    );

    // #2 defensive regression signal: a record that carries baseline data but has
    // NO Total Volume Accepted is almost always a data-loss regression (the value
    // was reset/dropped on a prior save). Log it — with non-sensitive context only
    // (slfName + which baseline fields are present) — so it can be spotted in App
    // Logs without ever exposing the numbers or user data to the portal response.
    //
    // Tested against the RESOLVED value, not the chosen record's own column, so
    // this stays a genuine data-loss signal instead of firing for every legacy SLF
    // whose figure simply lives on a sibling record.
    if (valueOf("totalVolumeAccepted") == null && hasBaselineData(latest)) {
      writeLog("warn", "baseline.missing_total_volume", {
        message: `Baseline for "${latest.slfName || latest.lguCompanyName || "unknown"}" has no Total Volume Accepted but carries other baseline data`,
        meta: {
          slfName: latest.slfName || latest.lguCompanyName || null,
          recordId: String(latest._id),
          hasActiveCells: !!(latest.activeCellEntries?.length),
          hasClosedCells: !!(latest.closedCellEntries?.length),
          hasHaulers: !!(latest.accreditedHaulers?.length),
        },
      });
    }

    const baselineUnit =
      valueOf("baselineUnit") || valueOf("totalVolumeAcceptedUnit") || "m³";
    // Accredited haulers must be read from the SAME set the portal save WRITES to
    // (the baseline-only records — see findMatchingBaselineOnlyIds), otherwise a
    // stale hauler snapshot copied onto an older submission wins and the just-saved
    // vehicle capacities / client details revert on the next load.
    //
    // `hasTruckVolume` alone was not that set: it only inspects `truck.actualVolume`,
    // and the portal stores volume per VEHICLE, so a real submission whose trucks
    // carry their volume on `vehicles[]` looked volume-free and was served as the
    // hauler source. Prefer a genuine baseline-only record first.
    //
    // Once ANY container exists the search stops there, for the same reason the
    // field resolution above does: a container is the only record that can express
    // "the operator removed every hauler", and falling through to a submission's
    // copy would put the deleted haulers straight back on screen.
    const haulerSource =
      matchedCandidates.find((item) => item?.accreditedHaulers?.length > 0 && isBaselineOnlyRecord(item)) ||
      (hasContainer
        ? latest
        : matchedCandidates.find((item) => item?.accreditedHaulers?.length > 0 && !hasTruckVolume(item)) ||
          matchedCandidates.find((item) => item?.accreditedHaulers?.length > 0)) ||
      latest;

    // Resolve the approval/request flags ACROSS every candidate for this SLF, not
    // off the single record chooseBaselineRecord happens to pick.
    //
    // This is the "admin approved but the portal still says Pending" bug. The three
    // sides disagreed on scope:
    //   • admin WRITE  (baseline-update-approve) → updateMany over every record with
    //                    baseline data
    //   • admin READ   (GET /baselines)          → $max of the flags across all of an
    //                    SLF's records ("any record approved" wins)
    //   • portal READ  (here)                    → flags off ONE chosen record
    // So whenever the chosen record wasn't among the ones the write touched, the
    // admin list showed Approved while the portal kept showing Pending — with no way
    // to clear it. Verified in production data: three SLFs currently hold records
    // that disagree with each other on baselineUpdateApproved.
    //
    // Matching the admin's $max here makes both sides agree by construction, and is
    // the safe direction: an approval that reached ANY record unlocks the portal,
    // rather than being silently swallowed.
    //
    // ── …with one correction: "ANY record wins" cannot survive a container ──────
    //
    // A submission INHERITS the baseline columns of the record it was created
    // from, `baselineUpdateApproved` included. So every submission made during an
    // approved (unlocked) window keeps that approval forever, and "any record
    // wins" then reads it back as a permanent unlock that nothing can clear.
    // Measured on production: 624 records carry baselineUpdateApproved=true and
    // 621 of them are SUBMISSIONS, which left 17 of 19 assigned SLFs permanently
    // unlocked — the "saving the baseline does not lock it" report.
    //
    // The baseline-only CONTAINER is the authoritative record for baseline state.
    // Every VALUE above is already read from it verbatim when one exists, for the
    // same reason (it is the only record that can express a deletion). The
    // workflow flags now follow that same rule: read them from the container(s),
    // and fall back to the across-all-records scan only for a legacy SLF that has
    // no container — where the old behaviour is still the safe direction.
    const containerCandidates = matchedCandidates.filter((item) => isBaselineOnlyRecord(item));
    const flagSource = containerCandidates.length ? containerCandidates : matchedCandidates;
    const anyFlag = (field) => flagSource.some((item) => !!item?.[field]);
    const baselineUpdateApproved = anyFlag("baselineUpdateApproved");

    // Now that ONE record has won the election above, fetch its haulers in full.
    // Everything up to this point only needed `.length`, which the trimmed
    // projection preserves — see PORTAL_BASELINE_SELECT for the measured cost of
    // carrying every candidate's copy instead. Skipped entirely when the winner
    // has no haulers, so the common case adds no round trip at all.
    const haulerDoc =
      haulerSource?._id && haulerSource.accreditedHaulers?.length
        ? await DataSLF.findById(haulerSource._id)
            .setOptions({ includeHiddenYears: true })
            .select("accreditedHaulers")
            .lean()
        : null;

    // ── Bind the baseline's cell rows to the ADMIN's cell configuration ────────
    //
    // Every other endpoint resolves cell names at the API boundary
    // (applyResolvedCellNames); this one did not, and it is the only read that
    // feeds Data Entry. So Data Entry rendered each row's frozen snapshot name
    // while the submission lists, the admin table and the reports all rendered
    // the admin's current name — the reported "portal cells don't match Admin".
    //
    // Resolution needs the facility, not just its names, because 94.6% of stored
    // baseline rows carry NO cellIndex and have to be re-bound by name first.
    // A facility that cannot be loaded (or a legacy SLFGenerator ref) simply
    // leaves the rows untouched — never worse than before.
    const facilityForCells =
      facilityById ||
      (latest.slfGenerator
        ? await SlfFacility.findById(latest.slfGenerator).select(facilityCellSelect).lean().catch(() => null)
        : null);
    // An approval supersedes a pending request — otherwise a record still carrying
    // the old requested flag would re-show "Pending" next to an unlocked form.
    const baselineUpdateRequested = !baselineUpdateApproved && anyFlag("baselineUpdateRequested");

    res.json({
      baselineUnit,
      // Carried so the demo-session response masker can tell this is demo-owned
      // data and leave its figures readable (see utils/demoMode.js). Without it
      // the hand-built payload below has no isolation flag, every volume comes
      // back as "***********", and the demo account can never satisfy the
      // Total Volume Accepted gate.
      isDummy: latest.isDummy === true,
      lguCompanyName: valueOf("lguCompanyName"),
      companyType: valueOf("companyType"),
      address: valueOf("address"),
      companyRegion: valueOf("companyRegion"),
      companyProvince: valueOf("companyProvince"),
      companyMunicipality: valueOf("companyMunicipality"),
      companyBarangay: valueOf("companyBarangay"),
      totalVolumeAccepted: valueOf("totalVolumeAccepted"),
      totalVolumeAcceptedUnit: unitFor("totalVolumeAccepted", "totalVolumeAcceptedUnit", baselineUnit),
      activeCellResidualVolume: valueOf("activeCellResidualVolume"),
      activeCellResidualUnit: unitFor("activeCellResidualVolume", "activeCellResidualUnit", baselineUnit),
      activeCellInertVolume: valueOf("activeCellInertVolume"),
      activeCellInertUnit: unitFor("activeCellInertVolume", "activeCellInertUnit", baselineUnit),
      activeCellHazardousVolume: valueOf("activeCellHazardousVolume"),
      activeCellHazardousUnit: unitFor("activeCellHazardousVolume", "activeCellHazardousUnit", baselineUnit),
      closedCellResidualVolume: valueOf("closedCellResidualVolume"),
      closedCellResidualUnit: unitFor("closedCellResidualVolume", "closedCellResidualUnit", baselineUnit),
      closedCellInertVolume: valueOf("closedCellInertVolume"),
      closedCellInertUnit: unitFor("closedCellInertVolume", "closedCellInertUnit", baselineUnit),
      closedCellHazardousVolume: valueOf("closedCellHazardousVolume"),
      closedCellHazardousUnit: unitFor("closedCellHazardousVolume", "closedCellHazardousUnit", baselineUnit),
      acceptsHazardousWaste: valueOf("acceptsHazardousWaste") || false,
      activeCellEntries: resolveBaselineCellEntries(valueOf("activeCellEntries") || [], facilityForCells),
      closedCellEntries: resolveBaselineCellEntries(valueOf("closedCellEntries") || [], facilityForCells),
      accreditedHaulers: haulerDoc?.accreditedHaulers || [],
      baselineUpdateApproved,
      baselineUpdateRequested,
      savedAt: latest.updatedAt || latest.createdAt,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get latest baseline info for ALL SLF generators — admin tab
// Cache-aside, using the SAME service every other cached read here uses (Redis
// when configured, in-process otherwise — see utils/serverCache.js). Mounted
// AFTER optionalAuth so the resolved dummy scope is known before the key is
// built; MongoDB stays the source of truth and the entry is dropped the moment a
// baseline or submission write lands (staleKeysFor → BASELINES_CACHE_PREFIX).
const baselinesCacheKey = (req) =>
  `${BASELINES_CACHE_PREFIX}:${devWantsDummy(req) ? "dummy" : "default"}`;

router.get("/baselines", optionalAuth, cacheJson(baselinesCacheKey, 120000), async (req, res) => {
  try {
    // Aggregate from DataSLF directly — covers both SLFGenerator and SlfFacility refs
    // Include soft-deleted records since baseline is facility-level data
    // Match any record that has baseline data: totalVolumeAccepted set, OR activeCellEntries/closedCellEntries present
    // Dummy/test (SAMPLE) baselines are excluded from the production view by
    // default; only developers may opt into seeing them inline via
    // ?includeDummy=true (they are highlighted as SAMPLE on the client).
    const includeDummy = devWantsDummy(req);
    const matchStage = includeDummy
      ? baselineDataMatch
      : { $and: [baselineDataMatch, { isDummy: { $ne: true } }] };
    const startedAt = Date.now();
    const latestPerSlf = await DataSLF.aggregate([
      {
        $match: matchStage,
      },
      {
        // Reduce `trucks[]` to the single boolean the ranking below needs...
        $addFields: {
          _hasTruckVolume: {
            $gt: [
              {
                $sum: {
                  $map: {
                    input: { $ifNull: ["$trucks", []] },
                    as: "truck",
                    in: { $ifNull: ["$$truck.actualVolume", 0] },
                  },
                },
              },
              0,
            ],
          },
        },
      },
      // ...then drop `trucks` (and every other unused field) BEFORE the sort.
      // The $sort + `$group: { $first: "$$ROOT" }` below used to carry each
      // submission's whole trucks[]/vehicles[] payload through an in-memory
      // blocking sort — that, not the $match scan, was the bottleneck here.
      // Every field kept is one the response actually returns.
      { $project: BASELINE_PROJECTION },
      { $sort: { _hasTruckVolume: 1, createdAt: -1 } },
      {
        $group: {
          _id: { $ifNull: ["$slfName", "$lguCompanyName"] },
          doc: { $first: "$$ROOT" },
          _anyUpdateRequested: { $max: { $ifNull: ["$baselineUpdateRequested", false] } },
          _anyUpdateApproved: { $max: { $ifNull: ["$baselineUpdateApproved", false] } },
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$doc",
              { baselineUpdateRequested: "$_anyUpdateRequested", baselineUpdateApproved: "$_anyUpdateApproved" },
            ],
          },
        },
      },
      { $sort: { slfName: 1 } },
    ]).allowDiskUse(true);

    const results = latestPerSlf.map((d) => {
      const baselineUnit = d.baselineUnit || d.totalVolumeAcceptedUnit || "m³";
      return ({
      _id: d._id,
      slfGenerator: d.slfGenerator,
      slfName: d.slfName || d.lguCompanyName || "Unknown",
      lguCompanyName: d.lguCompanyName,
      // The Baseline Data table already searches on companyType — it was just
      // never included in this payload, so that filter key matched nothing.
      companyType: d.companyType || "",
      isDummy: d.isDummy || false,
      baselineUnit,
      totalVolumeAccepted: d.totalVolumeAccepted,
      totalVolumeAcceptedUnit: d.totalVolumeAcceptedUnit || baselineUnit,
      activeCellResidualVolume: d.activeCellResidualVolume,
      activeCellResidualUnit: d.activeCellResidualUnit || baselineUnit,
      activeCellInertVolume: d.activeCellInertVolume,
      activeCellInertUnit: d.activeCellInertUnit || baselineUnit,
      activeCellHazardousVolume: d.activeCellHazardousVolume,
      activeCellHazardousUnit: d.activeCellHazardousUnit || baselineUnit,
      closedCellResidualVolume: d.closedCellResidualVolume,
      closedCellResidualUnit: d.closedCellResidualUnit || baselineUnit,
      closedCellInertVolume: d.closedCellInertVolume,
      closedCellInertUnit: d.closedCellInertUnit || baselineUnit,
      closedCellHazardousVolume: d.closedCellHazardousVolume,
      closedCellHazardousUnit: d.closedCellHazardousUnit || baselineUnit,
      acceptsHazardousWaste: d.acceptsHazardousWaste || false,
      accreditedHaulers: d.accreditedHaulers || [],
      activeCellEntries: d.activeCellEntries || [],
      closedCellEntries: d.closedCellEntries || [],
      submittedBy: d.submittedBy,
      baselineUpdateApproved: d.baselineUpdateApproved || false,
      baselineUpdateRequested: d.baselineUpdateRequested || false,
      lastUpdated: d.updatedAt || d.createdAt,
    });
    });

    const durationMs = Date.now() - startedAt;
    if (durationMs > 1500) {
      writeLog("warn", "baselines.slow", {
        message: `GET /baselines took ${durationMs}ms for ${results.length} SLF`,
        meta: { durationMs, slfCount: results.length, includeDummy },
      });
    }

    res.json(results);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Hauler Clients CRUD (SLF Data Table → Edit Modal → Hauler Clients) ──────────
//
// Admins maintain the clients that live INSIDE the portal user's baseline
// (accreditedHaulers[].privateSectorClients / .clients), because portal users
// routinely leave Client Type and address blank. Writing here — rather than to the
// canonical slf_clients collection — is what makes the correction visible to the
// portal user in their own baseline, and it flows into slf_clients on the next sync.
//
// Records are matched BY VALUE (hauler name + client name), never by array index:
// an SLF's accreditedHaulers array is duplicated across every one of its baseline
// documents and those copies are not identically ordered, so an index-based write
// would edit the wrong client in some of them.
//
// Every mutation writes to ALL of the SLF's records that carry accreditedHaulers.
// That is deliberate: the portal read path (GET /baseline/:slfName → haulerSource),
// the admin list, and syncBaselineClients each select a record by different rules,
// and a partial write is exactly how "the edit reverted on reload" bugs happen.
const normalizeKey = (value) => String(value || "").trim().toLowerCase();

// Client entry as stored (see clientSchema): display names plus PSGC codes.
function buildClientEntry(body, existing = {}) {
  const next = { ...existing };
  const assign = (key, value) => {
    if (value !== undefined) next[key] = typeof value === "string" ? value.trim() : value;
  };
  assign("clientName", body.clientName);
  assign("clientType", body.clientType);
  assign("region", body.region);
  assign("regionName", body.regionName);
  assign("province", body.province);
  assign("provinceName", body.provinceName);
  assign("municipality", body.municipality);
  assign("municipalityName", body.municipalityName);
  return next;
}

// Resolve every baseline record for a facility that carries accreditedHaulers.
// Returns the QUERY (not a promise) so callers can either await it for documents or
// keep chaining .select()/.lean() for the read-only list.
function findHaulerClientRecords(slfGeneratorId) {
  return DataSLF.find({
    slfGenerator: slfGeneratorId,
    deletedAt: null,
    "accreditedHaulers.0": { $exists: true },
  }).setOptions({ includeHiddenYears: true });
}

// Push the change out to admin views AND to every portal account that submitted for
// this SLF, so the portal user's baseline reflects the correction without a reload.
/**
 * Coalesced canonical-client resync.
 *
 * `runBaselineClientSync` is a FULL pass over every baseline. Correcting a batch
 * of hauler clients — the normal way an admin works, one row after another —
 * would otherwise queue one full sync per edit, each redoing the last one's work.
 *
 * So: wait for the edits to stop, then run ONCE. A request arriving mid-run sets
 * `dirty`, which triggers exactly one more pass afterwards, so the last edit is
 * never the one that gets dropped. The `clients` refresh is emitted only when a
 * pass actually finishes, which is the point the figures have really moved.
 */
const CLIENT_SYNC_DEBOUNCE_MS = 3000;
let clientSyncTimer = null;
let clientSyncRunning = false;
let clientSyncDirty = false;

function scheduleClientSync(req) {
  if (clientSyncRunning) {
    clientSyncDirty = true;
    return;
  }
  if (clientSyncTimer) clearTimeout(clientSyncTimer);
  clientSyncTimer = setTimeout(async () => {
    clientSyncTimer = null;
    clientSyncRunning = true;
    try {
      const { runBaselineClientSync } = require("../services/syncBaselineClients");
      await runBaselineClientSync({ actor: "hauler-client-edit" });
      refreshAdmin(req, "clients");
    } catch (error) {
      writeLog("warn", "hauler-client.sync_failed", {
        message: `Client sync after a hauler-client edit failed: ${error.message}`,
      });
    } finally {
      clientSyncRunning = false;
      if (clientSyncDirty) {
        clientSyncDirty = false;
        scheduleClientSync(req);
      }
    }
  }, CLIENT_SYNC_DEBOUNCE_MS);
  // Never hold the process open for a derived-figure refresh.
  clientSyncTimer.unref?.();
}

async function announceHaulerClientChange(req, records) {
  refreshAdmin(req, "baselines");
  const emails = new Set();
  records.forEach((r) => {
    const email = String(r.submittedBy || "").trim();
    if (email) emails.add(email);
  });
  for (const email of emails) {
    refreshPortal(req, email, "baselines");
    notifyPortal(req, email, {
      type: "baseline_clients_updated",
      title: "Baseline Clients Updated",
      message: "An administrator updated the client details in your baseline data.",
    });
  }

  // Push the correction into the CANONICAL client collection.
  //
  // Hauler-client edits are written into the portal's baseline
  // (accreditedHaulers[].privateSectorClients) so the portal user sees them —
  // but "LGUs Served" and "Private Sectors Served" are computed from
  // `slf_clients`, which only picked the change up on the NEXT scheduled sync.
  // Until then an admin could correct a client's municipality and watch the
  // coverage figures not move at all.
  //
  // Detached and COALESCED — see scheduleClientSync.
  scheduleClientSync(req);
}

// LIST — flattened hauler→client rows for one facility, searchable + paginated.
router.get("/hauler-clients/:slfGeneratorId", adminOnly, async (req, res) => {
  try {
    const { slfGeneratorId } = req.params;
    if (!mongoose.isValidObjectId(slfGeneratorId)) {
      return res.status(400).json({ message: "A valid SLF id is required." });
    }
    // The collapse to distinct (hauler, client) pairs happens in the DATABASE.
    //
    // An SLF's accreditedHaulers array is duplicated across every one of its
    // baseline documents, so loading them all to de-duplicate in JS meant
    // shipping the whole set into Node first. Measured on production:
    // Floridablanca holds 59 baseline docs carrying 4,366 hauler copies (Prime
    // Waste 2,962; Porac 946), each with its own clients and vehicles arrays —
    // tens of thousands of sub-documents materialised to produce a few hundred
    // distinct rows. That is the bottleneck behind the Server Error on
    // Edit SLF Facility → Hauler Clients.
    //
    // $unwind + $group does the same collapse where the data already lives, so
    // the payload is proportional to the DISTINCT rows the UI renders rather than
    // to how many times the array has been copied. The projection also drops
    // `vehicles`, which this view never reads.
    const grouped = await DataSLF.aggregate([
      { $match: { slfGenerator: new mongoose.Types.ObjectId(String(slfGeneratorId)), deletedAt: null, "accreditedHaulers.0": { $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $project: { accreditedHaulers: 1, slfName: 1, lguCompanyName: 1, submittedBy: 1, updatedAt: 1 } },
      { $unwind: "$accreditedHaulers" },
      {
        $project: {
          slfName: 1, lguCompanyName: 1, submittedBy: 1, updatedAt: 1,
          haulerName: "$accreditedHaulers.haulerName",
          officeAddress: "$accreditedHaulers.officeAddress",
          client: {
            $concatArrays: [
              { $ifNull: ["$accreditedHaulers.privateSectorClients", []] },
              { $ifNull: ["$accreditedHaulers.clients", []] },
            ],
          },
        },
      },
      { $unwind: "$client" },
      {
        // One row per (hauler, client); the FIRST wins, and because the pipeline
        // is sorted newest-first that is the most recent copy — same "newest
        // copy wins" rule the old JS loop had.
        $group: {
          _id: {
            hauler: { $toLower: { $trim: { input: { $ifNull: ["$haulerName", ""] } } } },
            client: {
              $toLower: {
                $trim: {
                  input: {
                    $cond: [
                      { $eq: [{ $type: "$client" }, "string"] },
                      "$client",
                      { $ifNull: ["$client.clientName", ""] },
                    ],
                  },
                },
              },
            },
          },
          haulerName: { $first: "$haulerName" },
          officeAddress: { $first: "$officeAddress" },
          client: { $first: "$client" },
          slfName: { $first: "$slfName" },
          lguCompanyName: { $first: "$lguCompanyName" },
          submittedBy: { $first: "$submittedBy" },
          updatedAt: { $first: "$updatedAt" },
        },
      },
      { $match: { "_id.client": { $ne: "" } } },
    ]).option({ includeHiddenYears: true }).allowDiskUse(true);

    // Re-shaped into the record/hauler form the mapping below already expects, so
    // the response contract and every downstream consumer are unchanged.
    const records = [{
      slfName: grouped[0]?.slfName,
      lguCompanyName: grouped[0]?.lguCompanyName,
      submittedBy: grouped[0]?.submittedBy,
      updatedAt: grouped[0]?.updatedAt,
      accreditedHaulers: grouped.map((row) => ({
        haulerName: row.haulerName,
        officeAddress: row.officeAddress,
        privateSectorClients: [row.client],
        clients: [],
      })),
    }];

    // Collapse the duplicated copies into one distinct list per (hauler, client).
    const byKey = new Map();
    records.forEach((record) => {
      (record.accreditedHaulers || []).forEach((hauler) => {
        const haulerName = String(hauler?.haulerName || "").trim();
        const list = [
          ...(Array.isArray(hauler?.privateSectorClients) ? hauler.privateSectorClients : []),
          ...(Array.isArray(hauler?.clients) ? hauler.clients : []),
        ];
        list.forEach((raw) => {
          const client = typeof raw === "string" ? { clientName: raw } : raw || {};
          const clientName = String(client.clientName || "").trim();
          if (!clientName) return;
          const key = `${normalizeKey(haulerName)}|${normalizeKey(clientName)}`;
          if (byKey.has(key)) return;
          byKey.set(key, {
            key,
            haulerName,
            haulerAddress: hauler?.officeAddress || "",
            clientName,
            clientType: client.clientType || "",
            regionName: client.regionName || "",
            provinceName: client.provinceName || "",
            municipalityName: client.municipalityName || "",
            region: client.region || "",
            province: client.province || "",
            municipality: client.municipality || "",
            // Surfaced so the UI can highlight exactly what the portal user omitted.
            incomplete: !client.clientType || !client.provinceName || !client.municipalityName,
          });
        });
      });
    });

    // ── Municipality resolution + Region III classification ───────────────────
    //
    // Client addresses are free text typed by portal users, so raw string
    // comparison misclassifies anything with different casing, a "City of"
    // prefix or a known abbreviation. Resolve each one against the SAME
    // Region III masterlist and matcher the LGU dashboard uses
    // (utils/lguMatch + Region3Lgu), so a municipality is classified
    // identically wherever it appears in the system.
    //
    // Both lookups are done ONCE per request, not per row.
    const [region3ProvinceSet, masterMunis] = await Promise.all([
      getRegion3ProvinceSet(),
      Region3Lgu.find({ status: "Active", lguType: { $in: ["Municipality", "City"] } })
        .select("name normalizedName province normalizedProvince psgcCode aliases lguType")
        .lean(),
    ]);

    let rows = [...byKey.values()].map((row) => {
      const match = matchClient(
        {
          municipality: row.municipalityName,
          province: row.provinceName,
          name: row.clientName,
        },
        masterMunis,
      );
      // Only an exact or high-confidence match may rewrite the stored text.
      // "medium"/"multiple" are reported but NOT applied — silently replacing a
      // municipality on a fuzzy guess would corrupt served-LGU counts, which is
      // exactly what the matcher's confidence levels exist to prevent.
      const classification = match?.classification || "none";
      const confident = classification === "exact" || classification === "high";
      const suggestion = match?.suggestions?.[0];
      return {
        ...row,
        municipalityName:
          confident && suggestion?.name ? suggestion.name : row.municipalityName,
        municipalityMatch: classification,
        regionClass: classifyRegion(
          { province: row.provinceName, region: row.regionName },
          region3ProvinceSet,
        ),
      };
    });

    const search = String(req.query.search || "").trim().toLowerCase();
    if (search) {
      rows = rows.filter((r) =>
        [r.clientName, r.haulerName, r.provinceName, r.municipalityName, r.clientType]
          .some((v) => String(v || "").toLowerCase().includes(search)),
      );
    }
    const type = String(req.query.type || "").trim();
    if (type) rows = rows.filter((r) => String(r.clientType || "") === type);
    if (String(req.query.incompleteOnly || "") === "true") rows = rows.filter((r) => r.incomplete);

    rows.sort((a, b) => a.haulerName.localeCompare(b.haulerName) || a.clientName.localeCompare(b.clientName));
    const total = rows.length;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 10));
    const paged = rows.slice((page - 1) * limit, page * limit);

    const haulers = [...new Set(rows.map((r) => r.haulerName).filter(Boolean))].sort();
    res.json({ rows: paged, total, page, limit, haulers, incompleteCount: rows.filter((r) => r.incomplete).length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// CREATE — add a client under a named hauler, across every baseline record.
/**
 * Fan out a hauler/client mutation to every module that reads that data.
 *
 * Hauler and client names feed the Portal panes, dashboard summaries, reports
 * and the submission forms, all of which cache their own copy. Without this the
 * three CRUD routes below persisted correctly but nothing else noticed until a
 * manual page reload — the "changes don't propagate" symptom.
 *
 * `refreshAdmin("baselines")` also invalidates the summary / cell-usage caches
 * (see utils/socketEmit), so admin totals recompute rather than serving a stale
 * aggregate. Portal users assigned to this facility are notified individually,
 * because their panes are scoped to their own email room.
 *
 * Fire-and-forget: a socket problem must never fail an already-committed write.
 */
function notifyHaulerClientChange(req, slfGeneratorId) {
  refreshAdmin(req, "baselines");
  refreshAdmin(req, "hauler-clients");
  (async () => {
    try {
      const UserPortal = require("../models/UserPortal");
      const assigned = await UserPortal.find({ assignedSlf: slfGeneratorId })
        .select("email")
        .lean();
      assigned.forEach((user) => {
        if (user?.email) refreshPortal(req, user.email, "hauler-clients");
      });
    } catch {
      /* best-effort — the write already succeeded */
    }
  })();
}

router.post("/hauler-clients/:slfGeneratorId", adminOnly, async (req, res) => {
  try {
    const { slfGeneratorId } = req.params;
    if (!mongoose.isValidObjectId(slfGeneratorId)) {
      return res.status(400).json({ message: "A valid SLF id is required." });
    }
    const haulerName = String(req.body?.haulerName || "").trim();
    const clientName = String(req.body?.clientName || "").trim();
    if (!haulerName) return res.status(400).json({ message: "Hauler is required." });
    if (!clientName) return res.status(400).json({ message: "Client name is required." });

    const records = await findHaulerClientRecords(slfGeneratorId);
    if (!records.length) return res.status(404).json({ message: "No baseline record with accredited haulers for this SLF." });

    const entry = buildClientEntry({ ...req.body, clientName });
    let added = 0;
    for (const record of records) {
      const hauler = (record.accreditedHaulers || []).find(
        (h) => normalizeKey(h?.haulerName) === normalizeKey(haulerName),
      );
      if (!hauler) continue;
      const exists = [
        ...(hauler.privateSectorClients || []),
        ...(hauler.clients || []),
      ].some((c) => normalizeKey(typeof c === "string" ? c : c?.clientName) === normalizeKey(clientName));
      if (exists) continue;
      hauler.privateSectorClients = [...(hauler.privateSectorClients || []), entry];
      record.markModified("accreditedHaulers");
      await record.save();
      added += 1;
    }
    if (!added) return res.status(409).json({ message: `"${clientName}" already exists under ${haulerName}.` });

    await announceHaulerClientChange(req, records);
    writeLog("info", "hauler-client.create", {
      message: `Added client "${clientName}" under hauler "${haulerName}"`,
      user: getRequestActor(req), ip: req.ip, meta: { slfGeneratorId, recordsUpdated: added },
    });
    notifyHaulerClientChange(req, slfGeneratorId);
    res.status(201).json({ message: "Client added", recordsUpdated: added });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// UPDATE — the primary use case: filling in Client Type / address the portal user
// left blank. Matched by (hauler, original client name) across every record.
router.put("/hauler-clients/:slfGeneratorId", adminOnly, async (req, res) => {
  try {
    const { slfGeneratorId } = req.params;
    if (!mongoose.isValidObjectId(slfGeneratorId)) {
      return res.status(400).json({ message: "A valid SLF id is required." });
    }
    const haulerName = String(req.body?.haulerName || "").trim();
    const originalClientName = String(req.body?.originalClientName || req.body?.clientName || "").trim();
    if (!haulerName || !originalClientName) {
      return res.status(400).json({ message: "Hauler and client name are required." });
    }
    const records = await findHaulerClientRecords(slfGeneratorId);
    let updated = 0;
    for (const record of records) {
      let touched = false;
      (record.accreditedHaulers || []).forEach((hauler) => {
        if (normalizeKey(hauler?.haulerName) !== normalizeKey(haulerName)) return;
        ["privateSectorClients", "clients"].forEach((field) => {
          const list = hauler[field];
          if (!Array.isArray(list)) return;
          hauler[field] = list.map((raw) => {
            const client = typeof raw === "string" ? { clientName: raw } : raw || {};
            if (normalizeKey(client.clientName) !== normalizeKey(originalClientName)) return raw;
            touched = true;
            return buildClientEntry(req.body, client);
          });
        });
      });
      if (!touched) continue;
      record.markModified("accreditedHaulers");
      await record.save();
      updated += 1;
    }
    if (!updated) return res.status(404).json({ message: "That client was not found under this hauler." });

    await announceHaulerClientChange(req, records);
    writeLog("info", "hauler-client.update", {
      message: `Updated client "${originalClientName}" under hauler "${haulerName}"`,
      user: getRequestActor(req), ip: req.ip, meta: { slfGeneratorId, recordsUpdated: updated },
    });
    notifyHaulerClientChange(req, slfGeneratorId);
    res.json({ message: "Client updated", recordsUpdated: updated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// DELETE — remove a client from its hauler across every baseline record.
router.delete("/hauler-clients/:slfGeneratorId", adminOnly, async (req, res) => {
  try {
    const { slfGeneratorId } = req.params;
    if (!mongoose.isValidObjectId(slfGeneratorId)) {
      return res.status(400).json({ message: "A valid SLF id is required." });
    }
    const haulerName = String(req.query.haulerName || req.body?.haulerName || "").trim();
    const clientName = String(req.query.clientName || req.body?.clientName || "").trim();
    if (!haulerName || !clientName) {
      return res.status(400).json({ message: "Hauler and client name are required." });
    }
    const records = await findHaulerClientRecords(slfGeneratorId);
    let removed = 0;
    for (const record of records) {
      let touched = false;
      (record.accreditedHaulers || []).forEach((hauler) => {
        if (normalizeKey(hauler?.haulerName) !== normalizeKey(haulerName)) return;
        ["privateSectorClients", "clients"].forEach((field) => {
          const list = hauler[field];
          if (!Array.isArray(list)) return;
          const next = list.filter((raw) => {
            const name = typeof raw === "string" ? raw : raw?.clientName;
            return normalizeKey(name) !== normalizeKey(clientName);
          });
          if (next.length !== list.length) {
            hauler[field] = next;
            touched = true;
          }
        });
      });
      if (!touched) continue;
      record.markModified("accreditedHaulers");
      await record.save();
      removed += 1;
    }
    if (!removed) return res.status(404).json({ message: "That client was not found under this hauler." });

    await announceHaulerClientChange(req, records);
    writeLog("warn", "hauler-client.delete", {
      message: `Deleted client "${clientName}" from hauler "${haulerName}"`,
      user: getRequestActor(req), ip: req.ip, meta: { slfGeneratorId, recordsUpdated: removed },
    });
    notifyHaulerClientChange(req, slfGeneratorId);
    res.json({ message: "Client deleted", recordsUpdated: removed });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin update baseline data for a specific DataSLF record
router.put("/baselines/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Baseline record not found" });

    const fields = [
      "baselineUnit",
      "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "activeCellHazardousVolume", "activeCellHazardousUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
      "closedCellHazardousVolume", "closedCellHazardousUnit",
      "acceptsHazardousWaste",
      "accreditedHaulers",
      "activeCellEntries",
      "closedCellEntries",
    ];
    for (const f of fields) {
      if (req.body[f] === undefined) continue;
      // #2: never blank out an existing Total Volume Accepted via a partial admin
      // edit. A null/empty/non-numeric incoming value preserves the stored value
      // (0 is valid and still applies; a numeric string is coerced to a Number).
      // Deliberate clearing is done via DELETE /baselines/:id, not this handler.
      if (f === "totalVolumeAccepted") {
        const resolved = resolveTotalVolumeForUpdate(req.body[f]);
        if (!resolved.apply) continue; // preserve existing stored value
        entry[f] = resolved.value;
        continue;
      }
      entry[f] = req.body[f];
    }
    await entry.save();

    // Keep the facility's declared unit in step with the baseline's unit, so an
    // admin editing the baseline unit doesn't leave the facility (and every admin
    // view that reads it) describing the volumes with the old one.
    await syncFacilityDeclaredUnit(
      entry.slfGenerator,
      entry.baselineUnit || entry.totalVolumeAcceptedUnit,
    );

    await Transaction.create({
      dataEntry: entry._id,
      submissionId: entry.submissionId,
      companyName: entry.slfName,
      submittedBy: entry.submittedBy,
      type: "baseline_update",
      description: `Admin updated baseline data for ${entry.slfName}`,
      performedBy: req.body.updatedBy || getRequestActor(req),
      meta: { entryId: entry._id, slfName: entry.slfName },
    });

    writeLog("info", "baseline.admin-update", {
      message: `Admin updated baseline for ${entry.slfName}`,
      user: req.body.updatedBy || getRequestActor(req),
      meta: { entryId: entry._id, slfName: entry.slfName },
    });

    res.json({ message: "Baseline updated", data: entry });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin delete baseline data for a specific DataSLF record (clears baseline fields)
router.delete("/baselines/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Baseline record not found" });

    const slfName = entry.slfName || entry.lguCompanyName;

    // Clear baseline data from ALL DataSLF documents for this SLF so the
    // aggregation in GET /baselines no longer returns any row for this SLF.
    const baselineClear = {
      $unset: {
        baselineUnit: "",
        totalVolumeAccepted: "",
        totalVolumeAcceptedUnit: "",
        activeCellResidualVolume: "",
        activeCellResidualUnit: "",
        activeCellInertVolume: "",
        activeCellInertUnit: "",
        activeCellHazardousVolume: "",
        activeCellHazardousUnit: "",
        closedCellResidualVolume: "",
        closedCellResidualUnit: "",
        closedCellInertVolume: "",
        closedCellInertUnit: "",
        closedCellHazardousVolume: "",
        closedCellHazardousUnit: "",
        baselineUpdateRequestedAt: "",
        baselineUpdateApprovedAt: "",
        baselineUpdateApprovedBy: "",
      },
      $set: {
        acceptsHazardousWaste: false,
        activeCellEntries: [],
        closedCellEntries: [],
        accreditedHaulers: [],
        baselineUpdateRequested: false,
        baselineUpdateApproved: false,
      },
    };

    // Update all documents belonging to this SLF (matching by slfName or lguCompanyName)
    await DataSLF.updateMany(
      { $or: [{ slfName }, { lguCompanyName: slfName }] },
      baselineClear
    );

    await Transaction.create({
      dataEntry: entry._id,
      submissionId: entry.submissionId,
      companyName: slfName,
      submittedBy: entry.submittedBy,
      type: "baseline_delete",
      description: `Admin cleared baseline data for ${slfName}`,
      performedBy: getRequestActor(req),
      meta: { entryId: entry._id, slfName },
    });

    writeLog("warn", "baseline.admin-delete", {
      message: `Admin cleared baseline data for ${slfName}`,
      user: getRequestActor(req),
      meta: { entryId: entry._id, slfName },
    });

    res.json({ message: "Baseline data cleared" });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin approve baseline update request
// Every distinct portal account that has submitted for this SLF, so a baseline
// approval/lock/rejection reaches all of them rather than only the owner of the
// newest record. Falls back to the latest record's submitter so a single-user SLF
// behaves exactly as before.
async function baselineNotifyRecipients(filter, latest) {
  const emails = new Set();
  try {
    const submitters = await DataSLF.find(filter)
      .setOptions({ includeHiddenYears: true })
      .distinct("submittedBy");
    submitters.forEach((email) => {
      const trimmed = String(email || "").trim();
      if (trimmed) emails.add(trimmed);
    });
  } catch { /* fall back to the single submitter below */ }
  const fallback = String(latest?.submittedBy || "").trim();
  if (fallback) emails.add(fallback);
  return [...emails];
}

router.patch("/baseline-update-approve/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    const { approvedBy } = req.body || {};

    // Match by name variants + merged BESLF aliases so legacy/merged data is covered.
    const ids = await resolveSlfRecordIds(slfName, { requireBaselineData: true });
    const filter = { _id: { $in: ids } };

    // Update ALL docs for this company so aggregation always picks up the flag
    await DataSLF.updateMany(filter, {
      $set: {
        baselineUpdateApproved: true,
        baselineUpdateApprovedAt: new Date(),
        baselineUpdateApprovedBy: approvedBy || getRequestActor(req),
        baselineUpdateRequested: false,
      },
    });

    // The newest record and the recipient list are independent reads — issue them
    // together instead of one after the other.
    const [latest, submitterEmails] = await Promise.all([
      ids.length
        ? DataSLF.findOne(filter)
            .setOptions({ includeHiddenYears: true })
            .sort({ createdAt: -1, _id: -1 })
            .select("_id submissionId submittedBy")
            .lean()
        : null,
      ids.length
        ? DataSLF.find(filter).setOptions({ includeHiddenYears: true }).distinct("submittedBy")
        : [],
    ]);
    if (!latest) return res.status(404).json({ message: "Baseline not found" });

    // Notify EVERY portal user who submitted for this SLF, not just whoever owns the
    // most recent record. An SLF can be worked by several portal accounts, and the
    // requester is not necessarily `latest.submittedBy` — addressing only that one
    // left the actual requester's portal sitting on "Pending".
    const recipients = [
      ...new Set(
        [...submitterEmails, latest.submittedBy]
          .map((email) => String(email || "").trim())
          .filter(Boolean),
      ),
    ];

    // One insertMany instead of a serialized create-per-recipient round trip, and
    // the audit row is written alongside it rather than after.
    const notificationDocs = recipients.map((email) => ({
      recipient: email,
      type: "baseline_update_approved",
      title: "Baseline Update Approved",
      message: `Your baseline update request for ${slfName} has been approved. You may now update your baseline data.`,
      meta: { slfName },
    }));

    await Promise.all([
      notificationDocs.length
        ? Notification.insertMany(notificationDocs, { ordered: false }).catch(() => {})
        : Promise.resolve(),
      // A baseline event belongs to the BASELINE, not to whichever submission
      // happened to be newest. `latest` here is resolved across every record for
      // the SLF — submissions included, because they carry baseline copies — so
      // stamping its `submissionId`/`_id` filed this row inside that submission's
      // Transaction History, mixing baseline events into a disposal thread.
      // Identified by slfName only; the thread endpoint keys baseline events off
      // that (see BASELINE_TXN_TYPES).
      Transaction.create({
        companyName: slfName,
        submittedBy: latest.submittedBy,
        type: "baseline_update_approved",
        description: `Admin approved baseline update request for ${slfName}`,
        performedBy: approvedBy || getRequestActor(req),
        meta: { slfName },
      }).catch(() => {}),
    ]);

    // Socket emits are fire-and-forget and never hit the database.
    recipients.forEach((email) => {
      notifyPortal(req, email, { type: "baseline_update_approved", title: "Baseline Update Approved" });
      // The portal's baseline/dashboard views reload on `data-refresh`, NOT on the
      // bell notification. Without this the lock state and dashboard values stayed
      // stale until a manual page refresh.
      refreshPortal(req, email, "baselines");
    });
    // Keep the admin's own baseline list/tiles in step (and bust the server caches).
    refreshAdmin(req, "baselines");

    writeLog("info", "baseline.update-approved", {
      message: `Baseline update approved for ${slfName}`,
      user: approvedBy || getRequestActor(req),
    });

    res.json({ message: "Baseline update approved", data: latest });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin revoke baseline update approval (re-lock)
router.patch("/baseline-update-lock/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    const { lockedBy } = req.body || {};

    const ids = await resolveSlfRecordIds(slfName, { requireBaselineData: true });
    const filter = { _id: { $in: ids } };

    const result = await DataSLF.updateMany(filter, {
      $set: { baselineUpdateApproved: false },
    });

    if (result.matchedCount === 0) return res.status(404).json({ message: "Baseline not found" });

    const latest = await DataSLF.findOne(filter).setOptions({ includeHiddenYears: true }).sort({ createdAt: -1 });

    // Notify every portal user for this SLF in real time, and push a data-refresh so
    // the re-lock takes effect in the portal without a manual reload.
    const lockRecipients = await baselineNotifyRecipients(filter, latest);
    for (const email of lockRecipients) {
      try {
        await Notification.create({
          recipient: email,
          type: "baseline_locked",
          title: "Baseline Locked",
          message: `Your baseline data for ${slfName} has been locked by an admin.`,
          meta: { slfName },
        });
      } catch { /* silent */ }
      notifyPortal(req, email, { type: "baseline_locked", title: "Baseline Locked" });
      refreshPortal(req, email, "baselines");
    }
    refreshAdmin(req, "baselines");

    // Log transaction
    try {
      await Transaction.create({
        submissionId: latest?.submissionId,
        dataEntry: latest?._id,
        companyName: slfName,
        submittedBy: latest?.submittedBy,
        type: "baseline_locked",
        description: `Admin locked baseline data for ${slfName}`,
        performedBy: lockedBy || getRequestActor(req),
        meta: { slfName },
      });
    } catch { /* silent */ }

    writeLog("info", "baseline.locked", {
      message: `Baseline locked for ${slfName}`,
      user: lockedBy || getRequestActor(req),
    });

    res.json({ message: "Baseline re-locked" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin reject baseline update request
router.patch("/baseline-update-reject/:slfName", async (req, res) => {
  try {
    const slfName = req.params.slfName;
    const { rejectedBy, reason } = req.body || {};

    const ids = await resolveSlfRecordIds(slfName, { requireBaselineData: true });
    const filter = { _id: { $in: ids } };

    // Clear flags on ALL matching docs
    await DataSLF.updateMany(filter, {
      $set: { baselineUpdateRequested: false, baselineUpdateApproved: false },
    });

    const latest = ids.length
      ? await DataSLF.findOne(filter).setOptions({ includeHiddenYears: true }).sort({ createdAt: -1 })
      : null;
    if (!latest) return res.status(404).json({ message: "Baseline not found" });

    // Notify every portal user for this SLF, and push a data-refresh so the cleared
    // request state reaches the portal without a manual reload.
    const rejectRecipients = await baselineNotifyRecipients(filter, latest);
    for (const email of rejectRecipients) {
      try {
        await Notification.create({
          recipient: email,
          type: "baseline_update_rejected",
          title: "Baseline Update Request Rejected",
          message: `Your baseline update request for ${slfName} has been rejected.${reason ? " Reason: " + reason : ""}`,
          meta: { slfName, reason },
        });
      } catch { /* silent */ }
      notifyPortal(req, email, { type: "baseline_update_rejected", title: "Baseline Update Rejected" });
      refreshPortal(req, email, "baselines");
    }
    refreshAdmin(req, "baselines");

    // Log transaction
    try {
      await Transaction.create({
        submissionId: latest.submissionId,
        dataEntry: latest._id,
        companyName: slfName,
        submittedBy: latest.submittedBy,
        type: "baseline_update_request",
        description: `Admin rejected baseline update request for ${slfName}${reason ? ": " + reason : ""}`,
        performedBy: rejectedBy || getRequestActor(req),
        meta: { slfName, reason, action: "rejected" },
      });
    } catch { /* silent */ }

    res.json({ message: "Baseline update request rejected", data: latest });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: Request submission edit (for acknowledged entries)
router.patch("/:id/request-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (entry.status !== "acknowledged") {
      return res.status(400).json({ message: "Only approved entries can request edits" });
    }

    const { reason, requestedBy } = req.body || {};
    await ensurePortalAccountCanSubmit(requestedBy || entry.submittedBy);
    entry.revertRequested = true;
    entry.revertReason = reason;
    entry.revertRequestedAt = new Date();
    await entry.save();

    // Notify admin
    try {
      await Notification.create({
        recipient: "admin",
        type: "submission_edit_request",
        title: "Submission Edit Request",
        message: `${requestedBy || "A portal user"} requested to edit submission ${entry.idNo}`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, reason, requestedBy },
      });
    } catch { /* silent */ }
    notifyAdmin(req, { type: "submission_edit_request", title: "Edit Request", message: `${requestedBy} requested edit for ${entry.idNo}` });
    refreshAdmin(req, "submissions");

    // Log transaction
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "submission_edit_request",
        description: `Portal user requested edit for ${entry.idNo}: ${reason}`,
        performedBy: requestedBy || "portal",
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }

    res.json({ message: "Edit request submitted", data: entry });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Approve submission edit request (revert the entry so portal user can edit)
router.patch("/:id/approve-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const { approvedBy, reason } = req.body || {};
    entry.status = "reverted";
    entry.revertedBy = approvedBy || getRequestActor(req);
    entry.revertedAt = new Date();
    entry.revertReason = reason || entry.revertReason || "Edit request approved by admin";
    entry.revertRequested = false;
    await entry.save();

    // Notify portal user
    try {
      await Notification.create({
        recipient: entry.submittedBy,
        type: "submission_edit_approved",
        title: "Edit Request Approved",
        message: `Your edit request for submission ${entry.idNo} has been approved. You may now edit and resubmit.`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }
    notifyPortal(req, entry.submittedBy, { type: "submission_edit_approved", title: "Edit Approved" });
    refreshAdmin(req, "submissions");

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "submission_edit_approved",
        description: `Admin approved edit request for ${entry.idNo}`,
        performedBy: approvedBy || getRequestActor(req),
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json({ message: "Edit request approved", data: populated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin: Reject submission edit request
router.patch("/:id/reject-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const { rejectedBy, reason } = req.body || {};
    entry.revertRequested = false;
    entry.revertReason = "";
    await entry.save();

    // Notify portal user
    try {
      await Notification.create({
        recipient: entry.submittedBy,
        type: "submission_edit_rejected",
        title: "Edit Request Rejected",
        message: `Your edit request for submission ${entry.idNo} was rejected. Reason: ${reason || "Not specified"}`,
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }
    notifyPortal(req, entry.submittedBy, { type: "submission_edit_rejected", title: "Edit Rejected" });
    refreshAdmin(req, "submissions");

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "submission_edit_rejected",
        description: `Admin rejected edit request for ${entry.idNo}: ${reason || "No reason"}`,
        performedBy: rejectedBy || getRequestActor(req),
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json({ message: "Edit request rejected", data: populated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── SLF Location Map — submission status for a given official day ──
// ONE compact record per SLF that has a submission whose DISPOSAL DATE falls on
// the selected Manila day (defaults to today via ?date=YYYY-MM-DD) — the SAME
// date field + timezone the Disposal Calendar groups by, so the two never
// disagree. Per-SLF status is classified with the shared priority rule
// (acknowledged → pending → reverted → rejected). The frontend treats SLFs
// absent from this list as "No Submission", and a failed request as "Unknown".
router.get("/today-status", adminOnly, async (req, res) => {
  try {
    const { dayRangeFor } = require("../utils/appTime");
    const { normalizeStatus, classifyMapStatus, classifySlfStatus } = require("../utils/submissionStatus");

    // ── mode=latest ──────────────────────────────────────────────────────────
    // Per SLF, classify the LATEST applicable Disposal Calendar record (its most
    // recent dateOfDisposal), using the FULL workflow classification so the map
    // marker matches the Disposal Activity calendar (submitted/pending/reverted/
    // rejected) instead of collapsing reverted/rejected to gray. SLFs with no
    // calendar record at all are simply absent — the client renders a distinct
    // "no calendar data" fallback for them. Reused by the SLF Location Map so a
    // marker reflects an SLF's real last-known status, not just "today".
    if (String(req.query.mode || "").toLowerCase() === "latest") {
      const groups = await DataSLF.aggregate([
        // A baseline container carries `dateOfDisposal: <save time>`, so without
        // this it became the SLF's "latest calendar record" the moment a baseline
        // was saved and drove the map marker to Pending. It is not a disposal.
        { $match: { deletedAt: null, isDummy: { $ne: true }, dateOfDisposal: { $ne: null }, ...SUBMISSION_HAS_TRUCKS } },
        { $sort: { dateOfDisposal: -1 } },
        { $group: {
          _id: "$slfGenerator",
          slfName: { $first: "$slfName" },
          latestDate: { $first: "$dateOfDisposal" },
          // Keep only the most recent entries (bounded) — enough to cover the
          // latest calendar day plus its resubmission context.
          entries: { $push: { d: "$dateOfDisposal", s: "$status", resub: { $gt: [ { $size: { $ifNull: ["$previousIdNos", []] } }, 0 ] } } },
          submissionCount: { $sum: 1 },
          totalVolume: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
        } },
        { $addFields: { entries: { $slice: ["$entries", 60] } } },
      ]).allowDiskUse(true);

      const dayKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
      const statuses = groups
        .filter((g) => g._id)
        .map((g) => {
          const latestKey = dayKey(g.latestDate);
          // Records ON the latest calendar day only.
          const dayEntries = (g.entries || []).filter((e) => dayKey(e.d) === latestKey);
          const norm = dayEntries.map((e) => normalizeStatus(e.s));
          // Full state: submitted | pending | reverted | rejected | none.
          const full = classifySlfStatus(norm);
          // A pending latest day whose pending records are resubmissions surfaces
          // as pending-resubmission (matches the day view's distinction).
          const resubNorm = dayEntries.filter((e) => e.resub).map((e) => normalizeStatus(e.s));
          const isResubPending = classifySlfStatus(resubNorm) === "pending";
          let submissionStatus =
            full === "submitted" ? "acknowledged"
              : full === "pending" ? (isResubPending ? "pending-resubmission" : "pending")
                : full; // reverted | rejected | none
          if (submissionStatus === "none") submissionStatus = "no-submission";
          return {
            slfId: String(g._id),
            slfName: g.slfName || "",
            submissionStatus,
            latestSubmissionAt: g.latestDate,
            submissionCount: g.submissionCount,
            totalVolume: Math.round((g.totalVolume || 0) * 100) / 100,
          };
        });
      return res.json({ generatedAt: new Date(), mode: "latest", statuses });
    }

    // No future dates (unless a future reporting workflow requires them).
    const requested = String(req.query.date || "").trim();
    const now = todayRange();
    const sel = requested ? dayRangeFor(requested) : now;
    const { start, end } = sel.start > now.start ? now : sel;
    const rows = await DataSLF.aggregate([
      { $match: {
        deletedAt: null,
        isDummy: { $ne: true },
        // Match by dateOfDisposal (the calendar's date field), not createdAt.
        dateOfDisposal: { $gte: start, $lt: end },
        // A baseline saved today is not a disposal reported today.
        ...SUBMISSION_HAS_TRUCKS,
      } },
      { $group: {
        _id: "$slfGenerator",
        slfName: { $first: "$slfName" },
        statuses: { $push: "$status" },
        // Statuses of RESUBMISSION entries only (those carrying prior idNos). Push
        // null for non-resubmissions and filter it out in JS BEFORE normalizeStatus
        // — never $$REMOVE (version-fragile in $push) and never a bare "" (which
        // normalizeStatus maps to "pending", which would misclassify every initial
        // pending as a resubmission and hide the yellow Pending icon).
        resubStatuses: { $push: { $cond: [
          { $gt: [ { $size: { $ifNull: ["$previousIdNos", []] } }, 0 ] },
          "$status",
          null,
        ] } },
        submissionCount: { $sum: 1 },
        totalVolume: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
        latestSubmissionAt: { $max: "$dateOfDisposal" },
        latestStatusUpdatedAt: { $max: "$updatedAt" },
      } },
    ]);
    // Date-specific status per SLF for the selected day, using the FULL workflow
    // classification so the map marker matches the Disposal Calendar: acknowledged
    // | pending | pending-resubmission | reverted | rejected. SLFs with no record
    // for the day are absent (the client renders a neutral "no-activity" marker).
    const statuses = rows
      .filter((r) => r._id)
      .map((r) => {
        const full = classifySlfStatus((r.statuses || []).map(normalizeStatus));
        // A pending day whose pending entries are resubmissions (previously
        // reverted) surfaces distinctly from a pending initial submission.
        const resubFull = classifySlfStatus((r.resubStatuses || []).filter(Boolean).map(normalizeStatus));
        const submissionStatus =
          full === "submitted" ? "acknowledged"
            : full === "pending" ? (resubFull === "pending" ? "pending-resubmission" : "pending")
              : full; // reverted | rejected | none
        return {
          slfId: String(r._id),
          slfName: r.slfName || "",
          submissionStatus: submissionStatus === "none" ? "no-submission" : submissionStatus,
          latestSubmissionAt: r.latestSubmissionAt,
          submissionCount: r.submissionCount,
          totalVolume: Math.round((r.totalVolume || 0) * 100) / 100,
        };
      })
      .filter((s) => s.submissionStatus !== "no-submission");
    res.json({ generatedAt: new Date(), dayStart: start, dayEnd: end, statuses });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Dashboard stats
// The cache lives in middleware rather than inline so this route gets the same
// single-flight guard as the other dashboard tiles: when the key expires under a
// dozen open dashboards, ONE request runs the eight aggregation passes and the
// rest wait for it. 60s TTL is a safety net; refreshAdmin() busts the key on
// every submission/baseline/facility write, so the tiles are never stale after a
// CRUD op. Keyed by dummy-inclusion because that changes the record set.
const statsCacheKey = (req) => `${STATS_CACHE_PREFIX}:${devWantsDummy(req) ? "dummy" : "default"}`;
router.get("/stats", cacheJson(statsCacheKey, 60000), async (req, res) => {
  try {
    // Exclude dummy/test entries from all production dashboard tiles. Developers
    // may opt in via ?includeDummy=true (requires a developer token).
    const includeDummy = devWantsDummy(req);
    // Baseline containers are not submissions — counting them inflated the
    // "Submissions" tile and put a phantom entry in the Pending bucket after every
    // first baseline save. See SUBMISSION_HAS_TRUCKS.
    const match = includeDummy
      ? { deletedAt: null, ...SUBMISSION_HAS_TRUCKS }
      : { deletedAt: null, ...NON_DUMMY_CLAUSE, ...SUBMISSION_HAS_TRUCKS };
    const [submissions, generators, totalTrucks, byStatus, byCompanyType, wasteByType, monthlyData, recentSubmissions] =
      await Promise.all([
        DataSLF.countDocuments(match),
        SLFGenerator.countDocuments(),
        DataSLF.aggregate([
          { $match: match },
          { $group: { _id: null, total: { $sum: { $ifNull: ["$truckCount", 0] } } } },
        ]),
        DataSLF.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
        DataSLF.aggregate([{ $match: match }, { $group: { _id: "$companyType", count: { $sum: 1 } } }]),
        DataSLF.aggregate([
          { $match: match },
          { $unwind: "$trucks" },
          // Waste type + volume live on each VEHICLE when a truck carries them (the
          // portal stores per-vehicle wasteType/actualVolume) and only fall back to
          // the truck level for single-entry rows. Grouping by the truck level alone
          // made every multi-vehicle hazardous load count as its truck's (often
          // empty) type — so Hazardous Waste went missing from this breakdown.
          // Mirror computeSlfMetrics: prefer vehicles with volume, else the truck.
          {
            $project: {
              entries: {
                $let: {
                  vars: {
                    vs: {
                      $filter: {
                        input: { $ifNull: ["$trucks.vehicles", []] },
                        as: "v",
                        cond: { $gt: [{ $ifNull: ["$$v.actualVolume", 0] }, 0] },
                      },
                    },
                  },
                  in: {
                    $cond: [
                      { $gt: [{ $size: "$$vs" }, 0] },
                      {
                        $map: {
                          input: "$$vs",
                          as: "v",
                          in: {
                            wasteType: { $ifNull: ["$$v.wasteType", "$trucks.wasteType"] },
                            // Normalize each entry to m³ using its own declared unit
                            // (per-vehicle → per-truck fallback) so tons and m³ are
                            // never summed as the same number. Same factor + rule the
                            // summary tiles use, keeping /stats consistent with them.
                            volume: toM3Expr(
                              { $ifNull: ["$$v.actualVolume", 0] },
                              { $ifNull: ["$$v.actualVolumeUnit", "$trucks.actualVolumeUnit"] },
                            ),
                          },
                        },
                      },
                      [
                        {
                          wasteType: "$trucks.wasteType",
                          volume: toM3Expr(
                            { $ifNull: ["$trucks.actualVolume", 0] },
                            "$trucks.actualVolumeUnit",
                          ),
                        },
                      ],
                    ],
                  },
                },
              },
            },
          },
          { $unwind: "$entries" },
          {
            $group: {
              _id: "$entries.wasteType",
              totalVolume: { $sum: "$entries.volume" },
              count: { $sum: 1 },
            },
          },
        ]),
        DataSLF.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                year: { $year: "$createdAt" },
                month: { $month: "$createdAt" },
              },
              count: { $sum: 1 },
              // Use the converted, denormalized m³ metric (same field the summary
              // tiles use) instead of summing raw actualVolume — otherwise tons and
              // m³ were added together and the dashboard trend disagreed with the
              // summary totals.
              totalVolume: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          { $limit: 12 },
        ]),
        DataSLF.find(match)
          .sort({ createdAt: -1 })
          .limit(5)
          .select("idNo lguCompanyName companyType status createdAt truckCount")
          .lean(),
      ]);

    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));

    const companyMap = {};
    byCompanyType.forEach((c) => (companyMap[c._id] = c.count));

    const statsPayload = {
      submissions,
      generators,
      totalTrucks: totalTrucks[0]?.total || 0,
      byStatus: statusMap,
      byCompanyType: companyMap,
      wasteByType,
      monthlyData,
      recentSubmissions,
    };
    res.json(statsPayload);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Aggregated stats per SLF generator (for Waste Generators tab tiles)
router.get("/generator-summary", async (req, res) => {
  try {
    const summary = await DataSLF.aggregate([
      // Exclude dummy/test entries from the Waste Generators tab tiles.
      { $match: { slfGenerator: { $ne: null }, deletedAt: null, ...NON_DUMMY_CLAUSE } },
      {
        $group: {
          _id: "$slfGenerator",
          totalEntries: { $sum: 1 },
          pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          acknowledgedCount: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } },
          rejectedCount: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          totalTrucks: { $sum: { $size: { $ifNull: ["$trucks", []] } } },
          totalVolume: {
            $sum: {
              $reduce: {
                input: { $ifNull: ["$trucks", []] },
                initialValue: 0,
                in: { $add: ["$$value", { $ifNull: ["$$this.actualVolume", 0] }] },
              },
            },
          },
          lguCount: { $sum: { $cond: [{ $eq: ["$companyType", "LGU"] }, 1, 0] } },
          privateCount: { $sum: { $cond: [{ $eq: ["$companyType", "Private"] }, 1, 0] } },
          lastSubmission: { $max: "$createdAt" },
        },
      },
    ]);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Compact summary tiles for the SLF Submission Summary page. Single aggregation
// with $facet so the frontend never loads the full dataset just to total tiles.
// Falls back to computing volumes from trucks when denormalized fields are absent.
router.get("/summary-tiles", async (req, res) => {
  try {
    const ifNullReduce = (denormField, predicate) => ({
      $ifNull: [
        denormField,
        {
          $reduce: {
            input: { $ifNull: ["$trucks", []] },
            initialValue: 0,
            in: { $add: ["$$value", predicate] },
          },
        },
      ],
    });
    const result = await DataSLF.aggregate([
      { $match: { deletedAt: null, isDummy: { $ne: true } } },
      {
        $project: {
          status: 1,
          companyType: 1,
          truckCount: ifNullReduce("$truckCount", { $cond: [true, 1, 0] }),
          totalM3: { $ifNull: ["$totalVolumeM3", 0] },
          totalTons: { $ifNull: ["$totalVolumeTons", 0] },
          residualM3: { $ifNull: ["$residualVolumeM3", 0] },
          residualTons: { $ifNull: ["$residualVolumeTons", 0] },
          hazardousM3: { $ifNull: ["$hazardousVolumeM3", 0] },
          hazardousTons: { $ifNull: ["$hazardousVolumeTons", 0] },
        },
      },
      {
        $group: {
          _id: null,
          submissions: { $sum: 1 },
          trucks: { $sum: "$truckCount" },
          totalM3: { $sum: "$totalM3" },
          totalTons: { $sum: "$totalTons" },
          residualM3: { $sum: "$residualM3" },
          residualTons: { $sum: "$residualTons" },
          hazardousM3: { $sum: "$hazardousM3" },
          hazardousTons: { $sum: "$hazardousTons" },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          acknowledged: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          reverted: { $sum: { $cond: [{ $eq: ["$status", "reverted"] }, 1, 0] } },
          revert_requested: { $sum: { $cond: [{ $eq: ["$status", "revert_requested"] }, 1, 0] } },
          LGU: { $sum: { $cond: [{ $eq: ["$companyType", "LGU"] }, 1, 0] } },
          Private: { $sum: { $cond: [{ $eq: ["$companyType", "Private"] }, 1, 0] } },
        },
      },
    ]);
    const r = result[0] || {};
    res.json({
      submissions: r.submissions || 0,
      trucks: r.trucks || 0,
      totalM3: r.totalM3 || 0,
      totalTons: r.totalTons || 0,
      residualM3: r.residualM3 || 0,
      residualTons: r.residualTons || 0,
      hazardousM3: r.hazardousM3 || 0,
      hazardousTons: r.hazardousTons || 0,
      statuses: {
        pending: r.pending || 0,
        acknowledged: r.acknowledged || 0,
        rejected: r.rejected || 0,
        reverted: r.reverted || 0,
        revert_requested: r.revert_requested || 0,
      },
      companyTypes: { LGU: r.LGU || 0, Private: r.Private || 0 },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Grouped per-SLF summary rows for the Submission Summary table. Replaces the
// previous "load all records + group in React" approach. Compact rows only.
// Same freshness contract as /stats: bounded TTL as a safety net, with
// refreshAdmin() busting the key on every submission/baseline/facility write.
router.get("/summary-by-slf", cacheJson(() => SUMMARY_BY_SLF_CACHE_KEY, 60000), async (req, res) => {
  try {
    const rows = await DataSLF.aggregate([
      { $match: { deletedAt: null, isDummy: { $ne: true } } },
      {
        $project: {
          slfGenerator: 1,
          slfName: 1,
          lguCompanyName: 1,
          submittedBy: 1,
          status: 1,
          dateOfDisposal: 1,
          baselineUnit: 1,
          truckCount: { $ifNull: ["$truckCount", { $size: { $ifNull: ["$trucks", []] } }] },
          totalM3: { $ifNull: ["$totalVolumeM3", 0] },
          totalTons: { $ifNull: ["$totalVolumeTons", 0] },
          residualM3: { $ifNull: ["$residualVolumeM3", 0] },
          residualTons: { $ifNull: ["$residualVolumeTons", 0] },
          hazardousM3: { $ifNull: ["$hazardousVolumeM3", 0] },
          hazardousTons: { $ifNull: ["$hazardousVolumeTons", 0] },
        },
      },
      {
        // Group on the STABLE facility id, not the denormalized `slfName` string.
        // A facility that was renamed (or whose submissions carry an older name
        // snapshot) produced one row per name variant, so the same SLF appeared
        // twice in the breakdown and its submissions/volumes were double-counted
        // across the summary tiles, filters and exports. The name only acts as a
        // grouping key for legacy records that have no facility id at all.
        $addFields: {
          _groupKey: {
            $cond: [
              { $ifNull: ["$slfGenerator", false] },
              { $concat: ["id:", { $toString: "$slfGenerator" }] },
              { $concat: ["name:", { $ifNull: ["$slfName", "Unassigned SLF"] }] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$_groupKey",
          // Only a fallback: the display name is resolved from the facility record
          // below. For name-keyed groups every doc shares this value anyway, so no
          // ordering stage (and no blocking in-memory sort) is needed here.
          slfName: { $first: { $ifNull: ["$slfName", "Unassigned SLF"] } },
          slfGenerator: { $first: "$slfGenerator" },
          baselineUnit: { $first: "$baselineUnit" },
          submissions: { $sum: 1 },
          trucks: { $sum: "$truckCount" },
          generators: { $addToSet: "$lguCompanyName" },
          submitters: { $addToSet: "$submittedBy" },
          totalM3: { $sum: "$totalM3" },
          totalTons: { $sum: "$totalTons" },
          residualM3: { $sum: "$residualM3" },
          residualTons: { $sum: "$residualTons" },
          hazardousM3: { $sum: "$hazardousM3" },
          hazardousTons: { $sum: "$hazardousTons" },
          pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
          acknowledged: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
          reverted: { $sum: { $cond: [{ $eq: ["$status", "reverted"] }, 1, 0] } },
          revert_requested: { $sum: { $cond: [{ $eq: ["$status", "revert_requested"] }, 1, 0] } },
          lastDisposalDate: { $max: "$dateOfDisposal" },
        },
      },
    ]);

    // Resolve each grouped row's display name from the CANONICAL facility record
    // (by id) so the breakdown shows one current name per SLF, even when older
    // submissions still carry a previous name snapshot.
    const facilityIds = [
      ...new Set(rows.map((row) => row.slfGenerator).filter(Boolean).map(String)),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const facilityDocs = facilityIds.length
      ? await SlfFacility.find({ _id: { $in: facilityIds } })
          .select("_id lgu ownership")
          .lean()
      : [];
    const facilityNameById = new Map(
      facilityDocs.map((facility) => [
        String(facility._id),
        `${facility.lgu || ""}${facility.ownership ? ` (${facility.ownership})` : ""}`.trim(),
      ]),
    );

    const payload = rows
      .map((row) => {
        const genId = row.slfGenerator ? String(row.slfGenerator) : "";
        // Key stays a stable string (the facility id when known) so the client's
        // rowKey/search/filters keep working; the response shape is unchanged.
        const canonicalName =
          (genId && facilityNameById.get(genId)) || row.slfName || "Unassigned SLF";
        return {
        key: row._id,
        slfName: canonicalName,
        slfGenerator: row.slfGenerator || null,
        baselineUnit: row.baselineUnit || "m³",
        submissions: row.submissions,
        trucks: row.trucks,
        generatorCount: (row.generators || []).filter(Boolean).length,
        submitterCount: (row.submitters || []).filter(Boolean).length,
        statuses: {
          pending: row.pending,
          acknowledged: row.acknowledged,
          rejected: row.rejected,
          reverted: row.reverted,
          revert_requested: row.revert_requested,
        },
        totalM3: row.totalM3,
        totalTons: row.totalTons,
        residualM3: row.residualM3,
        residualTons: row.residualTons,
        hazardousM3: row.hazardousM3,
        hazardousTons: row.hazardousTons,
        lastDisposalDate: row.lastDisposalDate,
        };
      })
      .sort((a, b) => String(a.slfName).localeCompare(String(b.slfName)));

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Per-cell waste volumes for the SLF Data Table, pre-collapsed in the database.
//
// The admin SLF Monitoring page used to load EVERY submission (mode=list&
// cellUsage=true, unpaginated) purely so buildFacilityCellUsage could sum truck
// volumes per cell — ~3.2MB and ~39s on the wire, of which the cell math needs
// almost nothing. buildFacilityCellUsage adds each truck's volume to a cell chosen
// from (wasteType, cellIndex/cellName) and the unit, so trucks sharing all four
// values are interchangeable: summing them here is arithmetically identical to
// summing them in the browser. Measured on live data, 18,991 trucks collapse to
// 788 distinct tuples — the same numbers in ~1/13th the bytes.
//
// The collapse is an ORDER-PRESERVING $reduce, not a $group, because
// getPortalVolumeUnit picks the unit of the FIRST positive-volume truck; a
// reordered array could silently change a facility's display unit.
//
// This deliberately drops trucks[].vehicles — the cell rollup never reads it. The
// cell-ASSIGNMENT editor does, and it keeps its own per-facility fetch (which needs
// real truck/vehicle indices to write placements back).
const cellUsageCacheKey = (req) => `${CELL_USAGE_CACHE_PREFIX}:${devWantsDummy(req) ? "dummy" : "default"}`;
router.get("/cell-usage", cacheJson(cellUsageCacheKey, 60000), async (req, res) => {
  try {
    const includeDummy = devWantsDummy(req);
    const match = includeDummy ? { deletedAt: null } : { deletedAt: null, ...NON_DUMMY_CLAUSE };
    // Identity of a cell bucket: everything findBestCellIndex + addVolumeToCell read.
    const bucketKey = {
      $concat: [
        { $ifNull: [{ $toString: "$$t.cellIndex" }, ""] }, "|",
        { $ifNull: ["$$t.cellName", ""] }, "|",
        { $ifNull: ["$$t.wasteType", ""] }, "|",
        { $ifNull: ["$$t.actualVolumeUnit", ""] },
      ],
    };

    const rows = await DataSLF.aggregate([
      { $match: match },
      {
        $project: {
          slfName: 1, slfGenerator: 1, status: 1, dateOfDisposal: 1, createdAt: 1,
          _trucks: {
            $filter: {
              input: {
                $map: {
                  input: { $ifNull: ["$trucks", []] },
                  as: "t",
                  in: {
                    _k: bucketKey,
                    cellIndex: "$$t.cellIndex",
                    cellName: "$$t.cellName",
                    wasteType: "$$t.wasteType",
                    actualVolume: { $ifNull: ["$$t.actualVolume", 0] },
                    actualVolumeUnit: "$$t.actualVolumeUnit",
                  },
                },
              },
              as: "x",
              // A zero/negative truck is discarded by addVolumeToCell anyway, and
              // hasTruckVolume() treats a submission with none as non-contributing.
              cond: { $gt: ["$$x.actualVolume", 0] },
            },
          },
        },
      },
      { $match: { "_trucks.0": { $exists: true } } },
      {
        $project: {
          slfName: 1, slfGenerator: 1, status: 1, dateOfDisposal: 1, createdAt: 1,
          trucks: {
            $reduce: {
              input: "$_trucks",
              initialValue: [],
              // Append an unseen bucket, or add into the existing one IN PLACE. The
              // in-place branch is a $map rather than $slice surgery because $cond
              // evaluates both branches, and a $slice count of 0 (first element, or
              // an empty accumulator) is a hard error rather than an empty result.
              // `cur` aliases the reduce's $$this so the inner $map can rebind it.
              in: {
                $let: {
                  vars: { cur: "$$this" },
                  in: {
                    $cond: [
                      { $eq: [{ $indexOfArray: ["$$value._k", "$$cur._k"] }, -1] },
                      { $concatArrays: ["$$value", ["$$cur"]] },
                      {
                        $map: {
                          input: "$$value",
                          as: "v",
                          in: {
                            $cond: [
                              { $eq: ["$$v._k", "$$cur._k"] },
                              {
                                $mergeObjects: [
                                  "$$v",
                                  { actualVolume: { $add: ["$$v.actualVolume", "$$cur.actualVolume"] } },
                                ],
                              },
                              "$$v",
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      // getSubmissionSlfNames() reads slfGenerator.slfName, so the facility name has
      // to travel with the row exactly as .populate() used to supply it.
      {
        $lookup: {
          from: "slf_facilities",
          localField: "slfGenerator",
          foreignField: "_id",
          as: "_gen",
          pipeline: [{ $project: { slfName: 1 } }],
        },
      },
      {
        $project: {
          slfName: 1, status: 1, dateOfDisposal: 1, createdAt: 1,
          trucks: { $map: { input: "$trucks", as: "t", in: {
            cellIndex: "$$t.cellIndex", cellName: "$$t.cellName", wasteType: "$$t.wasteType",
            actualVolume: "$$t.actualVolume", actualVolumeUnit: "$$t.actualVolumeUnit",
          } } },
          slfGenerator: {
            $cond: [
              { $gt: [{ $size: "$_gen" }, 0] },
              { $arrayElemAt: ["$_gen", 0] },
              "$slfGenerator",
            ],
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ]).allowDiskUse(true);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Combined dashboard payload for the Submission Summary page. This keeps the
// legacy /summary-tiles and /summary-by-slf endpoints intact, but lets the main
// dashboard fetch both from one aggregate scan instead of two duplicate requests.
// Rollup tile beside the submissions table: no query parameters, no user context,
// ~1.4s per call. One computation serves every admin; invalidated by the same
// submission/baseline/facility writes that change the table.
router.get("/summary-dashboard", cacheJson(() => ADMIN_SUMMARY_DASHBOARD_KEY, 60000), async (req, res) => {
  try {
    const [facet = {}] = await DataSLF.aggregate([
      { $match: { deletedAt: null, isDummy: { $ne: true } } },
      {
        $facet: {
          tiles: [
            {
              $project: {
                status: 1,
                companyType: 1,
                truckCount: { $ifNull: ["$truckCount", { $size: { $ifNull: ["$trucks", []] } }] },
                totalM3: { $ifNull: ["$totalVolumeM3", 0] },
                totalTons: { $ifNull: ["$totalVolumeTons", 0] },
                residualM3: { $ifNull: ["$residualVolumeM3", 0] },
                residualTons: { $ifNull: ["$residualVolumeTons", 0] },
                hazardousM3: { $ifNull: ["$hazardousVolumeM3", 0] },
                hazardousTons: { $ifNull: ["$hazardousVolumeTons", 0] },
              },
            },
            {
              $group: {
                _id: null,
                submissions: { $sum: 1 },
                trucks: { $sum: "$truckCount" },
                totalM3: { $sum: "$totalM3" },
                totalTons: { $sum: "$totalTons" },
                residualM3: { $sum: "$residualM3" },
                residualTons: { $sum: "$residualTons" },
                hazardousM3: { $sum: "$hazardousM3" },
                hazardousTons: { $sum: "$hazardousTons" },
                pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                acknowledged: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } },
                rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
                reverted: { $sum: { $cond: [{ $eq: ["$status", "reverted"] }, 1, 0] } },
                revert_requested: { $sum: { $cond: [{ $eq: ["$status", "revert_requested"] }, 1, 0] } },
                LGU: { $sum: { $cond: [{ $eq: ["$companyType", "LGU"] }, 1, 0] } },
                Private: { $sum: { $cond: [{ $eq: ["$companyType", "Private"] }, 1, 0] } },
              },
            },
          ],
          rows: [
            {
              $project: {
                slfGenerator: 1,
                slfName: 1,
                lguCompanyName: 1,
                submittedBy: 1,
                status: 1,
                dateOfDisposal: 1,
                baselineUnit: 1,
                truckCount: { $ifNull: ["$truckCount", { $size: { $ifNull: ["$trucks", []] } }] },
                totalM3: { $ifNull: ["$totalVolumeM3", 0] },
                totalTons: { $ifNull: ["$totalVolumeTons", 0] },
                residualM3: { $ifNull: ["$residualVolumeM3", 0] },
                residualTons: { $ifNull: ["$residualVolumeTons", 0] },
                hazardousM3: { $ifNull: ["$hazardousVolumeM3", 0] },
                hazardousTons: { $ifNull: ["$hazardousVolumeTons", 0] },
              },
            },
            {
              $addFields: {
                _groupKey: {
                  $cond: [
                    { $ifNull: ["$slfGenerator", false] },
                    { $concat: ["id:", { $toString: "$slfGenerator" }] },
                    { $concat: ["name:", { $ifNull: ["$slfName", "Unassigned SLF"] }] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: "$_groupKey",
                slfName: { $first: { $ifNull: ["$slfName", "Unassigned SLF"] } },
                slfGenerator: { $first: "$slfGenerator" },
                baselineUnit: { $first: "$baselineUnit" },
                submissions: { $sum: 1 },
                trucks: { $sum: "$truckCount" },
                generators: { $addToSet: "$lguCompanyName" },
                submitters: { $addToSet: "$submittedBy" },
                totalM3: { $sum: "$totalM3" },
                totalTons: { $sum: "$totalTons" },
                residualM3: { $sum: "$residualM3" },
                residualTons: { $sum: "$residualTons" },
                hazardousM3: { $sum: "$hazardousM3" },
                hazardousTons: { $sum: "$hazardousTons" },
                pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                acknowledged: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } },
                rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
                reverted: { $sum: { $cond: [{ $eq: ["$status", "reverted"] }, 1, 0] } },
                revert_requested: { $sum: { $cond: [{ $eq: ["$status", "revert_requested"] }, 1, 0] } },
                lastDisposalDate: { $max: "$dateOfDisposal" },
              },
            },
          ],
        },
      },
    ]).allowDiskUse(true);

    const tileRow = facet.tiles?.[0] || {};
    const rawRows = facet.rows || [];
    const facilityIds = [
      ...new Set(rawRows.map((row) => row.slfGenerator).filter(Boolean).map(String)),
    ].filter((id) => mongoose.Types.ObjectId.isValid(id));
    const facilityDocs = facilityIds.length
      ? await SlfFacility.find({ _id: { $in: facilityIds } }).select("_id lgu ownership").lean()
      : [];
    const facilityNameById = new Map(
      facilityDocs.map((facility) => [
        String(facility._id),
        `${facility.lgu || ""}${facility.ownership ? ` (${facility.ownership})` : ""}`.trim(),
      ]),
    );

    const rows = rawRows
      .map((row) => {
        const genId = row.slfGenerator ? String(row.slfGenerator) : "";
        const canonicalName = (genId && facilityNameById.get(genId)) || row.slfName || "Unassigned SLF";
        return {
          key: row._id,
          slfName: canonicalName,
          slfGenerator: row.slfGenerator || null,
          baselineUnit: row.baselineUnit || "m³",
          submissions: row.submissions,
          trucks: row.trucks,
          generatorCount: (row.generators || []).filter(Boolean).length,
          submitterCount: (row.submitters || []).filter(Boolean).length,
          statuses: {
            pending: row.pending,
            acknowledged: row.acknowledged,
            rejected: row.rejected,
            reverted: row.reverted,
            revert_requested: row.revert_requested,
          },
          totalM3: row.totalM3,
          totalTons: row.totalTons,
          residualM3: row.residualM3,
          residualTons: row.residualTons,
          hazardousM3: row.hazardousM3,
          hazardousTons: row.hazardousTons,
          lastDisposalDate: row.lastDisposalDate,
        };
      })
      .sort((a, b) => String(a.slfName).localeCompare(String(b.slfName)));

    res.json({
      tiles: {
        submissions: tileRow.submissions || 0,
        trucks: tileRow.trucks || 0,
        totalM3: tileRow.totalM3 || 0,
        totalTons: tileRow.totalTons || 0,
        residualM3: tileRow.residualM3 || 0,
        residualTons: tileRow.residualTons || 0,
        hazardousM3: tileRow.hazardousM3 || 0,
        hazardousTons: tileRow.hazardousTons || 0,
        statuses: {
          pending: tileRow.pending || 0,
          acknowledged: tileRow.acknowledged || 0,
          rejected: tileRow.rejected || 0,
          reverted: tileRow.reverted || 0,
          revert_requested: tileRow.revert_requested || 0,
        },
        companyTypes: { LGU: tileRow.LGU || 0, Private: tileRow.Private || 0 },
      },
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Compact analytics payload for the Admin Main Dashboard. The previous frontend
// implementation fetched every submission plus every portal user, then grouped in
// React for three small widgets. This endpoint returns only chart-ready aggregate
// rows so the dashboard avoids large payloads and client-side full-table scans.
// Same shape and same reasoning as /summary-dashboard above (~1.4s, global).
router.get("/analytics-summary", cacheJson(() => ADMIN_ANALYTICS_KEY, 60000), async (req, res) => {
  try {
    const match = {
      deletedAt: null,
      isDummy: { $ne: true },
      status: { $nin: ["rejected", "reverted", "revert_requested"] },
    };

    const [result = {}] = await DataSLF.aggregate([
      { $match: match },
      {
        $facet: {
          daily: [
            { $match: { dateOfDisposal: { $ne: null } } },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$dateOfDisposal", timezone: "Asia/Manila" } },
                volumeM3: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
                submissions: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, key: "$_id", label: "$_id", volumeM3: 1, submissions: 1 } },
          ],
          weekly: [
            { $match: { dateOfDisposal: { $ne: null } } },
            {
              $group: {
                _id: { y: { $isoWeekYear: "$dateOfDisposal" }, w: { $isoWeek: "$dateOfDisposal" } },
                volumeM3: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
                submissions: { $sum: 1 },
              },
            },
            { $sort: { "_id.y": 1, "_id.w": 1 } },
            {
              $project: {
                _id: 0,
                key: { $concat: [{ $toString: "$_id.y" }, "-W", { $toString: "$_id.w" }] },
                label: { $concat: ["W", { $toString: "$_id.w" }, " '", { $substr: [{ $toString: "$_id.y" }, 2, 2] }] },
                volumeM3: 1,
                submissions: 1,
              },
            },
          ],
          monthly: [
            { $match: { dateOfDisposal: { $ne: null } } },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m", date: "$dateOfDisposal", timezone: "Asia/Manila" } },
                volumeM3: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
                submissions: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, key: "$_id", label: "$_id", volumeM3: 1, submissions: 1 } },
          ],
          activeUsers: [
            { $match: { submittedBy: { $nin: [null, ""] } } },
            {
              $group: {
                _id: { $toLower: { $trim: { input: "$submittedBy" } } },
                submissions: { $sum: 1 },
                volumeM3: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
                slfCounts: { $push: "$slfName" },
              },
            },
            { $sort: { submissions: -1, volumeM3: -1 } },
            { $limit: 50 },
            {
              $lookup: {
                from: "user_portal",
                localField: "_id",
                foreignField: "email",
                as: "user",
                pipeline: [{ $project: { firstName: 1, lastName: 1, username: 1, companyName: 1, assignedSlfName: 1 } }],
              },
            },
            { $addFields: { user: { $arrayElemAt: ["$user", 0] } } },
            {
              $project: {
                _id: 0,
                companyName: { $ifNull: ["$user.companyName", ""] },
                organizationName: { $arrayElemAt: [{ $ifNull: ["$user.assignedSlfName", []] }, 0] },
                userName: {
                  $trim: { input: { $concat: [{ $ifNull: ["$user.firstName", ""] }, " ", { $ifNull: ["$user.lastName", ""] }] } },
                },
                fallbackName: { $ifNull: ["$user.username", "Portal User"] },
                submissions: 1,
                volumeM3: 1,
                slf: { $arrayElemAt: [{ $ifNull: ["$user.assignedSlfName", []] }, 0] },
              },
            },
          ],
          volumeBySlf: [
            {
              $group: {
                _id: { $ifNull: ["$slfName", "Unassigned SLF"] },
                volumeM3: { $sum: { $ifNull: ["$totalVolumeM3", 0] } },
                submissions: { $sum: 1 },
              },
            },
            { $match: { volumeM3: { $gt: 0 } } },
            { $sort: { volumeM3: -1, submissions: -1 } },
            { $project: { _id: 0, name: "$_id", volumeM3: 1, submissions: 1 } },
          ],
        },
      },
    ]).allowDiskUse(true);

    const labelMonth = (row) => {
      if (!/^\d{4}-\d{2}$/.test(row.key || "")) return row;
      const [year, month] = row.key.split("-").map(Number);
      const label = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
      return { ...row, label };
    };
    const labelDay = (row) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.key || "")) return row;
      return { ...row, label: new Date(row.key).toLocaleString("en-US", { month: "short", day: "numeric" }) };
    };

    res.json({
      trends: {
        daily: (result.daily || []).map(labelDay),
        weekly: result.weekly || [],
        monthly: (result.monthly || []).map(labelMonth),
      },
      activeUsers: (result.activeUsers || []).map((user) => ({
        name:
          String(user.companyName || "").trim() ||
          String(user.organizationName || "").trim() ||
          String(user.userName || "").trim() ||
          user.fallbackName ||
          "Portal User",
        submissions: user.submissions || 0,
        volumeM3: user.volumeM3 || 0,
        slf: user.slf || "",
      })),
      volumeBySlf: result.volumeBySlf || [],
      generatedAt: new Date(),
      unit: "m³",
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Compact data contract for the Admin SLF Operators Disposal Submission Calendar.
// Returns only fields used by the calendar/date modal and filter labels. Avoids
// shipping full trucks[] or full portal-user profiles on initial dashboard load.
router.get("/disposal-calendar", async (req, res) => {
  try {
    const match = {
      deletedAt: null,
      isDummy: { $ne: true },
      dateOfDisposal: { $ne: null },
      status: { $nin: ["reverted", "revert_requested"] },
      // A BASELINE UPDATE IS NOT A SUBMISSION.
      //
      // PATCH /portal-save-baseline stamps its baseline-only container with
      // `dateOfDisposal: new Date()` (the save time) because the field is
      // required by the schema — so every baseline save used to land on this
      // calendar as a disposal on the day it was saved, and was then counted by
      // the day/month status tracker. It carries no transport entries, which is
      // exactly what identifies a container rather than a submission.
      //
      // The admin submissions list, the dashboard stats and the SLF map marker
      // (`mode=latest`) already filter on this; the calendar was the one reader
      // that did not. See SUBMISSION_HAS_TRUCKS.
      ...SUBMISSION_HAS_TRUCKS,
    };

    const records = await DataSLF.find(match)
      .setOptions({ includeHiddenYears: true })
      .sort({ dateOfDisposal: -1, createdAt: -1 })
      // `slfGenerator` is what the day modal groups facilities on — without it
      // every group fell back to the NAME key, splitting one SLF in two whenever
      // some of its records still held an older name snapshot.
      .select("_id idNo submissionId previousIdNos dateOfDisposal submittedBy slfGenerator slfName lguCompanyName status baselineUnit totalVolumeM3 totalVolumeTons truckCount companyType createdAt")
      .lean();

    const emails = [...new Set(records.map((r) => String(r.submittedBy || "").trim().toLowerCase()).filter(Boolean))];
    const users = emails.length
      ? await UserPortal.find({ email: { $in: emails } })
          .select("email firstName lastName username companyName")
          .lean()
      : [];

    const userByEmail = Object.fromEntries(users.map((user) => {
      const email = String(user.email || "").trim().toLowerCase();
      return [email, {
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.username || user.companyName || user.email,
        email: user.email,
        company: user.companyName || "",
      }];
    }));

    res.json({ records, userByEmail, generatedAt: new Date() });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * The Disposal Activity modal's rows, for ONE day.
 *
 * ── Why the modal was showing a stripped-down row ───────────────────────────
 * GET /disposal-calendar deliberately ships no `trucks[]`: it answers "which
 * days had activity" for the whole dashboard and would otherwise carry every
 * transport entry of every submission ever made. But the day modal renders
 * PER-TRIP columns — Hauler, Client, Plate No., Cell, Waste Type, per-trip
 * Volume — and those live only on trucks[]/vehicles[]. With no trucks the
 * client's row builder fell back to one summary row per submission and rendered
 * "—" in all five columns. The data was in MongoDB the whole time; it simply
 * never left the server.
 *
 * So the trips are fetched when the modal opens, for that day only. Bounded by
 * the date, projected to exactly the fields the table renders, and cell names
 * are resolved to the facility's CURRENT labels before responding (the copy
 * stored on a truck can be a stale snapshot — see utils/cellNaming.js).
 *
 * Baseline containers are excluded by the same rule as the calendar itself: a
 * baseline save carries a save-time `dateOfDisposal` and no transport entries,
 * and it is not a disposal.
 */
const DISPOSAL_ACTIVITY_TRUCK_FIELDS = [
  "trucks.disposalTicketNo",
  "trucks.hauler",
  "trucks.haulerName",
  "trucks.plateNumber",
  "trucks.wasteType",
  "trucks.actualVolume",
  "trucks.actualVolumeUnit",
  "trucks.cellIndex",
  "trucks.cellName",
  "trucks.cellType",
  "trucks.selectedClients",
  "trucks.vehicles.plateNumber",
  "trucks.vehicles.wasteType",
  "trucks.vehicles.actualVolume",
  "trucks.vehicles.actualVolumeUnit",
  "trucks.vehicles.cellIndex",
  "trucks.vehicles.cellName",
  "trucks.vehicles.cellType",
  "trucks.vehicles.selectedClients",
].join(" ");

router.get("/disposal-calendar/day", async (req, res) => {
  try {
    const day = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return res.status(400).json({ message: "A date (YYYY-MM-DD) is required." });
    }
    // Matched on the same local-day boundaries the calendar groups by, so a row
    // can never land on a different day in the modal than in the grid.
    const start = new Date(`${day}T00:00:00.000`);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 1);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ message: "A valid date is required." });
    }

    const records = await DataSLF.find({
      deletedAt: null,
      isDummy: { $ne: true },
      dateOfDisposal: { $gte: start, $lt: end },
      status: { $nin: ["reverted", "revert_requested"] },
      ...SUBMISSION_HAS_TRUCKS,
    })
      .setOptions({ includeHiddenYears: true })
      .sort({ dateOfDisposal: -1, createdAt: -1 })
      .select(
        "_id idNo submissionId previousIdNos dateOfDisposal submittedBy slfGenerator slfName " +
          `lguCompanyName status baselineUnit totalVolumeM3 totalVolumeTons truckCount companyType createdAt ${DISPOSAL_ACTIVITY_TRUCK_FIELDS}`,
      )
      .populate("slfGenerator", "_id lgu slfName cellNames")
      .lean();

    res.json({
      date: day,
      records: applyResolvedCellNamesToAll(records),
      generatedAt: new Date(),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all SLF data entries (admin) — excludes soft-deleted
/**
 * Cache key for the Admin → Portal Submissions list.
 *
 * Returns null — meaning "do not cache this request" — for everything that is not
 * the light list view:
 *   • `all=true`  the export, which returns the ENTIRE filtered result set
 *   • `includeTrucks=true` the row-expand refetch, which ships trucks[]
 * Caching either would put an unbounded payload in Redis to serve one click.
 *
 * The RESOLVED dummy scope is in the key, never the raw `includeDummy` parameter:
 * `devWantsDummy()` only grants test-record visibility to a developer/demo caller,
 * so keying on the raw parameter would let an ordinary admin who appends
 * `?includeDummy=true` share an entry with a developer — and be served records
 * they may not see. Keying on the resolved booleans makes that impossible.
 *
 * `search` is free text, so it is hashed rather than concatenated: a long query
 * would otherwise become a long Redis key, and the hash keeps keys fixed-width
 * while staying deterministic.
 */
const adminSubmissionsCacheKey = (req) => {
  const q = req.query || {};
  if (q.mode !== "list") return null;
  if (String(q.all) === "true") return null;
  if (String(q.includeTrucks) === "true") return null;

  // An UNAUTHORIZED dummy request must reach the handler, which answers 403 and
  // writes an audit entry (rejectUnauthorizedDummyAccess). Resolving it to the
  // "default" scope instead would collide with the ordinary page-1 entry and
  // serve a 200 — turning the cache into a bypass for an access-control check.
  // Skip caching entirely for those requests rather than normalising them.
  const askedForDummy =
    String(q.includeDummy || "").toLowerCase() === "true" ||
    String(q.dummyOnly || "").toLowerCase() === "true";
  if (askedForDummy && !canManageTestData(req)) return null;

  const search = String(q.search || "").trim().toLowerCase();
  const searchPart = search
    ? `s${require("crypto").createHash("sha1").update(search).digest("hex").slice(0, 10)}`
    : "-";
  const scope = devWantsDummyOnly(req) ? "dummyOnly" : devWantsDummy(req) ? "dummy" : "default";

  const parts = [
    scope,
    String(q.grouped) === "true" ? "grouped" : "flat",
    `p${Number(q.page) || 1}`,
    `l${Number(q.limit) || 10}`,
    q.status || "-",
    q.cellPlacement || "-",
    q.assignment || "-",
    q.excludeStatuses || "-",
    q.slfGenerator || "-",
    q.withTruckVolume || "-",
    q.cellUsage || "-",
    searchPart,
  ];
  return `${ADMIN_SUBMISSIONS_PREFIX}:${parts.join(":")}`;
};

router.get("/", optionalAuth, cacheJson(adminSubmissionsCacheKey, 60000), async (req, res) => {
  try {
    // Admin management view — respects App Settings year visibility filter
    const listMode = req.query.mode === "list";
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 100);
    const paginated = listMode && limit > 0;
    if (rejectUnauthorizedDummyAccess(req, res)) return;
    const filter = { deletedAt: null, ...SUBMISSION_HAS_TRUCKS };
    // Three mutually exclusive views, all developer-gated except the default:
    //   dummyOnly=true    → the Dummy Submissions tab: test/demo records ONLY
    //   includeDummy=true → legacy inline mode: both, dummies flagged SAMPLE
    //   (default)         → Actual Submissions: production records only
    if (devWantsDummyOnly(req)) {
      filter.isDummy = true;
    } else if (!devWantsDummy(req)) {
      filter.isDummy = { $ne: true };
    }
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();
    const includeTrucks = String(req.query.includeTrucks || "").toLowerCase() === "true";
    const withTruckVolume = String(req.query.withTruckVolume || "").toLowerCase() === "true";

    if (listMode && status && status !== "all") {
      filter.status = status;
    }
    // Opt-in status exclusion (e.g. the SLF Disposal Calendar excludes reverted
    // records so a pulled-back submission never appears as active disposal
    // activity). Applied at the QUERY layer so every consumer of this endpoint —
    // not just one client — gets consistent filtering, and reverted records drop
    // out immediately on the next fetch/refresh. Records remain fully available
    // in the unfiltered admin views. Accepts a comma-separated list; the stored
    // status enum is authoritative, so unknown values are simply ignored by Mongo.
    const excludeStatusesRaw = String(req.query.excludeStatuses || "").trim();
    if (listMode && excludeStatusesRaw) {
      const excluded = excludeStatusesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (excluded.length) {
        // If a specific status was already requested it wins; otherwise exclude
        // the listed statuses.
        if (!filter.status) filter.status = { $nin: excluded };
      }
    }
    if (listMode && withTruckVolume) {
      filter["trucks.actualVolume"] = { $gt: 0 };
    }
    // Precise server-side scoping to a single SLF facility (used by the Summary
    // disposal calendar) — avoids shipping every SLF's records to the client.
    if (listMode && req.query.slfGenerator) {
      const genId = String(req.query.slfGenerator).trim();
      if (mongoose.isValidObjectId(genId)) filter.slfGenerator = genId;
    }
    if (listMode && search) {
      const rx = new RegExp(escapeRegExp(search), "i");
      // Use $and (not a top-level $or) so the year-visibility plugin — which adds
      // its OWN top-level $or via .where() — cannot clobber the search clause.
      (filter.$and = filter.$and || []).push({
        $or: [
          { idNo: rx },
          { submissionId: rx },
          { lguCompanyName: rx },
          { companyType: rx },
          { slfName: rx },
          { submittedBy: rx },
        ],
      });
    }

    // Cell-assignment-filtered, server-paginated list for the Cell Waste
    // Placement tab. Splits submissions into those still awaiting a cell
    // ("unassigned": at least one truck without a cell) and those fully placed
    // ("assigned"). Placement is detected from the actual truck/vehicle
    // cellIndex/cellName — the same fields savePlacement persists.
    if (
      paginated &&
      ["assigned", "unassigned"].includes(String(req.query.assignment || "").toLowerCase())
    ) {
      const assignment = String(req.query.assignment).toLowerCase();
      const skip = (page - 1) * limit;
      const pipeline = [
        { $match: filter },
        { $addFields: { _trucksArr: { $ifNull: ["$trucks", []] } } },
        {
          $addFields: {
            _tcount: { $size: "$_trucksArr" },
            _placed: {
              $size: {
                $filter: {
                  input: "$_trucksArr",
                  as: "t",
                  cond: {
                    $or: [
                      { $ne: [{ $ifNull: ["$$t.cellName", ""] }, ""] },
                      { $ne: [{ $ifNull: ["$$t.cellIndex", null] }, null] },
                      {
                        $anyElementTrue: {
                          $map: {
                            input: { $ifNull: ["$$t.vehicles", []] },
                            as: "v",
                            in: {
                              $or: [
                                { $ne: [{ $ifNull: ["$$v.cellName", ""] }, ""] },
                                { $ne: [{ $ifNull: ["$$v.cellIndex", null] }, null] },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $match:
            assignment === "assigned"
              ? { $expr: { $and: [{ $gt: ["$_tcount", 0] }, { $gte: ["$_placed", "$_tcount"] }] } }
              : { $expr: { $lt: ["$_placed", "$_tcount"] } },
        },
        { $sort: { createdAt: -1 } },
        { $facet: { page: [{ $skip: skip }, { $limit: limit }], meta: [{ $count: "total" }] } },
      ];
      const aggRes = await DataSLF.aggregate(pipeline).allowDiskUse(true);
      const facet = aggRes[0] || {};
      const idOrder = (facet.page || []).map((d) => d._id);
      const total = facet.meta?.[0]?.total || 0;
      const docs = idOrder.length
        ? await DataSLF.find({ _id: { $in: idOrder } })
            .setOptions({ includeHiddenYears: true })
            .populate("slfGenerator", SLF_GENERATOR_REF_FIELDS)
            .lean()
        : [];
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      const data = idOrder.map((id) => byId.get(String(id))).filter(Boolean);
      return res.json({ data, total, page, limit });
    }

    // Grouped, server-paginated admin list. The Submissions tab batches
    // submissions by submittedBy+company+status; doing that grouping (and paging
    // over the resulting rows) in the DB means the client only ever loads one
    // page. Year-visibility is auto-applied to the aggregation by the schema
    // plugin, so it stays consistent with the find() path.
    if (paginated && String(req.query.grouped || "").toLowerCase() === "true") {
      const skip = (page - 1) * limit;
      // Export mode: return EVERY matched group (all their entries), bypassing
      // pagination, so an Excel export covers the whole filtered result set — not
      // just the current page. Row/entry breakdown happens client-side.
      const exportAll = String(req.query.all || "").toLowerCase() === "true";
      const placementFilter = String(req.query.cellPlacement || "all").trim();
      // Batch key mirrors the client's getPortalSubmissionGroupKey: group only
      // when submittedBy (an email), company, submissionId, and a non-reverted
      // status exist; everything else stays a standalone row keyed by its _id.
      // submissionId keeps each distinct submission EVENT as its own grouped row
      // — without it every submission from a portal user collapsed into one row,
      // hiding hundreds of submissions (700+ entries showed as only ~3 pages).
      const rowKeyExpr = {
        $let: {
          vars: {
            sb: { $toLower: { $trim: { input: { $ifNull: ["$submittedBy", ""] } } } },
            co: { $toLower: { $trim: { input: { $ifNull: ["$lguCompanyName", ""] } } } },
            st: { $toLower: { $trim: { input: { $ifNull: ["$status", ""] } } } },
            si: { $toLower: { $trim: { input: { $ifNull: ["$submissionId", ""] } } } },
          },
          in: {
            $cond: [
              {
                $and: [
                  { $ne: ["$$sb", ""] },
                  { $ne: ["$$co", ""] },
                  { $ne: ["$$si", ""] },
                  { $ne: [{ $indexOfBytes: ["$$sb", "@"] }, -1] },
                  { $ne: ["$$st", "reverted"] },
                ],
              },
              { $concat: ["$$sb", "::", "$$co", "::", "$$st", "::", "$$si"] },
              { $concat: ["singleton:", { $toString: "$_id" }] },
            ],
          },
        },
      };
      const pipeline = [
        { $match: filter },
        { $addFields: { _trucksArr: { $ifNull: ["$trucks", []] } } },
        {
          $addFields: {
            _tcount: { $size: "$_trucksArr" },
            _placed: {
              $size: {
                $filter: {
                  input: "$_trucksArr",
                  as: "t",
                  cond: {
                    $or: [
                      { $ne: [{ $ifNull: ["$$t.cellName", ""] }, ""] },
                      {
                        $anyElementTrue: {
                          $map: {
                            input: { $ifNull: ["$$t.vehicles", []] },
                            as: "v",
                            in: { $ne: [{ $ifNull: ["$$v.cellName", ""] }, ""] },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $addFields: {
            _etotal: { $cond: [{ $gt: ["$_tcount", 0] }, "$_tcount", { $ifNull: ["$truckCount", 0] }] },
            _known: { $cond: [{ $gt: ["$_tcount", 0] }, 1, 0] },
            _rowKey: rowKeyExpr,
            // #3: two-tier submission priority (lower = higher priority):
            //   0 = unacknowledged — every submission AND resubmission not yet
            //       acknowledged (pending / reverted / rejected). These need admin
            //       attention and appear first, intermixed by latest date below.
            //   1 = acknowledged — appears after all unacknowledged records.
            _rank: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] },
            // Most-recent relevant timestamp: resubmission/update date for
            // resubmissions, created date otherwise (updatedAt as fallback).
            _sortDate: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$previousIdNos", []] } }, 0] },
                { $ifNull: ["$updatedAt", "$createdAt"] },
                { $ifNull: ["$createdAt", "$updatedAt"] },
              ],
            },
          },
        },
        {
          // No pre-group $sort (that sorts the whole collection in memory and
          // overflows). sortDate uses $max; per-group entry order (primary =
          // most recent) is restored from each doc's createdAt in Node below.
          $group: {
            _id: "$_rowKey",
            entryIds: { $push: "$_id" },
            sortDate: { $max: "$createdAt" },
            // Deterministic tiebreak. Bulk imports insert many rows in the same
            // millisecond, and with only a date to sort by Mongo's order among
            // ties is unspecified — so a row could appear on two pages, or none,
            // between refreshes. ObjectIds increase monotonically, so the newest
            // entry id orders ties stably and chronologically.
            maxEntryId: { $max: "$_id" },
            count: { $sum: 1 },
            gPlaced: { $sum: "$_placed" },
            gTotal: { $sum: "$_etotal" },
            gKnown: { $max: "$_known" },
            // A group takes the HIGHEST priority (lowest rank) of its entries.
            gRank: { $min: "$_rank" },
            gSort: { $max: "$_sortDate" },
          },
        },
      ];
      if (placementFilter && placementFilter !== "all") {
        pipeline.push({
          $addFields: {
            _cat: {
              $switch: {
                branches: [
                  { case: { $and: [{ $eq: ["$gKnown", 0] }, { $eq: ["$gTotal", 0] }] }, then: "nowaste" },
                  { case: { $eq: ["$gKnown", 0] }, then: "unknown" },
                  { case: { $eq: ["$gPlaced", 0] }, then: "none" },
                  { case: { $gte: ["$gPlaced", "$gTotal"] }, then: "assigned" },
                ],
                default: "partial",
              },
            },
          },
        });
        pipeline.push({ $match: { _cat: placementFilter } });
      }
      // STRICT chronological order: newest submission first, oldest last.
      //
      // This previously sorted by `gRank` first — unacknowledged submissions
      // ahead of acknowledged ones — so the list was not chronological, and
      // approving a submission flipped its rank and made the row JUMP to a
      // different part of the table. It also sorted on `gSort`, which mixed
      // updatedAt (for resubmissions) with createdAt (for everything else), so
      // the values being compared were not the same measurement.
      //
      // Ordering is now purely by submission time with a stable id tiebreak.
      // The `isResubmission` flag is still returned, so the table can highlight
      // resubmissions without them overriding the order.
      pipeline.push({ $sort: { sortDate: -1, maxEntryId: -1 } });
      pipeline.push({
        $facet: {
          // exportAll → no skip/limit (every group). Otherwise the current page.
          page: exportAll ? [] : [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: "total" }],
          // Total SUBMISSION ENTRIES across all matched groups (respects every
          // filter, incl. cell-placement) — the true submission count the admin
          // expects, vs. `total` which counts collapsed grouped ROWS.
          metaEntries: [{ $group: { _id: null, n: { $sum: "$count" } } }],
        },
      });

      const aggRes = await DataSLF.aggregate(pipeline).allowDiskUse(true);
      const facet = aggRes[0] || {};
      const pageGroups = facet.page || [];
      const total = facet.meta?.[0]?.total || 0;
      const totalEntries = facet.metaEntries?.[0]?.n || 0;

      const idOrder = [];
      pageGroups.forEach((g) => (g.entryIds || []).forEach((id) => idOrder.push(id)));
      const baseFields =
        "slfGenerator slfName submissionId idNo previousIdNos dateOfDisposal lguCompanyName companyType address companyRegion companyProvince companyMunicipality companyBarangay status revertRequested editRequested submittedBy createdAt updatedAt isDummy baselineUnit totalVolumeAccepted totalVolumeAcceptedUnit activeCellEntries closedCellEntries truckCount totalVolumeM3 totalVolumeTons residualVolumeM3 residualVolumeTons hazardousVolumeM3 hazardousVolumeTons";
      const projection =
        baseFields +
        (includeTrucks
          ? " trucks"
          : " trucks.cellName trucks.truckCapacity trucks.truckCapacityUnit trucks.actualVolume trucks.actualVolumeUnit" +
            " trucks.vehicles.cellName trucks.vehicles.plateNumber trucks.vehicles.capacity trucks.vehicles.capacityUnit trucks.vehicles.actualVolume trucks.vehicles.actualVolumeUnit");
      const entryDocs = idOrder.length
        ? await DataSLF.find({ _id: { $in: idOrder } })
            .setOptions({ includeHiddenYears: true })
            .populate("slfGenerator", SLF_GENERATOR_REF_FIELDS)
            .select(projection)
            .lean()
        : [];
      const byId = new Map(entryDocs.map((d) => [String(d._id), d]));

      let allowancePct = 10;
      try {
        const AppSettings = require("../models/AppSettings");
        const cfg = await AppSettings.findOne().select("truckCapacityAllowancePercent").lean();
        if (cfg && Number.isFinite(Number(cfg.truckCapacityAllowancePercent))) {
          allowancePct = Number(cfg.truckCapacityAllowancePercent);
        }
      } catch { /* fall back to 10% */ }

      // Cell names are resolved to the facility's CURRENT labels before the entry
      // leaves the server, so no consumer can render a name frozen at submit time.
      const enrich = (raw) => {
        const entry = applyResolvedCellNames(raw);
        return {
          ...entry,
          isResubmission: isResubmissionEntry(entry),
          truckCount: entry.truckCount ?? (Array.isArray(entry.trucks) ? entry.trucks.length : 0),
          cellPlacement: computeCellPlacementSummary(entry),
          cellNames: collectCellNames(entry),
          remarks: computeSubmissionRemarks(entry, allowancePct),
          trucks: includeTrucks ? entry.trucks : [],
        };
      };
      // Return the RAW entries for this page's groups (every group is returned
      // whole, so no batch is split across pages). The admin table regroups them
      // client-side exactly as before — keeping all existing grouped-row actions
      // intact — while `total` (group count) drives server-side pagination.
      const rows = [];
      pageGroups.forEach((g) => {
        (g.entryIds || [])
          .map((id) => byId.get(String(id)))
          .filter(Boolean)
          .sort(
            (a, b) =>
              new Date(b.createdAt || 0) - new Date(a.createdAt || 0) ||
              String(b._id).localeCompare(String(a._id)),
          )
          .forEach((e) => rows.push(enrich(e)));
      });

      return res.json({ data: rows, total, totalEntries, page, limit });
    }

    let query = DataSLF.find(filter)
      .populate("slfGenerator", SLF_GENERATOR_REF_FIELDS)
      // `_id` tiebreak: bulk imports share a createdAt millisecond, and without
      // it the order among ties is unspecified — rows could repeat or vanish
      // across pages.
      .sort({ createdAt: -1, _id: -1 });
    if (listMode) {
      // cellUsage=true → lean projection used only for SLF Data Table cell-fill
      // enrichment. Returns just the fields buildFacilityCellUsage needs, slashing
      // payload + client memory vs. the full submission documents.
      if (String(req.query.cellUsage || "").toLowerCase() === "true") {
        query = query.select(
          "slfGenerator slfName status dateOfDisposal trucks.actualVolume trucks.actualVolumeUnit trucks.wasteType trucks.cellName trucks.cellIndex trucks.vehicles.actualVolume trucks.vehicles.cellName trucks.vehicles.cellIndex trucks.vehicles.wasteType",
        );
      } else {
        // Base fields shared by both variants. The trucks projection differs:
        // when includeTrucks is set we pull the FULL `trucks` array, otherwise we
        // only pull the cell-name sub-paths. Never mix the parent path (`trucks`)
        // with its sub-paths (`trucks.cellName`) in one projection — Mongoose 9
        // rejects that with "Path collision at trucks".
        const baseFields =
          "slfGenerator slfName submissionId idNo previousIdNos dateOfDisposal lguCompanyName companyType address companyRegion companyProvince companyMunicipality companyBarangay status revertRequested editRequested submittedBy createdAt updatedAt isDummy baselineUnit totalVolumeAccepted totalVolumeAcceptedUnit activeCellEntries closedCellEntries truckCount totalVolumeM3 totalVolumeTons residualVolumeM3 residualVolumeTons hazardousVolumeM3 hazardousVolumeTons";
        query = query.select(
          baseFields +
            (includeTrucks
              ? " trucks"
              : " trucks.cellName trucks.truckCapacity trucks.truckCapacityUnit trucks.actualVolume trucks.actualVolumeUnit" +
                " trucks.vehicles.cellName trucks.vehicles.plateNumber trucks.vehicles.capacity trucks.vehicles.capacityUnit trucks.vehicles.actualVolume trucks.vehicles.actualVolumeUnit"),
        );
      }
    }
    if (paginated) {
      query = query.skip((page - 1) * limit).limit(limit);
    }
    const [entries, total] = await Promise.all([
      query.lean(),
      paginated ? DataSLF.countDocuments(filter) : Promise.resolve(null),
    ]);
    // Configured truck-capacity allowance (default 10%) — used to compute the
    // "Exceeded truck capacity" admin remark. Fetched once per request.
    let allowancePct = 10;
    try {
      const AppSettings = require("../models/AppSettings");
      const cfg = await AppSettings.findOne().select("truckCapacityAllowancePercent").lean();
      if (cfg && Number.isFinite(Number(cfg.truckCapacityAllowancePercent))) {
        allowancePct = Number(cfg.truckCapacityAllowancePercent);
      }
    } catch { /* fall back to 10% */ }
    if (paginated) {
      res.json({
        data: entries.map((raw) => {
          const entry = applyResolvedCellNames(raw);
          return {
            ...entry,
            isResubmission: isResubmissionEntry(entry),
            truckCount: entry.truckCount ?? (Array.isArray(entry.trucks) ? entry.trucks.length : 0),
            cellPlacement: computeCellPlacementSummary(entry),
            cellNames: collectCellNames(entry),
            remarks: computeSubmissionRemarks(entry, allowancePct),
            trucks: includeTrucks ? entry.trucks : [],
          };
        }),
        total,
        page,
        limit,
      });
      return;
    }
    if (listMode) {
      // #6B: flag resubmissions and surface them first (never excluded by status
      // filters or grouping; original reference preserved via previousIdNos). The
      // Submissions tab consumes this non-paginated list and groups client-side, so
      // ordering here drives the table's resubmission-priority ordering.
      const decorated = entries
        .map((raw) => applyResolvedCellNames(raw))
        .map((entry) => ({
          ...entry,
          isResubmission: isResubmissionEntry(entry),
          ...(includeTrucks
            ? {}
            : {
                cellPlacement: computeCellPlacementSummary(entry),
                cellNames: collectCellNames(entry),
                remarks: computeSubmissionRemarks(entry, allowancePct),
                trucks: [],
              }),
        }))
        .sort(chronologicalNewestFirst);
      res.json(decorated);
      return;
    }
    res.json(applyResolvedCellNamesToAll(entries));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get("/detail/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null })
      .populate("slfGenerator")
      .lean();
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    res.json(entry);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * Per-cell fill panel for Admin → Portal Submission → Cell Waste Placement.
 *
 * ── The bottleneck this replaces ────────────────────────────────────────────
 * The page used to answer "how full is each cell?" in the BROWSER. Selecting a
 * submission fired `GET /data-slf?mode=list&includeTrucks=true&search=<facility
 * name>` with NO `limit`, so the unpaginated branch returned EVERY record that
 * matched the name — each with its complete `trucks[]`/`vehicles[]` array and a
 * populated facility — purely so the client could add the volumes up. The
 * request re-fired on every facility switch, could not be cached (includeTrucks
 * disables the admin-list cache) and grew without bound as a facility submits.
 * A second full-collection aggregation, `GET /data-slf/baselines`, was loaded
 * on mount for one field: the selected facility's baseline date.
 *
 * It was also WRONG. The cell grid is built from the facility's cell
 * configuration, but the only facility document the page had was the
 * `slfGenerator` populated by the list route — projected down to
 * SLF_GENERATOR_REF_FIELDS, which carries `cellNames` and none of
 * numberOfCell / cellCapacities / cellStatuses / cellTypes. The cell count
 * therefore collapsed to the `1` fallback: the panel showed a single "Cell 1",
 * the assignment dropdown offered only that cell, and any volume placed in a
 * cell other than index 0 was dropped from the totals.
 *
 * Both problems have one answer — compute it where the data already is. The
 * rollup itself is `computeCellOccupancy`, the SAME function that produces the
 * persisted `SlfFacility.cellFillValues`, so this panel cannot drift from the
 * dashboard gauges or the portal tiles.
 *
 * Response is O(cells), not O(submissions).
 */
const cellPlacementOverviewKey = (req) =>
  `${CELL_PLACEMENT_PREFIX}:${req.params.facilityId}:${devWantsDummy(req) ? "dummy" : "default"}`;

/**
 * THE per-cell row shape every consumer reads.
 *
 * `computeCellOccupancy` is the one calculation (it also produces the persisted
 * `SlfFacility.cellFillValues`); this turns its rows into the presentation shape
 * — label, status, capacity, utilisation — so the Cell Waste Placement panel,
 * Cell Infrastructure, View SLF Details and the portal dashboard cannot each
 * derive a different number from the same record.
 *
 * Capacity is converted INTO the occupancy unit before the percentage is taken.
 * A facility whose capacity is declared in tons while its fill resolves to m³
 * (or vice-versa) otherwise divides two different units and reports a
 * utilisation that is out by the conversion factor.
 */
function buildOccupancyCells(facility, occupancy, idsByCell = new Map()) {
  const unit = occupancy.unit;
  return occupancy.rows.map((row) => {
    const converted = convertVolumeStrict(
      Number(facility.cellCapacities?.[row.index] || 0),
      facility.cellCapacityUnits?.[row.index] || unit,
      unit,
    );
    const capacity = Number.isFinite(Number(converted)) ? Number(converted) : 0;
    const status = normalizeCellStatus(facility.cellStatuses?.[row.index]);
    const submissionIds = [...(idsByCell.get(row.index) || [])];
    return {
      index: row.index,
      label: String(facility.cellNames?.[row.index] || "").trim() || `Cell ${row.index + 1}`,
      status,
      type: facility.cellTypes?.[row.index] || "Residual",
      active: isActiveCellStatus(status),
      unit: displayUnit(unit),
      capacity,
      // `used` = baseline + valid submissions, counted exactly once each —
      // unless an admin declared this cell's figure, in which case it is theirs
      // and `derivedTotal` carries what the data alone would have said.
      used: Math.round(row.total * 1000) / 1000,
      baselineUsed: Math.round(row.baseline * 1000) / 1000,
      submittedUsed: Math.round(row.submitted * 1000) / 1000,
      overridden: !!row.overridden,
      derivedTotal: row.overridden ? row.derivedTotal : undefined,
      unconvertible: row.unconvertible || 0,
      pct: capacity > 0 ? Math.min(100, (row.total / capacity) * 100) : null,
      remaining: capacity > 0 ? Math.max(0, capacity - row.total) : null,
      submissionIds,
      submissionCount: submissionIds.length,
    };
  });
}

/** Per-cell set of submission ids contributing waste, under the occupancy rules. */
function collectSubmissionIdsByCell(entries) {
  const idsByCell = new Map();
  entries.forEach((entry) => {
    if (!(entry.trucks || []).length) return;
    if (!ACTIVE_VOLUME_STATUSES.has(entry.status || "pending")) return;
    const place = (index) => {
      if (!Number.isInteger(index) || index < 0) return;
      if (!idsByCell.has(index)) idsByCell.set(index, new Set());
      idsByCell.get(index).add(String(entry._id));
    };
    entry.trucks.forEach((truck) => {
      const vehicles = (truck.vehicles || []).filter(
        (v) => v?.cellIndex !== null && v?.cellIndex !== undefined && v?.cellIndex !== "",
      );
      if (vehicles.length) {
        vehicles.forEach((v) => place(Number(v.cellIndex)));
        return;
      }
      if (truck?.cellIndex !== null && truck?.cellIndex !== undefined && truck?.cellIndex !== "") {
        place(Number(truck.cellIndex));
      }
    });
  });
  return idsByCell;
}

/**
 * Record that ONE existing placement moved from one cell to another.
 *
 * Every path that can change a placement writes here: the admin correction, the
 * admin assignment editor, the portal's Organize Cell Placement and its bulk
 * upload. That is what makes the cell tracker answerable from persisted data —
 * current cell, previous cell, who moved it, when — and it is deliberately the
 * ONLY record of the move: the volume itself is not copied anywhere, so a
 * reassignment can never inflate a facility's total.
 *
 * A no-op (same cell) and a FIRST assignment (nothing to move from) are both
 * ignored — there is no movement to record.
 */
function recordCellMovement(entry, move) {
  const from = move.fromCellIndex;
  if (from === null || from === undefined || from === "" || !Number.isInteger(Number(from))) return null;
  if (Number(from) === Number(move.toCellIndex)) return null;
  const record = {
    truckIndex: move.truckIndex,
    vehicleIndex: move.vehicleIndex ?? null,
    fromCellIndex: Number(from),
    fromCellName: move.fromCellName || `Cell ${Number(from) + 1}`,
    fromCellType: move.fromCellType || "",
    toCellIndex: Number(move.toCellIndex),
    toCellName: move.toCellName || `Cell ${Number(move.toCellIndex) + 1}`,
    toCellType: move.toCellType || "",
    volume: Number(move.volume || 0) || undefined,
    volumeUnit: move.volumeUnit || "",
    reason: move.reason,
    correctedBy: move.actor,
    correctedAt: new Date(),
    statusAtCorrection: entry.status,
    source: move.source,
  };
  if (!Array.isArray(entry.cellCorrections)) entry.cellCorrections = [];
  entry.cellCorrections.push(record);
  return record;
}

/** The cell a placement currently sits in, or null when it has never been placed. */
function currentCellIndexOf(truck, vehicleIndex) {
  const slot =
    Number.isInteger(vehicleIndex) && Array.isArray(truck?.vehicles) && truck.vehicles[vehicleIndex]
      ? truck.vehicles[vehicleIndex]
      : truck;
  const raw = slot?.cellIndex;
  if (raw === null || raw === undefined || raw === "") return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

const FACILITY_CELL_FIELDS =
  "_id lgu slfName province numberOfCell cellNames cellStatuses cellTypes " +
  "cellCapacities cellCapacityUnits cellFillValues cellFillOverridden cellFillUnits " +
  "wasteReceivedUnit volumeCapacityUnit";

/**
 * Per-cell occupancy for EVERY facility, in one request.
 *
 * SLF Monitoring / View SLF Details / Cell Infrastructure used to recompute this
 * in the browser (`buildFacilityCellUsage` in slf-monitoring/SlfDashboardTab.jsx)
 * from `/data-slf/cell-usage`. That was a THIRD implementation of a calculation
 * that already exists twice, and it disagreed with both:
 *   • it reads only truck-level `actualVolume`/`cellIndex`, so a submission whose
 *     waste is split across per-VEHICLE placements contributed nothing;
 *   • the gauge rendered the STORED `cellFillValues` while the breakdown table
 *     and chart rendered the browser's own numbers, so the two disagreed after
 *     any cell move;
 *   • capacity utilisation divided a fill in one unit by a capacity in another.
 *
 * One rollup, from `computeCellOccupancy`, serves all of them. It is also far
 * smaller on the wire than the row set it replaces: O(facilities × cells)
 * instead of O(submissions × trucks).
 */
const cellOccupancyAllKey = (req) =>
  `${CELL_PLACEMENT_PREFIX}:all:${devWantsDummy(req) ? "dummy" : "default"}`;

router.get("/cell-occupancy", cacheJson(cellOccupancyAllKey, 60000), async (req, res) => {
  try {
    const includeDummy = devWantsDummy(req);
    const [facilities, entries, appSettings] = await Promise.all([
      SlfFacility.find({ deletedAt: null, ...(includeDummy ? {} : { isDummy: { $ne: true } }) })
        .select(FACILITY_CELL_FIELDS)
        .lean(),
      DataSLF.find({
        deletedAt: null,
        slfGenerator: { $ne: null },
        ...(includeDummy ? {} : { isDummy: { $ne: true } }),
      })
        .setOptions({ includeHiddenYears: true })
        .select(`${OCCUPANCY_ENTRY_FIELDS} dateOfDisposal`)
        .sort({ createdAt: -1 })
        .lean(),
      require("../models/AppSettings")
        .findOne()
        .select("excludePreBaselineDisposalFromCellFill")
        .lean(),
    ]);

    const exclude = appSettings?.excludePreBaselineDisposalFromCellFill !== false;
    const byFacilityEntries = new Map();
    entries.forEach((entry) => {
      const key = String(entry.slfGenerator);
      if (!byFacilityEntries.has(key)) byFacilityEntries.set(key, []);
      byFacilityEntries.get(key).push(entry);
    });

    const byFacility = {};
    facilities.forEach((facility) => {
      const key = String(facility._id);
      const own = byFacilityEntries.get(key) || [];
      const { counted, excludedCount } = applyPreBaselineRule(own, { exclude });
      // `own`, not the whole batch — another facility's declared unit must never
      // decide this one's.
      const occupancy = computeCellOccupancy(facility, counted, { unitSource: own });
      byFacility[key] = {
        unit: displayUnit(occupancy.unit),
        cells: buildOccupancyCells(facility, occupancy, collectSubmissionIdsByCell(counted)),
        totals: {
          baseline: occupancy.baselineTotal,
          submitted: occupancy.submittedTotal,
          total: occupancy.totalVolume,
          // Received but not organized into a cell yet — the gap between the
          // facility total and the sum of its cells. Reported rather than
          // attributed to a cell nobody chose.
          unplaced: occupancy.unplacedTotal,
          placedSubmitted: occupancy.placedSubmittedTotal,
          cellTotal: occupancy.cellTotal,
        },
        submissionCount: counted.filter(
          (e) => (e.trucks || []).length > 0 && ACTIVE_VOLUME_STATUSES.has(e.status || "pending"),
        ).length,
        excludedPreBaselineCount: excludedCount,
      };
    });

    res.json({ byFacility, generatedAt: new Date() });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.get(
  "/cell-placement-overview/:facilityId",
  authMiddleware,
  adminOnly,
  cacheJson(cellPlacementOverviewKey, 60000),
  async (req, res) => {
    try {
      const facilityId = String(req.params.facilityId || "").trim();
      if (!mongoose.isValidObjectId(facilityId)) {
        return res.status(400).json({ message: "A valid facility id is required." });
      }
      const facility = await SlfFacility.findById(facilityId).select(FACILITY_CELL_FIELDS).lean();
      if (!facility) return res.status(404).json({ message: "Facility not found" });

      const includeDummy = devWantsDummy(req);
      const [entries, appSettings] = await Promise.all([
        DataSLF.find({
          slfGenerator: facility._id,
          deletedAt: null,
          ...(includeDummy ? {} : { isDummy: { $ne: true } }),
        })
          .setOptions({ includeHiddenYears: true })
          // The occupancy projection, plus the two dates the pre-baseline rule
          // compares. Never the whole document.
          .select(`${OCCUPANCY_ENTRY_FIELDS} dateOfDisposal`)
          .sort({ createdAt: -1 })
          .lean(),
        require("../models/AppSettings")
          .findOne()
          .select("excludePreBaselineDisposalFromCellFill preBaselineDisposalDetectorEnabled")
          .lean(),
      ]);

      const { baselineDate, counted, excludedCount } = applyPreBaselineRule(entries, {
        exclude: appSettings?.excludePreBaselineDisposalFromCellFill !== false,
      });
      const occupancy = computeCellOccupancy(facility, counted, { unitSource: entries });
      const cells = buildOccupancyCells(facility, occupancy, collectSubmissionIdsByCell(counted));

      res.json({
        facility: {
          _id: facility._id,
          slfName: facility.slfName || facility.lgu || "",
          lgu: facility.lgu || "",
        },
        unit: displayUnit(occupancy.unit),
        cells,
        totals: {
          baseline: occupancy.baselineTotal,
          submitted: occupancy.submittedTotal,
          total: occupancy.totalVolume,
          unplaced: occupancy.unplacedTotal,
          placedSubmitted: occupancy.placedSubmittedTotal,
          cellTotal: occupancy.cellTotal,
        },
        excludedPreBaselineCount: excludedCount,
        preBaselineDetectorEnabled: appSettings?.preBaselineDisposalDetectorEnabled !== false,
        baselineLastUpdated: baselineDate,
        generatedAt: new Date(),
      });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

router.post("/cell-capacity-alert", async (req, res) => {
  try {
    const { submissionIds = [], message, cellName, slfName, performedBy } = req.body || {};
    const ids = Array.isArray(submissionIds) ? submissionIds.filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ message: "Select at least one submission." });

    const entries = await DataSLF.find({ _id: { $in: ids }, deletedAt: null })
      .select("idNo submissionId lguCompanyName submittedBy slfName")
      .lean();
    const recipients = [...new Set(entries.map((entry) => entry.submittedBy).filter(Boolean))];
    if (recipients.length === 0) return res.status(400).json({ message: "No portal user email found for selected submissions." });

    const text = message || `The landfill cell${cellName ? ` (${cellName})` : ""}${slfName ? ` at ${slfName}` : ""} is nearing capacity. Please coordinate with EMB Region III before the next disposal.`;
    await Notification.insertMany(recipients.map((email) => ({
      recipient: email,
      type: "cell_capacity_alert",
      title: "Landfill Cell Capacity Alert",
      message: text,
      submissionId: entries.find((entry) => entry.submittedBy === email)?.submissionId,
      meta: {
        cellName,
        slfName,
        submissionIds: entries.filter((entry) => entry.submittedBy === email).map((entry) => entry.submissionId || entry.idNo),
      },
    })));
    recipients.forEach((email) => notifyPortal(req, email, {
      type: "cell_capacity_alert",
      title: "Landfill Cell Capacity Alert",
      message: text,
      meta: { cellName, slfName },
    }));
    await Transaction.create({
      submissionId: entries[0]?.submissionId || entries[0]?.idNo || "cell-capacity-alert",
      companyName: slfName || entries[0]?.slfName || entries[0]?.lguCompanyName || "",
      type: "cell_capacity_alert",
      description: `Cell capacity alert sent to ${recipients.length} portal user(s)${cellName ? ` for ${cellName}` : ""}`,
      performedBy: performedBy || getRequestActor(req),
      meta: { recipients, cellName, slfName, submissionIds: ids },
    });
    notifyAdmin(req, {
      type: "cell_capacity_alert",
      title: "Cell Capacity Alert Sent",
      message: `Alert sent to ${recipients.length} portal user(s).`,
    });
    res.json({ message: "Cell capacity alert sent.", recipients: recipients.length });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

/**
 * Admin: CORRECT the cell a submission's waste was placed in.
 *
 * ── Why this is not just "let the admin edit the field" ─────────────────────
 * PATCH /:id/cell-assignments exists for the ordinary case: waste that has not
 * been placed yet. Once a submission is ACKNOWLEDGED the placement is a figure
 * the facility's occupancy, the dashboards and the portal's own tiles are all
 * derived from, so changing it has to be deliberate, attributable and
 * reversible in the record — not an untracked overwrite of `trucks[].cellIndex`.
 *
 * The correction moves ONE placement (a truck, or one vehicle of a truck):
 *   • `trucks[].cellIndex` becomes the new cell — there is always exactly one
 *     current placement, so the volume can never be counted in two cells and no
 *     duplicate submission is created;
 *   • the placement it replaced is appended to `cellCorrections[]` with the
 *     admin, the timestamp and the required reason;
 *   • the submission's `_id`, `idNo`, `submissionId`, volumes, owner and
 *     workflow status are all left exactly as they were.
 *
 * Atomicity: everything the correction WRITES lives in one document, so the
 * `save()` is atomic on its own — there is no window in which the old cell is
 * updated and the new one is not. `SlfFacility.cellFillValues` is a DERIVED
 * denormalization that is RECOMPUTED from the submissions afterwards (never
 * incremented/decremented), so a failure there can only leave it stale for one
 * refresh cycle, not wrong — which is why this follows the codebase's existing
 * recompute pattern instead of introducing a multi-document transaction.
 */
// Reverted / revert-requested / rejected submissions are excluded on purpose:
// those are already in the portal user's hands through the revert workflow, and
// correcting one behind their back would collide with the resubmission they are
// being asked to make.
const CORRECTABLE_STATUSES = new Set(["acknowledged", "pending"]);
const MIN_CORRECTION_REASON = 5;

router.patch(
  "/:id/correct-cell-placement",
  authMiddleware,
  adminOnly,
  requirePermission("cellWastePlacement", "edit"),
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(String(req.params.id))) {
        return res.status(400).json({ message: "A valid submission id is required." });
      }
      const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null });
      if (!entry) return res.status(404).json({ message: "Submission not found" });

      // A baseline container has no waste placement to correct.
      if (!Array.isArray(entry.trucks) || entry.trucks.length === 0) {
        return res.status(400).json({ message: "This record carries no waste placement to correct." });
      }

      const status = String(entry.status || "pending").toLowerCase();
      if (!CORRECTABLE_STATUSES.has(status)) {
        return res.status(409).json({
          message: `A ${status.replace(/_/g, " ")} submission cannot have its cell corrected. Resolve the revert/rejection first.`,
          code: "NOT_CORRECTABLE",
        });
      }

      const body = req.body || {};
      const reason = String(body.reason || "").trim();
      if (reason.length < MIN_CORRECTION_REASON) {
        return res.status(400).json({ message: "A reason for the correction is required." });
      }

      // Optional caller-supplied expectations. When the client sends them they
      // are ENFORCED, so a stale screen cannot correct the wrong submission.
      if (body.expectedIdNo && String(body.expectedIdNo).trim() !== String(entry.idNo || "").trim()) {
        return res.status(409).json({
          message: "This submission's reference has changed. Reload and try again.",
          code: "STALE_SUBMISSION",
        });
      }
      if (
        body.expectedSlfGenerator &&
        String(body.expectedSlfGenerator) !== String(entry.slfGenerator || "")
      ) {
        return res.status(409).json({ message: "This submission belongs to a different SLF." });
      }

      const truckIndex = Number(body.truckIndex);
      if (!Number.isInteger(truckIndex) || truckIndex < 0 || truckIndex >= entry.trucks.length) {
        return res.status(400).json({ message: "The waste placement to correct was not found on this submission." });
      }
      const truck = entry.trucks[truckIndex];
      const hasVehicleIndex = body.vehicleIndex !== null && body.vehicleIndex !== undefined && body.vehicleIndex !== "";
      const vehicleIndex = hasVehicleIndex ? Number(body.vehicleIndex) : null;
      if (
        hasVehicleIndex &&
        (!Number.isInteger(vehicleIndex) ||
          vehicleIndex < 0 ||
          !Array.isArray(truck.vehicles) ||
          vehicleIndex >= truck.vehicles.length)
      ) {
        return res.status(400).json({ message: "The waste placement to correct was not found on this submission." });
      }
      const slot = hasVehicleIndex ? truck.vehicles[vehicleIndex] : truck;

      // A correction REASSIGNS an existing placement. Waste that has never been
      // placed belongs in the ordinary assignment flow, which needs no reason
      // and no audit hop.
      const currentIndex =
        slot.cellIndex === null || slot.cellIndex === undefined || slot.cellIndex === ""
          ? null
          : Number(slot.cellIndex);
      if (currentIndex === null || !Number.isInteger(currentIndex)) {
        return res.status(400).json({
          message: "This waste has no cell assigned yet — use Save Placement to assign it.",
          code: "NOT_PLACED",
        });
      }

      // The admin must be correcting the cell they were LOOKING at. If somebody
      // else moved it in the meantime, refuse rather than overwrite their change.
      if (
        body.fromCellIndex !== null &&
        body.fromCellIndex !== undefined &&
        body.fromCellIndex !== "" &&
        Number(body.fromCellIndex) !== currentIndex
      ) {
        return res.status(409).json({
          message: "This waste is no longer in the cell shown on screen. Refresh and try again.",
          code: "CELL_CHANGED",
        });
      }

      const toCellIndex = Number(body.toCellIndex);
      if (!Number.isInteger(toCellIndex) || toCellIndex < 0) {
        return res.status(400).json({ message: "Select a valid cell to move this waste to." });
      }
      if (toCellIndex === currentIndex) {
        return res.status(400).json({ message: "The new cell is the same as the current cell." });
      }

      const facility = entry.slfGenerator
        ? await SlfFacility.findById(entry.slfGenerator)
            .select("_id lgu slfName numberOfCell cellNames cellStatuses cellTypes")
            .lean()
        : null;
      if (!facility) {
        return res.status(400).json({ message: "This submission is not linked to an SLF facility, so its cells cannot be validated." });
      }
      const cellCount = Math.max(
        Number(facility.numberOfCell || 0),
        facility.cellNames?.length || 0,
        facility.cellStatuses?.length || 0,
        facility.cellTypes?.length || 0,
      );
      if (toCellIndex >= cellCount) {
        return res.status(400).json({ message: "That cell does not exist for this SLF." });
      }
      const toStatus = normalizeCellStatus(facility.cellStatuses?.[toCellIndex]);
      if (!isActiveCellStatus(toStatus)) {
        return res.status(400).json({ message: `That cell is ${toStatus} — waste can only be moved into an active cell.` });
      }

      const toCellName =
        String(facility.cellNames?.[toCellIndex] || "").trim() || `Cell ${toCellIndex + 1}`;
      const toCellType = facility.cellTypes?.[toCellIndex] || "";
      const fromCellName =
        String(facility.cellNames?.[currentIndex] || "").trim() ||
        String(slot.cellName || "").trim() ||
        `Cell ${currentIndex + 1}`;
      // Captured BEFORE the write: `slot` is the live subdocument, so reading
      // these after the apply block would record the new values as the old ones.
      const fromCellType = slot.cellType || "";
      const movedVolume = Number(slot.actualVolume ?? truck.actualVolume ?? 0) || undefined;
      const movedVolumeUnit =
        slot.actualVolumeUnit || truck.actualVolumeUnit || entry.baselineUnit || "";

      // ── Apply ── one document, one save.
      if (hasVehicleIndex) {
        truck.vehicles[vehicleIndex].cellIndex = toCellIndex;
        truck.vehicles[vehicleIndex].cellName = toCellName;
        truck.vehicles[vehicleIndex].cellType = toCellType;
        // The truck-level copy mirrors the first vehicle for legacy readers —
        // the same rule PATCH /:id/cell-assignments applies.
        if (vehicleIndex === 0) {
          truck.cellIndex = toCellIndex;
          truck.cellName = toCellName;
          truck.cellType = toCellType;
        }
      } else {
        truck.cellIndex = toCellIndex;
        truck.cellName = toCellName;
        truck.cellType = toCellType;
        if (Array.isArray(truck.vehicles)) {
          truck.vehicles.forEach((veh) => {
            veh.cellIndex = toCellIndex;
            veh.cellName = toCellName;
            veh.cellType = toCellType;
          });
        }
      }

      const correctedBy = getRequestActor(req, "admin");
      const correction = recordCellMovement(entry, {
        truckIndex,
        vehicleIndex: hasVehicleIndex ? vehicleIndex : null,
        fromCellIndex: currentIndex,
        fromCellName,
        fromCellType,
        toCellIndex,
        toCellName,
        toCellType,
        volume: movedVolume,
        volumeUnit: movedVolumeUnit,
        reason,
        actor: correctedBy,
        source: "admin_correction",
      });
      entry.markModified("trucks");
      await entry.save();

      // Derived data: the volume left one cell and entered another, so the
      // facility's persisted occupancy is recomputed from the submissions by the
      // same function every other placement write uses.
      await refreshOccupancyForFacilities(req, [entry.slfGenerator]);

      await Transaction.create({
        submissionId: entry.submissionId || entry.idNo,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy || "",
        type: "cell_correction",
        description: `Corrected waste placement on ${entry.idNo || entry.lguCompanyName}: ${fromCellName} → ${toCellName}`,
        performedBy: correctedBy,
        meta: {
          idNo: entry.idNo,
          truckIndex,
          vehicleIndex: correction.vehicleIndex,
          fromCellIndex: currentIndex,
          fromCellName,
          toCellIndex,
          toCellName,
          volume: correction.volume,
          volumeUnit: correction.volumeUnit,
          reason,
          statusAtCorrection: correction.statusAtCorrection,
        },
      });

      writeLog("info", "submissions.cell_corrected", {
        message: `Waste placement corrected on ${entry.idNo || entry._id}: ${fromCellName} → ${toCellName}`,
        user: correctedBy,
        ip: req.ip,
        meta: { dataEntry: String(entry._id), idNo: entry.idNo, fromCellName, toCellName },
      });

      notifyAdmin(req, {
        type: "cell_correction",
        title: "Waste Placement Corrected",
        message: `${entry.idNo || entry.lguCompanyName}: ${fromCellName} → ${toCellName}`,
        meta: { idNo: entry.idNo, dataEntry: entry._id },
      });
      if (entry.submittedBy) {
        // The submitting operator sees the corrected cell on their own record, so
        // they are told it moved and why — without the admin-only metadata.
        await Notification.create({
          recipient: entry.submittedBy,
          type: "cell_correction",
          title: "Waste Placement Corrected",
          message: `EMB Region III moved the waste on ${entry.idNo || "your submission"} from ${fromCellName} to ${toCellName}.`,
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          meta: { idNo: entry.idNo, fromCellName, toCellName },
        }).catch(() => {});
        notifyPortal(req, entry.submittedBy, {
          type: "cell_correction",
          title: "Waste Placement Corrected",
          message: `Your waste placement on ${entry.idNo || "a submission"} was moved from ${fromCellName} to ${toCellName}.`,
        });
        refreshPortal(req, entry.submittedBy, "submissions");
      }
      refreshAdmin(req, "submissions");

      const saved = applyResolvedCellNames(entry.toObject(), facility.cellNames);
      res.json({
        message: `Waste placement corrected: ${fromCellName} → ${toCellName}`,
        data: saved,
        correction,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  },
);

// Admin: assign submitted truck volumes to specific active SLF cells.
router.patch("/:id/cell-assignments", async (req, res) => {
  try {
    const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null });
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    const movements = [];
    assignments.forEach((assignment) => {
      const truckIndex = Number(assignment.truckIndex);
      if (!Number.isInteger(truckIndex) || truckIndex < 0 || truckIndex >= entry.trucks.length) return;
      const cellIndex = assignment.cellIndex === null || assignment.cellIndex === undefined || assignment.cellIndex === ""
        ? undefined
        : Number(assignment.cellIndex);
      if (cellIndex !== undefined && (!Number.isInteger(cellIndex) || cellIndex < 0)) return;
      const cellName = cellIndex === undefined ? "" : (assignment.cellName || `Cell ${cellIndex + 1}`);
      const cellType = assignment.cellType || "";
      // Per-vehicle assignment when a vehicleIndex is supplied (new model).
      const vehicleIndex =
        assignment.vehicleIndex === null || assignment.vehicleIndex === undefined
          ? null
          : Number(assignment.vehicleIndex);
      const truck = entry.trucks[truckIndex];
      // Reassigning an already-placed volume from this editor is a move too, and
      // belongs in the same tracker as the portal's and the correction workflow's.
      const priorCellIndex = cellIndex === undefined ? null : currentCellIndexOf(truck, vehicleIndex);
      if (priorCellIndex !== null && priorCellIndex !== cellIndex) {
        const priorSlot =
          Number.isInteger(vehicleIndex) && truck.vehicles?.[vehicleIndex]
            ? truck.vehicles[vehicleIndex]
            : truck;
        movements.push({
          truckIndex,
          vehicleIndex: Number.isInteger(vehicleIndex) ? vehicleIndex : null,
          fromCellIndex: priorCellIndex,
          fromCellName: priorSlot?.cellName || "",
          fromCellType: priorSlot?.cellType || "",
          toCellIndex: cellIndex,
          toCellName: cellName,
          toCellType: cellType,
          volume: Number(priorSlot?.actualVolume ?? truck?.actualVolume ?? 0) || undefined,
          volumeUnit:
            priorSlot?.actualVolumeUnit || truck?.actualVolumeUnit || entry.baselineUnit || "",
          reason: "Admin reassigned the waste placement from the cell editor.",
          actor: getRequestActor(req, "admin"),
          source: "admin_assignment",
        });
      }
      if (
        Number.isInteger(vehicleIndex) &&
        Array.isArray(truck.vehicles) &&
        vehicleIndex >= 0 &&
        vehicleIndex < truck.vehicles.length
      ) {
        truck.vehicles[vehicleIndex].cellIndex = cellIndex;
        truck.vehicles[vehicleIndex].cellName = cellName;
        truck.vehicles[vehicleIndex].cellType = cellType;
        // Keep the truck-level cell in sync with the first vehicle for legacy views.
        if (vehicleIndex === 0) {
          truck.cellIndex = cellIndex;
          truck.cellName = cellName;
          truck.cellType = cellType;
        }
        return;
      }
      truck.cellIndex = cellIndex;
      truck.cellName = cellName;
      truck.cellType = cellType;
      // Mirror to all vehicles so per-vehicle cell-fill stays consistent.
      if (Array.isArray(truck.vehicles)) {
        truck.vehicles.forEach((veh) => {
          veh.cellIndex = cellIndex;
          veh.cellName = cellName;
          veh.cellType = cellType;
        });
      }
    });
    movements.forEach((move) => recordCellMovement(entry, move));
    entry.markModified("trucks");
    await entry.save();

    // Moving waste between cells changes WHERE the volume sits, so the facility's
    // per-cell occupancy has to be recomputed — the portal path
    // (portal-cell-assignments) already did this; the admin path did not.
    await refreshOccupancyForFacilities(req, [entry.slfGenerator]);

    await Transaction.create({
      submissionId: entry.submissionId || entry.idNo,
      dataEntry: entry._id,
      companyName: entry.lguCompanyName,
      companyType: entry.companyType,
      submittedBy: entry.submittedBy || "",
      type: "cell_assignment",
      description: `Updated cell assignment for ${entry.idNo || entry.lguCompanyName}`,
      performedBy: getRequestActor(req, "admin"),
      meta: { idNo: entry.idNo, assignments },
    });

    notifyAdmin(req, {
      type: "baseline_update",
      title: "SLF Cell Assignment Updated",
      message: `${entry.idNo || entry.lguCompanyName} waste placement was assigned to active cells`,
      meta: { idNo: entry.idNo, dataEntry: entry._id },
    });
    refreshAdmin(req, "submissions");
    res.json({ message: "Cell assignments updated", data: entry });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal: the submitter organizes their own past submission waste into open
// cells. Validates ownership via submittedBy and applies per-vehicle (or
// truck-level) cell placements.
router.patch("/:id/portal-cell-assignments", async (req, res) => {
  try {
    const { submittedBy, assignments } = req.body || {};
    const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null });
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (
      !submittedBy ||
      String(entry.submittedBy || "").trim().toLowerCase() !==
        String(submittedBy).trim().toLowerCase()
    ) {
      return res.status(403).json({ message: "You can only organize your own submissions." });
    }
    // Block organizing once Admin has validated/locked the submission.
    if (entry.status === "rejected") {
      writeLog("warn", "organize_cells_validation_failed", {
        message: "Attempt to organize a locked/validated submission",
        user: submittedBy,
        ip: req.ip,
        meta: { submissionId: entry.idNo, reason: "locked", status: entry.status },
      });
      return res.status(400).json({ message: "This submission is already locked or validated by Admin." });
    }

    const list = Array.isArray(assignments) ? assignments : [];
    if (list.length === 0) {
      return res.status(400).json({ message: "No cell placement was provided." });
    }

    // Validate selected cells against the SLF facility: the cell must exist and
    // be operational. Mirrors the front-end availability rule (cellAvailability)
    // so a stale/altered client cannot organize waste into a nonexistent, deleted
    // or non-operational (used/completed/closed/out-of-service) cell.
    let facility = null;
    if (entry.slfGenerator) {
      facility = await SlfFacility.findById(entry.slfGenerator)
        .select("numberOfCell cellStatuses cellNames lgu")
        .lean();
    }
    const cellCount = Number(facility?.numberOfCell || facility?.cellStatuses?.length || 0);
    const validationErrors = [];
    list.forEach((assignment, i) => {
      if (assignment.cellIndex === null || assignment.cellIndex === undefined || assignment.cellIndex === "") return;
      const ci = Number(assignment.cellIndex);
      if (!Number.isInteger(ci) || ci < 0) {
        validationErrors.push(`Row ${i + 1}: invalid cell selection.`);
      } else if (cellCount > 0 && ci >= cellCount) {
        validationErrors.push(`Row ${i + 1}: selected cell does not belong to this SLF facility.`);
      } else if (facility && !cellExists(ci, facility)) {
        validationErrors.push(`Row ${i + 1}: selected cell no longer exists in the facility.`);
      } else if (facility && !isOperationalStatus(facility?.cellStatuses?.[ci])) {
        validationErrors.push(
          `Row ${i + 1}: cell is not operational (${facility?.cellStatuses?.[ci] || "unknown"}).`,
        );
      }
    });
    if (validationErrors.length) {
      writeLog("warn", "organize_cells_validation_failed", {
        message: validationErrors.join(" "),
        user: submittedBy,
        ip: req.ip,
        meta: { submissionId: entry.idNo, slfGenerator: String(entry.slfGenerator || ""), errors: validationErrors },
      });
      return res.status(400).json({ message: validationErrors.join(" ") });
    }

    const hadPriorPlacement = (entry.trucks || []).some(
      (t) => t?.cellName || (t?.vehicles || []).some((v) => v?.cellName)
    );

    // A completion may carry a cell, a Truck Capacity, or both. Capacity-only rows
    // (a historical truck that already has a cell but no capacity) must NOT clear
    // the existing cell — cell fields are only written when a cell is supplied.
    const isPositiveCap = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
    const normCapUnit = (u) => (u ? String(u).trim().replace("m3", "m³") : null);

    const movements = [];
    list.forEach((assignment) => {
      const truckIndex = Number(assignment.truckIndex);
      if (!Number.isInteger(truckIndex) || truckIndex < 0 || truckIndex >= entry.trucks.length) return;
      const truck = entry.trucks[truckIndex];
      const cellIndex =
        assignment.cellIndex === null || assignment.cellIndex === undefined || assignment.cellIndex === ""
          ? undefined
          : Number(assignment.cellIndex);
      if (cellIndex !== undefined && (!Number.isInteger(cellIndex) || cellIndex < 0)) return;
      const hasCell = cellIndex !== undefined;
      const cellName = hasCell ? (assignment.cellName || `Cell ${cellIndex + 1}`) : "";
      const cellType = assignment.cellType || "";
      const cap = isPositiveCap(assignment.truckCapacity) ? Number(assignment.truckCapacity) : null;
      const capUnit = normCapUnit(assignment.truckCapacityUnit);
      const vehicleIndex =
        assignment.vehicleIndex === null || assignment.vehicleIndex === undefined
          ? null
          : Number(assignment.vehicleIndex);
      // ORGANIZING AN ALREADY-PLACED VOLUME IS A MOVE, NOT AN ADDITION.
      //
      // The write below overwrites `cellIndex` in place and the facility's
      // occupancy is then RECOMPUTED from the submissions, so the volume leaves
      // its previous cell and enters the new one — the SLF's total submitted
      // volume is unchanged. This records the hop (previous cell → new cell) so
      // the cell tracker can show it, which matters most for an ACKNOWLEDGED
      // submission whose volume is already counted everywhere.
      const priorCellIndex = hasCell ? currentCellIndexOf(truck, vehicleIndex) : null;
      const priorSlot =
        Number.isInteger(vehicleIndex) && truck.vehicles?.[vehicleIndex]
          ? truck.vehicles[vehicleIndex]
          : truck;
      const priorCellName = priorSlot?.cellName || "";
      const priorCellType = priorSlot?.cellType || "";
      const priorVolume = Number(priorSlot?.actualVolume ?? truck?.actualVolume ?? 0) || undefined;
      const priorVolumeUnit =
        priorSlot?.actualVolumeUnit || truck?.actualVolumeUnit || entry.baselineUnit || "";
      if (priorCellIndex !== null && priorCellIndex !== cellIndex) {
        movements.push({
          truckIndex,
          vehicleIndex: Number.isInteger(vehicleIndex) ? vehicleIndex : null,
          fromCellIndex: priorCellIndex,
          fromCellName: priorCellName,
          fromCellType: priorCellType,
          toCellIndex: cellIndex,
          toCellName: cellName,
          toCellType: cellType,
          volume: priorVolume,
          volumeUnit: priorVolumeUnit,
          reason: "Portal user reorganized the waste placement.",
          actor: submittedBy,
          source: "portal_organize",
        });
      }
      if (
        Number.isInteger(vehicleIndex) &&
        Array.isArray(truck.vehicles) &&
        vehicleIndex >= 0 &&
        vehicleIndex < truck.vehicles.length
      ) {
        if (hasCell) {
          truck.vehicles[vehicleIndex].cellIndex = cellIndex;
          truck.vehicles[vehicleIndex].cellName = cellName;
          truck.vehicles[vehicleIndex].cellType = cellType;
          if (vehicleIndex === 0) {
            truck.cellIndex = cellIndex;
            truck.cellName = cellName;
            truck.cellType = cellType;
          }
        }
        if (cap != null) {
          truck.vehicles[vehicleIndex].capacity = cap;
          if (capUnit) truck.vehicles[vehicleIndex].capacityUnit = capUnit;
        }
        return;
      }
      if (hasCell) {
        truck.cellIndex = cellIndex;
        truck.cellName = cellName;
        truck.cellType = cellType;
        if (Array.isArray(truck.vehicles)) {
          truck.vehicles.forEach((veh) => {
            veh.cellIndex = cellIndex;
            veh.cellName = cellName;
            veh.cellType = cellType;
          });
        }
      }
      if (cap != null) {
        truck.truckCapacity = cap;
        if (capUnit) truck.truckCapacityUnit = capUnit;
      }
    });
    // Recorded after the writes so the whole batch is captured in file order.
    movements.forEach((move) => recordCellMovement(entry, move));
    entry.markModified("trucks");
    await entry.save();
    await refreshFacilityCellOccupancy(req, entry.slfGenerator);

    try {
      await Transaction.create({
        submissionId: entry.submissionId || entry.idNo,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy || "",
        type: "cell_assignment",
        description: `Portal user organized waste placement for ${entry.idNo || entry.lguCompanyName}`,
        performedBy: submittedBy,
        meta: { idNo: entry.idNo, portal: true },
      });
    } catch { /* silent */ }

    writeLog("info", hadPriorPlacement ? "organize_cells_updated" : "organize_cells_created", {
      message: `Portal user organized waste placement for ${entry.idNo || entry.lguCompanyName}`,
      user: submittedBy,
      ip: req.ip,
      meta: {
        submissionId: entry.idNo,
        slfGenerator: String(entry.slfGenerator || ""),
        cells: list.map((a) => a.cellName).filter(Boolean),
        result: "success",
      },
    });

    refreshAdmin(req, "submissions");
    refreshPortal(req, submittedBy, "submissions");
    res.json({ message: "Cell placement saved", data: entry });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Portal: BULK cell organization (file-based / multi-select) ──────────────
//
// A portal user organizes MANY placements across MANY of their own submissions in
// one request. Drives both the CSV/XLSX import flow and the multi-select flow.
//
// Two modes on the SAME endpoint so validation is identical for preview and apply:
//   • dryRun:true  → validate every row, write nothing, return per-row results.
//   • dryRun:false → all-or-nothing apply inside a single pass; if ANY row is
//                    invalid nothing is written (unless allowPartial:true), so a
//                    bad file can never partially corrupt placements.
//
// Ownership is enforced per submission (submittedBy must match the caller), cells
// are re-validated against the LIVE facility state (exists / operational / not
// full), and the COMBINED volume assigned to each cell in this batch is checked
// against that cell's remaining capacity. Idempotency: a completed batchId is
// remembered via its audit Transaction, so a retry does not double-apply.
const BULK_MAX_ROWS = 1000;

router.post("/portal-cell-assignments/bulk", async (req, res) => {
  try {
    const { submittedBy, assignments, batchId } = req.body || {};
    const dryRun = req.body?.dryRun === true;
    const allowPartial = req.body?.allowPartial === true;

    if (!submittedBy || typeof submittedBy !== "string") {
      return res.status(400).json({ message: "Missing portal user identity (submittedBy)." });
    }
    const rows = Array.isArray(assignments) ? assignments : [];
    if (!rows.length) return res.status(400).json({ message: "No assignments were provided." });
    if (rows.length > BULK_MAX_ROWS) {
      return res.status(400).json({ message: `Too many rows (max ${BULK_MAX_ROWS}).` });
    }

    const callerEmail = String(submittedBy).trim().toLowerCase();

    // Idempotency: if this batchId already applied, return its recorded result
    // instead of re-applying (guards against retries / double-submits).
    if (!dryRun && batchId) {
      const prior = await Transaction.findOne({
        type: "cell_assignment_bulk",
        "meta.batchId": String(batchId),
      }).lean();
      if (prior) {
        return res.json({
          message: "This bulk assignment was already applied.",
          alreadyApplied: true,
          batchId: String(batchId),
          applied: prior.meta?.applied || 0,
        });
      }
    }

    // Resolve every referenced submission once (by _id or submissionId/idNo),
    // scoped to the caller so another user's submission can never be touched.
    const ids = [...new Set(rows.map((r) => String(r._id || "")).filter((v) => mongoose.Types.ObjectId.isValid(v)))];
    const refs = [...new Set(rows.map((r) => String(r.submissionId || r.idNo || "").trim()).filter(Boolean))];
    const orClauses = [];
    if (ids.length) orClauses.push({ _id: { $in: ids } });
    if (refs.length) orClauses.push({ submissionId: { $in: refs } }, { idNo: { $in: refs } });
    const docs = orClauses.length
      ? await DataSLF.find({ deletedAt: null, submittedBy: new RegExp(`^${escapeRegExp(callerEmail)}$`, "i"), $or: orClauses })
      : [];

    const docByKey = new Map();
    docs.forEach((d) => {
      docByKey.set(String(d._id), d);
      if (d.submissionId) docByKey.set(`ref:${String(d.submissionId).trim().toLowerCase()}`, d);
      if (d.idNo) docByKey.set(`ref:${String(d.idNo).trim().toLowerCase()}`, d);
    });
    const resolveDoc = (r) => {
      if (r._id && docByKey.has(String(r._id))) return docByKey.get(String(r._id));
      const ref = String(r.submissionId || r.idNo || "").trim().toLowerCase();
      if (ref && docByKey.has(`ref:${ref}`)) return docByKey.get(`ref:${ref}`);
      return null;
    };

    // Facility cache (live cell state) — one read per facility for the whole batch.
    const facilityCache = new Map();
    const getFacility = async (genId) => {
      if (!genId) return null;
      const key = String(genId);
      if (facilityCache.has(key)) return facilityCache.get(key);
      const fac = await SlfFacility.findById(genId)
        .select("numberOfCell cellStatuses cellNames cellTypes cellCapacities cellFillValues cellCapacityUnits cellFillUnits volumeCapacityUnit wasteReceivedUnit")
        .lean();
      facilityCache.set(key, fac || null);
      return fac || null;
    };

    // Per-cell running total of volume assigned in THIS batch, so the combined
    // load is validated against remaining capacity (not each row in isolation).
    const cellPlanned = new Map(); // `${genId}:${cellIndex}` -> m³ already planned

    const placementVolumeM3 = (truck, vehicleIndex, baselineUnit) => {
      const src =
        Number.isInteger(vehicleIndex) && Array.isArray(truck?.vehicles) && truck.vehicles[vehicleIndex]
          ? truck.vehicles[vehicleIndex]
          : truck;
      const vol = Number(src?.actualVolume || 0);
      const unit = src?.actualVolumeUnit || truck?.actualVolumeUnit || baselineUnit || "m³";
      return toBaseM3(vol, unit);
    };

    const seenRowKeys = new Set();
    const results = [];
    // Track which docs receive at least one valid placement (for apply).
    const pendingByDoc = new Map(); // docId -> [{ truckIndex, vehicleIndex, cellIndex, cellName, cellType }]

    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i] || {};
      const rowKey = `${r._id || r.submissionId || r.idNo || i}|${r.truckIndex}|${r.vehicleIndex ?? "t"}`;
      const base = {
        row: i + 1,
        submissionId: r.submissionId || r.idNo || "",
        // Echoed back so the preview names the trip the way the operator's
        // paperwork does. Overwritten with the truck's real ticket once resolved.
        disposalTicketNo: String(r.disposalTicketNo || "").trim(),
        // Echoed so the preview shows what the file supplied for this trip.
        truckCapacity: Number(r.truckCapacity) > 0 ? Number(r.truckCapacity) : null,
        truckIndex: r.truckIndex,
        vehicleIndex: r.vehicleIndex ?? null,
        // Echo of the uploaded target. Once the facility is resolved further down
        // this is overwritten with the cell's LIVE name (see below), so validated
        // rows never report a stale label.
        targetCell: r.cellName || (r.cellIndex != null ? `Cell ${Number(r.cellIndex) + 1}` : ""),
      };

      // Duplicate row (same placement twice in the file).
      if (seenRowKeys.has(rowKey)) {
        results.push({ ...base, status: "invalid", code: "duplicate", message: "Duplicate placement in the file." });
        continue;
      }
      seenRowKeys.add(rowKey);

      const doc = resolveDoc(r);
      if (!doc) {
        results.push({ ...base, status: "invalid", code: "not_found", message: "Submission not found or not yours." });
        continue;
      }
      if (["reverted", "revert_requested", "rejected"].includes(String(doc.status))) {
        results.push({ ...base, status: "invalid", code: "locked", message: `Submission is ${doc.status} and cannot be organized.` });
        continue;
      }

      const truckIndex = Number(r.truckIndex);
      if (!Number.isInteger(truckIndex) || truckIndex < 0 || truckIndex >= (doc.trucks || []).length) {
        results.push({ ...base, status: "invalid", code: "bad_truck", message: "Invalid truck reference." });
        continue;
      }
      const truck = doc.trucks[truckIndex];
      const vehicleIndex =
        r.vehicleIndex === null || r.vehicleIndex === undefined || r.vehicleIndex === "" ? null : Number(r.vehicleIndex);
      if (vehicleIndex !== null && (!Number.isInteger(vehicleIndex) || vehicleIndex < 0 || vehicleIndex >= (truck.vehicles || []).length)) {
        results.push({ ...base, status: "invalid", code: "bad_vehicle", message: "Invalid vehicle reference." });
        continue;
      }

      // Submission Ticket No, when the row carries one, must match the ticket on
      // the truck the indices resolve to. The template ships it so the operator
      // can recognise the trip; validating it here is what stops a row that was
      // re-ordered, pasted or hand-edited from organizing a DIFFERENT trip than
      // the one the person was looking at.
      const claimedTicket = String(r.disposalTicketNo || "").trim();
      const actualTicket = String(truck?.disposalTicketNo || "").trim();
      if (actualTicket) base.disposalTicketNo = actualTicket;
      if (claimedTicket && actualTicket && claimedTicket.toLowerCase() !== actualTicket.toLowerCase()) {
        results.push({
          ...base,
          status: "invalid",
          code: "bad_ticket",
          message: `Submission Ticket No does not match this placement (expected ${actualTicket}).`,
        });
        continue;
      }

      const cellIndex =
        r.cellIndex === null || r.cellIndex === undefined || r.cellIndex === "" ? null : Number(r.cellIndex);
      if (cellIndex === null || !Number.isInteger(cellIndex) || cellIndex < 0) {
        results.push({ ...base, status: "invalid", code: "no_cell", message: "Missing or invalid target cell." });
        continue;
      }

      const facility = await getFacility(doc.slfGenerator);
      const vol = placementVolumeM3(truck, vehicleIndex, doc.baselineUnit);
      const cellKey = `${String(doc.slfGenerator)}:${cellIndex}`;
      const planned = cellPlanned.get(cellKey) || 0;
      // Validate the cell against LIVE state + already-planned volume in this batch.
      let acc = { ok: true, code: "available", reason: "", remaining: null, utilization: null };
      if (facility) {
        acc = evaluateFacilityCellAcceptance(facility, cellIndex, planned + vol, doc.baselineUnit || "m³");
      }
      // The facility's LIVE name wins over the snapshot stored on the row; the
      // snapshot is only a fallback for legacy rows with no usable cellIndex.
      const cellName = resolveCellName(facility?.cellNames, cellIndex, r.cellName);
      // The facility is known now — report the cell's current name for this row.
      base.targetCell = cellName;
      const cellType = r.cellType || facility?.cellTypes?.[cellIndex] || truck?.wasteType || "";

      if (!acc.ok) {
        const codeMap = { full: "capacity", insufficient: "capacity", nonoperational: "unavailable", missing: "unavailable" };
        results.push({
          ...base,
          targetCell: cellName,
          status: "invalid",
          code: codeMap[acc.code] || "unavailable",
          message: acc.reason,
          remaining: acc.remaining,
          utilization: acc.utilization,
        });
        continue;
      }

      // A historical trip can also be missing its Truck Capacity. The manual
      // organizer completes both in one save, so the bulk path must too —
      // otherwise a file could place every cell and leave the submitter still
      // blocked. Same validity rule as PATCH /:id/portal-cell-assignments.
      const rawCapacity = r.truckCapacity;
      const hasCapacity = rawCapacity !== null && rawCapacity !== undefined && rawCapacity !== "";
      const capacity = hasCapacity ? Number(rawCapacity) : null;
      if (hasCapacity && (!Number.isFinite(capacity) || capacity <= 0)) {
        results.push({
          ...base,
          status: "invalid",
          code: "bad_capacity",
          message: "Truck Capacity must be a number greater than 0.",
        });
        continue;
      }

      // Valid — reserve the volume and stage the write.
      cellPlanned.set(cellKey, planned + vol);
      const already = (truck.vehicles?.[vehicleIndex]?.cellName || truck.cellName) ? true : false;
      if (!pendingByDoc.has(String(doc._id))) pendingByDoc.set(String(doc._id), { doc, list: [] });
      pendingByDoc.get(String(doc._id)).list.push({
        truckIndex,
        vehicleIndex,
        cellIndex,
        cellName,
        cellType,
        capacity,
        capacityUnit: r.truckCapacityUnit || doc.baselineUnit || "",
      });
      results.push({
        ...base,
        targetCell: cellName,
        status: already ? "warning" : "valid",
        code: already ? "reassigned" : "ok",
        message: already ? "Reassigning an already-placed transaction." : "",
        remaining: acc.remaining,
        utilization: acc.utilization,
        volumeM3: Math.round(vol * 100) / 100,
      });
    }

    const invalidCount = results.filter((r) => r.status === "invalid").length;
    const validCount = results.filter((r) => r.status === "valid" || r.status === "warning").length;
    const summary = { total: results.length, valid: validCount, invalid: invalidCount, warning: results.filter((r) => r.status === "warning").length };

    if (dryRun) {
      return res.json({ preview: true, summary, rows: results });
    }

    // All-or-nothing unless partial is explicitly requested.
    if (invalidCount > 0 && !allowPartial) {
      return res.status(400).json({
        message: `${invalidCount} row(s) failed validation. No changes were applied.`,
        summary,
        rows: results,
      });
    }

    // Apply staged placements per document. cellName/cellType/cellIndex written to
    // the vehicle (and mirrored to the truck for vehicle 0) exactly like the single
    // endpoint, so downstream metrics/utilization recompute consistently.
    let appliedRows = 0;
    const touchedDocs = [];
    const touchedFacilityIds = new Set();
    for (const { doc, list } of pendingByDoc.values()) {
      list.forEach(({ truckIndex, vehicleIndex, cellIndex, cellName, cellType, capacity, capacityUnit }) => {
        const truck = doc.trucks[truckIndex];
        if (!truck) return;
        // Same rule as the manual organizer: reassigning an already-placed volume
        // MOVES it. Recorded here so bulk and manual leave identical state — the
        // volume is never added again, only its cell changes.
        const priorCellIndex = currentCellIndexOf(truck, vehicleIndex);
        if (priorCellIndex !== null && priorCellIndex !== cellIndex) {
          const priorSlot =
            Number.isInteger(vehicleIndex) && truck.vehicles?.[vehicleIndex]
              ? truck.vehicles[vehicleIndex]
              : truck;
          recordCellMovement(doc, {
            truckIndex,
            vehicleIndex: Number.isInteger(vehicleIndex) ? vehicleIndex : null,
            fromCellIndex: priorCellIndex,
            fromCellName: priorSlot?.cellName || "",
            fromCellType: priorSlot?.cellType || "",
            toCellIndex: cellIndex,
            toCellName: cellName,
            toCellType: cellType,
            volume: Number(priorSlot?.actualVolume ?? truck?.actualVolume ?? 0) || undefined,
            volumeUnit:
              priorSlot?.actualVolumeUnit || truck?.actualVolumeUnit || doc.baselineUnit || "",
            reason: "Portal user reorganized the waste placement (bulk upload).",
            actor: submittedBy,
            source: "portal_bulk",
          });
        }
        if (Number.isInteger(vehicleIndex) && Array.isArray(truck.vehicles) && truck.vehicles[vehicleIndex]) {
          truck.vehicles[vehicleIndex].cellIndex = cellIndex;
          truck.vehicles[vehicleIndex].cellName = cellName;
          truck.vehicles[vehicleIndex].cellType = cellType;
          if (vehicleIndex === 0) {
            truck.cellIndex = cellIndex;
            truck.cellName = cellName;
            truck.cellType = cellType;
          }
        } else {
          truck.cellIndex = cellIndex;
          truck.cellName = cellName;
          truck.cellType = cellType;
          if (Array.isArray(truck.vehicles)) {
            truck.vehicles.forEach((veh) => {
              veh.cellIndex = cellIndex;
              veh.cellName = cellName;
              veh.cellType = cellType;
            });
          }
        }
        // Truck Capacity completion, written to the same slot the cell went to —
        // identical to the manual organizer, so bulk and manual leave the same
        // database state (and a bulk-organized submission is no longer left
        // blocked by a capacity the file already supplied).
        if (capacity != null) {
          const unit = capacityUnit ? String(capacityUnit).trim().replace("m3", "m³") : null;
          if (Number.isInteger(vehicleIndex) && truck.vehicles?.[vehicleIndex]) {
            truck.vehicles[vehicleIndex].capacity = capacity;
            if (unit) truck.vehicles[vehicleIndex].capacityUnit = unit;
          } else {
            truck.truckCapacity = capacity;
            if (unit) truck.truckCapacityUnit = unit;
          }
        }
        appliedRows += 1;
      });
      doc.markModified("trucks");
      await doc.save();
      touchedDocs.push(doc);
      if (doc.slfGenerator) touchedFacilityIds.add(String(doc.slfGenerator));
    }
    for (const facilityId of touchedFacilityIds) {
      await refreshFacilityCellOccupancy(req, facilityId);
    }

    // Audit: one per-submission transaction + one batch record carrying the
    // idempotency key and the before/after context.
    try {
      const txns = touchedDocs.map((doc) => ({
        submissionId: doc.submissionId || doc.idNo,
        dataEntry: doc._id,
        companyName: doc.lguCompanyName,
        companyType: doc.companyType,
        submittedBy: doc.submittedBy || "",
        type: "cell_assignment",
        description: `Portal user bulk-organized waste placement for ${doc.idNo || doc.lguCompanyName}`,
        performedBy: submittedBy,
        meta: { idNo: doc.idNo, portal: true, bulk: true, batchId: batchId ? String(batchId) : undefined },
      }));
      txns.push({
        submissionId: `BULK-${batchId || Date.now()}`,
        companyName: "Bulk Cell Organization",
        submittedBy,
        type: "cell_assignment_bulk",
        description: `Portal user bulk-assigned ${appliedRows} placement(s) across ${touchedDocs.length} submission(s)`,
        performedBy: submittedBy,
        meta: { batchId: batchId ? String(batchId) : undefined, applied: appliedRows, submissions: touchedDocs.length, source: req.body?.source || "bulk" },
      });
      if (txns.length) await Transaction.insertMany(txns, { ordered: false });
    } catch { /* silent */ }

    writeLog("info", "organize_cells_bulk", {
      message: `Portal user bulk-organized ${appliedRows} placement(s) across ${touchedDocs.length} submission(s)`,
      user: submittedBy,
      ip: req.ip,
      meta: { batchId: batchId ? String(batchId) : undefined, applied: appliedRows, invalid: invalidCount, partial: allowPartial },
    });

    refreshAdmin(req, "submissions");
    refreshPortal(req, submittedBy, "submissions");
    res.json({ message: `Applied ${appliedRows} placement(s).`, applied: appliedRows, summary, rows: results, batchId: batchId ? String(batchId) : undefined });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update a submission (admin edit)
router.patch("/:id/admin-edit", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    const allowed = [
      "dateOfDisposal", "lguCompanyName", "companyType", "address",
      "companyRegion", "companyProvince", "companyMunicipality", "companyBarangay",
      "trucks", "accreditedHaulers", "slfGenerator", "slfName",
      // Cell Operations fields — exposed by the admin SLF Data Table edit modal but
      // previously omitted here, so a unit/status change made in the modal was
      // silently dropped by this controller. Now persisted (valid schema enums).
      "currentCellVolume", "currentCellVolumeUnit", "cellStatus",
      "baselineUnit", "totalVolumeAccepted", "totalVolumeAcceptedUnit",
      "activeCellResidualVolume", "activeCellResidualUnit",
      "activeCellInertVolume", "activeCellInertUnit",
      "activeCellHazardousVolume", "activeCellHazardousUnit",
      "closedCellResidualVolume", "closedCellResidualUnit",
      "closedCellInertVolume", "closedCellInertUnit",
      "closedCellHazardousVolume", "closedCellHazardousUnit",
      "activeCellEntries", "closedCellEntries",
      "acceptsHazardousWaste",
    ];
    const updatedFields = allowed.filter((key) => req.body[key] !== undefined);
    // Audit any unit-of-measurement change (previous → new, record, user, time).
    const UNIT_AUDIT_FIELDS = [
      "currentCellVolumeUnit", "baselineUnit", "totalVolumeAcceptedUnit",
      "activeCellResidualUnit", "activeCellInertUnit", "activeCellHazardousUnit",
      "closedCellResidualUnit", "closedCellInertUnit", "closedCellHazardousUnit",
    ];
    const unitChanges = [];
    for (const key of UNIT_AUDIT_FIELDS) {
      if (req.body[key] !== undefined) {
        const prev = strictNormalizeUnit(entry[key]);
        const next = strictNormalizeUnit(req.body[key]);
        if (next && prev !== next) unitChanges.push({ field: key, from: prev || entry[key] || "", to: next });
      }
    }
    applyEntryUpdates(entry, req.body, allowed, req, "submission.admin-edit");
    await entry.save();
    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "admin_edit",
        description: `Admin edited submission ${entry.idNo}`,
        performedBy: req.body.updatedBy || getRequestActor(req),
        meta: { idNo: entry.idNo, updatedFields, unitChanges: unitChanges.length ? unitChanges : undefined },
      });
    } catch { /* silent */ }
    // Dedicated unit-of-measurement audit entry (previous → new, record, user, time).
    if (unitChanges.length) {
      writeLog("info", "submission.unit.change", {
        message: `Unit change on ${entry.idNo}: ${unitChanges.map((c) => `${c.field} ${c.from || "—"}→${c.to}`).join(", ")}`,
        user: req.body.updatedBy || getRequestActor(req),
        ip: req.ip,
        meta: { id: String(entry._id), idNo: entry.idNo, unitChanges },
      });
    }
    res.json(populated);
    // Propagate the edit live — mirror the sibling status/edit handlers so other
    // admin tabs refresh and the affected portal user is notified (their history
    // refetches on the "notification" event). Without this the edit landed in the
    // DB but every other open view stayed stale until a manual reload.
    refreshAdmin(req, "submissions");
    if (entry.submittedBy) {
      notifyPortal(req, entry.submittedBy, {
        type: "submission_edited",
        title: "Submission Updated",
        message: `An admin updated submission ${entry.idNo}.`,
      });
    }
    writeLog("info", "submission.update", {
      message: `Submission ${entry.idNo} edited by admin`,
      user: req.body.updatedBy || getRequestActor(req),
      ip: req.ip,
      meta: { id: entry._id, idNo: entry.idNo },
    });
  } catch (error) {
    logSlfCrudError(req, "submission.admin-edit.error", error, { id: req.params.id });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update status (acknowledge/reject)
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body || {};
    const entry = await DataSLF.findByIdAndUpdate(
      req.params.id,
      { status },
      { returnDocument: "after" }
    ).populate("slfGenerator");
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    res.json(entry);

    // A status change decides whether this submission's volume counts at all —
    // only pending/acknowledged/revert_requested do (ACTIVE_VOLUME_STATUSES), so
    // reverting or rejecting must REMOVE the volume from the facility's occupancy
    // and re-approving must put it back. Fire-and-forget: the response is already
    // sent and the recompute is idempotent.
    refreshOccupancyForFacilities(req, [entry.slfGenerator?._id || entry.slfGenerator]).catch(() => {});

    if (status === "acknowledged") {
      markSubmissionNotificationsRead(entry).catch(() => {});
    }

    // Notify portal user of status change
    if (entry.submittedBy) {
      try {
        const UserPortal = require("../models/UserPortal");
        const portalUser = await UserPortal.findOne({ email: entry.submittedBy });
        if (portalUser) {
          await Notification.create({
            recipient: portalUser._id.toString(),
            type: "status_change",
            title: status === "acknowledged" ? "Submission Acknowledged" : "Submission Rejected",
            message: `Your submission ${entry.idNo} (${entry.lguCompanyName || ""}) has been ${status}`,
            submissionId: entry.submissionId,
            dataEntry: entry._id,
            meta: { idNo: entry.idNo, status, companyName: entry.lguCompanyName },
          });
        }
      } catch { /* silent */ }
      notifyPortal(req, entry.submittedBy, { type: "status_change", title: status === "acknowledged" ? "Submission Acknowledged" : "Submission Rejected" });
      // Dedicated data-refresh so the portal Submissions view live-updates the
      // status even if the notification path is missed.
      if (entry.submittedBy) refreshPortal(req, entry.submittedBy, "submissions");
    }
    refreshAdmin(req, "submissions");

    // Log status change transaction
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "status_change",
        description: `Entry ${entry.idNo} marked as ${status}`,
        performedBy: getRequestActor(req),
        meta: { status, idNo: entry.idNo },
      });
    } catch { /* silent */ }

    // Send acknowledgement email only when ALL entries in this submission are acknowledged
    if (status === "acknowledged" && entry.submittedBy && entry.submissionId) {
      try {
        const siblingEntries = await DataSLF.find({ submissionId: entry.submissionId });
        const allAcknowledged = siblingEntries.every((e) => e.status === "acknowledged");
        if (allAcknowledged) {
          await sendAcknowledgementEmail(entry.submittedBy, {
            submissionId: entry.submissionId,
            totalEntries: siblingEntries.length,
            entries: siblingEntries.map((e) => ({
              idNo: e.idNo,
              dateOfDisposal: e.dateOfDisposal,
              lguCompanyName: e.lguCompanyName,
              companyType: e.companyType,
              trucks: e.trucks,
            })),
          });
        }
      } catch (emailErr) {
        console.error("Acknowledge email failed:", emailErr.message);
      }
    }

    writeLog("info", "submission.status", {
      message: `Submission ${entry.idNo} ${status}`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { id: entry._id, status },
    });
  } catch (error) {
    logSlfCrudError(req, "submission.status.error", error, { id: req.params.id, status: req.body?.status });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk update status (acknowledge/reject multiple entries)
router.patch("/bulk-status", async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No entries selected" });
    }
    if (!["acknowledged", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    await DataSLF.updateMany({ _id: { $in: ids } }, { status });

    const updated = await DataSLF.find({ _id: { $in: ids } }).populate("slfGenerator");

    // Same rule as the single-status route: only pending/acknowledged/
    // revert_requested count toward occupancy, so a bulk revert/reject has to
    // release those volumes (and a bulk approve reinstate them).
    await refreshOccupancyForFacilities(
      req,
      updated.map((entry) => entry.slfGenerator?._id || entry.slfGenerator),
    );

    if (status === "acknowledged") {
      markSubmissionNotificationsRead(updated).catch(() => {});
    }

    // Log transactions
    for (const entry of updated) {
      try {
        await Transaction.create({
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          companyName: entry.lguCompanyName,
          companyType: entry.companyType,
          submittedBy: entry.submittedBy,
          type: "status_change",
          description: `Entry ${entry.idNo} marked as ${status} (bulk)`,
          performedBy: getRequestActor(req),
          meta: { status, idNo: entry.idNo, bulk: true },
        });
      } catch { /* silent */ }
    }

    // Send bulk acknowledge email grouped by submittedBy + submissionId (one email per submission)
    if (status === "acknowledged") {
      const bySubmission = {};
      for (const entry of updated) {
        if (!entry.submittedBy || !entry.submissionId) continue;
        const key = `${entry.submittedBy}::${entry.submissionId}`;
        if (!bySubmission[key]) bySubmission[key] = { email: entry.submittedBy, submissionId: entry.submissionId, entries: [] };
        bySubmission[key].entries.push(entry);
      }
      for (const { email, submissionId, entries } of Object.values(bySubmission)) {
        // Only send if all entries in this submission are now acknowledged
        const allInSubmission = await DataSLF.find({ submissionId });
        const allAcknowledged = allInSubmission.every((e) => e.status === "acknowledged");
        if (!allAcknowledged) continue;
        try {
          await sendBulkAcknowledgeEmail(email, {
            submissionId,
            totalEntries: allInSubmission.length,
            entries: allInSubmission.map((e) => ({
              idNo: e.idNo,
              dateOfDisposal: e.dateOfDisposal,
              lguCompanyName: e.lguCompanyName,
              companyType: e.companyType,
              trucks: e.trucks,
            })),
          });
        } catch (emailErr) {
          console.error("Bulk acknowledge email failed:", emailErr.message);
        }
      }
    }

    res.json({ message: `${updated.length} entries ${status}`, data: updated });
    writeLog("info", "submission.bulk-status", {
      message: `Bulk ${status}: ${updated.length} entries`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { status, count: updated.length, ids: updated.map((e) => e.idNo) },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk soft-delete selected submissions
router.post("/bulk-delete", async (req, res) => {
  try {
    const { ids, performedBy } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No entries selected" });
    }

    const entries = await DataSLF.find({ _id: { $in: ids }, deletedAt: null });
    for (const entry of entries) {
      entry.deletedAt = new Date();
      entry.deletedBy = performedBy || getRequestActor(req, "admin");
      await entry.save();
      try {
        await Transaction.create({
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          companyName: entry.lguCompanyName,
          companyType: entry.companyType,
          submittedBy: entry.submittedBy,
          type: "deleted",
          description: `Entry ${entry.idNo} deleted (bulk)`,
          performedBy: performedBy || getRequestActor(req, "admin"),
          meta: { idNo: entry.idNo, bulk: true },
        });
      } catch { /* silent */ }
    }

    // One recompute per DISTINCT facility, not per entry — a 50-row bulk delete
    // across 3 facilities costs 3 recomputes.
    await refreshOccupancyForFacilities(req, entries.map((entry) => entry.slfGenerator));

    refreshAdmin(req, "submissions");
    writeLog("warn", "submission.bulk-delete", {
      message: `Bulk deleted ${entries.length} submissions`,
      user: performedBy || getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { count: entries.length, ids: entries.map((entry) => entry.idNo) },
    });
    res.json({ message: `${entries.length} entries moved to trash`, data: entries });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Bulk admin revert selected submissions back to the portal user
router.patch("/bulk-revert", async (req, res) => {
  try {
    const { ids, reason, performedBy } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No entries selected" });
    }
    if (!reason?.trim()) {
      return res.status(400).json({ message: "Reason is required" });
    }

    const entries = await DataSLF.find({ _id: { $in: ids }, deletedAt: null });
    const updated = [];
    for (const entry of entries) {
      entry.status = "reverted";
      entry.revertReason = reason.trim();
      entry.revertedBy = performedBy || getRequestActor(req);
      entry.revertedAt = new Date();
      entry.revertRequested = false;
      await entry.save();
      updated.push(entry);

      try {
        await Transaction.create({
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          companyName: entry.lguCompanyName,
          companyType: entry.companyType,
          submittedBy: entry.submittedBy,
          type: "status_change",
          description: `Admin reverted submission ${entry.idNo} (bulk): ${reason.trim()}`,
          performedBy: performedBy || getRequestActor(req),
          meta: { idNo: entry.idNo, reason: reason.trim(), bulk: true },
        });
      } catch { /* silent */ }

      if (entry.submittedBy) {
        try {
          await Notification.create({
            recipient: entry.submittedBy,
            type: "reverted",
            title: "Submission Reverted",
            message: `Your submission ${entry.idNo} has been reverted. Reason: ${reason.trim()}`,
            submissionId: entry.submissionId,
            dataEntry: entry._id,
            meta: { idNo: entry.idNo, reason: reason.trim(), bulk: true },
          });
        } catch { /* silent */ }
        notifyPortal(req, entry.submittedBy, { type: "reverted", title: "Submission Reverted" });
        if (entry.submittedBy) refreshPortal(req, entry.submittedBy, "submissions");
      }
    }

    const populated = await DataSLF.find({ _id: { $in: updated.map((entry) => entry._id) } }).populate("slfGenerator");
    refreshAdmin(req, "submissions");
    writeLog("info", "submission.bulk-revert", {
      message: `Bulk reverted ${updated.length} submissions`,
      user: performedBy || getRequestActor(req),
      ip: req.ip,
      meta: { reason: reason.trim(), ids: updated.map((entry) => entry.idNo) },
    });
    res.json({ message: `${updated.length} entries reverted`, data: populated });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Repair XX province codes in existing idNo values
// Derives correct province from companyProvince (PSGC code) or companyType-scoped lookup
// Developer-only (matches repair-type-ids / merge-slf) — an admin must not be able
// to trigger a bulk ID rewrite, even via a direct API call.
router.post("/repair-xx-ids", authMiddleware, developerOnly, async (req, res) => {
  try {
    const PSGC_MAP = DataSLF.PSGC_PROVINCE_CODES || {};
    const SlfFacility = require("../models/SlfFacility");

    // Province name → abbreviation (same as DataSLF.js)
    const PROVINCE_NAME_MAP = {
      aurora: "AU", bataan: "BA", bulacan: "BU",
      "nueva ecija": "NE", nueva_ecija: "NE",
      pampanga: "PA", tarlac: "TA", zambales: "ZA",
    };
    const getProvCode = (name) => {
      if (!name) return null;
      const key = name.toLowerCase().replace(/^province of\s+/i, "").trim();
      return PROVINCE_NAME_MAP[key] || null;
    };

    const startedAt = Date.now();

    // Fetch only the fields the repair reads — never the full `trucks[]` payload.
    const xxDocs = await DataSLF.find(
      { idNo: /^SLF-\w+-XX-/ },
      "idNo slfGenerator slfName lguCompanyName companyType companyProvince dateOfDisposal submissionId submittedBy",
    )
      .setOptions({ includeHiddenYears: true })
      .lean();

    // Dry-run: compute proposed IDs and return them without persisting so the
    // admin can review the affected rows in a preview modal before confirming.
    const preview = req.body?.preview === true || req.query?.preview === "true";

    if (xxDocs.length === 0) {
      return res.json({ message: "No XX records found.", updated: 0, preview, changes: [] });
    }

    let updated = 0;
    const errors = [];
    const changes = [];
    const pending = [];
    const assignedIds = new Set();

    // Everything the per-doc loop used to query is prefetched in three batched
    // reads instead of two-to-three round-trips per document:
    //   1. the facilities referenced by these docs (was: findById per doc)
    //   2. a non-XX sibling ID per SLF        (was: findOne per doc)
    //   3. the max sequence per ID prefix     (was: a full find per new prefix)
    const facilityIds = [...new Set(xxDocs.map((d) => d.slfGenerator).filter(Boolean).map(String))];
    const slfNames = [...new Set(xxDocs.map((d) => d.slfName).filter(Boolean))];

    const [facilityDocs, siblingDocs, seedRows] = await Promise.all([
      facilityIds.length
        ? SlfFacility.find({ _id: { $in: facilityIds } }).select("province").lean()
        : [],
      // Non-XX siblings for every SLF referenced above — one query covers all of
      // them. Deliberately NOT sorted in the DB: `slfGenerator`/`slfName` aren't
      // indexed without a `deletedAt` prefix, so a server-side sort here would be
      // an unindexed blocking sort (32MB limit). The set is small and already
      // projected, so "newest wins" is resolved in memory below instead.
      facilityIds.length || slfNames.length
        ? DataSLF.find(
            {
              idNo: { $exists: true, $not: /XX/ },
              $or: [
                ...(facilityIds.length ? [{ slfGenerator: { $in: facilityIds } }] : []),
                ...(slfNames.length ? [{ slfName: { $in: slfNames } }] : []),
              ],
            },
            "idNo slfGenerator slfName createdAt",
          )
            .setOptions({ includeHiddenYears: true })
            .lean()
        : [],
      DataSLF.aggregate([
        { $match: { idNo: /^SLF-/ } },
        { $project: { parts: { $split: ["$idNo", "-"] } } },
        { $match: { "parts.3": { $exists: true } } },
        {
          $project: {
            key: {
              $concat: [{ $arrayElemAt: ["$parts", 1] }, "-", { $arrayElemAt: ["$parts", 2] }],
            },
            seq: {
              $convert: { input: { $arrayElemAt: ["$parts", 3] }, to: "int", onError: 0, onNull: 0 },
            },
          },
        },
        { $group: { _id: "$key", maxSeq: { $max: "$seq" } } },
      ]).option({ includeHiddenYears: true }),
    ]);

    const facilityById = new Map(facilityDocs.map((f) => [String(f._id), f]));
    const sequenceCache = new Map(seedRows.map((r) => [r._id, r.maxSeq || 0]));

    // Newest sibling per generator id / slfName (preserves the previous
    // `.sort({ createdAt: -1 }).findOne()` semantics, resolved in memory).
    const siblingByGenerator = new Map();
    const siblingByName = new Map();
    const wins = (incoming, current) =>
      !current || new Date(incoming?.createdAt || 0) > new Date(current?.createdAt || 0);
    for (const s of siblingDocs) {
      const gid = s.slfGenerator ? String(s.slfGenerator) : null;
      if (gid && wins(s, siblingByGenerator.get(gid))) siblingByGenerator.set(gid, s);
      if (s.slfName && wins(s, siblingByName.get(s.slfName))) siblingByName.set(s.slfName, s);
    }

    const nextIdNo = (typeCode, provCode) => {
      const key = `${typeCode}-${provCode}`;
      let seq = sequenceCache.get(key) || 0;
      let candidate;
      do {
        seq += 1;
        candidate = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
      } while (assignedIds.has(candidate));
      sequenceCache.set(key, seq);
      assignedIds.add(candidate);
      return candidate;
    };

    for (const doc of xxDocs) {
      try {
        let provCode = null;

        // 1. Try facility province
        if (doc.slfGenerator) {
          const facility = facilityById.get(String(doc.slfGenerator));
          if (facility?.province) provCode = getProvCode(facility.province);
        }

        // 2. Try companyProvince PSGC code
        if (!provCode && doc.companyProvince) {
          provCode = PSGC_MAP[doc.companyProvince] || null;
        }

        // 3. Try another approved doc for the same SLF
        if (!provCode) {
          const sibling =
            (doc.slfGenerator && siblingByGenerator.get(String(doc.slfGenerator))) ||
            (doc.slfName && siblingByName.get(doc.slfName)) ||
            null;
          if (sibling?.idNo) {
            const parts = sibling.idNo.split("-");
            if (parts.length >= 4 && parts[2] !== "XX") provCode = parts[2];
          }
        }

        if (!provCode) continue; // skip if still unknown

        const oldIdNo = doc.idNo;
        const parts = oldIdNo.split("-"); // ["SLF", typeCode, "XX", seq]
        if (parts.length < 4) continue;
        const typeCode = parts[1];
        const finalIdNo = nextIdNo(typeCode, provCode);

        changes.push({
          _id: doc._id,
          currentIdNo: oldIdNo,
          proposedIdNo: finalIdNo,
          slfName: doc.slfName || doc.lguCompanyName || "",
          lguCompanyName: doc.lguCompanyName || "",
          companyType: doc.companyType || "",
          dateOfDisposal: doc.dateOfDisposal || null,
        });

        if (!preview) pending.push({ doc, oldIdNo, finalIdNo });
      } catch (err) {
        errors.push({ id: doc._id, error: err.message });
      }
    }

    if (preview) {
      // Cap the payload so a very large mismatch set can't bloat the response /
      // freeze the modal. Confirm & Fix re-runs the full repair, so every record
      // is still fixed even when the preview list is truncated.
      const PREVIEW_LIMIT = 500;
      const truncated = changes.length > PREVIEW_LIMIT;
      const durationMs = Date.now() - startedAt;
      return res.json({
        preview: true,
        message: `${changes.length} of ${xxDocs.length} XX record(s) can be fixed.`,
        total: changes.length,
        truncated,
        durationMs,
        changes: truncated ? changes.slice(0, PREVIEW_LIMIT) : changes,
      });
    }

    if (pending.length) {
      // Same single-query collision check + bulk writes as repair-type-ids.
      const taken = new Set(
        (
          await DataSLF.find({ idNo: { $in: pending.map((p) => p.finalIdNo) } })
            .setOptions({ includeHiddenYears: true })
            .select("idNo")
            .lean()
        ).map((d) => d.idNo),
      );
      const safe = pending.filter((p) => !taken.has(p.finalIdNo));

      if (safe.length) {
        await DataSLF.bulkWrite(
          safe.map(({ doc, oldIdNo, finalIdNo }) => ({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: { idNo: finalIdNo, submissionId: doc.submissionId || doc._id.toString() },
                $addToSet: { previousIdNos: oldIdNo },
              },
            },
          })),
          { ordered: false },
        );

        await Transaction.bulkWrite(
          safe.map(({ doc, oldIdNo, finalIdNo }) => {
            const submissionId = doc.submissionId || doc._id.toString();
            return {
              updateMany: {
                filter: {
                  $or: [
                    { dataEntry: doc._id },
                    { submissionId: oldIdNo },
                    { submissionId: doc._id.toString() },
                    { "meta.idNo": oldIdNo },
                    { "meta.ids": oldIdNo },
                  ],
                },
                update: {
                  $set: { dataEntry: doc._id, submissionId, "meta.idNo": finalIdNo },
                  $addToSet: { "meta.previousIdNos": oldIdNo },
                },
              },
            };
          }),
          { ordered: false },
        );

        await Transaction.insertMany(
          safe.map(({ doc, oldIdNo, finalIdNo }) => ({
            submissionId: doc.submissionId || doc._id.toString(),
            dataEntry: doc._id,
            companyName: doc.lguCompanyName,
            companyType: doc.companyType,
            submittedBy: doc.submittedBy,
            type: "admin_edit",
            description: `Fixed province code ID from ${oldIdNo} to ${finalIdNo}`,
            performedBy: getRequestActor(req),
            meta: { idNo: finalIdNo, previousIdNo: oldIdNo, repairXX: true },
          })),
          { ordered: false },
        );
        updated = safe.length;
      }
    }

    const durationMs = Date.now() - startedAt;
    writeLog("warn", "id.repair-xx", {
      message: `Repaired ${updated} XX province code records in ${durationMs}ms`,
      user: getRequestActor(req),
      meta: { total: xxDocs.length, updated, errors: errors.length, durationMs },
    });

    res.json({
      message: `Repaired ${updated} of ${xxDocs.length} XX records.`,
      updated,
      skipped: xxDocs.length - updated - errors.length,
      errors,
      durationMs,
      changes,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Repair existing ID No. TYPE segment mismatches (PVT vs LGU).
// Developer-only. Uses the SLF facility OWNERSHIP together with province and the
// SLF name as a strict identity condition so records are only re-typed when the
// correct facility is confidently matched.
router.post("/repair-type-ids", authMiddleware, developerOnly, async (req, res) => {
  try {
    const typeCodeForCompanyType = (companyType) => {
      const value = String(companyType || "").trim().toLowerCase();
      if (value === "private" || value === "pvt") return "PVT";
      if (value === "lgu") return "LGU";
      return null;
    };
    // Derive the PVT/LGU type from a facility's ownership classification.
    const typeCodeForOwnership = (ownership) => {
      const o = String(ownership || "").toLowerCase();
      if (!o) return null;
      if (/private|pvt|corporat|company/.test(o)) return "PVT";
      if (/lgu|government|gov't|govt|public|municipal|city|provincial|barangay/.test(o))
        return "LGU";
      return null;
    };

    // Load all facilities once and index by normalized SLF name (latest year wins).
    const facilities = await SlfFacility.find({ deletedAt: null })
      .select("lgu province ownership dataYear")
      .lean();
    const facilityById = new Map();
    const facilityByName = new Map();
    facilities.forEach((f) => {
      facilityById.set(String(f._id), f);
      getNameVariants(f.lgu).forEach((variant) => {
        const key = normalizeSlfName(variant);
        if (!key) return;
        const prev = facilityByName.get(key);
        if (!prev || (f.dataYear || 0) > (prev.dataYear || 0))
          facilityByName.set(key, f);
      });
    });

    // Strictly resolve the facility for a submission using slfGenerator, then a
    // name match validated against the submission's province.
    const resolveFacility = (doc) => {
      if (doc.slfGenerator && facilityById.has(String(doc.slfGenerator)))
        return facilityById.get(String(doc.slfGenerator));
      const nameKeys = getNameVariants(doc.slfName).map(normalizeSlfName).filter(Boolean);
      for (const key of nameKeys) {
        const f = facilityByName.get(key);
        if (!f) continue;
        // Province must agree when both are known (strict condition).
        const docProv = doc.companyProvince
          ? getProvinceCode(doc.companyProvince)
          : null;
        const facProv = f.province ? getProvinceCode(f.province) : null;
        if (docProv && facProv && docProv !== facProv) continue;
        return f;
      }
      return null;
    };

    const startedAt = Date.now();

    // Only the fields the mismatch comparison actually reads. Without this
    // projection Mongo streams every full submission — including the `trucks[]`
    // array and its nested `vehicles[]` — which is what made this endpoint take
    // minutes. Two literal-prefix regexes (instead of one `^SLF-(PVT|LGU)-`
    // alternation) so each can use the `idNo` index bounds.
    const docs = await DataSLF.find(
      { $or: [{ idNo: /^SLF-PVT-/ }, { idNo: /^SLF-LGU-/ }] },
      "idNo slfGenerator slfName lguCompanyName companyType companyProvince dateOfDisposal submissionId submittedBy",
    )
      .setOptions({ includeHiddenYears: true })
      .lean();
    const fetchedAt = Date.now();

    // Dry-run preview support (see repair-xx-ids).
    const preview = req.body?.preview === true || req.query?.preview === "true";

    let updated = 0;
    let skipped = 0;
    const errors = [];
    const changes = [];

    // Seed the max sequence for EVERY `SLF-<TYPE>-<PROV>-` prefix in one
    // aggregation. Previously each new (type, province) pair triggered its own
    // `.find()` over all matching idNos; now the max is computed in the DB and
    // only ~14 small rows come back, so the whole sequence allocation below is
    // pure in-memory arithmetic.
    const seedRows = await DataSLF.aggregate([
      { $match: { idNo: /^SLF-/ } },
      { $project: { parts: { $split: ["$idNo", "-"] } } },
      { $match: { "parts.3": { $exists: true } } },
      {
        $project: {
          key: {
            $concat: [
              { $arrayElemAt: ["$parts", 1] },
              "-",
              { $arrayElemAt: ["$parts", 2] },
            ],
          },
          seq: {
            $convert: { input: { $arrayElemAt: ["$parts", 3] }, to: "int", onError: 0, onNull: 0 },
          },
        },
      },
      { $group: { _id: "$key", maxSeq: { $max: "$seq" } } },
    ]).option({ includeHiddenYears: true });

    const sequenceCache = new Map(seedRows.map((r) => [r._id, r.maxSeq || 0]));
    const assignedIds = new Set();

    // Fully in-memory: the seed above already read the current DB max for every
    // prefix, and `assignedIds` prevents collisions inside this run. The old
    // per-candidate `DataSLF.exists()` round-trip is gone; the persist path
    // re-checks every proposed ID against the DB in a single query instead.
    const nextIdNo = (typeCode, provCode) => {
      const key = `${typeCode}-${provCode}`;
      let seq = sequenceCache.get(key) || 0;
      let candidate;
      do {
        seq += 1;
        candidate = `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`;
      } while (assignedIds.has(candidate));
      sequenceCache.set(key, seq);
      assignedIds.add(candidate);
      return candidate;
    };

    // Single in-memory pass — no awaits inside the loop.
    const pending = [];
    for (const doc of docs) {
      const parts = String(doc.idNo).split("-");
      if (parts.length < 4 || parts[0] !== "SLF") continue;
      const currentType = parts[1];
      const provCode = parts[2];

      // Strict identity: require a confidently-matched facility (slfGenerator
      // or name+province) so we never re-type the wrong SLF's records.
      const facility = resolveFacility(doc);
      if (!facility) {
        skipped++;
        continue;
      }

      // The submission's companyType drives the type; fall back to the
      // facility ownership when companyType is missing/ambiguous.
      const desiredType =
        typeCodeForCompanyType(doc.companyType) ||
        typeCodeForOwnership(facility.ownership);
      if (!desiredType || desiredType === currentType) {
        if (!desiredType) skipped++;
        continue;
      }

      const oldIdNo = doc.idNo;
      const finalIdNo = nextIdNo(desiredType, provCode);

      changes.push({
        _id: doc._id,
        currentIdNo: oldIdNo,
        proposedIdNo: finalIdNo,
        slfName: doc.slfName || doc.lguCompanyName || "",
        lguCompanyName: doc.lguCompanyName || "",
        companyType: doc.companyType || "",
        dateOfDisposal: doc.dateOfDisposal || null,
        ownership: facility.ownership || "",
      });
      pending.push({ doc, oldIdNo, finalIdNo, currentType, desiredType, facility });
    }
    const analyzedAt = Date.now();

    if (preview) {
      // See repair-xx-ids: cap the preview payload; the confirmed fix re-runs
      // the full repair so all mismatches are still corrected.
      const PREVIEW_LIMIT = 500;
      const truncated = changes.length > PREVIEW_LIMIT;
      const durationMs = analyzedAt - startedAt;
      writeLog("info", "id.repair-type.preview", {
        message: `PVT/LGU mismatch analysis: ${changes.length} of ${docs.length} in ${durationMs}ms`,
        user: getRequestActor(req),
        meta: {
          scanned: docs.length,
          mismatches: changes.length,
          skipped,
          durationMs,
          fetchMs: fetchedAt - startedAt,
          analyzeMs: analyzedAt - fetchedAt,
        },
      });
      return res.json({
        preview: true,
        message: `${changes.length} PVT/LGU ID No. mismatch(es) can be fixed.${skipped ? ` ${skipped} skipped (SLF could not be strictly identified).` : ""}`,
        total: changes.length,
        truncated,
        skipped,
        durationMs,
        changes: truncated ? changes.slice(0, PREVIEW_LIMIT) : changes,
      });
    }

    if (pending.length) {
      // One query (not one per candidate) proves the proposed IDs are still free.
      // A collision can only happen if another writer allocated an ID after our
      // seed aggregation; those rows are skipped rather than silently clobbering
      // an existing submission's ID.
      const taken = new Set(
        (
          await DataSLF.find({ idNo: { $in: pending.map((p) => p.finalIdNo) } })
            .setOptions({ includeHiddenYears: true })
            .select("idNo")
            .lean()
        ).map((d) => d.idNo),
      );
      const safe = pending.filter((p) => !taken.has(p.finalIdNo));
      skipped += pending.length - safe.length;

      // Three bulk round-trips instead of three per document.
      if (safe.length) {
        await DataSLF.bulkWrite(
          safe.map(({ doc, oldIdNo, finalIdNo }) => ({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: { idNo: finalIdNo }, $addToSet: { previousIdNos: oldIdNo } },
            },
          })),
          { ordered: false },
        );

        await Transaction.bulkWrite(
          safe.map(({ doc, oldIdNo, finalIdNo }) => ({
            updateMany: {
              filter: {
                $or: [{ dataEntry: doc._id }, { "meta.idNo": oldIdNo }, { "meta.ids": oldIdNo }],
              },
              update: {
                $set: { "meta.idNo": finalIdNo },
                $addToSet: { "meta.previousIdNos": oldIdNo },
              },
            },
          })),
          { ordered: false },
        );

        await Transaction.insertMany(
          safe.map(({ doc, oldIdNo, finalIdNo, currentType, desiredType, facility }) => ({
            submissionId: doc.submissionId || doc._id.toString(),
            dataEntry: doc._id,
            companyName: doc.lguCompanyName,
            companyType: doc.companyType,
            submittedBy: doc.submittedBy,
            type: "admin_edit",
            description: `Fixed ID No. type from ${oldIdNo} to ${finalIdNo} (${currentType}→${desiredType}; ownership: ${facility.ownership || "n/a"})`,
            performedBy: getRequestActor(req),
            meta: { idNo: finalIdNo, previousIdNo: oldIdNo, repairType: true, ownership: facility.ownership || "" },
          })),
          { ordered: false },
        );
        updated = safe.length;
      }
    }

    const durationMs = Date.now() - startedAt;
    writeLog("warn", "id.repair-type", {
      message: `Repaired ${updated} ID No. type mismatches (PVT/LGU) in ${durationMs}ms`,
      user: getRequestActor(req),
      meta: { total: docs.length, updated, skipped, errors: errors.length, durationMs },
    });

    res.json({
      message: `Repaired ${updated} PVT/LGU ID No. mismatch(es).${skipped ? ` ${skipped} skipped (SLF could not be strictly identified by ownership/province/name).` : ""}`,
      updated,
      skipped,
      errors,
      durationMs,
      changes,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Delete entry
router.delete("/:id", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    // Log deletion transaction before removing
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "deleted",
        description: `Entry ${entry.idNo} deleted`,
        performedBy: getRequestActor(req),
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    entry.deletedAt = new Date();
    entry.deletedBy = getRequestActor(req, "admin");
    await entry.save();
    // Occupancy only counts non-deleted records, so trashing a submission must
    // release its volume from the cell it was placed in.
    await refreshOccupancyForFacilities(req, [entry.slfGenerator]);
    res.json({ message: "Entry moved to trash" });
    writeLog("warn", "submission.delete", { message: `Submission soft-deleted: ${req.params.id}`, user: getRequestActor(req, "admin"), ip: req.ip });
  } catch (error) {
    logSlfCrudError(req, "submission.delete.error", error, { id: req.params.id });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ── Deleted Submissions Management ──

// Get all soft-deleted submissions
router.get("/trash/list", async (req, res) => {
  try {
    const entries = await DataSLF.find({ deletedAt: { $ne: null } })
      .setOptions({ includeHiddenYears: true })
      .populate("slfGenerator", SLF_GENERATOR_REF_FIELDS)
      .sort({ deletedAt: -1 })
      .lean();
    res.json(applyResolvedCellNamesToAll(entries));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Restore a soft-deleted submission
router.patch("/:id/restore", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id).setOptions({ includeHiddenYears: true });
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.deletedAt) return res.status(400).json({ message: "Entry is not deleted" });
    entry.deletedAt = null;
    entry.deletedBy = null;
    await entry.save();
    // Restoring puts the volume back into play — the mirror of the soft delete.
    await refreshOccupancyForFacilities(req, [entry.slfGenerator]);
    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "status_change",
        description: `Entry ${entry.idNo} restored from trash`,
        performedBy: getRequestActor(req, "admin"),
      });
    } catch { /* silent */ }
    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.restore", { message: `Submission restored: ${entry.idNo}`, user: getRequestActor(req, "admin"), ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Permanently delete a submission
router.delete("/:id/permanent", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id).setOptions({ includeHiddenYears: true });
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.deletedAt) return res.status(400).json({ message: "Entry must be soft-deleted first" });
    await DataSLF.findByIdAndDelete(req.params.id).setOptions({ includeHiddenYears: true });
    // The sequence number is only released now — re-align the remaining IDs in
    // this prefix against the live collection (duplicates are repaired; gaps are
    // preserved as history). See realignIdNoSequence.
    const realigned = await realignIdNoSequence(entry.idNo);
    // The record is gone for good — release whatever volume it still held. (A
    // soft-deleted record was already excluded, so this is usually a no-op; it
    // matters when a record is purged without having been trashed first.)
    await refreshOccupancyForFacilities(req, [entry.slfGenerator]);
    res.json({
      message: "Entry permanently deleted",
      idNoRealigned: realigned.repaired,
    });
    if (realigned.repaired.length) {
      writeLog("warn", "submission.idno-realigned", {
        message: `Re-aligned ${realigned.repaired.length} duplicate ID No(s). after permanent delete of ${entry.idNo}`,
        user: getRequestActor(req, "admin"),
        ip: req.ip,
        meta: { prefix: realigned.prefix, changes: realigned.repaired },
      });
    }
    writeLog("warn", "submission.permanent-delete", { message: `Submission permanently deleted: ${entry.idNo}`, user: getRequestActor(req, "admin"), ip: req.ip });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Request revert (portal user requests edit on approved submission)
router.patch("/:id/request-revert", async (req, res) => {
  try {
    const { reason, requestedBy } = req.body || {};
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (entry.status !== "acknowledged") {
      return res.status(400).json({ message: "Only approved submissions can request a revert" });
    }

    entry.revertRequested = true;
    entry.revertReason = reason || "";
    entry.revertRequestedAt = new Date();
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "revert_requested",
        description: `Revert requested for ${entry.idNo}: ${reason || "No reason provided"}`,
        performedBy: requestedBy || entry.submittedBy || "portal",
        meta: { reason, idNo: entry.idNo },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.revert-request", {
      message: `Revert requested for ${entry.idNo}`,
      user: requestedBy || entry.submittedBy || "portal",
      ip: req.ip,
      meta: { id: entry._id, reason },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Admin-initiated revert (admin sends submission back to portal user for correction)
router.patch("/:id/admin-revert", async (req, res) => {
  try {
    const { reason, performedBy, sendFollowUp, followUpSubject, followUpMessage, temporaryDeleteAfterDays = 3 } = req.body || {};
    if (!reason) return res.status(400).json({ message: "Reason is required" });

    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    entry.status = "reverted";
    entry.revertReason = reason;
    entry.revertedBy = performedBy || getRequestActor(req);
    entry.revertedAt = new Date();
    if (sendFollowUp) {
      const days = Math.max(1, Number(temporaryDeleteAfterDays) || 3);
      entry.revertFollowUpSubject = followUpSubject || "Follow-Up Required: Reverted SLF Submission";
      entry.revertFollowUpMessage = followUpMessage || "Please update and resubmit your reverted SLF submission.";
      entry.revertFollowUpSentAt = new Date();
      entry.temporaryDeleteAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "status_change",
        description: `Admin reverted submission ${entry.idNo}: ${reason}`,
        performedBy: performedBy || getRequestActor(req),
        meta: { idNo: entry.idNo, reason },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);

    // Notify portal user of revert
    if (entry.submittedBy) {
      try {
        const UserPortal = require("../models/UserPortal");
        const portalUser = await UserPortal.findOne({ email: entry.submittedBy });
        if (portalUser) {
          await Notification.create({
            recipient: portalUser._id.toString(),
            type: "reverted",
            title: "Submission Reverted",
            message: `Your submission ${entry.idNo} (${entry.lguCompanyName || ""}) has been reverted. Reason: ${reason}`,
            submissionId: entry.submissionId,
            dataEntry: entry._id,
            meta: { idNo: entry.idNo, reason, companyName: entry.lguCompanyName },
          });
        }
      } catch { /* silent */ }
      notifyPortal(req, entry.submittedBy, { type: "reverted", title: "Submission Reverted" });
      if (entry.submittedBy) refreshPortal(req, entry.submittedBy, "submissions");
    }
    refreshAdmin(req, "submissions");

    // Send revert notification email to portal user
    if (entry.submittedBy) {
      try {
        await sendSubmissionEmail(entry.submittedBy, {
          subject: "Submission Reverted",
          message: `Your submission ${entry.idNo} (${entry.lguCompanyName || ""}) has been reverted by the administrator.\n\nReason: ${reason}\n\nPlease log in to the portal to review the entry, make necessary corrections, and resubmit.`,
          submissionId: entry.submissionId,
          companyName: entry.lguCompanyName,
        });
      } catch (emailErr) {
        writeLog("warn", "submission.revert-email-failed", {
          message: `Failed to send revert email to ${entry.submittedBy}`,
          meta: { id: entry._id, error: emailErr.message },
        });
      }
    }

    if (sendFollowUp && entry.submittedBy) {
      try {
        const deadline = entry.temporaryDeleteAfter ? entry.temporaryDeleteAfter.toLocaleDateString("en-US") : "the deadline";
        const templateData = {
          "{{idNo}}": entry.idNo || entry.submissionId || "your submission",
          "{{companyName}}": entry.lguCompanyName || "your facility",
          "{{reason}}": reason,
          "{{deadline}}": deadline,
        };
        const renderTemplate = (text = "") => Object.entries(templateData).reduce((output, [token, value]) => output.split(token).join(value), text);
        await sendSubmissionEmail(entry.submittedBy, {
          subject: renderTemplate(entry.revertFollowUpSubject),
          message: renderTemplate(entry.revertFollowUpMessage),
          submissionId: entry.submissionId || entry.idNo,
          companyName: entry.lguCompanyName,
        });
        await Notification.create({
          recipient: "admin",
          type: "submission_revert_followup",
          title: "Revert Follow-Up Sent",
          message: `Follow-up email sent to ${entry.submittedBy} for ${entry.idNo}.`,
          submissionId: entry.submissionId,
          dataEntry: entry._id,
          meta: { idNo: entry.idNo, submittedBy: entry.submittedBy, temporaryDeleteAfter: entry.temporaryDeleteAfter },
        });
        refreshAdmin(req, "notifications");
      } catch (emailErr) {
        writeLog("warn", "submission.revert-followup-email-failed", {
          message: `Failed to send revert follow-up email to ${entry.submittedBy}`,
          meta: { id: entry._id, error: emailErr.message },
        });
      }
    }

    writeLog("info", "submission.admin-revert", {
      message: `Admin reverted ${entry.idNo}: ${reason}`,
      user: performedBy || getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { id: entry._id, reason },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Approve revert (admin reverts submission to pending so portal user can edit)
router.patch("/:id/approve-revert", async (req, res) => {
  try {
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.revertRequested) {
      return res.status(400).json({ message: "No revert has been requested for this entry" });
    }

    entry.status = "pending";
    entry.revertRequested = false;
    entry.revertReason = "";
    entry.revertRequestedAt = undefined;
    await entry.save();

    try {
      await Transaction.create({
        submissionId: entry.submissionId,
        dataEntry: entry._id,
        companyName: entry.lguCompanyName,
        companyType: entry.companyType,
        submittedBy: entry.submittedBy,
        type: "revert_approved",
        description: `Revert approved for ${entry.idNo}, status set to pending`,
        performedBy: getRequestActor(req),
        meta: { idNo: entry.idNo },
      });
    } catch { /* silent */ }

    const populated = await DataSLF.findById(entry._id).populate("slfGenerator");
    res.json(populated);
    writeLog("info", "submission.revert-approved", {
      message: `Revert approved for ${entry.idNo}`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
      meta: { id: entry._id },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Send email to portal user regarding a submission
router.post("/:id/send-email", async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) {
      return res.status(400).json({ message: "Subject and message are required" });
    }
    const entry = await DataSLF.findById(req.params.id);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    if (!entry.submittedBy) {
      return res.status(400).json({ message: "No email address found for this submission" });
    }

    await sendSubmissionEmail(entry.submittedBy, {
      subject,
      message,
      submissionId: entry.submissionId || entry.idNo,
      companyName: entry.lguCompanyName,
    });

    // Log transaction
    await Transaction.create({
      submissionId: entry.submissionId,
      dataEntry: entry._id,
      companyName: entry.lguCompanyName,
      submittedBy: entry.submittedBy,
      type: "email_ack_sent",
      description: `Email sent to ${entry.submittedBy}: ${subject}`,
      performedBy: getRequestActor(req, "admin"),
      meta: { email: entry.submittedBy, subject },
    });

    writeLog("info", "submission.email-sent", {
      message: `Email sent to ${entry.submittedBy} for ${entry.idNo}: ${subject}`,
      user: getRequestActor(req, "admin"),
      ip: req.ip,
    });

    res.json({ message: "Email sent successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal user saves updated baseline data (after admin approval OR initial baseline save) — re-locks the record
router.patch("/portal-save-baseline/:slfName", optionalAuth, requirePortalRule("can_change_baseline_data"), async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName);
    const {
      submittedBy: claimedSubmittedBy,
      slfGenerator,
      lguCompanyName,
      companyType,
      address,
      companyRegion,
      companyProvince,
      companyMunicipality,
      companyBarangay,
      baselineUnit,
      totalVolumeAccepted, totalVolumeAcceptedUnit,
      activeCellResidualVolume, activeCellResidualUnit,
      activeCellInertVolume, activeCellInertUnit,
      activeCellHazardousVolume, activeCellHazardousUnit,
      closedCellResidualVolume, closedCellResidualUnit,
      closedCellInertVolume, closedCellInertUnit,
      closedCellHazardousVolume, closedCellHazardousUnit,
      activeCellEntries, closedCellEntries,
      accreditedHaulers,
      acceptsHazardousWaste,
    } = req.body || {};

    if (!slfName) return res.status(400).json({ message: "slfName is required" });
    // WHO is saving comes from the TOKEN, never from the body. A portal caller
    // cannot write baseline data as somebody else by naming them in `submittedBy`
    // — the body value is only trusted for admin/developer callers, who legitimately
    // act on a portal user's behalf and are gated by their own middleware.
    let submittedBy = claimedSubmittedBy;
    if (req.user?.role === "portal_user" && req.user.id) {
      const tokenAccount = await UserPortal.findById(req.user.id).select("email").lean();
      const tokenEmail = String(tokenAccount?.email || "").trim();
      if (tokenEmail) {
        if (
          claimedSubmittedBy &&
          String(claimedSubmittedBy).trim().toLowerCase() !== tokenEmail.toLowerCase()
        ) {
          writeLog("warn", "baseline.identity_rejected", {
            message: `Baseline save claimed a different submitter than the authenticated account`,
            user: tokenEmail,
            ip: req.ip,
            meta: { slfName, claimed: String(claimedSubmittedBy).trim() },
          });
        }
        submittedBy = tokenEmail;
      }
    }

    // The guard already loads `assignedSlf`; capture it for the ownership check
    // below rather than re-querying the account.
    const portalAccount = await ensurePortalAccountCanSubmit(submittedBy);

    let genId = slfGenerator || null;
    let facilityLgu = lguCompanyName || slfName;
    let facilityType = companyType || "LGU";
    // Held so the dummy-flag check below can reuse it instead of re-querying.
    let resolvedFacility = null;

    if (!genId) {
      const exactSlfName = new RegExp(`^${escapeRegExp(slfName)}$`, "i");
      const exactCompanyName = lguCompanyName
        ? new RegExp(`^${escapeRegExp(lguCompanyName)}$`, "i")
        : null;
      resolvedFacility = await SlfFacility.findOne({
        $or: [
          { lgu: exactSlfName },
          ...(exactCompanyName ? [{ lgu: exactCompanyName }] : []),
        ],
      }).sort({ dataYear: -1 });
      if (resolvedFacility) {
        genId = resolvedFacility._id;
        facilityLgu = lguCompanyName || resolvedFacility.lgu || slfName;
        facilityType = companyType || ((resolvedFacility.ownership || "").toLowerCase().includes("private") ? "Private" : "LGU");
      }
    }

    // These three reads are INDEPENDENT of one another, so they run together
    // instead of as three serial round-trips in the save path.
    //
    // The facility lookup is also skipped entirely when the block above already
    // loaded the document — that re-queried the same row purely to read
    // `isDummy`, which was already in memory.
    const [baselineOnlyIds, saveFacility, submitter] = await Promise.all([
      findMatchingBaselineOnlyIds({
        slfName,
        slfGenerator: genId,
        lguCompanyName,
      }),
      resolvedFacility
        ? Promise.resolve(resolvedFacility)
        // Also carries the cell configuration now: the entries below are bound to
        // it before they are written, and that costs nothing on a query already
        // being made for `isDummy`.
        : genId
          ? SlfFacility.findById(genId)
              .select("isDummy numberOfCell cellNames cellTypes cellStatuses cellCapacities")
              .lean()
          : Promise.resolve(null),
      submittedBy
        ? UserPortal.findOne({ email: String(submittedBy).trim().toLowerCase() })
            .select("isDummy")
            .lean()
        : Promise.resolve(null),
    ]);

    // Flag baseline records made by dummy accounts / against dummy facilities so
    // they stay out of production admin views (Task: dummy data isolation).
    // Same result as the previous short-circuit — the submitter is now resolved
    // in parallel rather than only when the facility check came back false.
    const baselineIsDummy = Boolean(saveFacility?.isDummy) || Boolean(submitter?.isDummy);

    // ── Server-side BASELINE LOCK enforcement ─────────────────────────────────
    //
    // Saving a baseline locks it; reopening it is an ADMIN action
    // (baseline-update-approve). Until now that rule lived only in the portal UI:
    // this route checked the caller's permission and their ownership of the SLF,
    // but never whether the baseline was locked — so the lock could be bypassed by
    // reloading, or by calling this endpoint directly, and a locked baseline could
    // be overwritten.
    //
    // The container is the authoritative record for baseline state (see the flag
    // resolution in GET /baseline/:slfName). Locked means: a container exists and
    // no container carries an admin approval.
    //
    // Scope: portal callers only. Admin/developer callers reach this route acting
    // on an operator's behalf and already own the approve/lock endpoints — gating
    // them here would take away the very controls that manage the lock.
    if (req.user?.role === "portal_user" && baselineOnlyIds.length) {
      const approvedCount = await DataSLF.countDocuments({
        _id: { $in: baselineOnlyIds },
        baselineUpdateApproved: true,
      }).setOptions({ includeHiddenYears: true });
      if (approvedCount === 0) {
        writeLog("warn", "baseline.locked_save_rejected", {
          message: "Portal user attempted to save a LOCKED baseline",
          user: submittedBy || "",
          ip: req.ip,
          meta: { slfName, slfGenerator: String(genId || "") },
        });
        return res.status(409).json({
          message:
            "This baseline is locked. Request a baseline update and wait for an administrator to approve it before saving changes.",
          locked: true,
        });
      }
    }

    // ── Ownership enforcement ──
    // A portal user may write baseline data ONLY for a facility they are assigned
    // to. `submitEntries` has always enforced this for disposal submissions, but
    // this route did not: the target facility comes from the request body, so a
    // crafted call (or a bulk baseline upload aimed at the wrong SLF) could
    // overwrite another operator's Total Volume Accepted, cell entries and
    // accredited haulers. Same rule and same shape as the submit path — skipped
    // only when the account has no assignment recorded (nothing to compare
    // against).
    if (genId && Array.isArray(portalAccount?.assignedSlf) && portalAccount.assignedSlf.length) {
      const assignedIds = portalAccount.assignedSlf.map((id) => String(id));
      if (!assignedIds.includes(String(genId))) {
        writeLog("warn", "baseline.ownership_rejected", {
          message: "Portal user attempted to save baseline data for a facility they are not assigned to",
          user: submittedBy || "",
          ip: req.ip,
          meta: { operation: "portal-save-baseline", slfGenerator: String(genId), slfName },
        });
        return res.status(403).json({
          message: "You can only update baseline data for the SLF facility assigned to your account.",
        });
      }
    }

    const updateFields = {
      slfName,
      ...(genId ? { slfGenerator: genId } : {}),
      isDummy: baselineIsDummy,
      baselineUpdateApproved: false,
      baselineUpdateRequested: false,
      baselineUpdateApprovedAt: null,
    };

    const fieldMap = {
      baselineUnit,
      lguCompanyName,
      companyType,
      address,
      companyRegion,
      companyProvince,
      companyMunicipality,
      companyBarangay,
      totalVolumeAccepted, totalVolumeAcceptedUnit,
      activeCellResidualVolume, activeCellResidualUnit,
      activeCellInertVolume, activeCellInertUnit,
      activeCellHazardousVolume, activeCellHazardousUnit,
      closedCellResidualVolume, closedCellResidualUnit,
      closedCellInertVolume, closedCellInertUnit,
      closedCellHazardousVolume, closedCellHazardousUnit,
      // Bind each row to the admin's authoritative cell BEFORE it is stored, so
      // the relationship is a stable cellIndex rather than a display name that an
      // admin rename would orphan. This is the source-side half of the fix; the
      // read path resolves the rows already in the database the same way.
      activeCellEntries: resolveBaselineCellEntries(activeCellEntries, saveFacility),
      closedCellEntries: resolveBaselineCellEntries(closedCellEntries, saveFacility),
      accreditedHaulers: accreditedHaulers
        ? sanitizeAccreditedHaulers(accreditedHaulers, baselineUnit || totalVolumeAcceptedUnit || "m³")
        : accreditedHaulers,
      acceptsHazardousWaste,
    };
    // Normalize enum-constrained unit fields so an unexpected unit string can't
    // trigger a Mongoose ValidationError (500) on the baseline-only doc create.
    const baselineFallbackUnit = normalizeVolumeUnit(baselineUnit || totalVolumeAcceptedUnit || "m³");
    ENTRY_UNIT_FIELDS.forEach((field) => {
      if (fieldMap[field]) fieldMap[field] = normalizeVolumeUnit(fieldMap[field], baselineFallbackUnit);
    });
    for (const [k, v] of Object.entries(fieldMap)) {
      if (v !== undefined) updateFields[k] = v;
    }

    // ── #2 Total Waste Volume data-loss guard (safe partial update) ─────────────
    // `totalVolumeAccepted` is a USER-ENTERED baseline figure — it is NOT recomputed
    // from cell entries (unlike the flat activeCell*/closedCell* volumes, which are
    // intentionally nullable via entry recomputation). So a null / empty / non-numeric
    // value arriving here means "this edit did not provide it", never "clear it".
    // Dropping it from $set preserves whatever is already stored, which is what
    // stops an UNRELATED baseline edit (haulers, cells, company info…) from blanking
    // a previously-saved Total Volume. A real number — including 0 — still updates,
    // and a numeric string ("1500") is coerced to a canonical Number so a string
    // never lands in a Number field.
    if ("totalVolumeAccepted" in updateFields) {
      const resolved = resolveTotalVolumeForUpdate(updateFields.totalVolumeAccepted);
      if (resolved.apply) {
        updateFields.totalVolumeAccepted = resolved.value; // canonical Number; 0 kept
      } else {
        const raw = updateFields.totalVolumeAccepted;
        delete updateFields.totalVolumeAccepted; // preserve the stored value
        writeLog("info", "baseline.total_volume.preserved", {
          message: `Preserved existing Total Volume Accepted for "${slfName}" — incoming value was empty/non-numeric on a partial baseline save`,
          user: submittedBy || slfName,
          meta: { slfName, incoming: raw === undefined ? "undefined" : String(raw) },
        });
      }
    }

    const updateResult = baselineOnlyIds.length > 0
      ? await DataSLF.updateMany({ _id: { $in: baselineOnlyIds } }, { $set: updateFields })
      : { matchedCount: 0 };

    // If no existing records exist for this SLF, create a baseline-only record
    if (updateResult.matchedCount === 0) {
      // The ID No. is left to the model's pre("save") hook. The hand-rolled
      // generator this replaces was wrong twice over:
      //   • it called getProvinceCode("") — a hardcoded EMPTY province — so every
      //     baseline-created record was stamped "XX" (SLF-PVT-XX-0001) instead of
      //     the facility's real province code.
      //   • its `findOne({ idNo })` ran WITHOUT `includeHiddenYears`, so the
      //     year-visibility plugin hid records outside the visible year and the
      //     "next" sequence could repeat one already in use.
      // The hook resolves the province from the linked facility, falls back to
      // companyProvince and then to a sibling record's code, and reads across all
      // years — which is exactly what "aligned to the current database" requires.
      const newDoc = new DataSLF({
        ...updateFields,
        slfGenerator: genId,
        slfName,
        lguCompanyName: facilityLgu,
        companyType: facilityType,
        address,
        companyRegion,
        companyProvince,
        companyMunicipality,
        companyBarangay,
        dateOfDisposal: new Date(),
        submittedBy: submittedBy || slfName,
        status: "pending",
      });
      await newDoc.save();
    }

    // Saving the baseline is the portal-side equivalent of "lock this SLF again".
    // GET /baseline resolves approval/request flags across every matching SLF
    // record, not only the baseline-only document updated above. If an older
    // submission still carried baselineUpdateApproved=true, the next refresh saw
    // that stale approval and reopened the just-saved baseline. Clear only the
    // workflow flags across the same identity set; baseline values themselves stay
    // scoped to baseline-only records.
    const lockIds = await resolveSlfRecordIds(slfName, { slfGenerator: genId });
    if (lockIds.length) {
      await DataSLF.updateMany(
        { _id: { $in: lockIds } },
        {
          $set: {
            baselineUpdateApproved: false,
            baselineUpdateRequested: false,
            baselineUpdateApprovedAt: null,
            baselineUpdateApprovedBy: null,
          },
        },
      );
    }

    const latest = baselineOnlyIds.length > 0
      ? await DataSLF.findOne({ _id: { $in: baselineOnlyIds } })
          .setOptions({ includeHiddenYears: true })
          .sort({ updatedAt: -1, createdAt: -1 })
      : await DataSLF.findOne({
          $and: [
            { $or: [{ trucks: { $exists: false } }, { trucks: { $size: 0 } }] },
            ...(genId && mongoose.Types.ObjectId.isValid(String(genId))
              ? [{ slfGenerator: genId }]
              : [{ slfName }]),
          ],
        })
          .setOptions({ includeHiddenYears: true })
          .sort({ updatedAt: -1, createdAt: -1 });

    // Log transaction
    await Transaction.create({
      dataEntry: latest?._id,
      submissionId: latest?.submissionId,
      companyName: slfName,
      submittedBy: submittedBy || slfName,
      type: "baseline_update",
      description: `Portal user saved updated baseline data for ${slfName}`,
      performedBy: submittedBy || slfName,
      meta: { slfName },
    });

    writeLog("info", "baseline.portal-save", {
      message: `Portal user saved baseline update for ${slfName}`,
      user: submittedBy || slfName,
      ip: req.ip,
    });

    try {
      await Notification.create({
        recipient: "admin",
        type: "baseline_update",
        title: "Baseline Data Updated",
        message: `${submittedBy || slfName} has saved updated baseline data for ${slfName}.`,
        submissionId: latest?.submissionId,
        dataEntry: latest?._id,
        meta: { slfName, submittedBy: submittedBy || slfName },
      });
    } catch { /* silent */ }

    // Notify admin of the update
    notifyAdmin(req, {
      type: "baseline_update",
      title: "Baseline Data Updated",
      message: `${submittedBy || slfName} has saved updated baseline data for ${slfName}.`,
    });
    refreshAdmin(req, "baselines");

    // Return the freshly-persisted baseline so the portal can reload from the
    // server's copy (not stale local form state) and reflect the save immediately.
    //
    // `locked` is READ BACK from the database rather than assumed from the fact
    // that the write returned 200 — it is the same rule GET /baseline resolves, so
    // the portal can trust it without waiting for the refetch, and a re-lock that
    // silently failed shows up as locked:false instead of a UI that only looks
    // locked until the next reload.
    const persistedApproval = await DataSLF.countDocuments({
      _id: { $in: lockIds.length ? lockIds : [latest?._id].filter(Boolean) },
      baselineUpdateApproved: true,
    }).setOptions({ includeHiddenYears: true });
    res.json({
      message: "Baseline saved and locked",
      data: latest || null,
      locked: Boolean(latest) && persistedApproval === 0,
      baselineUpdateApproved: persistedApproval > 0,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal user requests baseline field update — notifies admin
router.post("/baseline-update-request", optionalAuth, requirePortalRule("can_change_baseline_data"), async (req, res) => {
  try {
    const { slfName, requestedBy, fields, reason } = req.body || {};
    if (!slfName || !requestedBy) {
      return res.status(400).json({ message: "slfName and requestedBy are required" });
    }
    await ensurePortalAccountCanSubmit(requestedBy);

    // Upsert notification — update existing unread one instead of creating duplicates
    await Notification.findOneAndUpdate(
      { recipient: "admin", type: "baseline_update_request", "meta.slfName": slfName, read: false },
      {
        $set: {
          title: `Baseline Update Request — ${slfName}`,
          message: reason || `${requestedBy} is requesting to update baseline fields: ${(fields || []).join(", ")}`,
          meta: { slfName, requestedBy, fields, reason },
        },
        $setOnInsert: { recipient: "admin", type: "baseline_update_request" },
      },
      { upsert: true, returnDocument: "after", timestamps: true }
    );

    notifyAdmin(req, { type: "baseline_update_request", title: "Baseline Update Request", message: `${requestedBy} requested baseline update for ${slfName}` });
    refreshAdmin(req, "baselines");

    // Mark ALL baseline entries for this company as having a pending update request.
    // Match by name variants + merged BESLF aliases so legacy/merged data is covered.
    const requestIds = await resolveSlfRecordIds(slfName);
    const filter = requestIds.length
      ? { _id: { $in: requestIds } }
      : { $or: [{ slfName }, { lguCompanyName: slfName }] };
    await DataSLF.updateMany(filter, {
      $set: {
        baselineUpdateRequested: true,
        baselineUpdateRequestedAt: new Date(),
        baselineUpdateRequestReason: reason || "",
        baselineUpdateApproved: false,
      },
    });
    // Log transaction. Deliberately carries NO submissionId: the newest record
    // for an SLF is normally a disposal submission, and inheriting its id filed
    // every baseline request inside that submission's Transaction History.
    await Transaction.create({
      companyName: slfName,
      submittedBy: requestedBy,
      type: "baseline_update_request",
      description: `Baseline update request: ${(fields || []).join(", ")}`,
      performedBy: requestedBy,
      meta: { fields, reason },
    });

    writeLog("info", "baseline.update-request", {
      message: `Baseline update request from ${requestedBy} for ${slfName}`,
      ip: req.ip,
    });

    res.json({ message: "Request sent to admin" });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// The portal dashboard reads this summary in TWO shapes, and they must not be
// fetched as one.
//
// `accreditedHaulers` is deliberately DUPLICATED onto every one of an SLF's
// baseline documents, and the summary uses exactly ONE copy of it
// (`baselineHaulerSource`). Selecting it on every record therefore re-read the
// same hauler/vehicle/client graph once per submission: measured against live
// data it was 4.7 MB of a 5.3 MB response for Floridablanca (59 records) and
// 4.7 MB of 4.9 MB for Prime Waste Solution — ~90% pure duplication, and the
// single fetch every card below the dashboard's KPI row waits on.
//
// So: NO query below selects `accreditedHaulers` in bulk. The one record the
// summary reads them from is identified first by a cheap id-only pass, then
// fetched on its own (see resolveWasteSummaryHaulers).
const WASTE_SUMMARY_BASELINE_SELECT =
  "companyType companyRegion companyProvince companyMunicipality lguCompanyName " +
  "baselineUnit totalVolumeAccepted totalVolumeAcceptedUnit " +
  "activeCellEntries activeCellResidualVolume activeCellResidualUnit " +
  "activeCellInertVolume activeCellInertUnit activeCellHazardousVolume activeCellHazardousUnit " +
  "closedCellEntries closedCellResidualVolume closedCellResidualUnit " +
  "closedCellInertVolume closedCellInertUnit closedCellHazardousVolume closedCellHazardousUnit " +
  // Presence only — `chooseBaselineRecord` / `hasTruckVolume` need to tell a
  // container from a submission, not to read the transport entries.
  "trucks.actualVolume";

/**
 * The accredited-hauler list for a waste-received summary, read from exactly ONE
 * record.
 *
 * Two passes on purpose. Choosing the source needs the same tier order the
 * portal baseline read uses (container → no truck volume → any), which means
 * inspecting several records; but `accreditedHaulers` is the heavy field, so the
 * first pass carries only `_id` and `trucks.actualVolume` and the second reads
 * the winner's haulers alone. Both queries are small — the previous single query
 * pulled the same hauler graph once per submission.
 */
/**
 * The SLF's accredited haulers WITH their client rosters, unioned across every
 * record that carries them.
 *
 * ── Why this cannot pick a single record ────────────────────────────────────
 * An SLF's `accreditedHaulers` array is duplicated onto every one of its
 * documents, but the copies are NOT identical: `PATCH /portal-save-baseline`
 * writes the hauler list to its baseline container without the per-hauler
 * `clients` / `privateSectorClients` arrays, while the submissions carry the
 * full roster. Preferring the container — which is both the newest record and a
 * baseline-only one, so it won both tie-breaks — therefore returned haulers with
 * no clients at all. Measured on production: Prime Waste Solution's container
 * holds 141 haulers and 0 client rows while each of its 22 submissions holds the
 * same 141 haulers and 212 client rows, so the portal's Clients Served card
 * counted the fallback company alone and showed 1 instead of 158.
 *
 * The collapse to distinct (hauler, client) pairs happens in the DATABASE, and
 * the newest copy of each pair wins — the same rule and the same pipeline shape
 * the admin Hauler Clients view already uses, so the two can never disagree.
 * Output is proportional to the DISTINCT roster, not to how many times the array
 * has been copied.
 */
async function resolveWasteSummaryHaulers(match) {
  const grouped = await DataSLF.aggregate([
    { $match: { $and: [match, { "accreditedHaulers.0": { $exists: true } }] } },
    { $sort: { createdAt: -1 } },
    { $project: { accreditedHaulers: 1 } },
    { $unwind: "$accreditedHaulers" },
    {
      $project: {
        haulerName: "$accreditedHaulers.haulerName",
        officeAddress: "$accreditedHaulers.officeAddress",
        client: {
          $concatArrays: [
            { $ifNull: ["$accreditedHaulers.privateSectorClients", []] },
            { $ifNull: ["$accreditedHaulers.clients", []] },
          ],
        },
      },
    },
    { $unwind: "$client" },
    {
      $group: {
        _id: {
          hauler: { $toLower: { $trim: { input: { $ifNull: ["$haulerName", ""] } } } },
          client: {
            $toLower: {
              $trim: {
                input: {
                  $cond: [
                    { $eq: [{ $type: "$client" }, "string"] },
                    "$client",
                    { $ifNull: ["$client.clientName", ""] },
                  ],
                },
              },
            },
          },
        },
        haulerName: { $first: "$haulerName" },
        officeAddress: { $first: "$officeAddress" },
        client: { $first: "$client" },
      },
    },
    { $match: { "_id.client": { $ne: "" } } },
  ])
    .option({ includeHiddenYears: true })
    .allowDiskUse(true);

  // Re-shaped into the hauler form the caller already walks, one entry per
  // distinct (hauler, client) pair.
  return grouped.map((row) => ({
    haulerName: row.haulerName,
    officeAddress: row.officeAddress,
    clients: [row.client],
    privateSectorClients: [],
  }));
}

const WASTE_SUMMARY_SUBMISSION_SELECT =
  "companyType companyRegion companyProvince companyMunicipality lguCompanyName dateOfDisposal baselineUnit " +
  "trucks.actualVolume trucks.actualVolumeUnit trucks.selectedClients trucks.lguCompanyName trucks.companyType " +
  "trucks.vehicles.actualVolume trucks.vehicles.actualVolumeUnit trucks.vehicles.selectedClients " +
  "trucks.vehicles.lguCompanyName trucks.vehicles.companyType";

// Portal: Get waste received breakdown by baseline clients and submitted client selections.
// Region 3 Central Luzon: PSGC region code starts with "03".
// The Mini Dashboard summary. Expensive (3.5–8s on the larger facilities, where it
// walks every submission's trucks and splits volume across clients) and identical
// for every operator of the same SLF — this route reads no user context at all, so
// one computation legitimately serves them all. The key carries every parameter
// that changes the answer; freshness comes from refreshAdmin/refreshPortal busting
// the prefix on submission, baseline and facility writes (see staleKeysFor in
// utils/socketEmit.js), with the TTL as a bounded backstop.
const wasteReceivedCacheKey = (req) =>
  `${WASTE_RECEIVED_PREFIX}:${req.query.slfId || "-"}:${decodeURIComponent(req.params.slfName || "")}:${req.query.year || "all"}`;
router.get("/waste-received-summary/:slfName", cacheJson(wasteReceivedCacheKey, 120000), async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName);
    const { year, slfId } = req.query;
    const requestedNames = getNameVariants(slfName);
    const requestedRegexes = requestedNames.map((name) => new RegExp(`^${escapeRegExp(name)}$`, "i"));

    let facilities = [];
    let facilityIsDummy = false;
    if (slfId && mongoose.isValidObjectId(slfId)) {
      const selectedFacility = await SlfFacility.findOne({ _id: slfId, deletedAt: null })
        .select("_id lgu province isDummy cellNames")
        .lean();
      if (selectedFacility) {
        facilities = [selectedFacility];
        facilityIsDummy = Boolean(selectedFacility.isDummy);
      }
    }
    if (!facilities.length && requestedRegexes.length) {
      facilities = await SlfFacility.find({
        deletedAt: null,
        lgu: { $in: requestedRegexes },
      }).select("_id lgu province cellNames").lean();
    }
    if (!facilities.length && requestedRegexes.length) {
      facilities = await SlfFacility.find({
        deletedAt: null,
        province: { $in: requestedRegexes },
      }).select("_id lgu province cellNames").lean();
    }
    const facilityIds = facilities.map((facility) => facility._id);
    const facilityNameKeys = new Set(
      facilities
        .flatMap((facility) => getNameVariants(facility.lgu))
        .map((name) => normalizeSlfName(name))
        .filter(Boolean),
    );
    const selectedMunicipalityKeys = new Set(
      facilities
        .flatMap((facility) => getNameVariants(facility.lgu))
        .map((name) => normalizeSlfName(name))
        .filter(Boolean),
    );
    const identityNames = (slfId && facilities.length
      ? [
          ...facilities.flatMap((facility) => getNameVariants(facility.lgu)),
          ...requestedNames.filter((name) => facilityNameKeys.has(normalizeSlfName(name))),
        ]
      : [
          ...requestedNames,
          ...facilities.flatMap((facility) => getNameVariants(facility.lgu)),
        ]).filter(Boolean);
    const nameRegexes = [...new Set(identityNames)].map((name) => new RegExp(`^${escapeRegExp(name)}$`, "i"));

    const useFacilityIdMatch = Boolean(slfId && facilityIds.length);
    const match = {
      ...(useFacilityIdMatch
        ? { slfGenerator: { $in: facilityIds } }
        : {
            $or: [
              ...nameRegexes.map((regex) => ({ slfName: regex })),
              ...(facilityIds.length ? [{ slfGenerator: { $in: facilityIds } }] : []),
            ],
          }),
      deletedAt: null,
      // Waste Received counts only VALID submitted data: exclude rejected and
      // (still-invalid) reverted / revert-requested records. A resubmission updates
      // the same record in place (status → pending), so a corrected entry is counted
      // once and its earlier reverted state is never double-counted.
      status: { $nin: ["rejected", "reverted", "revert_requested"] },
      // Keep dummy and actual data strictly separated: a dummy facility's
      // dashboard shows only dummy submissions, and vice-versa.
      isDummy: facilityIsDummy ? true : { $ne: true },
    };
    if (!useFacilityIdMatch && match.$or.length === 0) {
      match.slfName = { $regex: new RegExp(`^${escapeRegExp(slfName)}`, "i") };
      delete match.$or;
    }
    if (year) {
      const y = Number(year);
      match.dateOfDisposal = { $gte: new Date(`${y}-01-01`), $lte: new Date(`${y}-12-31`) };
    }

    // Three reads, run together. See WASTE_SUMMARY_*_SELECT above for why the
    // baseline columns are not carried on the per-submission pass.
    //
    // The baseline candidates follow the SAME rule as GET /baseline/:slfName —
    // containers first, recency window as fallback — so the Baseline Breakdown
    // card and the Data Entry form can no longer disagree about which record the
    // SLF's baseline lives on.
    const [baselineContainers, baselineRecent, records, baselineHaulers] = await Promise.all([
      DataSLF.find({ $and: [match, BASELINE_ONLY_FILTER, baselineDataMatch] })
        .select(WASTE_SUMMARY_BASELINE_SELECT)
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(20)
        .maxTimeMS(20000)
        .lean(),
      DataSLF.find({ $and: [match, baselineDataMatch] })
        .select(WASTE_SUMMARY_BASELINE_SELECT)
        .sort({ createdAt: -1 })
        .limit(50)
        .maxTimeMS(20000)
        .lean(),
      DataSLF.find(match)
        .select(WASTE_SUMMARY_SUBMISSION_SELECT)
        .maxTimeMS(20000)
        .lean(),
      resolveWasteSummaryHaulers(match),
    ]);

    const summary = { lguR3: [], lguOutside: [], privateIndustry: [] };
    const baselineClientMap = new Map();
    const submissionClientMap = new Map();
    const baselineVolumeRows = [];
    const baselineTotals = { m3: 0, tons: 0 };

    const clientKey = (client) => [
      client.clientName || client.company || "—",
      client.clientType || client.companyType || "Private",
      client.region || client.companyRegion || "",
      client.province || client.companyProvince || "",
      client.municipality || "",
    ].join("|");
    const normalizeClient = (client, fallback = {}) => {
      if (!client) return null;
      if (typeof client === "string") {
        return {
          clientName: client,
          clientType: fallback.clientType || "Private",
          region: fallback.region || "",
          regionName: fallback.regionName || "",
          province: fallback.province || "",
          provinceName: fallback.provinceName || "",
          municipality: fallback.municipality || "",
          municipalityName: fallback.municipalityName || "",
        };
      }
      return {
        clientName: client.clientName || client.company || client.lguCompanyName || fallback.clientName || "—",
        clientType: client.clientType || client.companyType || fallback.clientType || "Private",
        region: client.region || client.companyRegion || fallback.region || "",
        regionName: client.regionName || client.companyRegionName || fallback.regionName || "",
        province: client.province || client.companyProvince || fallback.province || "",
        provinceName: client.provinceName || client.companyProvinceName || fallback.provinceName || "",
        municipality: client.municipality || client.companyMunicipality || fallback.municipality || "",
        municipalityName: client.municipalityName || client.companyMunicipalityName || fallback.municipalityName || "",
      };
    };
    const getClientMunicipalityKeys = (client = {}) => [
      client.municipalityName,
      /^\d+$/.test(String(client.municipality || "")) ? "" : client.municipality,
    ]
      .flatMap((value) => getNameVariants(value))
      .map((value) => normalizeSlfName(value))
      .filter(Boolean);
    const clientMatchesSelectedMunicipality = (client) => {
      if (!selectedMunicipalityKeys.size) return true;
      const keys = getClientMunicipalityKeys(client);
      if (!keys.length) return true;
      return keys.some((key) => selectedMunicipalityKeys.has(key));
    };
    const addClient = (map, client, volume = 0, unit = "m³", truckCount = 0, options = {}) => {
      const normalized = normalizeClient(client);
      if (!normalized?.clientName) return;
      if (options.filterMunicipality && !clientMatchesSelectedMunicipality(normalized)) return;
      const key = clientKey(normalized);
      if (!map.has(key)) {
        map.set(key, { ...normalized, totalM3: 0, totalTons: 0, entries: 0, truckCount: 0 });
      }
      const row = map.get(key);
      const normalizedUnit = String(unit || "m³").replace("m3", "m³");
      if (normalizedUnit === "tons") row.totalTons += Number(volume || 0);
      else row.totalM3 += Number(volume || 0);
      if (volume || truckCount) row.entries += 1;
      row.truckCount += truckCount;
    };
    const disposalRowsForTruck = (truck = {}, parent = {}) => {
      const vehicles = Array.isArray(truck.vehicles)
        ? truck.vehicles.filter((vehicle) => Number(vehicle?.actualVolume || 0) > 0)
        : [];
      if (vehicles.length) {
        return vehicles.map((vehicle) => ({
          volume: Number(vehicle.actualVolume || 0),
          unit: vehicle.actualVolumeUnit || truck.actualVolumeUnit || parent.baselineUnit || "m³",
          selectedClients: Array.isArray(vehicle.selectedClients) ? vehicle.selectedClients : [],
          fallbackClient: {
            clientName: vehicle.lguCompanyName || truck.lguCompanyName || parent.lguCompanyName || "—",
            clientType: vehicle.companyType || truck.companyType || parent.companyType || "Private",
            region: parent.companyRegion || "",
            province: parent.companyProvince || "",
            municipality: parent.companyMunicipality || "",
          },
        }));
      }
      return [{
        volume: Number(truck.actualVolume || 0),
        unit: truck.actualVolumeUnit || parent.baselineUnit || "m³",
        selectedClients: Array.isArray(truck.selectedClients) ? truck.selectedClients : [],
        fallbackClient: {
          clientName: truck.lguCompanyName || parent.lguCompanyName || "—",
          clientType: truck.companyType || parent.companyType || "Private",
          region: parent.companyRegion || "",
          province: parent.companyProvince || "",
          municipality: parent.companyMunicipality || "",
        },
      }];
    };

    const addBaselineVolume = (label, volume = 0, unit = "m³", wasteType = "Residual") => {
      const amount = Number(volume || 0);
      if (amount <= 0) return;
      const normalizedUnit = String(unit || "m³").replace("m3", "m³");
      const row = {
        clientName: label || "Baseline Utilization",
        clientType: "Baseline",
        wasteType,
        totalM3: normalizedUnit === "tons" ? 0 : amount,
        totalTons: normalizedUnit === "tons" ? amount : 0,
        entries: 1,
        truckCount: 0,
      };
      baselineVolumeRows.push(row);
      if (normalizedUnit === "tons") baselineTotals.tons += amount;
      else baselineTotals.m3 += amount;
    };

    // Live cell names for the facility this summary is scoped to. Baseline entries
    // store a name copied at save time; the labels below resolve through this so a
    // renamed cell shows its CURRENT name in the Baseline Breakdown.
    const facilityCellNames =
      facilities.find((f) => Array.isArray(f?.cellNames) && f.cellNames.length)?.cellNames || [];

    // No `.filter(hasBaselineData)` — both queries already carry
    // `baselineDataMatch`, so every row returned has baseline data by
    // construction. Re-testing it here would now be WRONG as well as redundant:
    // `accreditedHaulers` is no longer projected, so a record whose only baseline
    // data is its hauler list would fail the predicate and be discarded.
    const baselineRecords = orderBaselineCandidates(baselineContainers, baselineRecent);
    const baseline = chooseBaselineRecord(baselineRecords);

    baselineHaulers.forEach((hauler) => {
      const clients = [
        ...(Array.isArray(hauler.privateSectorClients) ? hauler.privateSectorClients : hauler.privateSectorClients ? [hauler.privateSectorClients] : []),
        ...(Array.isArray(hauler.clients) ? hauler.clients : []),
      ];
      clients.forEach((client) => addClient(baselineClientMap, client));
    });

    if (baseline?.activeCellEntries?.length) {
      baseline.activeCellEntries.forEach((entry, index) => {
        addBaselineVolume(
          // The facility's LIVE cell name, not the copy frozen when the baseline
          // was saved; falls back to the snapshot only for legacy index-less rows.
          resolveCellName(facilityCellNames, entry.cellIndex, entry.cellName) ||
            `Active Cell ${index + 1}`,
          entry.volume,
          entry.unit || baseline.baselineUnit || baseline.activeCellResidualUnit || "m³",
          entry.wasteType || "Residual",
        );
      });
    } else if (baseline) {
      [
        { label: "Active Cell - Residual", value: baseline.activeCellResidualVolume, unit: baseline.activeCellResidualUnit, wasteType: "Residual" },
        { label: "Active Cell - Inert", value: baseline.activeCellInertVolume, unit: baseline.activeCellInertUnit, wasteType: "Inert/Hazardous Waste" },
        { label: "Active Cell - Hazardous", value: baseline.activeCellHazardousVolume, unit: baseline.activeCellHazardousUnit, wasteType: "Hazardous Waste" },
      ].forEach((entry) => addBaselineVolume(entry.label, entry.value, entry.unit || baseline.baselineUnit || "m³", entry.wasteType));
    }

    for (const r of records) {
      const disposalRows = (r.trucks || [])
        .flatMap((truck) => disposalRowsForTruck(truck, r))
        .filter((row) => Number(row.volume || 0) > 0);
      if (!disposalRows.length) continue;
      const totalVol = disposalRows.reduce((sum, row) => sum + Number(row.volume || 0), 0);
      const isR3 = (r.companyRegion || "").startsWith("03");
      const item = {
        company: r.lguCompanyName || "—",
        region: r.companyRegion || "",
        totalVolume: totalVol,
        date: r.dateOfDisposal,
        entries: r.trucks?.length || 0,
      };
      if (r.companyType === "LGU") {
        if (isR3) summary.lguR3.push(item);
        else summary.lguOutside.push(item);
      } else {
        summary.privateIndustry.push(item);
      }

      disposalRows.forEach((row) => {
        const clients = row.selectedClients.length ? row.selectedClients : [row.fallbackClient];
        const splitVolume = Number(row.volume || 0) / Math.max(clients.length, 1);
        clients.forEach((client) => addClient(
          submissionClientMap,
          client,
          splitVolume,
          row.unit || r.baselineUnit || "m³",
          1 / Math.max(clients.length, 1),
          { filterMunicipality: true },
        ));
      });
    }

    // Aggregate duplicates per company
    const agg = (arr) => {
      const map = {};
      for (const i of arr) {
        if (!map[i.company]) map[i.company] = { company: i.company, region: i.region, totalVolume: 0, entries: 0 };
        map[i.company].totalVolume += i.totalVolume;
        map[i.company].entries += i.entries;
      }
      return Object.values(map).sort((a, b) => b.totalVolume - a.totalVolume);
    };

    const byClientVolume = (a, b) => (b.totalM3 + b.totalTons) - (a.totalM3 + a.totalTons);
    const baselineClients = Array.from(baselineClientMap.values()).sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)));
    const baselineRows = baselineClients.length ? [...baselineClients, ...baselineVolumeRows] : baselineVolumeRows;
    const submissionClients = Array.from(submissionClientMap.values()).sort(byClientVolume);

    res.json({
      lguR3: agg(summary.lguR3),
      lguOutside: agg(summary.lguOutside),
      privateIndustry: agg(summary.privateIndustry),
      baselineClients: baselineRows,
      baselineCellBreakdown: baselineVolumeRows,
      baselineTotals,
      submissionClients,
      clientBreakdown: submissionClients,
      totals: submissionClients.reduce((acc, row) => {
        acc.m3 += row.totalM3 || 0;
        acc.tons += row.totalTons || 0;
        acc.trucks += row.truckCount || 0;
        return acc;
      }, { m3: 0, tons: 0, trucks: 0 }),
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Distinct SLF names across submissions/baselines — powers the merge-tool
// pickers and other SLF selectors.
router.get("/slf-names", async (_req, res) => {
  try {
    const names = await DataSLF.distinct("slfName", {
      slfName: { $ne: null, $ne: "" },
    });
    res.json(names.filter(Boolean).sort((a, b) => a.localeCompare(b)));
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Developer-only: merge one or more source SLF names into a single canonical
// target SLF. All matching submissions AND baseline records are reassigned
// (slfName + slfGenerator), and portal-user facility assignment labels are
// updated. Pass { dryRun: true } to preview the affected count without writing.
router.post("/merge-slf", authMiddleware, developerOnly, async (req, res) => {
  try {
    const { sourceNames, targetName, targetFacilityId, dryRun } = req.body || {};
    const rawSources = Array.isArray(sourceNames) ? sourceNames : [sourceNames];
    const sources = [
      ...new Set(rawSources.map((s) => String(s || "").trim()).filter(Boolean)),
    ];
    const target = String(targetName || "").trim();
    if (!sources.length || !target) {
      return res.status(400).json({ message: "sourceNames and targetName are required." });
    }
    // Never merge a name into itself.
    const realSources = sources.filter((s) => s.toLowerCase() !== target.toLowerCase());
    if (!realSources.length) {
      return res.status(400).json({ message: "Source and target SLF are the same — nothing to merge." });
    }

    const nameFilter = {
      slfName: { $in: realSources.map((n) => new RegExp(`^${escapeRegExp(n)}$`, "i")) },
    };
    const affected = await DataSLF.countDocuments(nameFilter);

    if (dryRun) {
      return res.json({ dryRun: true, affected, sources: realSources, target });
    }

    // Resolve the target facility id (so reassigned records link to the kept
    // facility). Prefer an explicit id; otherwise reuse whatever the target's
    // existing records already point at.
    let facilityId = targetFacilityId || null;
    if (!facilityId) {
      const targetDoc = await DataSLF.findOne({
        slfName: new RegExp(`^${escapeRegExp(target)}$`, "i"),
        slfGenerator: { $ne: null },
      })
        .select("slfGenerator")
        .lean();
      facilityId = targetDoc?.slfGenerator || null;
    }

    const set = { slfName: target };
    if (facilityId) set.slfGenerator = facilityId;
    const result = await DataSLF.updateMany(nameFilter, { $set: set });

    // Re-label portal user facility assignments that used a source name.
    let portalUsersUpdated = 0;
    try {
      const puResult = await UserPortal.updateMany(
        { assignedSlfName: { $in: realSources } },
        { $set: { "assignedSlfName.$[elem]": target } },
        { arrayFilters: [{ elem: { $in: realSources } }] },
      );
      portalUsersUpdated = puResult.modifiedCount || 0;
    } catch { /* assignment re-label is best-effort */ }

    // Soft-delete the leftover source SlfFacility record(s). A facility's display
    // name is `${lgu}${ownership ? " (" + ownership + ")" : ""}`, so match the
    // source names against that computed name and never touch the kept target.
    let facilitiesArchived = 0;
    try {
      const buildDisplayName = (lgu, ownership) =>
        `${lgu || ""}${ownership ? " (" + ownership + ")" : ""}`.trim();
      const sourceSet = new Set(realSources.map((s) => s.toLowerCase()));
      // Narrow by lgu (source name minus any trailing "(...)") so we don't scan
      // the whole collection.
      const lguGuesses = realSources.map(
        (s) => new RegExp(`^${escapeRegExp(s.replace(/\s*\(.*?\)\s*$/, "").trim())}$`, "i"),
      );
      const candidates = await SlfFacility.find({
        deletedAt: null,
        lgu: { $in: lguGuesses },
      }).select("_id lgu ownership");
      const idsToArchive = candidates
        .filter(
          (f) =>
            String(f._id) !== String(facilityId) &&
            sourceSet.has(buildDisplayName(f.lgu, f.ownership).toLowerCase()),
        )
        .map((f) => f._id);
      if (idsToArchive.length) {
        const archiveRes = await SlfFacility.updateMany(
          { _id: { $in: idsToArchive } },
          { $set: { deletedAt: new Date(), deletedBy: req.user?.email || "merge-tool" } },
        );
        facilitiesArchived = archiveRes.modifiedCount || idsToArchive.length;
      }
    } catch { /* facility archive is best-effort — merge already succeeded */ }

    writeLog("warn", "slf.merge", {
      message: `Merged SLF [${realSources.join(", ")}] → "${target}" (${result.modifiedCount} records, ${facilitiesArchived} facility record(s) archived)`,
      user: req.user?.email || req.user?.id || "",
      ip: req.ip,
      meta: { sources: realSources, target, affected: result.modifiedCount, portalUsersUpdated, facilitiesArchived },
    });
    refreshAdmin(req, "submissions");
    refreshAdmin(req, "baselines");

    res.json({
      message: `Merged ${result.modifiedCount} record(s) into "${target}".`,
      affected: result.modifiedCount,
      portalUsersUpdated,
      facilitiesArchived,
      target,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
module.exports.submitEntries = submitEntries;
module.exports.sanitizeSubmissionEntry = sanitizeSubmissionEntry;
// Pure helpers exposed for tests/ so the duplicate-row and client-persistence
// rules can be exercised without a database connection.
module.exports.mergeAccreditedHaulerCopies = mergeAccreditedHaulerCopies;
module.exports.realignIdNoSequence = realignIdNoSequence;
module.exports.devWantsDummy = devWantsDummy;
module.exports.devWantsDummyOnly = devWantsDummyOnly;
module.exports.rejectUnauthorizedDummyAccess = rejectUnauthorizedDummyAccess;
module.exports.SUBMISSION_HAS_TRUCKS = SUBMISSION_HAS_TRUCKS;
module.exports.sanitizeClient = sanitizeClient;
module.exports.sanitizeAccreditedHaulers = sanitizeAccreditedHaulers;
// Portal baseline read — the candidate ordering and the field-source rule that
// decide what Data Entry hydrates from.
module.exports.orderBaselineCandidates = orderBaselineCandidates;
module.exports.makeBaselineFieldReader = makeBaselineFieldReader;
module.exports.chooseBaselineRecord = chooseBaselineRecord;
module.exports.isBaselineOnlyRecord = isBaselineOnlyRecord;
module.exports.BASELINE_ONLY_FILTER = BASELINE_ONLY_FILTER;
// Exposed for testing: the hauler/client roster union behind the portal's
// Clients Served card.
module.exports.resolveWasteSummaryHaulers = resolveWasteSummaryHaulers;
