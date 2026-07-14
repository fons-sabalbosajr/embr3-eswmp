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
const { notifyAdmin, notifyPortal, refreshAdmin } = require("../utils/socketEmit");
const { isBataanSlfName } = require("../utils/mergeBataanSlf");
const { authMiddleware, requireAnyAuth, developerOnly } = require("../middleware/auth");
const { NON_DUMMY_CLAUSE } = require("../utils/dummyFilter");
const { validateWasteGeneration } = require("../utils/wasteGenerationValidation");
// Named to avoid colliding with this file's own `normalizeVolumeUnit`, which is a
// lenient SANITIZER for Excel-imported free text (it always yields a unit). These
// are the strict shared helpers: they return "" / null rather than guessing.
const {
  normalizeUnit: strictNormalizeUnit,
  convertVolume: convertVolumeStrict,
} = require("../utils/volumeUnits");
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

// Only developers may opt into seeing dummy/sample submissions inline.
function devWantsDummy(req) {
  return req.user?.role === "developer" &&
    String(req.query.includeDummy || "").toLowerCase() === "true";
}

// Fields to project when populating a submission's `slfGenerator` ref.
//
// Un-projected, `.populate("slfGenerator")` inlines the ENTIRE SlfFacility
// document (galleryItems, slfDocuments, permit arrays, every cell array) into
// each submission. On a list endpoint that means the same handful of facilities
// is serialized once per submission — it was 2.4 MB of a 2.6 MB response and the
// same duplication in browser memory. Consumers only read the id/name/province
// off the populated ref; the full facility list comes from /slf-facilities.
// `cellNames` is included because it is the CANONICAL source of a cell's display
// name — collectCellNames() resolves cellIndex against it rather than trusting the
// name copied onto the submission at submit time (which goes stale on rename).
// It is a short string array, so it costs almost nothing.
const SLF_GENERATOR_REF_FIELDS = "_id lgu slfName province dataYear cellNames";

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

// Like matchesBaselineName, but also treats the Bataan Engineered Sanitary
// Landfill Facility (BESLF) aliases as one identity. The BESLF site was merged
// from several legacy names ("Bataan Integrated Waste Management Facility", etc.)
// whose records may still carry an old lguCompanyName/slfName alias. Without this
// a baseline update requested under one alias would silently miss records saved
// under another, so the update would appear to "not work". See mergeBataanSlf.js.
function matchesSlfIdentity(item, requestedName) {
  if (matchesBaselineName(item, requestedName)) return true;
  if (isBataanSlfName(requestedName)) {
    return isBataanSlfName(item?.slfName) || isBataanSlfName(item?.lguCompanyName);
  }
  return false;
}

// Resolve every DataSLF _id that belongs to an SLF, matching by name variants and
// (for BESLF) merged legacy aliases. Used by the baseline update/approve/reject
// routes so merged/legacy data never breaks a baseline update. Optionally restrict
// to records that actually carry baseline data.
async function resolveSlfRecordIds(slfName, { requireBaselineData = false, slfGenerator = null } = {}) {
  const variants = getNameVariants(slfName);
  if (variants.length === 0 && !slfGenerator) return [];

  const orClauses = [];
  variants.forEach((name) => {
    // Prefix match so a paren-suffixed canonical name (e.g. "… (BESLF) (Private)")
    // is still caught by its paren-stripped variant.
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

  const candidates = await DataSLF.find({ $or: orClauses })
    .setOptions({ includeHiddenYears: true })
    .select("_id slfName lguCompanyName slfGenerator totalVolumeAccepted activeCellResidualVolume activeCellInertVolume activeCellHazardousVolume closedCellResidualVolume closedCellInertVolume closedCellHazardousVolume activeCellEntries closedCellEntries accreditedHaulers")
    .lean();

  const matched = candidates.filter((item) => {
    if (slfGenerator && String(item.slfGenerator || "") === String(slfGenerator)) return true;
    return matchesSlfIdentity(item, slfName);
  });
  const finalMatched = requireBaselineData ? matched.filter(hasBaselineData) : matched;
  return [...new Set(finalMatched.map((item) => String(item._id)).filter(Boolean))];
}

async function softDeleteOverdueReverted(req) {
  const dueEntries = await DataSLF.find({
    deletedAt: null,
    status: "reverted",
    temporaryDeleteAfter: { $lte: new Date() },
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

function hasTruckVolume(entry) {
  return (entry?.trucks || []).some((truck) => Number(truck?.actualVolume || 0) > 0);
}

function chooseBaselineRecord(entries = []) {
  return entries.find((entry) => !hasTruckVolume(entry)) || entries[0] || null;
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

// Collect the distinct cell names a submission's waste was placed into. The list
// query already selects trucks.cellName / trucks.vehicles.cellName, so this adds
// the assigned-cell labels to the admin list without shipping full trucks.
// Resolve the CURRENT display name of a cell.
//
// A submission stores both `cellIndex` (the canonical relationship to the
// facility's cell infrastructure) and `cellName` (a copy of the label as it read
// at submit time). Rendering the copy is what made renamed cells show stale names
// forever, so the index wins whenever we have it and the facility's live
// `cellNames` array is the source of truth.
//
// Legacy rows that only ever stored a name (no cellIndex) keep working: they fall
// back to the stored copy, so historical relationships stay intact.
function resolveCellName(facilityCellNames, cellIndex, storedName) {
  // NB: Number(null) === 0, so a legacy row with cellIndex: null would otherwise
  // resolve to cell 0 and report a different cell's name. Reject empties first.
  const hasIndex = cellIndex !== null && cellIndex !== undefined && cellIndex !== "";
  const idx = hasIndex ? Number(cellIndex) : NaN;
  if (Number.isInteger(idx) && idx >= 0) {
    const current = facilityCellNames?.[idx];
    if (current) return String(current).trim();
    return `Cell ${idx + 1}`; // facility declares no custom name for this cell
  }
  return storedName ? String(storedName).trim() : "";
}

function collectCellNames(entry) {
  const trucks = Array.isArray(entry?.trucks) ? entry.trucks : [];
  // slfGenerator is populated with `cellNames` (see SLF_GENERATOR_REF_FIELDS), so
  // this is a lookup against already-loaded data — no per-cell query, no N+1.
  const facilityCellNames = entry?.slfGenerator?.cellNames;
  const names = new Set();
  for (const truck of trucks) {
    const name = resolveCellName(facilityCellNames, truck?.cellIndex, truck?.cellName);
    if (name) names.add(name);
    for (const vehicle of Array.isArray(truck?.vehicles) ? truck.vehicles : []) {
      const vName = resolveCellName(facilityCellNames, vehicle?.cellIndex, vehicle?.cellName);
      if (vName) names.add(vName);
    }
  }
  return [...names].filter(Boolean);
}

// Compute admin-review "remarks" for a submission from existing fields (never
// stored — always derived so they can't go stale). Covers truck-capacity and
// cell-placement attention flags. Cell near-full/full are cell-level and require
// facility fill data, so they are surfaced in the Cell Waste Placement view.
const TON_PER_M3 = 0.2;
function toComparableVolume(value, fromUnit, toUnit) {
  const num = Number(value || 0);
  const from = normalizeUnit(fromUnit || "m³");
  const to = normalizeUnit(toUnit || from);
  if (!num || from === to) return num;
  if (from === "tons" && to === "m³") return num / TON_PER_M3;
  if (from === "m³" && to === "tons") return num * TON_PER_M3;
  return num;
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
// the save never fails with an enum ValidationError.
const TRUCK_WASTE_TYPE_ENUM = ["Residual", "Hazardous Waste", "Treated Hazardous Waste"];
function normalizeTruckWasteType(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined; // schema allows undefined; empty string would fail enum
  if (TRUCK_WASTE_TYPE_ENUM.includes(raw)) return raw;
  const low = raw.toLowerCase();
  if (low.includes("treated")) return "Treated Hazardous Waste";
  if (low.includes("haz") || low.includes("inert")) return "Hazardous Waste";
  if (low.includes("residual")) return "Residual";
  return "Residual";
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

function sanitizeClient(client) {
  if (typeof client === "string") {
    return {
      clientName: client.trim(),
      clientType: "Private",
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
    region: String(client.region || "").trim(),
    regionName: String(client.regionName || "").trim(),
    province: String(client.province || "").trim(),
    provinceName: String(client.provinceName || "").trim(),
    municipality: String(client.municipality || "").trim(),
    municipalityName: String(client.municipalityName || "").trim(),
  };
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
  const portalUser = await UserPortal.findOne({ email: normalizedEmail }).select("verificationRequired verificationSubmitted status isDummy");
  if (!portalUser) return null;
  if (portalUser.status !== "approved") {
    const error = new Error("Your portal account is not approved for submissions.");
    error.statusCode = 403;
    throw error;
  }
  if (portalUser.verificationRequired) {
    const error = new Error("Your account is on hold for verification. Please complete the verification process before using the portal.");
    error.statusCode = 403;
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
    throw error;
  }
}

async function submitEntries({ entries, submittedBy, req } = {}) {
  const portalAccount = await ensurePortalAccountCanSubmit(submittedBy);
  await assertNoUnresolvedRevert(submittedBy);
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

  // ── Waste Generation Information: every field required for FINAL submission ──
  // This is the AUTHORITATIVE gate. The Portal runs the same rules to highlight the
  // offending fields before uploading, but that is a convenience — a request that
  // reaches here with an incomplete truck (notably a missing/zero Truck Capacity)
  // is rejected outright, so a submission can never be partially finalized.
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

  const submissionId = `SUB-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

  const genCache = new Map();
  const facilityDummyCache = new Map();
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

    const doc = new DataSLF({
      ...item,
      slfGenerator: genId,
      submissionId,
      submittedBy: submittedBy || item.submittedBy || "",
      isDummy: submitterIsDummy || facilityIsDummy,
      dummyPortalUserId: submitterIsDummy ? portalAccount?._id : undefined,
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
router.post("/", async (req, res) => {
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
    const { saved } = await submitEntries({ entries: items, submittedBy, req });
    res.status(201).json({ message: "Data submitted successfully", data: saved });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        message: error.message,
        // Field-specific Waste Generation feedback (tab / truckIndex / field), so
        // the Portal can point at the exact input instead of failing silently.
        ...(error.validationIssues ? { validationIssues: error.validationIssues } : {}),
      });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update & resubmit a reverted entry (portal user)
router.put("/:id", async (req, res) => {
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
    for (const field of allowedFields) {
      if (sanitizedBody[field] !== undefined) entry[field] = sanitizedBody[field];
    }
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

    let candidates = await DataSLF.find({
      $and: [{ $or: nameOrFilters }, baselineDataMatch],
    })
      .setOptions({ includeHiddenYears: true })
      .sort({ createdAt: -1 })
      .lean();

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

    if (!latest) {
      candidates = await DataSLF.find(baselineDataMatch)
        .setOptions({ includeHiddenYears: true })
        .sort({ createdAt: -1 })
        .lean();
      matchedCandidates = candidates.filter((item) => {
        if (slfObjectId && String(item.slfGenerator || "") === String(slfObjectId))
          return true;
        return matchesBaselineName(item, slfName);
      });
      latest = chooseBaselineRecord(matchedCandidates);
    }

    if (!latest) return res.json(null);

    const baselineUnit = latest.baselineUnit || latest.totalVolumeAcceptedUnit || "m³";
    const haulerSource =
      matchedCandidates.find((item) => item?.accreditedHaulers?.length > 0 && !hasTruckVolume(item)) ||
      matchedCandidates.find((item) => item?.accreditedHaulers?.length > 0) ||
      latest;

    res.json({
      baselineUnit,
      lguCompanyName: latest.lguCompanyName,
      companyType: latest.companyType,
      address: latest.address,
      companyRegion: latest.companyRegion,
      companyProvince: latest.companyProvince,
      companyMunicipality: latest.companyMunicipality,
      companyBarangay: latest.companyBarangay,
      totalVolumeAccepted: latest.totalVolumeAccepted,
      totalVolumeAcceptedUnit: latest.totalVolumeAcceptedUnit || baselineUnit,
      activeCellResidualVolume: latest.activeCellResidualVolume,
      activeCellResidualUnit: latest.activeCellResidualUnit || baselineUnit,
      activeCellInertVolume: latest.activeCellInertVolume,
      activeCellInertUnit: latest.activeCellInertUnit || baselineUnit,
      activeCellHazardousVolume: latest.activeCellHazardousVolume,
      activeCellHazardousUnit: latest.activeCellHazardousUnit || baselineUnit,
      closedCellResidualVolume: latest.closedCellResidualVolume,
      closedCellResidualUnit: latest.closedCellResidualUnit || baselineUnit,
      closedCellInertVolume: latest.closedCellInertVolume,
      closedCellInertUnit: latest.closedCellInertUnit || baselineUnit,
      closedCellHazardousVolume: latest.closedCellHazardousVolume,
      closedCellHazardousUnit: latest.closedCellHazardousUnit || baselineUnit,
      acceptsHazardousWaste: latest.acceptsHazardousWaste || false,
      activeCellEntries: latest.activeCellEntries || [],
      closedCellEntries: latest.closedCellEntries || [],
      accreditedHaulers: haulerSource.accreditedHaulers || [],
      baselineUpdateApproved: latest.baselineUpdateApproved || false,
      baselineUpdateRequested: latest.baselineUpdateRequested || false,
      savedAt: latest.updatedAt || latest.createdAt,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get latest baseline info for ALL SLF generators — admin tab
router.get("/baselines", optionalAuth, async (req, res) => {
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
      if (req.body[f] !== undefined) entry[f] = req.body[f];
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

    const latest = ids.length
      ? await DataSLF.findOne(filter).setOptions({ includeHiddenYears: true }).sort({ createdAt: -1 })
      : null;
    if (!latest) return res.status(404).json({ message: "Baseline not found" });

    // Notify the portal user
    try {
      await Notification.create({
        recipient: latest.submittedBy,
        type: "baseline_update_approved",
        title: "Baseline Update Approved",
        message: `Your baseline update request for ${slfName} has been approved. You may now update your baseline data.`,
        meta: { slfName },
      });
    } catch { /* silent */ }
    notifyPortal(req, latest.submittedBy, { type: "baseline_update_approved", title: "Baseline Update Approved" });

    // Log transaction
    try {
      await Transaction.create({
        submissionId: latest.submissionId,
        dataEntry: latest._id,
        companyName: slfName,
        submittedBy: latest.submittedBy,
        type: "baseline_update_approved",
        description: `Admin approved baseline update request for ${slfName}`,
        performedBy: approvedBy || getRequestActor(req),
        meta: { slfName },
      });
    } catch { /* silent */ }

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

    // Notify the portal user in real time
    if (latest?.submittedBy) {
      try {
        await Notification.create({
          recipient: latest.submittedBy,
          type: "baseline_locked",
          title: "Baseline Locked",
          message: `Your baseline data for ${slfName} has been locked by an admin.`,
          meta: { slfName },
        });
      } catch { /* silent */ }
      notifyPortal(req, latest.submittedBy, { type: "baseline_locked", title: "Baseline Locked" });
    }

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

    // Notify the portal user
    try {
      await Notification.create({
        recipient: latest.submittedBy,
        type: "baseline_update_rejected",
        title: "Baseline Update Request Rejected",
        message: `Your baseline update request for ${slfName} has been rejected.${reason ? " Reason: " + reason : ""}`,
        meta: { slfName, reason },
      });
    } catch { /* silent */ }
    notifyPortal(req, latest.submittedBy, { type: "baseline_update_rejected", title: "Baseline Update Rejected" });

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

// Dashboard stats
router.get("/stats", async (req, res) => {
  try {
    // Exclude dummy/test entries from all production dashboard tiles. Developers
    // may opt in via ?includeDummy=true (requires a developer token).
    const match = devWantsDummy(req) ? { deletedAt: null } : { deletedAt: null, ...NON_DUMMY_CLAUSE };
    const [submissions, generators, totalTrucks, byStatus, byCompanyType, wasteByType, monthlyData] =
      await Promise.all([
        DataSLF.countDocuments(match),
        SLFGenerator.countDocuments(),
        DataSLF.aggregate([
          { $match: match },
          { $project: { count: { $size: { $ifNull: ["$trucks", []] } } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ]),
        DataSLF.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
        DataSLF.aggregate([{ $match: match }, { $group: { _id: "$companyType", count: { $sum: 1 } } }]),
        DataSLF.aggregate([
          { $match: match },
          { $unwind: "$trucks" },
          {
            $group: {
              _id: "$trucks.wasteType",
              totalVolume: { $sum: { $ifNull: ["$trucks.actualVolume", 0] } },
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
              totalVolume: {
                $sum: {
                  $reduce: {
                    input: { $ifNull: ["$trucks", []] },
                    initialValue: 0,
                    in: { $add: ["$$value", { $ifNull: ["$$this.actualVolume", 0] }] },
                  },
                },
              },
            },
          },
          { $sort: { "_id.year": 1, "_id.month": 1 } },
          { $limit: 12 },
        ]),
      ]);

    const statusMap = {};
    byStatus.forEach((s) => (statusMap[s._id] = s.count));

    const companyMap = {};
    byCompanyType.forEach((c) => (companyMap[c._id] = c.count));

    const recentSubmissions = await DataSLF.find(match)
      .sort({ createdAt: -1 })
      .limit(5)
      .select("idNo lguCompanyName companyType status createdAt trucks");

    res.json({
      submissions,
      generators,
      totalTrucks: totalTrucks[0]?.total || 0,
      byStatus: statusMap,
      byCompanyType: companyMap,
      wasteByType,
      monthlyData,
      recentSubmissions,
    });
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
router.get("/summary-by-slf", async (req, res) => {
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
          _id: { $ifNull: ["$slfName", "Unassigned SLF"] },
          slfGenerator: { $first: "$slfGenerator" },
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
      { $sort: { _id: 1 } },
    ]);
    res.json(
      rows.map((row) => ({
        key: row._id,
        slfName: row._id,
        slfGenerator: row.slfGenerator || null,
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
      })),
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get all SLF data entries (admin) — excludes soft-deleted
router.get("/", optionalAuth, async (req, res) => {
  try {
    // Admin management view — respects App Settings year visibility filter
    const listMode = req.query.mode === "list";
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 100);
    const paginated = listMode && limit > 0;
    const filter = { deletedAt: null };
    // Exclude dummy/test (SAMPLE) submissions from production admin views.
    // Only developers may opt into seeing them inline via ?includeDummy=true.
    if (!devWantsDummy(req)) {
      filter.isDummy = { $ne: true };
    }
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim();
    const includeTrucks = String(req.query.includeTrucks || "").toLowerCase() === "true";
    const withTruckVolume = String(req.query.withTruckVolume || "").toLowerCase() === "true";

    if (listMode && status && status !== "all") {
      filter.status = status;
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
      const placementFilter = String(req.query.cellPlacement || "all").trim();
      // Batch key mirrors the client's getPortalSubmissionGroupKey: group only
      // when submittedBy (an email), company, and a non-reverted status exist;
      // everything else stays a standalone row keyed by its _id.
      const rowKeyExpr = {
        $let: {
          vars: {
            sb: { $toLower: { $trim: { input: { $ifNull: ["$submittedBy", ""] } } } },
            co: { $toLower: { $trim: { input: { $ifNull: ["$lguCompanyName", ""] } } } },
            st: { $toLower: { $trim: { input: { $ifNull: ["$status", ""] } } } },
          },
          in: {
            $cond: [
              {
                $and: [
                  { $ne: ["$$sb", ""] },
                  { $ne: ["$$co", ""] },
                  { $ne: [{ $indexOfBytes: ["$$sb", "@"] }, -1] },
                  { $ne: ["$$st", "reverted"] },
                ],
              },
              { $concat: ["$$sb", "::", "$$co", "::", "$$st"] },
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
            count: { $sum: 1 },
            gPlaced: { $sum: "$_placed" },
            gTotal: { $sum: "$_etotal" },
            gKnown: { $max: "$_known" },
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
      pipeline.push({ $sort: { sortDate: -1 } });
      pipeline.push({
        $facet: {
          page: [{ $skip: skip }, { $limit: limit }],
          meta: [{ $count: "total" }],
        },
      });

      const aggRes = await DataSLF.aggregate(pipeline).allowDiskUse(true);
      const facet = aggRes[0] || {};
      const pageGroups = facet.page || [];
      const total = facet.meta?.[0]?.total || 0;

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

      const enrich = (entry) => ({
        ...entry,
        truckCount: entry.truckCount ?? (Array.isArray(entry.trucks) ? entry.trucks.length : 0),
        cellPlacement: computeCellPlacementSummary(entry),
        cellNames: collectCellNames(entry),
        remarks: computeSubmissionRemarks(entry, allowancePct),
        trucks: includeTrucks ? entry.trucks : [],
      });
      // Return the RAW entries for this page's groups (every group is returned
      // whole, so no batch is split across pages). The admin table regroups them
      // client-side exactly as before — keeping all existing grouped-row actions
      // intact — while `total` (group count) drives server-side pagination.
      const rows = [];
      pageGroups.forEach((g) => {
        (g.entryIds || [])
          .map((id) => byId.get(String(id)))
          .filter(Boolean)
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .forEach((e) => rows.push(enrich(e)));
      });

      return res.json({ data: rows, total, page, limit });
    }

    let query = DataSLF.find(filter)
      .populate("slfGenerator", SLF_GENERATOR_REF_FIELDS)
      .sort({ createdAt: -1 });
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
        data: entries.map((entry) => ({
          ...entry,
          truckCount: entry.truckCount ?? (Array.isArray(entry.trucks) ? entry.trucks.length : 0),
          cellPlacement: computeCellPlacementSummary(entry),
          cellNames: collectCellNames(entry),
          remarks: computeSubmissionRemarks(entry, allowancePct),
          trucks: includeTrucks ? entry.trucks : [],
        })),
        total,
        page,
        limit,
      });
      return;
    }
    res.json(
      listMode && !includeTrucks
        ? entries.map((entry) => ({
            ...entry,
            cellPlacement: computeCellPlacementSummary(entry),
            cellNames: collectCellNames(entry),
            remarks: computeSubmissionRemarks(entry, allowancePct),
            trucks: [],
          }))
        : entries
    );
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

// Admin: assign submitted truck volumes to specific active SLF cells.
router.patch("/:id/cell-assignments", async (req, res) => {
  try {
    const entry = await DataSLF.findOne({ _id: req.params.id, deletedAt: null });
    if (!entry) return res.status(404).json({ message: "Entry not found" });

    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
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
    entry.markModified("trucks");
    await entry.save();

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

    // Validate selected cells against the SLF facility (cell must exist / be
    // within the facility's configured cell count when the facility is known).
    let facility = null;
    if (entry.slfGenerator) {
      facility = await SlfFacility.findById(entry.slfGenerator).select("numberOfCell cellStatuses lgu").lean();
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

    list.forEach((assignment) => {
      const truckIndex = Number(assignment.truckIndex);
      if (!Number.isInteger(truckIndex) || truckIndex < 0 || truckIndex >= entry.trucks.length) return;
      const truck = entry.trucks[truckIndex];
      const cellIndex =
        assignment.cellIndex === null || assignment.cellIndex === undefined || assignment.cellIndex === ""
          ? undefined
          : Number(assignment.cellIndex);
      if (cellIndex !== undefined && (!Number.isInteger(cellIndex) || cellIndex < 0)) return;
      const cellName = cellIndex === undefined ? "" : (assignment.cellName || `Cell ${cellIndex + 1}`);
      const cellType = assignment.cellType || "";
      const vehicleIndex =
        assignment.vehicleIndex === null || assignment.vehicleIndex === undefined
          ? null
          : Number(assignment.vehicleIndex);
      if (
        Number.isInteger(vehicleIndex) &&
        Array.isArray(truck.vehicles) &&
        vehicleIndex >= 0 &&
        vehicleIndex < truck.vehicles.length
      ) {
        truck.vehicles[vehicleIndex].cellIndex = cellIndex;
        truck.vehicles[vehicleIndex].cellName = cellName;
        truck.vehicles[vehicleIndex].cellType = cellType;
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
      if (Array.isArray(truck.vehicles)) {
        truck.vehicles.forEach((veh) => {
          veh.cellIndex = cellIndex;
          veh.cellName = cellName;
          veh.cellType = cellType;
        });
      }
    });
    entry.markModified("trucks");
    await entry.save();

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
    res.json({ message: "Cell placement saved", data: entry });
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
    for (const key of allowed) {
      if (req.body[key] !== undefined) entry[key] = req.body[key];
    }
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
        meta: { idNo: entry.idNo, updatedFields },
      });
    } catch { /* silent */ }
    res.json(populated);
    writeLog("info", "submission.update", {
      message: `Submission ${entry.idNo} edited by admin`,
      user: req.body.updatedBy || getRequestActor(req),
      ip: req.ip,
      meta: { id: entry._id, idNo: entry.idNo },
    });
  } catch (error) {
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
    res.json({ message: "Entry moved to trash" });
    writeLog("warn", "submission.delete", { message: `Submission soft-deleted: ${req.params.id}`, user: getRequestActor(req, "admin"), ip: req.ip });
  } catch (error) {
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
      .sort({ deletedAt: -1 });
    res.json(entries);
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
    res.json({ message: "Entry permanently deleted" });
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
router.patch("/portal-save-baseline/:slfName", async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName);
    const {
      submittedBy,
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
    await ensurePortalAccountCanSubmit(submittedBy);

    let genId = slfGenerator || null;
    let facilityLgu = lguCompanyName || slfName;
    let facilityType = companyType || "LGU";

    if (!genId) {
      const exactSlfName = new RegExp(`^${escapeRegExp(slfName)}$`, "i");
      const exactCompanyName = lguCompanyName
        ? new RegExp(`^${escapeRegExp(lguCompanyName)}$`, "i")
        : null;
      const facility = await SlfFacility.findOne({
        $or: [
          { lgu: exactSlfName },
          ...(exactCompanyName ? [{ lgu: exactCompanyName }] : []),
        ],
      }).sort({ dataYear: -1 });
      if (facility) {
        genId = facility._id;
        facilityLgu = lguCompanyName || facility.lgu || slfName;
        facilityType = companyType || ((facility.ownership || "").toLowerCase().includes("private") ? "Private" : "LGU");
      }
    }

    const baselineOnlyIds = await findMatchingBaselineOnlyIds({
      slfName,
      slfGenerator: genId,
      lguCompanyName,
    });

    // Flag baseline records made by dummy accounts / against dummy facilities so
    // they stay out of production admin views (Task: dummy data isolation).
    let baselineIsDummy = false;
    if (genId) {
      const facDummy = await SlfFacility.findById(genId).select("isDummy").lean();
      baselineIsDummy = Boolean(facDummy?.isDummy);
    }
    if (!baselineIsDummy && submittedBy) {
      const submitter = await UserPortal.findOne({ email: String(submittedBy).trim().toLowerCase() }).select("isDummy").lean();
      baselineIsDummy = Boolean(submitter?.isDummy);
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
      activeCellEntries, closedCellEntries,
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

    const updateResult = baselineOnlyIds.length > 0
      ? await DataSLF.updateMany({ _id: { $in: baselineOnlyIds } }, { $set: updateFields })
      : { matchedCount: 0 };

    // If no existing records exist for this SLF, create a baseline-only record
    if (updateResult.matchedCount === 0) {
      const provCode = getProvinceCode("");
      const typeCode = facilityType === "Private" ? "PVT" : "LGU";
      const pattern = new RegExp(`^SLF-${typeCode}-${provCode}-`);
      const lastDoc = await DataSLF.findOne({ idNo: pattern }).sort({ idNo: -1 });
      let seq = 1;
      if (lastDoc?.idNo) {
        const parts = lastDoc.idNo.split("-");
        const lastNum = parseInt(parts[3], 10);
        if (!isNaN(lastNum)) seq = lastNum + 1;
      }

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
        idNo: `SLF-${typeCode}-${provCode}-${String(seq).padStart(4, "0")}`,
        status: "pending",
      });
      await newDoc.save();
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

    res.json({ message: "Baseline saved and locked" });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Portal user requests baseline field update — notifies admin
router.post("/baseline-update-request", async (req, res) => {
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
    const latestEntry = await DataSLF.findOne(filter).setOptions({ includeHiddenYears: true }).sort({ createdAt: -1 });

    // Log transaction
    await Transaction.create({
      companyName: slfName,
      submittedBy: requestedBy,
      submissionId: latestEntry?.submissionId || undefined,
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

// Portal: Get waste received breakdown by baseline clients and submitted client selections.
// Region 3 Central Luzon: PSGC region code starts with "03".
router.get("/waste-received-summary/:slfName", async (req, res) => {
  try {
    const slfName = decodeURIComponent(req.params.slfName);
    const { year, slfId } = req.query;
    const requestedNames = getNameVariants(slfName);
    const requestedRegexes = requestedNames.map((name) => new RegExp(`^${escapeRegExp(name)}$`, "i"));

    let facilities = [];
    let facilityIsDummy = false;
    if (slfId && mongoose.isValidObjectId(slfId)) {
      const selectedFacility = await SlfFacility.findOne({ _id: slfId, deletedAt: null })
        .select("_id lgu province isDummy")
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
      }).select("_id lgu province").lean();
    }
    if (!facilities.length && requestedRegexes.length) {
      facilities = await SlfFacility.find({
        deletedAt: null,
        province: { $in: requestedRegexes },
      }).select("_id lgu province").lean();
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

    const match = {
      $or: [
        ...nameRegexes.map((regex) => ({ slfName: regex })),
        ...(facilityIds.length ? [{ slfGenerator: { $in: facilityIds } }] : []),
      ],
      deletedAt: null,
      status: { $ne: "rejected" },
      // Keep dummy and actual data strictly separated: a dummy facility's
      // dashboard shows only dummy submissions, and vice-versa.
      isDummy: facilityIsDummy ? true : { $ne: true },
    };
    if (match.$or.length === 0) {
      match.slfName = { $regex: new RegExp(`^${escapeRegExp(slfName)}`, "i") };
      delete match.$or;
    }
    if (year) {
      const y = Number(year);
      match.dateOfDisposal = { $gte: new Date(`${y}-01-01`), $lte: new Date(`${y}-12-31`) };
    }

    const records = await DataSLF.find(match).select(
      "companyType companyRegion companyProvince companyMunicipality lguCompanyName trucks dateOfDisposal accreditedHaulers baselineUnit totalVolumeAccepted totalVolumeAcceptedUnit activeCellEntries activeCellResidualVolume activeCellResidualUnit activeCellInertVolume activeCellInertUnit activeCellHazardousVolume activeCellHazardousUnit closedCellEntries closedCellResidualVolume closedCellResidualUnit closedCellInertVolume closedCellInertUnit closedCellHazardousVolume closedCellHazardousUnit"
    ).lean();

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

    const baseline = chooseBaselineRecord(records.filter(hasBaselineData));
    if (baseline?.activeCellEntries?.length) {
      baseline.activeCellEntries.forEach((entry, index) => {
        addBaselineVolume(
          entry.cellName || `Active Cell ${index + 1}`,
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
      (r.accreditedHaulers || []).forEach((hauler) => {
        const clients = [
          ...(Array.isArray(hauler.privateSectorClients) ? hauler.privateSectorClients : hauler.privateSectorClients ? [hauler.privateSectorClients] : []),
          ...(Array.isArray(hauler.clients) ? hauler.clients : []),
        ];
        clients.forEach((client) => addClient(baselineClientMap, client));
      });

      const totalVol = (r.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
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

      (r.trucks || []).forEach((truck) => {
        const vehicleClients = (truck.vehicles || []).flatMap((vehicle) =>
          Array.isArray(vehicle.selectedClients) ? vehicle.selectedClients : [],
        );
        const clients = Array.isArray(truck.selectedClients) && truck.selectedClients.length
          ? truck.selectedClients
          : vehicleClients.length
            ? vehicleClients
            : [{
                clientName: truck.lguCompanyName || r.lguCompanyName || "—",
                clientType: truck.companyType || r.companyType || "Private",
                region: r.companyRegion || "",
                province: r.companyProvince || "",
                municipality: r.companyMunicipality || "",
              }];
        const splitVolume = Number(truck.actualVolume || 0) / Math.max(clients.length, 1);
        clients.forEach((client) => addClient(
          submissionClientMap,
          client,
          splitVolume,
          truck.actualVolumeUnit || r.baselineUnit || "m³",
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
