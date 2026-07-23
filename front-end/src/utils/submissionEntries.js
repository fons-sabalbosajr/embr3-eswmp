// Flattens a disposal submission into its individual WASTE ENTRIES.
//
// A submission is not one quantity. It holds N transport entries, and each of
// those can split its load across several vehicles, every one of which carries its
// own waste type, volume, unit and destination cell. Collapsing that into a single
// combined figure (what the View Submission and Disposal Calendar modals used to
// show) hides the hauler, the waste type and the cell, and — because per-truck
// units differ — produces a number whose unit is a guess.
//
// This is the single place that expansion happens, so the modals and the CSV export
// always break a submission down the same way.
import { normalizeUnit, convertVolume, M3, TONS } from "./volumeUnits";

export const displayUnit = (unit) => normalizeUnit(unit) || String(unit || "").trim();

// Cell label for an entry, preferring the stored name and falling back to the
// canonical index ("Cell 3") so a placed entry never renders as "—".
function resolveCellLabel(source, fallback) {
  const name = String(source?.cellName || fallback?.cellName || "").trim();
  if (name) return name;
  const index = source?.cellIndex ?? fallback?.cellIndex;
  return Number.isInteger(index) ? `Cell ${index + 1}` : "";
}

/**
 * @returns {Array<{
 *   key: string, submissionId: string, date: Date|null, hauler: string,
 *   plateNumber: string, wasteType: string, volume: number|null, unit: string,
 *   cell: string, slfName: string, status: string, ticketNo: string,
 *   hazWasteCodes: string[], truckIndex: number, vehicleIndex: number|null,
 * }>}
 */
export function buildSubmissionWasteEntries(record, { slfName = "", fallbackUnit = "" } = {}) {
  if (!record) return [];
  const trucks = Array.isArray(record.trucks) ? record.trucks : [];
  const recordUnit = displayUnit(record.baselineUnit || fallbackUnit);
  const submissionId = record.idNo || record.submissionId || "";
  const rows = [];

  trucks.forEach((truck, truckIndex) => {
    // Only vehicles that actually carry a volume are separate waste entries;
    // otherwise the truck row itself is the entry.
    const vehicles = (truck.vehicles || []).filter(
      (vehicle) => Number(vehicle?.actualVolume || 0) > 0,
    );
    const sources = vehicles.length
      ? vehicles.map((vehicle, vehicleIndex) => ({ source: vehicle, vehicleIndex }))
      : [{ source: truck, vehicleIndex: null }];

    sources.forEach(({ source, vehicleIndex }) => {
      const volume = source?.actualVolume == null ? null : Number(source.actualVolume);
      const codes = Array.isArray(source?.hazWasteCode)
        ? source.hazWasteCode
        : Array.isArray(truck?.hazWasteCode)
          ? truck.hazWasteCode
          : [source?.hazWasteCode || truck?.hazWasteCode].filter(Boolean);
      rows.push({
        key: `${record._id || submissionId}-${truckIndex}-${vehicleIndex ?? "t"}`,
        submissionId,
        date: record.dateOfDisposal ? new Date(record.dateOfDisposal) : null,
        // Hauler lives on the truck; a vehicle never overrides it.
        hauler: truck?.hauler || truck?.haulerName || "",
        plateNumber: source?.plateNumber || truck?.plateNumber || "",
        ticketNo: truck?.disposalTicketNo || "",
        wasteType: source?.wasteType || truck?.wasteType || "",
        volume,
        // Every volume carries the unit it was RECORDED in — never a page-level
        // default silently applied to a value stored in the other unit.
        unit: displayUnit(source?.actualVolumeUnit || truck?.actualVolumeUnit) || recordUnit,
        cell: resolveCellLabel(source, truck),
        slfName: slfName || record.slfName || "",
        status: record.status || "pending",
        hazWasteCodes: codes.filter(Boolean),
        truckIndex,
        vehicleIndex,
      });
    });
  });

  // A submission with no transport entries still has to be represented — dropping
  // it would silently shrink an export. Fall back to the record-level totals, which
  // are stored per unit, so the row is still unambiguous.
  if (!rows.length) {
    const totals = [
      { volume: Number(record.totalVolumeM3 || 0), unit: M3 },
      { volume: Number(record.totalVolumeTons || 0), unit: TONS },
    ].filter((total) => total.volume > 0);
    const sources = totals.length ? totals : [{ volume: null, unit: recordUnit }];
    sources.forEach((total, index) => {
      rows.push({
        key: `${record._id || submissionId}-total-${index}`,
        submissionId,
        date: record.dateOfDisposal ? new Date(record.dateOfDisposal) : null,
        hauler: "",
        plateNumber: "",
        ticketNo: "",
        wasteType: "",
        volume: total.volume,
        unit: total.unit,
        cell: "",
        slfName: slfName || record.slfName || "",
        status: record.status || "pending",
        hazWasteCodes: [],
        truckIndex: -1,
        vehicleIndex: null,
      });
    });
  }

  return rows;
}

// Totals per unit, kept SEPARATE rather than summed blindly. Returns both the
// per-unit split and a single converted total for callers that need one figure.
export function summarizeWasteEntries(entries = [], targetUnit = "") {
  const byUnit = { [M3]: 0, [TONS]: 0 };
  let unknown = 0;
  entries.forEach((entry) => {
    const value = Number(entry?.volume || 0);
    if (!value) return;
    const unit = normalizeUnit(entry?.unit);
    if (unit === M3 || unit === TONS) byUnit[unit] += value;
    else unknown += value;
  });
  const target = normalizeUnit(targetUnit) || (byUnit[TONS] > byUnit[M3] ? TONS : M3);
  const converted =
    (convertVolume(byUnit[M3], M3, target) || 0) +
    (convertVolume(byUnit[TONS], TONS, target) || 0);
  return { byUnit, unknown, target, total: converted };
}

// "1,200 m³ + 340 tons" — an honest label when a submission mixes units, instead
// of one number under a unit that is only correct for part of it.
export function formatWasteEntryTotals(entries = [], targetUnit = "") {
  const { byUnit, unknown, target, total } = summarizeWasteEntries(entries, targetUnit);
  const parts = Object.entries(byUnit)
    .filter(([, value]) => value > 0)
    .map(([unit, value]) => `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`);
  if (unknown > 0) {
    parts.push(`${unknown.toLocaleString(undefined, { maximumFractionDigits: 2 })} (unit not recorded)`);
  }
  if (!parts.length) return `0 ${target}`;
  if (parts.length === 1) return parts[0];
  return `${parts.join(" + ")} = ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${target}`;
}
