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

module.exports = {
  resolveCellName,
  applyResolvedCellNames,
  applyResolvedCellNamesToAll,
  collectCellNames,
  facilityNamesOf,
};
