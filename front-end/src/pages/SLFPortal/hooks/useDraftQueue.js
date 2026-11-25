import { useState, useRef } from "react";
import api from "../../../api";
import { newClientRequestId } from "../constants";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import useDraftAutosave from "../useDraftAutosave";

export default function useDraftQueue({
  activeSlfId, activeSlfName, blockedByDeveloperContext, buildSubmissionEntry, companyForm,
  editingDraft, editingDraftRef, editingRevertedId, entryForm, invalidateQueueCache,
  isDeveloperContext, loading, portalUser, resubmitComment, resubmittingIdNo, scheduleAt,
  setEditingDraft, setReviewModalOpen, setScheduleAt, showError, trucks,
}) {
  const [savingDraft, setSavingDraft] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [schedulingSubmit, setSchedulingSubmit] = useState(false);
  // Synchronous in-flight flag for the draft/schedule queue actions. A ref (not
  // state) because it must block the SECOND click of a double-click, which happens
  // before React has flushed the `savingDraft` / `schedulingSubmit` state.
  const queueActionRef = useRef(false);

  // ── Drafts & Scheduled submission handlers ──
  //
  // While a reverted entry is being corrected, a draft or schedule must carry a
  // link to it. Without one the queue filed the correction as a NEW submission:
  // the reverted entry stayed reverted (blocking new submissions after 24 h) and
  // the volume was counted twice once the copy was approved.
  const correctionLink = () => (editingRevertedId ? { resubmitOf: editingRevertedId } : {});
  // The resubmit note travels in the payload, which is the body the server
  // resubmits with — so a correction submitted later keeps the operator's note.
  const withCorrectionFields = (entry) =>
    editingRevertedId ? { ...entry, resubmitComment: resubmitComment || "" } : entry;

  // Save as Draft deliberately does NOT run the final-submission validation:
  // a draft exists precisely to hold incomplete work (the Waste Generation
  // required-field rules, incl. Truck Capacity, apply only at final submit).
  const handleSaveDraft = async () => {
    if (blockedByDeveloperContext("save a draft for them")) return;
    // A draft may be INCOMPLETE — that is its purpose — but an entirely EMPTY one
    // is not worth persisting. Now that the button also sits on the main screen
    // (beside Review & Submit, enabled while requirements are outstanding), a
    // stray click would otherwise fill Drafts & Scheduled with blank records.
    if (trucks.length === 0 && !entryForm.getFieldValue("dateOfDisposal")) {
      showError({
        type: "warning",
        title: "Nothing to Save Yet",
        message:
          "Add at least one transport entry or select the Date of Disposal before saving a draft. A draft may be incomplete, but it cannot be empty.",
      });
      return;
    }
    // Re-entrancy guard. The disabled state alone is not enough — a fast double
    // click fires both handlers before React flushes `savingDraft`, which created
    // two identical drafts. The ref flips synchronously; `clientRequestId` makes
    // the server reject the duplicate too, so a retry can't slip past either.
    if (queueActionRef.current) return;
    queueActionRef.current = true;
    setSavingDraft(true);
    try {
      // An autosave already running would otherwise race this save (and, on a
      // fresh entry, both could create a record).
      await draftAutosave.settle();
      const editingDraft = editingDraftRef.current;
      const entry = withCorrectionFields(buildSubmissionEntry());
      // Editing a draft opened from Drafts & Scheduled (or opened by autosave):
      // update THAT record, even if its disposal date was changed (the
      // facility+date match below would otherwise file a second draft and leave
      // the original behind).
      const { data } = editingDraft
        ? await api.put(`/portal-queue/${editingDraft.id}`, {
            type: "draft",
            payload: entry,
            slfName: activeSlfName,
            slfGenerator: activeSlfId || null,
            ...correctionLink(),
          })
        : await api.post("/portal-queue", {
            type: "draft",
            payload: entry,
            clientRequestId: newClientRequestId(),
            slfName: activeSlfName,
            slfGenerator: activeSlfId || null,
            ...correctionLink(),
          });
      invalidateQueueCache();
      setReviewModalOpen(false);
      // A scheduled run saved as a draft is now an ordinary draft.
      if (editingDraft?.type === "scheduled") {
        setEditingDraft((current) => (current ? { ...current, type: "draft" } : current));
      }
      // Keep the saved record open so later edits (and autosaves) update it
      // instead of filing another draft, and so Review & Submit removes it.
      if (!editingDraft && data?.data?._id) {
        setEditingDraft({
          id: data.data._id,
          type: "draft",
          label: draftLabel(entry.dateOfDisposal),
        });
      }
      draftAutosave.adoptNext();
      if (editingRevertedId) {
        Swal.fire({
          icon: "success",
          title: "Correction Saved as Draft",
          html:
            `Your correction of <b>${String(resubmittingIdNo || "the reverted entry").replace(/[<>&]/g, "")}</b> was saved. ` +
            "Submitting it from Drafts &amp; Scheduled will <b>resubmit that entry</b> — it will not be filed as a new submission.",
          confirmButtonColor: "#1a3353",
        });
        return;
      }
      // Saving the same facility + disposal date again REPLACES the draft that
      // already holds it rather than stacking another copy beside it, so the
      // message has to say which of the two just happened — "Saved as Draft"
      // after an update reads as though a second draft now exists.
      const updatedExisting = Boolean(editingDraft) || Boolean(data?.updatedExisting);
      Swal.fire({
        icon: "success",
        title: updatedExisting ? "Draft Updated" : "Saved as Draft",
        text: editingDraft
          ? "Your draft was updated. Submit it from Drafts & Scheduled, or open it again to keep editing."
          : updatedExisting
          ? "Your existing draft for this facility and disposal date was updated. Submit it from Drafts & Scheduled when it is complete."
          : "Your encoded data was saved. You can submit it later from Drafts & Scheduled.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      showError({
        type: "error",
        title: "Could Not Save Draft",
        message: err.response?.data?.message || "Something went wrong while saving your draft.",
      });
    } finally {
      queueActionRef.current = false;
      setSavingDraft(false);
    }
  };

  // ── Autosave to Drafts ──
  //
  // While the operator types, the entry is saved to Drafts & Scheduled on its
  // own (useDraftAutosave decides when). It is the SAME record Save as Draft
  // writes: the first autosave creates the draft — or updates the existing draft
  // for this facility + disposal date — and opens it, so every later save, manual
  // or automatic, updates that one record and Review & Submit removes it.
  //
  // What counts as an edit: the disposal date, company details, the transport
  // entries and a correction's note. Baseline values ride along in the payload
  // (it is the full submission entry) but do not trigger a save on their own —
  // the baseline has its own Save Baseline Update.
  const draftLabel = (day) => (day ? dayjs(day).format("MMM D, YYYY") : "undated");

  const getAutosaveSignature = () => {
    const disposal = entryForm.getFieldsValue(true);
    // Empty entry → nothing to save (same rule as manual Save as Draft).
    if (trucks.length === 0 && !disposal.dateOfDisposal) return null;
    return JSON.stringify([
      activeSlfId || activeSlfName || "",
      disposal,
      companyForm.getFieldsValue(true),
      trucks,
      editingRevertedId || "",
      editingRevertedId ? resubmitComment || "" : "",
    ]);
  };

  const autosaveDraft = async () => {
    const entry = withCorrectionFields(buildSubmissionEntry());
    const label = draftLabel(entry.dateOfDisposal);
    const body = {
      type: "draft",
      payload: entry,
      slfName: activeSlfName,
      slfGenerator: activeSlfId || null,
      autosave: true,
      ...correctionLink(),
    };
    const open = editingDraftRef.current;
    if (open?.id) {
      try {
        await api.put(`/portal-queue/${open.id}`, body);
        setEditingDraft((current) => (current?.id === open.id ? { ...current, label } : current));
        invalidateQueueCache();
        return;
      } catch (err) {
        // Deleted from Drafts & Scheduled (here or in another tab) or already
        // submitted: fall through and save a fresh draft instead of losing work.
        const gone = err.response?.status === 404 || err.response?.status === 400;
        if (!gone) throw err;
      }
    }
    const { data } = await api.post("/portal-queue", { ...body, clientRequestId: newClientRequestId() });
    const id = data?.data?._id;
    if (!id) return;
    editingDraftRef.current = { id, type: "draft", label };
    setEditingDraft(editingDraftRef.current);
    invalidateQueueCache();
  };

  const draftAutosave = useDraftAutosave({
    // Off for: developers inspecting an account (the server refuses their
    // writes), scheduled runs (a draft save would unschedule them — those keep
    // the explicit Schedule / Save as Draft buttons), and while a submit or a
    // manual save/schedule is running.
    enabled:
      Boolean(portalUser?.email) &&
      Boolean(activeSlfName) &&
      !isDeveloperContext &&
      editingDraft?.type !== "scheduled" &&
      !loading &&
      !savingDraft &&
      !schedulingSubmit,
    getSignature: getAutosaveSignature,
    save: autosaveDraft,
  });

  // After a successful submit: the open draft (opened from Drafts & Scheduled,
  // by Save as Draft, or by autosave) has been superseded, so it is deleted.
  // Waits for an autosave already in flight first — one that finished after the
  // delete would otherwise leave the submitted entry behind as a draft. Never
  // throws: a failure leaves a stale draft, never a lost submission.
  const retireOpenDraft = async () => {
    try {
      await draftAutosave.settle();
    } catch {
      /* settle never rejects; belt and braces */
    }
    const open = editingDraftRef.current;
    editingDraftRef.current = null;
    setEditingDraft(null);
    draftAutosave.adoptNext();
    if (open?.id) {
      api
        .delete(`/portal-queue/${open.id}`)
        .catch(() => {})
        .finally(invalidateQueueCache);
    }
  };

  const handleScheduleSubmission = async () => {
    if (blockedByDeveloperContext("schedule a submission for them")) return;
    if (!scheduleAt) {
      Swal.fire({ icon: "warning", title: "Pick a date & time", text: "Please choose when this submission should be sent." });
      return;
    }
    if (scheduleAt.valueOf() <= Date.now()) {
      Swal.fire({ icon: "warning", title: "Invalid time", text: "Scheduled time must be in the future." });
      return;
    }
    // Same double-schedule guard as Save as Draft above.
    if (queueActionRef.current) return;
    queueActionRef.current = true;
    setSchedulingSubmit(true);
    try {
      // An autosaved draft of this entry becomes the scheduled run (PUT below)
      // rather than staying behind as a duplicate draft.
      await draftAutosave.settle();
      const editingDraft = editingDraftRef.current;
      const entry = withCorrectionFields(buildSubmissionEntry());
      // `scheduledAt` is sent as an absolute ISO instant (UTC), so the server's
      // "must be in the future" check and the worker's `scheduledAt <= now` sweep
      // compare the same instant regardless of the browser's timezone.
      // Editing a draft or a scheduled run opened from Drafts & Scheduled: update
      // THAT record (now scheduled at the chosen time) instead of filing a copy
      // and leaving the original behind.
      if (editingDraft?.id) {
        await api.put(`/portal-queue/${editingDraft.id}`, {
          type: "scheduled",
          payload: entry,
          scheduledAt: scheduleAt.toISOString(),
          slfName: activeSlfName,
          slfGenerator: activeSlfId || null,
          ...correctionLink(),
        });
        setEditingDraft(null);
      } else {
        await api.post("/portal-queue", {
          type: "scheduled",
          payload: entry,
          scheduledAt: scheduleAt.toISOString(),
          clientRequestId: newClientRequestId(),
          slfName: activeSlfName,
          slfGenerator: activeSlfId || null,
          ...correctionLink(),
        });
      }
      invalidateQueueCache();
      // The scheduled run holds this entry now; only a further edit starts a draft.
      draftAutosave.adoptNext();
      setScheduleModalOpen(false);
      setScheduleAt(null);
      setReviewModalOpen(false);
      Swal.fire({
        icon: "success",
        title: editingRevertedId ? "Resubmission Scheduled" : "Submission Scheduled",
        text: editingRevertedId
          ? `Your correction of ${resubmittingIdNo || "the reverted entry"} will be resubmitted automatically at the scheduled time.`
          : "Your submission will be sent automatically at the scheduled time.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      showError({
        type: "error",
        title: "Could Not Schedule",
        message: err.response?.data?.message || "Something went wrong while scheduling your submission.",
      });
    } finally {
      queueActionRef.current = false;
      setSchedulingSubmit(false);
    }
  };

  return {
    draftAutosave, handleSaveDraft, handleScheduleSubmission, retireOpenDraft, savingDraft,
    scheduleModalOpen, schedulingSubmit, setScheduleModalOpen,
  };
}
