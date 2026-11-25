import { useState, useMemo } from "react";
import { makeTruckColumns } from "../columns/truckColumns";
import { makeHaulerColumns } from "../columns/haulerColumns";
import Swal from "sweetalert2";
import api from "../../../api";
import secureStorage from "../../../utils/secureStorage";
import { invalidateCache } from "../../../utils/pageCache";
import { PORTAL_SUBMISSIONS_CACHE_KEY } from "../constants";
import { useStableCallback } from "../portalShared";
import { makeHistoryColumns } from "../columns/historyColumns";

export default function usePortalTableColumns({
  backlogSummary, baselineSaved, fetchSubmissions, handleEditRevertedRow, haulers, openHaulerModal,
  openHistoryDetail, openRevertModal, openTruckModal, portalSettings, portalUser, removeHauler,
  removeTruck, showError, slfUnit, submissions, trucks,
}) {
  // Hauler delete request modal
  const [haulerDeleteModal, setHaulerDeleteModal] = useState({
    open: false,
    hauler: null,
  });
  const [haulerDeleteReason, setHaulerDeleteReason] = useState("");
  const [haulerDeleteFile, setHaulerDeleteFile] = useState(null);

  // ── Table column definitions — see columns/ ──
  const truckColumns = makeTruckColumns({
    slfUnit,
    openTruckModal,
    removeTruck,
    showDisposalDate: Boolean(backlogSummary),
  });

  // Hauler table columns.
  //
  // Memoized on the fleet because the column definitions now carry FILTER option
  // lists derived from it — distinct hauler names, vehicle types and client names
  // — which is O(haulers × clients) to build. Facilities here run 80–141
  // accredited haulers, so rebuilding those lists on every render of the pane
  // would be the same class of waste the dashboard derivations were memoized to
  // stop. It also keeps the columns array stable, so AntD does not drop the
  // operator's active filters on an unrelated re-render.
  const haulerColumns = useMemo(
    () =>
      makeHaulerColumns({
        slfUnit,
        baselineSaved,
        haulers,
        openHaulerModal,
        removeHauler,
        setHaulerDeleteModal,
        setHaulerDeleteReason,
        setHaulerDeleteFile,
      }),
    // openHaulerModal / removeHauler and the three delete setters are omitted
    // deliberately. They are recreated on every render, so listing them would
    // defeat the memo entirely — and they are safe to leave out: the setters are
    // useState setters (stable by contract), removeHauler mutates through the
    // functional form `setHaulers((prev) => …)` so it cannot read a stale fleet,
    // and openHaulerModal works from the `record` the row hands it plus `slfUnit`,
    // which IS a dependency. No stale closure is reachable through any of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slfUnit, baselineSaved, haulers],
  );

  // Portal user removes a submission from their own history. The record is
  // retained on the admin side — this only hides it from the portal view.
  const handleHideSubmission = async (record) => {
    const result = await Swal.fire({
      icon: "warning",
      title: "Remove from your history?",
      html: "This hides the entry from your Submission History. <b>EMB Region III still keeps a record of it.</b> This cannot be undone from your side.",
      showCancelButton: true,
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#ff4d4f",
    });
    if (!result.isConfirmed) return;
    try {
      await api.patch(
        `/portal-auth/my-submissions/${record._id}/hide`,
        {},
        {
          headers: {
            Authorization: `Bearer ${secureStorage.get("portal_token")}`,
          },
        },
      );
      invalidateCache(
        `${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`,
      );
      fetchSubmissions(false, true);
      Swal.fire({
        icon: "success",
        title: "Removed",
        text: "The submission was removed from your history.",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      showError({
        type: "error",
        title: "Could Not Remove",
        message:
          err.response?.data?.message ||
          "We couldn't remove this submission. Please try again.",
      });
    }
  };

  // History table columns. Grouping + filtering now live in HistoryPanel (it owns
  // the filtered total, page size and reverted-first ordering).
  // Global SLF sensitive-value masking (developer-controlled). When on, the
  // history table masks contact/account identifiers (address); the resolver in
  // OverviewPanel / detail modal masks volumes + capacity via the context.
  const maskSensitive = !!portalSettings?.maskSensitiveSlfValues;

  // The column set carries a render function per column and was rebuilt on every
  // render, handing HistoryPanel a brand-new `columns` array each time — which
  // makes antd's Table re-render every row. The row handlers are wrapped so the
  // memo has a stable dependency set without having to relocate their
  // declarations (and without a dependency list that can go stale).
  const stableOpenHistoryDetail = useStableCallback((...a) => openHistoryDetail(...a));
  const stableOpenRevertModal = useStableCallback((...a) => openRevertModal(...a));
  const stableEditRevertedRow = useStableCallback((...a) => handleEditRevertedRow(...a));
  const stableHideSubmission = useStableCallback((...a) => handleHideSubmission(...a));
  const historyColumns = useMemo(
    () =>
      makeHistoryColumns({
        submissions,
        trucks,
        maskSensitive,
        openHistoryDetail: stableOpenHistoryDetail,
        openRevertModal: stableOpenRevertModal,
        handleEditRevertedRow: stableEditRevertedRow,
        handleHideSubmission: stableHideSubmission,
      }),
    [
      submissions,
      trucks,
      maskSensitive,
      stableOpenHistoryDetail,
      stableOpenRevertModal,
      stableEditRevertedRow,
      stableHideSubmission,
    ],
  );

  return {
    haulerColumns, haulerDeleteFile, haulerDeleteModal, haulerDeleteReason, historyColumns,
    setHaulerDeleteFile, setHaulerDeleteModal, setHaulerDeleteReason, stableEditRevertedRow,
  };
}
