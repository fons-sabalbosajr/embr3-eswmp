// ── Disposal cell placement: entry ⇄ vehicle ────────────────────────────────
//
// A transport ENTRY and the VEHICLES on it can each carry a cell, and the two
// levels do not mean the same thing:
//
//   • the ENTRY's cell is a placement of the whole trip — it is what "Assign to
//     Cell" writes, and what a cell chosen on the entry means;
//   • a VEHICLE's cell is where that vehicle's waste actually went.
//
// The server reads placement from EACH VEHICLE and ignores the entry's cell when
// vehicles are present (portalAuth#summarizeCellAssignment). So an entry placed
// as a whole, whose vehicles carry no cell of their own, counts as unplaced waste
// server-side — and the operator is sent to Organize Cells for an entry they had
// already placed.
//
// The fix is inheritance, not a relaxed check: a vehicle with no cell of its own
// takes the entry's. That makes the placement real rather than merely assumed, so
// the front-end validation, the saved record and the server's own count all agree.
//
// Pure: no hooks, no component state.

const text = (value) => String(value ?? "").trim();

/** Does this record carry a usable cell placement? */
export const hasCellPlacement = (record = {}) =>
  !!text(record.cellName) || typeof record.cellIndex === "number";

/**
 * The cell fields of an entry, in the shape a vehicle stores them.
 * `cellIndex` is the canonical reference; the name and type are display.
 */
export const entryCellOf = (entry = {}) => ({
  cellName: text(entry.cellName),
  cellType: text(entry.cellType),
  cellIndex: typeof entry.cellIndex === "number" ? entry.cellIndex : null,
});

/**
 * Give every vehicle without its own placement the entry's.
 *
 * Only the CELL is inherited. Volume, waste type and hazardous codes are
 * genuinely per-vehicle and copying them across would double-count an entry's
 * waste — which is why this is separate from the field-level migration in
 * openTruckModal rather than folded into it.
 *
 * Returns a new array; vehicles that already have a cell are returned untouched.
 */
export const inheritEntryCell = (vehicles = [], entry = {}) => {
  const list = Array.isArray(vehicles) ? vehicles : [];
  if (!hasCellPlacement(entry)) return list.map((vehicle) => ({ ...vehicle }));
  const cell = entryCellOf(entry);
  return list.map((vehicle) =>
    hasCellPlacement(vehicle) ? { ...vehicle } : { ...vehicle, ...cell },
  );
};

/**
 * Does this vehicle still need a cell chosen for it?
 *
 * False when the vehicle has one, when the ENTRY has one (it will be inherited
 * on save), or when the facility has no cell that can accept waste at all — in
 * that last case there is nothing to choose and blocking on it would strand the
 * operator.
 */
export const vehicleNeedsCell = (vehicle = {}, entry = {}, availableCellCount = 0) => {
  if (availableCellCount <= 0) return false;
  if (hasCellPlacement(vehicle)) return false;
  return !hasCellPlacement(entry);
};

export default {
  hasCellPlacement,
  entryCellOf,
  inheritEntryCell,
  vehicleNeedsCell,
};
