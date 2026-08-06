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

function hasTruckVolume(entry) {
  return (entry?.trucks || []).some((truck) => Number(truck?.actualVolume || 0) > 0);
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
 * An explicit, in-range index on an ACTIVE cell always wins; otherwise the first
 * active cell whose hazardous/residual nature matches the waste; otherwise any
 * active cell; otherwise cell 0 (so a volume is never silently discarded).
 */
function findBestCellIndex(rows, wasteType, preferredIndex = null) {
  if (
    preferredIndex != null &&
    Number.isInteger(Number(preferredIndex)) &&
    rows[preferredIndex] &&
    isActiveCellStatus(rows[preferredIndex].status)
  ) {
    return Number(preferredIndex);
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
function computeCellOccupancy(facility, entries = []) {
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
  const baseline = entries.find(isBaselineEntry) || null;
  const baselineId = baseline?._id ? String(baseline._id) : "";

  const submissions = entries.filter(
    (entry) =>
      ACTIVE_VOLUME_STATUSES.has(entry.status || "pending") &&
      String(entry._id || "") !== baselineId &&
      hasTruckVolume(entry),
  );

  const targetUnit = resolveTargetUnit(baseline, submissions, facility);

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
  // Per-vehicle cell assignments are more specific than the truck's own, so they
  // win when present; a truck with neither still lands on a best-match active
  // cell rather than being discarded.
  submissions.forEach((entry) => {
    (entry.trucks || []).forEach((truck) => {
      const vehicles = Array.isArray(truck.vehicles)
        ? truck.vehicles.filter((v) => v?.cellIndex !== null && v?.cellIndex !== undefined && v?.cellIndex !== "")
        : [];

      if (vehicles.length) {
        vehicles.forEach((vehicle) => {
          addVolume(
            rows,
            findBestCellIndex(rows, truck.wasteType, Number(vehicle.cellIndex)),
            vehicle.actualVolume,
            vehicle.actualVolumeUnit || truck.actualVolumeUnit || entry.baselineUnit || targetUnit,
            targetUnit,
            "submitted",
          );
        });
        return;
      }

      const explicitIndex = Number.isInteger(truck.cellIndex) ? truck.cellIndex : parseCellIndex(truck.cellName);
      addVolume(
        rows,
        findBestCellIndex(rows, truck.wasteType, explicitIndex),
        truck.actualVolume,
        truck.actualVolumeUnit || entry.baselineUnit || targetUnit,
        targetUnit,
        "submitted",
      );
    });
  });

  const cellFillValues = rows.map((row) => round3(row.total));
  const baselineTotal = round3(rows.reduce((sum, row) => sum + row.baseline, 0));
  const submittedTotal = round3(rows.reduce((sum, row) => sum + row.submitted, 0));
  const totalVolume = round3(rows.reduce((sum, row) => sum + row.total, 0));

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
    hasVolume: totalVolume > 0,
  };
}

module.exports = {
  computeCellOccupancy,
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
