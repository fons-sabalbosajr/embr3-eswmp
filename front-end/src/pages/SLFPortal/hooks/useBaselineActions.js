import { useState, useRef, useEffect } from "react";
import api from "../../../api";
import Swal from "sweetalert2";
import { resolveBaselineLock, resolveTotalVolumeForSave } from "../portalShared";
import { mergeHaulersByName } from "../haulerNormalization";
import { normalizeUnit } from "../helpers";
import { PORTAL_WASTE_RECEIVED_CACHE_KEY, PORTAL_CACHE_TTL } from "../constants";
import { fetchWithCache, invalidateCache } from "../../../utils/pageCache";

export default function useBaselineActions({
  acceptsHazardousWaste, activeCellEntries, activeMenu, activeSlfId, activeSlfName, barangays,
  baselineForm, baselineMov, baselineTotalVolume, baselineUnit, cellVolumeTotalIsAuthoritative,
  closedCellEntries, companyForm, computedTotalVolumeAccepted, entryForm, fetchSubmissions, haulers,
  isMenuDataFresh, markMenuFetched, municipalities, portalUser, provinces, regions,
  setBaselineRefresh, setBaselineSaved, setBaselineUpdatePending, setSlfInfo, showError, slfInfo,
  slfUnit, wasteReceivedRefresh,
}) {
  const [baselineUpdateLoading, setBaselineUpdateLoading] = useState(false);
  const [baselineRefreshLoading, setBaselineRefreshLoading] = useState(false);
  const [baselineSavingLoading, setBaselineSavingLoading] = useState(false);
  // The last bump the waste-received effect acted on, so a plain menu switch is
  // told apart from an admin-driven invalidation.
  const lastWasteRefreshRef = useRef(0);
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertRecord, setRevertRecord] = useState(null);
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [facilityMgmtSaving, setFacilityMgmtSaving] = useState(false);
  // Waste Received modal
  const [wasteReceivedModalOpen, setWasteReceivedModalOpen] = useState(false);
  const [wasteReceivedData, setWasteReceivedData] = useState({
    lguR3: [],
    lguOutside: [],
    privateIndustry: [],
    baselineClients: [],
    submissionClients: [],
    clientBreakdown: [],
    totals: { m3: 0, tons: 0, trucks: 0 },
  });
  const [wasteReceivedLoading, setWasteReceivedLoading] = useState(false);

  // ── Revert request helpers ──

  const openRevertModal = (record) => {
    setRevertRecord(record);
    setRevertReason("");
    setRevertModalOpen(true);
  };

  const handleRequestRevert = async () => {
    if (!revertReason.trim()) return;
    if (!navigator.onLine) {
      showError({
        type: "offline",
        title: "You\u2019re Offline",
        message: "Please check your internet connection and try again.",
      });
      return;
    }
    setRevertLoading(true);
    try {
      await api.patch(`/data-slf/${revertRecord._id}/request-edit`, {
        reason: revertReason,
        requestedBy: portalUser?.email,
      });
      setRevertModalOpen(false);
      setRevertRecord(null);
      setRevertReason("");
      // Forced: the request sets revertRequested on the record, which the history
      // row renders — a cached list would not show it.
      fetchSubmissions(true, true);
      Swal.fire({
        icon: "success",
        title: "Edit Requested",
        html: "Your edit request has been sent. The admin will review and approve or reject it.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      if (!navigator.onLine || err.code === "ERR_NETWORK") {
        showError({
          type: "offline",
          title: "Connection Lost",
          message: "Please check your internet connection and try again.",
        });
      } else {
        showError({
          type: "error",
          title: "Request Failed",
          message: err.response?.data?.message || "Something went wrong.",
        });
      }
    } finally {
      setRevertLoading(false);
    }
  };

  // ── Request Baseline Update ──
  const handleBaselineUpdateRequest = async () => {
    const { value: reason } = await Swal.fire({
      title: "Request Baseline Update",
      html: "<p style='font-size:13px'>Your baseline data is locked after your first submission. Provide a reason and the admin will review your request.</p>",
      input: "textarea",
      inputPlaceholder: "Describe what needs to be updated and why...",
      inputAttributes: { "aria-label": "Reason" },
      showCancelButton: true,
      confirmButtonText: "Send Request",
      confirmButtonColor: "#1a3353",
      inputValidator: (v) => {
        if (!v?.trim()) return "Please provide a reason";
      },
    });
    if (!reason) return;
    setBaselineUpdateLoading(true);
    try {
      await api.post("/data-slf/baseline-update-request", {
        slfName: activeSlfName,
        requestedBy: portalUser?.email,
        fields: [
          "Volume of Waste Accepted",
          "Total Volume Disposed in Active Cells",
          "Accredited Haulers",
          "Total Volume Disposed in Closed Cells",
        ],
        reason: reason.trim(),
      });
      setBaselineSaved(true);
      setBaselineUpdatePending(true);
      Swal.fire({
        icon: "success",
        title: "Request Sent",
        text: "Your baseline update request has been sent to the admin for review.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Failed",
        text: err.response?.data?.message || "Could not send request.",
      });
    } finally {
      setBaselineUpdateLoading(false);
    }
  };

  const refreshBaselineStatus = async () => {
    if (!activeSlfName) return;
    setBaselineRefreshLoading(true);
    try {
      const { data } = await api.get(
        `/data-slf/baseline/${encodeURIComponent(activeSlfName)}?slfId=${encodeURIComponent(activeSlfId || "")}`,
      );
      // Record-driven, same as the loader and socket handler — a company-info-only
      // baseline is still a saved baseline and must report as locked here too.
      const lock = resolveBaselineLock(data);
      setBaselineSaved(lock.locked);
      setBaselineUpdatePending(lock.updatePending);

      if (data) {
        if (!lock.locked) {
          Swal.fire({
            icon: "success",
            title: "Baseline Editing Unlocked",
            timer: 1400,
            showConfirmButton: false,
          });
        } else {
          Swal.fire({
            icon: "info",
            title: lock.updatePending
              ? "Still Awaiting Approval"
              : "Baseline Still Locked",
            timer: 1400,
            showConfirmButton: false,
          });
        }
      }
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Refresh Failed",
        text:
          err.response?.data?.message || "Could not refresh baseline status.",
      });
    } finally {
      setBaselineRefreshLoading(false);
    }
  };

  // ── Save Portal Baseline Update (after admin approval) ──
  const handleSaveBaselinePortal = async () => {
    if (portalUser?.portalAccess?.canEditBaseline === false) {
      Swal.fire(
        "Baseline Editing Disabled",
        "Your account is not permitted to edit baseline data. Please contact EMB Region III.",
        "warning",
      );
      return;
    }
    const confirm = await Swal.fire({
      title: "Save Baseline Update?",
      html: "<p style='font-size:13px'>This will save your updated baseline data and re-lock the baseline for future edits. You will need to submit another update request if further changes are needed.</p>",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Save & Lock",
      confirmButtonColor: "#1a3353",
      cancelButtonText: "Continue Editing",
    });
    if (!confirm.isConfirmed) return;

    setBaselineSavingLoading(true);
    try {
      // validateFields() resolves with ONLY the fields currently mounted, exactly
      // like a bare getFieldsValue(). Using its result as the payload meant that
      // saving the baseline while a pane was collapsed or on another tab silently
      // dropped every field in that pane — which is how baseline values came back
      // blank or reset after a save.
      //
      // Validation still runs (so errors are still reported and the save still
      // aborts on invalid input); the validated values are then layered OVER the
      // complete form store, so nothing unmounted is lost.
      const [validatedBaseline, validatedCompany] = await Promise.all([
        baselineForm.validateFields(),
        companyForm.validateFields(),
      ]);
      const baselineValues = { ...baselineForm.getFieldsValue(true), ...validatedBaseline };
      const companyValues = { ...companyForm.getFieldsValue(true), ...validatedCompany };
      // Cell entries only win when they carry real volumes; otherwise the
      // user-entered figure is preserved (see cellVolumeTotalIsAuthoritative).
      // Total Volume Accepted.
      //
      // `??` only falls through on null/undefined, and 0 is neither. While
      // validateFields() supplied this object, a closed Baseline pane simply
      // OMITTED the field, so the fallback ran. Reading the whole store now
      // always supplies it — including a default/stale 0 the user never typed —
      // which was then sent and overwrote the saved figure with 0.
      //
      // A blank or zero here means "this edit did not provide it". Treating it as
      // absent lets the server's own Total Volume guard preserve what is stored.
      // A REAL zero still saves: it reaches this point through
      // `cellVolumeTotalIsAuthoritative` (recomputed from cell entries) or as an
      // explicitly validated on-screen value, both of which are kept below.
      const resolvedTotalVolumeAccepted = resolveTotalVolumeForSave({
        authoritative: cellVolumeTotalIsAuthoritative,
        computed: computedTotalVolumeAccepted,
        // validateFields() resolves only with fields that are actually rendered,
        // which is exactly the "on screen" signal the helper needs.
        mountedValue: validatedBaseline.totalVolumeAccepted,
        storeValue:
          baselineValues.totalVolumeAccepted
          ?? baselineForm.getFieldValue("totalVolumeAccepted"),
        baselineValue: baselineTotalVolume,
      });
      const disposalValues = entryForm.getFieldsValue(true);
      const addressParts = [
        barangays.find((b) => b.code === companyValues.companyBarangay)?.name,
        municipalities.find((m) => m.code === companyValues.companyMunicipality)
          ?.name,
        provinces.find((p) => p.code === companyValues.companyProvince)?.name,
        regions.find((r) => r.code === companyValues.companyRegion)?.name,
      ].filter(Boolean);
      // The freshly-selected address wins.
      //
      // The old order put the STORED `address` string ahead of the parts just
      // picked in the selects, so editing the address and saving re-sent the old
      // value and the edit appeared to do nothing.
      const composedAddress = addressParts.join(", ");
      const resolvedAddress =
        composedAddress || disposalValues.address || companyValues.address || "";
      // Compute legacy totals from entries for backward compat
      const wasteTypeOf = (entry) => String(entry?.wasteType || "").trim().toLowerCase();
      const isLegacyInertHazard = (entry) => wasteTypeOf(entry) === "inert/hazardous waste";
      const isResidualEntry = (entry) => wasteTypeOf(entry).includes("residual");
      const isHazardousEntry = (entry) => wasteTypeOf(entry).includes("hazard") && !isLegacyInertHazard(entry);
      const isInertEntry = (entry) => wasteTypeOf(entry).includes("inert") || isLegacyInertHazard(entry);
      const sumCellEntries = (entries, predicate) =>
        entries.filter(predicate).reduce((sum, entry) => sum + (Number(entry.volume) || 0), 0);
      // When cell entries exist they are AUTHORITATIVE for the legacy per-waste-type
      // totals. The previous `sum || formValue || undefined` fallback meant changing
      // an entry's Waste Type left the vacated bucket holding its old figure (the sum
      // became 0, which is falsy, so the stale form value won) — the edit looked like
      // it had not applied. `null` is sent rather than `undefined` so an emptied
      // bucket is actually cleared on the server instead of being skipped.
      const entryTotal = (entries, predicate, fallback) =>
        entries.length ? sumCellEntries(entries, predicate) || null : fallback || undefined;
      const activeCellResidualVolume = entryTotal(
        activeCellEntries, isResidualEntry, baselineValues.activeCellResidualVolume,
      );
      const activeCellInertVolume = entryTotal(
        activeCellEntries, isInertEntry, baselineValues.activeCellInertVolume,
      );
      const activeCellHazardousVolume = entryTotal(
        activeCellEntries, isHazardousEntry, baselineValues.activeCellHazardousVolume,
      );
      const closedCellResidualVolume = entryTotal(
        closedCellEntries, isResidualEntry, baselineValues.closedCellResidualVolume,
      );
      const closedCellInertVolume = entryTotal(
        closedCellEntries, isInertEntry, baselineValues.closedCellInertVolume,
      );
      const closedCellHazardousVolume = entryTotal(
        closedCellEntries, isHazardousEntry, baselineValues.closedCellHazardousVolume,
      );

      const { data: saveResult } = await api.patch(
        `/data-slf/portal-save-baseline/${encodeURIComponent(activeSlfName)}`,
        {
          submittedBy: portalUser?.email,
          slfGenerator: activeSlfId || null,
          lguCompanyName:
            companyValues.lguCompanyName || slfInfo?.lgu || activeSlfName,
          companyType:
            companyValues.companyType ||
            ((slfInfo?.ownership || "").toLowerCase().includes("private")
              ? "Private"
              : "LGU"),
          // Address fields are OMITTED when empty rather than sent blank.
          //
          // The server applies any key whose value is not `undefined`, so an
          // empty string is a positive instruction to clear the column. The
          // address is derived from lookups against the cascading option arrays
          // (region → province → municipality → barangay); if any of those lists
          // has not loaded, the lookup misses, the part is dropped, and the whole
          // string collapses to "" — which then WIPED the stored address on save.
          //
          // Empty here means "this edit did not supply it", never "clear it" —
          // the same rule the Total Volume guard already applies server-side.
          ...(resolvedAddress ? { address: resolvedAddress } : {}),
          ...(companyValues.companyRegion ? { companyRegion: companyValues.companyRegion } : {}),
          ...(companyValues.companyProvince ? { companyProvince: companyValues.companyProvince } : {}),
          ...(companyValues.companyMunicipality ? { companyMunicipality: companyValues.companyMunicipality } : {}),
          ...(companyValues.companyBarangay ? { companyBarangay: companyValues.companyBarangay } : {}),
          // Persist the assigned SLF's current unit when the baseline has no
          // explicit unit yet — never an empty/stale unit (Item #3: store the unit
          // on every record so historical values stay accurate).
          baselineUnit: baselineUnit || slfUnit,
          totalVolumeAccepted: resolvedTotalVolumeAccepted,
          totalVolumeAcceptedUnit: baselineUnit || slfUnit,
          baselineMov,
          activeCellResidualVolume,
          activeCellResidualUnit: baselineUnit || slfUnit,
          activeCellInertVolume,
          activeCellInertUnit: baselineUnit || slfUnit,
          activeCellHazardousVolume,
          activeCellHazardousUnit: baselineUnit || slfUnit,
          closedCellResidualVolume,
          closedCellResidualUnit: baselineUnit || slfUnit,
          closedCellInertVolume,
          closedCellInertUnit: baselineUnit || slfUnit,
          closedCellHazardousVolume,
          closedCellHazardousUnit: baselineUnit || slfUnit,
          activeCellEntries: activeCellEntries.map(({ key, ...rest }) => ({
            ...rest,
            unit: rest.unit || baselineUnit || slfUnit,
          })),
          closedCellEntries: closedCellEntries.map(({ key, ...rest }) => ({
            ...rest,
            unit: rest.unit || baselineUnit || slfUnit,
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
          acceptsHazardousWaste: Boolean(
            baselineValues.acceptsHazardousWaste ?? acceptsHazardousWaste,
          ),
        },
      );

      // Trust the SERVER's persisted lock state, not the fact that the request
      // returned 200. The response reads `locked` back out of the database after
      // the write, so a re-lock that did not actually persist can no longer show
      // as a locked form that silently reopens on the next reload.
      const lockedNow = saveResult?.locked !== undefined ? !!saveResult.locked : true;
      setBaselineSaved(lockedNow);
      setBaselineUpdatePending(false);
      // Re-read the saved baseline so the Active/Closed Cell tables (and the
      // totals derived from them) show what was persisted, immediately — the same
      // values a page reload would produce.
      setBaselineRefresh((n) => n + 1);

      Swal.fire({
        icon: "success",
        title: "Baseline Updated!",
        text: lockedNow
          ? "Your baseline data has been saved and locked successfully."
          : "Your baseline data has been saved. An approved update window is still open, so the form stays editable.",
        confirmButtonColor: "#1a3353",
        timer: 2500,
        showConfirmButton: false,
      });
    } catch (err) {
      if (err?.errorFields) {
        Swal.fire({
          icon: "warning",
          title: "Review Baseline Fields",
          text: "Please complete the required baseline and company information before saving.",
          confirmButtonColor: "#1a3353",
        });
        return;
      }
      // The server refuses a save against a LOCKED baseline (409). That is not a
      // form error the user can fix by retrying — surface the workflow instead,
      // and re-lock the form so it matches the state the server just reported.
      if (err.response?.status === 409 && err.response?.data?.locked) {
        setBaselineSaved(true);
        setBaselineUpdatePending(false);
        setBaselineRefresh((n) => n + 1);
        Swal.fire({
          icon: "info",
          title: "Baseline Is Locked",
          text: err.response.data.message,
          confirmButtonColor: "#1a3353",
        });
        return;
      }
      Swal.fire({
        icon: "error",
        title: "Save Failed",
        // Issue 4: VERA-branded, specific save-failure guidance. The modal is NOT
        // dismissed to a "saved" state — baselineSaved stays false so the user can
        // review the highlighted fields and retry without losing their input.
        text:
          "VERA: Your changes were not saved. " +
          (err.response?.data?.message ||
            "Please review the highlighted fields and try again."),
      });
    } finally {
      setBaselineSavingLoading(false);
    }
  };

  // ── Save facility management details (Leachate Treatment Plant, gas management, etc.) ──
  const handleSaveFacilityDetails = async (type, data) => {
    if (!activeSlfId) return;
    setFacilityMgmtSaving(true);
    try {
      const payload = { slfName: activeSlfName };
      if (type === "leachate") {
        payload.leachatePondDetails = data.map(
          ({
            _key,
            attachments,
            hasWastewaterTreatmentFacility,
            wastewaterTreatmentFacilityType,
            ...r
          }) => ({ ...r, attachments: [] }),
        );
        payload.hasWastewaterTreatmentFacility =
          !!slfInfo?.hasWastewaterTreatmentFacility;
        payload.wastewaterTreatmentFacilityType = Array.isArray(
          slfInfo?.wastewaterTreatmentFacilityType,
        )
          ? slfInfo.wastewaterTreatmentFacilityType
          : slfInfo?.wastewaterTreatmentFacilityType
            ? [slfInfo.wastewaterTreatmentFacilityType]
            : [];
        payload.wastewaterTreatmentFacilityRemarks =
          slfInfo?.wastewaterTreatmentFacilityRemarks || "";
      }
      if (type === "gasVent")
        payload.gasVentDetails = data.map(({ _key, attachments, ...r }) => ({
          ...r,
          attachments: [],
        }));
      if (type === "trashSlide")
        payload.trashSlideMeasures = data.map(({ _key, ...r }) => r);
      if (type === "firePrev")
        payload.firePrevMeasures = data.map(({ _key, ...r }) => r);
      const { data: updated } = await api.patch(
        `/slf-facilities/portal/${activeSlfId}/facility-details`,
        payload,
      );
      setSlfInfo((prev) => ({ ...prev, ...updated }));
      Swal.fire({
        icon: "success",
        title: "Saved!",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Save Failed",
        text: err.response?.data?.message || "Could not save details.",
      });
    } finally {
      setFacilityMgmtSaving(false);
    }
  };

  // ── Fetch waste received summary ──
  const handleOpenWasteReceived = async ({ openModal = true } = {}) => {
    if (openModal) setWasteReceivedModalOpen(true);
    if (!activeSlfName) return;
    setWasteReceivedLoading(true);
    const cacheKey = `${PORTAL_WASTE_RECEIVED_CACHE_KEY}:${activeSlfId || activeSlfName}`;
    try {
      const data = await fetchWithCache(
        cacheKey,
        async () => {
          const { data: response } = await api.get(
            `/data-slf/waste-received-summary/${encodeURIComponent(activeSlfName)}`,
            { params: { slfId: activeSlfId } },
          );
          return response || {};
        },
        { ttl: PORTAL_CACHE_TTL, staleTtl: PORTAL_CACHE_TTL * 6 },
      );
      setWasteReceivedData({
        lguR3: [],
        lguOutside: [],
        privateIndustry: [],
        baselineClients: [],
        baselineCellBreakdown: [],
        baselineTotals: { m3: 0, tons: 0 },
        submissionClients: [],
        clientBreakdown: [],
        totals: { m3: 0, tons: 0, trucks: 0 },
        ...(data || {}),
      });
    } catch {
      setWasteReceivedData({
        lguR3: [],
        lguOutside: [],
        privateIndustry: [],
        baselineClients: [],
        baselineCellBreakdown: [],
        baselineTotals: { m3: 0, tons: 0 },
        submissionClients: [],
        clientBreakdown: [],
        totals: { m3: 0, tons: 0, trucks: 0 },
      });
    } finally {
      setWasteReceivedLoading(false);
    }
  };

  useEffect(() => {
    if (activeMenu === "overview" && activeSlfName) {
      const key = `waste:${activeSlfId || activeSlfName}`;
      // A bump means an admin changed something that moves this data, so the
      // freshness window does NOT apply — that window exists to avoid refetching
      // data nothing has touched, and something just did. Both caches are dropped
      // first, or the refetch is handed back the payload we are trying to replace.
      const invalidated = wasteReceivedRefresh !== lastWasteRefreshRef.current;
      if (invalidated) {
        lastWasteRefreshRef.current = wasteReceivedRefresh;
        invalidateCache(`${PORTAL_WASTE_RECEIVED_CACHE_KEY}:${activeSlfId || activeSlfName}`);
      } else if (isMenuDataFresh(key)) {
        // Returning to the dashboard within the cache window keeps the charts
        // already on screen instead of tearing them down for an identical fetch.
        return;
      }
      markMenuFetched(key);
      handleOpenWasteReceived({ openModal: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMenu, activeSlfId, activeSlfName, wasteReceivedRefresh]);

  return {
    baselineRefreshLoading, baselineSavingLoading, baselineUpdateLoading, facilityMgmtSaving,
    handleBaselineUpdateRequest, handleOpenWasteReceived, handleRequestRevert,
    handleSaveBaselinePortal, handleSaveFacilityDetails, openRevertModal, refreshBaselineStatus,
    revertLoading, revertModalOpen, revertReason, revertRecord, setRevertModalOpen, setRevertReason,
    setRevertRecord, setWasteReceivedModalOpen, wasteReceivedData, wasteReceivedLoading,
    wasteReceivedModalOpen,
  };
}
