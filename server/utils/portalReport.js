// ── Portal user's own disposal report ───────────────────────────────────────
//
// The aggregation behind GET /portal-auth/my-report. Kept out of the route so
// the shaping is testable without a database or an HTTP request — the route's
// job is identity, this module's job is arithmetic.
//
// SCOPE, and why it is what it is
// -------------------------------
// The report covers the SUBMISSIONS THE CALLER MADE (`submittedBy`), presented
// against THEIR ASSIGNED FACILITY's details. That is the same boundary
// GET /my-submissions already draws, which matters for two reasons:
//
//   • it cannot leak. The caller is resolved from their token by
//     resolvePortalContext; this module never widens that, and every figure here
//     is derived from records that carry the caller's own email.
//   • it matches what they see. A report that totalled a co-operator's
//     submissions would not reconcile against the Submission History the user is
//     looking at, and they would have no way to explain the difference.
//
// Where a facility has several operators, each one's report therefore covers
// their own submissions. The payload says so explicitly (`scope`) rather than
// leaving the reader to assume it is facility-wide.
//
// VOLUME RULE. Volumes count only for statuses where the waste still stands —
// the same ACTIVE_VOLUME_STATUSES the admin summary uses. A reverted submission
// is reported in the status counts (it happened) but contributes no volume (it no
// longer stands). Reusing that set rather than restating it is what keeps the
// operator's own report reconcilable against the admin figures for the same
// period; they must not be able to disagree.

const { ACTIVE_VOLUME_STATUSES } = require("./cellOccupancy");
const { TON_PER_M3, M3, TONS, resolveFacilityUnit } = require("./volumeUnits");
const { cellCapacityRow } = require("./cellCapacity");
const { isHazardousWasteType } = require("./wasteCategories");

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const text = (value) => String(value ?? "").trim();

/**
 * A stored volume in TONS, whichever unit it was recorded in.
 *
 * The per-hauler / per-client / per-cell breakdowns are summed from the raw
 * `actualVolume` on each vehicle, and that figure carries its own unit — a
 * facility declaring m³ stores m³ there. Summing those as if they were tons made
 * the breakdowns disagree with the header totals, which are normalised: against
 * live data the haulers summed to 2,570 t under a stated total of 1,464 t. A
 * report whose parts exceed its whole is worse than no report.
 *
 * Uses the SAME TON_PER_M3 the model's own metrics use, so the two can only ever
 * agree. The unit falls back the same way too: the vehicle's, then the truck's,
 * then the submission's declared baseline unit, then m³.
 */
const normalizeVolumeUnit = (unit) =>
  String(unit || "m³").replace("m3", "m³").trim().toLowerCase();

const toTons = (volume, unitRaw) => {
  const amount = num(volume);
  if (!amount) return 0;
  return normalizeVolumeUnit(unitRaw) === "tons" ? amount : amount * TON_PER_M3;
};

const toM3 = (volume, unitRaw) => {
  const amount = num(volume);
  if (!amount) return 0;
  return normalizeVolumeUnit(unitRaw) === "tons" ? amount / TON_PER_M3 : amount;
};

/** Does this submission's waste still stand? */
const countsTowardVolume = (status) => ACTIVE_VOLUME_STATUSES.has(text(status) || "pending");

const isBlankIndex = (value) => value === null || value === undefined || value === "";

/**
 * The facility's label for a placement, keyed by CELL INDEX.
 *
 * A placement's stored `cellName` is a snapshot of what the cell was called when
 * the row was written, so a renamed cell carries two spellings — measured on
 * PWS, 1,061 trips into index 5 say "Cell 6" and 99 say "Cell for Treated
 * Hazardous Waste", the cell's actual name. Grouping by that text split one cell
 * into two rows, and the "Cell 6" row matched nothing in Disposal Cells. The
 * index is what the occupancy calculation keys on, so it is what this keys on,
 * and the label comes from the facility the same way the Disposal Cells table
 * builds its own — so the two tables always name a cell identically.
 *
 * A row with no usable index falls back to matching its name against the
 * facility's cell names, then to the stored name itself.
 */
function resolveCellLabel(facility, cellIndex, cellName) {
  const labelAt = (i) => text(facility?.cellNames?.[i]) || `Cell ${i + 1}`;
  const count = Math.max(
    num(facility?.numberOfCell),
    (facility?.cellNames || []).length,
    (facility?.cellStatuses || []).length,
    (facility?.cellCapacities || []).length,
  );
  if (facility && !isBlankIndex(cellIndex)) {
    const index = Number(cellIndex);
    if (Number.isInteger(index) && index >= 0 && index < count) return labelAt(index);
  }
  const name = text(cellName);
  if (!name) return "";
  if (facility) {
    const match = (facility.cellNames || []).findIndex((n) => text(n).toLowerCase() === name.toLowerCase());
    if (match >= 0) return labelAt(match);
  }
  return name;
}

/**
 * A facility's permits as the admin records them: the list when there is one,
 * else the single legacy field. Newest validity first.
 */
function permitList(list, legacyNo, legacyValidity, legacyStatus) {
  const rows = (Array.isArray(list) ? list : [])
    .filter((p) => text(p?.permitNo) || p?.validity)
    .map((p) => ({
      permitNo: text(p.permitNo),
      permitType: text(p.permitType),
      validity: p.validity || null,
      status: text(p.status),
    }));
  if (!rows.length && (text(legacyNo) || legacyValidity)) {
    rows.push({ permitNo: text(legacyNo), permitType: "", validity: legacyValidity || null, status: text(legacyStatus) });
  }
  return rows.sort((a, b) => new Date(b.validity || 0) - new Date(a.validity || 0));
}

/** Accumulate into a keyed bucket map. */
function bump(map, key, patch) {
  if (!key) return;
  const existing = map.get(key) || { key, trips: 0, tons: 0, m3: 0, submissions: new Set() };
  existing.trips += patch.trips || 0;
  existing.tons += patch.tons || 0;
  existing.m3 += patch.m3 || 0;
  if (patch.submissionId) existing.submissions.add(patch.submissionId);
  map.set(key, existing);
}

const rank = (map, limit = 0) => {
  const rows = [...map.values()]
    .map((row) => ({
      name: row.key,
      trips: row.trips,
      tons: Number(row.tons.toFixed(2)),
      m3: Number(row.m3.toFixed(2)),
      submissions: row.submissions.size,
    }))
    .sort((a, b) => b.tons - a.tons || b.trips - a.trips || a.name.localeCompare(b.name));
  return limit > 0 ? rows.slice(0, limit) : rows;
};

/**
 * Build the report payload from the caller's own submissions.
 *
 * @param {Array}  submissions  DataSLF documents (lean) WITH their trucks
 * @param {object} options.facility   the caller's assigned SlfFacility (lean)
 * @param {object} options.range      { from, to } ISO strings, both optional
 */
function buildPortalReport(submissions = [], { facility = null, range = {} } = {}) {
  const list = Array.isArray(submissions) ? submissions : [];

  const statuses = {};
  const monthly = new Map();
  // Per-DAY breakdown, keyed by disposal date. Unlike `monthly` it lists EVERY
  // submission of the day (with its status), so a reverted entry still shows up
  // on its date — with 0 volume, for the same reason it adds none to the totals.
  const daily = new Map();
  const byHauler = new Map();
  const byClient = new Map();
  const byCell = new Map();
  const byWasteType = new Map();

  let trucks = 0;
  let totalTons = 0;
  let totalM3 = 0;
  let residualTons = 0;
  let hazardousTons = 0;
  // Work still outstanding on the operator's own records — the same two things
  // the portal blocks a new submission on, so the report doubles as a to-do list.
  let unplacedEntries = 0;
  let missingCapacityEntries = 0;
  let firstDisposal = null;
  let lastDisposal = null;

  list.forEach((entry) => {
    const status = text(entry.status) || "pending";
    statuses[status] = (statuses[status] || 0) + 1;

    const entryTrucks = Array.isArray(entry.trucks) ? entry.trucks : [];
    trucks += entryTrucks.length;

    const disposal = entry.dateOfDisposal ? new Date(entry.dateOfDisposal) : null;
    if (disposal && !Number.isNaN(disposal.getTime())) {
      if (!firstDisposal || disposal < firstDisposal) firstDisposal = disposal;
      if (!lastDisposal || disposal > lastDisposal) lastDisposal = disposal;
    }

    const validDisposal = disposal && !Number.isNaN(disposal.getTime());
    // UTC parts: dateOfDisposal is stored as the calendar date at 00:00Z, the
    // same convention `monthly` reads below.
    const dayKey = validDisposal ? disposal.toISOString().slice(0, 10) : "undated";
    const day = daily.get(dayKey) || {
      date: dayKey, submissions: 0, trucks: 0, tons: 0, residualTons: 0, hazardousTons: 0, items: [],
    };
    day.submissions += 1;
    day.trucks += entryTrucks.length;
    const dayItem = {
      id: text(entry.idNo || entry.submissionId || entry._id),
      status,
      trucks: entryTrucks.length,
      tons: 0,
    };
    day.items.push(dayItem);
    daily.set(dayKey, day);

    if (!countsTowardVolume(status)) return;

    // Volumes are derived from the SAME per-vehicle walk that produces the
    // breakdowns below, NOT from the denormalized totals on the record.
    //
    // Two reasons, both found against live data:
    //   • the denormalized tons field is 0 on records written before both units
    //     were populated in lockstep — Limay's SLF-LGU-BA-0100 stores 188.16 m³
    //     and 0 tons — so a report summing it understated the facility by more
    //     than half;
    //   • deriving both from one walk makes the parts sum to the whole BY
    //     CONSTRUCTION. A report whose per-hauler figures exceed its own header
    //     total is worse than no report, and no amount of care keeps two
    //     independent sums agreeing.
    let entryTons = 0;
    let entryM3 = 0;
    let entryResidual = 0;
    let entryHazardous = 0;

    entryTrucks.forEach((truck) => {
      // Placement and volume live on the VEHICLES when a truck carries them, and
      // on the truck itself otherwise — the same rule the server's cell
      // accounting applies. Reading only one level would drop whichever shape the
      // record happens to use.
      const hasVehicles = Array.isArray(truck.vehicles) && truck.vehicles.length > 0;
      const vehicles = hasVehicles ? truck.vehicles : [truck];
      // The volume sits on the vehicles only when at least one of them carries
      // some; otherwise the TRUCK holds it — computeCellOccupancy's rule. Older
      // rows store the load on the truck beside a stub vehicle whose volume is 0,
      // and `vehicle.actualVolume ?? truck.actualVolume` read that 0 (it is not
      // nullish), so the report dropped loads the cell gauges count.
      const vehiclesCarryVolume = hasVehicles && vehicles.some((v) => num(v.actualVolume) > 0);
      const haulerName = text(truck.hauler);
      const submissionId = text(entry.idNo || entry.submissionId || entry._id);

      vehicles.forEach((vehicle, vehicleIndex) => {
        // Normalised before it is summed ANYWHERE — see toTons. The unit falls
        // back the same way the model's own metrics do: vehicle, then truck, then
        // the submission's declared baseline unit.
        const unit = vehicle.actualVolumeUnit || truck.actualVolumeUnit || entry.baselineUnit;
        // A truck-level load is attributed once (to the first vehicle), never to
        // every stub vehicle beside it.
        const rawVolume = !hasVehicles || vehiclesCarryVolume
          ? vehicle.actualVolume
          : vehicleIndex === 0 ? truck.actualVolume : 0;
        const tons = toTons(rawVolume, unit);
        const m3 = toM3(rawVolume, unit);
        const cellName = resolveCellLabel(
          facility,
          !isBlankIndex(vehicle.cellIndex) ? vehicle.cellIndex : truck.cellIndex,
          vehicle.cellName || truck.cellName,
        );
        const wasteType = text(vehicle.wasteType || truck.wasteType) || "Residual";
        const clients = Array.isArray(vehicle.selectedClients) ? vehicle.selectedClients : [];

        entryTons += tons;
        entryM3 += m3;
        // The SAME classifier the model and the portal use, so a legacy value
        // ("HW", "hazardous_waste") is bucketed identically everywhere.
        if (isHazardousWasteType(wasteType)) entryHazardous += tons;
        else entryResidual += tons;

        if (haulerName) bump(byHauler, haulerName, { trips: 1, tons, m3, submissionId });
        if (cellName) bump(byCell, cellName, { trips: 1, tons, m3, submissionId });
        bump(byWasteType, wasteType, { trips: 1, tons, m3, submissionId });
        clients.forEach((client) => {
          const clientName = text(typeof client === "string" ? client : client?.clientName);
          if (clientName) bump(byClient, clientName, { trips: 1, tons, m3, submissionId });
        });

        if (!cellName && tons > 0) unplacedEntries += 1;
        if (!(num(vehicle.capacity) > 0) && !(num(truck.truckCapacity) > 0)) {
          missingCapacityEntries += 1;
        }
      });
    });

    totalTons += entryTons;
    totalM3 += entryM3;
    residualTons += entryResidual;
    hazardousTons += entryHazardous;

    dayItem.tons = Number(entryTons.toFixed(2));
    day.tons += entryTons;
    day.residualTons += entryResidual;
    day.hazardousTons += entryHazardous;

    const monthKey =
      disposal && !Number.isNaN(disposal.getTime())
        ? `${disposal.getUTCFullYear()}-${String(disposal.getUTCMonth() + 1).padStart(2, "0")}`
        : "undated";
    const month = monthly.get(monthKey) || {
      month: monthKey, submissions: 0, trucks: 0, tons: 0, residualTons: 0, hazardousTons: 0,
    };
    month.submissions += 1;
    month.trucks += entryTrucks.length;
    month.tons += entryTons;
    month.residualTons += entryResidual;
    month.hazardousTons += entryHazardous;
    monthly.set(monthKey, month);
  });

  // Facility cells with their current utilisation, so the report says how much
  // room is left rather than only how much was disposed.
  const cells = [];
  if (facility) {
    const count = Math.max(
      num(facility.numberOfCell),
      (facility.cellStatuses || []).length,
      (facility.cellCapacities || []).length,
    );
    for (let i = 0; i < count; i += 1) {
      const status = facility.cellStatuses?.[i] || "Active Cell";
      if (/not\s*exist/i.test(status)) continue;
      // Cells are stored in the FACILITY's declared unit, which is not always the
      // report's unit. They used to be emitted raw with that unit alongside, so a
      // m³ facility produced a report whose every other table was tons and whose
      // Disposal Cells table was m³ — and "Used" there disagreed with the same
      // cell's figure in "Disposal by Cell" by exactly the conversion factor.
      //
      // Normalised here through the same toTons every other total in this report
      // already passes through, so the whole document speaks one unit.
      //
      // Capacity and fill each carry their OWN unit. The fill is written by the
      // occupancy recompute in `cellFillUnits`, which need not match the
      // capacity's unit; reading the fill through `cellCapacityUnits` misstated
      // "Used" by the conversion factor whenever the two differed.
      //
      // Units and the % follow the ONE cell rule (utils/cellCapacity.js), so this
      // table reads exactly what the admin and portal screens show. A cell with
      // no unit of its own used to be read as m³ here and as tons on screen.
      const row = cellCapacityRow(facility, i, { unit: "tons" });
      const capacity = row.capacity;
      const fill = row.used;
      cells.push({
        // Same label rule as resolveCellLabel, so a cell is named identically in
        // this table and in Disposal by Cell.
        name: text(facility.cellNames?.[i]) || `Cell ${i + 1}`,
        status,
        type: facility.cellTypes?.[i] || "Residual",
        unit: "tons",
        capacity: Number(capacity.toFixed(2)),
        fill: Number(fill.toFixed(2)),
        remaining: Number(Math.max(0, capacity - fill).toFixed(2)),
        // A ratio of two figures in the SAME unit, so it is unchanged by the
        // conversion — computed from the normalised pair for exactly that reason.
        utilization: row.pct,
      });
    }
  }

  const volumeBearing = Object.entries(statuses)
    .filter(([status]) => countsTowardVolume(status))
    .reduce((sum, [, n]) => sum + n, 0);

  return inReportUnit(facility ? resolveFacilityUnit(facility) : TONS, {
    generatedAt: new Date().toISOString(),
    scope: {
      // Stated in the payload so the document can print it. A reader must not
      // have to assume whether this covers one operator or the whole facility.
      basis: "submissions-by-this-operator",
      description:
        "Covers the disposal submissions made by this portal account, for its assigned facility.",
      from: range.from || (firstDisposal ? firstDisposal.toISOString() : null),
      to: range.to || (lastDisposal ? lastDisposal.toISOString() : null),
    },
    facility: facility
      ? {
          name: facility.lgu || facility.slfName || "",
          province: facility.province || "",
          barangay: facility.barangay || "",
          category: facility.category || "",
          ownership: facility.ownership || "",
          status: facility.statusOfSLF || "",
          permitToOperate: facility.permitToOperate || "",
          permitToOperateValidity: facility.permitToOperateValidity || null,
          dischargePermit: facility.dischargePermit || "",
          dischargePermitValidity: facility.dischargePermitValidity || null,
          eccNo: facility.eccNo || "",
          hazwasteGenerationId: facility.hazwasteGenerationId || "",
          // The permit LISTS EMB maintains (renewals, several DP lines) — the
          // single legacy fields above can lag behind them. Newest first.
          permitToOperatePermits: permitList(
            facility.permitToOperatePermits,
            facility.permitToOperate,
            facility.permitToOperateValidity,
            facility.permitToOperateStatus,
          ),
          dischargePermits: permitList(
            facility.dischargePermits,
            facility.dischargePermit,
            facility.dischargePermitValidity,
            facility.dischargePermitStatus,
          ),
        }
      : null,
    totals: {
      submissions: list.length,
      // The count the volumes are derived from — without it a reader cannot tell
      // why 26 submissions contributed nothing.
      volumeBearingSubmissions: volumeBearing,
      trucks,
      totalTons: Number(totalTons.toFixed(2)),
      totalM3: Number(totalM3.toFixed(2)),
      residualTons: Number(residualTons.toFixed(2)),
      hazardousTons: Number(hazardousTons.toFixed(2)),
      firstDisposal: firstDisposal ? firstDisposal.toISOString() : null,
      lastDisposal: lastDisposal ? lastDisposal.toISOString() : null,
    },
    statuses,
    outstanding: {
      unplacedEntries,
      missingCapacityEntries,
      revertedSubmissions: statuses.reverted || 0,
    },
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).map((row) => ({
      ...row,
      tons: Number(row.tons.toFixed(2)),
      residualTons: Number(row.residualTons.toFixed(2)),
      hazardousTons: Number(row.hazardousTons.toFixed(2)),
    })),
    // Oldest day first, like `monthly`; "undated" sorts last.
    daily: [...daily.values()]
      .sort((a, b) => (a.date === "undated" ? 1 : b.date === "undated" ? -1 : a.date.localeCompare(b.date)))
      .map((row) => ({
        ...row,
        tons: Number(row.tons.toFixed(2)),
        residualTons: Number(row.residualTons.toFixed(2)),
        hazardousTons: Number(row.hazardousTons.toFixed(2)),
      })),
    byHauler: rank(byHauler),
    byClient: rank(byClient),
    byCell: rank(byCell),
    byWasteType: rank(byWasteType),
    cells,
  });
}

/**
 * Express every volume in the report in the facility's DECLARED unit.
 *
 * The report was fixed at tons, so an m³ facility (Limay) received a summary in
 * a unit its admin record, its dashboard and its operator never use. Everything
 * above is summed in tons (one normalisation point); this converts the finished
 * figures with the same TON_PER_M3 factor and states the unit in `unit`.
 *
 * Field names keep their historical `…Tons` spelling for compatibility; their
 * values are in `report.unit`.
 */
function inReportUnit(unitRaw, report) {
  const unit = displayUnitOf(unitRaw);
  report.unit = unit;
  if (unit !== M3) return report;
  const k = 1 / TON_PER_M3;
  const conv = (v) => (Number.isFinite(Number(v)) ? Number((Number(v) * k).toFixed(2)) : v);
  const t = report.totals;
  t.totalTons = conv(t.totalTons);
  t.residualTons = conv(t.residualTons);
  t.hazardousTons = conv(t.hazardousTons);
  const rows = (list) =>
    (list || []).forEach((row) => {
      ["tons", "residualTons", "hazardousTons"].forEach((key) => {
        if (key in row) row[key] = conv(row[key]);
      });
      (row.items || []).forEach((item) => { item.tons = conv(item.tons); });
    });
  rows(report.monthly);
  rows(report.daily);
  [report.byHauler, report.byClient, report.byCell, report.byWasteType].forEach((list) =>
    (list || []).forEach((row) => { row.tons = row.m3; }),
  );
  (report.cells || []).forEach((cell) => {
    cell.capacity = conv(cell.capacity);
    cell.fill = conv(cell.fill);
    cell.remaining = conv(cell.remaining);
    cell.unit = unit;
  });
  return report;
}

const displayUnitOf = (u) => (/^m(3|³)$/i.test(String(u || "").trim()) ? M3 : TONS);

module.exports = { buildPortalReport, countsTowardVolume };
