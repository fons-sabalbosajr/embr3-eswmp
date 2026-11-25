// ── Which cells a submission's waste went into (pure, unit-tested) ──
//
// The Submission Details "Cell Capacity" section shows the cells THIS
// submission used — each with its capacity gauge from the facility record the
// admin maintains (slfInfo: cellCapacities / cellFillValues / cellNames /
// cellStatuses / units) — instead of one facility-wide figure. The old gauge read
// `slfGenerator.volumeCapacity`, which the portal's submission record does not
// carry, so it always showed 0%.
import { convertVolume, normalizeUnit } from "../../utils/volumeUnits.js";
import { facilityCellCapacityRows } from "../../utils/cellCapacity.js";

const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * One row per admin-configured cell, in each cell's declared capacity unit —
 * by THE cell rule (utils/cellCapacity.js), so these gauges read exactly what
 * the admin's cell views and the portal dashboard read for the same cell.
 */
export function facilityCellRows(slfInfo) {
  if (!slfInfo) return [];
  const statuses = slfInfo.cellStatuses || [];
  const names = slfInfo.cellNames || [];
  const types = slfInfo.cellTypes || [];
  return facilityCellCapacityRows(slfInfo).map((row) => ({
    index: row.index,
    name: String(names[row.index] || "").trim() || `Cell ${row.index + 1}`,
    status: String(statuses[row.index] || "").trim() || "—",
    type: types[row.index] || "Residual",
    capacity: row.capacity,
    capacityUnit: row.capacityUnit,
    used: row.used,
    pct: row.pct ?? 0,
    remaining: row.remaining ?? 0,
  }));
}

/**
 * The facility cell an entry (a waste entry `{ cell, cellIndex }` or a baseline
 * cell entry `{ cellName, cellIndex }`) refers to: by index first, then by name.
 */
export function cellFor(entry, rows) {
  if (!entry) return null;
  if (Number.isInteger(entry.cellIndex) && rows[entry.cellIndex]) return rows[entry.cellIndex];
  const label = norm(entry.cell ?? entry.cellName);
  if (!label) return null;
  return rows.find((row) => norm(row.name) === label) || rows.find((row) => label.startsWith(norm(row.name))) || null;
}

/**
 * The cells a submission's waste entries used, with how much of THIS
 * submission each received (in the cell's capacity unit), plus what could not
 * be matched to a cell.
 * @returns {{ cells: object[], unplaced: { entries: number, volumes: string[] } }}
 */
export function submissionCellUsage(entries, slfInfo, fallbackUnit = "m³") {
  const rows = facilityCellRows(slfInfo);
  const byIndex = new Map();
  const unplaced = { entries: 0, byUnit: new Map() };
  for (const entry of entries || []) {
    const row = cellFor(entry, rows);
    const volume = Number(entry.volume || 0);
    if (!row) {
      unplaced.entries += 1;
      const unit = normalizeUnit(entry.unit) || fallbackUnit;
      unplaced.byUnit.set(unit, (unplaced.byUnit.get(unit) || 0) + volume);
      continue;
    }
    const bucket = byIndex.get(row.index) || { ...row, submissionVolume: 0, entries: 0 };
    bucket.entries += 1;
    bucket.submissionVolume += convertVolume(volume, normalizeUnit(entry.unit) || row.capacityUnit, row.capacityUnit) || 0;
    byIndex.set(row.index, bucket);
  }
  return {
    cells: [...byIndex.values()].sort((a, b) => a.index - b.index),
    unplaced: {
      entries: unplaced.entries,
      volumes: [...unplaced.byUnit.entries()].map(
        ([unit, v]) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`,
      ),
    },
  };
}
