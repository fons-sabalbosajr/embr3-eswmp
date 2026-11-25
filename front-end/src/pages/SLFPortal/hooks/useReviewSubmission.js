import { normalizeUnit } from "../helpers";
import Swal from "sweetalert2";
import { resolveTotalVolumeForSave } from "../portalShared";
import { mergeHaulersByName } from "../haulerNormalization";
import { useCallback, useMemo } from "react";

export default function useReviewSubmission({
  acceptsHazardousWaste, activeCellEntries, activeCellOptions, activeSlfId, activeSlfName,
  baselineForm, baselineSaved, baselineTotalVolume, baselineUnit, cellVolumeTotalIsAuthoritative,
  cleanTruckForSubmit, closedCellEntries, companyForm, computedTotalVolumeAccepted,
  editingRevertedId, entryForm, evaluateCapacity, haulers, missingHazardousCodeTrucks, setActiveTab,
  setReviewModalOpen, showError, slfInfo, slfUnit, submissions, trucks, vehicleEffectiveCapacity,
}) {
  // ── Review & Submit handlers ──

  const handleReviewOpen = async () => {
    try {
      await companyForm.validateFields();
    } catch {
      showError({
        type: "warning",
        title: "Incomplete General Information",
        message: "Please complete the required General Information fields first.",
      });
      setActiveTab("basic-info");
      return;
    }
    if (!baselineSaved) {
      try {
        await baselineForm.validateFields();
      } catch {
        showError({
          type: "warning",
          title: "Incomplete Baseline",
          message: "Please complete the Baseline Data tab first.",
        });
        setActiveTab("baseline");
        return;
      }
    }
    try {
      await entryForm.validateFields();
    } catch {
      showError({
        type: "warning",
        title: "Incomplete Disposal Report",
        message:
          "Please complete all required fields in the Disposal Report tab.",
      });
      setActiveTab("disposal");
      return;
    }
    if (trucks.length === 0) {
      showError({
        type: "warning",
        title: "No Entries Added",
        message: "Please add at least one transport entry.",
      });
      setActiveTab("disposal");
      return;
    }
    if (missingHazardousCodeTrucks.length > 0) {
      const list = missingHazardousCodeTrucks
        .map(
          (truck, index) =>
            truck.disposalTicketNo || truck.plateNumber || `Truck ${index + 1}`,
        )
        .join(", ");
      showError({
        type: "warning",
        title: "Hazardous Waste Code Required",
        message: `Please encode Hazardous Waste Code for Treated Hazardous Waste entries: ${list}.`,
      });
      setActiveTab("disposal");
      return;
    }

    // ── Unit-conflict check ──
    const currentUnit = normalizeUnit(baselineUnit || slfUnit);
    const conflictingTrucks = trucks.filter((truck) => {
      const truckUnit = normalizeUnit(truck.actualVolumeUnit || baselineUnit || slfUnit);
      return truckUnit !== currentUnit;
    });
    if (conflictingTrucks.length > 0) {
      const unitSet = [...new Set(conflictingTrucks.map((t) => normalizeUnit(t.actualVolumeUnit || baselineUnit || slfUnit)))];
      const { isConfirmed } = await Swal.fire({
        icon: "warning",
        title: "Unit of Measurement Mismatch",
        html: `<p style='font-size:13px;text-align:left'>
          <b>${conflictingTrucks.length}</b> transport entr${conflictingTrucks.length === 1 ? "y has" : "ies have"} a volume unit
          (<b>${unitSet.join(", ")}</b>) that differs from the current baseline unit
          (<b>${currentUnit}</b>).<br/><br/>
          This may cause incorrect volume calculations on the admin side.
          Please verify the units are correct before proceeding.
        </p>`,
        showCancelButton: true,
        confirmButtonText: "Submit Anyway",
        cancelButtonText: "Go Back & Fix",
        confirmButtonColor: "#faad14",
        cancelButtonColor: "#1a3353",
      });
      if (!isConfirmed) {
        setActiveTab("disposal");
        return;
      }
    }

    setReviewModalOpen(true);
  };

  // Build the submission entry payload from the current forms + state. Shared by
  // final submit and the Drafts/Scheduled queue so a draft replays identically.
  const buildSubmissionEntry = () => {
    // Same reason as the edit path: read the full store so a collapsed Company
    // Information panel cannot silently drop the address from the payload.
    // Full store for all three forms — a pane that is not the open tab is
    // unmounted, and a plain getFieldsValue() would omit its fields and blank
    // them on save. This path also backs the Drafts/Scheduled queue, so a draft
    // replayed from a different tab must carry the same values it was built with.
    const companyValues = companyForm.getFieldsValue(true);
    const disposalValues = entryForm.getFieldsValue(true);
    const baselineValues = baselineForm.getFieldsValue(true);
    // Blank cell rows must not overwrite the user-entered Total Volume Accepted
    // with a derived 0 — see resolveTotalVolumeForSave.
    const resolvedTotalVolumeAccepted = resolveTotalVolumeForSave({
      authoritative: cellVolumeTotalIsAuthoritative,
      computed: computedTotalVolumeAccepted,
      mountedValue: baselineForm.getFieldsValue().totalVolumeAccepted,
      storeValue: baselineValues.totalVolumeAccepted,
      baselineValue: baselineTotalVolume,
    });
    return {
      ...disposalValues,
      ...companyValues,
      lguCompanyName:
        companyValues.lguCompanyName ||
        disposalValues.lguCompanyName ||
        slfInfo?.lgu ||
        activeSlfName ||
        "",
      companyType:
        companyValues.companyType ||
        disposalValues.companyType ||
        ((slfInfo?.ownership || "").toLowerCase().includes("private")
          ? "Private"
          : "LGU"),
      address: companyValues.address || disposalValues.address || "",
      slfName: activeSlfName,
      slfGenerator: activeSlfId || null,
      dateOfDisposal: disposalValues.dateOfDisposal
        ? disposalValues.dateOfDisposal.format("YYYY-MM-DD")
        : null,
      trucks: trucks.map(cleanTruckForSubmit),
      totalVolumeAccepted: resolvedTotalVolumeAccepted,
      totalVolumeAcceptedUnit: baselineUnit,
      activeCellResidualVolume: baselineValues.activeCellResidualVolume,
      activeCellResidualUnit: baselineUnit,
      activeCellInertVolume: baselineValues.activeCellInertVolume,
      activeCellInertUnit: baselineUnit,
      activeCellHazardousVolume: baselineValues.activeCellHazardousVolume,
      activeCellHazardousUnit: baselineUnit,
      closedCellResidualVolume: baselineValues.closedCellResidualVolume,
      closedCellResidualUnit: baselineUnit,
      closedCellInertVolume: baselineValues.closedCellInertVolume,
      closedCellInertUnit: baselineUnit,
      closedCellHazardousVolume: baselineValues.closedCellHazardousVolume,
      closedCellHazardousUnit: baselineUnit,
      activeCellEntries: activeCellEntries.map(({ key, ...rest }) => ({
        ...rest,
        unit: rest.unit || baselineUnit,
      })),
      closedCellEntries: closedCellEntries.map(({ key, ...rest }) => ({
        ...rest,
        unit: rest.unit || baselineUnit,
      })),
      accreditedHaulers: mergeHaulersByName(haulers, baselineUnit).map(
        ({ key, vehicles, privateSectorClients, ...rest }) => ({
          ...rest,
          numberOfTrucks: rest.numberOfTrucks || vehicles?.length || 0,
          vehicles: (vehicles || []).map(
            ({ key: vehicleKey, ...vehicle }) => ({
              ...vehicle,
              capacityUnit: normalizeUnit(
                vehicle.capacityUnit || baselineUnit,
              ),
            }),
          ),
          privateSectorClients: (privateSectorClients || []).map(
            ({ key: clientKey, ...client }) => client,
          ),
        }),
      ),
      acceptsHazardousWaste,
      baselineUnit,
    };
  };

  // Final pre-submit validation across ALL added trucks/vehicles. Enforces two
  // rules that a bulk upload or loaded draft could otherwise bypass:
  //   \u2022 Waste Generation cell placement is required (Issue 3).
  //   \u2022 Truck capacity exceedance beyond the configured allowance is blocked (Issue 2).
  // Returns { ok, capacityMessages, placementMessages }.
  const validateSubmissionTrucks = useCallback(() => {
    const capacityMessages = [];
    const placementMessages = [];
    const requireCell = activeCellOptions.length > 0;
    (trucks || []).forEach((truck, ti) => {
      const label = truck.disposalTicketNo
        ? `Ticket ${truck.disposalTicketNo}`
        : `Truck ${ti + 1}`;
      const vehs = (truck.vehicles || []).filter(
        (v) => Number(v.actualVolume || 0) > 0 || v.plateNumber?.trim(),
      );
      const rows = vehs.length
        ? vehs.map((v) => ({
            actualVolume: v.actualVolume,
            actualVolumeUnit: v.actualVolumeUnit,
            cellName: v.cellName,
            ...vehicleEffectiveCapacity(truck, v),
          }))
        : [
            {
              actualVolume: truck.actualVolume,
              actualVolumeUnit: truck.actualVolumeUnit,
              cellName: truck.cellName,
              capacity: truck.truckCapacity,
              capacityUnit: truck.truckCapacityUnit || "m\u00b3",
            },
          ];
      rows.forEach((row) => {
        const vol = Number(row.actualVolume || 0);
        if (vol > 0 && requireCell && !row.cellName?.trim()) {
          placementMessages.push(label);
        }
        const cap = evaluateCapacity(
          row.actualVolume,
          row.actualVolumeUnit,
          row.capacity,
          row.capacityUnit,
        );
        if (cap.unconvertible) {
          // Not comparable \u2260 within capacity. Blocks the submission with the
          // reason, instead of the volume passing the gate unchecked.
          capacityMessages.push(
            `${label}: volume unit "${row.actualVolumeUnit}" cannot be converted to the capacity unit "${(row.capacityUnit || "m\u00b3").replace("m3", "m\u00b3")}"`,
          );
        } else if (cap.exceeded) {
          capacityMessages.push(
            `${label}: ${vol} exceeds max ${Number(
              cap.maxAllowed.toFixed(2),
            )} ${(row.capacityUnit || "m\u00b3").replace("m3", "m\u00b3")}`,
          );
        }
      });
    });
    return {
      ok: capacityMessages.length === 0 && placementMessages.length === 0,
      capacityMessages,
      placementMessages: [...new Set(placementMessages)],
    };
  }, [trucks, activeCellOptions.length, evaluateCapacity, vehicleEffectiveCapacity]);

  // Task 1: a reverted submission left unresolved for 24h+ blocks new submissions
  // until the user corrects/resubmits it (which flips its status to pending).
  const unresolvedRevert = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (
      (submissions || []).find((s) => {
        if (s?.status !== "reverted") return false;
        // THE ONE BEING CORRECTED RIGHT NOW DOES NOT COUNT.
        //
        // This rule blocks a NEW submission while an old revert sits unresolved.
        // It was also counting the record the operator had just opened with
        // Edit & Resubmit — which is the act that resolves it — so "Correct and
        // resubmit your reverted submission first" appeared as a blocker ON the
        // resubmission of that very submission. The only way out of a revert was
        // closed by the rule that exists to push you through it.
        //
        // The record stays `reverted` in the list until the PUT lands, so it has
        // to be excluded by id rather than by status.
        if (editingRevertedId && String(s._id) === String(editingRevertedId)) return false;
        const ts = s.revertedAt || s.updatedAt;
        return ts && new Date(ts).getTime() <= cutoff;
      }) || null
    );
  }, [submissions, editingRevertedId]);

  // ID No. of the reverted entry open in Edit & Resubmit, for the "you are
  // correcting …" banner above the form.
  const resubmittingIdNo = useMemo(() => {
    if (!editingRevertedId) return null;
    const row = (submissions || []).find((s) => String(s._id) === String(editingRevertedId));
    return row?.idNo || "this entry";
  }, [submissions, editingRevertedId]);

  return {
    buildSubmissionEntry, handleReviewOpen, resubmittingIdNo, unresolvedRevert,
    validateSubmissionTrucks,
  };
}
