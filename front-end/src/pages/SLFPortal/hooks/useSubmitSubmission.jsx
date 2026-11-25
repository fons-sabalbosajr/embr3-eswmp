import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../../config/appContact";
import { summarizeBacklog, formatDay } from "../backlogUpload";
import dayjs from "dayjs";
import {
  formatWasteGenIssues,
  validateWasteGeneration,
  validateTransportUnits,
  validateCapacityMagnitude,
  validateTruckCapacityElevation,
} from "../wasteGenValidation";
import { ORGANIZE_CELLS_ENABLED, EMPTY_TRUCK } from "../constants";
import { Modal } from "antd";
import { normalizeUnit } from "../helpers";
import { convertVolume, resolveCellUnit } from "../../../utils/volumeUnits";
import Swal from "sweetalert2";
import { formatOrganizeWarningHtml } from "../organizeCellsValidation";
import api from "../../../api";

export default function useSubmitSubmission({
  activeCellOptions, activeSlfId, activeSlfName, baselineForm, baselineSaved, baselineUnit,
  buildSubmissionEntry, capacityAllowancePct, companyForm, editingRevertedId, entryForm,
  getDeclaredVehicleCapacity, handleEditRevertedRow, haulerVehiclesMissingCapacity,
  isDeveloperContext, missingBaselineInfo, missingGeneralInfo, missingHazardousCodeTrucks,
  openCellOrganizer, portalUser, reservedCellFill, revealBaselineCard, setActiveMenu, setActiveTab,
  setBaselineSaved, setEditingTruckKey, setLoading, setReviewModalOpen, setSubmitProgress,
  setSubmitted, setTruckDraft, setTrucks, showError, slfCellCount, slfInfo, slfUnit, trucks,
  unplacedSubmissions, unresolvedRevert, validateSubmissionTrucks, wasteGenValidationIssues,
  watchedDisposalDate, late,
}) {
  // Idempotency key for the current submit attempt — reused across recoverable
  // retries (so a lost-response retry returns the saved record instead of
  // duplicating) and cleared only after a confirmed success.
  const submitKeyRef = useRef(null);
  // Waste Generation issues surfaced by the last blocked submit attempt, so the
  // offending truck rows can be highlighted. Cleared once the submit passes.
  const [wasteGenIssues, setWasteGenIssues] = useState([]);

  // #5: single source of truth for what still blocks a submission. Drives the
  // disabled state + tooltip on "Review & Submit" (frontend), and mirrors the
  // rules the server re-enforces (validateWasteGeneration + transport checks) plus
  // the workflow gates handleConfirmSubmit applies. Human-readable so the tooltip
  // tells the user exactly what to fix.
  // The facility has cells configured but NONE can currently accept waste (all
  // full / completed / out-of-service / closed / restricted). New disposal entries
  // are blocked until an operational cell is available.
  const allCellsUnavailable = useMemo(
    () => slfCellCount > 0 && activeCellOptions.length === 0,
    [slfCellCount, activeCellOptions.length],
  );
  const NO_AVAILABLE_CELL_MESSAGE =
    "No operational SLF cell is currently available for waste placement. Cells that are full, completed, used, or out of service cannot accept new disposal entries. Update the facility's cell records or coordinate with the administrator before submitting new entries.";

  // Item #2: the assigned SLF is tagged non-operational (its cell is subject to
  // EMB Region III verification). Official submissions are disabled; any attempt
  // is saved as a Draft (enforced server-side, not just by the disabled button).
  const slfNonOperational = useMemo(
    () => /non/i.test(String(slfInfo?.statusOfSLF || "")),
    [slfInfo?.statusOfSLF],
  );
  const NON_OPERATIONAL_MESSAGE =
    `Your assigned SLF is currently tagged as non-operational and its cell is subject to EMB Region III verification. New submissions cannot be officially submitted while this restriction is active — any submission attempt is saved as a Draft. For assistance, contact EMB Region III at ${SUPPORT_EMAIL}.`;

  // Backlog: transport entries that span several disposal dates. Each date is
  // submitted as its own submission (the server splits them — see
  // backlogUpload.js); null for an ordinary single-day entry.
  const backlogSummary = useMemo(
    () => summarizeBacklog(trucks, watchedDisposalDate ? dayjs(watchedDisposalDate).format("YYYY-MM-DD") : ""),
    [trucks, watchedDisposalDate],
  );

  const submitBlockers = useMemo(() => {
    const list = [];
    if (slfNonOperational) list.push(NON_OPERATIONAL_MESSAGE);
    if (backlogSummary?.outOfWindow.length) {
      list.push(
        `Backlog dates must be within the last month and not in the future — check ${backlogSummary.outOfWindow
          .slice(0, 3)
          .map(formatDay)
          .join(", ")}${backlogSummary.outOfWindow.length > 3 ? ` and ${backlogSummary.outOfWindow.length - 3} more` : ""}.`,
      );
    }
    // A correction resubmits ONE record, so it cannot be split across days.
    if (backlogSummary && editingRevertedId) {
      list.push("A correction covers one disposal date — remove the transport entries dated on other days.");
    }
    if (missingGeneralInfo) {
      list.push("General Information is incomplete — enter Company Name, Region, Province, and City/Municipality before submitting.");
    }
    if (missingBaselineInfo) {
      // Name the exact missing baseline field(s) instead of a vague "complete the
      // baseline" (Issue 2). Total Volume Accepted is the one hard requirement.
      list.push(
        "Baseline Data is incomplete — enter Total Volume Accepted before submitting.",
      );
    }
    if (!watchedDisposalDate) list.push("Select the Date of Disposal.");
    if ((trucks || []).length === 0) list.push("Add at least one transport entry.");
    else if (wasteGenValidationIssues.length > 0) {
      // NAME the fields that are actually missing.
      //
      // This used to be one sentence ending "(incl. a disposal cell for each
      // entry)", which is a list of one example presented as the whole problem.
      // On the reverted SLF-LGU-PA-0016 the failures were Actual Volume and Waste
      // Type; the operator read the message, placed a cell, and the blocker did
      // not move — because the cell had never been the issue. The per-field
      // messages already exist on every issue, so say them.
      formatWasteGenIssues(wasteGenValidationIssues, 6).forEach((line) =>
        list.push(`Waste Generation Information — ${line}`),
      );
    }
    if (allCellsUnavailable) {
      list.push(NO_AVAILABLE_CELL_MESSAGE);
    }
    if (missingHazardousCodeTrucks.length > 0) {
      list.push("Encode the Hazardous Waste Code for treated hazardous entries.");
    }
    if (haulerVehiclesMissingCapacity.length > 0) {
      list.push("Add Vehicle Capacity for every accredited-hauler vehicle.");
    }
    // These two are NEW-submission rules. A resubmission is how a revert gets
    // resolved, and the server's PUT /data-slf/:id runs neither gate — so they
    // must not disable Review & Submit while a reverted entry is being corrected.
    //
    // Excluding only the entry being edited (see unresolvedRevert) was not
    // enough: with two or more stale reverts, each one blocked the resubmission
    // of the others, so none could ever be resubmitted. Live: Prime Waste
    // Solution had 4 (SLF-LGU-PA-0018, SLF-PVT-PA-0167/0198/0202), Eco Protect 17,
    // General Tinio 7 — permanently locked out of submitting.
    if (unresolvedRevert && !editingRevertedId) {
      list.push("Correct and resubmit your reverted submission first.");
    }
    if (ORGANIZE_CELLS_ENABLED && unplacedSubmissions.length > 0 && !editingRevertedId) {
      list.push("Organize past submissions in Organize Cells — assign cells and complete any missing truck capacity.");
    }
    return list;
  }, [
    slfNonOperational,
    missingGeneralInfo,
    missingBaselineInfo,
    watchedDisposalDate,
    trucks,
    // The whole issue list, not just its length: the blockers now quote each
    // message, so a change of WHICH field is failing has to re-render even when
    // the count happens to stay the same.
    wasteGenValidationIssues,
    allCellsUnavailable,
    missingHazardousCodeTrucks.length,
    haulerVehiclesMissingCapacity.length,
    unresolvedRevert,
    unplacedSubmissions.length,
    editingRevertedId,
    backlogSummary,
  ]);

  // Item #2: prominent one-time notice after login when the assigned SLF is
  // non-operational. Shown once per SLF (not on every render/refresh) with the
  // restriction details and the official EMB Region III contact.
  const nonOpNoticeRef = useRef(null);
  useEffect(() => {
    if (!slfNonOperational || !activeSlfId) return;
    if (isDeveloperContext) return; // developers inspect read-only; no user-facing block
    if (nonOpNoticeRef.current === String(activeSlfId)) return;
    nonOpNoticeRef.current = String(activeSlfId);
    Modal.warning({
      title: "Assigned SLF Is Non-Operational",
      width: 560,
      okText: "I Understand",
      content: (
        <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
          <p style={{ marginTop: 4 }}>
            Your assigned SLF{activeSlfName ? ` (${activeSlfName})` : ""} is currently
            tagged as <strong>non-operational</strong>.
          </p>
          <ul style={{ paddingLeft: 18, marginBottom: 10 }}>
            <li>The SLF cell is subject to <strong>EMB Region III verification</strong>.</li>
            <li>New submissions <strong>cannot be officially submitted</strong> while this restriction is active.</li>
            <li>Any submission you attempt will be <strong>saved as a Draft</strong> instead of an official record.</li>
          </ul>
          <p style={{ marginBottom: 0 }}>
            For assistance, contact <strong>EMB Region III</strong> at{" "}
            <a href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      ),
    });
  }, [slfNonOperational, activeSlfId, activeSlfName, isDeveloperContext]);

  // Task 2: project this submission's per-cell waste against the cell's current
  // fill/capacity (from the facility Cell Infra). Full = projected >= capacity
  // (blocks); near-full = projected >= 80% but < 100% (warns, non-blocking).
  const evaluateCellFill = useCallback(() => {
    const fullCells = [];
    const nearFullCells = [];
    const perCell = new Map();
    (trucks || []).forEach((truck) => {
      const rows = (truck.vehicles || []).filter((v) => Number(v.actualVolume || 0) > 0);
      const list = rows.length ? rows : [truck];
      list.forEach((row) => {
        const idx = Number.isInteger(row.cellIndex)
          ? row.cellIndex
          : Number.isInteger(truck.cellIndex)
            ? truck.cellIndex
            : null;
        const vol = Number(row.actualVolume || 0);
        if (idx == null || !(vol > 0)) return;
        // The cell's capacity unit by THE cell rule (utils/cellCapacity.js) —
        // the same one the server gate (utils/cellAvailability.js) applies.
        const capUnit = resolveCellUnit(slfInfo, idx, "capacity");
        const converted = convertVolume(vol, row.actualVolumeUnit || capUnit, capUnit);
        perCell.set(idx, (perCell.get(idx) || 0) + converted);
      });
    });
    perCell.forEach((addedVol, idx) => {
      const capacity = Number(slfInfo?.cellCapacities?.[idx] || 0);
      if (!(capacity > 0)) return;
      const capUnit = resolveCellUnit(slfInfo, idx, "capacity");
      // Includes pending-review volume — see reservedCellFill.
      const currentFill = convertVolume(reservedCellFill(idx), resolveCellUnit(slfInfo, idx, "fill"), capUnit) ?? 0;
      const projected = currentFill + addedVol;
      const label = String(slfInfo?.cellNames?.[idx] || "").trim() || `Cell ${idx + 1}`;
      const pct = Math.round((projected / capacity) * 100);
      if (projected >= capacity) fullCells.push({ label, pct });
      else if (pct >= 80) nearFullCells.push({ label, pct });
    });
    return { fullCells, nearFullCells };
  }, [trucks, slfInfo]);

  // Developer Portal Mode now has FULL CONTROL — see assertPortalWriteAllowed in
  // server/utils/portalContext.js. This used to refuse every write locally to
  // explain the backend's 403; both sides now permit it, and the server records
  // each one against the developer's own identity.
  //
  // The call sites are kept: a developer writing to somebody else's account is
  // still worth a deliberate pause, and this is where that lives. It returns
  // false (never blocks) — the confirmation is the operator-facing part.
  const blockedByDeveloperContext = () => false;

  const handleConfirmSubmit = async () => {
    if (blockedByDeveloperContext("submit on their behalf")) return;
    if (portalUser?.portalAccess?.canSubmitDisposal === false) {
      showError({
        type: "error",
        title: "Disposal Submissions Disabled",
        message:
          "Your account is not permitted to submit disposal entries. Please contact EMB Region III.",
      });
      return;
    }
    try {
      await companyForm.validateFields();
    } catch {
      setActiveTab("basic-info");
      showError({
        type: "error",
        title: "General Information Incomplete",
        message: "Complete Company Name, Region, Province, and City/Municipality before submitting.",
      });
      return;
    }
    if (!baselineSaved) {
      try {
        await baselineForm.validateFields();
      } catch {
        setActiveTab("baseline");
        showError({
          type: "error",
          title: "Baseline Data Incomplete",
          message: "Complete Total Volume Accepted in Baseline Data before submitting.",
        });
        return;
      }
    }
    // Hard-block when every cell is full / completed / out-of-service / closed.
    if (allCellsUnavailable) {
      showError({
        type: "error",
        title: "No Available SLF Cell",
        message: NO_AVAILABLE_CELL_MESSAGE,
      });
      return;
    }
    // Task 1: block new submissions while a reverted submission stays unresolved
    // for 24h+. The user must correct/resubmit it first.
    if (unresolvedRevert) {
      showError({
        type: "error",
        title: "Resolve Reverted Submission First",
        message: `You have a reverted submission${unresolvedRevert.idNo ? ` (${unresolvedRevert.idNo})` : ""} that has been unresolved for over 24 hours. Please correct and resubmit it before submitting a new transaction.`,
      });
      return;
    }
    // #6: Hard-block new submissions while any PAST submission still needs
    // organizing — waste not placed into a cell, or a historical truck missing its
    // Truck Capacity. Organizing was previously only a soft prompt; the business
    // rule now requires prior approved waste to be fully organized first. Offer to
    // open the organizer straight away.
    if (ORGANIZE_CELLS_ENABLED && unplacedSubmissions.length > 0) {
      const result = await Swal.fire({
        icon: "warning",
        title: "Organize Past Submissions First",
        html:
          `You have <b>${unplacedSubmissions.length}</b> past submission(s) that must be completed in <b>Organize Cells</b> before submitting a new transaction:` +
          formatOrganizeWarningHtml(unplacedSubmissions, baselineUnit || slfUnit),
        width: 620,
        showCancelButton: true,
        confirmButtonText: "Organize Now",
        cancelButtonText: "Later",
        confirmButtonColor: "#722ed1",
      });
      if (result.isConfirmed) openCellOrganizer();
      return;
    }
    // Accredited-hauler vehicles must all declare a capacity before anything can be
    // submitted — the over-capacity check has nothing to measure against otherwise.
    if (haulerVehiclesMissingCapacity.length) {
      setActiveTab("baseline"); // Accredited Haulers lives on the baseline tab
      revealBaselineCard("haulers");
      const list = haulerVehiclesMissingCapacity
        .slice(0, 6)
        .map((i) => `${i.haulerName} — ${i.plateNumber}`)
        .join("; ");
      showError({
        type: "error",
        title: "Vehicle Capacity Required",
        message: `Update the Vehicle Capacity on your Accredited Haulers before submitting. Missing for: ${list}${
          haulerVehiclesMissingCapacity.length > 6
            ? ` (+${haulerVehiclesMissingCapacity.length - 6} more)`
            : ""
        }.`,
      });
      return;
    }

    // Waste Generation Information must be complete for a FINAL submission
    // (Truck Capacity included). Checked here — BEFORE any upload — so an
    // incomplete submission is never partially finalized. The backend enforces
    // the same rules; this only gives the user the offending fields up front.
    const wasteGenIssues = validateWasteGeneration(trucks);
    if (wasteGenIssues.length) {
      setActiveTab("disposal"); // surface the tab that owns the problem
      setWasteGenIssues(wasteGenIssues); // highlights the offending inputs
      showError({
        type: "error",
        title: "Waste Generation Information Incomplete",
        message: `Every field in Waste Generation Information is required to submit. ${formatWasteGenIssues(wasteGenIssues).join(" ")}`,
      });
      return;
    }
    setWasteGenIssues([]);

    // Declared baseline unit + strict +10% truck-capacity elevation. Both hard-
    // block a FINAL submission (no override); the backend re-checks the same rules
    // authoritatively against the SLF's registered hauler capacities.
    const transportRuleIssues = [
      ...validateTransportUnits(trucks, baselineUnit),
      ...validateCapacityMagnitude(trucks, baselineUnit),
      ...validateTruckCapacityElevation(trucks, getDeclaredVehicleCapacity),
    ];
    if (transportRuleIssues.length) {
      setActiveTab("disposal");
      setWasteGenIssues(transportRuleIssues);
      showError({
        type: "error",
        title: "Transport Entry Not Allowed",
        message: `Fix these before submitting: ${formatWasteGenIssues(transportRuleIssues).join(" ")}`,
      });
      return;
    }

    // Block submission when cell placement is missing or a truck exceeds its
    // allowed capacity threshold. Show a clear, actionable message.
    const preCheck = validateSubmissionTrucks();
    if (!preCheck.ok) {
      const parts = [];
      if (preCheck.placementMessages.length) {
        parts.push(
          `Assign a disposal cell for: ${preCheck.placementMessages.join(", ")}.`,
        );
      }
      if (preCheck.capacityMessages.length) {
        parts.push(
          `Waste volume exceeds the allowed truck capacity threshold (${capacityAllowancePct}% allowance) \u2014 ${preCheck.capacityMessages.join("; ")}.`,
        );
      }
      showError({
        type: "error",
        title: "Cannot Submit Yet",
        message: parts.join(" "),
      });
      return;
    }
    // Task 2: active cell capacity. Full cells block; near-full cells warn only.
    const cellFill = evaluateCellFill();
    if (cellFill.fullCells.length) {
      showError({
        type: "error",
        title: "Cell Full",
        message: `${cellFill.fullCells
          .map((c) => `${c.label} (${c.pct}%)`)
          .join(", ")} would exceed capacity. Please place this waste in another active cell that is not full.`,
      });
      return;
    }
    if (cellFill.nearFullCells.length) {
      const proceed = await Swal.fire({
        icon: "warning",
        title: "Cell Nearing Full",
        html: `${cellFill.nearFullCells
          .map((c) => `<b>${c.label}</b> is at ~${c.pct}% capacity`)
          .join("<br/>")}<br/><br/>You may still submit, but consider using another cell soon.`,
        showCancelButton: true,
        confirmButtonText: "Submit Anyway",
        cancelButtonText: "Review",
        confirmButtonColor: "#1a3353",
      });
      if (!proceed.isConfirmed) return;
    }
    if (!navigator.onLine) {
      showError({
        type: "offline",
        title: "You\u2019re Offline",
        message: "Please check your internet connection and try again.",
      });
      return;
    }
    setLoading(true);
    const entry = buildSubmissionEntry();
    const truckCount = (entry?.trucks || []).length;
    // Show a percentage progress modal for larger/bulk submissions so the user
    // gets clear feedback while the payload uploads.
    const showProgress = truckCount > 20;
    if (showProgress) {
      setSubmitProgress({
        open: true,
        percent: 2,
        text: `Preparing ${truckCount.toLocaleString()} truck entr${truckCount === 1 ? "y" : "ies"}…`,
        error: false,
      });
    }
    // Generate the idempotency key once per logical submission; a retry after a
    // recoverable failure reuses it so the backend never double-persists.
    if (!submitKeyRef.current) {
      submitKeyRef.current =
        (window.crypto?.randomUUID?.() || `sub-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }
    const idempotencyConfig = { headers: { "X-Idempotency-Key": submitKeyRef.current } };
    try {
      const resp = await api.post(
        "/data-slf",
        {
          entries: [entry],
          submittedBy: portalUser?.email,
        },
        showProgress
          ? {
              ...idempotencyConfig,
              onUploadProgress: (e) => {
                if (!e.total) return;
                // Upload accounts for ~90%; the last 10% is server processing.
                const pct = Math.min(90, Math.round((e.loaded / e.total) * 90));
                setSubmitProgress((p) => ({
                  ...p,
                  percent: pct,
                  text:
                    pct >= 90
                      ? "Finalizing on the server…"
                      : `Uploading ${truckCount.toLocaleString()} entr${truckCount === 1 ? "y" : "ies"}… ${pct}%`,
                }));
              },
            }
          : idempotencyConfig,
      );
      if (showProgress) {
        setSubmitProgress((p) => ({ ...p, open: false }));
      }
      submitKeyRef.current = null; // confirmed persisted — retire the key
      setReviewModalOpen(false);
      // The draft this entry was opened from has been submitted (or, for a
      // non-operational SLF, re-saved by the server as a fresh draft) — either
      // way the old queue record is superseded. Best effort: a failure here
      // leaves a stale draft, never a lost submission.
      await late.retireOpenDraft();
      // Item #2: the backend saved this as a DRAFT (HTTP 202) because the assigned
      // SLF is tagged non-operational and pending EMB Region III verification — it
      // is NOT an official submission. Explain clearly instead of "Submitted".
      if (resp?.data?.savedAsDraft) {
        Swal.fire({
          icon: "info",
          title: "Saved as Draft — Not Officially Submitted",
          html:
            resp.data.message ||
            "Your assigned SLF is currently tagged as non-operational and its cell is subject to EMB Region III verification. New submissions cannot be officially submitted while this restriction is active, so your entry was saved as a Draft. You can find it under Drafts once the restriction is lifted.",
          confirmButtonColor: "#1a3353",
        });
      } else {
        // A backlog comes back as one record per disposal date.
        const savedRecords = Array.isArray(resp?.data?.data) ? resp.data.data : [];
        const savedDays = [...new Set(savedRecords.map((r) => String(r?.dateOfDisposal || "").slice(0, 10)).filter(Boolean))].sort();
        Swal.fire({
          icon: "success",
          title: "Submitted Successfully!",
          html:
            savedRecords.length > 1
              ? `<b>${savedRecords.length} submissions</b> were recorded — one for each disposal date` +
                (savedDays.length > 1 ? ` (${formatDay(savedDays[0])} to ${formatDay(savedDays[savedDays.length - 1])})` : "") +
                ", each with its own ID No."
              : "Your disposal data has been recorded.",
          confirmButtonColor: "#1a3353",
        });
      }
      setSubmitted(true);
      setTrucks([]);
      setTruckDraft({ ...EMPTY_TRUCK });
      setEditingTruckKey(null);
      entryForm.resetFields();
      setBaselineSaved(true);
      setActiveTab("disposal");
    } catch (err) {
      if (showProgress) {
        setSubmitProgress((p) => ({
          ...p,
          error: true,
          text: err.response?.data?.message || "Submission failed.",
        }));
        setTimeout(() => setSubmitProgress((p) => ({ ...p, open: false })), 1500);
      }
      if (
        !navigator.onLine ||
        err.code === "ERR_NETWORK" ||
        err.message === "Network Error"
      ) {
        showError({
          type: "offline",
          title: "Connection Lost",
          message:
            "Your internet connection was interrupted. Your data is still here \u2014 please try submitting again once you\u2019re back online.",
        });
      } else if (
        err.code === "ECONNABORTED" ||
        err.response?.status === 504 ||
        err.response?.status === 408
      ) {
        // A gateway 504 (Cloudflare gives up at ~100s) means the server may
        // STILL have saved the record — 11 of these on /data-slf in one day,
        // each shown as "Something went wrong". submitKeyRef is kept, so a
        // retry carries the same X-Idempotency-Key and resolves to the saved
        // record instead of filing a duplicate. Say so.
        showError({
          type: "error",
          title: "Request Timed Out",
          message:
            "The server took too long to respond. Your entry may still have been saved — please try again; a retry will not create a duplicate.",
        });
      } else if (err.response?.data?.code === "SUBMISSION_IN_PROGRESS") {
        // The earlier attempt (same idempotency key) is still being processed on
        // the server — this is a retry after a client-side timeout, not a failure.
        // Keep the key so the next retry resolves to that saved record.
        showError({
          type: "warning",
          title: "Still Processing",
          message:
            err.response?.data?.message ||
            "Your previous submission is still being processed. Please wait a moment before trying again.",
        });
      } else if (err.response?.data?.code === "UNRESOLVED_REVERT") {
        // #2: backend rule block (also enforced server-side to prevent API bypass) —
        // show a clear modal with a direct action to the correction flow.
        const ctxId = err.response?.data?.ruleContext?.idNo;
        // The server names the blocking entry by id too, so open it straight in
        // Edit & Resubmit when it can; Submission History is the fallback.
        const blockingId = err.response?.data?.ruleContext?.id;
        Swal.fire({
          icon: "warning",
          title: "Resolve Reverted Submission First",
          text:
            err.response?.data?.message ||
            `Please correct and resubmit your reverted submission${ctxId ? ` (${ctxId})` : ""} before submitting a new transaction.`,
          showCancelButton: true,
          confirmButtonText: blockingId
            ? `Edit & Resubmit${ctxId ? ` ${ctxId}` : ""}`
            : "Review Submission History",
          cancelButtonText: "Close",
          confirmButtonColor: "#1a3353",
        }).then((r) => {
          if (!r.isConfirmed) return;
          if (blockingId) handleEditRevertedRow({ _id: blockingId });
          else setActiveMenu("history");
        });
      } else {
        showError({
          type: "error",
          title: "Submission Failed",
          message:
            err.response?.data?.message ||
            "Something went wrong. Please try again.",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    NO_AVAILABLE_CELL_MESSAGE, allCellsUnavailable, backlogSummary, blockedByDeveloperContext,
    handleConfirmSubmit, submitBlockers,
  };
}
