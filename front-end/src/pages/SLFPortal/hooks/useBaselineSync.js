import { useState, useRef, useEffect, useCallback } from "react";
import { ORGANIZE_CELLS_ENABLED, withRetry } from "../constants";
import Swal from "sweetalert2";
import { formatOrganizeWarningHtml } from "../organizeCellsValidation";
import api from "../../../api";
import { resolveBaselineLock } from "../portalShared";
import { convertVolume, resolveFacilityUnit } from "../../../utils/volumeUnits";
import { hasBaselinePayload, normalizeBaselineMov } from "../helpers";
import { mergeHaulersByName } from "../haulerNormalization";
import { connectSocket } from "../../../utils/socket";

export default function useBaselineSync({
  activeSlfId, activeSlfName, barangays, baselineDirtyGuard, baselineForm, baselineUnit,
  companyForm, entryForm, matchBaselineCellForWasteType, municipalities, openCellOrganizer,
  portalUser, provinces, setAcceptsHazardousWaste, setActiveCellEntries, setActiveTab, setBarangays,
  setBaselineLoading, setBaselineMov, setBaselineSaved, setBaselineTotalVolume, setBaselineUnit,
  setBaselineUpdatePending, setClosedCellEntries, setHaulers, setMunicipalities, setProvinces,
  setSlfInfo, setSlfInfoLoading, setSlfInfoRefresh, showError, slfInfo, slfInfoRefresh, slfUnit,
  unplacedSubmissions,
}) {
  // When facility details (permits, cells) were last read, and for which SLF —
  // see the slfInfo fetch effect.
  const [slfInfoSyncedAt, setSlfInfoSyncedAt] = useState(null);
  const slfInfoLoadedForRef = useRef(null);
  const [baselineRefresh, setBaselineRefresh] = useState(0);
  // "region|province|municipality" the loaded address option lists belong to, so a
  // baseline refresh can skip re-fetching lists it already holds.
  const addressListsKeyRef = useRef("");
  // Local editable copies of facility detail arrays
  const [leachateDetails, setLeachateDetails] = useState([]);
  const [gasVentDetails, setGasVentDetails] = useState([]);
  const [trashSlideDetails, setTrashSlideDetails] = useState([]);
  const [firePrevDetails, setFirePrevDetails] = useState([]);
  // EMB changed the baseline while the operator had unsaved edits: the reload
  // waits for them (Reload / Keep editing in the Baseline tab).
  const [baselineRemoteChanged, setBaselineRemoteChanged] = useState(false);
  const [cellOrganizerPrompted, setCellOrganizerPrompted] = useState(false);


  // Prompt the user (once) to organize any past submissions that still have
  // waste not yet placed into an open cell.
  useEffect(() => {
    if (!ORGANIZE_CELLS_ENABLED) return;
    if (cellOrganizerPrompted) return;
    if (!portalUser?.email) return;
    if (unplacedSubmissions.length === 0) return;
    setCellOrganizerPrompted(true);
    Swal.fire({
      icon: "warning",
      title: "Organize Your Cell Placements",
      html:
        `You have <b>${unplacedSubmissions.length}</b> past submission(s) that still need organizing. ` +
        `<b>New transport entries and submissions are blocked</b> until these are completed:` +
        formatOrganizeWarningHtml(unplacedSubmissions, baselineUnit || slfUnit),
      width: 620,
      showCancelButton: true,
      confirmButtonText: "Organize Now",
      cancelButtonText: "Later",
      confirmButtonColor: "#722ed1",
    }).then((result) => {
      if (result.isConfirmed) openCellOrganizer();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unplacedSubmissions.length, portalUser?.email, cellOrganizerPrompted]);


  useEffect(() => {
    if (!portalUser?.locationSharingEnabled) return;
    if (!("geolocation" in navigator)) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const { latitude, longitude, accuracy } = pos.coords;
        api
          .patch("/portal-auth/location", {
            enabled: true,
            lat: latitude,
            lng: longitude,
            accuracy,
            label: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          })
          .catch(() => {});
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
    return () => {
      cancelled = true;
    };
  }, [portalUser?.locationSharingEnabled, portalUser?.email]);

  useEffect(() => {
    if (!activeSlfId) return;
    const ac = new AbortController();
    // A RE-read of the facility already on screen (socket push, reconnect, tab
    // focus, the Dashboard's periodic sync) refreshes in place; only a first load
    // or a facility switch shows the loading skeleton. Otherwise every live
    // update would blank the Dashboard cards for a moment.
    const isReread = slfInfoLoadedForRef.current === activeSlfId;
    if (!isReread) setSlfInfoLoading(true);
    const nameParam = activeSlfName
      ? `?slfName=${encodeURIComponent(activeSlfName)}`
      : "";
    withRetry(
      () =>
        api.get(`/slf-facilities/portal/${activeSlfId}${nameParam}`, {
          signal: ac.signal,
        }),
      { retries: 3, signal: ac.signal },
    )
      .then(({ data }) => {
        setSlfInfo(data);
        slfInfoLoadedForRef.current = activeSlfId;
        setSlfInfoSyncedAt(Date.now());
        setLeachateDetails(
          (data.leachatePondDetails || []).map((p, i) => ({ ...p, _key: i })),
        );
        setGasVentDetails(
          (data.gasVentDetails || []).map((v, i) => ({ ...v, _key: i })),
        );
        setTrashSlideDetails(
          (data.trashSlideMeasures || []).map((m, i) => ({ ...m, _key: i })),
        );
        setFirePrevDetails(
          (data.firePrevMeasures || []).map((m, i) => ({ ...m, _key: i })),
        );
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        // A failed background re-read keeps what is on screen; only a failed
        // first load is worth interrupting the operator for.
        if (isReread) return;
        showError({
          type: "error",
          title: "Could Not Load SLF Facility",
          message:
            err.response?.data?.message ||
            "We couldn't load the assigned SLF facility details. Please refresh or try again.",
        });
      })
      .finally(() => setSlfInfoLoading(false));
    return () => ac.abort();
  }, [activeSlfId, activeSlfName, slfInfoRefresh]);

  const activeSlfInfoReadyForBaseline = !activeSlfId || !!slfInfo;
  // Stable so the memoized Dashboard is not re-rendered by a new function each time.
  const refreshSlfInfoNow = useCallback(() => setSlfInfoRefresh((n) => n + 1), []);

  // Fetch existing baseline when user is loaded (with retry)
  useEffect(() => {
    if (!activeSlfName || !activeSlfInfoReadyForBaseline) return;
    const ac = new AbortController();
    setBaselineLoading(true);
    withRetry(
      () =>
        api.get(
          `/data-slf/baseline/${encodeURIComponent(activeSlfName)}?slfId=${encodeURIComponent(activeSlfId || "")}`,
          { signal: ac.signal },
        ),
      { retries: 3, signal: ac.signal },
    )
      .then(({ data }) => {
        // What is loaded now is the saved baseline: the unsaved-changes snapshot
        // is taken from it once it has rendered, and any "EMB changed it" notice
        // is answered.
        baselineDirtyGuard.markClean();
        setBaselineRemoteChanged(false);
        // Lock is decided FIRST and independently of the payload check below —
        // a baseline saved with company information only still locks.
        const lock = resolveBaselineLock(data);
        setBaselineSaved(lock.locked);
        setBaselineUpdatePending(lock.updatePending);
        // Recorded BEFORE the payload check: this is the facility's figure and it
        // must be held even when the rest of the baseline is thin, because it is
        // what every later fallback reads.
        // STRICT UNITS: every baseline figure is shown (and re-saved) in the unit
        // the ADMIN declared for this facility — the same unit the SLF Table, the
        // Dashboard and the reports use. A record saved under another unit is
        // CONVERTED here, never relabelled.
        const declaredUnit = slfUnit;
        const recordUnit = data?.baselineUnit || data?.totalVolumeAcceptedUnit || declaredUnit;
        const toDeclared = (value, fromUnit) => {
          if (value === null || value === undefined || value === "") return value;
          const converted = convertVolume(value, fromUnit || recordUnit, declaredUnit);
          return converted === null ? value : Math.round(converted * 1000) / 1000;
        };
        setBaselineTotalVolume(
          data?.totalVolumeAccepted == null
            ? null
            : Number(toDeclared(data.totalVolumeAccepted, data.totalVolumeAcceptedUnit)),
        );

        if (hasBaselinePayload(data)) {
          const unit = declaredUnit;
          setBaselineUnit(unit);
          setAcceptsHazardousWaste(data.acceptsHazardousWaste || false);
          baselineForm.setFieldsValue({
            baselineUnit: unit,
            totalVolumeAccepted: toDeclared(data.totalVolumeAccepted, data.totalVolumeAcceptedUnit),
            totalVolumeAcceptedUnit: unit,
            activeCellResidualVolume: toDeclared(data.activeCellResidualVolume, data.activeCellResidualUnit),
            activeCellResidualUnit: unit,
            activeCellInertVolume: toDeclared(data.activeCellInertVolume, data.activeCellInertUnit),
            activeCellInertUnit: unit,
            activeCellHazardousVolume: toDeclared(data.activeCellHazardousVolume, data.activeCellHazardousUnit),
            activeCellHazardousUnit: unit,
            closedCellResidualVolume: toDeclared(data.closedCellResidualVolume, data.closedCellResidualUnit),
            closedCellResidualUnit: unit,
            closedCellInertVolume: toDeclared(data.closedCellInertVolume, data.closedCellInertUnit),
            closedCellInertUnit: unit,
            closedCellHazardousVolume: toDeclared(data.closedCellHazardousVolume, data.closedCellHazardousUnit),
            closedCellHazardousUnit: unit,
            acceptsHazardousWaste: data.acceptsHazardousWaste || false,
          });
          // Every field falls back to what the form already holds.
          //
          // `lguCompanyName` always had this guard; the four address fields did
          // not — they were assigned straight from `data`. When the refetched
          // baseline did not carry them the values were `undefined`, and
          // setFieldsValue({ companyRegion: undefined }) CLEARS the control
          // rather than leaving it alone. This object is re-applied after each of
          // the chained address-list fetches too, which is why a just-saved
          // address vanished a few seconds later rather than immediately.
          //
          // `||` (not `??`) on purpose: a blank code from the server means "not
          // recorded", never "clear what the user is looking at".
          const keepCurrent = (incoming, field) =>
            incoming || companyForm.getFieldValue(field) || undefined;
          const savedCompanyValues = {
            lguCompanyName:
              data.lguCompanyName ||
              companyForm.getFieldValue("lguCompanyName") ||
              "",
            companyRegion: keepCurrent(data.companyRegion, "companyRegion"),
            companyProvince: keepCurrent(data.companyProvince, "companyProvince"),
            companyMunicipality: keepCurrent(data.companyMunicipality, "companyMunicipality"),
            companyBarangay: keepCurrent(data.companyBarangay, "companyBarangay"),
          };
          companyForm.setFieldsValue(savedCompanyValues);
          entryForm.setFieldsValue({
            lguCompanyName: savedCompanyValues.lguCompanyName,
            companyType:
              data.companyType ||
              ((slfInfo?.ownership || "").toLowerCase().includes("private")
                ? "Private"
                : "LGU"),
            address: data.address || entryForm.getFieldValue("address"),
          });
          // Address option lists are re-fetched ONLY when the codes they are keyed
          // by actually changed.
          //
          // This effect re-runs on every `baselineRefresh` bump — i.e. after every
          // baseline save — and used to fire three chained withRetry() lookups
          // (provinces → municipalities → barangays) every time, each with its own
          // retry/backoff, re-applying setFieldsValue after each one. On a normal
          // save none of the codes have changed, so all three round-trips
          // reproduced lists already in state while the form stayed locked behind
          // them. That is the save-time stall.
          //
          // Re-fetch stays automatic whenever a code genuinely differs (or a list
          // is empty), so switching facility or editing the address still loads.
          const listLoadedFor = addressListsKeyRef.current;
          const addressKey = [
            data.companyRegion || "",
            data.companyProvince || "",
            data.companyMunicipality || "",
          ].join("|");
          const addressListsFresh =
            listLoadedFor === addressKey &&
            provinces.length > 0 &&
            municipalities.length > 0 &&
            barangays.length > 0;
          if (addressListsFresh) {
            // Lists in state already describe these codes — nothing to load.
            companyForm.setFieldsValue(savedCompanyValues);
          } else if (data.companyRegion) {
            addressListsKeyRef.current = addressKey;
            withRetry(
              () =>
                api.get(`/settings/address/provinces/${data.companyRegion}`, {
                  signal: ac.signal,
                }),
              { retries: 2, signal: ac.signal },
            )
              .then(({ data: provinceData }) =>
                setProvinces(provinceData || []),
              )
              .then(() => companyForm.setFieldsValue(savedCompanyValues))
              .catch(() => {});
          }
          if (data.companyProvince) {
            withRetry(
              () =>
                api.get(
                  `/settings/address/municipalities/${data.companyProvince}`,
                  { signal: ac.signal },
                ),
              { retries: 2, signal: ac.signal },
            )
              .then(({ data: municipalityData }) =>
                setMunicipalities(municipalityData || []),
              )
              .then(() => companyForm.setFieldsValue(savedCompanyValues))
              .catch(() => {});
          }
          if (data.companyMunicipality) {
            withRetry(
              () =>
                api.get(
                  `/settings/address/barangays/${data.companyMunicipality}`,
                  {
                    signal: ac.signal,
                  },
                ),
              { retries: 2, signal: ac.signal },
            )
              .then(({ data: barangayData }) =>
                setBarangays(barangayData || []),
              )
              .then(() => companyForm.setFieldsValue(savedCompanyValues))
              .catch(() => {});
          }
          setHaulers(mergeHaulersByName(data.accreditedHaulers || [], unit));
          setBaselineMov(normalizeBaselineMov(data.baselineMov));
          // Load activeCellEntries from saved data (or migrate from flat fields)
          if (data.activeCellEntries?.length) {
            setActiveCellEntries(
              data.activeCellEntries.map((e, i) => ({
                ...e,
                unit: e.unit || unit,
                key: i,
              })),
            );
          } else {
            // Legacy flat fields migrated into entry rows. Each row is bound to a
            // REAL cell from the admin's configuration (stable cellIndex + its
            // configured name) instead of being left with an empty cellName and
            // no index — rows saved that way lost their identity and every label
            // fell back to the positional "Cell 1", "Cell 2"… on the next load.
            const entries = [];
            let k = 1;
            const pushMigrated = (volume, entryUnit, wasteType) => {
              if (!volume) return;
              const target = matchBaselineCellForWasteType(data, wasteType);
              entries.push({
                key: k++,
                cellName: target.cellName,
                cellIndex: target.cellIndex,
                cellType: target.cellType,
                wasteType,
                volume,
                unit: entryUnit || unit,
              });
            };
            pushMigrated(data.activeCellResidualVolume, data.activeCellResidualUnit, "Residual");
            pushMigrated(data.activeCellInertVolume, data.activeCellInertUnit, "Inert/Hazardous Waste");
            pushMigrated(data.activeCellHazardousVolume, data.activeCellHazardousUnit, "Inert/Hazardous Waste");
            setActiveCellEntries(entries);
          }
          // Load closedCellEntries from saved data (or migrate from flat fields)
          if (data.closedCellEntries?.length) {
            setClosedCellEntries(
              data.closedCellEntries.map((e, i) => ({
                ...e,
                unit: e.unit || unit,
                key: i,
              })),
            );
          } else {
            // Same migration rule as the active entries above — bind each legacy
            // flat volume to a real, non-active cell so its identity survives.
            const cEntries = [];
            let ck = 1;
            const pushMigratedClosed = (volume, entryUnit, wasteType) => {
              if (!volume) return;
              const target = matchBaselineCellForWasteType(data, wasteType, { active: false });
              cEntries.push({
                key: ck++,
                cellName: target.cellName,
                cellIndex: target.cellIndex,
                cellType: target.cellType,
                wasteType,
                volume,
                unit: entryUnit || unit,
              });
            };
            pushMigratedClosed(data.closedCellResidualVolume, data.closedCellResidualUnit, "Residual");
            pushMigratedClosed(data.closedCellInertVolume, data.closedCellInertUnit, "Inert/Hazardous Waste");
            pushMigratedClosed(data.closedCellHazardousVolume, data.closedCellHazardousUnit, "Inert/Hazardous Waste");
            setClosedCellEntries(cEntries);
          }
          setActiveTab("disposal");
        } else {
          setHaulers([]);
          setBaselineMov(normalizeBaselineMov(null));
          setActiveCellEntries([]);
          setClosedCellEntries([]);
        }
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        showError({
          type: "error",
          title: "Could Not Load Data Entry Values",
          message:
            err.response?.data?.message ||
            "We couldn't load your saved baseline and Data Entry values. Please refresh or try again.",
        });
      })
      .finally(() => setBaselineLoading(false));
    return () => ac.abort();
    // Stable primitive deps (see slfInfo effect above) so a portalUser reference
    // change doesn't abort the in-flight baseline fetch. The readiness flag keeps
    // hydration behind facility metadata because legacy baseline rows need live
    // cell names/types/units to populate the Data Entry TabPanes correctly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlfId, activeSlfName, activeSlfInfoReadyForBaseline, baselineRefresh]);

  // Re-fetch baseline when admin approves/rejects
  useEffect(() => {
    if (!portalUser?.email || !activeSlfName) return;
    const sock = connectSocket("portal", portalUser.email);
    const handler = (payload) => {
      // Accepts either shape: a bell notification ({ type }) or a data-refresh
      // ({ target }). The admin baseline endpoints emit both.
      const isBaselineEvent =
        payload?.type === "baseline_update_approved" ||
        payload?.type === "baseline_update_rejected" ||
        payload?.type === "baseline_locked" ||
        payload?.target === "baselines" ||
        // An admin completing a client's Type/Province/Municipality from the SLF
        // Data Table emits this. Without it the portal kept showing "N incomplete
        // hauler-client records" for details that had already been fixed, until
        // the user happened to reload.
        payload?.target === "hauler-clients";
      if (isBaselineEvent) {
        api
          .get(`/data-slf/baseline/${encodeURIComponent(activeSlfName)}?slfId=${encodeURIComponent(activeSlfId || "")}`)
          .then(({ data }) => {
            // Same rule as the loader: the record decides the lock, not whether
            // it carries volumes.
            const lock = resolveBaselineLock(data);
            setBaselineSaved(lock.locked);
            setBaselineUpdatePending(lock.updatePending);

            if (hasBaselinePayload(data)) {
              // The response already carries the clients — the handler used to
              // read only the status flags and throw them away, which is why an
              // admin-side correction never reached the incomplete-records
              // warning (it is derived from this state).
              setHaulers(
                mergeHaulersByName(
                  data.accreditedHaulers || [],
                  data.baselineUnit || resolveFacilityUnit(data) || "m³",
                ),
              );
            }
          })
          .catch(() => {});
      }
    };
    sock.on("notification", handler);
    // Also listen on data-refresh: the admin approve/lock/reject endpoints now emit
    // BOTH (the bell notification and a "baselines" refresh), and only the latter
    // reaches a portal tab whose notification stream was missed.
    sock.on("data-refresh", handler);
    return () => {
      sock.off("notification", handler);
      sock.off("data-refresh", handler);
    };
    // activeSlfId was read inside the handler but missing from the deps, so after
    // switching assigned SLFs the listener kept refetching the PREVIOUS facility's
    // baseline.
  }, [portalUser, activeSlfName, activeSlfId]);

  return {
    baselineRemoteChanged, firePrevDetails, gasVentDetails, leachateDetails, refreshSlfInfoNow,
    setBaselineRefresh, setBaselineRemoteChanged, setFirePrevDetails, setGasVentDetails,
    setLeachateDetails, setTrashSlideDetails, slfInfoSyncedAt, trashSlideDetails,
  };
}
