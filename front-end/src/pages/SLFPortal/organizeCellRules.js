// The placement rules behind Organize Cell Placement — pure, so they are tested
// and the modal only renders what they decide.
//
// ── What the organizer is for ────────────────────────────────────────────────
// Placing waste that has NO cell yet. Two things used to blur that:
//
//   • Waste that ALREADY had a cell but was missing a Truck Capacity came back
//     as a placement row (353 such loads on live data — 30 of the 44 submissions
//     in the organizer had nothing left to place at all). It showed up beside
//     genuinely unplaced waste as though it still needed a cell. It is split out
//     here (splitOrganizerWork) into a capacity-only list: its cell is shown, never
//     offered for change.
//   • Moving waste that is already placed is an admin correction, not something
//     the portal organizer does. The server now refuses it too.
//
// ── The rulings ──────────────────────────────────────────────────────────────
//   1. Waste type must fit the cell: hazardous / treated-hazardous / inert waste
//      only into a hazardous cell, residual waste never into one. There is no
//      fallback to "any open cell" — that fallback is how a hazardous load could
//      be offered a residual cell.
//   2. Capacity counts what is ALREADY CHOSEN in this session, not just the stored
//      fill. Every row picking "Cell 2" independently each saw the full remaining
//      room, so a session could over-fill a cell that each row alone fitted.
//   3. Bulk assign and auto-place only write rows the cell can legally take, and
//      report the ones they skipped and why.
//
// Volumes are compared in m³ (`remainingM3` on each cell option), whatever unit a
// row or a cell was declared in.

import { convertVolume } from "../../utils/volumeUnits.js";
import { isHazardousWasteType } from "../../utils/wasteCategories.js";

// A CELL type is free text set by the admin ("Treated Haz Waste", "Inert/Hazardous").
const HAZ_CELL_RE = /haz|inert/i;
export const isHazardousCell = (cellType) => HAZ_CELL_RE.test(String(cellType || ""));

/**
 * Rule 1 — may waste of this type go into a cell of this type?
 *
 * The WASTE side goes through the app's shared classifier (utils/wasteCategories),
 * which normalises legacy spellings ("HW", "hazardous_waste") first — the same
 * one the server's rule uses (server/utils/cellAvailability#wasteTypeFitsCell),
 * so the portal and the server can never disagree about a load.
 */
export function wasteFitsCell(wasteType, cellType) {
  return isHazardousWasteType(wasteType) === isHazardousCell(cellType || "Residual");
}

/** A row's volume in m³ (0 when absent or unconvertible). */
export function rowVolumeM3(row) {
  const v = Number(row?.actualVolume ?? row?.volume ?? 0);
  if (!(v > 0)) return 0;
  const converted = convertVolume(v, row?.actualVolumeUnit || row?.volumeUnit || "m³", "m³");
  return Number.isFinite(converted) ? converted : 0;
}

export const placementKey = (subId, p) =>
  `${subId}|${p.truckIndex}|${Number.isInteger(p.vehicleIndex) ? p.vehicleIndex : "t"}`;

const hasChosenCell = (p) => !!p?.cellName && Number.isInteger(p?.cellIndex);

/**
 * Split the organizer's working data into the two jobs it does.
 *
 *   placementSubs — submissions with waste that has NO cell, carrying only those
 *                   placements. This is the placement list.
 *   capacityRows  — waste ALREADY placed that is only missing a Truck Capacity.
 *                   Shown on its own; the cell is read-only.
 */
export function splitOrganizerWork(data = []) {
  const placementSubs = [];
  const capacityRows = [];
  for (const sub of Array.isArray(data) ? data : []) {
    const needing = [];
    for (const p of sub.placements || []) {
      if (p.needsCell !== false) needing.push(p);
      else if (p.needsCapacity) capacityRows.push({ sub, placement: p, key: placementKey(sub._id, p) });
    }
    if (needing.length) placementSubs.push({ ...sub, placements: needing });
  }
  return { placementSubs, capacityRows };
}

/**
 * Rule 2 — m³ already chosen per cell in this session (cellIndex → m³), over the
 * placement rows only. `exceptKey` leaves one row out, so a row is never counted
 * against itself when its own choices are worked out.
 */
export function plannedM3ByCell(data = [], exceptKey = null) {
  const planned = new Map();
  for (const sub of Array.isArray(data) ? data : []) {
    for (const p of sub.placements || []) {
      if (p.needsCell === false || !hasChosenCell(p)) continue;
      if (exceptKey && placementKey(sub._id, p) === exceptKey) continue;
      planned.set(p.cellIndex, (planned.get(p.cellIndex) || 0) + rowVolumeM3(p));
    }
  }
  return planned;
}

/** Room left in a cell (m³) once this session's other choices are taken. Infinity when the cell declares no capacity. */
export function roomLeftM3(option, planned) {
  const remaining = Number(option?.remainingM3);
  if (!Number.isFinite(remaining)) return Infinity;
  return Math.max(0, remaining - (planned.get(option.cellIndex) || 0));
}

/**
 * The cells ONE row may be placed in, each with whether it fits and why not.
 * Only type-compatible cells are listed at all (rule 1); capacity (rule 2) can
 * disable one with a reason.
 */
export function cellChoicesFor(row, options = [], planned = new Map()) {
  const volume = rowVolumeM3(row);
  return (Array.isArray(options) ? options : [])
    .filter((o) => wasteFitsCell(row?.wasteType, o.cellType))
    .map((o) => {
      const room = roomLeftM3(o, planned);
      const fits = room === Infinity || volume <= room + 1e-9;
      return { option: o, room, fits, reason: fits ? "" : "Not enough room left for this load" };
    });
}

/**
 * Apply ONE cell to many rows (the bulk-assign bar). Rows the cell cannot take —
 * wrong waste type, or no room once the earlier rows in the same pass are counted
 * — are left untouched and reported.
 *
 * @returns {{ data, applied, skipped: { type, capacity } }}
 */
export function applyCellToRows(data, rowKeys, option, toPatch) {
  const wanted = new Set(rowKeys || []);
  const planned = plannedM3ByCell(data);
  const skipped = { type: 0, capacity: 0 };
  let applied = 0;
  const next = data.map((sub) => ({
    ...sub,
    placements: (sub.placements || []).map((p) => {
      const key = placementKey(sub._id, p);
      if (!wanted.has(key) || p.needsCell === false) return p;
      if (!wasteFitsCell(p.wasteType, option.cellType)) { skipped.type += 1; return p; }
      // Re-choosing the cell a row already has costs nothing extra.
      const already = hasChosenCell(p) && p.cellIndex === option.cellIndex;
      const vol = rowVolumeM3(p);
      if (!already) {
        // Free the row's previous choice before charging the new one.
        if (hasChosenCell(p)) planned.set(p.cellIndex, (planned.get(p.cellIndex) || 0) - vol);
        if (roomLeftM3(option, planned) + 1e-9 < vol) { skipped.capacity += 1; return p; }
        planned.set(option.cellIndex, (planned.get(option.cellIndex) || 0) + vol);
      }
      applied += 1;
      return { ...p, ...toPatch(option) };
    }),
  }));
  return { data: next, applied, skipped };
}

/**
 * Auto-place: every row that has no cell chosen yet goes into the type-compatible
 * open cell with the MOST room left, largest loads first so the big ones are not
 * the ones left over. A row that fits nowhere is left empty and counted.
 *
 * @returns {{ data, placed, unplaceable }}
 */
export function autoPlace(data, options, toPatch) {
  const planned = plannedM3ByCell(data);
  const queue = [];
  data.forEach((sub, si) =>
    (sub.placements || []).forEach((p, pi) => {
      if (p.needsCell === false || hasChosenCell(p)) return;
      queue.push({ si, pi, p, vol: rowVolumeM3(p) });
    }),
  );
  queue.sort((a, b) => b.vol - a.vol);

  const chosen = new Map(); // `${si}|${pi}` → option
  let unplaceable = 0;
  for (const item of queue) {
    const best = (options || [])
      .filter((o) => wasteFitsCell(item.p.wasteType, o.cellType))
      .map((o) => ({ o, room: roomLeftM3(o, planned) }))
      .filter(({ room }) => room === Infinity || item.vol <= room + 1e-9)
      .sort((a, b) => b.room - a.room || a.o.cellIndex - b.o.cellIndex)[0];
    if (!best) { unplaceable += 1; continue; }
    planned.set(best.o.cellIndex, (planned.get(best.o.cellIndex) || 0) + item.vol);
    chosen.set(`${item.si}|${item.pi}`, best.o);
  }

  const next = data.map((sub, si) => ({
    ...sub,
    placements: (sub.placements || []).map((p, pi) => {
      const o = chosen.get(`${si}|${pi}`);
      return o ? { ...p, ...toPatch(o) } : p;
    }),
  }));
  return { data: next, placed: chosen.size, unplaceable };
}

/** Progress of the session, for the header. */
export function organizerProgress(data = []) {
  let toPlace = 0;
  let placed = 0;
  let capacityNeeded = 0;
  let capacityFilled = 0;
  for (const sub of Array.isArray(data) ? data : []) {
    for (const p of sub.placements || []) {
      if (p.needsCell !== false) {
        toPlace += 1;
        if (hasChosenCell(p)) placed += 1;
      }
      if (p.needsCapacity) {
        capacityNeeded += 1;
        if (Number(p.capacity) > 0) capacityFilled += 1;
      }
    }
  }
  return { toPlace, placed, capacityNeeded, capacityFilled };
}
