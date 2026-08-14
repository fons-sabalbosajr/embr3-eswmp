/**
 * THE canonical "how full is each cell?" calculation.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Two independent implementations of this computation had drifted apart, and
 * they disagreed for every facility that has a baseline:
 *
 *   • routes/dataSLF.js  → refreshFacilityCellOccupancy(): summed ONLY portal
 *     truck volumes, and only those trucks carrying an explicit, in-range
 *     `cellIndex`. The BASELINE (totalVolumeAccepted / activeCell*Volume /
 *     activeCellEntries) was never counted, and unindexed trucks were dropped.
 *     Its result is what gets PERSISTED to SlfFacility.cellFillValues, so it is
 *     what the admin dashboard and the portal tiles read.
 *
 *   • routes/slfFacilities.js → enrichPortalFacilityVolumes(): summed baseline
 *     PLUS submissions, and routed unindexed trucks to a best-matching active
 *     cell. Its result is what the portal facility endpoint returns.
 *
 * The same SLF therefore reported two different fill totals depending on which
 * endpoint answered — the "Submitted Volume tile does not match the Baseline
 * Breakdown" defect. Patching either side would only move the discrepancy, so
 * both now call this one function.
 *
 * The result also carries the BASELINE / SUBMITTED split per cell, so the
 * dashboards can colour each contribution separately without recomputing (and
 * re-diverging) anything.
 */

const { convertVolume } = require("./volumeUnits");

/** Submission statuses whose volumes count toward occupancy. */
const ACTIVE_VOLUME_STATUSES = new Set(["pending", "acknowledged", "revert_requested"]);

/** DataSLF fields the calculation needs; use as a `.select()` projection. */
const OCCUPANCY_ENTRY_FIELDS =
  "_id slfGenerator slfName status createdAt dataYear " +
  "totalVolumeAccepted totalVolumeAcceptedUnit baselineUnit " +
  "activeCellResidualVolume activeCellResidualUnit " +
  "activeCellInertVolume activeCellInertUnit " +
  "activeCellHazardousVolume activeCellHazardousUnit activeCellEntries " +
  "trucks.actualVolume trucks.actualVolumeUnit trucks.wasteType trucks.cellIndex trucks.cellName " +
  "trucks.vehicles.actualVolume trucks.vehicles.actualVolumeUnit trucks.vehicles.cellIndex";

const isHazardousWaste = (wasteType) => /haz|inert/i.test(String(wasteType || ""));
const isHazardousCell = (cellType) => /haz|inert/i.test(String(cellType || ""));

function isActiveCellStatus(status) {
  return ["Active Cell", "Operational", "Active"].includes(String(status || ""));
}

function normalizeCellStatus(status) {
  const value = String(status || "").trim();
  if (/^operational$/i.test(value)) return "Active Cell";
  if (/^closed$/i.test(value)) return "Used/Completed";
  if (/^reserved cell$/i.test(value)) return "Reserved Area";
  return value || "Active Cell";
}

/** "Cell 3" → 2. Returns null when no ordinal is present. */
function parseCellIndex(cellName) {
  const match = String(cellName || "").match(/(?:cell\s*)?(\d+)/i);
  return match ? Number(match[1]) - 1 : null;
}

/** Display-unit normalisation (a missing unit still renders as m³). */
function displayUnit(unit) {
  return String(unit || "m³").replace("m3", "m³");
}

/**
 * Does this submission actually carry waste?
 *
 * The volume lives on the VEHICLE when a truck carries them — the portal form
 * records wasteType/actualVolume per vehicle and leaves the truck level at 0 —
 * and only falls back to the truck for single-entry rows. Reading the truck
 * level alone excluded every multi-vehicle submission from occupancy entirely:
 * the waste was placed, the cell showed empty. Same rule as
 * DataSLF.computeSlfMetrics, which has always preferred the vehicles array.
 */
function hasTruckVolume(entry) {
  return (entry?.trucks || []).some(
    (truck) =>
      Number(truck?.actualVolume || 0) > 0 ||
      (truck?.vehicles || []).some((v) => Number(v?.actualVolume || 0) > 0),
  );
}

/**
 * WHICH record supplies the baseline.
 *
 * A submission carries a COPY of the baseline block (`activeCellEntries`,
 * `totalVolumeAccepted`) alongside its own trucks, so "carries baseline figures"
 * alone identifies most submissions too. The true baseline is the container the
 * portal writes — the record with no transport entries. Only when an SLF has no
 * container (its baseline lives on its submissions) does the newest record
 * carrying the figures stand in for it.
 *
 * Getting this wrong picks a submission as the baseline, which both drops that
 * submission's own waste and dates the pre-baseline cutoff from the wrong record.
 */
function chooseBaselineEntry(entries = []) {
  return (
    entries.find((entry) => isBaselineEntry(entry) && !(entry?.trucks || []).length) ||
    entries.find(isBaselineEntry) ||
    null
  );
}

function isBaselineEntry(entry) {
  return (
    entry?.totalVolumeAccepted != null ||
    entry?.activeCellResidualVolume != null ||
    entry?.activeCellInertVolume != null ||
    entry?.activeCellHazardousVolume != null ||
    !!entry?.activeCellEntries?.length
  );
}

/**
 * The unit every number in the result is expressed in. Preference order matches
 * what the portal displays: an actual submitted unit, then the baseline's unit,
 * then whatever the facility declares.
 */
function resolveTargetUnit(baseline, submissions, facility) {
  return displayUnit(
    submissions
      .flatMap((entry) => entry.trucks || [])
      .find((truck) => Number(truck?.actualVolume || 0) > 0 && truck.actualVolumeUnit)?.actualVolumeUnit ||
      (baseline?.activeCellEntries || []).find((entry) => Number(entry?.volume || 0) > 0 && entry.unit)?.unit ||
      baseline?.baselineUnit ||
      baseline?.activeCellResidualUnit ||
      baseline?.totalVolumeAcceptedUnit ||
      facility?.wasteReceivedUnit ||
      facility?.cellFillUnits?.find(Boolean) ||
      facility?.cellCapacityUnits?.find(Boolean) ||
      facility?.volumeCapacityUnit ||
      "m³",
  );
}

/**
 * Choose the cell a volume belongs to.
 *
 * An explicit, in-range index ALWAYS wins — including when that cell is closed.
 * Where waste was put is a fact about the past, not a preference: a
 * "Used/Completed" cell still physically holds what was tipped into it, and a
 * baseline allocated to Cell 2 belongs to Cell 2 whatever its status is today.
 * Requiring the target to be ACTIVE is what silently re-homed those volumes into
 * the first open cell — measured on production, one facility's Cell 2 (240,854 t)
 * and Cell 3 (200,469 t) baselines both landed in Cell 4, which then read
 * 441,324 t against a 450,000 t capacity while the two closed cells read empty.
 *
 * The active-cell search below is only for a volume with NO cell of its own, and
 * `findBestCellIndex` is only called for those once the caller has established
 * there is somewhere sensible to put it.
 */
function findBestCellIndex(rows, wasteType, preferredIndex = null) {
  const explicit = Number(preferredIndex);
  if (preferredIndex !== null && preferredIndex !== undefined && preferredIndex !== "" &&
      Number.isInteger(explicit) && explicit >= 0 && rows[explicit]) {
    return explicit;
  }
  const hazardous = isHazardousWaste(wasteType);
  const matchIndex = rows.findIndex((row) => isActiveCellStatus(row.status) && row.hazardous === hazardous);
  if (matchIndex >= 0) return matchIndex;
  const operationalIndex = rows.findIndex((row) => isActiveCellStatus(row.status));
  return operationalIndex >= 0 ? operationalIndex : 0;
}

function addVolume(rows, index, value, fromUnit, targetUnit, source) {
  const row = rows[index] || rows[0];
  if (!row) return;
  const converted = convertVolume(value, fromUnit, targetUnit);
  if (converted === null) {
    // Unit missing or unconvertible: EXCLUDE it rather than guessing a unit
    // (`total += null` would also produce NaN). The count is surfaced so the
    // record can be flagged instead of silently dropped.
    row.unconvertible += 1;
    return;
  }
  row.total += converted;
  if (source === "submitted") row.submitted += converted;
  else row.baseline += converted;
}

const round3 = (value) => Math.round(Number(value || 0) * 1000) / 1000;

/**
 * Compute per-cell occupancy for one facility.
 *
 * @param {object}   facility  lean SlfFacility (needs numberOfCell, cellNames,
 *                             cellStatuses, cellTypes, cellCapacities and the
 *                             unit fields)
 * @param {object[]} entries   that facility's DataSLF records, newest first
 * @returns {{
 *   unit: string,
 *   rows: Array<{ index:number, total:number, baseline:number, submitted:number, status:string, unconvertible:number }>,
 *   cellFillValues: number[],
 *   cellFillUnits: string[],
 *   cellFillBaselineValues: number[],
 *   cellFillSubmittedValues: number[],
 *   totalVolume: number,
 *   baselineTotal: number,
 *   submittedTotal: number,
 *   hasVolume: boolean,
 * }}
 */
function computeCellOccupancy(facility, entries = [], { unitSource = null } = {}) {
  const cellCount = Math.max(
    Number(facility?.numberOfCell || 0),
    facility?.cellNames?.length || 0,
    facility?.cellStatuses?.length || 0,
    facility?.cellCapacities?.length || 0,
    1,
  );

  const rows = Array.from({ length: cellCount }, (_, index) => ({
    index,
    total: 0,
    baseline: 0,
    submitted: 0,
    unconvertible: 0,
    status: normalizeCellStatus(facility?.cellStatuses?.[index]),
    hazardous: isHazardousCell(facility?.cellTypes?.[index] || "Residual"),
  }));

  // The newest record that actually carries baseline figures IS the baseline;
  // it is never also counted as a submission.
  const baseline = chooseBaselineEntry(entries);
  const baselineId = baseline?._id ? String(baseline._id) : "";

  const submissions = entries.filter(
    (entry) =>
      ACTIVE_VOLUME_STATUSES.has(entry.status || "pending") &&
      String(entry._id || "") !== baselineId &&
      hasTruckVolume(entry),
  );

  // THE UNIT MUST NOT DEPEND ON WHICH ENTRIES SURVIVED FILTERING.
  //
  // resolveTargetUnit reads the first positive truck's declared unit, so once the
  // pre-baseline rule removes most submissions the fallback can land on a
  // different unit than the same facility resolved a moment earlier — measured on
  // production, Floridablanca's cell fill switched from 215,369 tons to 430,738 m³
  // (the same waste) purely because the trucks that carried "tons" had been
  // filtered out. `unitSource` is the UNFILTERED entry set, so the facility keeps
  // one declared unit no matter which subset is being summed.
  const targetUnit = resolveTargetUnit(
    baseline,
    Array.isArray(unitSource) && unitSource.length
      ? unitSource.filter((entry) => String(entry?._id || "") !== baselineId && hasTruckVolume(entry))
      : submissions,
    facility,
  );

  // ── Baseline contribution ──
  if (baseline?.activeCellEntries?.length) {
    baseline.activeCellEntries.forEach((entry, orderIndex) => {
      const parsed = parseCellIndex(entry.cellName);
      const preferred = parsed != null && parsed >= 0 ? parsed : orderIndex;
      addVolume(
        rows,
        findBestCellIndex(rows, entry.wasteType, preferred),
        entry.volume,
        entry.unit || baseline.baselineUnit || targetUnit,
        targetUnit,
        "baseline",
      );
    });
  } else if (baseline) {
    [
      { value: baseline.activeCellResidualVolume, unit: baseline.activeCellResidualUnit, wasteType: "Residual" },
      { value: baseline.activeCellInertVolume, unit: baseline.activeCellInertUnit, wasteType: "Treated Hazardous Waste" },
      { value: baseline.activeCellHazardousVolume, unit: baseline.activeCellHazardousUnit, wasteType: "Hazardous Waste" },
    ].forEach((item) =>
      addVolume(
        rows,
        findBestCellIndex(rows, item.wasteType),
        item.value,
        item.unit || baseline.baselineUnit || targetUnit,
        targetUnit,
        "baseline",
      ),
    );
  }

  // ── Submitted contribution ──
  //
  // A submitted volume counts toward a cell ONLY when the operator actually
  // placed it there. Waste that has not been organized yet has no cell, and
  // guessing one for it was the single largest source of wrong numbers on this
  // page: `findBestCellIndex` routed every unplaced trip to the first open cell,
  // so — measured on production — 10,141 t of unorganized waste across 906
  // placements was reported as sitting in one facility's Cell 4, which had only
  // 17.58 t genuinely placed in it.
  //
  // Unplaced volume is not discarded either: it is counted in `unplacedTotal`,
  // stays in the facility's received total, and is what Organize Cell Placement
  // exists to resolve. Per-vehicle placements are more specific than the truck's
  // own, so they win when present.
  let unplacedTotal = 0;
  const placeSubmitted = (volume, fromUnit, wasteType, cellIndex) => {
    const explicit =
      cellIndex === null || cellIndex === undefined || cellIndex === "" ? null : Number(cellIndex);
    if (explicit === null || !Number.isInteger(explicit) || explicit < 0 || !rows[explicit]) {
      const converted = convertVolume(Number(volume || 0), fromUnit, targetUnit);
      if (converted && converted > 0) unplacedTotal += converted;
      return;
    }
    addVolume(rows, findBestCellIndex(rows, wasteType, explicit), volume, fromUnit, targetUnit, "submitted");
  };

  submissions.forEach((entry) => {
    (entry.trucks || []).forEach((truck) => {
      const vehicles = (Array.isArray(truck.vehicles) ? truck.vehicles : []).filter(
        (v) => Number(v?.actualVolume || 0) > 0,
      );

      if (vehicles.length) {
        vehicles.forEach((vehicle) => {
          placeSubmitted(
            vehicle.actualVolume,
            vehicle.actualVolumeUnit || truck.actualVolumeUnit || entry.baselineUnit || targetUnit,
            vehicle.wasteType || truck.wasteType,
            vehicle.cellIndex,
          );
        });
        return;
      }

      // A legacy row may carry only a name ("Cell 3") with no index; that is
      // still an explicit placement, so it is resolved rather than treated as
      // unplaced.
      const explicitIndex = Number.isInteger(truck.cellIndex)
        ? truck.cellIndex
        : truck.cellIndex !== null && truck.cellIndex !== undefined && truck.cellIndex !== ""
          ? Number(truck.cellIndex)
          : parseCellIndex(truck.cellName);
      placeSubmitted(
        truck.actualVolume,
        truck.actualVolumeUnit || entry.baselineUnit || targetUnit,
        truck.wasteType,
        explicitIndex,
      );
    });
  });

  // ── Admin override ──
  // Waste in Cell is derived, but an admin may TYPE a cell's figure (SLF Table →
  // Edit → Waste in Cell) when the recorded submissions do not reflect what is
  // physically in the cell. Where `cellFillOverridden[i]` is set, that declared
  // figure IS the cell's volume and replaces the derived total here — at the one
  // place every consumer reads, so the value survives the next recompute and
  // shows identically in Facility Details, Cell Infrastructure and the portal.
  // The derived parts are kept beside it (never overwritten) so the override is
  // always auditable against what the data says.
  rows.forEach((row) => {
    if (!facility?.cellFillOverridden?.[row.index]) return;
    const declared = facility?.cellFillValues?.[row.index];
    if (declared === null || declared === undefined || declared === "") return;
    const converted = convertVolume(
      Number(declared),
      facility?.cellFillUnits?.[row.index] || targetUnit,
      targetUnit,
    );
    if (converted === null || Number.isNaN(converted)) return;
    row.derivedTotal = round3(row.total);
    row.overridden = true;
    row.total = converted;
  });

  const cellFillValues = rows.map((row) => round3(row.total));
  const baselineTotal = round3(rows.reduce((sum, row) => sum + row.baseline, 0));
  const placedSubmittedTotal = round3(rows.reduce((sum, row) => sum + row.submitted, 0));
  const unplaced = round3(unplacedTotal);
  // Everything the facility has RECEIVED, whether or not it has been organized
  // into a cell yet — so the facility-level total does not drop just because
  // waste is awaiting placement. The per-CELL figures stay strictly what is in
  // each cell.
  const cellTotal = round3(rows.reduce((sum, row) => sum + row.total, 0));
  const submittedTotal = round3(placedSubmittedTotal + unplaced);
  const totalVolume = round3(cellTotal + unplaced);

  return {
    unit: targetUnit,
    rows,
    cellFillValues,
    cellFillUnits: rows.map(() => targetUnit),
    cellFillBaselineValues: rows.map((row) => round3(row.baseline)),
    cellFillSubmittedValues: rows.map((row) => round3(row.submitted)),
    totalVolume,
    baselineTotal,
    submittedTotal,
    // Received but not yet organized into a cell. Surfaced so the gap between
    // "in the cells" and "received" is visible instead of being papered over by
    // attributing it to a cell nobody chose.
    unplacedTotal: unplaced,
    placedSubmittedTotal,
    cellTotal,
    hasVolume: totalVolume > 0,
  };
}

/**
 * The "pre-baseline disposal" rule (App Settings →
 * `excludePreBaselineDisposalFromCellFill`, on by default).
 *
 * A submission whose DISPOSAL predates the baseline encoding is already inside
 * the baseline figures the operator entered, so counting it again would
 * double-count that waste. It still counts when it was SUBMITTED after the
 * baseline was encoded — that is a genuinely new declaration.
 *
 * It lives here, beside the calculation it filters, because every reader of
 * `computeCellOccupancy` has to apply it the same way. Applying it on the admin
 * side only is what made Cell Infrastructure and the portal's own tiles report
 * different volumes for the same SLF.
 *
 * @returns {{ baselineDate: Date|null, counted: object[], excludedCount: number }}
 */
function applyPreBaselineRule(entries = [], { exclude = true } = {}) {
  const baselineEntry = chooseBaselineEntry(entries);
  const baselineDate = baselineEntry?.createdAt || null;
  const baselineId = baselineEntry?._id ? String(baselineEntry._id) : "";
  const countsTowardFill = (entry) => {
    if (!exclude || !baselineDate || !entry?.dateOfDisposal) return true;
    // THE BASELINE IS NEVER EXCLUDED BY ITS OWN RULE.
    //
    // Where an SLF has no separate baseline container, the baseline figures live
    // on a submission — and that record's own createdAt is what sets the cutoff.
    // Filtering it out left the facility with no baseline at all: measured on
    // production, eleven facilities collapsed to zero (Masinloc 153,282 → 0,
    // Porac 1,941,366 → 0) purely because the record supplying the baseline was
    // older than the cutoff it had just defined.
    if (baselineId && String(entry._id) === baselineId) return true;
    const disposal = new Date(entry.dateOfDisposal).setHours(0, 0, 0, 0);
    const baseline = new Date(baselineDate).setHours(0, 0, 0, 0);
    if (disposal >= baseline) return true;
    return Boolean(entry.createdAt && new Date(entry.createdAt) > new Date(baselineDate));
  };
  return {
    baselineDate,
    counted: entries.filter(countsTowardFill),
    excludedCount: entries.filter((e) => (e.trucks || []).length > 0 && !countsTowardFill(e)).length,
  };
}

/** Read the pre-baseline toggle once. Defaults to ON, as the schema does. */
async function preBaselineExclusionEnabled() {
  try {
    const AppSettings = require("../models/AppSettings");
    const cfg = await AppSettings.findOne().select("excludePreBaselineDisposalFromCellFill").lean();
    return cfg?.excludePreBaselineDisposalFromCellFill !== false;
  } catch {
    return true;
  }
}

/**
 * Bump when the CALCULATION changes in a way that alters stored results.
 *
 * `SlfFacility.cellFillValues` and its provenance split are a denormalisation of
 * this function. Without a version stamp the repair sweep could only detect a
 * MISSING split, so a corrected calculation left every existing facility showing
 * the figure the old code wrote until something happened to touch it — which is
 * how a cell kept reporting a baseline of 441,324 t after the bug that merged
 * two closed cells into it was fixed.
 *
 *   1 — implicit, everything written before versioning
 *   2 — explicit cell indexes honoured for closed cells; unplaced volume no
 *       longer attributed to a guessed cell; baseline record chosen
 *       container-first; pre-baseline rule applied to the stored figures too;
 *       display unit anchored to the unfiltered entry set.
 */
const OCCUPANCY_CALC_VERSION = 2;

module.exports = {
  computeCellOccupancy,
  OCCUPANCY_CALC_VERSION,
  applyPreBaselineRule,
  chooseBaselineEntry,
  preBaselineExclusionEnabled,
  isBaselineEntry,
  ACTIVE_VOLUME_STATUSES,
  OCCUPANCY_ENTRY_FIELDS,
  isActiveCellStatus,
  normalizeCellStatus,
  parseCellIndex,
  findBestCellIndex,
  isHazardousWaste,
  isHazardousCell,
  displayUnit,
};
