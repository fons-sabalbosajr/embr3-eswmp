import { useState, useRef, useCallback, useMemo } from "react";
import { convertVolume } from "../../../utils/volumeUnits";
import { getUnplacedSubmissions } from "../organizeCellsValidation";
import { ORGANIZE_CELLS_ENABLED } from "../constants";
import api from "../../../api";

export default function useCellOrganizer({
  activeCellOptions, cellPlacementOptions, haulers, portalSettings, slfUnit, submissions,
}) {
  // ── Cell Placement organizer (item #8): let users place PAST submissions'
  // waste into open cells so their disposals are organized per cell. ──
  const [cellOrganizerOpen, setCellOrganizerOpen] = useState(false);
  const [cellOrganizerData, setCellOrganizerData] = useState([]);
  // The organizer modal opens immediately and loads behind these.
  const [cellOrganizerLoading, setCellOrganizerLoading] = useState(false);
  const [cellOrganizerError, setCellOrganizerError] = useState(null);
  // expanded card keys  (array of sub._id strings)
  const [cellOrganizerExpanded, setCellOrganizerExpanded] = useState([]);
  // checked row keys  ("subId|truckIndex|vehicleIndex" or "subId|truckIndex|t")
  const [cellOrganizerSelected, setCellOrganizerSelected] = useState([]);
  // cell value to bulk-apply to all checked rows
  const [cellOrganizerBulkCell, setCellOrganizerBulkCell] = useState(undefined);
  // Pagination for the Organize Cell Placement modal (bulk submissions).
  const [cellOrganizerPage, setCellOrganizerPage] = useState(1);
  const [cellOrganizerPageSize, setCellOrganizerPageSize] = useState(5);
  const cellOrganizerLoadingRef = useRef(false);
  const [bulkOrganizeOpen, setBulkOrganizeOpen] = useState(false);
  const [cellInfraCollapsed, setCellInfraCollapsed] = useState(true);
  const capacityAllowancePct = (() => {
    const pct = Number(portalSettings?.truckCapacityAllowancePercent);
    return Number.isFinite(pct) && pct >= 0 ? pct : 10;
  })();

  const evaluateCapacity = useCallback(
    (actualVolume, actualVolumeUnit, capacity, capacityUnit) => {
      const cap = Number(capacity || 0);
      const vol = Number(actualVolume || 0);
      if (!(cap > 0) || !(vol > 0)) {
        return { hasCapacity: cap > 0, exceeded: false, maxAllowed: null };
      }
      const volInCapUnit = convertVolume(
        vol,
        actualVolumeUnit || capacityUnit || slfUnit,
        capacityUnit || slfUnit,
      );
      const maxAllowed = cap + (cap * capacityAllowancePct) / 100;
      // convertVolume returns NULL for a unit it cannot convert — deliberately,
      // so nothing counts an unlabelled figure as if it were in the target unit.
      // That null fell straight into the comparison below, and `null > anything`
      // is false, so a load in an unconvertible unit reported "not exceeded" and
      // sailed through the capacity gate no matter how large it was.
      //
      // Unconvertible is NOT "within capacity" — it is "not comparable", and the
      // caller has to say so rather than pass it. Reported, never silently
      // allowed and never silently blocked as an exceedance it isn't.
      if (volInCapUnit === null) {
        return { hasCapacity: true, exceeded: false, unconvertible: true, maxAllowed };
      }
      // Small epsilon so exact matches (e.g. 11 vs 11) are never flagged.
      return {
        hasCapacity: true,
        exceeded: volInCapUnit > maxAllowed + 1e-9,
        maxAllowed,
      };
    },
    [capacityAllowancePct],
  );

  // Effective capacity for a vehicle: its own capacity, else the parent truck's.
  const vehicleEffectiveCapacity = useCallback(
    (truck, vehicle) => ({
      capacity: vehicle?.capacity ?? truck?.truckCapacity ?? null,
      capacityUnit:
        vehicle?.capacityUnit || truck?.truckCapacityUnit || slfUnit,
    }),
    [],
  );

  const getDeclaredVehicleCapacity = useCallback(
    (haulerName, plateNumber) => {
      const plate = String(plateNumber || "").trim().toLowerCase();
      if (!plate) return null;
      const list = Array.isArray(haulers) ? haulers : [];
      const findPlate = (h) =>
        (h?.vehicles || []).find(
          (v) => String(v?.plateNumber || "").trim().toLowerCase() === plate,
        );
      const named = list.find((h) => h?.haulerName === haulerName);
      const match = (named && findPlate(named)) || list.map(findPlate).find(Boolean);
      const cap = Number(match?.capacity);
      return Number.isFinite(cap) && cap > 0 ? cap : null;
    },
    [haulers],
  );

  // Submissions with unassigned waste, INDEPENDENT of whether a cell can accept
  // it right now.
  //
  // This used to short-circuit to [] when no cell was available. The effect was
  // that the moment the active cell hit 100%, every approved-but-unassigned
  // submission silently disappeared from Organize Cells, the warning banner and
  // the pre-submit gate — the operator saw an empty organizer and no explanation,
  // and the work simply went untracked.
  //
  // Availability is an ASSIGNMENT-TIME constraint, not a visibility one: the rows
  // are always listed, and `activeCellOptions` still governs which cells may be
  // chosen, so a full cell can never be selected. See cellCapacityNotice below
  // for the warning shown in place of the old silent empty state.
  const unplacedSubmissions = useMemo(
    () => getUnplacedSubmissions(submissions),
    [submissions],
  );

  /**
   * Why waste cannot currently be placed, if that is the case.
   *
   * Drives the organizer's warning banner. `null` when at least one cell can
   * accept waste — the normal path, where no banner is shown at all.
   */
  const cellCapacityNotice = useMemo(() => {
    if (activeCellOptions.length > 0) return null;
    const blocked = cellPlacementOptions.filter((o) => !o.available);
    if (!blocked.length) return { kind: "no-cells", cells: [] };
    const full = blocked.filter((o) => /full|capacity/i.test(String(o.disabledReason || "")));
    return {
      kind: full.length ? "at-capacity" : "unavailable",
      cells: blocked.map((o) => ({ label: o.value, reason: o.disabledReason || "Unavailable" })),
    };
  }, [activeCellOptions.length, cellPlacementOptions]);

  const openCellOrganizer = async () => {
    if (!ORGANIZE_CELLS_ENABLED) return;
    if (cellOrganizerLoadingRef.current) {
      setCellOrganizerOpen(true);
      return;
    }
    cellOrganizerLoadingRef.current = true;
    setCellOrganizerData([]);
    setCellOrganizerExpanded([]);
    setCellOrganizerSelected([]);
    setCellOrganizerBulkCell(undefined);
    setCellOrganizerPage(1);
    setCellOrganizerError(null);
    setCellOrganizerLoading(true);
    setCellOrganizerOpen(true);

    try {
      const { data: full } = await api.post("/portal-auth/my-submissions/batch", {
        ids: unplacedSubmissions.map((s) => s._id),
        unassignedOnly: true,
      });
      const working = (Array.isArray(full) ? full : []).map((sub) => ({
        _id: sub._id,
        idNo: sub.idNo,
        submissionId: sub.submissionId,
        dateOfDisposal: sub.dateOfDisposal,
        lguCompanyName: sub.lguCompanyName,
        status: sub.status,
        // Each placement keeps its canonical truckIndex / vehicleIndex.
        //
        // A placement missing its Truck Capacity is pre-filled from the capacity
        // this SLF already declared for that plate on its baseline (the server
        // resolves it — see buildBaselineCapacityIndex). The operator confirms by
        // saving rather than re-typing a figure they have already encoded; a
        // plate with nothing on file is left blank and still asks for one.
        placements: (sub.placements || []).map((p) =>
          p.needsCapacity && !(Number(p.capacity) > 0) && Number(p.suggestedCapacity) > 0
            ? {
                ...p,
                capacity: Number(p.suggestedCapacity),
                capacityUnit: p.suggestedCapacityUnit || p.capacityUnit || "",
                capacityPrefilled: true,
              }
            : p,
        ),
      }));
      setCellOrganizerData(working);
    } catch (err) {
      // A 429 here means the limiter is throttling — surface a calm "try again
      // shortly" message and DO NOT auto-retry, so the modal never spins up another
      // request loop against the limiter.
      const status = err?.response?.status;
      setCellOrganizerError(
        status === 429
          ? "The server is busy right now. Please wait a few seconds and try again."
          : err.response?.data?.message ||
              "We couldn't load the submissions to organize. Please try again.",
      );
    } finally {
      cellOrganizerLoadingRef.current = false;
      setCellOrganizerLoading(false);
    }
  };

  return {
    bulkOrganizeOpen, capacityAllowancePct, cellCapacityNotice, cellInfraCollapsed,
    cellOrganizerBulkCell, cellOrganizerData, cellOrganizerError, cellOrganizerExpanded,
    cellOrganizerLoading, cellOrganizerOpen, cellOrganizerPage, cellOrganizerPageSize,
    cellOrganizerSelected, evaluateCapacity, getDeclaredVehicleCapacity, openCellOrganizer,
    setBulkOrganizeOpen, setCellInfraCollapsed, setCellOrganizerBulkCell, setCellOrganizerData,
    setCellOrganizerExpanded, setCellOrganizerOpen, setCellOrganizerPage, setCellOrganizerPageSize,
    setCellOrganizerSelected, unplacedSubmissions, vehicleEffectiveCapacity,
  };
}
