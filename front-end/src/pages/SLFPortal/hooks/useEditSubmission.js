import { useState, useRef, useLayoutEffect } from "react";
import { invalidateCache } from "../../../utils/pageCache";
import api from "../../../api";
import dayjs from "dayjs";
import { mergeHaulersByName, cleanHaulerForSubmit } from "../haulerNormalization";
import Swal from "sweetalert2";
import { EMPTY_TRUCK } from "../constants";
import { resolveTotalVolumeForSave } from "../portalShared";

export default function useEditSubmission({
  acceptsHazardousWaste, activeCellEntries, activeSlfId, activeSlfName, baselineForm,
  baselineTotalVolume, baselineUnit, cellVolumeTotalIsAuthoritative, cleanTruckForSubmit,
  closedCellEntries, companyForm, computedTotalVolumeAccepted, entryForm, fetchBarangays,
  fetchMunicipalities, fetchProvinces, fetchSubmissions, haulers, portalUser, setActiveCellEntries,
  setActiveMenu, setActiveTab, setBaselineSaved, setBaselineUnit, setClosedCellEntries,
  setEditingTruckKey, setHaulers, setHistoryDetailModal, setTruckDraft, setTrucks, showError,
  slfInfo, slfUnit, trucks, late,
}) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(null);
  // Submit progress (percentage) for large / bulk disposal submissions.
  const [submitProgress, setSubmitProgress] = useState({
    open: false,
    percent: 0,
    text: "",
    error: false,
  });

  // ── Edit reverted entry ──
  const [editingRevertedId, setEditingRevertedId] = useState(null);
  const [resubmitComment, setResubmitComment] = useState("");
  // ── Edit a saved draft ── { id, label } of the Drafts & Scheduled record whose
  // data is loaded into Data Entry. Save as Draft updates THAT record, and a
  // successful Review & Submit removes it from the queue.
  const [editingDraft, setEditingDraft] = useState(null);
  // The same record, readable from handlers that started before the latest
  // render. Autosave can open a draft while a submit is already running; the
  // submit's cleanup must see THAT draft, not the null its closure captured.
  const editingDraftRef = useRef(null);
  useLayoutEffect(() => {
    editingDraftRef.current = editingDraft;
  }, [editingDraft]);
  // Drafts & Scheduled caches its list for a few minutes. Every queue write made
  // from Data Entry must drop that cache, or the panel keeps showing a draft that
  // was already submitted/replaced — and its Edit button then fails with "Could
  // not open this draft" because the record is gone. Same key as the panel's.
  const invalidateQueueCache = () => invalidateCache(`portal-queue-${portalUser?.email || ""}`);

  // The history LIST is lean (no trucks / haulers / baseline blobs — see
  // portalAuth PORTAL_SUBMISSION_LIST_FIELDS), so Edit & Resubmit pulls the FULL
  // record by id before prefilling the forms. Without this it would repopulate
  // from a partial row and silently wipe the haulers and baseline values.
  const handleEditRevertedRow = async (row) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/portal-auth/my-submissions/${row._id}`);
      handleEditReverted(data);
    } catch (err) {
      showError({
        type: "error",
        title: "Could Not Open Submission",
        message:
          err.response?.data?.message ||
          "We couldn't load this submission for editing. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditReverted = (record) => {
    const recordBaselineUnit =
      record.baselineUnit ||
      record.totalVolumeAcceptedUnit ||
      baselineUnit ||
      "m³";
    setBaselineUnit(recordBaselineUnit);
    // Load record data into all forms
    entryForm.setFieldsValue({
      dateOfDisposal: record.dateOfDisposal
        ? dayjs(record.dateOfDisposal)
        : null,
      lguCompanyName: record.lguCompanyName,
      companyType: record.companyType,
      address: record.address,
    });
    companyForm.setFieldsValue({
      lguCompanyName: record.lguCompanyName,
      // `companyType` is READ back out of this form when the resubmission payload
      // is built, and it was never written into it — so the read fell through to
      // the disposal form and, failing that, to a hardcoded "LGU" derived from
      // `slfInfo.ownership`. While slfInfo was still loading that default fired on
      // a PRIVATE facility, which rewrote companyType on save AND re-minted the ID
      // No. under the wrong TYPE segment. Live proof: SLF-PVT-PA-0006 came back
      // from a resubmission as SLF-LGU-PA-0016 on Prime Waste Solution (Private).
      // The record already knows what it is; seed it from there.
      companyType: record.companyType,
      companyRegion: record.companyRegion,
      companyProvince: record.companyProvince,
      companyMunicipality: record.companyMunicipality,
      companyBarangay: record.companyBarangay,
    });
    // ── Baseline: the record's copy is a SNAPSHOT, not the baseline ────────────
    //
    // Every field below used to be assigned straight from `record`, and
    // setFieldsValue({ x: undefined }) CLEARS a control rather than leaving it
    // alone. A submission only carries the baseline columns that existed when it
    // was created, so on any SLF whose baseline had drifted the record hands back
    // `undefined` — and Edit & Resubmit then wiped the resolved baseline this form
    // was already holding from GET /data-slf/baseline/:slfName.
    //
    // For Total Volume Accepted that is a DEAD END, not a cosmetic loss:
    // `missingBaselineInfo` blocks Review & Submit until the field is a positive
    // number, while `setBaselineSaved(true)` below renders that very input
    // `disabled`. The operator is told to enter a value into a field they cannot
    // type in, and the reverted submission can never be sent back. Measured
    // against live data: 18 of the 26 outstanding reverted submissions are in
    // exactly that state (Porac ×15, Prime Waste Solution, Santa Rosa).
    //
    // So each field is taken from the record only when the record actually
    // carries it, and otherwise keeps what the form already holds — the same rule
    // the baseline loader applies to the address fields (`keepCurrent`). `??` and
    // not `||`: 0 is a real volume.
    const keepBaseline = (incoming, field) =>
      incoming ?? baselineForm.getFieldValue(field);
    baselineForm.setFieldsValue({
      // The FACILITY's figure wins over the record's snapshot for this one field.
      //
      // Every other baseline value on a submission is at worst stale; this one is
      // a hard gate — `missingBaselineInfo` blocks Review & Submit until it is a
      // positive number, and Edit & Resubmit locks the input. So a snapshot of 0
      // (reverted SLF-LGU-PA-0016 stores exactly that, against a real baseline of
      // 596,981.38) put an unfixable 0 in a disabled field and made the entry
      // impossible to resubmit. `??` did not catch it: 0 is not nullish.
      //
      // The record's copy is still the fallback, for a facility whose baseline the
      // server cannot resolve at all.
      totalVolumeAccepted:
        baselineTotalVolume ??
        keepBaseline(record.totalVolumeAccepted, "totalVolumeAccepted"),
      baselineUnit: recordBaselineUnit,
      totalVolumeAcceptedUnit:
        record.totalVolumeAcceptedUnit || recordBaselineUnit,
      activeCellResidualVolume: keepBaseline(
        record.activeCellResidualVolume,
        "activeCellResidualVolume",
      ),
      activeCellResidualUnit:
        record.activeCellResidualUnit || recordBaselineUnit,
      activeCellInertVolume: keepBaseline(
        record.activeCellInertVolume,
        "activeCellInertVolume",
      ),
      activeCellInertUnit: record.activeCellInertUnit || recordBaselineUnit,
      closedCellResidualVolume: keepBaseline(
        record.closedCellResidualVolume,
        "closedCellResidualVolume",
      ),
      closedCellResidualUnit:
        record.closedCellResidualUnit || recordBaselineUnit,
      closedCellInertVolume: keepBaseline(
        record.closedCellInertVolume,
        "closedCellInertVolume",
      ),
      closedCellInertUnit: record.closedCellInertUnit || recordBaselineUnit,
    });
    // ── The BASELINE panes keep the facility's baseline, not the record's copy ──
    //
    // Cell entries and accredited haulers are FACILITY-level baseline data. What a
    // submission stores is a SNAPSHOT taken when it was created, and it goes stale
    // the moment the baseline is edited — so loading the record over the top
    // replaced the operator's real baseline with an old, usually smaller, copy.
    //
    // Haulers is where that bites hardest, and it is the reported "Accredited
    // Haulers are missing": Prime Waste Solution's baseline lists 150 accredited
    // haulers, its reverted submission carries 1 — so clicking Edit & Resubmit
    // collapsed 150 to 1, and resubmitting would have written that back.
    //
    // The baseline is LOCKED in this mode (setBaselineSaved(true) below), so the
    // operator is correcting DISPOSAL data, not the baseline: what is already
    // loaded from GET /data-slf/baseline/:slfName is the right thing to show. The
    // record's snapshot is kept only as a FALLBACK, for a legacy SLF whose
    // baseline cannot be resolved — same rule as the volume fields above.
    const keepList = (incoming, current) =>
      current?.length ? current : Array.isArray(incoming) ? incoming : [];
    setActiveCellEntries((current) =>
      keepList(record.activeCellEntries, current).map((entry, index) => ({
        ...entry,
        unit: entry.unit || recordBaselineUnit,
        key: `reverted-active-${index}-${Date.now()}`,
      })),
    );
    setClosedCellEntries((current) =>
      keepList(record.closedCellEntries, current).map((entry, index) => ({
        ...entry,
        unit: entry.unit || recordBaselineUnit,
        key: `reverted-closed-${index}-${Date.now()}`,
      })),
    );
    // Load trucks
    const loadedTrucks = (record.trucks || []).map((t, i) => ({
      ...t,
      key: `reverted-${i}-${Date.now()}`,
    }));
    setTrucks(loadedTrucks);
    // Accredited haulers: the loaded baseline wins over the record's snapshot —
    // see the note above setActiveCellEntries. The record's copy is the fallback,
    // so a facility whose baseline could not be resolved still shows something.
    setHaulers((current) =>
      mergeHaulersByName(
        keepList(record.accreditedHaulers, current),
        recordBaselineUnit,
      ),
    );
    setEditingDraft(null);
    setEditingRevertedId(record._id);
    // Opening a reverted entry is not an edit — autosave starts on the first change.
    late.draftAutosave.adoptNext();
    setSubmitted(false);
    setBaselineSaved(true);
    setHistoryDetailModal(null);
    setActiveMenu("data-entry");
    setActiveTab("disposal");
    // Load the option lists for the record's stored codes WITHOUT clearing the
    // values we just wrote — this is hydration, not a user re-selecting a region.
    const keepSelection = { preserveSelection: true };
    if (record.companyRegion) fetchProvinces(record.companyRegion, keepSelection);
    if (record.companyProvince) fetchMunicipalities(record.companyProvince, keepSelection);
    if (record.companyMunicipality) fetchBarangays(record.companyMunicipality, keepSelection);
    // Re-assert the stored address after the option lists resolve. The three
    // fetches above are async; without this a late response could still land on
    // a form whose values were changed in between.
    companyForm.setFieldsValue({
      companyRegion: record.companyRegion,
      companyProvince: record.companyProvince,
      companyMunicipality: record.companyMunicipality,
      companyBarangay: record.companyBarangay,
    });
    Swal.fire({
      icon: "info",
      title: "Edit Reverted Entry",
      html: `<b>Reason for revert:</b> ${record.revertReason || "Not specified"}<br/><br/>Please review and update the data across all tabs, then submit again.`,
      confirmButtonColor: "#1a3353",
    });
  };

  // Load a saved draft (full record, payload included) into Data Entry so the
  // operator can correct it. A draft rejected for its own content — "At least
  // one truck entry is required" (General Tinio) — could otherwise only be
  // retried unchanged, which failed again, or deleted.
  //
  // Only the DISPOSAL data comes from the draft. Baseline and haulers are the
  // facility's and stay as loaded, same rule as Edit & Resubmit above.
  const handleEditDraft = (record) => {
    const payload = record?.payload || {};
    // A saved CORRECTION of a reverted entry reopens in Edit & Resubmit mode, so
    // Review & Submit resubmits that entry instead of filing a new one.
    const correctionOf = record?.resubmitOf ? String(record.resubmitOf) : null;
    setEditingRevertedId(correctionOf);
    setResubmitComment(correctionOf ? String(payload.resubmitComment || "") : "");
    entryForm.setFieldsValue({
      dateOfDisposal: payload.dateOfDisposal ? dayjs(payload.dateOfDisposal) : null,
    });
    // Company details only where the draft carries them — setFieldsValue with
    // `undefined` would CLEAR what the form already holds.
    const companyFields = [
      "lguCompanyName", "companyType", "address",
      "companyRegion", "companyProvince", "companyMunicipality", "companyBarangay",
    ].reduce((acc, field) => {
      if (payload[field] !== undefined && payload[field] !== null && payload[field] !== "") {
        acc[field] = payload[field];
      }
      return acc;
    }, {});
    if (Object.keys(companyFields).length) companyForm.setFieldsValue(companyFields);
    setTrucks(
      (Array.isArray(payload.trucks) ? payload.trucks : []).map((t, i) => ({
        ...t,
        key: `draft-${i}-${Date.now()}`,
      })),
    );
    setTruckDraft({ ...EMPTY_TRUCK });
    setEditingTruckKey(null);
    setEditingDraft({
      id: record._id,
      type: record.type === "scheduled" ? "scheduled" : "draft",
      label: payload.dateOfDisposal ? dayjs(payload.dateOfDisposal).format("MMM D, YYYY") : "undated",
    });
    // The loaded draft is already saved; autosave picks up from the first change.
    late.draftAutosave.adoptNext();
    // A scheduled run keeps its time as the default when it is rescheduled.
    if (record.type === "scheduled" && record.scheduledAt) {
      const when = dayjs(record.scheduledAt);
      setScheduleAt(when.isAfter(dayjs()) ? when : null);
    }
    setSubmitted(false);
    setActiveMenu("data-entry");
    setActiveTab("disposal");
    const keepSelection = { preserveSelection: true };
    if (companyFields.companyRegion) fetchProvinces(companyFields.companyRegion, keepSelection);
    if (companyFields.companyProvince) fetchMunicipalities(companyFields.companyProvince, keepSelection);
    if (companyFields.companyMunicipality) fetchBarangays(companyFields.companyMunicipality, keepSelection);
    const plain = (value) => String(value || "").replace(/[<>&]/g, "");
    if (correctionOf) {
      Swal.fire({
        icon: "info",
        title: "Editing Saved Correction",
        html:
          `This draft corrects reverted entry <b>${plain(record.resubmitOfIdNo) || "—"}</b>.` +
          (record?.failureReason ? `<br/><br/><b>Why it was not submitted:</b> ${plain(record.failureReason)}` : "") +
          "<br/><br/>Use <b>Review &amp; Submit</b> to resubmit it, or <b>Save as Draft</b> to keep working later.",
        confirmButtonColor: "#1a3353",
      });
      return;
    }
    if (record.type === "scheduled") {
      Swal.fire({
        icon: "info",
        title: "Editing Scheduled Submission",
        html:
          (record?.failureReason
            ? `<b>Why it was not submitted:</b> ${plain(record.failureReason)}<br/><br/>`
            : "") +
          `Scheduled for <b>${record.scheduledAt ? dayjs(record.scheduledAt).format("MMM D, YYYY h:mm A") : "—"}</b>. ` +
          "Make your changes, then use <b>Review &amp; Submit → Schedule</b> to keep it scheduled, <b>Save as Draft</b> to unschedule it, or submit it now.",
        confirmButtonColor: "#1a3353",
      });
      return;
    }
    Swal.fire({
      icon: "info",
      title: "Editing Draft",
      html: record?.failureReason
        ? `<b>Why it was not submitted:</b> ${String(record.failureReason).replace(/[<>&]/g, "")}<br/><br/>Correct it here, then use <b>Review &amp; Submit</b> — or <b>Save as Draft</b> to keep working later.`
        : "Your draft is loaded. Use <b>Review &amp; Submit</b> when it is complete, or <b>Save as Draft</b> to keep working later.",
      confirmButtonColor: "#1a3353",
    });
  };

  // Leave draft editing and start a fresh entry. The draft stays in the queue.
  const stopEditingDraft = () => {
    setEditingDraft(null);
    setTrucks([]);
    setTruckDraft({ ...EMPTY_TRUCK });
    setEditingTruckKey(null);
    entryForm.resetFields();
  };

  const handleResubmitReverted = async () => {
    if (!navigator.onLine) {
      showError({
        type: "offline",
        title: "You\u2019re Offline",
        message: "Please check your internet connection and try again.",
      });
      return;
    }
    setLoading(true);
    try {
      // `true` = read the WHOLE form store, not just currently-rendered fields.
      // Company Information lives inside a Collapse, so while that panel is
      // closed its inputs are unmounted and a plain getFieldsValue() omits
      // them — the values loaded by setFieldsValue were then dropped from the
      // payload and the stored address was wiped on every baseline edit.
      const companyValues = companyForm.getFieldsValue(true);
      // Same `true` for the disposal and baseline forms. Only ONE baseline field
      // (totalVolumeAccepted) had a store fallback below; every other one —
      // per-cell active/closed volumes and their units — was silently dropped
      // whenever its pane was not the open tab, which is what reset baseline
      // values to blank on save. Reading the whole store fixes the class of bug,
      // not just the one field someone noticed.
      const disposalValues = entryForm.getFieldsValue(true);
      const baselineValues = baselineForm.getFieldsValue(true);
      // Cell entries only win when they carry real volumes; otherwise the
      // user-entered figure is preserved (see resolveTotalVolumeForSave).
      const resolvedTotalVolumeAccepted = resolveTotalVolumeForSave({
        authoritative: cellVolumeTotalIsAuthoritative,
        computed: computedTotalVolumeAccepted,
        // No validateFields() on this path, so the mounted-only read of the form
        // provides the same "is it actually on screen" signal.
        mountedValue: baselineForm.getFieldsValue().totalVolumeAccepted,
        storeValue: baselineValues.totalVolumeAccepted,
        baselineValue: baselineTotalVolume,
      });
      const entry = {
        ...disposalValues,
        ...companyValues,
        lguCompanyName:
          companyValues.lguCompanyName || disposalValues.lguCompanyName || "",
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
        baselineUnit,
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
            (hauler, index) =>
              cleanHaulerForSubmit(hauler, index, baselineUnit || slfUnit),
          ),
        acceptsHazardousWaste,
        trucks: trucks.map(cleanTruckForSubmit),
      };
      // Percentage progress modal for larger/bulk resubmissions.
      const truckCount = (entry.trucks || []).length;
      const showProgress = truckCount > 20;
      if (showProgress) {
        setSubmitProgress({
          open: true,
          percent: 2,
          text: `Preparing ${truckCount.toLocaleString()} truck entr${truckCount === 1 ? "y" : "ies"}…`,
          error: false,
        });
      }
      // Update the existing entry and set status back to pending
      await api.put(
        `/data-slf/${editingRevertedId}`,
        {
          ...entry,
          resubmitComment,
        },
        showProgress
          ? {
              onUploadProgress: (e) => {
                if (!e.total) return;
                const pct = Math.min(90, Math.round((e.loaded / e.total) * 90));
                setSubmitProgress((p) => ({
                  ...p,
                  percent: pct,
                  text:
                    pct >= 90
                      ? "Finalizing on the server…"
                      : `Resubmitting ${truckCount.toLocaleString()} entr${truckCount === 1 ? "y" : "ies"}… ${pct}%`,
                }));
              },
            }
          : undefined,
      );
      if (showProgress) {
        setSubmitProgress((p) => ({ ...p, percent: 100, text: "Resubmitted!" }));
        await new Promise((r) => setTimeout(r, 400));
        setSubmitProgress((p) => ({ ...p, open: false }));
      }
      setReviewModalOpen(false);
      setEditingRevertedId(null);
      setResubmitComment("");
      // Resubmitted from a saved (or autosaved) correction: that draft is now in
      // Submission History, so it leaves Drafts & Scheduled (same as a submitted draft).
      await late.retireOpenDraft();
      Swal.fire({
        icon: "success",
        title: "Resubmitted Successfully!",
        html: "Your updated disposal data has been resubmitted for review.",
        confirmButtonColor: "#1a3353",
      });
      setSubmitted(true);
      setTrucks([]);
      setTruckDraft({ ...EMPTY_TRUCK });
      setEditingTruckKey(null);
      entryForm.resetFields();
      setActiveTab("disposal");
      // FORCE the refetch. A resubmission changes the record's status
      // (reverted → pending) and its ID No. on the server, but the plain call
      // re-read the cached list, so Submission History kept showing the entry as
      // reverted under its old ID until the cache expired or the page reloaded.
      fetchSubmissions(true, true);
    } catch (err) {
      setSubmitProgress((p) =>
        p.open
          ? {
              ...p,
              error: true,
              text: err.response?.data?.message || "Resubmission failed.",
            }
          : p,
      );
      setTimeout(
        () => setSubmitProgress((p) => ({ ...p, open: false })),
        1500,
      );
      showError({
        type: "error",
        title: "Resubmission Failed",
        message: err.response?.data?.message || "Something went wrong.",
      });
    } finally {
      setLoading(false);
    }
  };

  return {
    editingDraft, editingDraftRef, editingRevertedId, handleEditDraft, handleEditReverted,
    handleEditRevertedRow, handleResubmitReverted, invalidateQueueCache, loading, resubmitComment,
    reviewModalOpen, scheduleAt, setEditingDraft, setEditingRevertedId, setLoading,
    setResubmitComment, setReviewModalOpen, setScheduleAt, setSubmitProgress, setSubmitted,
    stopEditingDraft, submitProgress, submitted,
  };
}
