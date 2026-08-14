/**
 * THE single source of truth for what a landfill cell is CALLED.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * A submission stores two things about each waste placement:
 *
 *   • `cellIndex` — the stable relationship to the facility's cell infrastructure
 *   • `cellName`  — a COPY of the label as it read at submit time
 *
 * Only the index is authoritative. The name is a denormalized snapshot, and
 * `SlfFacility.cellNames[]` is the live value an admin edits.
 *
 * Those copies live in four places on DataSLF:
 *   trucks[].cellName · trucks[].vehicles[].cellName
 *   activeCellEntries[].cellName · closedCellEntries[].cellName
 *
 * Endpoints used to resolve the name only for a summary field while still
 * shipping the raw trucks array, so anything rendering `truck.cellName`
 * (detail modals, submission history, reports, exports, the portal's own
 * tables) kept showing the name frozen at submit time. Renaming a cell
 * therefore updated some parts of the UI and not others — the reported
 * "inconsistent across the application".
 *
 * The fix is to resolve at the API BOUNDARY: `applyResolvedCellNames()` rewrites
 * every copy in the outgoing payload, so no consumer can render a stale name and
 * no component needs to know the rule. The stored document is left untouched, so
 * historical records keep their original snapshot.
 */

/**
 * Resolve one cell's CURRENT display name.
 *
 * @param {string[]} facilityCellNames live SlfFacility.cellNames
 * @param {number|string|null} cellIndex stable relationship key
 * @param {string} [storedName] snapshot taken at submit time
 * @returns {string} "" when nothing identifies the cell
 */
function resolveCellName(facilityCellNames, cellIndex, storedName) {
  // NB: Number(null) === 0, so a legacy row with cellIndex: null would otherwise
  // resolve to cell 0 and report a DIFFERENT cell's name. Reject empties first.
  const hasIndex = cellIndex !== null && cellIndex !== undefined && cellIndex !== "";
  const index = hasIndex ? Number(cellIndex) : NaN;

  if (Number.isInteger(index) && index >= 0) {
    const current = facilityCellNames?.[index];
    if (current && String(current).trim()) return String(current).trim();
    // The facility declares no custom name for this cell — derive the positional
    // label rather than falling back to a snapshot that may name a renamed cell.
    return `Cell ${index + 1}`;
  }

  // Legacy rows that only ever stored a name (no index) keep working.
  return storedName ? String(storedName).trim() : "";
}

/** The facility's live cell names, from a populated ref or a lean facility doc. */
function facilityNamesOf(entry) {
  return (
    entry?.slfGenerator?.cellNames ||
    entry?.facility?.cellNames ||
    entry?.cellNames ||
    []
  );
}

/**
 * Return a copy of `entry` with every denormalized `cellName` replaced by the
 * facility's current name.
 *
 * Pure — the input (and therefore the stored document) is never mutated, so a
 * Mongoose doc passed through `.lean()` stays safe to reuse.
 *
 * @param {object} entry a lean DataSLF submission/baseline
 * @param {string[]} [facilityCellNames] defaults to the entry's populated facility
 */
function applyResolvedCellNames(entry, facilityCellNames) {
  if (!entry || typeof entry !== "object") return entry;
  const names = facilityCellNames || facilityNamesOf(entry);

  const rename = (row) => {
    if (!row || typeof row !== "object") return row;
    const resolved = resolveCellName(names, row.cellIndex, row.cellName);
    // Leave the row untouched when nothing changes, so unchanged objects keep
    // their identity and large payloads avoid pointless copying.
    return resolved && resolved !== row.cellName ? { ...row, cellName: resolved } : row;
  };

  const renameList = (list) => (Array.isArray(list) ? list.map(rename) : list);

  const trucks = Array.isArray(entry.trucks)
    ? entry.trucks.map((truck) => {
        const next = rename(truck);
        if (!Array.isArray(truck?.vehicles)) return next;
        const vehicles = truck.vehicles.map(rename);
        const changed = vehicles.some((v, i) => v !== truck.vehicles[i]);
        return changed ? { ...next, vehicles } : next;
      })
    : entry.trucks;

  return {
    ...entry,
    ...(trucks !== entry.trucks ? { trucks } : {}),
    ...(Array.isArray(entry.activeCellEntries)
      ? { activeCellEntries: renameList(entry.activeCellEntries) }
      : {}),
    ...(Array.isArray(entry.closedCellEntries)
      ? { closedCellEntries: renameList(entry.closedCellEntries) }
      : {}),
  };
}

/** Map `applyResolvedCellNames` over a list of entries. */
function applyResolvedCellNamesToAll(entries, facilityCellNames) {
  return Array.isArray(entries)
    ? entries.map((entry) => applyResolvedCellNames(entry, facilityCellNames))
    : entries;
}

/**
 * Distinct current cell names a submission's waste was placed into.
 * Used for the submission-list summary column.
 */
function collectCellNames(entry, facilityCellNames) {
  const names = facilityCellNames || facilityNamesOf(entry);
  const out = new Set();
  for (const truck of Array.isArray(entry?.trucks) ? entry.trucks : []) {
    const name = resolveCellName(names, truck?.cellIndex, truck?.cellName);
    if (name) out.add(name);
    for (const vehicle of Array.isArray(truck?.vehicles) ? truck.vehicles : []) {
      const vehicleName = resolveCellName(names, vehicle?.cellIndex, vehicle?.cellName);
      if (vehicleName) out.add(vehicleName);
    }
  }
  return [...out].filter(Boolean);
}

/**
 * How many cells a facility actually has.
 *
 * `numberOfCell` lags behind in practice — an admin who adds a cell populates the
 * parallel arrays without it catching up — so the count is the widest of every
 * source, matching computeCellOccupancy() and the portal's own slfCellCount.
 * Disagreeing here is what truncates the tail of a facility's cell list.
 */
function facilityCellCount(facility) {
  return Math.max(
    Number(facility?.numberOfCell || 0),
    facility?.cellNames?.length || 0,
    facility?.cellStatuses?.length || 0,
    facility?.cellCapacities?.length || 0,
    facility?.cellTypes?.length || 0,
    0,
  );
}

/** "Cell 3" → 2. Anything else → null. The positional label resolveCellName emits. */
function positionalIndexOf(name) {
  const match = /^\s*cell\s*0*(\d+)\s*$/i.exec(String(name || ""));
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isInteger(ordinal) && ordinal > 0 ? ordinal - 1 : null;
}

/**
 * Resolve a baseline cell entry to the facility's AUTHORITATIVE cell index.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `cellIndex` is the stable relationship to the admin's cell configuration;
 * `cellName` is a snapshot of the label at save time. The portal's baseline save
 * historically stored entries verbatim from the request body, and the body
 * usually carried only a name — in the live data 1052 of 1112 baseline cell
 * entries (94.6%) have NO cellIndex at all. Without it the portal cannot tie a
 * baseline row to the admin's cell, so Data Entry rendered the frozen snapshot
 * ("Cell 1", "CELL IA", even a facility name used as a cell name) while every
 * other view rendered the admin's current name. That is the reported mismatch.
 *
 * ── Resolution order (most authoritative first) ─────────────────────────────
 *   1. an existing in-range integer index — already authoritative, never overridden
 *   2. an exact (case/space-insensitive) match against facility.cellNames
 *   3. the positional "Cell N" convention, ONLY when N is within the cell count
 *
 * Returns null when none of those identify a cell. That is deliberate: leaving a
 * row unbound is correct, and binding a volume to a GUESSED cell would corrupt
 * the admin's capacity figures. Never guess.
 *
 * @returns {number|null}
 */
function resolveCellIndex(facility, entry) {
  const count = facilityCellCount(facility);
  if (!count) return null;

  const raw = entry?.cellIndex;
  const hasIndex = raw !== null && raw !== undefined && raw !== "";
  const index = hasIndex ? Number(raw) : NaN;
  if (Number.isInteger(index) && index >= 0 && index < count) return index;

  const wanted = String(entry?.cellName || "").trim().toLowerCase();
  if (!wanted) return null;

  const names = facility?.cellNames || [];
  for (let i = 0; i < count; i += 1) {
    if (String(names[i] || "").trim().toLowerCase() === wanted) return i;
  }

  const positional = positionalIndexOf(wanted);
  return positional !== null && positional < count ? positional : null;
}

/**
 * Bind baseline cell entries to the admin's authoritative cell configuration.
 *
 * Pure: returns new rows, never mutates the stored document. Used on BOTH sides
 * so the two can never drift —
 *   • the portal baseline READ, so Data Entry renders the admin's current cells;
 *   • the portal baseline SAVE, so newly written rows carry the index and the
 *     read no longer has to infer it.
 *
 * An entry that cannot be resolved keeps its stored name and gets `cellIndex:
 * null`, so the caller can tell "unbound" from "bound to cell 0".
 *
 * @param {Array} entries activeCellEntries / closedCellEntries
 * @param {object} facility lean SlfFacility carrying the cell arrays
 */
function resolveBaselineCellEntries(entries, facility) {
  if (!Array.isArray(entries)) return entries;
  if (!facility) return entries; // nothing authoritative to resolve against

  return entries.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const index = resolveCellIndex(facility, entry);
    const resolvedName =
      index === null
        ? String(entry.cellName || "").trim()
        : resolveCellName(facility.cellNames, index, entry.cellName);
    // The admin's configured type wins for a bound cell: a row saved as
    // "Residual" against a cell the admin has since switched to Treated Haz Waste
    // must not keep claiming the old type.
    const resolvedType =
      index === null
        ? entry.cellType
        : facility.cellTypes?.[index] || entry.cellType;

    if (
      entry.cellIndex === index &&
      entry.cellName === resolvedName &&
      entry.cellType === resolvedType
    ) {
      return entry; // unchanged — keep object identity
    }
    return { ...entry, cellIndex: index, cellName: resolvedName, cellType: resolvedType };
  });
}

module.exports = {
  resolveCellName,
  applyResolvedCellNames,
  applyResolvedCellNamesToAll,
  collectCellNames,
  facilityNamesOf,
  facilityCellCount,
  resolveCellIndex,
  resolveBaselineCellEntries,
};
