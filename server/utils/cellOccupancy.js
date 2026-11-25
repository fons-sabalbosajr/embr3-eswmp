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

/**
 * Submission statuses whose waste still STANDS (reports, received totals).
 * A reverted or rejected submission no longer stands; a resubmission does again.
 */
const ACTIVE_VOLUME_STATUSES = new Set(["pending", "acknowledged", "revert_requested"]);

/**
 * Statuses whose volume is IN THE CELL — the Waste in Cell formula:
 *
 *     Waste in Cell = baseline + APPROVED submissions
 *
 * "approved" is `acknowledged` (and the legacy spelling). `revert_requested` is an
 * approved entry the operator has asked to revert; until EMB actually reverts it,
 * it is still approved. A reverted entry is excluded until it is resubmitted and
 * approved again.
 *
 * PENDING volume is deliberately NOT in Waste in Cell, but it is still tracked per
 * cell (`cellFillPendingValues`) so the capacity gate can count it: otherwise
 * several pending loads could each pass the "is the cell full?" check and overfill
 * the cell once approved.
 */
const CELL_FILL_STATUSES = new Set(["acknowledged", "approved", "revert_requested"]);
const PENDING_STATUSES = new Set(["pending"]);

/** DataSLF fields the calculation needs; use as a `.select()` projection. */
const OCCUPANCY_ENTRY_FIELDS =
  "_id slfGenerator slfName status createdAt dataYear " +
  "totalVolumeAccepted totalVolumeAcceptedUnit baselineUnit " +
  "activeCellResidualVolume activeCellResidualUnit " +
  "activeCellInertVolume activeCellInertUnit " +
  "activeCellHazardousVolume activeCellHazardousUnit activeCellEntries closedCellEntries " +
  "trucks.actualVolume trucks.actualVolumeUnit trucks.wasteType trucks.cellIndex trucks.cellName " +
  "trucks.vehicles.actualVolume trucks.vehicles.actualVolumeUnit trucks.vehicles.cellIndex";

/**
 * The SAME projection as OCCUPANCY_ENTRY_FIELDS, expressed as a `find()`
 * projection object so it can additionally DROP zero-volume vehicles in the
 * database instead of shipping them.
 *
 * Why this exists: the all-facilities read (`GET /cell-occupancy`) pulls every
 * submission ever recorded in order to answer "how full is each cell?" —
 * measured on production, 830 entries carrying 24,699 trucks and 22,557
 * vehicles, of which 62% of the vehicles record NO volume at all. Those cannot
 * affect any figure: every consumer already filters vehicles to `actualVolume >
 * 0` before reading one (see computeCellOccupancy's per-truck loop and
 * hasTruckVolume), and resolveTargetUnit elects the unit from TRUCK-level rows
 * only. So they are pure transfer cost, and they grow with every submission.
 *
 * What is deliberately NOT filtered: `trucks` itself. chooseBaselineEntry
 * identifies the baseline container by `trucks.length === 0`, so dropping a
 * zero-volume TRUCK would let a submission pass for the baseline — which both
 * loses that submission's waste and dates the pre-baseline cutoff from the wrong
 * record. Every truck is mapped, only its vehicle list is filtered.
 *
 * Keep in step with OCCUPANCY_ENTRY_FIELDS — tests/cellOccupancyProjection.test.js
 * asserts the two select exactly the same paths.
 */
const OCCUPANCY_ENTRY_PROJECTION = {
  _id: 1,
  slfGenerator: 1,
  slfName: 1,
  status: 1,
  createdAt: 1,
  dataYear: 1,
  totalVolumeAccepted: 1,
  totalVolumeAcceptedUnit: 1,
  baselineUnit: 1,
  activeCellResidualVolume: 1,
  activeCellResidualUnit: 1,
  activeCellInertVolume: 1,
  activeCellInertUnit: 1,
  activeCellHazardousVolume: 1,
  activeCellHazardousUnit: 1,
  activeCellEntries: 1,
  closedCellEntries: 1,
  trucks: {
    $map: {
      input: { $ifNull: ["$trucks", []] },
      as: "t",
      in: {
        actualVolume: "$$t.actualVolume",
        actualVolumeUnit: "$$t.actualVolumeUnit",
        wasteType: "$$t.wasteType",
        cellIndex: "$$t.cellIndex",
        cellName: "$$t.cellName",
        vehicles: {
          $map: {
            input: {
              $filter: {
                input: { $ifNull: ["$$t.vehicles", []] },
                as: "v",
                cond: { $gt: [{ $ifNull: ["$$v.actualVolume", 0] }, 0] },
              },
            },
            as: "v",
            in: {
              actualVolume: "$$v.actualVolume",
              actualVolumeUnit: "$$v.actualVolumeUnit",
              cellIndex: "$$v.cellIndex",
            },
          },
        },
      },
    },
  },
};

/**
 * The SlfFacility fields the ADMIN OVERRIDE needs, as a `.select()` fragment.
 *
 * Every caller of computeCellOccupancy must project these. Leaving one out does
 * not fail loudly — it silently makes the override invisible to that reader, so
 * one screen shows the admin's figure and another shows the derived one. Naming
 * them once is what stops a projection from drifting.
 */
const OVERRIDE_FACILITY_FIELDS =
  "cellFillValues cellFillUnits cellFillOverridden " +
  "cellFillOverrideValues cellFillOverrideUnits cellFillOverrideAt cellFillOverrideBy";

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
    !!entry?.activeCellEntries?.length ||
    // A baseline that only declares CLOSED cells is still a baseline.
    !!entry?.closedCellEntries?.length
  );
}

/**
 * The unit every number in the result is expressed in: the unit the ADMIN
 * declared for the facility.
 *
 * It used to be "the first truck's unit", falling back to the baseline's — and
 * because the recompute then WRITES that unit back as `wasteReceivedUnit`, one
 * load typed in tons silently re-declared an m³ facility as tons. That is how
 * General Tinio came to show capacities in m³ beside fill in tons, and why admin
 * and portal could disagree. The declared capacity units come first because they
 * are only ever set by an admin; `wasteReceivedUnit` is last among the facility
 * fields because this recompute writes it. Submission/baseline units are only a
 * last resort for a facility that declares nothing.
 */
function resolveTargetUnit(baseline, submissions, facility) {
  const known = (u) => /^(m³|m3|tons?)$/i.test(String(u || "").trim());
  const declared = [
    facility?.volumeCapacityUnit,
    ...(facility?.cellCapacityUnits || []),
    facility?.wasteReceivedUnit,
    facility?.receivingVolumeCapacityUnit,
    facility?.estimatedVolumeWasteUnit,
  ].find(known);
  if (declared) return displayUnit(declared);
  return displayUnit(
    baseline?.baselineUnit ||
      baseline?.totalVolumeAcceptedUnit ||
      (baseline?.activeCellEntries || []).find((entry) => Number(entry?.volume || 0) > 0 && entry.unit)?.unit ||
      submissions
        .flatMap((entry) => entry.trucks || [])
        .find((truck) => Number(truck?.actualVolume || 0) > 0 && truck.actualVolumeUnit)?.actualVolumeUnit ||
      "m³",
  );
}

/**
 * The cell a BASELINE row belongs to: its stored, in-range `cellIndex` first
 * (the stable link written on every save), then an exact name match, then the
 * "Cell N" convention. Returns null when nothing identifies a cell.
 *
 * Parsing the name first was wrong for named cells — "Treated Hazardous Waste
 * Cell (M501)" parsed as cell 501 and fell through to a guess.
 */
function baselineRowCellIndex(facility, rows, entry) {
  const raw = entry?.cellIndex;
  const stored = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  if (Number.isInteger(stored) && stored >= 0 && rows[stored]) return stored;
  const name = String(entry?.cellName || "").trim().toLowerCase();
  if (name) {
    const byName = (facility?.cellNames || []).findIndex((n) => String(n || "").trim().toLowerCase() === name);
    if (byName >= 0 && rows[byName]) return byName;
    const positional = /^\s*cell\s*0*(\d+)\s*$/i.exec(name);
    if (positional) {
      const idx = Number(positional[1]) - 1;
      if (idx >= 0 && rows[idx]) return idx;
    }
  }
  return null;
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

function addVolume(rows, index, value, fromUnit, targetUnit, source, afterOverride = false) {
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
  if (source === "submitted") {
    row.submitted += converted;
    // Kept beside the full submitted figure, never instead of it: this is the
    // slice that arrived AFTER an admin declared this cell's volume, and it is
    // the only part that may be added on top of that declaration. See
    // readCellOverride.
    if (afterOverride) row.submittedAfterOverride += converted;
  } else row.baseline += converted;
}

/**
 * The admin's DECLARED Waste in Cell for one cell — the manual BASE, not the
 * effective total.
 *
 * ── Why the base is stored separately from `cellFillValues` ─────────────────
 * `cellFillValues[i]` is the EFFECTIVE volume every consumer renders, and it is
 * rewritten by every recompute. When the override was a plain replacement the
 * two happened to be the same number, so the base could be read back out of it.
 * They are no longer the same: an approved submission recorded after the
 * declaration is ADDED to it (see the "Admin override" block in
 * computeCellOccupancy), so reading the base back out of `cellFillValues` would
 * feed the previous EFFECTIVE total in as the next BASE and compound the
 * override on every recompute.
 *
 * `cellFillOverrideValues[i]` therefore holds the declared figure, in
 * `cellFillOverrideUnits[i]`, declared at `cellFillOverrideAt[i]`. Only the
 * admin form writes them; no recompute ever touches them.
 *
 * LEGACY RECORDS. A cell flagged before those fields existed has no base and no
 * timestamp. It falls back to `cellFillValues[i]` and accumulates NOTHING —
 * exactly the replace-forever behaviour it already had — so an un-migrated
 * facility cannot compound. Accumulation needs BOTH an explicit base and a
 * timestamp, which are only ever written together.
 */
function readCellOverride(facility, index) {
  if (!facility?.cellFillOverridden?.[index]) return null;
  const isBlank = (v) => v === null || v === undefined || v === "";
  const declared = facility?.cellFillOverrideValues?.[index];
  const at = facility?.cellFillOverrideAt?.[index];
  if (!isBlank(declared) && at) {
    const stamped = new Date(at);
    if (!Number.isNaN(stamped.getTime())) {
      return {
        value: Number(declared),
        unit: facility?.cellFillOverrideUnits?.[index] || facility?.cellFillUnits?.[index] || null,
        at: stamped,
        accumulates: true,
      };
    }
  }
  const fallback = isBlank(declared) ? facility?.cellFillValues?.[index] : declared;
  if (isBlank(fallback)) return null;
  return {
    value: Number(fallback),
    unit: facility?.cellFillOverrideUnits?.[index] || facility?.cellFillUnits?.[index] || null,
    at: null,
    accumulates: false,
  };
}

/**
 * Was this submission RECORDED after the admin declared the cell's volume?
 *
 * Keyed on `createdAt` — when the record came into existence — and deliberately
 * NOT on the disposal date. Everything that already existed when the admin typed
 * the figure was part of the total they were looking at and chose to replace;
 * re-adding it would double-count the very waste the declaration was correcting.
 * A record created afterwards is new information the declaration could not have
 * accounted for, so it accumulates.
 *
 * Note that a pending submission ALREADY counts toward occupancy
 * (ACTIVE_VOLUME_STATUSES), so a record created before the declaration and
 * merely acknowledged after it was visible to the admin too — approval is not
 * what makes a volume new.
 */
function isRecordedAfter(entry, at) {
  if (!at || !entry?.createdAt) return false;
  const created = new Date(entry.createdAt);
  return !Number.isNaN(created.getTime()) && created > at;
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
    // The part of `submitted` that was recorded after this cell's admin
    // declaration. Zero for every cell that has no accumulating override.
    submittedAfterOverride: 0,
    // Placed by submissions still PENDING review — not in Waste in Cell, but
    // reserved against the cell's capacity (see CELL_FILL_STATUSES).
    pending: 0,
    unconvertible: 0,
    status: normalizeCellStatus(facility?.cellStatuses?.[index]),
    hazardous: isHazardousCell(facility?.cellTypes?.[index] || "Residual"),
  }));

  // The newest record that actually carries baseline figures IS the baseline;
  // it is never also counted as a submission.
  const baseline = chooseBaselineEntry(entries);
  const baselineId = baseline?._id ? String(baseline._id) : "";

  const isSubmission = (entry) => String(entry._id || "") !== baselineId && hasTruckVolume(entry);
  // Waste in Cell = baseline + APPROVED submissions. Reverted/rejected never count.
  const submissions = entries.filter(
    (entry) => CELL_FILL_STATUSES.has(entry.status || "pending") && isSubmission(entry),
  );
  const pendingSubmissions = entries.filter(
    (entry) => PENDING_STATUSES.has(entry.status || "pending") && isSubmission(entry),
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
  //
  // ACTIVE and CLOSED cell entries both belong in their cells — a closed cell
  // still holds the waste disposed into it. Closed entries were never counted,
  // so a Used/Completed cell always read 0 however much its baseline declared.
  // A closed entry is only placed when it identifies a real cell; it is never
  // guessed into an open one.
  let unplacedBaselineTotal = 0;
  if (baseline?.activeCellEntries?.length) {
    baseline.activeCellEntries.forEach((entry, orderIndex) => {
      const bound = baselineRowCellIndex(facility, rows, entry);
      // Legacy rows with no usable cell keep the old placement (name ordinal,
      // then list position) so their figures do not vanish.
      const parsed = parseCellIndex(entry.cellName);
      const preferred = bound ?? (parsed != null && parsed >= 0 && rows[parsed] ? parsed : orderIndex);
      addVolume(
        rows,
        findBestCellIndex(rows, entry.wasteType, preferred),
        entry.volume,
        entry.unit || baseline.baselineUnit || targetUnit,
        targetUnit,
        "baseline",
      );
    });
  }
  (baseline?.closedCellEntries || []).forEach((entry) => {
    const bound = baselineRowCellIndex(facility, rows, entry);
    const fromUnit = entry.unit || baseline.baselineUnit || targetUnit;
    if (bound === null) {
      const converted = convertVolume(Number(entry.volume || 0), fromUnit, targetUnit);
      if (converted && converted > 0) unplacedBaselineTotal += converted;
      return;
    }
    addVolume(rows, bound, entry.volume, fromUnit, targetUnit, "baseline");
  });
  if (!baseline?.activeCellEntries?.length && baseline) {
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
  let pendingUnplacedTotal = 0;
  const placeSubmitted = (volume, fromUnit, wasteType, cellIndex, entry) => {
    const explicit =
      cellIndex === null || cellIndex === undefined || cellIndex === "" ? null : Number(cellIndex);
    const placed = explicit !== null && Number.isInteger(explicit) && explicit >= 0 && rows[explicit];
    // PENDING: reserved against the cell's capacity only. It is in neither
    // Waste in Cell nor the received total until EMB approves it.
    if (PENDING_STATUSES.has(entry.status || "pending")) {
      const converted = convertVolume(Number(volume || 0), fromUnit, targetUnit);
      if (!(converted && converted > 0)) return;
      if (placed) rows[findBestCellIndex(rows, wasteType, explicit)].pending += converted;
      else pendingUnplacedTotal += converted;
      return;
    }
    if (!placed) {
      const converted = convertVolume(Number(volume || 0), fromUnit, targetUnit);
      if (converted && converted > 0) unplacedTotal += converted;
      return;
    }
    addVolume(rows, findBestCellIndex(rows, wasteType, explicit), volume, fromUnit, targetUnit, "submitted");
  };

  [...submissions, ...pendingSubmissions].forEach((entry) => {
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
            entry,
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
        entry,
      );
    });
  });

  // ── No admin override ──
  //
  // Waste in Cell is ALWAYS the formula: baseline + approved submissions. An
  // admin-typed figure used to REPLACE it (cellFillOverridden), which is how
  // Porac's cells read 1,310,353 / 683,202 m³ while their own baseline alone was
  // 1,758,761 / 1,969,689 m³ — the baseline and every approved submission were
  // invisible, and the View and Edit modals could disagree. To change a cell's
  // figure, correct the BASELINE (or the submission); the formula then carries
  // it everywhere. The stored override fields are left untouched for audit and
  // only surfaced as `legacyOverride` so a screen can say what was ignored.
  rows.forEach((row) => {
    const legacy = readCellOverride(facility, row.index);
    if (legacy) row.legacyOverride = round3(legacy.value);
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
    // Pending-review volume per cell, reserved against capacity (not in fill).
    cellFillPendingValues: rows.map((row) => round3(row.pending)),
    pendingTotal: round3(rows.reduce((sum, row) => sum + row.pending, 0) + pendingUnplacedTotal),
    // A closed-cell baseline row that names no real cell.
    unplacedBaselineTotal: round3(unplacedBaselineTotal),
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
/**
 * WHEN the baseline was encoded — the date the rule below cuts on.
 *
 * For an SLF with a real baseline-only CONTAINER this is simply that container's
 * createdAt: it is the record the portal writes when the operator saves their
 * baseline, so it dates the encoding exactly.
 *
 * Where there is NO container the figures live on the submissions themselves, and
 * every submission carries its own COPY of the baseline block. chooseBaselineEntry
 * then falls through to the first `isBaselineEntry` in a list sorted newest-first —
 * i.e. the NEWEST submission — and using that record's createdAt as the cutoff is
 * self-defeating: the newest submission is always "the baseline", so the cutoff is
 * always ~now, and every other submission is older than it. Measured on production:
 * Porac counted 1 of 80 submissions, Limay 1 of 87, Floridablanca 1 of 59 — 545
 * submissions excluded across 13 facilities, every one of them reporting exactly
 * 0 submitted volume. It is not a threshold those facilities were failing to
 * clear; no submission could EVER be counted, so Waste in Cell could never move.
 *
 * The encoding happened when those figures FIRST existed, so the cutoff is taken
 * from the EARLIEST record carrying baseline figures. The rule keeps doing what it
 * is for — waste disposed before the baseline was encoded stays inside the baseline
 * total and is not added again — while a submission recorded afterwards can
 * actually count.
 */
/**
 * The baseline FIGURES a record carries, as a comparable string. Two records
 * with the same fingerprint carry the same encoded baseline; a different one
 * means the operator re-encoded it.
 *
 * Only what the operator ENCODES: Total Volume Accepted and each cell's volume,
 * in cell order. Deliberately left out — measured against production copies of
 * the same baseline — are fields that change without any re-encoding: cell names
 * (renamed later), `cellIndex` (backfilled onto older copies), and the
 * residual/inert/hazardous rollups (recomputed from the cells on each save).
 */
function baselineFingerprint(entry) {
  const n = (v) => (v == null || v === "" ? "" : String(Math.round(Number(v) * 1000)));
  const cells = (entry?.activeCellEntries || []).map((c) => n(c?.volume)).join(",");
  return `${n(entry?.totalVolumeAccepted)}|${cells}`;
}

function baselineCutoffDate(entries, baselineEntry) {
  if (!baselineEntry) return null;
  const chosen = baselineEntry.createdAt ? new Date(baselineEntry.createdAt) : null;
  // A CONTAINER dates the encoding from the first record that carried the SAME
  // figures. Containers were introduced after many SLFs already kept their
  // baseline on their submissions, and the portal's first baseline save COPIED
  // those figures into a new container — so its createdAt is the copy date, not
  // the encoding date. Taking it at face value excluded every submission in
  // between: measured on production, Limay (figures unchanged since 2026-05-15,
  // container 2026-08-29) lost 94 submissions from its cells, Prime Waste
  // Solution 21, Maria Aurora 19. A container whose figures appear on no earlier
  // record WAS a re-encoding (Porac, Floridablanca) and keeps its own date — that
  // re-encoded total already includes the waste disposed before it.
  if (!(baselineEntry.trucks || []).length) {
    const key = baselineFingerprint(baselineEntry);
    let earliest = chosen;
    for (const entry of entries) {
      if (!entry?.createdAt || !isBaselineEntry(entry)) continue;
      if (baselineFingerprint(entry) !== key) continue;
      const at = new Date(entry.createdAt);
      if (Number.isNaN(at.getTime())) continue;
      if (!earliest || at < earliest) earliest = at;
    }
    return earliest;
  }
  let earliest = chosen;
  for (const entry of entries) {
    if (!isBaselineEntry(entry) || !entry?.createdAt) continue;
    const at = new Date(entry.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    if (!earliest || at < earliest) earliest = at;
  }
  return earliest;
}

function applyPreBaselineRule(entries = [], { exclude = true } = {}) {
  const baselineEntry = chooseBaselineEntry(entries);
  const baselineDate = baselineCutoffDate(entries, baselineEntry);
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
 *   3 — an admin-declared Waste in Cell is a BASE, not a replacement: submissions
 *       recorded after the declaration are added to it instead of being
 *       discarded. Every facility carrying an accumulating override needs its
 *       stored figure recomputed under the new rule.
 *   4 — the pre-baseline cutoff is dated from the EARLIEST record carrying
 *       baseline figures, not the newest copy (see baselineCutoffDate). At an SLF
 *       with no baseline container the newest submission was always being treated
 *       as "the baseline", so the cutoff sat at ~now and every submission was
 *       excluded — 545 of them across 13 facilities, each stuck at 0 submitted
 *       volume. Their stored figures were written under that rule and must be
 *       recomputed.
 *   5 — a baseline CONTAINER that merely copied figures already carried by
 *       earlier records is dated from the first record with those figures, not
 *       from the copy (see baselineCutoffDate). Limay, Prime Waste Solution and
 *       Maria Aurora had submissions excluded under the old date.
 *   6 — Waste in Cell = baseline + APPROVED submissions only (pending is
 *       reserved against capacity in cellFillPendingValues, reverted never
 *       counts); admin-typed overrides no longer replace the formula; closed-cell
 *       baseline entries are placed in their cells; baseline rows bind by their
 *       stored cellIndex; the unit is the facility's DECLARED unit, not the first
 *       truck's.
 *   7 — the persisted figures count the SAME submissions as the admin rollups:
 *       every year (the year-visibility filter dropped hidden years from the
 *       stored figures only, so with "hide historical records" on the portal and
 *       the capacity gate read emptier cells than the admin), and a test facility
 *       counts its own test submissions.
 */
const OCCUPANCY_CALC_VERSION = 7;

module.exports = {
  computeCellOccupancy,
  OCCUPANCY_CALC_VERSION,
  applyPreBaselineRule,
  chooseBaselineEntry,
  preBaselineExclusionEnabled,
  baselineCutoffDate,
  baselineFingerprint,
  isBaselineEntry,
  readCellOverride,
  isRecordedAfter,
  OVERRIDE_FACILITY_FIELDS,
  ACTIVE_VOLUME_STATUSES,
  CELL_FILL_STATUSES,
  PENDING_STATUSES,
  OCCUPANCY_ENTRY_FIELDS,
  OCCUPANCY_ENTRY_PROJECTION,
  isActiveCellStatus,
  normalizeCellStatus,
  parseCellIndex,
  findBestCellIndex,
  isHazardousWaste,
  isHazardousCell,
  displayUnit,
};
