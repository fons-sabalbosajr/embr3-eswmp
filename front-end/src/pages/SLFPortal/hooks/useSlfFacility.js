import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from "react";
import { normalizeBaselineMov, normalizeCellStatus } from "../helpers";
import { resolveFacilityUnit, resolveCellUnit, convertVolume } from "../../../utils/volumeUnits";
import {
  resolveCellName,
  isNonExistentCell,
  getCellStatusConfig,
  getCellAcceptance,
  cellDisabledLabel,
} from "../../../utils/cellVisuals";
import { resolveUploadCell } from "../uploadHelpers";
import { facilityCellRows } from "../submissionCellUsage";
import useBaselineDirty from "../useBaselineDirty";
import { baselineSignature } from "../baselineDirty";
import Swal from "sweetalert2";

export default function useSlfFacility({
  baselineForm, baselineLoading, baselineSaved, companyForm, haulers, isDeveloperContext,
  portalUser,
}) {
  // Means of Verification per baseline SECTION (Active Cells, Closed Cells,
  // Accredited Haulers), uploaded from each section card's header.
  const [baselineMov, setBaselineMov] = useState(() => normalizeBaselineMov(null));
  const [slfInfo, setSlfInfo] = useState(null);
  const [selectedSlfIdx, setSelectedSlfIdx] = useState(0); // for multi-SLF users
  const [activeCellEntries, setActiveCellEntries] = useState([]);
  // Closed cell entries (table-based)
  const [closedCellEntries, setClosedCellEntries] = useState([]);
  // Global baseline unit of measurement
  // The unit stored on the loaded baseline/record (historical). Starts EMPTY (not a
  // hard-coded unit) so display falls back to the centralized current SLF unit
  // (`slfUnit`) until a real per-record unit is loaded — a separate default here
  // was the classic stale-unit source flagged in Item #3.
  const [baselineUnit, setBaselineUnit] = useState("");
  const [acceptsHazardousWaste, setAcceptsHazardousWaste] = useState(false);

  // Fetch SLF facility operational info
  const activeSlfId = Array.isArray(portalUser?.assignedSlf)
    ? portalUser.assignedSlf[selectedSlfIdx] || portalUser.assignedSlf[0]
    : portalUser?.assignedSlf;
  const activeSlfName = Array.isArray(portalUser?.assignedSlfName)
    ? portalUser.assignedSlfName[selectedSlfIdx] ||
      portalUser.assignedSlfName[0]
    : portalUser?.assignedSlfName;
  // How many cells the facility ACTUALLY has.
  //
  // This used to be `numberOfCell || cellStatuses.length`, which silently dropped
  // cells: when an admin added a cell (populating cellCapacities/cellNames/…)
  // without `numberOfCell` catching up, the tail of the list was truncated — and
  // when numberOfCell was unset AND cellStatuses was empty, the count came out 0
  // and Data Entry showed NO cells at all. Widen to the same Math.max the admin's
  // canonical deriveCells() uses, so the Portal and the admin always agree on how
  // many cells exist.
  // Item #3: THE single source of truth for the assigned SLF's unit of measurement.
  // Derived from the facility config (slfInfo) via the shared resolver, so every
  // portal menu/modal reads the same value and it updates automatically when the
  // admin changes the SLF unit (slfInfo re-fetches on the "facility" data-refresh).
  // Never hard-code tons/m³ for the current unit — use this instead.
  const slfUnit = resolveFacilityUnit(slfInfo);

  // The unit the ADMIN declared for one cell (SLF form → cellCapacityUnits[i]),
  // falling back to the facility unit. Baseline cell entries always follow it —
  // the operator no longer chooses a unit per entry, which is what let the same
  // cell show m³ on the portal and tons on the admin side. The server applies the
  // same rule on save (utils/baselineCellEntries.js).
  const declaredCellUnit = useCallback(
    (cellIndex) =>
      Number.isInteger(cellIndex) && cellIndex >= 0
        ? resolveCellUnit(slfInfo, cellIndex)
        : slfUnit,
    [slfInfo, slfUnit],
  );

  // What a cell's CAPACITY is already committed to, in its fill unit: Waste in
  // Cell (baseline + approved) plus volume still pending review. Every portal
  // capacity gate reads this, not cellFillValues alone — pending volume left the
  // Waste in Cell figure (occupancy calc v6) but must still hold its space.
  const reservedCellFill = (index) =>
    Number(slfInfo?.cellFillValues?.[index] || 0) + Number(slfInfo?.cellFillPendingValues?.[index] || 0);

  const baselineCalcUnit = baselineUnit || slfUnit;
  const hasCellVolumeEntries = activeCellEntries.length > 0 || closedCellEntries.length > 0;
  const sumBaselineEntryVolume = useCallback(
    (entries = []) =>
      entries.reduce((sum, entry) => {
        const converted = convertVolume(
          entry?.volume,
          entry?.unit || baselineCalcUnit,
          baselineCalcUnit,
        );
        return sum + Number(converted || 0);
      }, 0),
    [baselineCalcUnit],
  );
  const computedTotalVolumeAccepted = useMemo(() => {
    const activeVolume = sumBaselineEntryVolume(activeCellEntries);
    const closedVolume = sumBaselineEntryVolume(closedCellEntries);
    return Math.max(0, Number((activeVolume + closedVolume).toFixed(2)));
  }, [activeCellEntries, closedCellEntries, sumBaselineEntryVolume]);

  // A cell-entry total only OVERRIDES the user's Total Volume Accepted when the
  // entries actually carry volumes.
  //
  // The presence of an entry row was previously enough: adding a cell row (or
  // migrating legacy flat fields into rows) with the volume left blank made the
  // computed total 0, which overwrote a previously-entered Total Volume Accepted
  // with 0 in the form AND sent that 0 to the server — where it is a valid
  // number, so the data-loss guard correctly applied it. That is why the value
  // "disappeared" right after saving.
  //
  // …and only while the baseline is UNLOCKED. The auto-calculation exists so that
  // EDITING the cell entries keeps the total honest — but a locked baseline's
  // entries cannot be edited, so recomputing there can only replace the stored
  // figure with a derived one. Two ways that bites:
  //   • Edit & Resubmit loads a reverted submission's cell entries — a SNAPSHOT
  //     taken when that submission was created — into the same state the baseline
  //     tab uses, and the recomputed sum was then sent as the record's Total
  //     Volume Accepted. Live data: 19 of the 26 outstanding reverted submissions
  //     would resubmit a substituted figure, e.g. Prime Waste Solution's real
  //     baseline of 596,981.38 going back as 318,065.35.
  //   • A locked baseline whose stored total legitimately differs from the sum of
  //     its rows (General Tinio stores 9 against rows summing 27) DISPLAYED the
  //     recomputed number, so the portal showed a figure the database did not hold.
  // Locked means "show what is stored", in both cases.
  const cellVolumeTotalIsAuthoritative =
    !baselineSaved && hasCellVolumeEntries && computedTotalVolumeAccepted > 0;

  useEffect(() => {
    if (!cellVolumeTotalIsAuthoritative) return;
    baselineForm.setFieldsValue({
      totalVolumeAccepted: computedTotalVolumeAccepted,
      totalVolumeAcceptedUnit: baselineCalcUnit,
    });
  }, [baselineCalcUnit, baselineForm, computedTotalVolumeAccepted, cellVolumeTotalIsAuthoritative]);

  const slfCellCount = Number(
    Math.max(
      Number(slfInfo?.numberOfCell || 0),
      slfInfo?.cellStatuses?.length || 0,
      slfInfo?.cellCapacities?.length || 0,
      slfInfo?.cellFillValues?.length || 0,
      slfInfo?.cellTypes?.length || 0,
      slfInfo?.cellNames?.length || 0,
    ),
  );

  // Cell naming precedence: the ADMIN's facility configuration is authoritative.
  //
  // This used to prefer the name copied into the baseline record, which is a
  // snapshot taken when the baseline was saved. Any baseline row saved without a
  // name (legacy flat fields migrated into entries carry neither cellName nor
  // cellIndex) therefore fell all the way through to the positional "Cell N"
  // fallback — which is why Active Cell names appeared to "reset to Cell 1"
  // after a save, and why an admin rename did not show up in the Portal.
  //
  // Order: admin's configured cellNames[index] → baseline snapshot → "Cell N".
  // Matching is by stable cellIndex only, never by array position.
  const baselineCellNameByIndex = {};
  (Array.isArray(activeCellEntries) ? activeCellEntries : []).forEach((e) => {
    if (e && typeof e.cellIndex === "number" && String(e.cellName || "").trim()) {
      baselineCellNameByIndex[e.cellIndex] = String(e.cellName).trim();
    }
  });
  const cellLabelFor = (index) => {
    const adminName = String(slfInfo?.cellNames?.[index] || "").trim();
    if (adminName) return adminName;
    return baselineCellNameByIndex[index] || resolveCellName(slfInfo, index);
  };

  /**
   * Resolve which configured cell a LEGACY flat baseline volume belongs to.
   *
   * Legacy baselines stored one number per waste type with no cell reference. To
   * migrate them into entry rows without losing identity, each volume is bound
   * to the first cell of the matching kind (hazardous/inert vs residual) with
   * the requested operational state — mirroring the server's findBestCellIndex
   * so the Portal and the backend agree on where a volume landed.
   *
   * Returns empty values when the facility declares no suitable cell, which
   * leaves the row unbound rather than pointing it at the wrong cell.
   */
  const matchBaselineCellForWasteType = useCallback(
    (baselineData, wasteType, { active = true } = {}) => {
      const empty = { cellIndex: null, cellName: "", cellType: "" };
      const count = Math.max(
        Number(slfInfo?.numberOfCell || 0),
        slfInfo?.cellStatuses?.length || 0,
        slfInfo?.cellTypes?.length || 0,
        slfInfo?.cellNames?.length || 0,
      );
      if (!count) return empty;

      const wantsHazardous = /haz|inert/i.test(String(wasteType || ""));
      let fallback = null;

      for (let index = 0; index < count; index += 1) {
        const status = slfInfo?.cellStatuses?.[index];
        if (isNonExistentCell(status)) continue;
        const isActive = getCellStatusConfig(status).key === "active";
        if (isActive !== active) continue;

        const cellType = slfInfo?.cellTypes?.[index] || "Residual";
        const candidate = {
          cellIndex: index,
          cellName: cellLabelFor(index),
          cellType,
        };
        if (/haz|inert/i.test(String(cellType)) === wantsHazardous) return candidate;
        if (!fallback) fallback = candidate;
      }

      return fallback || empty;
    },
    // cellLabelFor is derived from slfInfo + activeCellEntries on every render;
    // depending on slfInfo alone keeps this stable while still reflecting the
    // admin's current cell configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slfInfo],
  );

  const cellPlacementOptions = (() => {
    // Per-user cell access restriction (admin Manage Access). Empty => no restriction.
    const allowedCells = Array.isArray(portalUser?.portalAccess?.allowedCells)
      ? portalUser.portalAccess.allowedCells
          .map((c) => String(c || "").trim())
          .filter(Boolean)
      : [];
    return Array.from({ length: slfCellCount }, (_, index) => {
      const rawStatus = slfInfo?.cellStatuses?.[index];
      if (isNonExistentCell(rawStatus)) return null; // cell does not exist
      const status = normalizeCellStatus(rawStatus);
      const capUnit = resolveCellUnit(slfInfo, index, "capacity");
      const fillUnit = resolveCellUnit(slfInfo, index, "fill");
      const capacityM3 = convertVolume(slfInfo?.cellCapacities?.[index], capUnit, "m³") ?? 0;
      // Capacity gate: Waste in Cell (baseline + approved) PLUS volume still
      // pending review. Pending is not in the cell yet, but it is coming — leaving
      // it out would let several pending loads each pass this check and overfill
      // the cell once approved.
      const fillM3 = convertVolume(reservedCellFill(index), fillUnit, "m³") ?? 0;

      const acceptance = getCellAcceptance({
        status,
        capacity: capacityM3,
        fill: fillM3,
        exists: true,
      });

      // Admin per-cell submission toggle + per-user access are additional gates
      // beyond capacity/status.
      const submissionAllowed = slfInfo?.cellSubmissionAllowed?.[index] !== false;
      const cellValue = `Cell ${index + 1}`;
      const userAllowed = allowedCells.length === 0 || allowedCells.includes(cellValue);
      const available = acceptance.ok && submissionAllowed && userAllowed;
      const disabledReason = !acceptance.ok
        ? acceptance.reason
        : !submissionAllowed
          ? "Closed for submissions"
          : !userAllowed
            ? "Not assigned to you"
            : "";

      const baseLabel = cellLabelFor(index);
      const pickerUnit = baselineUnit || capUnit || slfUnit;
      const capDisplay = convertVolume(slfInfo?.cellCapacities?.[index], capUnit, pickerUnit);
      const usedDisplay = convertVolume(slfInfo?.cellFillValues?.[index], fillUnit, pickerUnit);
      const remainingDisplay =
        capDisplay != null && usedDisplay != null
          ? Math.max(0, capDisplay - usedDisplay)
          : capDisplay != null
            ? capDisplay
            : null;
      const typeLabel = slfInfo?.cellTypes?.[index] ? ` - ${slfInfo.cellTypes[index]}` : "";
      return {
        label: available
          ? `${baseLabel}${typeLabel}`
          : cellDisabledLabel(baseLabel, { reason: disabledReason }),
        value: cellValue,
        cellType: slfInfo?.cellTypes?.[index] || "Residual",
        cellIndex: index,
        cellName: baseLabel,
        facility: activeSlfName || slfInfo?.slfName || slfInfo?.lgu || "",
        status,
        capacity: capDisplay,
        used: usedDisplay,
        remaining: remainingDisplay,
        // Remaining in m³, for the "proposed <= remaining" numeric-integrity check.
        remainingM3: acceptance.remaining,
        utilization: acceptance.utilization,
        unit: pickerUnit,
        available,
        disabled: !available,
        disabledReason,
      };
    }).filter(Boolean);
  })();

  const activeCellOptions = cellPlacementOptions.filter((o) => o.available);

  // Bound to this SLF's open cells. ONE resolver shared by the upload parser and
  // the preview editor (see uploadHelpers#resolveUploadCell), so a cell typed or
  // picked in the preview resolves exactly like one that came from the file.
  const resolveUploadCellValue = (value) => resolveUploadCell(activeCellOptions, value);

  // The admin's cell records (name, status, capacity) for the Baseline tables'
  // Status column and anything else that needs "which cell is this entry".
  const facilityCells = useMemo(() => facilityCellRows(slfInfo, slfUnit), [slfInfo, slfUnit]);

  // ── Unsaved baseline edits (Option A: never autosaved, never silently lost) ──
  // Baseline changes go live only via Save Baseline Update. While an approved
  // update window is open this notices unsaved edits: "Unsaved changes" beside
  // the button, a prompt before the page is closed / logout / SLF switch, and a
  // remote baseline refresh (EMB saving the facility, an EMB client correction)
  // no longer reloads over them — see onFacilityRefresh.
  const baselineDirtyGuard = useBaselineDirty({
    enabled: !baselineSaved && !isDeveloperContext,
    loading: baselineLoading,
    getSignature: () =>
      baselineSignature({
        baseline: baselineForm.getFieldsValue(true),
        company: companyForm.getFieldsValue(true),
        activeCells: activeCellEntries,
        closedCells: closedCellEntries,
        haulers,
        mov: baselineMov,
        acceptsHazardous: acceptsHazardousWaste,
      }),
  });
  const baselineDirtyRef = useRef(() => false);
  useLayoutEffect(() => {
    baselineDirtyRef.current = baselineDirtyGuard.isDirtyNow;
  });
  const confirmDiscardBaseline = async (action) => {
    if (!baselineDirtyGuard.isDirtyNow()) return true;
    const { isConfirmed } = await Swal.fire({
      icon: "warning",
      title: "Unsaved baseline changes",
      html: `Your baseline edits have not been saved. ${action} will discard them.<br/><br/>Use <b>Save Baseline Update</b> first to keep them.`,
      showCancelButton: true,
      confirmButtonText: "Discard changes",
      confirmButtonColor: "#ff4d4f",
      cancelButtonText: "Keep editing",
    });
    return isConfirmed;
  };

  const baselineCellOptions = (() => {
    return Array.from({ length: slfCellCount }, (_, index) => {
      const rawStatus = slfInfo?.cellStatuses?.[index];
      if (isNonExistentCell(rawStatus)) return null;
      const status = normalizeCellStatus(rawStatus);
      const type = slfInfo?.cellTypes?.[index] || "Residual";
      const baseLabel = cellLabelFor(index);
      return {
        label: `${baseLabel} - ${type}${status ? ` (${status})` : ""}`,
        value: resolveCellName(slfInfo, index),
        cellType: type,
        cellIndex: index,
        status,
      };
    }).filter(Boolean);
  })();

  return {
    acceptsHazardousWaste, activeCellEntries, activeCellOptions, activeSlfId, activeSlfName,
    baselineCellOptions, baselineDirtyGuard, baselineDirtyRef, baselineMov, baselineUnit,
    cellPlacementOptions, cellVolumeTotalIsAuthoritative, closedCellEntries,
    computedTotalVolumeAccepted, confirmDiscardBaseline, declaredCellUnit, facilityCells,
    matchBaselineCellForWasteType, reservedCellFill, resolveUploadCellValue, selectedSlfIdx,
    setAcceptsHazardousWaste, setActiveCellEntries, setBaselineMov, setBaselineUnit,
    setClosedCellEntries, setSelectedSlfIdx, setSlfInfo, slfCellCount, slfInfo, slfUnit,
  };
}
