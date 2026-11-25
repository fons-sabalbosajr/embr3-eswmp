import { useState, useRef } from "react";
import api from "../../../api";
import { normalizeUnit } from "../helpers";
import { convertVolume } from "../../../utils/volumeUnits";
import { resolveCellName } from "../../../utils/cellVisuals";
import Swal from "sweetalert2";

export default function useHistoryDetail({
  declaredCellUnit, slfInfo,
}) {
  const [historyDetailModal, setHistoryDetailModal] = useState(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [historyDetailError, setHistoryDetailError] = useState(null);

  // ── Submission Details modal ──────────────────────────────────────────────
  //
  // The history LIST is lean (no trucks — see PORTAL_SUBMISSION_LIST_FIELDS), so the
  // detail modal fetches the full record by id. It opens IMMEDIATELY with the row it
  // already has (id, company, date, status all render at once) and streams the heavy
  // parts in behind a skeleton, instead of blocking on the request first.
  //
  // A small LRU cache means reopening the same submission is instant. It is bounded
  // (see MAX) precisely so browsing a long history can't accumulate every full
  // record — trucks[]/vehicles[] are the heaviest thing the Portal holds.
  const HISTORY_DETAIL_CACHE_MAX = 5;
  const historyDetailCache = useRef(new Map());
  const historyDetailReqRef = useRef(0);

  const openHistoryDetail = async (row) => {
    if (!row?._id) return;
    // Show the modal instantly using the row we already have.
    setHistoryDetailModal(row);

    const cached = historyDetailCache.current.get(row._id);
    if (cached) {
      // Refresh recency (Map preserves insertion order → re-set moves it to newest).
      historyDetailCache.current.delete(row._id);
      historyDetailCache.current.set(row._id, cached);
      setHistoryDetailModal(cached);
      return;
    }

    const reqId = ++historyDetailReqRef.current;
    setHistoryDetailLoading(true);
    try {
      const { data } = await api.get(`/portal-auth/my-submissions/${row._id}`);
      // Ignore a response for a submission the user has already navigated away from.
      if (reqId !== historyDetailReqRef.current) return;

      historyDetailCache.current.set(row._id, data);
      // Evict the oldest once over the cap, so the cache can't grow unbounded.
      while (historyDetailCache.current.size > HISTORY_DETAIL_CACHE_MAX) {
        const oldest = historyDetailCache.current.keys().next().value;
        historyDetailCache.current.delete(oldest);
      }
      setHistoryDetailModal(data);
    } catch (err) {
      if (reqId !== historyDetailReqRef.current) return;
      setHistoryDetailError(
        err.response?.data?.message || "Could not load the full submission details.",
      );
    } finally {
      if (reqId === historyDetailReqRef.current) setHistoryDetailLoading(false);
    }
  };

  const closeHistoryDetail = () => {
    historyDetailReqRef.current += 1; // invalidate any in-flight response
    setHistoryDetailModal(null);
    setHistoryDetailError(null);
    setHistoryDetailLoading(false);
  };

  // Open a cell entry for editing, NORMALIZED into the SLF's declared unit.
  //
  // Entries encoded before the unit was declared (or under a previous unit) can be
  // stored in m³ while the SLF now declares tons. Opening them as-is showed the raw
  // number under the wrong unit; the volume is converted so the figure the user sees
  // — and re-saves — is truthful in the declared unit.
  const openCellEntryForEdit = (row, { setDraft, setEditingKey, setOpen }) => {
    const declared = normalizeUnit(declaredCellUnit(row.cellIndex));
    const stored = normalizeUnit(row.unit || declared);
    const converted =
      stored === declared ? row.volume : convertVolume(row.volume, stored, declared);
    setEditingKey(row.key);
    // Resolve the name from the cell's stable index so an entry saved under an old
    // (or positional) label opens pre-selected on the cell it actually refers to,
    // rather than as an unmatched "(not in cell infra)" value.
    const canonicalName =
      typeof row.cellIndex === "number"
        ? resolveCellName(slfInfo, row.cellIndex, row.cellName)
        : row.cellName;
    setDraft({
      cellName: canonicalName || row.cellName,
      cellType: row.cellType,
      cellIndex: row.cellIndex,
      wasteType: row.wasteType,
      // Unconvertible (missing/unknown unit) → keep the stored number rather than
      // writing a guessed one; the hint in the modal flags the mismatch.
      volume: converted === null ? row.volume : Math.round(converted * 100) / 100,
      unit: declared,
      dateClosed: row.dateClosed || null,
      movAttachments: Array.isArray(row.movAttachments) ? row.movAttachments : [],
      // The operator's own name for the cell; the entry stays bound to the
      // admin-declared cell (cellIndex / cellName) either way.
      cellLabel: row.cellLabel || "",
    });
    setOpen(true);
  };

  // Put a draft into the unit the admin declared for its cell, converting the
  // number when the draft was typed under another unit (e.g. the cell was changed
  // after the volume was entered). Unconvertible → keep the number as typed.
  const toDeclaredCellUnit = (draft) => {
    const declared = normalizeUnit(declaredCellUnit(draft.cellIndex));
    const from = normalizeUnit(draft.unit || declared);
    if (from === declared) return { ...draft, unit: declared };
    const converted = convertVolume(draft.volume, from, declared);
    return {
      ...draft,
      unit: declared,
      volume: converted === null ? draft.volume : Math.round(converted * 1000) / 1000,
    };
  };

  // Shared add/update for both cell lists.
  const saveCellEntryDraft = (draft, editingKey, setEntries, setOpen, { closed = false } = {}) => {
    if (!draft.cellName || !draft.wasteType || draft.volume == null) {
      Swal.fire(
        "Incomplete entry",
        "Select a cell, a waste type and enter the volume before saving.",
        "warning",
      );
      return;
    }
    const normalized = toDeclaredCellUnit(draft);
    const entry = {
      ...normalized,
      ...(closed ? { dateClosed: normalized.dateClosed || null } : {}),
      movAttachments: Array.isArray(normalized.movAttachments) ? normalized.movAttachments : [],
    };
    if (!closed) delete entry.dateClosed;
    if (editingKey != null) {
      setEntries((prev) =>
        prev.map((e) => (e.key === editingKey ? { ...entry, key: editingKey } : e)),
      );
    } else {
      setEntries((prev) => [...prev, { ...entry, key: Date.now() }]);
    }
    setOpen(false);
  };

  return {
    closeHistoryDetail, historyDetailError, historyDetailLoading, historyDetailModal,
    openCellEntryForEdit, openHistoryDetail, saveCellEntryDraft, setHistoryDetailModal,
  };
}
