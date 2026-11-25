import { useState, useMemo } from "react";
import {
  splitOrganizerWork,
  organizerProgress,
  plannedM3ByCell,
  roomLeftM3,
  applyCellToRows,
  autoPlace,
} from "../organizeCellRules";
import { convertVolume } from "../../../utils/volumeUnits";
import { message } from "antd";
import api from "../../../api";
import Swal from "sweetalert2";

export default function useOrganizerEditing({
  activeCellOptions, baselineUnit, cellOrganizerBulkCell, cellOrganizerData, cellOrganizerSelected,
  portalUser, setCellOrganizerBulkCell, setCellOrganizerData, setCellOrganizerExpanded,
  setCellOrganizerOpen, setCellOrganizerSelected, showError, slfUnit, late,
}) {
  const [slfInfoRefresh, setSlfInfoRefresh] = useState(0);
  const [cellOrganizerSaving, setCellOrganizerSaving] = useState(false);

  // The organizer's two jobs, and the session's progress — see organizeCellRules.
  // Placed waste never appears as placement work: it is only listed (separately)
  // when it is still missing a Truck Capacity.
  const organizerWork = useMemo(() => splitOrganizerWork(cellOrganizerData), [cellOrganizerData]);
  const organizerStats = useMemo(() => organizerProgress(cellOrganizerData), [cellOrganizerData]);
  // m³ already chosen per cell in this session — every cell picker counts it.
  const organizerPlanned = useMemo(() => plannedM3ByCell(cellOrganizerData), [cellOrganizerData]);

  // " · 1,234 m³ left" — the cell's room once this session's choices are taken,
  // in the unit the cell picker shows. Empty for a cell with no declared capacity.
  const cellRoomLabel = (opt, planned) => {
    const room = roomLeftM3(opt, planned);
    if (!Number.isFinite(room)) return "";
    const unit = String(opt?.unit || "m³").replace("m3", "m³");
    const shown = convertVolume(room, "m³", unit) ?? room;
    return ` · ${Number(shown).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit} left`;
  };

  const cellPatchFor = (opt) => ({
    cellName: opt?.value || "",
    cellType: opt?.cellType || "",
    cellIndex: opt && typeof opt.cellIndex === "number" ? opt.cellIndex : null,
  });

  // Assign a cell to ONE unassigned placement, addressed by its canonical
  // truckIndex/vehicleIndex (which the server preserved).
  const updateOrganizerCell = (subId, truckIndex, vehicleIndex, cellValue) => {
    const opt = activeCellOptions.find((o) => o.value === cellValue);
    const patch = cellValue ? cellPatchFor(opt) : { cellName: "", cellType: "", cellIndex: null };
    setCellOrganizerData((prev) =>
      prev.map((sub) => {
        if (sub._id !== subId) return sub;
        return {
          ...sub,
          placements: (sub.placements || []).map((p) =>
            p.truckIndex === truckIndex && p.vehicleIndex === vehicleIndex
              ? { ...p, ...patch }
              : p,
          ),
        };
      }),
    );
  };

  // Complete a missing historical Truck Capacity for ONE placement, addressed by
  // its canonical truckIndex/vehicleIndex. Stored in the declared baseline unit.
  // How many capacities the baseline filled in and the operator has not yet
  // overridden — surfaced in the organizer so the prefill is never silent.
  const prefilledCapacityCount = useMemo(
    () =>
      cellOrganizerData.reduce(
        (total, sub) =>
          total +
          (sub.placements || []).filter((p) => p.capacityPrefilled && Number(p.capacity) > 0).length,
        0,
      ),
    [cellOrganizerData],
  );

  const updateOrganizerCapacity = (subId, truckIndex, vehicleIndex, capacityValue) => {
    setCellOrganizerData((prev) =>
      prev.map((sub) => {
        if (sub._id !== subId) return sub;
        return {
          ...sub,
          placements: (sub.placements || []).map((p) =>
            p.truckIndex === truckIndex && p.vehicleIndex === vehicleIndex
              ? {
                  ...p,
                  capacity: capacityValue,
                  capacityUnit: baselineUnit || p.capacityUnit || slfUnit,
                  // Once the operator types over it, it is their figure, not the
                  // baseline's — drop the label.
                  capacityPrefilled: false,
                }
              : p,
          ),
        };
      }),
    );
  };

  // Apply the bulk cell to the checked rows — only those it can legally take.
  // It used to write the chosen cell into EVERY checked row: a residual cell into
  // a hazardous load, or past the cell's remaining room.
  const applyBulkCellToSelected = () => {
    if (!cellOrganizerBulkCell || cellOrganizerSelected.length === 0) return;
    const opt = activeCellOptions.find((o) => o.value === cellOrganizerBulkCell);
    if (!opt) return;
    const res = applyCellToRows(cellOrganizerData, cellOrganizerSelected, opt, cellPatchFor);
    setCellOrganizerData(res.data);
    setCellOrganizerSelected([]);
    setCellOrganizerBulkCell(undefined);
    const skippedTotal = res.skipped.type + res.skipped.capacity;
    if (skippedTotal) {
      const parts = [];
      if (res.skipped.type) parts.push(`${res.skipped.type} whose waste type does not fit ${opt.cellName || opt.value}`);
      if (res.skipped.capacity) parts.push(`${res.skipped.capacity} that would exceed its remaining room`);
      message.warning(`Placed ${res.applied} row(s). Skipped ${parts.join(" and ")}.`, 6);
    } else {
      message.success(`Placed ${res.applied} row(s) in ${opt.cellName || opt.value}.`);
    }
  };

  // Auto-place every row that has no cell yet into the type-compatible open cell
  // with the most room left, largest loads first. Nothing is saved — the operator
  // reviews the choices and presses Save Placement.
  const autoPlaceOrganizer = () => {
    const res = autoPlace(cellOrganizerData, activeCellOptions, cellPatchFor);
    setCellOrganizerData(res.data);
    if (!res.placed && !res.unplaceable) {
      message.info("Every row already has a cell selected.");
    } else if (res.unplaceable) {
      message.warning(
        `Placed ${res.placed} row(s). ${res.unplaceable} could not be placed — no open cell of the right type has room for them.`,
        6,
      );
    } else {
      message.success(`Placed ${res.placed} row(s). Review the cells, then Save Placement.`);
    }
  };

  const saveCellOrganizer = async () => {
    setCellOrganizerSaving(true);
    try {
      // Only placements the user actually completed are sent: a newly-assigned
      // cell, a newly-filled Truck Capacity, or both. Untouched rows stay
      // incomplete (and keep blocking new submissions until organized). A
      // capacity-only row carries no cell fields, so the server never clears an
      // existing cell.
      const isPos = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
      const pending = cellOrganizerData
        .map((sub) => ({
          _id: sub._id,
          assignments: (sub.placements || [])
            .map((p) => {
              // A placement counts as carrying a cell only with a VALID cell
              // IDENTIFIER. A legacy row can hold a cellName copy with no
              // cellIndex — the server treats that as unassigned (which is why it
              // is offered here). Sending it as `{ cellIndex: null, cellName }`
              // made the backend skip the row while the modal still reported
              // "Waste Placement Saved", so the arrangement never persisted.
              //
              // Only waste that NEEDED a cell sends one. Placed waste listed for
              // its capacity already carries its own cell, and re-sending it made
              // every untouched capacity row look like a change — so "Nothing to
              // Save" could never fire.
              const hasCell = p.needsCell !== false && !!p.cellName && Number.isInteger(p.cellIndex);
              const providesCapacity = p.needsCapacity && isPos(p.capacity);
              if (!hasCell && !providesCapacity) return null; // untouched / still incomplete
              return {
                truckIndex: p.truckIndex,
                // null vehicleIndex = truck-level placement (the backend distinguishes)
                ...(Number.isInteger(p.vehicleIndex) ? { vehicleIndex: p.vehicleIndex } : {}),
                ...(hasCell
                  ? { cellIndex: p.cellIndex, cellName: p.cellName, cellType: p.cellType }
                  : {}),
                ...(providesCapacity
                  ? {
                      truckCapacity: Number(p.capacity),
                      truckCapacityUnit: baselineUnit || p.capacityUnit || slfUnit,
                    }
                  : {}),
              };
            })
            .filter(Boolean),
        }))
        .filter((s) => s.assignments.length > 0);

      if (pending.length === 0) {
        setCellOrganizerSaving(false);
        showError({
          type: "error",
          title: "Nothing to Save",
          message: "Assign a cell or enter a Truck Capacity for at least one entry before saving.",
        });
        return;
      }

      // Bounded concurrency: fast, without firing one request per submission at once.
      const CONCURRENCY = 4;
      for (let i = 0; i < pending.length; i += CONCURRENCY) {
        await Promise.all(
          pending.slice(i, i + CONCURRENCY).map((sub) =>
            api.patch(`/data-slf/${sub._id}/portal-cell-assignments`, {
              submittedBy: portalUser?.email,
              assignments: sub.assignments,
            }),
          ),
        );
      }
      Swal.fire({
        icon: "success",
        title: "Waste Placement Saved",
        text: "Your past submissions have been organized into the selected cells.",
        confirmButtonColor: "#1a3353",
      });
      setCellOrganizerOpen(false);
      setCellOrganizerData([]); // release the full trucks[] working copy
      setCellOrganizerSelected([]);
      setCellOrganizerExpanded([]);
      // Forced: organizing changes each submission's unplaced/missing-capacity
      // counts, and a cached list would keep showing them as still needing work.
      late.fetchSubmissions(true, true);
      // Refresh facility info so the Organized Cells menu reflects the new fills.
      setSlfInfoRefresh((n) => n + 1);
    } catch (err) {
      showError({
        type: "error",
        title: "Could Not Save",
        message:
          err.response?.data?.message ||
          "Something went wrong while saving cell placements. Please try again.",
      });
    } finally {
      setCellOrganizerSaving(false);
    }
  };

  return {
    applyBulkCellToSelected, autoPlaceOrganizer, cellOrganizerSaving, cellRoomLabel,
    organizerPlanned, organizerStats, organizerWork, prefilledCapacityCount, saveCellOrganizer,
    setSlfInfoRefresh, slfInfoRefresh, updateOrganizerCapacity, updateOrganizerCell,
  };
}
