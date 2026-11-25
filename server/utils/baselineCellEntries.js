/**
 * Baseline cell entries (activeCellEntries / closedCellEntries) — the ONE place
 * that decides the unit a cell entry is stored and shown in, plus the extra
 * per-entry details (closure date, MOV attachments).
 *
 * ── Why units are normalized here ───────────────────────────────────────────
 * The admin declares a unit per cell (SlfFacility.cellCapacityUnits[i], set via
 * the SLF form / "Set Field Units"). Portal operators used to pick their own unit
 * per entry, so the same facility ended up with cells in m³ on the portal and in
 * tons on the admin side (e.g. Floridablanca: facility and every cell declared
 * tons, baseline cells stored as 430,738.41 m³).
 *
 * Occupancy math already converts each entry by its own unit, so converting an
 * entry into the declared unit is quantity-preserving: 430,738.41 m³ becomes
 * 215,369.205 tons, the same waste. Doing it at the API boundary (every save and
 * every read) means the portal, the admin Baseline Data table and the dashboards
 * all show one unit for one cell.
 *
 * Never guesses: an entry whose unit (or the facility's) is unknown is left as is.
 */
const { normalizeUnit, convertVolume, resolveFacilityUnit } = require("./volumeUnits");
const { resolveBaselineCellEntries } = require("./cellNaming");

// Fields a facility read must include for these helpers to work.
const FACILITY_CELL_UNIT_SELECT =
  "numberOfCell cellNames cellTypes cellStatuses cellCapacities cellCapacityUnits cellFillUnits " +
  "wasteReceivedUnit volumeCapacityUnit receivingVolumeCapacityUnit estimatedVolumeWasteUnit";

const MAX_MOV_ATTACHMENTS = 20;

function facilityDeclaresAnyUnit(facility) {
  if (!facility) return false;
  return [
    facility.wasteReceivedUnit,
    facility.volumeCapacityUnit,
    facility.receivingVolumeCapacityUnit,
    facility.estimatedVolumeWasteUnit,
    ...(facility.cellCapacityUnits || []),
  ].some((u) => normalizeUnit(u));
}

/** The unit the admin declared for the cell this entry is bound to. "" if none. */
function declaredUnitForEntry(facility, entry) {
  if (!facilityDeclaresAnyUnit(facility)) return "";
  const raw = entry?.cellIndex;
  const index = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  if (Number.isInteger(index) && index >= 0) {
    const cellUnit = normalizeUnit(facility.cellCapacityUnits?.[index]);
    if (cellUnit) return cellUnit;
  }
  return resolveFacilityUnit(facility);
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Convert each entry's volume into its cell's declared unit. Pure; unchanged rows
 * keep object identity. Run AFTER resolveBaselineCellEntries so cellIndex is bound.
 */
function normalizeBaselineEntryUnits(entries, facility) {
  if (!Array.isArray(entries) || !facility) return entries;
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const target = declaredUnitForEntry(facility, entry);
    if (!target) return entry;
    const stored = normalizeUnit(entry.unit);
    if (stored === target) return entry.unit === target ? entry : { ...entry, unit: target };
    if (!stored) {
      // No unit recorded — the number cannot be converted safely. Leave it.
      return entry;
    }
    const converted = convertVolume(entry.volume, stored, target);
    if (converted === null) {
      // No volume (or unconvertible) — only the label needs to follow the cell.
      return entry.volume === null || entry.volume === undefined || entry.volume === ""
        ? { ...entry, unit: target }
        : entry;
    }
    return { ...entry, volume: round3(converted), unit: target };
  });
}

function sanitizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // A closure date in the future is a typo, not a plan.
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return d;
}

// Only URLs this app itself produces: a Drive link from the upload route, or the
// app's own local-upload fallback path.
const ALLOWED_MOV_URL = /^(https:\/\/(drive|docs)\.google\.com\/|\/[\w\-/]*\/upload\/(files|secure)\/)/i;

function sanitizeMovAttachments(list, actor) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const item of list) {
    if (out.length >= MAX_MOV_ATTACHMENTS) break;
    const url = String(item?.url || "").trim();
    if (!url || !ALLOWED_MOV_URL.test(url)) continue;
    const size = Number(item?.size);
    const uploadedAt = sanitizeDate(item?.uploadedAt) || new Date();
    out.push({
      url,
      fileName: String(item?.fileName || item?.name || "").trim().slice(0, 255),
      mimeType: String(item?.mimeType || "").trim().slice(0, 120),
      ...(Number.isFinite(size) && size >= 0 ? { size } : {}),
      uploadedAt,
      uploadedBy: String(item?.uploadedBy || actor || "").trim().slice(0, 254),
    });
  }
  return out;
}

/**
 * Whitelist the operator-supplied extras on each entry: `dateClosed` (closed
 * cells only) and `movAttachments`. Everything else passes through untouched.
 */
function sanitizeBaselineEntryExtras(entries, { closed = false, actor = "" } = {}) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const next = { ...entry };
    if (closed) {
      if ("dateClosed" in next) next.dateClosed = sanitizeDate(next.dateClosed);
    } else {
      delete next.dateClosed;
    }
    if ("movAttachments" in next) {
      const mov = sanitizeMovAttachments(next.movAttachments, actor);
      if (mov === undefined) delete next.movAttachments;
      else next.movAttachments = mov;
    }
    // The operator's own name for the cell: plain text, bounded, and dropped
    // when it only repeats the admin's name.
    if ("cellLabel" in next) {
      const label = String(next.cellLabel ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!label || label.toLowerCase() === String(next.cellName || "").trim().toLowerCase()) delete next.cellLabel;
      else next.cellLabel = label;
    }
    return next;
  });
}

const MOV_SECTIONS = ["activeCells", "closedCells", "haulers"];

/**
 * The section-level MOV block ({ activeCells, closedCells, haulers }), each list
 * whitelisted like the per-entry attachments. Returns undefined when the request
 * did not send the block, so a save that does not touch MOV leaves it alone.
 */
function sanitizeBaselineMov(value, actor) {
  if (!value || typeof value !== "object") return undefined;
  const out = {};
  MOV_SECTIONS.forEach((key) => {
    out[key] = sanitizeMovAttachments(Array.isArray(value[key]) ? value[key] : [], actor) || [];
  });
  return out;
}

/** Full write-path preparation: extras → bind to admin's cell → declared unit. */
function prepareBaselineCellEntriesForSave(entries, facility, options = {}) {
  if (!Array.isArray(entries)) return entries;
  const sanitized = sanitizeBaselineEntryExtras(entries, options);
  return normalizeBaselineEntryUnits(resolveBaselineCellEntries(sanitized, facility), facility);
}

/** Read-path resolution: bind to admin's cell → declared unit. */
function resolveBaselineCellEntriesForRead(entries, facility) {
  if (!Array.isArray(entries)) return entries;
  return normalizeBaselineEntryUnits(resolveBaselineCellEntries(entries, facility), facility);
}

module.exports = {
  FACILITY_CELL_UNIT_SELECT,
  MAX_MOV_ATTACHMENTS,
  declaredUnitForEntry,
  normalizeBaselineEntryUnits,
  sanitizeBaselineEntryExtras,
  sanitizeMovAttachments,
  sanitizeBaselineMov,
  MOV_SECTIONS,
  prepareBaselineCellEntriesForSave,
  resolveBaselineCellEntriesForRead,
};
