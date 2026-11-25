import { useState, useEffect, useRef, useCallback } from "react";
import { Layout, Form, Button, Card, Result, Space, Spin, Avatar, Tag, Drawer, List } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  UndoOutlined,
  BellOutlined,
  BulbOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
import api from "../../api";
import { useErrorCard } from "../../utils/ErrorHandler";
import secureStorage from "../../utils/secureStorage";
import { invalidateCache } from "../../utils/pageCache";
import { connectSocket, disconnectSocket } from "../../utils/socket";
import "./SLFPortal.css";
import SLFPortalModals from "./SLFPortalModals";
import PreviousNotificationsModal from "./PreviousNotificationsModal";
import VeraChat from "./Vera/VeraChat";
import VeraOnboarding from "../../components/VeraOnboarding";
import DraftsScheduledPanel from "./DraftsScheduledPanel";
import MyDocumentsPanel from "./MyDocumentsPanel";
import RequestsPanel from "./RequestsPanel";
import HistoryPanel from "./HistoryPanel";
import { SensitiveMaskProvider } from "../../utils/sensitiveMask";
import OverviewPanel from "./OverviewPanel";
import BulkOrganizeCells from "./BulkOrganizeCells";
import { PORTAL_SUBMISSIONS_CACHE_KEY, ORGANIZE_CELLS_ENABLED } from "./constants";
import BaselineCompletionModal from "./BaselineCompletionModal";
import { Text, Sider, Content, useBreakpoint, useStableCallback } from "./portalShared";

import DataEntryTab from "./DataEntryTab";
import CellOrganizerModal from "./CellOrganizerModal";
import PortalNoticeBanners from "./PortalNoticeBanners";
import PortalHeader from "./PortalHeader";
import buildPortalMenus from "./buildPortalMenus";
import usePortalTableColumns from "./hooks/usePortalTableColumns";
import useDraftQueue from "./hooks/useDraftQueue";
import useSubmitSubmission from "./hooks/useSubmitSubmission";
import useReviewSubmission from "./hooks/useReviewSubmission";
import useEditSubmission from "./hooks/useEditSubmission";
import useUploadReview from "./hooks/useUploadReview";
import useExcelUpload from "./hooks/useExcelUpload";
import usePortalNotifications from "./hooks/usePortalNotifications";
import useBaselineActions from "./hooks/useBaselineActions";
import useRecordEditors from "./hooks/useRecordEditors";
import useHistoryDetail from "./hooks/useHistoryDetail";
import useFleetEditors from "./hooks/useFleetEditors";
import useSubmissionHistory from "./hooks/useSubmissionHistory";
import useBaselineSync from "./hooks/useBaselineSync";
import useOrganizerEditing from "./hooks/useOrganizerEditing";
import useCellOrganizer from "./hooks/useCellOrganizer";
import useSlfFacility from "./hooks/useSlfFacility";
import usePortalAnnouncements from "./hooks/usePortalAnnouncements";
import usePortalBootstrap from "./hooks/usePortalBootstrap";
import usePortalTours from "./hooks/usePortalTours";
import useEntryReadiness from "./hooks/useEntryReadiness";
import PortalOverlays from "./PortalOverlays";
export default function SLFPortal() {
  // Functions declared further down that hooks above them call back into.
  // Filled in each render right after each one is declared; read only from
  // callbacks, exactly like the closures these hooks replaced.
  const late = {};
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const { showError, card: errorCard } = useErrorCard();
  const [portalUser, setPortalUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("overview");
  const [loadingUser, setLoadingUser] = useState(true);
  const [entryForm] = Form.useForm();
  const [trucks, setTrucks] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState("basic-info");
  const [baselineForm] = Form.useForm();
  const [companyForm] = Form.useForm();
  const [haulers, setHaulers] = useState([]);
  const [baselineSaved, setBaselineSaved] = useState(false);
  const [baselineUpdatePending, setBaselineUpdatePending] = useState(false);
  const [slfInfoLoading, setSlfInfoLoading] = useState(false);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [slfCardExpanded, setSlfCardExpanded] = useState(false);
  const [haulerDeleteLoading, setHaulerDeleteLoading] = useState(false);
  const [loadingClientAddress, setLoadingClientAddress] = useState("");
  // The SLF's Total Volume Accepted as the SERVER resolves it (GET /baseline).
  //
  // Held apart from the form on purpose. The form is written by several hydration
  // paths — the baseline load, the socket refresh, Edit & Resubmit — and any of
  // them can leave it blank or stamp a submission's stale snapshot over it. This
  // is the facility-level fact, so it is the authority for what to display, what
  // to send, and whether the submit gate is satisfied. `null` = the server has no
  // value for this SLF, which is a real state and different from "not loaded".
  const [baselineTotalVolume, setBaselineTotalVolume] = useState(null);
  const [supportForm] = Form.useForm();
  const supportTicketsLoadAttemptedRef = useRef(false);
  // "Previous Notifications" full-history modal + the single notification opened
  // for its complete message. Reuses the already-fetched portalNotifications list
  // (no extra fetch, no second store).
  const [previousNotifOpen, setPreviousNotifOpen] = useState(false);
  const [notifDetail, setNotifDetail] = useState(null);
  const [portalSettings, setPortalSettings] = useState(null);
  // Baseline section cards (active / closed / haulers) the operator has FOLDED.
  // ALL folded is the default — the Baseline tab opens as three compact
  // headers. Remembered PER OPERATOR (keyed by their email) in this browser, so
  // each person's layout comes back as they left it; restored/saved in the
  // effects below. A preference only — if storage is blocked the cards simply
  // start folded.
  //
  // The key is versioned: under the old key "[]" meant "all expanded" (the old
  // default), and restoring it would override the new folded default.
  const ALL_BASELINE_CARDS = ["active", "closed", "haulers"];
  const [collapsedBaselineCards, setCollapsedBaselineCards] = useState(ALL_BASELINE_CARDS);
  const foldedCardsKey = portalUser?.email
    ? `slf-portal:folded-baseline-cards:v2:${String(portalUser.email).toLowerCase()}`
    : "";
  const foldedCardsRestoredRef = useRef("");
  useEffect(() => {
    if (!foldedCardsKey || foldedCardsRestoredRef.current === foldedCardsKey) return;
    foldedCardsRestoredRef.current = foldedCardsKey;
    try {
      const raw = window.localStorage.getItem(foldedCardsKey);
      // Nothing saved yet → the default: every card folded.
      if (raw === null) {
        setCollapsedBaselineCards(ALL_BASELINE_CARDS);
        return;
      }
      const saved = JSON.parse(raw);
      const valid = Array.isArray(saved)
        ? saved.filter((k) => ALL_BASELINE_CARDS.includes(k))
        : ALL_BASELINE_CARDS;
      setCollapsedBaselineCards(valid);
    } catch {
      setCollapsedBaselineCards(ALL_BASELINE_CARDS);
    }
    // ALL_BASELINE_CARDS is a constant list; re-running on its identity is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldedCardsKey]);
  // Saved at the moment the operator folds/unfolds (not in an effect, which
  // would run in the same commit as the restore and overwrite it with []).
  const updateFoldedCards = (compute) => {
    setCollapsedBaselineCards((prev) => {
      const next = compute(prev);
      if (foldedCardsKey) {
        try {
          window.localStorage.setItem(foldedCardsKey, JSON.stringify(next));
        } catch {
          /* storage unavailable (private mode, blocked) — the fold still works this session */
        }
      }
      return next;
    });
  };
  // Unfold one card for THIS visit when the portal sends the operator to it (a
  // rule or a notice that points into it). Not saved, like the tour's unfold —
  // the remembered layout is theirs.
  const revealBaselineCard = (key) =>
    setCollapsedBaselineCards((prev) => prev.filter((k) => k !== key));
  const haulerUploadRef = useRef(null);
  const haulerExportRef = useRef(null);
  const haulerTableRef = useRef(null);
  // Feature-tour anchors for this release: the incomplete-records panel, the
  // disposal upload button, and the Transport & Disposal table.
  const baselineGapsRef = useRef(null);
  const truckUploadRef = useRef(null);
  const truckTableRef = useRef(null);
  const slfSelectorRef = useRef(null);
  const dataEntryTabsRef = useRef(null);
  const baselinePanelRef = useRef(null);
  const baselineStatusRef = useRef(null);
  const baselineActionRef = useRef(null);
  // The fix-everything-in-one-place editor for incomplete baseline records,
  // opened from the warning panel in the Data Entry pane.
  const [completionModalOpen, setCompletionModalOpen] = useState(false);

  useEffect(() => {
    return () => {
      setSubmissions([]);
      setMyRequests([]);
      setCellOrganizerData([]);
      setCellOrganizerSelected([]);
      setCellOrganizerExpanded([]);
    };
  }, []);
  const [ticketUploading, setTicketUploading] = useState(false);
  // FAQ collapsed keys
  const [faqActiveKey, setFaqActiveKey] = useState([]);
  // Profile modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const {
    hasHazardousWasteCode, hasReviewMissing, haulerVehiclesMissingCapacity, isDeveloperContext,
    isPlanningUnitView, isTreatedHazardousWaste, missingBaselineInfo, missingDisposalInfo,
    missingGeneralInfo, missingHazardousCodeTrucks, wasteGenValidationIssues, watchedDisposalDate,
    withTabLoading,
  } = useEntryReadiness({
    activeTab, baselineForm, baselineLoading, baselineTotalVolume, companyForm, entryForm, haulers,
    portalUser, slfInfoLoading, trucks,
  });
  const {
    announcementBannerRef, announcementDismissed, dismissAnnouncement, dismissTourPermanently,
    featureTourCurrent, featureTourDue, featureTourOpen, featureTourSteps,
    isPortalUpdateAnnouncement, markFeatureTourSeen, openFeatureTour, openPortalUpdateTour,
    portalAnnouncement, portalMaintenanceActive, portalMaintenanceMessage, portalUpdateTourSeenKey,
    setFeatureTourCurrent, setFeatureTourOpen, setPortalAnnouncement, setUpdateTourCurrent,
    tourDismissed, uiPrefsLoaded, updateTourClaimedRef, updateTourCurrent, updateTourOpen,
    updateTourSteps,
  } = usePortalTours({
    baselineActionRef, baselineGapsRef, baselinePanelRef, baselineSaved, baselineStatusRef,
    baselineUpdatePending, dataEntryTabsRef, haulerTableRef, portalSettings, portalUser,
    setActiveMenu, setActiveTab, setCollapsedBaselineCards, slfSelectorRef, truckTableRef,
    truckUploadRef,
  });
  const [leachateModalOpen, setLeachateModalOpen] = useState(false);
  const [gasVentModalOpen, setGasVentModalOpen] = useState(false);
  const [trashSlideModalOpen, setTrashSlideModalOpen] = useState(false);
  const [firePrevModalOpen, setFirePrevModalOpen] = useState(false);

  const isMobile = !screens.md;
  // Tablet width (iPad 13" portrait ≈ 1024 px, landscape ≈ 1366 px): wide
  // enough for the sidebar, too narrow for the expanded one plus full tables.
  const isTablet = screens.md && !screens.xl;

  // On a tablet, start with the sidebar COLLAPSED (64 px instead of 230 px), so
  // the content — and every table in it — gets the width back. Only on entering
  // the tablet range; the operator can still expand it.
  useEffect(() => {
    if (isTablet) setCollapsed(true);
  }, [isTablet]);

  // Scope for the portal's small-screen rules (the "Portal responsive layer" in
  // SLFPortal.css).
  //
  // It has to live on <body>, not on a wrapper here: modals and drawers render
  // through a React portal into document.body, so a class on the portal's own
  // markup does not reach them — and the modals are where the worst of the
  // small-screen layout was (fixed 1000–1200px widths that hung off the right
  // edge with their footer buttons out of reach). Added on mount and removed on
  // unmount, so nothing in the admin app is touched: this stylesheet is loaded
  // there too, via the shared VERA chat.
  useEffect(() => {
    document.body.classList.add("slf-portal-active");
    return () => document.body.classList.remove("slf-portal-active");
  }, []);

  useEffect(() => {
    supportTicketsLoadAttemptedRef.current = false;
  }, [portalUser?.email]);

  const {
    barangays, extraTransportFields, fetchBarangays, fetchHaulerBarangays, fetchHaulerCities,
    fetchHaulerProvinces, fetchMunicipalities, fetchProvinces, fl, haulerBarangayList, haulerCities,
    haulerDraft, haulerProvinces, hazWasteCodes, isOnline, isRequired, loadingAddress,
    loadingHaulerAddress, municipalities, opts, provinces, regions, setBarangays,
    setHaulerBarangayList, setHaulerCities, setHaulerDraft, setHaulerProvinces,
    setLoadingHaulerAddress, setMunicipalities, setProvinces, updateHaulerDraftAddr,
  } = usePortalBootstrap({
    companyForm, showError,
  });

  usePortalAnnouncements({
    featureTourDue, isPortalUpdateAnnouncement, openFeatureTour, openPortalUpdateTour,
    portalAnnouncement, portalUpdateTourSeenKey, portalUser, setActiveMenu, setActiveTab,
    setPortalAnnouncement, setPortalSettings, tourDismissed, uiPrefsLoaded, updateTourClaimedRef,
    updateTourCurrent, updateTourOpen, updateTourSteps,
  });
  // Load portal user from storage, then refresh from server for latest status/isVerified
  useEffect(() => {
    const token = secureStorage.get("portal_token");
    const user = secureStorage.getJSON("portal_user");
    if (!token || !user) {
      navigate("/slfportal/login");
      return;
    }
    if (user.verificationRequired) {
      navigate("/slfportal/verify-update", { replace: true });
      return;
    }
    setPortalUser(user);
    setLoadingUser(false);

    // Refresh user data from server to pick up latest status & isVerified
    api
      .get("/portal-auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => {
        const refreshed = {
          ...user,
          // Always trust the server for the account id. Portal notifications are
          // keyed by the user's _id, so a missing/stale cached _id makes the
          // Notifications panel come up empty for real accounts.
          _id: data._id || data.id || user._id,
          username: data.username,
          email: data.email,
          status: data.status,
          isVerified: data.isVerified,
          verificationRequired: data.verificationRequired,
          verificationSubmitted: data.verificationSubmitted,
          // Always trust the server for the current SLF assignment + per-user
          // access. The cached localStorage user can hold a STALE assignedSlf
          // (e.g. after the account was re-assigned or a dummy facility was
          // recreated), which points the cell-infra fetch at the wrong/old
          // facility and makes the baseline "cell infrastructure" come up empty.
          ...(data.assignedSlf !== undefined ? { assignedSlf: data.assignedSlf } : {}),
          ...(data.assignedSlfName !== undefined ? { assignedSlfName: data.assignedSlfName } : {}),
          ...(data.portalAccess !== undefined ? { portalAccess: data.portalAccess } : {}),
          profilePhoto: data.profilePhoto?.url ? { url: data.profilePhoto.url, updatedAt: data.profilePhoto.updatedAt } : null,
        };
        secureStorage.setJSON("portal_user", refreshed);
        if (data.verificationRequired) {
          navigate("/slfportal/verify-update", { replace: true });
          return;
        }
        setPortalUser(refreshed);
      })
      .catch(() => {});

    // Connect socket for real-time notifications
    const sock = connectSocket("portal", user.email);
    return () => {
      disconnectSocket();
    };
  }, [navigate]);

  const getNotifIcon = (type) => {
    if (type === "reverted")
      return <UndoOutlined style={{ color: "#fa541c" }} />;
    if (type === "status_change")
      return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
    return <BellOutlined style={{ color: "#1a3353" }} />;
  };

  const {
    acceptsHazardousWaste, activeCellEntries, activeCellOptions, activeSlfId, activeSlfName,
    baselineCellOptions, baselineDirtyGuard, baselineDirtyRef, baselineMov, baselineUnit,
    cellPlacementOptions, cellVolumeTotalIsAuthoritative, closedCellEntries,
    computedTotalVolumeAccepted, confirmDiscardBaseline, declaredCellUnit, facilityCells,
    matchBaselineCellForWasteType, reservedCellFill, resolveUploadCellValue, selectedSlfIdx,
    setAcceptsHazardousWaste, setActiveCellEntries, setBaselineMov, setBaselineUnit,
    setClosedCellEntries, setSelectedSlfIdx, setSlfInfo, slfCellCount, slfInfo, slfUnit,
  } = useSlfFacility({
    baselineForm, baselineLoading, baselineSaved, companyForm, haulers, isDeveloperContext,
    portalUser,
  });

  const {
    bulkOrganizeOpen, capacityAllowancePct, cellCapacityNotice, cellInfraCollapsed,
    cellOrganizerBulkCell, cellOrganizerData, cellOrganizerError, cellOrganizerExpanded,
    cellOrganizerLoading, cellOrganizerOpen, cellOrganizerPage, cellOrganizerPageSize,
    cellOrganizerSelected, evaluateCapacity, getDeclaredVehicleCapacity, openCellOrganizer,
    setBulkOrganizeOpen, setCellInfraCollapsed, setCellOrganizerBulkCell, setCellOrganizerData,
    setCellOrganizerExpanded, setCellOrganizerOpen, setCellOrganizerPage, setCellOrganizerPageSize,
    setCellOrganizerSelected, unplacedSubmissions, vehicleEffectiveCapacity,
  } = useCellOrganizer({
    activeCellOptions, cellPlacementOptions, haulers, portalSettings, slfUnit, submissions,
  });

  // ── Per-menu fetch cache ──
  // Switching menus re-ran each menu's fetch unconditionally, so going
  // Dashboard → Data Entry → Dashboard paid for the overview charts three times
  // and blanked them on every return. The fetched data already lives in state
  // that survives the switch; all that was missing was a reason NOT to refetch.
  //
  // Deliberately short. This exists to absorb menu *navigation*, not to serve
  // stale figures — a minute after a submission the operator still sees the new
  // numbers, and any socket data-refresh clears the entry outright.
  const MENU_CACHE_MS = 30000;
  const menuFetchedAtRef = useRef({});
  const isMenuDataFresh = useCallback((key) => {
    const at = menuFetchedAtRef.current[key];
    return Boolean(at) && Date.now() - at < MENU_CACHE_MS;
  }, []);
  const markMenuFetched = useCallback((key) => {
    menuFetchedAtRef.current[key] = Date.now();
  }, []);
  const invalidateMenuCache = useCallback(() => {
    menuFetchedAtRef.current = {};
  }, []);

  // Stable identities for the dashboard's quick actions. These are the only
  // props OverviewPanel receives that are not plain state, so they were the only
  // thing forcing it to re-render — see useStableCallback above.
  const goToDataEntry = useStableCallback(() => setActiveMenu("data-entry"));
  const goToHistory = useStableCallback(() => setActiveMenu("history"));
  const handleOrganizeCells = useStableCallback(() => openCellOrganizer());
  // BasicInfoTab is memoized, but memo compares prop IDENTITY — and these three
  // address loaders are plain consts rebuilt on every render, so without this the
  // memo would never match and Data Entry would re-render on every keystroke
  // elsewhere in the form. Wrapping keeps the newest implementation while giving
  // the child something stable to compare.
  const stableFetchProvinces = useStableCallback((...a) => fetchProvinces(...a));
  const stableFetchMunicipalities = useStableCallback((...a) => fetchMunicipalities(...a));
  const stableFetchBarangays = useStableCallback((...a) => fetchBarangays(...a));

  // Same reason, for the notification panel and the requests list — their memo
  // wrappers were inert until these stopped changing identity every render.
  const stableNotificationMeta = useStableCallback((...a) => getPortalNotificationMeta(...a));
  const stableOpenNotification = useStableCallback((...a) => openPortalNotification(...a));
  const stableHideRequest = useStableCallback((...a) => handleHideRequest(...a));

  // AssignedSlfDashboard is the largest panel in the portal (~1.4k lines) and sits
  // above the Data Entry form, so it re-rendered on every keystroke in the form
  // below it. Its data props are state or already memoized (submitBlockers); only
  // these three handlers were unstable.
  const stableReviewOpen = useStableCallback((...a) => handleReviewOpen(...a));
  const stableSaveDraft = useStableCallback((...a) => handleSaveDraft(...a));
  const stableOpenWasteReceived = useStableCallback((...a) => handleOpenWasteReceived(...a));

  const handleHistoryRefresh = useStableCallback(() => fetchSubmissions(false, true));
  const handleDraftSubmitted = useStableCallback(() => {
    invalidateMenuCache();
    invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
    fetchSubmissions(true, true);
  });
  const handleBulkOrganize = useStableCallback(async () => {
    // Ensure the unplaced placements are loaded before opening the bulk modal
    // (it reuses cellOrganizerData); open the organizer silently if empty, then
    // surface the bulk uploader.
    if (cellOrganizerData.length === 0) await openCellOrganizer();
    setBulkOrganizeOpen(true);
  });

  const {
    applyBulkCellToSelected, autoPlaceOrganizer, cellOrganizerSaving, cellRoomLabel,
    organizerPlanned, organizerStats, organizerWork, prefilledCapacityCount, saveCellOrganizer,
    setSlfInfoRefresh, slfInfoRefresh, updateOrganizerCapacity, updateOrganizerCell,
  } = useOrganizerEditing({
    activeCellOptions, baselineUnit, cellOrganizerBulkCell, cellOrganizerData,
    cellOrganizerSelected, portalUser, setCellOrganizerBulkCell, setCellOrganizerData,
    setCellOrganizerExpanded, setCellOrganizerOpen, setCellOrganizerSelected, showError, slfUnit,
    late,
  });
  const {
    baselineRemoteChanged, firePrevDetails, gasVentDetails, leachateDetails, refreshSlfInfoNow,
    setBaselineRefresh, setBaselineRemoteChanged, setFirePrevDetails, setGasVentDetails,
    setLeachateDetails, setTrashSlideDetails, slfInfoSyncedAt, trashSlideDetails,
  } = useBaselineSync({
    activeSlfId, activeSlfName, barangays, baselineDirtyGuard, baselineForm, baselineUnit,
    companyForm, entryForm, matchBaselineCellForWasteType, municipalities, openCellOrganizer,
    portalUser, provinces, setAcceptsHazardousWaste, setActiveCellEntries, setActiveTab,
    setBarangays, setBaselineLoading, setBaselineMov, setBaselineSaved, setBaselineTotalVolume,
    setBaselineUnit, setBaselineUpdatePending, setClosedCellEntries, setHaulers, setMunicipalities,
    setProvinces, setSlfInfo, setSlfInfoLoading, setSlfInfoRefresh, showError, slfInfo,
    slfInfoRefresh, slfUnit, unplacedSubmissions,
  });

  const {
    fetchMyRequests, fetchSubmissions, handleLogout, loadingSubmissions, myRequests,
    myRequestsLoading, portalEmail, setMyRequests, wasteReceivedRefresh,
  } = useSubmissionHistory({
    activeMenu, activeSlfId, activeSlfName, baselineDirtyRef, confirmDiscardBaseline,
    invalidateMenuCache, isDeveloperContext, isMenuDataFresh, isOnline, markMenuFetched, navigate,
    portalUser, setBaselineRefresh, setBaselineRemoteChanged, setPortalSettings, setSlfInfoRefresh,
    setSubmissions, showError, submissions,
  });
  late.fetchSubmissions = fetchSubmissions;

  const {
    assignSelectedTrucksToCell, editingHaulerKey, editingTruckKey, handleSaveHauler, haulerErrors,
    haulerModalFocus, haulerModalOpen, openHaulerModal, openTruckModal, removeHauler, removeTruck,
    selectedTruckKeys, setEditingHaulerKey, setEditingTruckKey, setHaulerErrors, setHaulerModalOpen,
    setSelectedTruckKeys, setTruckBulkCell, setTruckDraft, setTruckErrors, setTruckModalOpen,
    setTruckPage, setTruckPageSize, truckBulkCell, truckDraft, truckErrors, truckModalOpen,
    truckPage, truckPageSize, updateHaulerDraft, updateTruckDraft, updateVehicle, validateTruck,
  } = useFleetEditors({
    activeCellOptions, baselineUnit, capacityAllowancePct, evaluateCapacity, extraTransportFields,
    getDeclaredVehicleCapacity, hasHazardousWasteCode, haulerBarangayList, haulerCities,
    haulerDraft, haulerProvinces, isRequired, isTreatedHazardousWaste, openCellOrganizer, regions,
    setHaulerBarangayList, setHaulerCities, setHaulerDraft, setHaulerProvinces, setHaulers,
    setTrucks, showError, slfUnit, trucks, unplacedSubmissions, vehicleEffectiveCapacity, late,
  });

  const {
    closeHistoryDetail, historyDetailError, historyDetailLoading, historyDetailModal,
    openCellEntryForEdit, openHistoryDetail, saveCellEntryDraft, setHistoryDetailModal,
  } = useHistoryDetail({
    declaredCellUnit, slfInfo,
  });

  const {
    activeCellDraft, activeCellModalOpen, clientDraft, clientModalOpen, clientMunicipalities,
    clientProvinces, closedCellDraft, closedCellModalOpen, downloadHaulerTemplate,
    editingActiveCellKey, editingClientKey, editingClosedCellKey, exportHaulerData,
    exportSingleHaulerData, handleSaveActiveCellEntry, handleSaveClient, handleSaveClosedCellEntry,
    handleSaveTruck, setActiveCellDraft, setActiveCellModalOpen, setClientDraft, setClientModalOpen,
    setClientMunicipalities, setClientProvinces, setClosedCellDraft, setClosedCellModalOpen,
    setEditingActiveCellKey, setEditingClientKey, setEditingClosedCellKey,
  } = useRecordEditors({
    baselineUnit, editingTruckKey, haulerDraft, haulers, portalUser, regions, saveCellEntryDraft,
    setActiveCellEntries, setClosedCellEntries, setEditingTruckKey, setTruckDraft, setTruckErrors,
    setTruckModalOpen, setTrucks, slfUnit, truckDraft, updateHaulerDraft, validateTruck, late,
  });

  const {
    baselineRefreshLoading, baselineSavingLoading, baselineUpdateLoading, facilityMgmtSaving,
    handleBaselineUpdateRequest, handleOpenWasteReceived, handleRequestRevert,
    handleSaveBaselinePortal, handleSaveFacilityDetails, openRevertModal, refreshBaselineStatus,
    revertLoading, revertModalOpen, revertReason, revertRecord, setRevertModalOpen, setRevertReason,
    setRevertRecord, setWasteReceivedModalOpen, wasteReceivedData, wasteReceivedLoading,
    wasteReceivedModalOpen,
  } = useBaselineActions({
    acceptsHazardousWaste, activeCellEntries, activeMenu, activeSlfId, activeSlfName, barangays,
    baselineForm, baselineMov, baselineTotalVolume, baselineUnit, cellVolumeTotalIsAuthoritative,
    closedCellEntries, companyForm, computedTotalVolumeAccepted, entryForm, fetchSubmissions,
    haulers, isMenuDataFresh, markMenuFetched, municipalities, portalUser, provinces, regions,
    setBaselineRefresh, setBaselineSaved, setBaselineUpdatePending, setSlfInfo, showError, slfInfo,
    slfUnit, wasteReceivedRefresh,
  });

  const {
    fetchSupportTickets, getPortalNotificationMeta, handleSubmitTicket, handleSupportReply,
    isMessageNotification, isSupportNotification, markPortalNotificationRead,
    markPortalNotificationsRead, messageDrawerOpen, notificationPanelOpen, portalNotifications,
    portalUnreadCount, queueAttentionCount, setMessageDrawerOpen, setNotificationPanelOpen,
    setQueueAttentionCount, setSupportDetailModal, setSupportDrawerOpen, setSupportReplyText,
    setSupportTab, setTicketAttachments, supportDetailModal, supportDrawerOpen, supportLoading,
    supportReplyText, supportSubmitting, supportTab, supportTicketPagination, supportTicketSearch,
    supportTicketSorter, supportTickets, ticketAttachments,
  } = usePortalNotifications({
    activeMenu, activeSlfName, companyForm, portalEmail, portalUser, showError, supportForm,
    supportTicketsLoadAttemptedRef,
  });

  const {
    haulerVeraComment, haulerVeraCycleRef, haulerVeraError, haulerVeraSource, haulerVeraStage,
    openUploadGuide, proceedToFilePicker, setHaulerVeraComment, setHaulerVeraError,
    setHaulerVeraSource, setHaulerVeraStage, setUploadDetection, setUploadGuideOpen,
    setUploadGuideType, setUploadMissingColumns, setUploadModalOpen, setUploadPreviewColumns,
    setUploadPreviewData, setUploadProgressOpen, setUploadType, uploadDetection, uploadGuideOpen,
    uploadGuideType, uploadMissingColumns, uploadModalOpen, uploadPreviewColumns, uploadPreviewData,
    uploadPreviewRows, uploadPreviewSummary, uploadProgress, uploadProgressError,
    uploadProgressOpen, uploadStatusText, uploadType,
  } = useExcelUpload({
    activeCellOptions, baselineUnit, haulers, portalUser, resolveUploadCellValue, slfUnit, late,
  });

  const {
    applyClientFixToHauler, baselineGaps, buildUploadTemplateWorkbook, cleanTruckForSubmit,
    downloadDisposalTemplate, handleConfirmUpload, reassessHaulerUpload, runUploadVeraAssessment,
    updateUploadCell, uploadAlignmentSummary, useStoredClientForRows, useStoredHaulerForRows,
  } = useUploadReview({
    activeCellOptions, baselineUnit, entryForm, haulers, haulerVeraCycleRef, resolveUploadCellValue,
    setHaulers, setHaulerVeraComment, setHaulerVeraError, setHaulerVeraSource, setHaulerVeraStage,
    setTrucks, setUploadDetection, setUploadMissingColumns, setUploadModalOpen,
    setUploadPreviewData, slfUnit, uploadDetection, uploadMissingColumns, uploadPreviewData,
    uploadPreviewRows, uploadPreviewSummary, uploadType,
  });
  late.buildUploadTemplateWorkbook = buildUploadTemplateWorkbook;
  late.runUploadVeraAssessment = runUploadVeraAssessment;


  const {
    editingDraft, editingDraftRef, editingRevertedId, handleEditDraft, handleEditReverted,
    handleEditRevertedRow, handleResubmitReverted, invalidateQueueCache, loading, resubmitComment,
    reviewModalOpen, scheduleAt, setEditingDraft, setEditingRevertedId, setLoading,
    setResubmitComment, setReviewModalOpen, setScheduleAt, setSubmitProgress, setSubmitted,
    stopEditingDraft, submitProgress, submitted,
  } = useEditSubmission({
    acceptsHazardousWaste, activeCellEntries, activeSlfId, activeSlfName, baselineForm,
    baselineTotalVolume, baselineUnit, cellVolumeTotalIsAuthoritative, cleanTruckForSubmit,
    closedCellEntries, companyForm, computedTotalVolumeAccepted, entryForm, fetchBarangays,
    fetchMunicipalities, fetchProvinces, fetchSubmissions, haulers, portalUser,
    setActiveCellEntries, setActiveMenu, setActiveTab, setBaselineSaved, setBaselineUnit,
    setClosedCellEntries, setEditingTruckKey, setHaulers, setHistoryDetailModal, setTruckDraft,
    setTrucks, showError, slfInfo, slfUnit, trucks, late,
  });

  const {
    buildSubmissionEntry, handleReviewOpen, resubmittingIdNo, unresolvedRevert,
    validateSubmissionTrucks,
  } = useReviewSubmission({
    acceptsHazardousWaste, activeCellEntries, activeCellOptions, activeSlfId, activeSlfName,
    baselineForm, baselineSaved, baselineTotalVolume, baselineUnit, cellVolumeTotalIsAuthoritative,
    cleanTruckForSubmit, closedCellEntries, companyForm, computedTotalVolumeAccepted,
    editingRevertedId, entryForm, evaluateCapacity, haulers, missingHazardousCodeTrucks,
    setActiveTab, setReviewModalOpen, showError, slfInfo, slfUnit, submissions, trucks,
    vehicleEffectiveCapacity,
  });

  const {
    NO_AVAILABLE_CELL_MESSAGE, allCellsUnavailable, backlogSummary, blockedByDeveloperContext,
    handleConfirmSubmit, submitBlockers,
  } = useSubmitSubmission({
    activeCellOptions, activeSlfId, activeSlfName, baselineForm, baselineSaved, baselineUnit,
    buildSubmissionEntry, capacityAllowancePct, companyForm, editingRevertedId, entryForm,
    getDeclaredVehicleCapacity, handleEditRevertedRow, haulerVehiclesMissingCapacity,
    isDeveloperContext, missingBaselineInfo, missingGeneralInfo, missingHazardousCodeTrucks,
    openCellOrganizer, portalUser, reservedCellFill, revealBaselineCard, setActiveMenu,
    setActiveTab, setBaselineSaved, setEditingTruckKey, setLoading, setReviewModalOpen,
    setSubmitProgress, setSubmitted, setTruckDraft, setTrucks, showError, slfCellCount, slfInfo,
    slfUnit, trucks, unplacedSubmissions, unresolvedRevert, validateSubmissionTrucks,
    wasteGenValidationIssues, watchedDisposalDate, late,
  });
  late.allCellsUnavailable = allCellsUnavailable;
  late.NO_AVAILABLE_CELL_MESSAGE = NO_AVAILABLE_CELL_MESSAGE;

  const {
    draftAutosave, handleSaveDraft, handleScheduleSubmission, retireOpenDraft, savingDraft,
    scheduleModalOpen, schedulingSubmit, setScheduleModalOpen,
  } = useDraftQueue({
    activeSlfId, activeSlfName, blockedByDeveloperContext, buildSubmissionEntry, companyForm,
    editingDraft, editingDraftRef, editingRevertedId, entryForm, invalidateQueueCache,
    isDeveloperContext, loading, portalUser, resubmitComment, resubmittingIdNo, scheduleAt,
    setEditingDraft, setReviewModalOpen, setScheduleAt, showError, trucks,
  });
  late.draftAutosave = draftAutosave;
  late.retireOpenDraft = retireOpenDraft;
  late.retireOpenDraft = retireOpenDraft;

  const {
    haulerColumns, haulerDeleteFile, haulerDeleteModal, haulerDeleteReason, historyColumns,
    setHaulerDeleteFile, setHaulerDeleteModal, setHaulerDeleteReason, stableEditRevertedRow,
  } = usePortalTableColumns({
    backlogSummary, baselineSaved, fetchSubmissions, handleEditRevertedRow, haulers,
    openHaulerModal, openHistoryDetail, openRevertModal, openTruckModal, portalSettings, portalUser,
    removeHauler, removeTruck, showError, slfUnit, submissions, trucks,
  });

  if (loadingUser) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  if (portalMaintenanceActive) {
    return (
      <Layout style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f5f7fa 0%, #e6edf7 100%)" }}>
        {errorCard}
        <Content
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Card style={{ width: "100%", maxWidth: 680, borderRadius: 16, boxShadow: "0 18px 45px rgba(26, 51, 83, 0.12)" }}>
            <Result
              status="warning"
              title="Portal maintenance in progress"
              subTitle={portalMaintenanceMessage}
              extra={[
                <Button key="login" type="primary" onClick={() => navigate("/slfportal/login", { replace: true })}>
                  Back to Login
                </Button>,
                <Button key="logout" onClick={handleLogout}>
                  Sign Out
                </Button>,
              ]}
            />
          </Card>
        </Content>
      </Layout>
    );
  }

  const fieldErr = (name) =>
    truckErrors[name]
      ? { validateStatus: "error", help: truckErrors[name] }
      : {};

  const haulerFieldErr = (name) =>
    haulerErrors[name]
      ? { validateStatus: "error", help: haulerErrors[name] }
      : {};

  // Helper: render status tag for detail modal
  const renderStatusTag = (v) => {
    if (v === "acknowledged")
      return <Tag icon={<CheckCircleOutlined />} color="success">APPROVED</Tag>;
    if (v === "rejected")
      return <Tag icon={<CloseCircleOutlined />} color="error">REJECTED</Tag>;
    if (v === "reverted" || v === "editApproved")
      return <Tag icon={<UndoOutlined />} color="volcano">REVERTED — NEEDS EDIT</Tag>;
    if (v === "revert_requested")
      return <Tag icon={<SyncOutlined />} color="orange">REVERT REQUESTED</Tag>;
    return <Tag icon={<SyncOutlined spin />} color="warning">PENDING REVIEW</Tag>;
  };

  const renderGuideItems = (items = [], color = "#1677ff") => (
    <List
      size="small"
      dataSource={items}
      renderItem={(item, index) => (
        <List.Item
          style={{ fontSize: 12, paddingLeft: 0, alignItems: "flex-start" }}
        >
          <Space size={8} align="start">
            <Avatar
              size={22}
              className="slf-guide-icon"
              style={{
                background: `${color}18`,
                color,
                border: `1px solid ${color}33`,
                flex: "0 0 auto",
                animationDelay: `${index * 0.14}s`,
              }}
              icon={
                index % 3 === 0 ? (
                  <BulbOutlined />
                ) : index % 3 === 1 ? (
                  <ThunderboltOutlined />
                ) : (
                  <RocketOutlined />
                )
              }
            />
            <Text style={{ fontSize: 12, lineHeight: 1.45 }}>{item}</Text>
          </Space>
        </List.Item>
      )}
    />
  );

  const {
    notificationDetailModal, openPortalNotification, portalNotificationCounts, siderContent,
    userDisplay, userMenuItems,
  } = buildPortalMenus({
    activeMenu, activeSlfName, collapsed, fetchSupportTickets, getPortalNotificationMeta,
    isMessageNotification, isMobile, isSupportNotification, markPortalNotificationRead,
    markPortalNotificationsRead, notifDetail, openCellOrganizer, portalNotifications,
    portalUnreadCount, portalUser, queueAttentionCount, revealBaselineCard, setActiveMenu,
    setActiveTab, setMessageDrawerOpen, setMobileDrawer, setNotifDetail, setNotificationPanelOpen,
    setPreviousNotifOpen, setSupportDrawerOpen, setSupportTab, submissions, supportTickets,
    unplacedSubmissions,
  });


  const renderDataEntry = () => (
    <DataEntryTab
      activeCellEntries={activeCellEntries}
      activeCellOptions={activeCellOptions}
      activeSlfName={activeSlfName}
      activeTab={activeTab}
      assignSelectedTrucksToCell={assignSelectedTrucksToCell}
      backlogSummary={backlogSummary}
      barangays={barangays}
      baselineActionRef={baselineActionRef}
      baselineDirtyGuard={baselineDirtyGuard}
      baselineForm={baselineForm}
      baselineGaps={baselineGaps}
      baselineGapsRef={baselineGapsRef}
      baselineMov={baselineMov}
      baselinePanelRef={baselinePanelRef}
      baselineRefreshLoading={baselineRefreshLoading}
      baselineRemoteChanged={baselineRemoteChanged}
      baselineSaved={baselineSaved}
      baselineSavingLoading={baselineSavingLoading}
      baselineStatusRef={baselineStatusRef}
      baselineUnit={baselineUnit}
      baselineUpdateLoading={baselineUpdateLoading}
      baselineUpdatePending={baselineUpdatePending}
      cellVolumeTotalIsAuthoritative={cellVolumeTotalIsAuthoritative}
      closedCellEntries={closedCellEntries}
      collapsedBaselineCards={collapsedBaselineCards}
      companyForm={companyForm}
      confirmDiscardBaseline={confirmDiscardBaseline}
      dataEntryTabsRef={dataEntryTabsRef}
      declaredCellUnit={declaredCellUnit}
      downloadHaulerTemplate={downloadHaulerTemplate}
      draftAutosave={draftAutosave}
      editingDraft={editingDraft}
      editingRevertedId={editingRevertedId}
      entryForm={entryForm}
      exportHaulerData={exportHaulerData}
      facilityCells={facilityCells}
      fl={fl}
      handleBaselineUpdateRequest={handleBaselineUpdateRequest}
      handleSaveBaselinePortal={handleSaveBaselinePortal}
      hasReviewMissing={hasReviewMissing}
      haulerColumns={haulerColumns}
      haulerExportRef={haulerExportRef}
      haulerTableRef={haulerTableRef}
      haulerUploadRef={haulerUploadRef}
      haulerVehiclesMissingCapacity={haulerVehiclesMissingCapacity}
      haulers={haulers}
      isMobile={isMobile}
      isRequired={isRequired}
      loading={loading}
      loadingAddress={loadingAddress}
      missingBaselineInfo={missingBaselineInfo}
      missingDisposalInfo={missingDisposalInfo}
      missingGeneralInfo={missingGeneralInfo}
      missingHazardousCodeTrucks={missingHazardousCodeTrucks}
      municipalities={municipalities}
      openCellEntryForEdit={openCellEntryForEdit}
      openFeatureTour={openFeatureTour}
      openHaulerModal={openHaulerModal}
      openTruckModal={openTruckModal}
      openUploadGuide={openUploadGuide}
      portalUser={portalUser}
      provinces={provinces}
      refreshBaselineStatus={refreshBaselineStatus}
      regions={regions}
      removeTruck={removeTruck}
      renderGuideItems={renderGuideItems}
      resubmittingIdNo={resubmittingIdNo}
      revealBaselineCard={revealBaselineCard}
      savingDraft={savingDraft}
      selectedSlfIdx={selectedSlfIdx}
      selectedTruckKeys={selectedTruckKeys}
      setActiveCellDraft={setActiveCellDraft}
      setActiveCellEntries={setActiveCellEntries}
      setActiveCellModalOpen={setActiveCellModalOpen}
      setActiveTab={setActiveTab}
      setBaselineMov={setBaselineMov}
      setBaselineRefresh={setBaselineRefresh}
      setBaselineRemoteChanged={setBaselineRemoteChanged}
      setBaselineSaved={setBaselineSaved}
      setClosedCellDraft={setClosedCellDraft}
      setClosedCellEntries={setClosedCellEntries}
      setClosedCellModalOpen={setClosedCellModalOpen}
      setCompletionModalOpen={setCompletionModalOpen}
      setEditingActiveCellKey={setEditingActiveCellKey}
      setEditingClosedCellKey={setEditingClosedCellKey}
      setHaulers={setHaulers}
      setSelectedSlfIdx={setSelectedSlfIdx}
      setSelectedTruckKeys={setSelectedTruckKeys}
      setSlfInfo={setSlfInfo}
      setSubmitted={setSubmitted}
      setTruckBulkCell={setTruckBulkCell}
      setTruckPage={setTruckPage}
      setTruckPageSize={setTruckPageSize}
      setTrucks={setTrucks}
      slfCardExpanded={slfCardExpanded}
      slfInfo={slfInfo}
      slfInfoLoading={slfInfoLoading}
      slfSelectorRef={slfSelectorRef}
      slfUnit={slfUnit}
      stableEditRevertedRow={stableEditRevertedRow}
      stableFetchBarangays={stableFetchBarangays}
      stableFetchMunicipalities={stableFetchMunicipalities}
      stableFetchProvinces={stableFetchProvinces}
      stableOpenWasteReceived={stableOpenWasteReceived}
      stableReviewOpen={stableReviewOpen}
      stableSaveDraft={stableSaveDraft}
      stopEditingDraft={stopEditingDraft}
      submitBlockers={submitBlockers}
      submitted={submitted}
      truckBulkCell={truckBulkCell}
      truckPage={truckPage}
      truckPageSize={truckPageSize}
      truckTableRef={truckTableRef}
      truckUploadRef={truckUploadRef}
      trucks={trucks}
      unresolvedRevert={unresolvedRevert}
      updateFoldedCards={updateFoldedCards}
      withTabLoading={withTabLoading}
    />
  );

  // ── My Requests Content ──
  const handleHideRequest = async (record) => {
    const result = await Swal.fire({
      icon: "warning",
      title: "Remove from your list?",
      html: "This hides the request from your list only. <b>EMB Region III still keeps a record of it.</b>",
      showCancelButton: true,
      confirmButtonText: "Remove",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#ff4d4f",
    });
    if (!result.isConfirmed) return;
    // Optimistically drop it from the visible list, then persist.
    setMyRequests((prev) => prev.filter((r) => r._id !== record._id));
    try {
      await api.patch(
        `/portal-auth/my-requests/${record._id}/hide`,
        {},
        {
          headers: {
            Authorization: `Bearer ${secureStorage.get("portal_token")}`,
          },
        },
      );
    } catch (err) {
      showError({
        type: "error",
        title: "Could Not Remove",
        message:
          err.response?.data?.message ||
          "We couldn't remove this request. Please refresh and try again.",
      });
      fetchMyRequests();
    }
  };

  return (
    <SensitiveMaskProvider masked={!!portalSettings?.maskSensitiveSlfValues}>
    <Layout style={{ minHeight: "100vh" }}>
      {errorCard}
      {/* Desktop Sider */}
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={230}
          collapsedWidth={64}
          className="portal-sider"
          style={{
            background: "linear-gradient(180deg, #0e1e35 0%, #1a3353 100%)",
            overflow: "auto",
            height: "100vh",
            position: "fixed",
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 10,
          }}
        >
          {siderContent}
        </Sider>
      )}

      {/* Mobile Drawer */}
      {isMobile && (
        <Drawer
          placement="left"
          open={mobileDrawer}
          onClose={() => setMobileDrawer(false)}
          size={240}
          // See AdminHome: keeps the nav drawer off the global 100vw phone rule so
          // the mask stays tappable (this drawer is `closable={false}` too).
          rootClassName="app-nav-drawer"
          styles={{
            body: {
              padding: 0,
              background: "linear-gradient(180deg, #0e1e35 0%, #1a3353 100%)",
            },
          }}
          closable={false}
        >
          {siderContent}
        </Drawer>
      )}

      <Layout
        style={{
          // Matches the Sider's own widths (230 / 64) — 220 left the expanded
          // sidebar overlapping the first 10 px of every page.
          marginLeft: isMobile ? 0 : collapsed ? 64 : 230,
          transition: "margin-left 0.2s",
          // Item #1: full-height flex column so the footer sticks to the bottom of
          // the viewport on short pages, while long pages scroll normally. No
          // hard-coded header/footer height math.
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <PortalHeader
          fetchSupportTickets={fetchSupportTickets}
          handleLogout={handleLogout}
          isMobile={isMobile}
          markPortalNotificationsRead={markPortalNotificationsRead}
          notificationPanelOpen={notificationPanelOpen}
          portalNotificationCounts={portalNotificationCounts}
          portalNotifications={portalNotifications}
          portalUser={portalUser}
          setMessageDrawerOpen={setMessageDrawerOpen}
          setMobileDrawer={setMobileDrawer}
          setNotificationPanelOpen={setNotificationPanelOpen}
          setPreviousNotifOpen={setPreviousNotifOpen}
          setProfileModalOpen={setProfileModalOpen}
          setSupportDrawerOpen={setSupportDrawerOpen}
          setSupportTab={setSupportTab}
          stableNotificationMeta={stableNotificationMeta}
          stableOpenNotification={stableOpenNotification}
          supportTickets={supportTickets}
          userDisplay={userDisplay}
          userMenuItems={userMenuItems}
        />

        {/* Content */}
        <Content
          className="slf-portal-content"
          style={{
            padding: isMobile ? "12px 6px" : "24px 24px",
            background: "#f0f2f5",
            // Grow to fill remaining space so a short page still pushes the footer
            // to the bottom; content taller than the viewport scrolls normally.
            flex: "1 0 auto",
          }}
        >
          {/* Developer Portal Mode — an unmissable, persistent banner. A developer
              must never be able to mistake another user's context for their own,
              so this states WHOSE data is on screen. It matters MORE now than it
              did as an inspection mode: the session writes, so every action here
              lands on that operator's real records under their name (the server
              audits each one against the developer's identity). */}
          <PortalNoticeBanners
            activeSlfName={activeSlfName}
            announcementBannerRef={announcementBannerRef}
            announcementDismissed={announcementDismissed}
            dismissAnnouncement={dismissAnnouncement}
            fetchSupportTickets={fetchSupportTickets}
            isDeveloperContext={isDeveloperContext}
            isOnline={isOnline}
            isPlanningUnitView={isPlanningUnitView}
            isPortalUpdateAnnouncement={isPortalUpdateAnnouncement}
            markPortalNotificationsRead={markPortalNotificationsRead}
            openPortalUpdateTour={openPortalUpdateTour}
            portalAnnouncement={portalAnnouncement}
            portalNotificationCounts={portalNotificationCounts}
            portalUser={portalUser}
            setMessageDrawerOpen={setMessageDrawerOpen}
            setSupportDrawerOpen={setSupportDrawerOpen}
            setSupportTab={setSupportTab}
            supportTickets={supportTickets}
            uiPrefsLoaded={uiPrefsLoaded}
          />
          {activeMenu === "overview" && (
            <OverviewPanel
              submissions={submissions}
              activeCellEntries={activeCellEntries}
              closedCellEntries={closedCellEntries}
              slfInfo={slfInfo}
              wasteReceivedData={wasteReceivedData}
              wasteReceivedLoading={wasteReceivedLoading}
              loadingSubmissions={loadingSubmissions}
              baselineLoading={baselineLoading}
              slfInfoLoading={slfInfoLoading}
              haulers={haulers}
              activeSlfName={activeSlfName}
              // The ADMIN-declared facility unit, so the Dashboard reads in
              // exactly the unit EMB's SLF Table shows.
              declaredUnit={slfUnit}
              slfInfoSyncedAt={slfInfoSyncedAt}
              onRefreshSlfInfo={refreshSlfInfoNow}
              onCreateSubmission={goToDataEntry}
              onViewSubmissions={goToHistory}
              onOrganizeCells={handleOrganizeCells}
              onBulkOrganize={handleBulkOrganize}
            />
          )}
          {activeMenu === "data-entry" && renderDataEntry()}
          {activeMenu === "history" && (
            <HistoryPanel
              submissions={submissions}
              historyColumns={historyColumns}
              loadingSubmissions={loadingSubmissions}
              onRefresh={handleHistoryRefresh}
            />
          )}
          {activeMenu === "documents" && (
            <MyDocumentsPanel portalUser={portalUser} isMobile={isMobile} />
          )}
          {activeMenu === "requests" && (
            <RequestsPanel
              myRequests={myRequests}
              myRequestsLoading={myRequestsLoading}
              onHideRequest={stableHideRequest}
            />
          )}
          {activeMenu === "drafts" && (
            <DraftsScheduledPanel
              portalUser={portalUser}
              isMobile={isMobile}
              onSubmitted={handleDraftSubmitted}
              onAttentionCountChange={setQueueAttentionCount}
              onResolveRevert={(id) => stableEditRevertedRow({ _id: id })}
              onEditDraft={handleEditDraft}
            />
          )}
        </Content>

        {/* Footer */}
        <div className="slf-footer">
          <Text className="slf-footer-text">
            &copy; 2026 EMBR3 — Ecological Solid Waste Management Pipeline. All
            rights reserved.
          </Text>
        </div>

        <CellOrganizerModal
          activeCellOptions={activeCellOptions}
          applyBulkCellToSelected={applyBulkCellToSelected}
          autoPlaceOrganizer={autoPlaceOrganizer}
          baselineUnit={baselineUnit}
          cellCapacityNotice={cellCapacityNotice}
          cellInfraCollapsed={cellInfraCollapsed}
          cellOrganizerBulkCell={cellOrganizerBulkCell}
          cellOrganizerData={cellOrganizerData}
          cellOrganizerError={cellOrganizerError}
          cellOrganizerExpanded={cellOrganizerExpanded}
          cellOrganizerLoading={cellOrganizerLoading}
          cellOrganizerOpen={cellOrganizerOpen}
          cellOrganizerPage={cellOrganizerPage}
          cellOrganizerPageSize={cellOrganizerPageSize}
          cellOrganizerSaving={cellOrganizerSaving}
          cellOrganizerSelected={cellOrganizerSelected}
          cellRoomLabel={cellRoomLabel}
          openCellOrganizer={openCellOrganizer}
          organizerPlanned={organizerPlanned}
          organizerStats={organizerStats}
          organizerWork={organizerWork}
          prefilledCapacityCount={prefilledCapacityCount}
          reservedCellFill={reservedCellFill}
          saveCellOrganizer={saveCellOrganizer}
          setBulkOrganizeOpen={setBulkOrganizeOpen}
          setCellInfraCollapsed={setCellInfraCollapsed}
          setCellOrganizerBulkCell={setCellOrganizerBulkCell}
          setCellOrganizerData={setCellOrganizerData}
          setCellOrganizerExpanded={setCellOrganizerExpanded}
          setCellOrganizerOpen={setCellOrganizerOpen}
          setCellOrganizerPage={setCellOrganizerPage}
          setCellOrganizerPageSize={setCellOrganizerPageSize}
          setCellOrganizerSelected={setCellOrganizerSelected}
          slfCellCount={slfCellCount}
          slfInfo={slfInfo}
          slfInfoLoading={slfInfoLoading}
          slfUnit={slfUnit}
          updateOrganizerCapacity={updateOrganizerCapacity}
          updateOrganizerCell={updateOrganizerCell}
        />

        {ORGANIZE_CELLS_ENABLED && (
          <BulkOrganizeCells
            open={bulkOrganizeOpen}
            onClose={() => setBulkOrganizeOpen(false)}
            data={cellOrganizerData}
            cellOptions={activeCellOptions}
            portalUser={portalUser}
            onApplied={(res) => {
              setBulkOrganizeOpen(false);
              setCellOrganizerOpen(false);
              setCellOrganizerData([]);
              setCellOrganizerSelected([]);
              setCellOrganizerExpanded([]);
              fetchSubmissions(true);
              setSlfInfoRefresh((n) => n + 1);
              Swal.fire({
                icon: "success",
                title: "Bulk Placement Applied",
                text: res?.message || "Your submissions have been organized into the selected cells.",
                confirmButtonColor: "#1a3353",
              });
            }}
          />
        )}

        {/* Writes into the hauler DRAFT, exactly as Add Client and the per-hauler
            client upload do — "Save Baseline Update" is still what persists it. */}
        <BaselineCompletionModal
          open={completionModalOpen}
          onClose={() => setCompletionModalOpen(false)}
          haulers={haulers}
          // The modal stages into this draft; Save Baseline Update persists it.
          // That button is unavailable on a locked baseline, so the modal has to
          // know — otherwise an operator fills in hundreds of rows and loses them.
          baselineLocked={baselineSaved}
          onApply={(nextHaulers) => setHaulers(nextHaulers)}
          onOpenHauler={(haulerIndex, focus) => {
            const hauler = haulers[haulerIndex];
            if (!hauler) return;
            setCompletionModalOpen(false);
            openHaulerModal(hauler, focus);
          }}
        />

        <PreviousNotificationsModal
          open={previousNotifOpen}
          onClose={() => setPreviousNotifOpen(false)}
          isMobile={isMobile}
          portalNotifications={portalNotifications}
          portalNotificationCounts={portalNotificationCounts}
          getPortalNotificationMeta={getPortalNotificationMeta}
          markPortalNotificationsRead={markPortalNotificationsRead}
          setNotifDetail={setNotifDetail}
        />
        {notificationDetailModal}

        <SLFPortalModals
          entryForm={entryForm}
          baselineForm={baselineForm}
          companyForm={companyForm}
          haulerModalOpen={haulerModalOpen}
          setHaulerModalOpen={setHaulerModalOpen}
          haulerDraft={haulerDraft}
          setHaulerDraft={setHaulerDraft}
          editingHaulerKey={editingHaulerKey}
          setEditingHaulerKey={setEditingHaulerKey}
          haulerErrors={haulerErrors}
          setHaulerErrors={setHaulerErrors}
          haulerProvinces={haulerProvinces}
          setHaulerProvinces={setHaulerProvinces}
          haulerCities={haulerCities}
          setHaulerCities={setHaulerCities}
          haulerBarangayList={haulerBarangayList}
          setHaulerBarangayList={setHaulerBarangayList}
          loadingHaulerAddress={loadingHaulerAddress}
          setLoadingHaulerAddress={setLoadingHaulerAddress}
          fetchHaulerProvinces={fetchHaulerProvinces}
          fetchHaulerCities={fetchHaulerCities}
          fetchHaulerBarangays={fetchHaulerBarangays}
          clientModalOpen={clientModalOpen}
          setClientModalOpen={setClientModalOpen}
          editingClientKey={editingClientKey}
          setEditingClientKey={setEditingClientKey}
          clientDraft={clientDraft}
          setClientDraft={setClientDraft}
          clientProvinces={clientProvinces}
          setClientProvinces={setClientProvinces}
          clientMunicipalities={clientMunicipalities}
          setClientMunicipalities={setClientMunicipalities}
          loadingClientAddress={loadingClientAddress}
          setLoadingClientAddress={setLoadingClientAddress}
          truckModalOpen={truckModalOpen}
          setTruckModalOpen={setTruckModalOpen}
          truckDraft={truckDraft}
          setTruckDraft={setTruckDraft}
          editingTruckKey={editingTruckKey}
          setEditingTruckKey={setEditingTruckKey}
          truckErrors={truckErrors}
          setTruckErrors={setTruckErrors}
          historyDetailModal={historyDetailModal}
          setHistoryDetailModal={setHistoryDetailModal}
          historyDetailLoading={historyDetailLoading}
          historyDetailError={historyDetailError}
          closeHistoryDetail={closeHistoryDetail}
          reviewModalOpen={reviewModalOpen}
          setReviewModalOpen={setReviewModalOpen}
          revertModalOpen={revertModalOpen}
          setRevertModalOpen={setRevertModalOpen}
          revertRecord={revertRecord}
          setRevertRecord={setRevertRecord}
          revertReason={revertReason}
          setRevertReason={setRevertReason}
          revertLoading={revertLoading}
          loading={loading}
          profileModalOpen={profileModalOpen}
          setProfileModalOpen={setProfileModalOpen}
          isDeveloperContext={isDeveloperContext}
          onProfilePhotoChange={(photo) => {
            setPortalUser((prev) => {
              const next = { ...prev, profilePhoto: photo?.url ? photo : null };
              secureStorage.setJSON("portal_user", next);
              return next;
            });
          }}
          supportDrawerOpen={supportDrawerOpen}
          setSupportDrawerOpen={setSupportDrawerOpen}
          messageDrawerOpen={messageDrawerOpen}
          setMessageDrawerOpen={setMessageDrawerOpen}
          supportForm={supportForm}
          supportTab={supportTab}
          setSupportTab={setSupportTab}
          supportTickets={supportTickets}
          supportTicketPagination={supportTicketPagination}
          supportTicketSearch={supportTicketSearch}
          supportTicketSorter={supportTicketSorter}
          portalNotificationCounts={portalNotificationCounts}
          markPortalNotificationsRead={markPortalNotificationsRead}
          supportLoading={supportLoading}
          supportSubmitting={supportSubmitting}
          fetchSupportTickets={fetchSupportTickets}
          faqActiveKey={faqActiveKey}
          setFaqActiveKey={setFaqActiveKey}
          supportDetailModal={supportDetailModal}
          setSupportDetailModal={setSupportDetailModal}
          supportReplyText={supportReplyText}
          setSupportReplyText={setSupportReplyText}
          uploadModalOpen={uploadModalOpen}
          setUploadModalOpen={setUploadModalOpen}
          uploadType={uploadType}
          setUploadType={setUploadType}
          uploadGuideOpen={uploadGuideOpen}
          setUploadGuideOpen={setUploadGuideOpen}
          uploadGuideType={uploadGuideType}
          setUploadGuideType={setUploadGuideType}
          uploadPreviewData={uploadPreviewRows}
          backlogSummary={backlogSummary}
          uploadPreviewSummary={uploadPreviewSummary}
          uploadPreviewColumns={uploadPreviewColumns}
          uploadMissingColumns={uploadMissingColumns}
          uploadDetection={uploadDetection}
          uploadAlignmentSummary={uploadAlignmentSummary}
          onUseStoredClient={useStoredClientForRows}
          onUseStoredHauler={useStoredHaulerForRows}
          onApplyClientFixToHauler={applyClientFixToHauler}
          setUploadPreviewData={setUploadPreviewData}
          setUploadPreviewColumns={setUploadPreviewColumns}
          setUploadMissingColumns={setUploadMissingColumns}
          setUploadDetection={setUploadDetection}
          uploadProgressOpen={uploadProgressOpen}
          uploadProgress={uploadProgress}
          uploadStatusText={uploadStatusText}
          uploadProgressError={uploadProgressError}
          setUploadProgressOpen={setUploadProgressOpen}
          ticketAttachments={ticketAttachments}
          setTicketAttachments={setTicketAttachments}
          ticketUploading={ticketUploading}
          setTicketUploading={setTicketUploading}
          activeCellModalOpen={activeCellModalOpen}
          setActiveCellModalOpen={setActiveCellModalOpen}
          activeCellDraft={activeCellDraft}
          setActiveCellDraft={setActiveCellDraft}
          editingActiveCellKey={editingActiveCellKey}
          setEditingActiveCellKey={setEditingActiveCellKey}
          closedCellModalOpen={closedCellModalOpen}
          setClosedCellModalOpen={setClosedCellModalOpen}
          closedCellDraft={closedCellDraft}
          setClosedCellDraft={setClosedCellDraft}
          editingClosedCellKey={editingClosedCellKey}
          setEditingClosedCellKey={setEditingClosedCellKey}
          declaredCellUnit={declaredCellUnit}
          haulerDeleteModal={haulerDeleteModal}
          setHaulerDeleteModal={setHaulerDeleteModal}
          haulerDeleteReason={haulerDeleteReason}
          setHaulerDeleteReason={setHaulerDeleteReason}
          haulerDeleteFile={haulerDeleteFile}
          setHaulerDeleteFile={setHaulerDeleteFile}
          haulerDeleteLoading={haulerDeleteLoading}
          setHaulerDeleteLoading={setHaulerDeleteLoading}
          leachateModalOpen={leachateModalOpen}
          setLeachateModalOpen={setLeachateModalOpen}
          leachateDetails={leachateDetails}
          setLeachateDetails={setLeachateDetails}
          gasVentModalOpen={gasVentModalOpen}
          setGasVentModalOpen={setGasVentModalOpen}
          gasVentDetails={gasVentDetails}
          setGasVentDetails={setGasVentDetails}
          trashSlideModalOpen={trashSlideModalOpen}
          setTrashSlideModalOpen={setTrashSlideModalOpen}
          trashSlideDetails={trashSlideDetails}
          setTrashSlideDetails={setTrashSlideDetails}
          firePrevModalOpen={firePrevModalOpen}
          setFirePrevModalOpen={setFirePrevModalOpen}
          firePrevDetails={firePrevDetails}
          setFirePrevDetails={setFirePrevDetails}
          facilityMgmtSaving={facilityMgmtSaving}
          wasteReceivedModalOpen={wasteReceivedModalOpen}
          setWasteReceivedModalOpen={setWasteReceivedModalOpen}
          wasteReceivedData={wasteReceivedData}
          wasteReceivedLoading={wasteReceivedLoading}
          activeCellEntries={activeCellEntries}
          activeCellOptions={activeCellOptions}
          cellPlacementOptions={cellPlacementOptions}
          slfInfoLoading={slfInfoLoading}
          slfCellCount={slfCellCount}
          baselineCellOptions={baselineCellOptions}
          closedCellEntries={closedCellEntries}
          haulers={haulers}
          trucks={trucks}
          baselineUnit={baselineUnit || slfUnit}
          baselineSaved={baselineSaved}
          submissions={submissions}
          portalUser={portalUser}
          portalCredentialSelfServiceEnabled={portalUser?.allowCredentialSelfService === true}
          onCredentialUpdated={handleLogout}
          activeSlfId={activeSlfId}
          activeSlfName={activeSlfName}
          slfInfo={slfInfo}
          regions={regions}
          provinces={provinces}
          municipalities={municipalities}
          barangays={barangays}
          extraTransportFields={extraTransportFields}
          acceptsHazardousWaste={acceptsHazardousWaste}
          hazWasteCodes={hazWasteCodes}
          isMobile={isMobile}
          handleSaveHauler={handleSaveHauler}
          updateHaulerDraft={updateHaulerDraft}
          updateHaulerDraftAddr={updateHaulerDraftAddr}
          openHaulerModal={openHaulerModal}
          handleSaveClient={handleSaveClient}
          handleSaveTruck={handleSaveTruck}
          updateTruckDraft={updateTruckDraft}
          updateVehicle={updateVehicle}
          openRevertModal={openRevertModal}
          handleRequestRevert={handleRequestRevert}
          handleConfirmSubmit={handleConfirmSubmit}
          handleReviewOpen={handleReviewOpen}
          handleSaveDraft={handleSaveDraft}
          savingDraft={savingDraft}
          openScheduleModal={() => setScheduleModalOpen(true)}
          handleSubmitTicket={handleSubmitTicket}
          handleSupportReply={handleSupportReply}
          handleSaveActiveCellEntry={handleSaveActiveCellEntry}
          handleSaveClosedCellEntry={handleSaveClosedCellEntry}
          handleConfirmUpload={handleConfirmUpload}
          proceedToFilePicker={proceedToFilePicker}
          downloadDisposalTemplate={downloadDisposalTemplate}
          downloadHaulerTemplate={downloadHaulerTemplate}
          exportHaulerData={exportHaulerData}
          exportSingleHaulerData={exportSingleHaulerData}
          haulerModalFocus={haulerModalFocus}
          haulerVeraStage={haulerVeraStage}
          haulerVeraComment={haulerVeraComment}
          haulerVeraError={haulerVeraError}
          haulerVeraSource={haulerVeraSource}
          reassessHaulerUpload={reassessHaulerUpload}
          updateUploadCell={updateUploadCell}
          handleOpenWasteReceived={handleOpenWasteReceived}
          handleSaveFacilityDetails={handleSaveFacilityDetails}
          handleEditReverted={handleEditReverted}
          handleResubmitReverted={handleResubmitReverted}
          renderStatusTag={renderStatusTag}
          fl={fl}
          isRequired={isRequired}
          opts={opts}
          fieldErr={fieldErr}
          resubmitComment={resubmitComment}
          setResubmitComment={setResubmitComment}
          editingRevertedId={editingRevertedId}
          setEditingRevertedId={setEditingRevertedId}
        />
        {/* VERA — Virtual Environmental Response Assistant (floating chatbot).
            Replaces the retired Support & FAQ button; folds ticket access in via
            the support drawer handlers. */}
        {/* `canViewVera === false` is a deliberate withdrawal of the assistant
            from this account (Developer Settings → Portal User Rules), so the
            launcher goes with it — the server refuses /vera/chat for them either
            way, and a button that only ever answers "not permitted" is worse
            than no button. Undefined means "not configured" → the rule's default
            (allowed), which is every account that was never touched. */}
        {portalUser?.portalAccess?.canViewVera !== false && (
          <>
            <VeraChat
              activeMenu={activeMenu}
              isMobile={isMobile}
              onOpenNewTicket={() => {
                setSupportTab("new-ticket");
                setSupportDrawerOpen(true);
                if (supportTickets.length === 0) fetchSupportTickets();
                markPortalNotificationsRead("support");
              }}
              onOpenMyTickets={() => {
                setSupportTab("my-tickets");
                setSupportDrawerOpen(true);
                if (supportTickets.length === 0) fetchSupportTickets();
                markPortalNotificationsRead("support");
              }}
            />
            <VeraOnboarding portal="slf" userId={portalUser?.email || portalUser?._id} />
          </>
        )}
        <PortalOverlays
          activeTab={activeTab}
          dismissTourPermanently={dismissTourPermanently}
          featureTourCurrent={featureTourCurrent}
          featureTourOpen={featureTourOpen}
          featureTourSteps={featureTourSteps}
          handleScheduleSubmission={handleScheduleSubmission}
          markFeatureTourSeen={markFeatureTourSeen}
          scheduleAt={scheduleAt}
          scheduleModalOpen={scheduleModalOpen}
          schedulingSubmit={schedulingSubmit}
          setActiveTab={setActiveTab}
          setFeatureTourCurrent={setFeatureTourCurrent}
          setFeatureTourOpen={setFeatureTourOpen}
          setScheduleAt={setScheduleAt}
          setScheduleModalOpen={setScheduleModalOpen}
          setUpdateTourCurrent={setUpdateTourCurrent}
          submitProgress={submitProgress}
          updateTourCurrent={updateTourCurrent}
          updateTourOpen={updateTourOpen}
          updateTourSteps={updateTourSteps}
        />
        {/* Item #4: EMB Region III messages are shown via a queued SweetAlert2
            (see the msgShowingRef effect above) — no inline modal needed. */}
      </Layout>
    </Layout>
    </SensitiveMaskProvider>
  );
}
