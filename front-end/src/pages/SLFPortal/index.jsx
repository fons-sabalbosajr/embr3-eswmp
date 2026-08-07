import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Layout,
  Form,
  Input,
  InputNumber,
  Button,
  Card,
  Typography,
  Result,
  Select,
  DatePicker,
  Divider,
  Row,
  Col,
  Space,
  Statistic,
  Table,
  Spin,
  Empty,
  Menu,
  Avatar,
  Dropdown,
  Tag,
  Grid,
  Drawer,
  Tabs,
  Modal,
  Descriptions,
  Badge,
  Tooltip,
  Collapse,
  Popover,
  List,
  Progress,
  Checkbox,
  Pagination,
  Alert,
  Tour,
  Skeleton
} from "antd";
import {
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SendOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MenuOutlined,
  UserOutlined,
  DatabaseOutlined,
  DashboardOutlined,
  InfoCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ReloadOutlined,
  EyeOutlined,
  UndoOutlined,
  MailOutlined,
  CarOutlined,
  EnvironmentOutlined,
  TeamOutlined,
  WifiOutlined,
  BellOutlined,
  InboxOutlined,
  MessageOutlined,
  PieChartOutlined,
  BankOutlined,
  ContainerOutlined,
  BarChartOutlined,
  DownOutlined,
  UpOutlined,
  QuestionCircleOutlined,
  CustomerServiceOutlined,
  SearchOutlined,
  UploadOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  SaveOutlined,
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
import * as XLSX from "xlsx";
import {
  PieChart,
  Pie,
  Cell as RCell,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import api from "../../api";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../../config/appContact";
import { useErrorCard } from "../../utils/ErrorHandler";
import secureStorage from "../../utils/secureStorage";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { connectSocket, disconnectSocket } from "../../utils/socket";
import embLogo from "../../assets/emblogo.svg";
import "./SLFPortal.css";
import SLFPortalModals from "./SLFPortalModals";
import { makeTruckColumns } from "./columns/truckColumns";
import { makeHaulerColumns } from "./columns/haulerColumns";
import { makeHistoryColumns } from "./columns/historyColumns";
import PortalNotificationPanel from "./PortalNotificationPanel";
import PreviousNotificationsModal from "./PreviousNotificationsModal";
import WasteGeneratorPane from "./WasteGeneratorPane";
import VeraChat from "./Vera/VeraChat";
import VeraOnboarding from "../../components/VeraOnboarding";
import DraftsScheduledPanel from "./DraftsScheduledPanel";
import RequestsPanel from "./RequestsPanel";
import HistoryPanel from "./HistoryPanel";
import { SensitiveMaskProvider, MASK_PLACEHOLDER } from "../../utils/sensitiveMask";
import OverviewPanel from "./OverviewPanel";
import AssignedSlfDashboard from "./AssignedSlfDashboard";
import RequiredDot from "./RequiredDot";
import BasicInfoTab from "./BasicInfoTab";
import BulkOrganizeCells from "./BulkOrganizeCells";
import {
  EMPTY_TRUCK,
  EMPTY_HAULER,
  EMPTY_VEHICLE,
  KNOWN_TRANSPORT_KEYS,
  withRetry,
  newClientRequestId,
  PORTAL_SETTINGS_CACHE_KEY,
  PORTAL_SUBMISSIONS_CACHE_KEY,
  PORTAL_WASTE_RECEIVED_CACHE_KEY,
  PORTAL_CACHE_TTL,
  PORTAL_UPDATE_TOUR_SEEN_PREFIX,
  PORTAL_TOUR_DISMISSED_PREFIX,
  ORGANIZE_CELLS_ENABLED,
} from "./constants";
import {
  validateWasteGeneration,
  formatWasteGenIssues,
  validateTransportUnits,
  validateTruckCapacityElevation,
  TRUCK_CAPACITY_ELEVATION_FACTOR,
} from "./wasteGenValidation";
import { formatStatusSummary } from "./submissionGrouping";
import {
  getUnplacedSubmissions,
  summarizeOrganizeTotals,
  formatOrganizeWarningHtml,
} from "./organizeCellsValidation";
import {
  normalizeUnit,
  hasBaselinePayload,
  formatEntryVolumeSummary,
  isTestAdminNotice,
  normalizeCellStatus,
  isActiveCellStatus,
  isCompletedCellStatus,
  isUnavailableCellStatus,
} from "./helpers";
import {
  cleanClientForSubmit,
  normalizeHaulerRecord,
  mergeHaulersByName,
  cleanHaulerForSubmit,
} from "./haulerNormalization";
import {
  uploadHeaderKey,
  isHaulerNameHeader,
  isNumberOfTrucksHeader,
  isClientsHeader,
  isEmptyUploadValue,
  cleanUploadText,
  parseUploadNumber,
  getUploadMissingColumns,
  getUploadRowErrors,
  getUploadRelationshipErrors,
  findUploadHauler,
  findUploadClientForHauler,
  UPLOAD_COLUMNS,
} from "./uploadHelpers";
import { convertVolume, resolveCellUnit, resolveFacilityUnit } from "../../utils/volumeUnits";
import { isHazardousWasteType } from "../../utils/wasteCategories";
// Canonical cell helpers — shared with the admin side so the Portal and the admin
// never disagree about which cells exist or what they are called.
import {
  resolveCellName,
  isNonExistentCell,
  getCellStatusConfig,
  getCellTypeConfig,
  getCapacityStatus,
  getCellAcceptance,
  cellDisabledLabel,
} from "../../utils/cellVisuals";

const { Text } = Typography;
const { Option } = Select;
const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;
const { TextArea } = Input;

/**
 * Resolve Total Volume Accepted for a save payload.
 *
 * Returns `undefined` when this edit did not actually supply the figure, so the
 * server's Total Volume guard preserves whatever is already stored. Returning a
 * number — including a deliberate 0 — writes it.
 *
 * Shared by all three save paths (Save Baseline, Edit & Resubmit, and
 * buildSubmissionEntry, which backs the Drafts/Scheduled queue) so the rule
 * cannot drift between them.
 *
 * The distinction that matters: `??` does not fall through on 0, so a stale or
 * default 0 sitting in the form STORE used to be sent and would overwrite a
 * real saved total with zero. A 0 that is genuinely on screen is honoured; a 0
 * that exists only because the store had a default is treated as "not provided".
 *
 * @param {boolean} authoritative  cell entries recompute the total (wins outright)
 * @param {number}  computed       the recomputed total
 * @param {*}       mountedValue   value from the RENDERED field, or undefined when
 *                                 its pane is closed/unmounted
 * @param {*}       storeValue     value from the full form store
 */
function resolveTotalVolumeForSave({ authoritative, computed, mountedValue, storeValue }) {
  const candidate = authoritative ? computed : (mountedValue ?? storeValue);
  const explicitlyOnScreen =
    mountedValue !== undefined && mountedValue !== null && mountedValue !== "" && Number(mountedValue) > 0;
  const meaningful = authoritative || explicitlyOnScreen || Number(candidate) > 0;
  return meaningful ? candidate : undefined;
}

/**
 * Lock state for the Company Information + Baseline tabs.
 *
 * BUSINESS RULE: clicking "Save Baseline Update" locks both tabs IMMEDIATELY and
 * they stay locked — editing them again requires a fresh update request that an
 * admin approves. The lock is a data-security control, so it must not depend on
 * what the record happens to contain.
 *
 * That is why this reads the RECORD, not its payload. The lock used to be decided
 * by hasBaselinePayload(), which only tests for volumes, cell entries and
 * haulers — so a baseline saved with COMPANY INFORMATION ONLY looked "empty",
 * fell through to the not-saved branch and silently unlocked itself a moment
 * after saving.
 *
 * hasBaselinePayload() is still the right test for whether to POPULATE the form;
 * it was only ever wrong as the lock signal.
 *
 * @param {object|null} data GET /data-slf/baseline response (null = no record)
 */
function resolveBaselineLock(data) {
  // No baseline record at all — first-time entry, tabs open.
  if (!data) return { locked: false, updatePending: false };
  // An approved update request is the ONLY thing that reopens the tabs.
  if (data.baselineUpdateApproved) return { locked: false, updatePending: false };
  return { locked: true, updatePending: !!data.baselineUpdateRequested };
}

export default function SLFPortal() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const { showError, card: errorCard } = useErrorCard();
  const [portalUser, setPortalUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("overview");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingUser, setLoadingUser] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [entryForm] = Form.useForm();
  const [trucks, setTrucks] = useState([]);
  const [truckDraft, setTruckDraft] = useState({ ...EMPTY_TRUCK });
  const [editingTruckKey, setEditingTruckKey] = useState(null);
  const [truckErrors, setTruckErrors] = useState({});
  // Transport & Disposal list: pagination + multi-select cell assignment.
  const [truckPage, setTruckPage] = useState(1);
  const [truckPageSize, setTruckPageSize] = useState(10);
  const [selectedTruckKeys, setSelectedTruckKeys] = useState([]);
  const [truckBulkCell, setTruckBulkCell] = useState(undefined);
  const [truckModalOpen, setTruckModalOpen] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawer, setMobileDrawer] = useState(false);
  const [activeTab, setActiveTab] = useState("basic-info");
  const [baselineForm] = Form.useForm();
  const [companyForm] = Form.useForm();
  const [haulers, setHaulers] = useState([]);
  const [haulerDraft, setHaulerDraft] = useState({ ...EMPTY_HAULER });
  const [editingHaulerKey, setEditingHaulerKey] = useState(null);
  const [haulerErrors, setHaulerErrors] = useState({});
  const [haulerModalOpen, setHaulerModalOpen] = useState(false);
  const [baselineSaved, setBaselineSaved] = useState(false);
  const [baselineUpdatePending, setBaselineUpdatePending] = useState(false);
  const [baselineUpdateLoading, setBaselineUpdateLoading] = useState(false);
  const [baselineRefreshLoading, setBaselineRefreshLoading] = useState(false);
  const [baselineSavingLoading, setBaselineSavingLoading] = useState(false);
  const [slfInfo, setSlfInfo] = useState(null);
  const [slfInfoLoading, setSlfInfoLoading] = useState(false);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [slfInfoRefresh, setSlfInfoRefresh] = useState(0);
  const [baselineRefresh, setBaselineRefresh] = useState(0);
  // "region|province|municipality" the loaded address option lists belong to, so a
  // baseline refresh can skip re-fetching lists it already holds.
  const addressListsKeyRef = useRef("");
  const [portalMessages, setPortalMessages] = useState([]);
  const [slfCardExpanded, setSlfCardExpanded] = useState(false);
  const [selectedSlfIdx, setSelectedSlfIdx] = useState(0); // for multi-SLF users
  const [fieldLabels, setFieldLabels] = useState({});
  const [hazWasteCodes, setHazWasteCodes] = useState([
    "K301",
    "K302",
    "K303",
    "M501",
  ]);
  const [historyDetailModal, setHistoryDetailModal] = useState(null);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [historyDetailError, setHistoryDetailError] = useState(null);
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertRecord, setRevertRecord] = useState(null);
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(null);
  const [schedulingSubmit, setSchedulingSubmit] = useState(false);
  const [activeCellEntries, setActiveCellEntries] = useState([]);
  const [activeCellModalOpen, setActiveCellModalOpen] = useState(false);
  const [activeCellDraft, setActiveCellDraft] = useState({
    cellName: "",
    cellType: "",
    cellIndex: null,
    wasteType: "Residual",
    volume: null,
  });
  const [editingActiveCellKey, setEditingActiveCellKey] = useState(null);
  // Closed cell entries (table-based)
  const [closedCellEntries, setClosedCellEntries] = useState([]);
  const [closedCellModalOpen, setClosedCellModalOpen] = useState(false);
  const [closedCellDraft, setClosedCellDraft] = useState({
    cellName: "",
    cellType: "",
    cellIndex: null,
    wasteType: "Residual",
    volume: null,
  });
  const [editingClosedCellKey, setEditingClosedCellKey] = useState(null);
  // Hauler delete request modal
  const [haulerDeleteModal, setHaulerDeleteModal] = useState({
    open: false,
    hauler: null,
  });
  const [haulerDeleteReason, setHaulerDeleteReason] = useState("");
  const [haulerDeleteFile, setHaulerDeleteFile] = useState(null);
  const [haulerDeleteLoading, setHaulerDeleteLoading] = useState(false);
  // Hauler address dropdowns
  const [haulerProvinces, setHaulerProvinces] = useState([]);
  const [haulerCities, setHaulerCities] = useState([]);
  const [haulerBarangayList, setHaulerBarangayList] = useState([]);
  const [loadingHaulerAddress, setLoadingHaulerAddress] = useState("");
  // Hauler client modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClientKey, setEditingClientKey] = useState(null);
  const [clientDraft, setClientDraft] = useState({
    clientName: "",
    clientType: "Private",
    region: "",
    province: "",
    municipality: "",
  });
  const [clientProvinces, setClientProvinces] = useState([]);
  const [clientMunicipalities, setClientMunicipalities] = useState([]);
  const [loadingClientAddress, setLoadingClientAddress] = useState("");
  const [extraTransportFields, setExtraTransportFields] = useState([]);
  // Address cascading dropdowns
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  // Global baseline unit of measurement
  // The unit stored on the loaded baseline/record (historical). Starts EMPTY (not a
  // hard-coded unit) so display falls back to the centralized current SLF unit
  // (`slfUnit`) until a real per-record unit is loaded — a separate default here
  // was the classic stale-unit source flagged in Item #3.
  const [baselineUnit, setBaselineUnit] = useState("");
  const [acceptsHazardousWaste, setAcceptsHazardousWaste] = useState(false);
  const [supportForm] = Form.useForm();
  // Support ticket states
  const [supportDrawerOpen, setSupportDrawerOpen] = useState(false);
  const [messageDrawerOpen, setMessageDrawerOpen] = useState(false);
  const [supportTab, setSupportTab] = useState("new-ticket");
  const [supportTickets, setSupportTickets] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportDetailModal, setSupportDetailModal] = useState(null);
  const [supportReplyText, setSupportReplyText] = useState("");
  const [supportTicketPagination, setSupportTicketPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });
  const [supportTicketSearch, setSupportTicketSearch] = useState("");
  const [supportTicketSorter, setSupportTicketSorter] = useState({
    field: "createdAt",
    order: "descend",
  });
  const [portalNotifications, setPortalNotifications] = useState([]);
  const [portalUnreadCount, setPortalUnreadCount] = useState(0);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  // "Previous Notifications" full-history modal + the single notification opened
  // for its complete message. Reuses the already-fetched portalNotifications list
  // (no extra fetch, no second store).
  const [previousNotifOpen, setPreviousNotifOpen] = useState(false);
  const [notifDetail, setNotifDetail] = useState(null);
  const [portalSettings, setPortalSettings] = useState(null);
  const [portalAnnouncement, setPortalAnnouncement] = useState(null);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const [updateTourOpen, setUpdateTourOpen] = useState(false);
  const [updateTourCurrent, setUpdateTourCurrent] = useState(0);
  const announcementBannerRef = useRef(null);
  // Idempotency key for the current submit attempt — reused across recoverable
  // retries (so a lost-response retry returns the saved record instead of
  // duplicating) and cleared only after a confirmed success.
  const submitKeyRef = useRef(null);
  const slfSelectorRef = useRef(null);
  const dataEntryTabsRef = useRef(null);
  const baselinePanelRef = useRef(null);
  const baselineStatusRef = useRef(null);
  const baselineActionRef = useRef(null);
  // Excel/CSV upload states
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadType, setUploadType] = useState("truck"); // "truck" or "hauler"
  const [uploadGuideOpen, setUploadGuideOpen] = useState(false);
  const [uploadGuideType, setUploadGuideType] = useState(null); // pending type for guide → pick
  const [uploadPreviewData, setUploadPreviewData] = useState([]);
  const [uploadPreviewColumns, setUploadPreviewColumns] = useState([]);
  const [uploadMissingColumns, setUploadMissingColumns] = useState([]);
  // Excel upload progress UX
  const [uploadProgressOpen, setUploadProgressOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState("");
  const [uploadProgressError, setUploadProgressError] = useState(false);
  // Submit progress (percentage) for large / bulk disposal submissions.
  const [submitProgress, setSubmitProgress] = useState({
    open: false,
    percent: 0,
    text: "",
    error: false,
  });
  // Waste Generation issues surfaced by the last blocked submit attempt, so the
  // offending truck rows can be highlighted. Cleared once the submit passes.
  const [wasteGenIssues, setWasteGenIssues] = useState([]);
  // Synchronous in-flight flag for the draft/schedule queue actions. A ref (not
  // state) because it must block the SECOND click of a double-click, which happens
  // before React has flushed the `savingDraft` / `schedulingSubmit` state.
  const queueActionRef = useRef(false);

  useEffect(() => {
    return () => {
      setSubmissions([]);
      setMyRequests([]);
      setCellOrganizerData([]);
      setCellOrganizerSelected([]);
      setCellOrganizerExpanded([]);
    };
  }, []);
  // Support ticket attachments (screenshots / proof)
  const [ticketAttachments, setTicketAttachments] = useState([]);
  const [ticketUploading, setTicketUploading] = useState(false);
  // My Requests / Activity Log states
  const [myRequests, setMyRequests] = useState([]);
  const [myRequestsLoading, setMyRequestsLoading] = useState(false);
  // FAQ collapsed keys
  const [faqActiveKey, setFaqActiveKey] = useState([]);
  // Profile modal
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  // `preserve: true` is REQUIRED here, not an optimisation.
  //
  // The Data Entry tabs render with `destroyOnHidden`, so only the open pane is
  // mounted. Without this option useWatch reads `getFieldsValue()`, which returns
  // values for CURRENTLY REGISTERED fields only — so the moment a user leaves the
  // Basic Information tab, all four company fields read `undefined`, and leaving
  // the Baseline tab makes Total Volume Accepted read `undefined`. Since exactly
  // one tab can be open at a time, at least one "incomplete" blocker was ALWAYS
  // present and Review & Submit could never enable, no matter how much the user
  // filled in. `preserve: true` reads `getFieldsValue(true)` — the whole store,
  // including fields whose pane is currently unmounted (antd preserves those
  // values by default), which is the state the user actually entered.
  const watchOptions = (form) => ({ form, preserve: true });
  const watchedDisposalDate = Form.useWatch("dateOfDisposal", watchOptions(entryForm));
  const watchedTotalVolumeAccepted = Form.useWatch(
    "totalVolumeAccepted",
    watchOptions(baselineForm),
  );
  const watchedCompanyName = Form.useWatch("lguCompanyName", watchOptions(companyForm));
  const watchedCompanyRegion = Form.useWatch("companyRegion", watchOptions(companyForm));
  const watchedCompanyProvince = Form.useWatch("companyProvince", watchOptions(companyForm));
  const watchedCompanyMunicipality = Form.useWatch("companyMunicipality", watchOptions(companyForm));
  const isTreatedHazardousWaste = (value) =>
    String(value || "")
      .trim()
      .toLowerCase() === "treated hazardous waste";
  const hasHazardousWasteCode = (value) =>
    Array.isArray(value) ? value.length > 0 : !!String(value || "").trim();
  const missingHazardousCodeTrucks = trucks.filter(
    (truck) =>
      isTreatedHazardousWaste(truck.wasteType) &&
      !hasHazardousWasteCode(truck.hazWasteCode),
  );
  const TAB_DEPENDENCIES = {
    // Cell options + the declared unit come from the facility; the baseline drives
    // the unit and the saved cell entries.
    baseline: () => slfInfoLoading || baselineLoading,
    disposal: () => slfInfoLoading || baselineLoading,
    "basic-info": () => false, // only address reference data, loaded on demand
  };

  const tabLoadingMessage = (key) =>
    key === "disposal"
      ? "Loading cell infrastructure and unit configuration…"
      : "Loading baseline and cell infrastructure…";

  // Wrap each pane in its own loader. Applied to the items array so the (very
  // large) tab bodies below stay untouched.
  const withTabLoading = (items) =>
    items.map((item) => {
      const isLoading = TAB_DEPENDENCIES[item.key]?.() ?? false;
      if (!isLoading) return item;
      return {
        ...item,
        children: (
          <div style={{ padding: "48px 0", textAlign: "center" }}>
            <Spin size="large" />
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">{tabLoadingMessage(item.key)}</Text>
            </div>
          </div>
        ),
      };
    });

  const isDeveloperContext = !!(portalUser?.developerContext || portalUser?.devImpersonation);
  const haulerVehiclesMissingCapacity = useMemo(() => {
    const issues = [];
    (haulers || []).forEach((h) => {
      (h.vehicles || []).forEach((v, vi) => {
        const cap = v?.capacity;
        const invalid =
          cap === null || cap === undefined || cap === "" || !(Number(cap) > 0);
        if (invalid) {
          issues.push({
            haulerName: h.haulerName || "Unnamed hauler",
            plateNumber: v?.plateNumber || `Vehicle ${vi + 1}`,
          });
        }
      });
    });
    return issues;
  }, [haulers]);

  const missingBaselineInfo =
    watchedTotalVolumeAccepted == null || watchedTotalVolumeAccepted === "";
  const missingGeneralInfo = [
    watchedCompanyName,
    watchedCompanyRegion,
    watchedCompanyProvince,
    watchedCompanyMunicipality,
  ].some((value) => value == null || String(value).trim() === "");
  // Every Waste Generation Information field (incl. Truck Capacity) is required
  // for FINAL submission. Reuses the same rule set the backend enforces, so the
  // tab's required-dot and the submit block can never disagree with the server.
  // Drafts are not gated by this.
  const wasteGenValidationIssues = validateWasteGeneration(trucks);
  const missingDisposalInfo =
    !watchedDisposalDate || trucks.length === 0 || wasteGenValidationIssues.length > 0;
  const hasReviewMissing =
    missingGeneralInfo ||
    missingBaselineInfo ||
    missingDisposalInfo ||
    missingHazardousCodeTrucks.length > 0;
  const portalAnnouncementVersion =
    portalAnnouncement?.updatedAt ||
    portalAnnouncement?._id ||
    portalAnnouncement?.portalAnnouncementTitle ||
    "";
  const portalUpdateTourSeenKey = portalAnnouncementVersion
    ? `${PORTAL_UPDATE_TOUR_SEEN_PREFIX}${portalAnnouncementVersion}`
    : "";
  const portalMaintenanceActive = !!portalSettings?.portalMaintenanceMode;
  const portalMaintenanceMessage =
    portalSettings?.portalMaintenanceMessage ||
    portalSettings?.portalMaintenanceReason ||
    "The portal is currently under maintenance. Please try again later.";
  const isPortalUpdateAnnouncement = /\b(update|updates|what'?s new|guided tour|tour)\b/i.test(
    `${portalAnnouncement?.portalAnnouncementTitle || ""}\n${portalAnnouncement?.portalAnnouncementMessage || ""}`,
  );
  const hasMultipleAssignedSlf =
    Array.isArray(portalUser?.assignedSlfName) &&
    portalUser.assignedSlfName.length > 1;
  const openPortalUpdateTour = useCallback(() => {
    // Don't show if this user has permanently dismissed the tour
    const stableKey = portalUser?.email
      ? `${PORTAL_TOUR_DISMISSED_PREFIX}${portalUser.email}`
      : null;
    if (stableKey && secureStorage.get(stableKey) === "1") return;
    setAnnouncementDismissed(false);
    setActiveMenu("data-entry");
    setUpdateTourCurrent(0);
    setUpdateTourOpen(true);
  }, [portalUser?.email]);
  const updateTourSteps = useMemo(() => {
    const steps = [
      {
        key: "announcement",
        title: "Today's portal updates",
        description:
          "This banner is where the latest SLF portal changes are announced. Use it to review rollout notes and update guidance.",
        target: () => announcementBannerRef.current,
        placement: "bottom",
      },
    ];

    if (hasMultipleAssignedSlf) {
      steps.push({
        key: "slf-selector",
        title: "Switch your assigned SLF",
        description:
          "If your account handles more than one facility, switch here before reviewing baseline or disposal records.",
        target: () => slfSelectorRef.current,
        placement: "bottom",
      });
    }

    steps.push(
      {
        key: "baseline-tab",
        title: "Baseline tab",
        description:
          "Baseline records now stay tied to the assigned SLF more reliably, including after facility rename updates.",
        target: () => dataEntryTabsRef.current,
        placement: "top",
      },
      {
        key: "baseline-actions",
        title: baselineSaved ? "Baseline change workflow" : "Save your baseline",
        description: baselineSaved
          ? baselineUpdatePending
            ? "Your request is pending admin review. Use Refresh here to check when editing becomes available again."
            : "After the first save locks the baseline, use Request Update here whenever admin approval is needed."
          : "When editing is available, save the updated baseline here so it remains linked to the correct assigned facility.",
        target: () =>
          baselineActionRef.current ||
          baselineStatusRef.current ||
          baselinePanelRef.current ||
          dataEntryTabsRef.current,
        placement: "top",
      },
    );

    return steps;
  }, [baselineSaved, baselineUpdatePending, hasMultipleAssignedSlf]);
  // Facility management modals (Leachate, Gas Management, Trash Slide, Fire Prevention)
  const [leachateModalOpen, setLeachateModalOpen] = useState(false);
  const [gasVentModalOpen, setGasVentModalOpen] = useState(false);
  const [trashSlideModalOpen, setTrashSlideModalOpen] = useState(false);
  const [firePrevModalOpen, setFirePrevModalOpen] = useState(false);
  const [facilityMgmtSaving, setFacilityMgmtSaving] = useState(false);
  // Local editable copies of facility detail arrays
  const [leachateDetails, setLeachateDetails] = useState([]);
  const [gasVentDetails, setGasVentDetails] = useState([]);
  const [trashSlideDetails, setTrashSlideDetails] = useState([]);
  const [firePrevDetails, setFirePrevDetails] = useState([]);
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

  const isMobile = !screens.md;

  // ── Online / offline awareness ──
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Fetch portal field settings with retry ──
  const fieldsLoadedRef = useRef(false);
  const fetchFieldSettings = useCallback((signal) => {
    return withRetry(() => api.get("/settings/fields", { signal }), {
      retries: 3,
      signal,
    })
      .then(({ data }) => {
        const map = {};
        const extraTransport = [];
        data.forEach((f) => {
          map[f.fieldKey] = {
            label: f.fieldName,
            required: f.required,
            options: f.options || [],
            section: f.section,
            fieldType: f.fieldType,
          };
          if (f.section === "hazwaste-codes" && f.options?.length > 0) {
            setHazWasteCodes(f.options);
          }
          if (
            f.section === "transport-info" &&
            !KNOWN_TRANSPORT_KEYS.has(f.fieldKey) &&
            f.fieldKey !== "hazWasteCode" &&
            !f.fieldKey.toLowerCase().includes("hazwaste")
          ) {
            extraTransport.push(f);
          }
        });
        setFieldLabels(map);
        setExtraTransportFields(
          extraTransport.sort((a, b) => a.order - b.order),
        );
        fieldsLoadedRef.current = true;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchFieldSettings(ac.signal);
    return () => ac.abort();
  }, [fetchFieldSettings]);

  // ── Fetch regions with retry ──
  const regionsLoadedRef = useRef(false);
  const fetchRegions = useCallback((signal) => {
    return withRetry(() => api.get("/settings/address/regions", { signal }), {
      retries: 3,
      signal,
    })
      .then(({ data }) => {
        setRegions(data || []);
        regionsLoadedRef.current = true;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetchRegions(ac.signal);
    return () => ac.abort();
  }, [fetchRegions]);

  // ── Auto-recover when coming back online ──
  useEffect(() => {
    if (!isOnline) return;
    // Re-fetch data that failed to load initially
    const ac = new AbortController();
    if (!fieldsLoadedRef.current) fetchFieldSettings(ac.signal);
    if (!regionsLoadedRef.current) fetchRegions(ac.signal);
    return () => ac.abort();
  }, [isOnline, fetchFieldSettings, fetchRegions]);

  const [loadingAddress, setLoadingAddress] = useState("");

  const fetchProvinces = (regionCode) => {
    setProvinces([]);
    setMunicipalities([]);
    setBarangays([]);
    companyForm.setFieldsValue({
      companyProvince: undefined,
      companyMunicipality: undefined,
      companyBarangay: undefined,
    });
    if (!regionCode) return;
    setLoadingAddress("province");
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), {
      retries: 2,
    })
      .then(({ data }) => setProvinces(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load provinces. Please re-select the region.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  const fetchMunicipalities = (provinceCode) => {
    setMunicipalities([]);
    setBarangays([]);
    companyForm.setFieldsValue({
      companyMunicipality: undefined,
      companyBarangay: undefined,
    });
    if (!provinceCode) return;
    setLoadingAddress("municipality");
    withRetry(
      () => api.get(`/settings/address/municipalities/${provinceCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setMunicipalities(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message:
            "Could not load municipalities. Please re-select the province.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  const fetchBarangays = (municipalityCode) => {
    setBarangays([]);
    companyForm.setFieldsValue({ companyBarangay: undefined });
    if (!municipalityCode) return;
    setLoadingAddress("barangay");
    withRetry(
      () => api.get(`/settings/address/barangays/${municipalityCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setBarangays(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message:
            "Could not load barangays. Please re-select the municipality.",
        }),
      )
      .finally(() => setLoadingAddress(""));
  };

  // ── Hauler address fetch helpers ──
  // Helper to update multiple address fields in haulerDraft at once
  const updateHaulerDraftAddr = (fields) => {
    setHaulerDraft((prev) => ({ ...prev, ...fields }));
  };
  const fetchHaulerProvinces = (regionCode) => {
    setHaulerProvinces([]);
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({
      officeProvince: "",
      officeCity: "",
      officeBarangay: "",
    });
    if (!regionCode) return;
    setLoadingHaulerAddress("province");
    withRetry(() => api.get(`/settings/address/provinces/${regionCode}`), {
      retries: 2,
    })
      .then(({ data }) => setHaulerProvinces(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load provinces.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerCities = (provinceCode) => {
    setHaulerCities([]);
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeCity: "", officeBarangay: "" });
    if (!provinceCode) return;
    setLoadingHaulerAddress("city");
    withRetry(
      () => api.get(`/settings/address/municipalities/${provinceCode}`),
      { retries: 2 },
    )
      .then(({ data }) => setHaulerCities(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load cities/municipalities.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  const fetchHaulerBarangays = (cityCode) => {
    setHaulerBarangayList([]);
    updateHaulerDraftAddr({ officeBarangay: "" });
    if (!cityCode) return;
    setLoadingHaulerAddress("barangay");
    withRetry(() => api.get(`/settings/address/barangays/${cityCode}`), {
      retries: 2,
    })
      .then(({ data }) => setHaulerBarangayList(data || []))
      .catch(() =>
        showError({
          type: "error",
          title: "Load Failed",
          message: "Could not load barangays.",
        }),
      )
      .finally(() => setLoadingHaulerAddress(""));
  };
  // Helper to get field label from settings, fallback to default
  const fl = (key, fallback) => fieldLabels[key]?.label || fallback;
  // Helper: is field required per admin settings? Falls back to defaultReq.
  const isRequired = (key, defaultReq = false) =>
    fieldLabels[key] ? fieldLabels[key].required : defaultReq;
  // Helper: get select options from settings, with fallback
  const opts = (key, fallback = []) =>
    fieldLabels[key]?.options?.length > 0 ? fieldLabels[key].options : fallback;

  const isAnnouncementActive = (settings) => {
    const now = Date.now();
    const startsAt = settings?.portalAnnouncementStartAt
      ? new Date(settings.portalAnnouncementStartAt).getTime()
      : null;
    const endsAt = settings?.portalAnnouncementEndAt
      ? new Date(settings.portalAnnouncementEndAt).getTime()
      : null;
    return (
      settings?.portalAnnouncementEnabled &&
      settings?.portalAnnouncementShowInPortal !== false &&
      (!startsAt || startsAt <= now) &&
      (!endsAt || endsAt >= now)
    );
  };

  useEffect(() => {
    fetchWithCache(
      PORTAL_SETTINGS_CACHE_KEY,
      () => api.get("/settings/app").then(({ data }) => data),
      {
        ttl: PORTAL_CACHE_TTL,
        onData: (data) => {
        setPortalSettings(data);
        setPortalAnnouncement(isAnnouncementActive(data) ? data : null);
        },
      },
    ).catch(() => {});
  }, []);

  useEffect(() => {
    if (!portalAnnouncement || !portalUser) return;
    const key = `portal-announcement-seen-${portalAnnouncement.updatedAt || portalAnnouncement._id || portalAnnouncement.portalAnnouncementTitle}`;
    if (secureStorage.sessionGet(key) === "1") return;
    secureStorage.sessionSet(key, "1");
    if (isPortalUpdateAnnouncement) {
      if (
        portalUpdateTourSeenKey &&
        secureStorage.get(portalUpdateTourSeenKey) !== "1"
      ) {
        openPortalUpdateTour();
      }
      return;
    }
    Modal.info({
      title:
        portalAnnouncement.portalAnnouncementTitle || "SLF Portal Announcement",
      content: (
        <div style={{ whiteSpace: "pre-wrap" }}>
          {portalAnnouncement.portalAnnouncementMessage}
        </div>
      ),
      okText: "Got it",
      width: 560,
    });
  }, [
    isPortalUpdateAnnouncement,
    openPortalUpdateTour,
    portalAnnouncement,
    portalUpdateTourSeenKey,
    portalUser,
  ]);

  useEffect(() => {
    if (!updateTourOpen) return;
    const stepKey = updateTourSteps[updateTourCurrent]?.key;
    if (!stepKey) return;
    if (stepKey !== "announcement") {
      setActiveMenu("data-entry");
    }
    if (stepKey === "baseline-tab" || stepKey === "baseline-actions") {
      setActiveTab("baseline");
    }
  }, [updateTourCurrent, updateTourOpen, updateTourSteps]);

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

  // Fetch SLF facility operational info
  const activeSlfId = Array.isArray(portalUser?.assignedSlf)
    ? portalUser.assignedSlf[selectedSlfIdx] || portalUser.assignedSlf[0]
    : portalUser?.assignedSlf;
  const activeSlfName = Array.isArray(portalUser?.assignedSlfName)
    ? portalUser.assignedSlfName[selectedSlfIdx] ||
      portalUser.assignedSlfName[0]
    : portalUser?.assignedSlfName;
  // How many cells the facility ACTUALLY has.
  //
  // This used to be `numberOfCell || cellStatuses.length`, which silently dropped
  // cells: when an admin added a cell (populating cellCapacities/cellNames/…)
  // without `numberOfCell` catching up, the tail of the list was truncated — and
  // when numberOfCell was unset AND cellStatuses was empty, the count came out 0
  // and Data Entry showed NO cells at all. Widen to the same Math.max the admin's
  // canonical deriveCells() uses, so the Portal and the admin always agree on how
  // many cells exist.
  // Item #3: THE single source of truth for the assigned SLF's unit of measurement.
  // Derived from the facility config (slfInfo) via the shared resolver, so every
  // portal menu/modal reads the same value and it updates automatically when the
  // admin changes the SLF unit (slfInfo re-fetches on the "facility" data-refresh).
  // Never hard-code tons/m³ for the current unit — use this instead.
  const slfUnit = resolveFacilityUnit(slfInfo);

  const baselineCalcUnit = baselineUnit || slfUnit;
  const hasCellVolumeEntries = activeCellEntries.length > 0 || closedCellEntries.length > 0;
  const sumBaselineEntryVolume = useCallback(
    (entries = []) =>
      entries.reduce((sum, entry) => {
        const converted = convertVolume(
          entry?.volume,
          entry?.unit || baselineCalcUnit,
          baselineCalcUnit,
        );
        return sum + Number(converted || 0);
      }, 0),
    [baselineCalcUnit],
  );
  const computedTotalVolumeAccepted = useMemo(() => {
    const activeVolume = sumBaselineEntryVolume(activeCellEntries);
    const closedVolume = sumBaselineEntryVolume(closedCellEntries);
    return Math.max(0, Number((activeVolume + closedVolume).toFixed(2)));
  }, [activeCellEntries, closedCellEntries, sumBaselineEntryVolume]);

  // A cell-entry total only OVERRIDES the user's Total Volume Accepted when the
  // entries actually carry volumes.
  //
  // The presence of an entry row was previously enough: adding a cell row (or
  // migrating legacy flat fields into rows) with the volume left blank made the
  // computed total 0, which overwrote a previously-entered Total Volume Accepted
  // with 0 in the form AND sent that 0 to the server — where it is a valid
  // number, so the data-loss guard correctly applied it. That is why the value
  // "disappeared" right after saving.
  const cellVolumeTotalIsAuthoritative =
    hasCellVolumeEntries && computedTotalVolumeAccepted > 0;

  useEffect(() => {
    if (!cellVolumeTotalIsAuthoritative) return;
    baselineForm.setFieldsValue({
      totalVolumeAccepted: computedTotalVolumeAccepted,
      totalVolumeAcceptedUnit: baselineCalcUnit,
    });
  }, [baselineCalcUnit, baselineForm, computedTotalVolumeAccepted, cellVolumeTotalIsAuthoritative]);

  const slfCellCount = Number(
    Math.max(
      Number(slfInfo?.numberOfCell || 0),
      slfInfo?.cellStatuses?.length || 0,
      slfInfo?.cellCapacities?.length || 0,
      slfInfo?.cellFillValues?.length || 0,
      slfInfo?.cellTypes?.length || 0,
      slfInfo?.cellNames?.length || 0,
    ),
  );

  // Cell naming precedence: the ADMIN's facility configuration is authoritative.
  //
  // This used to prefer the name copied into the baseline record, which is a
  // snapshot taken when the baseline was saved. Any baseline row saved without a
  // name (legacy flat fields migrated into entries carry neither cellName nor
  // cellIndex) therefore fell all the way through to the positional "Cell N"
  // fallback — which is why Active Cell names appeared to "reset to Cell 1"
  // after a save, and why an admin rename did not show up in the Portal.
  //
  // Order: admin's configured cellNames[index] → baseline snapshot → "Cell N".
  // Matching is by stable cellIndex only, never by array position.
  const baselineCellNameByIndex = {};
  (Array.isArray(activeCellEntries) ? activeCellEntries : []).forEach((e) => {
    if (e && typeof e.cellIndex === "number" && String(e.cellName || "").trim()) {
      baselineCellNameByIndex[e.cellIndex] = String(e.cellName).trim();
    }
  });
  const cellLabelFor = (index) => {
    const adminName = String(slfInfo?.cellNames?.[index] || "").trim();
    if (adminName) return adminName;
    return baselineCellNameByIndex[index] || resolveCellName(slfInfo, index);
  };

  /**
   * Resolve which configured cell a LEGACY flat baseline volume belongs to.
   *
   * Legacy baselines stored one number per waste type with no cell reference. To
   * migrate them into entry rows without losing identity, each volume is bound
   * to the first cell of the matching kind (hazardous/inert vs residual) with
   * the requested operational state — mirroring the server's findBestCellIndex
   * so the Portal and the backend agree on where a volume landed.
   *
   * Returns empty values when the facility declares no suitable cell, which
   * leaves the row unbound rather than pointing it at the wrong cell.
   */
  const matchBaselineCellForWasteType = useCallback(
    (baselineData, wasteType, { active = true } = {}) => {
      const empty = { cellIndex: null, cellName: "", cellType: "" };
      const count = Math.max(
        Number(slfInfo?.numberOfCell || 0),
        slfInfo?.cellStatuses?.length || 0,
        slfInfo?.cellTypes?.length || 0,
        slfInfo?.cellNames?.length || 0,
      );
      if (!count) return empty;

      const wantsHazardous = /haz|inert/i.test(String(wasteType || ""));
      let fallback = null;

      for (let index = 0; index < count; index += 1) {
        const status = slfInfo?.cellStatuses?.[index];
        if (isNonExistentCell(status)) continue;
        const isActive = getCellStatusConfig(status).key === "active";
        if (isActive !== active) continue;

        const cellType = slfInfo?.cellTypes?.[index] || "Residual";
        const candidate = {
          cellIndex: index,
          cellName: cellLabelFor(index),
          cellType,
        };
        if (/haz|inert/i.test(String(cellType)) === wantsHazardous) return candidate;
        if (!fallback) fallback = candidate;
      }

      return fallback || empty;
    },
    // cellLabelFor is derived from slfInfo + activeCellEntries on every render;
    // depending on slfInfo alone keeps this stable while still reflecting the
    // admin's current cell configuration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slfInfo],
  );

  const cellPlacementOptions = (() => {
    // Per-user cell access restriction (admin Manage Access). Empty => no restriction.
    const allowedCells = Array.isArray(portalUser?.portalAccess?.allowedCells)
      ? portalUser.portalAccess.allowedCells
          .map((c) => String(c || "").trim())
          .filter(Boolean)
      : [];
    return Array.from({ length: slfCellCount }, (_, index) => {
      const rawStatus = slfInfo?.cellStatuses?.[index];
      if (isNonExistentCell(rawStatus)) return null; // cell does not exist
      const status = normalizeCellStatus(rawStatus);
      const capUnit = resolveCellUnit(slfInfo, index, "capacity");
      const fillUnit = resolveCellUnit(slfInfo, index, "fill");
      const capacityM3 = convertVolume(slfInfo?.cellCapacities?.[index], capUnit, "m³") ?? 0;
      const fillM3 = convertVolume(slfInfo?.cellFillValues?.[index], fillUnit, "m³") ?? 0;

      const acceptance = getCellAcceptance({
        status,
        capacity: capacityM3,
        fill: fillM3,
        exists: true,
      });

      // Admin per-cell submission toggle + per-user access are additional gates
      // beyond capacity/status.
      const submissionAllowed = slfInfo?.cellSubmissionAllowed?.[index] !== false;
      const cellValue = `Cell ${index + 1}`;
      const userAllowed = allowedCells.length === 0 || allowedCells.includes(cellValue);
      const available = acceptance.ok && submissionAllowed && userAllowed;
      const disabledReason = !acceptance.ok
        ? acceptance.reason
        : !submissionAllowed
          ? "Closed for submissions"
          : !userAllowed
            ? "Not assigned to you"
            : "";

      const baseLabel = cellLabelFor(index);
      const pickerUnit = baselineUnit || capUnit || slfUnit;
      const capDisplay = convertVolume(slfInfo?.cellCapacities?.[index], capUnit, pickerUnit);
      const usedDisplay = convertVolume(slfInfo?.cellFillValues?.[index], fillUnit, pickerUnit);
      const remainingDisplay =
        capDisplay != null && usedDisplay != null
          ? Math.max(0, capDisplay - usedDisplay)
          : capDisplay != null
            ? capDisplay
            : null;
      const typeLabel = slfInfo?.cellTypes?.[index] ? ` - ${slfInfo.cellTypes[index]}` : "";
      return {
        label: available
          ? `${baseLabel}${typeLabel}`
          : cellDisabledLabel(baseLabel, { reason: disabledReason }),
        value: cellValue,
        cellType: slfInfo?.cellTypes?.[index] || "Residual",
        cellIndex: index,
        cellName: baseLabel,
        facility: activeSlfName || slfInfo?.slfName || slfInfo?.lgu || "",
        status,
        capacity: capDisplay,
        used: usedDisplay,
        remaining: remainingDisplay,
        // Remaining in m³, for the "proposed <= remaining" numeric-integrity check.
        remainingM3: acceptance.remaining,
        utilization: acceptance.utilization,
        unit: pickerUnit,
        available,
        disabled: !available,
        disabledReason,
      };
    }).filter(Boolean);
  })();

  const activeCellOptions = cellPlacementOptions.filter((o) => o.available);

  const baselineCellOptions = (() => {
    return Array.from({ length: slfCellCount }, (_, index) => {
      const rawStatus = slfInfo?.cellStatuses?.[index];
      if (isNonExistentCell(rawStatus)) return null;
      const status = normalizeCellStatus(rawStatus);
      const type = slfInfo?.cellTypes?.[index] || "Residual";
      const baseLabel = cellLabelFor(index);
      return {
        label: `${baseLabel} - ${type}${status ? ` (${status})` : ""}`,
        value: resolveCellName(slfInfo, index),
        cellType: type,
        cellIndex: index,
        status,
      };
    }).filter(Boolean);
  })();

  // ── Cell Placement organizer (item #8): let users place PAST submissions'
  // waste into open cells so their disposals are organized per cell. ──
  const [cellOrganizerOpen, setCellOrganizerOpen] = useState(false);
  const [cellOrganizerData, setCellOrganizerData] = useState([]);
  const [cellOrganizerSaving, setCellOrganizerSaving] = useState(false);
  // The organizer modal opens immediately and loads behind these.
  const [cellOrganizerLoading, setCellOrganizerLoading] = useState(false);
  const [cellOrganizerError, setCellOrganizerError] = useState(null);
  const [cellOrganizerPrompted, setCellOrganizerPrompted] = useState(false);
  // expanded card keys  (array of sub._id strings)
  const [cellOrganizerExpanded, setCellOrganizerExpanded] = useState([]);
  // checked row keys  ("subId|truckIndex|vehicleIndex" or "subId|truckIndex|t")
  const [cellOrganizerSelected, setCellOrganizerSelected] = useState([]);
  // cell value to bulk-apply to all checked rows
  const [cellOrganizerBulkCell, setCellOrganizerBulkCell] = useState(undefined);
  // Pagination for the Organize Cell Placement modal (bulk submissions).
  const [cellOrganizerPage, setCellOrganizerPage] = useState(1);
  const [cellOrganizerPageSize, setCellOrganizerPageSize] = useState(5);
  const cellOrganizerLoadingRef = useRef(false);
  const [bulkOrganizeOpen, setBulkOrganizeOpen] = useState(false);
  const [cellInfraCollapsed, setCellInfraCollapsed] = useState(true);
  const capacityAllowancePct = (() => {
    const pct = Number(portalSettings?.truckCapacityAllowancePercent);
    return Number.isFinite(pct) && pct >= 0 ? pct : 10;
  })();

  const evaluateCapacity = useCallback(
    (actualVolume, actualVolumeUnit, capacity, capacityUnit) => {
      const cap = Number(capacity || 0);
      const vol = Number(actualVolume || 0);
      if (!(cap > 0) || !(vol > 0)) {
        return { hasCapacity: cap > 0, exceeded: false, maxAllowed: null };
      }
      const volInCapUnit = convertVolume(
        vol,
        actualVolumeUnit || capacityUnit || slfUnit,
        capacityUnit || slfUnit,
      );
      const maxAllowed = cap + (cap * capacityAllowancePct) / 100;
      // Small epsilon so exact matches (e.g. 11 vs 11) are never flagged.
      return {
        hasCapacity: true,
        exceeded: volInCapUnit > maxAllowed + 1e-9,
        maxAllowed,
      };
    },
    [capacityAllowancePct],
  );

  // Effective capacity for a vehicle: its own capacity, else the parent truck's.
  const vehicleEffectiveCapacity = useCallback(
    (truck, vehicle) => ({
      capacity: vehicle?.capacity ?? truck?.truckCapacity ?? null,
      capacityUnit:
        vehicle?.capacityUnit || truck?.truckCapacityUnit || slfUnit,
    }),
    [],
  );

  const getDeclaredVehicleCapacity = useCallback(
    (haulerName, plateNumber) => {
      const plate = String(plateNumber || "").trim().toLowerCase();
      if (!plate) return null;
      const list = Array.isArray(haulers) ? haulers : [];
      const findPlate = (h) =>
        (h?.vehicles || []).find(
          (v) => String(v?.plateNumber || "").trim().toLowerCase() === plate,
        );
      const named = list.find((h) => h?.haulerName === haulerName);
      const match = (named && findPlate(named)) || list.map(findPlate).find(Boolean);
      const cap = Number(match?.capacity);
      return Number.isFinite(cap) && cap > 0 ? cap : null;
    },
    [haulers],
  );

  // Submissions with unassigned waste, INDEPENDENT of whether a cell can accept
  // it right now.
  //
  // This used to short-circuit to [] when no cell was available. The effect was
  // that the moment the active cell hit 100%, every approved-but-unassigned
  // submission silently disappeared from Organize Cells, the warning banner and
  // the pre-submit gate — the operator saw an empty organizer and no explanation,
  // and the work simply went untracked.
  //
  // Availability is an ASSIGNMENT-TIME constraint, not a visibility one: the rows
  // are always listed, and `activeCellOptions` still governs which cells may be
  // chosen, so a full cell can never be selected. See cellCapacityNotice below
  // for the warning shown in place of the old silent empty state.
  const unplacedSubmissions = useMemo(
    () => getUnplacedSubmissions(submissions),
    [submissions],
  );

  /**
   * Why waste cannot currently be placed, if that is the case.
   *
   * Drives the organizer's warning banner. `null` when at least one cell can
   * accept waste — the normal path, where no banner is shown at all.
   */
  const cellCapacityNotice = useMemo(() => {
    if (activeCellOptions.length > 0) return null;
    const blocked = cellPlacementOptions.filter((o) => !o.available);
    if (!blocked.length) return { kind: "no-cells", cells: [] };
    const full = blocked.filter((o) => /full|capacity/i.test(String(o.disabledReason || "")));
    return {
      kind: full.length ? "at-capacity" : "unavailable",
      cells: blocked.map((o) => ({ label: o.value, reason: o.disabledReason || "Unavailable" })),
    };
  }, [activeCellOptions.length, cellPlacementOptions]);

  const openCellOrganizer = async () => {
    if (!ORGANIZE_CELLS_ENABLED) return;
    if (cellOrganizerLoadingRef.current) {
      setCellOrganizerOpen(true);
      return;
    }
    cellOrganizerLoadingRef.current = true;
    setCellOrganizerData([]);
    setCellOrganizerExpanded([]);
    setCellOrganizerSelected([]);
    setCellOrganizerBulkCell(undefined);
    setCellOrganizerPage(1);
    setCellOrganizerError(null);
    setCellOrganizerLoading(true);
    setCellOrganizerOpen(true);

    try {
      const { data: full } = await api.post("/portal-auth/my-submissions/batch", {
        ids: unplacedSubmissions.map((s) => s._id),
        unassignedOnly: true,
      });
      const working = (Array.isArray(full) ? full : []).map((sub) => ({
        _id: sub._id,
        idNo: sub.idNo,
        submissionId: sub.submissionId,
        dateOfDisposal: sub.dateOfDisposal,
        lguCompanyName: sub.lguCompanyName,
        status: sub.status,
        // Each placement keeps its canonical truckIndex / vehicleIndex.
        placements: sub.placements || [],
      }));
      setCellOrganizerData(working);
    } catch (err) {
      // A 429 here means the limiter is throttling — surface a calm "try again
      // shortly" message and DO NOT auto-retry, so the modal never spins up another
      // request loop against the limiter.
      const status = err?.response?.status;
      setCellOrganizerError(
        status === 429
          ? "The server is busy right now. Please wait a few seconds and try again."
          : err.response?.data?.message ||
              "We couldn't load the submissions to organize. Please try again.",
      );
    } finally {
      cellOrganizerLoadingRef.current = false;
      setCellOrganizerLoading(false);
    }
  };

  // Assign a cell to ONE unassigned placement, addressed by its canonical
  // truckIndex/vehicleIndex (which the server preserved).
  const updateOrganizerCell = (subId, truckIndex, vehicleIndex, cellValue) => {
    const opt = activeCellOptions.find((o) => o.value === cellValue);
    const patch = {
      cellName: cellValue || "",
      cellType: opt?.cellType || "",
      cellIndex:
        opt && typeof opt.cellIndex === "number" ? opt.cellIndex : null,
    };
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
  const updateOrganizerCapacity = (subId, truckIndex, vehicleIndex, capacityValue) => {
    setCellOrganizerData((prev) =>
      prev.map((sub) => {
        if (sub._id !== subId) return sub;
        return {
          ...sub,
          placements: (sub.placements || []).map((p) =>
            p.truckIndex === truckIndex && p.vehicleIndex === vehicleIndex
              ? { ...p, capacity: capacityValue, capacityUnit: baselineUnit || p.capacityUnit || slfUnit }
              : p,
          ),
        };
      }),
    );
  };

  // Apply the bulk cell to all currently checked rows.
  const applyBulkCellToSelected = () => {
    if (!cellOrganizerBulkCell || cellOrganizerSelected.length === 0) return;
    cellOrganizerSelected.forEach((rowKey) => {
      // rowKey format: "subId|truckIndex|vehicleIndex" or "subId|truckIndex|t"
      const parts = rowKey.split("|");
      if (parts.length < 3) return;
      const subId = parts[0];
      const truckIndex = Number(parts[1]);
      const vPart = parts[2];
      const vehicleIndex = vPart === "t" ? null : Number(vPart);
      updateOrganizerCell(subId, truckIndex, vehicleIndex, cellOrganizerBulkCell);
    });
    setCellOrganizerSelected([]);
    setCellOrganizerBulkCell(undefined);
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
              const hasCell = !!p.cellName;
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
      fetchSubmissions(true);
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
    setSlfInfoLoading(true);
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
      .catch(() => {})
      .finally(() => setSlfInfoLoading(false));
    return () => ac.abort();
  }, [activeSlfId, activeSlfName, slfInfoRefresh]);

  // Fetch existing baseline when user is loaded (with retry)
  useEffect(() => {
    if (!activeSlfName) return;
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
        // Lock is decided FIRST and independently of the payload check below —
        // a baseline saved with company information only still locks.
        const lock = resolveBaselineLock(data);
        setBaselineSaved(lock.locked);
        setBaselineUpdatePending(lock.updatePending);

        if (hasBaselinePayload(data)) {
          const unit =
            data.baselineUnit || data.totalVolumeAcceptedUnit || slfUnit;
          setBaselineUnit(unit);
          setAcceptsHazardousWaste(data.acceptsHazardousWaste || false);
          baselineForm.setFieldsValue({
            baselineUnit: unit,
            totalVolumeAccepted: data.totalVolumeAccepted,
            totalVolumeAcceptedUnit: data.totalVolumeAcceptedUnit || unit,
            activeCellResidualVolume: data.activeCellResidualVolume,
            activeCellResidualUnit: data.activeCellResidualUnit || unit,
            activeCellInertVolume: data.activeCellInertVolume,
            activeCellInertUnit: data.activeCellInertUnit || unit,
            activeCellHazardousVolume: data.activeCellHazardousVolume,
            activeCellHazardousUnit: data.activeCellHazardousUnit || unit,
            closedCellResidualVolume: data.closedCellResidualVolume,
            closedCellResidualUnit: data.closedCellResidualUnit || unit,
            closedCellInertVolume: data.closedCellInertVolume,
            closedCellInertUnit: data.closedCellInertUnit || unit,
            closedCellHazardousVolume: data.closedCellHazardousVolume,
            closedCellHazardousUnit: data.closedCellHazardousUnit || unit,
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
          setActiveCellEntries([]);
          setClosedCellEntries([]);
        }
      })
      .catch(() => {})
      .finally(() => setBaselineLoading(false));
    return () => ac.abort();
    // Stable primitive deps (see slfInfo effect above) so a portalUser reference
    // change doesn't abort the in-flight baseline fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlfId, activeSlfName, baselineRefresh]);

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

  // Fetch submission history
  const pollingRef = useRef(null);
  const fetchingRef = useRef(false);

  const fetchSubmissions = useCallback(async (silent = false, force = false) => {
    if (fetchingRef.current) return; // deduplicate concurrent requests
    fetchingRef.current = true;
    if (!silent) setLoadingSubmissions(true);
    try {
      await fetchWithCache(
        `${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`,
        () => api.get("/portal-auth/my-submissions", {
          headers: {
            Authorization: `Bearer ${secureStorage.get("portal_token")}`,
          },
        }).then(({ data }) => data),
        {
          ttl: PORTAL_CACHE_TTL,
          force,
          onData: (data) => setSubmissions(Array.isArray(data) ? data : []),
        },
      );
    } catch {
      // Surface load failures so the table doesn't stay stuck silently
      if (!silent) {
        showError({
          type: "error",
          title: "Could Not Load Records",
          message:
            "We couldn't load your submission records. Please check your connection and tap Refresh to try again.",
        });
      }
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoadingSubmissions(false);
    }
  }, [portalUser?.email]);

  useEffect(() => {
    if ((activeMenu === "history" || activeMenu === "overview") && portalUser) {
      // Force-refresh when entering the history tab so status changes from admin are immediate
      invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
      fetchSubmissions(false, true);
      // Real-time refresh via socket + fallback 60s polling
      const sock = connectSocket("portal", portalUser.email);
      const handler = () => {
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        invalidateCache(`${PORTAL_WASTE_RECEIVED_CACHE_KEY}:${activeSlfId || activeSlfName}`);
        fetchSubmissions(true);
      };
      sock.on("notification", handler);
      sock.on("data-refresh", handler);
      pollingRef.current = setInterval(() => {
        if (navigator.onLine) fetchSubmissions(true);
      }, 60000);
      return () => {
        sock.off("notification", handler);
        sock.off("data-refresh", handler);
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // Depend on portalUser.email (a stable primitive), NOT the whole portalUser
    // object. portalUser changes reference several times on mount (localStorage
    // load → /me refresh, doubled by StrictMode); depending on the object made
    // this effect tear down and re-run each time, firing redundant force-refresh
    // my-submissions fetches and reconnecting the socket + resetting the poll —
    // which flickered and reloaded the overview KPIs/charts on every mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMenu, activeSlfId, activeSlfName, portalUser?.email, fetchSubmissions]);

  // When coming back online while on history tab, refresh immediately
  useEffect(() => {
    if (isOnline && (activeMenu === "history" || activeMenu === "overview") && portalUser) {
      fetchSubmissions(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, activeMenu, portalUser?.email, fetchSubmissions]);

  // VERA contextual runtime nudge: gently remind the user when submissions were
  // reverted for correction. Dispatched to the mounted VeraChat, which throttles
  // it to once per browser session and keeps it non-intrusive.
  useEffect(() => {
    if (!Array.isArray(submissions) || submissions.length === 0) return;
    const reverted = submissions.filter((s) => String(s?.status || "").toLowerCase().includes("revert")).length;
    if (reverted > 0) {
      window.dispatchEvent(new CustomEvent("vera:nudge", {
        detail: {
          id: "portal_reverted",
          text: `You have ${reverted} submission${reverted === 1 ? "" : "s"} reverted for correction. Would you like me to guide you through resubmitting?`,
          cta: true,
        },
      }));
    }
  }, [submissions]);

  // Item #4: admin → portal-user messages. Fetch the user's active (undismissed)
  // messages once after login, then receive new ones in real time over the portal
  // socket room (no polling). Only ever the intended user's own messages.
  useEffect(() => {
    if (!portalUser?.email || isDeveloperContext) return undefined;
    let cancelled = false;
    api
      .get("/portal-messages/mine")
      .then(({ data }) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setPortalMessages(list);
      })
      .catch(() => {});
    const sock = connectSocket("portal", portalUser.email);
    const onMessage = (payload) => {
      if (!payload || !payload._id) return;
      // De-dupe by id so a refresh + real-time echo of the same message never
      // queues twice.
      setPortalMessages((prev) => (prev.some((m) => m._id === payload._id) ? prev : [...prev, payload]));
    };
    sock.on("portal-message", onMessage);
    return () => {
      cancelled = true;
      sock.off("portal-message", onMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalUser?.email, isDeveloperContext]);

  // Dismiss (mark read for the session) or "Do Not Show Again" (permanent) — both
  // owner-guarded server-side. Removes it from the visible list either way.
  const dismissPortalMessage = async (id, permanent) => {
    try {
      await api.patch(`/portal-messages/${id}/${permanent ? "dismiss" : "read"}`);
    } catch {
      /* best-effort — still hide locally so the user isn't stuck */
    }
    setPortalMessages((prev) => prev.filter((m) => m._id !== id));
  };

  const msgShowingRef = useRef(false);
  useEffect(() => {
    if (isDeveloperContext || msgShowingRef.current) return;
    const msg = portalMessages[0];
    if (!msg) return;
    msgShowingRef.current = true;
    const esc = (s) =>
      String(s ?? "").replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      ));
    const when = msg.createdAt ? dayjs(msg.createdAt).format("MMM D, YYYY h:mm A") : "";
    Swal.fire({
      icon: "info",
      title: esc(msg.title || "Message from EMB Region III"),
      html:
        `<div style="text-align:left">` +
        `<div style="white-space:pre-wrap;word-break:break-word">${esc(msg.message)}</div>` +
        `<div style="margin-top:12px;font-size:12px;color:#888">` +
        `${esc(msg.senderName || "EMB Region III")}${when ? ` &middot; ${esc(when)}` : ""}</div>` +
        `</div>`,
      showDenyButton: true,
      confirmButtonText: "Dismiss",
      denyButtonText: "Do Not Show Again",
      confirmButtonColor: "#1a3353",
      denyButtonColor: "#8c8c8c",
      allowOutsideClick: false,
      focusConfirm: true,
    }).then(async (result) => {
      // Deny = permanent ("Do Not Show Again"); Confirm/Dismiss = read for now.
      await dismissPortalMessage(msg._id, result.isDenied === true);
      msgShowingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalMessages, isDeveloperContext]);

  useEffect(() => {
    if (!portalUser?.email) return undefined;
    const sock = connectSocket("portal", portalUser.email);
    const onFacilityRefresh = (payload) => {
      const target = payload?.target;
      if (target === "app-settings") {
        invalidateCache(PORTAL_SETTINGS_CACHE_KEY);
        api
          .get("/settings/app")
          .then(({ data }) => setPortalSettings(data))
          .catch(() => {});
        return;
      }
      if (!target || ["facility", "submissions", "baselines"].includes(target)) {
        setSlfInfoRefresh((n) => n + 1);
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        fetchSubmissions(true);
      }
      // The baseline record itself (and with it the approval / lock state the Data
      // Entry form gates on) was NOT reloaded here — only slfInfo and the submission
      // list were. So an admin approving a baseline update left the portal showing
      // "Pending" until the page was reloaded by hand. Re-run the baseline fetch on
      // any baseline-affecting refresh.
      if (!target || ["baselines", "facility"].includes(target)) {
        setBaselineRefresh((n) => n + 1);
      }
    };
    sock.on("data-refresh", onFacilityRefresh);
    return () => sock.off("data-refresh", onFacilityRefresh);
  }, [portalUser?.email, fetchSubmissions]);

  // ── My Requests fetch ──
  // Requests panel data.
  //
  // Reads a PURPOSE-BUILT, index-backed endpoint (GET /transactions/my-requests)
  // instead of the generic admin search. The old call
  // (`/transactions?search=<email>&limit=100`) ran a case-insensitive regex over
  // four unindexed fields — a scan of the whole audit log, executed twice — and
  // then discarded almost every row client-side, which is why opening Requests
  // and pressing Refresh were both slow.
  //
  // The dependency is the EMAIL, not the portalUser object: depending on the
  // object made this callback (and therefore the socket effect below) re-create
  // on every unrelated portalUser re-render, re-subscribing and re-fetching.
  const portalEmail = portalUser?.email || "";
  const fetchMyRequests = useCallback(async () => {
    if (!portalEmail) return;
    setMyRequestsLoading(true);
    try {
      const { data } = await api.get("/transactions/my-requests", {
        params: { email: portalEmail },
      });
      setMyRequests(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch {
      /* silent */
    } finally {
      setMyRequestsLoading(false);
    }
  }, [portalEmail]);

  useEffect(() => {
    if (activeMenu !== "requests" || !portalEmail) return undefined;
    fetchMyRequests();

    const sock = connectSocket("portal", portalEmail);
    // A single admin action can emit several events in quick succession; without
    // coalescing, each one fired its own request. One refresh per burst instead.
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(fetchMyRequests, 400);
    };
    sock.on("notification", handler);
    sock.on("data-refresh", handler);
    return () => {
      clearTimeout(timer);
      sock.off("notification", handler);
      sock.off("data-refresh", handler);
    };
  }, [activeMenu, portalEmail, fetchMyRequests]);

  const handleLogout = () => {
    secureStorage.clearAll();
    navigate("/slfportal/login");
  };

  // ── Truck helpers (no <Form>, just state) ──

  const updateTruckDraft = (field, value) => {
    setTruckDraft((prev) => ({ ...prev, [field]: value }));
    if (truckErrors[field]) {
      setTruckErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const validateTruck = () => {
    const errs = {};
    if (!truckDraft.disposalTicketNo?.trim())
      errs.disposalTicketNo = "Required";
    if (isRequired("hauler", true) && !truckDraft.hauler?.trim())
      errs.hauler = "Required";
    const vehicles = (truckDraft.vehicles || []).filter(
      (v) => v.plateNumber?.trim() || v.actualVolume != null,
    );
    if (
      isRequired("plateNumber", true) &&
      !(truckDraft.vehicles || []).some((v) => v.plateNumber?.trim())
    )
      errs.plateNumber = "At least one vehicle plate number is required";
    // Per-vehicle waste placement validation.
    const vehicleErrors = [];
    (truckDraft.vehicles || []).forEach((v, idx) => {
      const hasPlate = v.plateNumber?.trim();
      // Only validate vehicles that the user actually started filling in.
      if (!hasPlate && v.actualVolume == null && !v.wasteType && !v.cellName)
        return;
      const vehErr = {};
      if (isRequired("wasteType", true) && !v.wasteType)
        vehErr.wasteType = "Select waste type";
      if (
        isRequired("actualVolume", true) &&
        !v.actualVolume &&
        v.actualVolume !== 0
      )
        vehErr.actualVolume = "Enter the waste volume";
      if (activeCellOptions.length > 0 && !v.cellName?.trim())
        vehErr.cellName = "Assign a disposal cell";
      if (
        isTreatedHazardousWaste(v.wasteType) &&
        !hasHazardousWasteCode(v.hazWasteCode)
      )
        vehErr.hazWasteCode = "Hazardous code required";
      // Truck capacity exceedance (with configurable allowance).
      const { capacity, capacityUnit } = vehicleEffectiveCapacity(truckDraft, v);
      const cap = evaluateCapacity(
        v.actualVolume,
        v.actualVolumeUnit,
        capacity,
        capacityUnit,
      );
      if (cap.exceeded) {
        vehErr.actualVolume = `Waste volume exceeds the allowed truck capacity (max ${Number(
          cap.maxAllowed.toFixed(2),
        )} ${(capacityUnit || slfUnit).replace("m3", "m³")} at ${capacityAllowancePct}% allowance).`;
      }
      // Strict +10% elevation cap: the ENTERED capacity may not exceed the
      // declared/registered capacity for this plate by more than 10%. No override.
      const declaredCap = getDeclaredVehicleCapacity(truckDraft.hauler, v.plateNumber);
      if (
        declaredCap != null &&
        v.capacity != null &&
        v.capacity !== "" &&
        Number(v.capacity) >
          declaredCap * TRUCK_CAPACITY_ELEVATION_FACTOR + 1e-9
      ) {
        vehErr.capacity = `Truck Capacity exceeds the allowed maximum ${Number(
          (declaredCap * TRUCK_CAPACITY_ELEVATION_FACTOR).toFixed(2),
        )} (declared ${declaredCap} + 10%).`;
      }
      if (Object.keys(vehErr).length) vehicleErrors[idx] = vehErr;
    });
    if (vehicleErrors.length) {
      errs.vehicles = vehicleErrors;
      errs.plateNumber =
        errs.plateNumber ||
        "Complete the waste volume, type and disposal cell for each vehicle.";
    }
    if (vehicles.length === 0 && isRequired("actualVolume", true)) {
      errs.plateNumber = "Add at least one vehicle with its waste volume.";
    }
    // Validate additional transport fields from Portal Field Settings
    extraTransportFields.forEach((f) => {
      if (f.required) {
        const val = truckDraft[f.fieldKey];
        if (val === undefined || val === null || val === "") {
          errs[f.fieldKey] = "Required";
        }
      }
    });
    setTruckErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Centralized block guard (organizeCellsValidation): when past submissions
  // still need organizing, surface the detailed warning and offer the organizer.
  // Returns true when the action must be blocked. Used by the Add Transport Entry
  // guard and the pre-submit gate so the rule and message live in one place.
  const blockedByUnorganized = (actionLabel = "submit new entries") => {
    if (!ORGANIZE_CELLS_ENABLED || unplacedSubmissions.length === 0) return false;
    Swal.fire({
      icon: "warning",
      title: "Organize Past Submissions First",
      html:
        `You must complete your past submissions in <b>Organize Cells</b> before you can ${actionLabel}:` +
        formatOrganizeWarningHtml(unplacedSubmissions, baselineUnit || slfUnit),
      width: 620,
      showCancelButton: true,
      confirmButtonText: "Organize Now",
      cancelButtonText: "Later",
      confirmButtonColor: "#722ed1",
    }).then((result) => {
      if (result.isConfirmed) openCellOrganizer();
    });
    return true;
  };

  const handleAddTruck = () => {
    // Block creating a NEW transport entry while past submissions remain
    // unorganized (editing an existing draft row is still allowed).
    if (!editingTruckKey && blockedByUnorganized("add new transport entries")) {
      return;
    }
    // Block creating a NEW entry when no cell can accept waste.
    if (!editingTruckKey && allCellsUnavailable) {
      showError({
        type: "error",
        title: "No Available SLF Cell",
        message: NO_AVAILABLE_CELL_MESSAGE,
      });
      return;
    }
    if (!validateTruck()) return;
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...truckDraft } : t,
        ),
      );
      setEditingTruckKey(null);
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...truckDraft }]);
    }
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

  const removeTruck = (key) => {
    setTrucks((prev) => prev.filter((t) => t.key !== key));
    setSelectedTruckKeys((prev) => prev.filter((k) => k !== key));
  };

  // Assign every currently-selected truck entry to a chosen disposal cell.
  const assignSelectedTrucksToCell = (cellValue) => {
    if (!cellValue || selectedTruckKeys.length === 0) return;
    const opt = activeCellOptions.find((o) => o.value === cellValue);
    setTrucks((prev) =>
      prev.map((t) =>
        selectedTruckKeys.includes(t.key)
          ? {
              ...t,
              cellName: cellValue,
              cellType: opt?.cellType ?? t.cellType ?? "",
              cellIndex:
                opt && typeof opt.cellIndex === "number"
                  ? opt.cellIndex
                  : t.cellIndex ?? null,
              // Keep any per-vehicle placements consistent with the truck cell.
              vehicles: (t.vehicles || []).map((v) => ({
                ...v,
                cellName: cellValue,
                cellType: opt?.cellType ?? v.cellType ?? "",
                cellIndex:
                  opt && typeof opt.cellIndex === "number"
                    ? opt.cellIndex
                    : v.cellIndex ?? null,
              })),
            }
          : t,
      ),
    );
    setSelectedTruckKeys([]);
    setTruckBulkCell(undefined);
  };

  // Keep the Transport & Disposal pagination in range as entries are added/removed.
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(trucks.length / truckPageSize));
    if (truckPage > maxPage) setTruckPage(maxPage);
  }, [trucks.length, truckPageSize, truckPage]);

  // ── Hauler helpers ──

  const updateHaulerDraft = (field, value) => {
    setHaulerDraft((prev) => {
      const next = { ...prev, [field]: value };
      // When numberOfTrucks changes, resize vehicles array
      if (field === "numberOfTrucks") {
        const count = Math.max(0, Math.min(value || 0, 50));
        const current = prev.vehicles || [];
        const vehicles = [];
        for (let i = 0; i < count; i++) {
          vehicles.push(current[i] || { ...EMPTY_VEHICLE });
        }
        next.vehicles = vehicles;
      }
      return next;
    });
    if (haulerErrors[field]) {
      setHaulerErrors((prev) => {
        const c = { ...prev };
        delete c[field];
        return c;
      });
    }
  };

  const updateVehicle = (index, field, value) => {
    setHaulerDraft((prev) => {
      const vehicles = [...(prev.vehicles || [])];
      vehicles[index] = { ...vehicles[index], [field]: value };
      return { ...prev, vehicles };
    });
  };

  const validateHauler = () => {
    const errs = {};
    if (!haulerDraft.haulerName?.trim()) errs.haulerName = "Required";
    if (!haulerDraft.numberOfTrucks && haulerDraft.numberOfTrucks !== 0)
      errs.numberOfTrucks = "Required";
    setHaulerErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const openHaulerModal = (record) => {
    setHaulerProvinces([]);
    setHaulerCities([]);
    setHaulerBarangayList([]);
    if (record) {
      setEditingHaulerKey(record.key);
      // Migrate legacy single-vehicle data to vehicles array
      let vehicles = Array.isArray(record.vehicles) ? [...record.vehicles] : [];
      if (
        vehicles.length === 0 &&
        (record.plateNumber || record.vehicleType || record.capacity != null)
      ) {
        vehicles = [
          {
            plateNumber: record.plateNumber || "",
            vehicleType: record.vehicleType || "",
            capacity: record.capacity,
            capacityUnit: record.capacityUnit || slfUnit,
          },
        ];
      }
      const count = record.numberOfTrucks || vehicles.length || 0;
      // Ensure vehicles array matches numberOfTrucks
      while (vehicles.length < count) vehicles.push({ ...EMPTY_VEHICLE });
      if (vehicles.length > count && count > 0)
        vehicles = vehicles.slice(0, count);
      setHaulerDraft({
        haulerName: record.haulerName || "",
        numberOfTrucks: count || null,
        officeAddress: record.officeAddress || "",
        officeRegion: record.officeRegion || "",
        officeProvince: record.officeProvince || "",
        officeCity: record.officeCity || "",
        officeBarangay: record.officeBarangay || "",
        vehicles,
        privateSectorClients: Array.isArray(record.privateSectorClients)
          ? record.privateSectorClients
          : record.privateSectorClients
            ? [record.privateSectorClients]
            : [],
      });
      // Pre-load cascading address lists
      if (record.officeRegion) {
        withRetry(
          () => api.get(`/settings/address/provinces/${record.officeRegion}`),
          { retries: 2 },
        )
          .then(({ data }) => {
            setHaulerProvinces(data || []);
            if (record.officeProvince) {
              withRetry(
                () =>
                  api.get(
                    `/settings/address/municipalities/${record.officeProvince}`,
                  ),
                { retries: 2 },
              )
                .then(({ data: d2 }) => {
                  setHaulerCities(d2 || []);
                  if (record.officeCity) {
                    withRetry(
                      () =>
                        api.get(
                          `/settings/address/barangays/${record.officeCity}`,
                        ),
                      { retries: 2 },
                    )
                      .then(({ data: d3 }) => setHaulerBarangayList(d3 || []))
                      .catch(() => {});
                  }
                })
                .catch(() => {});
            }
          })
          .catch(() => {});
      }
    } else {
      setEditingHaulerKey(null);
      setHaulerDraft({ ...EMPTY_HAULER });
    }
    setHaulerErrors({});
    setHaulerModalOpen(true);
  };

  const handleSaveHauler = () => {
    if (!validateHauler()) return;
    // Build a human-readable officeAddress from selected codes
    const regionName =
      regions.find((r) => r.code === haulerDraft.officeRegion)?.name ||
      haulerDraft.officeRegion ||
      "";
    const provinceName =
      haulerProvinces.find((p) => p.code === haulerDraft.officeProvince)
        ?.name ||
      haulerDraft.officeProvince ||
      "";
    const cityName =
      haulerCities.find((c) => c.code === haulerDraft.officeCity)?.name ||
      haulerDraft.officeCity ||
      "";
    const barangayName =
      haulerBarangayList.find((b) => b.code === haulerDraft.officeBarangay)
        ?.name ||
      haulerDraft.officeBarangay ||
      "";
    const addressParts = [
      barangayName,
      cityName,
      provinceName,
      regionName,
    ].filter(Boolean);
    const resolvedAddress = addressParts.join(", ");
    const finalDraft = normalizeHaulerRecord(
      { ...haulerDraft, officeAddress: resolvedAddress },
      0,
      baselineUnit || slfUnit,
    );
    if (editingHaulerKey) {
      setHaulers((prev) =>
        mergeHaulersByName(
          prev.map((h) =>
            h.key === editingHaulerKey ? { ...h, ...finalDraft } : h,
          ),
          baselineUnit || slfUnit,
        ),
      );
    } else {
      setHaulers((prev) =>
        mergeHaulersByName(
          [...prev, { key: Date.now(), ...finalDraft }],
          baselineUnit || slfUnit,
        ),
      );
    }
    setHaulerModalOpen(false);
    setEditingHaulerKey(null);
    setHaulerDraft({ ...EMPTY_HAULER });
    setHaulerErrors({});
  };

  const removeHauler = (key) => {
    setHaulers((prev) => prev.filter((h) => h.key !== key));
  };

  // ── Truck modal helpers ──

  const openTruckModal = (record) => {
    if (record) {
      setEditingTruckKey(record.key);
      // Migrate older entry-level waste fields into the first vehicle so the
      // per-vehicle editor shows existing data when editing legacy entries.
      const migrateVehicle = (v, i, isFirst) => ({
        ...EMPTY_VEHICLE,
        ...v,
        key: Date.now() + i,
        actualVolume:
          v.actualVolume != null
            ? v.actualVolume
            : isFirst
              ? record.actualVolume ?? null
              : null,
        actualVolumeUnit:
          v.actualVolumeUnit ||
          (isFirst ? record.actualVolumeUnit : null) ||
          baselineUnit ||
          "m³",
        wasteType: v.wasteType || (isFirst ? record.wasteType : undefined),
        hazWasteCode:
          (v.hazWasteCode && v.hazWasteCode.length
            ? v.hazWasteCode
            : isFirst
              ? record.hazWasteCode
              : []) || [],
        cellName: v.cellName || (isFirst ? record.cellName : "") || "",
        cellType: v.cellType || (isFirst ? record.cellType : "") || "",
        cellIndex:
          typeof v.cellIndex === "number"
            ? v.cellIndex
            : isFirst && typeof record.cellIndex === "number"
              ? record.cellIndex
              : null,
      });
      const draft = {
        disposalTicketNo: record.disposalTicketNo || "",
        hauler: record.hauler || "",
        plateNumber: record.plateNumber || "",
        truckCapacity: record.truckCapacity,
        truckCapacityUnit: record.truckCapacityUnit || baselineUnit || slfUnit,
        vehicles:
          record.vehicles?.length > 0
            ? record.vehicles.map((v, i) => migrateVehicle(v, i, i === 0))
            : record.plateNumber
              ? [
                  migrateVehicle(
                    {
                      plateNumber: record.plateNumber,
                      capacity: record.truckCapacity,
                      capacityUnit:
                        record.truckCapacityUnit || baselineUnit || slfUnit,
                    },
                    0,
                    true,
                  ),
                ]
              : [
                  {
                    ...EMPTY_VEHICLE,
                    key: Date.now(),
                    capacityUnit: baselineUnit || slfUnit,
                  },
                ],
        actualVolume: record.actualVolume,
        actualVolumeUnit: record.actualVolumeUnit || baselineUnit || slfUnit,
        wasteType: record.wasteType,
        hazWasteCode: record.hazWasteCode,
        cellName: record.cellName || "",
        cellType: record.cellType || "",
        cellIndex:
          typeof record.cellIndex === "number" ? record.cellIndex : null,
      };
      // Populate additional transport fields from record
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] =
          record[f.fieldKey] ?? (f.fieldType === "number" ? null : "");
      });
      setTruckDraft(draft);
    } else {
      setEditingTruckKey(null);
      const draft = {
        ...EMPTY_TRUCK,
        truckCapacityUnit: baselineUnit || slfUnit,
        actualVolumeUnit: baselineUnit || slfUnit,
        vehicles: [
          {
            ...EMPTY_VEHICLE,
            key: Date.now(),
            capacityUnit: baselineUnit || slfUnit,
          },
        ],
      };
      // Initialize additional transport fields with defaults
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] = f.fieldType === "number" ? null : "";
      });
      setTruckDraft(draft);
    }
    setTruckErrors({});
    setTruckModalOpen(true);
  };

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
    const declared = normalizeUnit(baselineUnit || slfUnit);
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
    });
    setOpen(true);
  };

  // ── Active Cell Entry helpers ──
  const handleSaveActiveCellEntry = () => {
    if (
      !activeCellDraft.cellName ||
      !activeCellDraft.wasteType ||
      activeCellDraft.volume == null
    ) {
      return;
    }
    if (editingActiveCellKey != null) {
      setActiveCellEntries((prev) =>
        prev.map((e) =>
          e.key === editingActiveCellKey
            ? {
                ...activeCellDraft,
                unit: normalizeUnit(
                  activeCellDraft.unit || baselineUnit || slfUnit,
                ),
                key: editingActiveCellKey,
              }
            : e,
        ),
      );
    } else {
      setActiveCellEntries((prev) => [
        ...prev,
        {
          ...activeCellDraft,
          unit: normalizeUnit(activeCellDraft.unit || baselineUnit || slfUnit),
          key: Date.now(),
        },
      ]);
    }
    setActiveCellModalOpen(false);
  };

  // ── Closed Cell Entry helpers ──
  const handleSaveClosedCellEntry = () => {
    if (
      !closedCellDraft.cellName ||
      !closedCellDraft.wasteType ||
      closedCellDraft.volume == null
    ) {
      return;
    }
    if (editingClosedCellKey != null) {
      setClosedCellEntries((prev) =>
        prev.map((e) =>
          e.key === editingClosedCellKey
            ? {
                ...closedCellDraft,
                unit: normalizeUnit(
                  closedCellDraft.unit || baselineUnit || slfUnit,
                ),
                key: editingClosedCellKey,
              }
            : e,
        ),
      );
    } else {
      setClosedCellEntries((prev) => [
        ...prev,
        {
          ...closedCellDraft,
          unit: normalizeUnit(closedCellDraft.unit || baselineUnit || slfUnit),
          key: Date.now(),
        },
      ]);
    }
    setClosedCellModalOpen(false);
  };

  // ── Hauler Client helpers ──
  const handleSaveClient = () => {
    if (!clientDraft.clientName || !clientDraft.clientType) {
      Swal.fire("Missing details", "Client name and type are required.", "warning");
      return;
    }
    // Province is required so the client can be classified within/outside Region 3.
    if (!clientDraft.province) {
      Swal.fire("Province required", "Select the client's province so it can be classified for Region 3.", "warning");
      return;
    }
    // Resolve PSGC codes to human-readable names for LGU type
    const regionName =
      (regions || []).find((r) => String(r.code) === clientDraft.region)
        ?.name || "";
    const provinceName =
      (clientProvinces || []).find(
        (p) => String(p.code) === clientDraft.province,
      )?.name || "";
    const municipalityName =
      (clientMunicipalities || []).find(
        (m) => String(m.code) === clientDraft.municipality,
      )?.name || "";
    const toSave = {
      ...clientDraft,
      regionName,
      provinceName,
      municipalityName,
    };
    const existing = haulerDraft.privateSectorClients || [];
    if (editingClientKey != null) {
      updateHaulerDraft(
        "privateSectorClients",
        existing.map((c) =>
          c.key === editingClientKey ? { ...toSave, key: editingClientKey } : c,
        ),
      );
    } else {
      updateHaulerDraft("privateSectorClients", [
        ...existing,
        { ...toSave, key: Date.now() },
      ]);
    }
    setClientModalOpen(false);
  };

  // ── Export Hauler Data (client-side, scoped to THIS portal user's loaded
  //    baseline) → one flat row per hauler-client relationship. CSV with UTF-8
  //    BOM (preserves PH characters) and formula-injection-safe cells. ──
  const HAULER_EXPORT_HEADERS = ["Hauler Name", "Hauler Office Address", "Client Ref", "Client Name", "Client Type", "Client Address", "Region", "Province", "City/Municipality"];
  const csvCell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralize spreadsheet formulas
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const downloadCsv = (rows, name) => {
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  const exportHaulerData = () => {
    const rows = [HAULER_EXPORT_HEADERS];
    (haulers || []).forEach((h) => {
      const clients = h.privateSectorClients || [];
      if (!clients.length) { rows.push([h.haulerName || "", h.officeAddress || "", "", "", "", "", "", "", ""]); return; }
      clients.forEach((c) => rows.push([
        h.haulerName || "", h.officeAddress || "", c.key || "", c.clientName || "", c.clientType || "", c.clientAddress || c.address || [c.municipalityName || c.municipality, c.provinceName || c.province, c.regionName || c.region].filter(Boolean).join(", "),
        c.regionName || c.region || "", c.provinceName || c.province || "", c.municipalityName || c.municipality || "",
      ]));
    });
    const who = String(portalUser?.companyName || portalUser?.email || "portal").replace(/[^a-z0-9]+/gi, "_");
    downloadCsv(rows, `hauler-data_${who}_${new Date().toISOString().slice(0, 10)}.csv`);
  };
  const downloadHaulerTemplate = () => downloadCsv([HAULER_EXPORT_HEADERS], "hauler-data_template.csv");

  const handleSaveTruck = () => {
    if (!validateTruck()) return;
    // Every transport-entry unit is forced to the SLF's declared baseline unit so
    // an entry can never carry a mismatched unit (see validateTransportUnits).
    const entryUnit = baselineUnit || slfUnit;
    // Flatten first vehicle into top-level fields for backward compat
    const vehicles = (truckDraft.vehicles || []).map(({ key, ...rest }) => ({
      ...rest,
      capacityUnit: entryUnit,
      actualVolumeUnit: entryUnit,
    }));
    const first = vehicles[0] || {};
    // Derive entry-level totals from the per-vehicle waste placements so that
    // downstream summaries (which read truck-level fields) stay correct.
    const filledVehicles = vehicles.filter(
      (v) => v.plateNumber || v.actualVolume != null,
    );
    const totalVolume = filledVehicles.reduce(
      (sum, v) => sum + Number(v.actualVolume || 0),
      0,
    );
    const anyHaz = filledVehicles.some((v) =>
      String(v.wasteType || "").toLowerCase().includes("hazard"),
    );
    const representativeWasteType =
      filledVehicles.find((v) => v.wasteType)?.wasteType ||
      truckDraft.wasteType ||
      undefined;
    const unionHazCodes = [
      ...new Set(filledVehicles.flatMap((v) => v.hazWasteCode || [])),
    ];
    const savedDraft = {
      ...truckDraft,
      plateNumber: first.plateNumber || truckDraft.plateNumber || "",
      truckCapacity: first.capacity ?? truckDraft.truckCapacity,
      truckCapacityUnit: entryUnit,
      // Entry-level rollups derived from vehicles
      actualVolume: filledVehicles.length ? totalVolume : truckDraft.actualVolume,
      actualVolumeUnit: entryUnit,
      wasteType: anyHaz ? "Treated Hazardous Waste" : representativeWasteType,
      hazWasteCode: unionHazCodes,
      cellName: first.cellName || "",
      cellType: first.cellType || "",
      cellIndex:
        typeof first.cellIndex === "number" ? first.cellIndex : null,
      vehicles,
    };
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...savedDraft } : t,
        ),
      );
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...savedDraft }]);
    }
    setTruckModalOpen(false);
    setEditingTruckKey(null);
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

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
      fetchSubmissions();
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

      await api.patch(
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

      setBaselineSaved(true);
      setBaselineUpdatePending(false);
      // Re-read the saved baseline so the Active/Closed Cell tables (and the
      // totals derived from them) show what was persisted, immediately — the same
      // values a page reload would produce.
      setBaselineRefresh((n) => n + 1);

      Swal.fire({
        icon: "success",
        title: "Baseline Updated!",
        text: "Your baseline data has been saved and locked successfully.",
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
      handleOpenWasteReceived({ openModal: false });
    }
  }, [activeMenu, activeSlfId, activeSlfName]);

  // ── Support Ticket Functions ──
  const fetchSupportTickets = useCallback(async (options = {}) => {
    if (!portalUser?.email) return;
    const nextPage = options.page || supportTicketPagination.current;
    const nextPageSize = options.pageSize || supportTicketPagination.pageSize;
    const nextSearch = options.search ?? supportTicketSearch;
    const nextSorter = options.sorter || supportTicketSorter;
    setSupportLoading(true);
    try {
      const { data } = await api.get(
        `/support-tickets/my-tickets/${encodeURIComponent(portalUser.email)}`,
        {
          params: {
            page: nextPage,
            limit: nextPageSize,
            search: nextSearch || undefined,
            sortField: nextSorter.field || "createdAt",
            sortOrder: nextSorter.order || "descend",
          },
        },
      );
      const rows = Array.isArray(data) ? data : data.tickets || [];
      setSupportTickets(
        rows.filter((ticket) => !isTestAdminNotice(ticket)),
      );
      setSupportTicketPagination({
        current: Array.isArray(data) ? nextPage : data.page || nextPage,
        pageSize: Array.isArray(data) ? nextPageSize : data.limit || nextPageSize,
        total: Array.isArray(data) ? rows.length : data.total || rows.length,
      });
      setSupportTicketSearch(nextSearch);
      setSupportTicketSorter(nextSorter);
    } catch {
      /* silent */
    } finally {
      setSupportLoading(false);
    }
  }, [portalUser?.email, supportTicketPagination.current, supportTicketPagination.pageSize, supportTicketSearch, supportTicketSorter]);

  const fetchPortalNotifications = useCallback(async () => {
    if (!portalUser?.email) return;
    const recipients = [
      ...new Set([portalUser.email, portalUser._id].filter(Boolean)),
    ];
    try {
      const responses = await Promise.all(
        recipients.map((recipient) =>
          api.get(`/notifications/${encodeURIComponent(recipient)}`, {
            params: {
              limit: 100,
            },
          }),
        ),
      );
      const notificationMap = new Map();
      responses.forEach(({ data }) => {
        (data.notifications || []).forEach((notification) => {
          if (!isTestAdminNotice(notification)) {
            notificationMap.set(notification._id, notification);
          }
        });
      });
      const notifications = Array.from(notificationMap.values()).sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      );
      setPortalNotifications(notifications);
      setPortalUnreadCount(
        notifications.filter((notification) => !notification.read).length,
      );
    } catch {
      /* silent */
    }
  }, [portalUser?.email, portalUser?._id]);

  const isMessageNotification = (notification = {}) =>
    ["admin_message", "message_from_admin"].includes(notification.type) ||
    (notification.type === "support_ticket_reply" &&
      /message from admin|admin sent you a message|admin replied/i.test(
        `${notification.title || ""} ${notification.message || ""}`,
      ));

  const isSupportNotification = (notification = {}) =>
    notification.type === "support_ticket_reply" &&
    !isMessageNotification(notification);

  const getPortalNotificationMeta = (notification = {}) => {
    if (isMessageNotification(notification)) {
      return {
        label: "Admin Message",
        color: "blue",
        icon: <MessageOutlined />,
        action: "messages",
      };
    }
    if (isSupportNotification(notification)) {
      return {
        label: "Support Ticket",
        color: "purple",
        icon: <CustomerServiceOutlined />,
        action: "support",
      };
    }
    if (
      [
        "reverted",
        "status_change",
        "submission_edit_approved",
        "submission_edit_rejected",
      ].includes(notification.type)
    ) {
      const rejected = /rejected|reverted/i.test(
        `${notification.type} ${notification.title || ""}`,
      );
      return {
        label: rejected ? "Submission Update" : "Submission Status",
        color: rejected ? "red" : "green",
        icon: rejected ? <CloseCircleOutlined /> : <HistoryOutlined />,
        action: "history",
      };
    }
    if (
      ["baseline_update_approved", "baseline_update_rejected"].includes(
        notification.type,
      )
    ) {
      return {
        label: "Request Update",
        color: "geekblue",
        icon: <AuditOutlined />,
        action: "requests",
      };
    }
    return {
      label: "Admin Update",
      color: "default",
      icon: <BellOutlined />,
      action: "none",
    };
  };


  const markPortalNotificationsRead = useCallback(
    async (category) => {
      const unread = portalNotifications.filter((notification) => {
        if (notification.read) return false;
        if (category === "messages") return isMessageNotification(notification);
        if (category === "support") return isSupportNotification(notification);
        if (category === "history") {
          return [
            "reverted",
            "status_change",
            "submission_edit_approved",
            "submission_edit_rejected",
          ].includes(notification.type);
        }
        if (category === "requests") {
          return [
            "baseline_update_approved",
            "baseline_update_rejected",
          ].includes(notification.type);
        }
        if (category === "all") return true;
        return false;
      });
      if (unread.length === 0) return;
      try {
        await Promise.all(
          unread.map((notification) =>
            api.patch(`/notifications/${notification._id}/read`),
          ),
        );
        await fetchPortalNotifications();
      } catch {
        /* silent */
      }
    },
    [portalNotifications, fetchPortalNotifications],
  );

  const markPortalNotificationRead = useCallback(
    async (notification) => {
      if (!notification?._id || notification.read) return;
      try {
        await api.patch(`/notifications/${notification._id}/read`);
        await fetchPortalNotifications();
      } catch {
        /* silent */
      }
    },
    [fetchPortalNotifications],
  );

  const shouldLoadPortalActivityData =
    notificationPanelOpen ||
    supportDrawerOpen ||
    messageDrawerOpen ||
    activeMenu === "history" ||
    activeMenu === "requests";

  useEffect(() => {
    if (!portalUser?.email || !shouldLoadPortalActivityData) return;
    const sock = connectSocket("portal", portalUser.email);
    const refreshMessages = (payload) => {
      if (
        !payload ||
        [
          "support_ticket_reply",
          "admin_message",
          "message_from_admin",
        ].includes(payload.type)
      ) {
        fetchSupportTickets();
      }
      fetchPortalNotifications();
    };
    if (
      notificationPanelOpen ||
      activeMenu === "history" ||
      activeMenu === "requests"
    ) {
      fetchPortalNotifications();
    }
    if ((supportDrawerOpen || messageDrawerOpen) && supportTickets.length === 0) {
      fetchSupportTickets();
    }
    sock.on("notification", refreshMessages);
    sock.on("data-refresh", refreshMessages);
    return () => {
      sock.off("notification", refreshMessages);
      sock.off("data-refresh", refreshMessages);
    };
  }, [
    portalUser?.email,
    shouldLoadPortalActivityData,
    notificationPanelOpen,
    supportDrawerOpen,
    messageDrawerOpen,
    activeMenu,
    supportTickets.length,
    fetchSupportTickets,
    fetchPortalNotifications,
  ]);

  const handleSubmitTicket = async (values) => {
    setSupportSubmitting(true);
    try {
      await api.post("/support-tickets", {
        portalUser: portalUser?._id,
        portalUserEmail: portalUser?.email,
        portalUserName: `${portalUser?.firstName} ${portalUser?.lastName}`,
        companyName: companyForm.getFieldValue("lguCompanyName") || "",
        slfName: activeSlfName,
        attachments: ticketAttachments,
        ...values,
      });
      Swal.fire({
        icon: "success",
        title: "Ticket Submitted",
        text: "Your concern has been submitted. Our team will review and respond.",
        confirmButtonColor: "#1a3353",
      });
      supportForm.resetFields();
      setTicketAttachments([]);
      fetchSupportTickets();
      setSupportTab("my-tickets");
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Failed",
        text: err.response?.data?.message || "Could not submit ticket.",
      });
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleSupportReply = async (ticketId) => {
    if (!supportReplyText.trim()) return;
    try {
      await api.post(`/support-tickets/${ticketId}/portal-reply`, {
        message: supportReplyText.trim(),
        repliedBy: portalUser?.email,
        repliedByName: `${portalUser?.firstName} ${portalUser?.lastName}`,
      });
      setSupportReplyText("");
      fetchSupportTickets();
      if (supportDetailModal) {
        const { data } = await api.get(`/support-tickets/${ticketId}`);
        setSupportDetailModal(data);
      }
    } catch {
      /* silent */
    }
  };

  // ── Excel/CSV Upload Handlers ──
  const handleExcelUpload = (file, type) => {
    const effectiveType = type || uploadType || "truck";
    setUploadType(effectiveType);
    setUploadProgressError(false);
    setUploadProgress(8);
    setUploadStatusText("Reading file…");
    setUploadProgressOpen(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setUploadProgressError(true);
      setUploadStatusText("Could not read the file. Please try again.");
    };
    reader.onload = (e) => {
      try {
        setUploadProgress(30);
        setUploadStatusText("Parsing spreadsheet…");
        const wb = XLSX.read(e.target.result, { type: "array" });
        const sheetName = (wb.SheetNames || [])[0];
        const ws = sheetName ? wb.Sheets[sheetName] : null;
        if (!ws) {
          setUploadProgressError(true);
          setUploadStatusText("No worksheet found in the uploaded file.");
          return;
        }
        const jsonData = XLSX.utils
          .sheet_to_json(ws, { defval: "" })
          .filter((row) =>
            Object.values(row || {}).some((value) => cleanUploadText(value) !== ""),
          );
        if (jsonData.length === 0) {
          setUploadProgressError(true);
          setUploadStatusText("No data rows found in the uploaded file.");
          return;
        }
        setUploadProgress(55);
        setUploadStatusText(`Validating ${jsonData.length} row(s)…`);
        const headers = Object.keys(jsonData[0] || {});
        const missingColumns = getUploadMissingColumns(headers, effectiveType);
        setUploadMissingColumns(missingColumns);
        // Normalize column names
        const normalizeUploadDate = (value) => {
          if (value instanceof Date) return dayjs(value).isValid() ? dayjs(value).format("YYYY-MM-DD") : "";
          if (typeof value === "number") {
            const parsed = XLSX.SSF.parse_date_code(value);
            if (parsed) return dayjs(new Date(parsed.y, parsed.m - 1, parsed.d)).format("YYYY-MM-DD");
          }
          const text = cleanUploadText(value);
          if (!text) return "";
          const parsed = dayjs(text, ["YYYY-MM-DD", "MM/DD/YYYY", "M/D/YYYY", "YYYY/MM/DD"], true);
          return parsed.isValid() ? parsed.format("YYYY-MM-DD") : text;
        };
        const resolveUploadCell = (value) => {
          const text = cleanUploadText(value);
          const comparable = text.toLowerCase();
          const match = activeCellOptions.find((option) => {
            const values = [option.value, option.cellName, option.label]
              .filter(Boolean)
              .map((candidate) => cleanUploadText(candidate).toLowerCase());
            return values.includes(comparable);
          });
          return {
            cellName: match?.value || text,
            cellIndex: typeof match?.cellIndex === "number" ? match.cellIndex : null,
            cellType: match?.cellType || "",
          };
        };
        const normalized = jsonData.map((row, i) => {
          const normalized = { key: `upload-${i}-${Date.now()}`, _rowNumber: i + 2 };
          for (const [key, value] of Object.entries(row)) {
            const k = uploadHeaderKey(key);
            if (effectiveType === "truck") {
              if (UPLOAD_COLUMNS.truck.find((column) => column.field === "disposalDate")?.matches(k))
                normalized.disposalDate = normalizeUploadDate(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "disposalTicketNo")?.matches(k))
                normalized.disposalTicketNo = cleanUploadText(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "hauler")?.matches(k)) normalized.hauler = cleanUploadText(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "client")?.matches(k)) normalized.client = cleanUploadText(value);
              else if (k.includes("plate"))
                normalized.plateNumber = cleanUploadText(value);
              else if (k.includes("capacity") && !k.includes("unit"))
                normalized.truckCapacity = parseUploadNumber(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "actualVolume")?.matches(k))
                normalized.actualVolume = parseUploadNumber(value);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "actualVolumeUnit")?.matches(k))
                normalized.actualVolumeUnit = normalizeUnit(value || baselineUnit || slfUnit);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "cellName")?.matches(k))
                Object.assign(normalized, resolveUploadCell(value));
              else if (k.includes("waste") && k.includes("type"))
                normalized.wasteType = cleanUploadText(value);
              else if (k.includes("haz") || k.includes("code"))
                normalized.hazWasteCode = cleanUploadText(value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
            } else {
              if (isNumberOfTrucksHeader(k))
                normalized.numberOfTrucks = parseUploadNumber(value);
              else if (isHaulerNameHeader(k))
                normalized.haulerName = cleanUploadText(value);
              else if (k.includes("office") || k.includes("address"))
                normalized.officeAddress = cleanUploadText(value);
              else if (k.includes("plate"))
                normalized.plateNumber = cleanUploadText(value);
              else if (k.includes("vehicle") || k.includes("type"))
                normalized.vehicleType = cleanUploadText(value);
              else if (k.includes("capacity") && !k.includes("unit"))
                normalized.capacity = parseUploadNumber(value);
              else if (k.includes("capacity") && k.includes("unit"))
                normalized.capacityUnit = normalizeUnit(
                  value || baselineUnit || slfUnit,
                );
              else if (k.includes("client") && k.includes("type"))
                normalized.clientType = cleanUploadText(value);
              else if (k.includes("client") && k.includes("address"))
                normalized.clientAddress = cleanUploadText(value);
              else if (isClientsHeader(k))
                normalized.privateSectorClients = cleanUploadText(value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
            }
          }
          const relationshipErrors = effectiveType === "truck"
            ? getUploadRelationshipErrors(normalized, haulers)
            : [];
          if (effectiveType === "truck" && relationshipErrors.length === 0) {
            const matchedHauler = findUploadHauler(haulers, normalized.hauler);
            const matchedClient = findUploadClientForHauler(matchedHauler, normalized.client);
            if (matchedClient && !matchedClient.ambiguous && !matchedClient.inactiveOnly) {
              normalized._matchedClient = matchedClient;
            }
          }
          const cellKnown = effectiveType !== "truck" || !normalized.cellName || normalized.cellIndex != null || activeCellOptions.length === 0;
          return {
            ...normalized,
            _errors: [
              ...getUploadRowErrors(normalized, effectiveType),
              ...relationshipErrors,
              ...(cellKnown ? [] : [`Row ${normalized._rowNumber} — Cell or Disposal Area "${normalized.cellName}" is not an available cell under this SLF.`]),
            ],
          };
        });
        setUploadPreviewData(normalized);

        setUploadProgress(80);
        setUploadStatusText("Preparing preview…");
        // Build editable columns
        if (effectiveType === "truck") {
          setUploadPreviewColumns([
            { title: "#", width: 44, render: (_, __, i) => i + 1 },
            {
              title: "Ticket No.",
              dataIndex: "disposalTicketNo",
              key: "disposalTicketNo",
              width: 130,
            },
            { title: "Disposal Date", dataIndex: "disposalDate", key: "disposalDate", width: 130 },
            { title: "Hauler", dataIndex: "hauler", key: "hauler", width: 170 },
            { title: "Client", dataIndex: "client", key: "client", width: 170 },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 120,
            },
            {
              title: "Capacity",
              dataIndex: "truckCapacity",
              key: "truckCapacity",
              width: 110,
            },
            { title: "Volume", dataIndex: "actualVolume", key: "actualVolume", width: 110 },
            { title: "Unit", dataIndex: "actualVolumeUnit", key: "actualVolumeUnit", width: 90 },
            { title: "Cell", dataIndex: "cellName", key: "cellName", width: 130 },
            { title: "Waste Type", dataIndex: "wasteType", key: "wasteType", width: 150 },
            {
              title: "Validation",
              key: "validation",
              width: 180,
              render: (_, row) =>
                row._errors?.length ? (
                  <Tag color="red">Issue: {row._errors.join(", ")}</Tag>
                ) : (
                  <Tag color="green">Ready</Tag>
                ),
            },
            {
              title: "Actions",
              key: "actions",
              width: 60,
              render: (_, r) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setUploadPreviewData((prev) =>
                      prev.filter((p) => p.key !== r.key),
                    )
                  }
                />
              ),
            },
          ]);
        } else {
          setUploadPreviewColumns([
            { title: "#", width: 44, render: (_, __, i) => i + 1 },
            {
              title: "Hauler Name",
              dataIndex: "haulerName",
              key: "haulerName",
              width: 180,
            },
            {
              title: "Trucks",
              dataIndex: "numberOfTrucks",
              key: "numberOfTrucks",
              width: 90,
            },
            {
              title: "Office Address",
              dataIndex: "officeAddress",
              key: "officeAddress",
              width: 240,
            },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 120,
            },
            {
              title: "Vehicle Type",
              dataIndex: "vehicleType",
              key: "vehicleType",
              width: 140,
            },
            { title: "Capacity", dataIndex: "capacity", key: "capacity", width: 110 },
            {
              title: "Clients (optional)",
              dataIndex: "privateSectorClients",
              key: "privateSectorClients",
              width: 200,
              render: (val) =>
                Array.isArray(val) && val.length > 0
                  ? val.join(", ")
                  : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
            },
                { title: "Client Type", dataIndex: "clientType", key: "clientType", width: 120 },
                { title: "Client Address", dataIndex: "clientAddress", key: "clientAddress", width: 220 },
            {
              title: "Validation",
              key: "validation",
              width: 180,
              render: (_, row) =>
                row._errors?.length ? (
                  <Tag color="red">Issue: {row._errors.join(", ")}</Tag>
                ) : (
                  <Tag color="green">Ready</Tag>
                ),
            },
            {
              title: "Actions",
              key: "actions",
              width: 60,
              render: (_, r) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={() =>
                    setUploadPreviewData((prev) =>
                      prev.filter((p) => p.key !== r.key),
                    )
                  }
                />
              ),
            },
          ]);
        }
        setUploadProgress(100);
        setUploadStatusText("Done! Opening preview…");
        setTimeout(() => {
          setUploadProgressOpen(false);
          setUploadModalOpen(true);
        }, 400);
      } catch {
        setUploadProgressError(true);
        setUploadStatusText(
          "Could not parse the uploaded file. Please check the format and try again.",
        );
      }
    };
    // Build columns / normalize were tracked via progress; defer parsing a tick so the
    // progress modal can paint before heavy work begins.
    setTimeout(() => reader.readAsArrayBuffer(file), 50);
    return false; // prevent auto upload
  };

  // ── Open upload guide modal first, then trigger file picker on proceed ──
  const openUploadGuide = (type) => {
    if (portalUser?.portalAccess?.canUploadExcel === false) {
      Swal.fire(
        "Excel Upload Disabled",
        "Your account is not permitted to upload Excel/CSV files. Please contact EMB Region III.",
        "warning",
      );
      return;
    }
    setUploadGuideType(type);
    setUploadGuideOpen(true);
  };
  const proceedToFilePicker = () => {
    setUploadGuideOpen(false);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.onchange = (e) => {
      if (e.target.files[0])
        handleExcelUpload(e.target.files[0], uploadGuideType);
    };
    input.click();
  };

  const handleConfirmUpload = () => {
    if (uploadPreviewData.length === 0) return;
    const invalidRows = uploadPreviewData.filter((row) => row._errors?.length);
    if (uploadMissingColumns.length > 0 || invalidRows.length > 0) {
      Swal.fire({
        icon: "warning",
        title: "Preview Has Missing Data",
        text: "Please fix the missing columns or row values shown in the preview before importing.",
        confirmButtonColor: "#1a3353",
      });
      return;
    }
    if (uploadType === "truck") {
      const newTrucks = uploadPreviewData.map((d) => ({
        key: d.key,
        // Marks the row as upload-sourced so validation REQUIRES a Truck Capacity
        // for it (manually-entered rows keep capacity optional). Transient — the
        // DataSLF schema has no such field, so it is dropped on save.
        entrySource: "upload",
        disposalDate: d.disposalDate || "",
        disposalTicketNo: d.disposalTicketNo || "",
        hauler: d.hauler || "",
        plateNumber: d.plateNumber || "",
        truckCapacity: parseUploadNumber(d.truckCapacity),
        truckCapacityUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
        vehicles: d.plateNumber
          ? [
              {
                plateNumber: d.plateNumber,
                capacity: parseUploadNumber(d.truckCapacity),
                capacityUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
                actualVolume: parseUploadNumber(d.actualVolume),
                actualVolumeUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
                wasteType: d.wasteType || "Residual",
                hazWasteCode: d.hazWasteCode || [],
                cellIndex: d.cellIndex,
                cellName: d.cellName || "",
                cellType: d.cellType || "",
                selectedClients: d._matchedClient ? [d._matchedClient] : [],
              },
            ]
          : [],
        actualVolume: parseUploadNumber(d.actualVolume),
        actualVolumeUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
        wasteType: d.wasteType || "Residual",
        cellIndex: d.cellIndex,
        cellName: d.cellName || "",
        cellType: d.cellType || "",
        hazWasteCode: d.hazWasteCode || [],
        selectedClients: d._matchedClient ? [d._matchedClient] : [],
      }));
      const uploadDates = [...new Set(newTrucks.map((truck) => truck.disposalDate).filter(Boolean))];
      if (uploadDates.length === 1 && !entryForm.getFieldValue("dateOfDisposal")) {
        entryForm.setFieldsValue({ dateOfDisposal: dayjs(uploadDates[0]) });
      }
      setTrucks((prev) => [...prev, ...newTrucks]);
    } else {
      const newHaulers = uploadPreviewData.map((d) => ({
        key: d.key,
        haulerName: d.haulerName || "",
        numberOfTrucks: parseUploadNumber(d.numberOfTrucks),
        officeAddress: d.officeAddress || "",
        vehicles: d.plateNumber || d.vehicleType || !isEmptyUploadValue(d.capacity)
          ? [
              {
                plateNumber: d.plateNumber || "",
                vehicleType: d.vehicleType || "",
                capacity: parseUploadNumber(d.capacity),
                capacityUnit: d.capacityUnit || baselineUnit || slfUnit,
              },
            ]
          : [],
        privateSectorClients: (d.privateSectorClients || []).map((client, index) =>
          typeof client === "string"
            ? {
                key: `${d.key}-client-${index}`,
                clientName: client,
                clientType: d.clientType || "Private",
                clientAddress: d.clientAddress || "",
              }
            : {
                ...client,
                clientType: client.clientType || d.clientType || "Private",
                clientAddress: client.clientAddress || d.clientAddress || "",
              },
        ),
      }));
      setHaulers((prev) =>
        mergeHaulersByName([...prev, ...newHaulers], baselineUnit || slfUnit),
      );
    }
    setUploadModalOpen(false);
    setUploadPreviewData([]);
    setUploadMissingColumns([]);
    Swal.fire({
      icon: "success",
      title: "Data Imported",
      text: `${uploadPreviewData.length} records imported successfully.`,
      timer: 1500,
      showConfirmButton: false,
    });
  };

  // Update preview data cell
  const updateUploadCell = (key, field, value) => {
    setUploadPreviewData((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        // Re-split clients string back to array so downstream merge works correctly
        const coercedValue =
          field === "privateSectorClients" && typeof value === "string"
            ? value.split(",").map((s) => s.trim()).filter(Boolean)
            : value;
        const updated = { ...row, [field]: coercedValue };
        if (uploadType === "truck") {
          updated._relationshipErrors = getUploadRelationshipErrors(updated, haulers);
        }
        return {
          ...updated,
          _errors: [
            ...getUploadRowErrors(updated, uploadType || "truck"),
            ...(updated._relationshipErrors || []),
          ],
        };
      }),
    );
  };

  const downloadDisposalTemplate = () => {
    const headers = UPLOAD_COLUMNS.truck.map((column) => column.label);
    const sample = UPLOAD_COLUMNS.truck.map((column) => column.sample || "");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, sample]);
    worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(18, header.length + 2) }));

    const instructions = [
      ["Waste Generator Disposal Entry Upload Instructions"],
      ["Relationship rule", "Selected SLF -> Hauler -> Client. The Client column is required and must identify a client assigned to the specified hauler under the selected SLF."],
      ["No auto-create", "The upload does not create new clients. Add or correct clients in Baseline / Accredited Haulers first."],
      ["Dates", "Use YYYY-MM-DD, MM/DD/YYYY, or a real Excel date value. All rows in one import must use the same disposal date."],
      ["Numbers", "Waste Volume and Truck Capacity must be positive numbers. Commas are accepted."],
      ["Units", "Use tons, m3, or m³. The unit must match the selected SLF's declared baseline unit."],
      ["Cells", "Use an available Cell or Disposal Area from the selected SLF. Example: Cell 1."],
      [],
      ["Column", "Required", "Accepted format", "Sample", "Validation rule"],
      ...UPLOAD_COLUMNS.truck.map((column) => [
        column.label,
        column.required ? "Required" : "Optional",
        column.format || "Text",
        column.sample || "",
        column.description || "",
      ]),
      [],
      ["Common upload errors"],
      ["Missing Client column"],
      ["Empty Client value"],
      ["Client exists but belongs to another hauler or SLF"],
      ["Duplicate or inactive client record"],
      ["Unknown cell/disposal area"],
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, "Disposal Entries");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), "Instructions");

    const wasteTypeCol = headers.indexOf("Waste Type");
    const unitCol = headers.indexOf("Unit of Measurement");
    if (worksheet["!ref"]) {
      worksheet["!dataValidation"] = [
        ...(wasteTypeCol >= 0 ? [{ sqref: `${XLSX.utils.encode_col(wasteTypeCol)}2:${XLSX.utils.encode_col(wasteTypeCol)}200`, type: "list", formula1: '"Residual,Hazardous Waste,Treated Hazardous Waste"' }] : []),
        ...(unitCol >= 0 ? [{ sqref: `${XLSX.utils.encode_col(unitCol)}2:${XLSX.utils.encode_col(unitCol)}200`, type: "list", formula1: '"tons,m3,m³"' }] : []),
      ];
    }
    XLSX.writeFile(workbook, "Waste_Generator_Disposal_Entry_Template.xlsx");
  };

  const cleanTruckForSubmit = ({ key, vehicles, selectedClients, ...rest }) => {
    const cleanedVehicles = (vehicles || []).map(
      ({ key: vehicleKey, selectedClients: vehicleClients, ...vehicle }) => ({
        ...vehicle,
        selectedClients: (vehicleClients || []).map(cleanClientForSubmit),
      }),
    );
    const flattenedClients = cleanedVehicles.flatMap(
      (vehicle) => vehicle.selectedClients || [],
    );
    return {
      ...rest,
      selectedClients: (selectedClients || []).length
        ? selectedClients.map(cleanClientForSubmit)
        : flattenedClients,
      vehicles: cleanedVehicles,
    };
  };

  // ── Baseline unit change handler ──
  const handleBaselineUnitChange = (unit) => {
    setBaselineUnit(unit);
    baselineForm.setFieldsValue({
      baselineUnit: unit,
      totalVolumeAcceptedUnit: unit,
      activeCellResidualUnit: unit,
      activeCellInertUnit: unit,
      activeCellHazardousUnit: unit,
      closedCellResidualUnit: unit,
      closedCellInertUnit: unit,
      closedCellHazardousUnit: unit,
    });
    // Propagate unit to truck draft, existing trucks, and hauler vehicles
    setTruckDraft((prev) => ({
      ...prev,
      truckCapacityUnit: unit,
      actualVolumeUnit: unit,
      vehicles: (prev.vehicles || []).map((v) => ({
        ...v,
        capacityUnit: unit,
      })),
    }));
    setTrucks((prev) =>
      prev.map((t) => ({
        ...t,
        truckCapacityUnit: unit,
        actualVolumeUnit: unit,
        vehicles: (t.vehicles || []).map((v) => ({ ...v, capacityUnit: unit })),
      })),
    );
    setHaulers((prev) =>
      prev.map((h) => ({
        ...h,
        vehicles: (h.vehicles || []).map((v) => ({ ...v, capacityUnit: unit })),
      })),
    );
    setActiveCellDraft((prev) => ({ ...prev, unit }));
    setClosedCellDraft((prev) => ({ ...prev, unit }));
    // Cell entries ALREADY added kept their old unit, so after switching the unit
    // the baseline mixed m³ and tons rows under one declared unit — a 5× error in
    // whichever rows were left behind. Re-stamp them with the selected unit, which
    // is what the declared-unit control means.
    setActiveCellEntries((prev) => prev.map((e) => ({ ...e, unit })));
    setClosedCellEntries((prev) => prev.map((e) => ({ ...e, unit })));
  };

  // ── Edit reverted entry ──
  const [editingRevertedId, setEditingRevertedId] = useState(null);
  const [resubmitComment, setResubmitComment] = useState("");

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
      companyRegion: record.companyRegion,
      companyProvince: record.companyProvince,
      companyMunicipality: record.companyMunicipality,
      companyBarangay: record.companyBarangay,
    });
    baselineForm.setFieldsValue({
      totalVolumeAccepted: record.totalVolumeAccepted,
      baselineUnit: recordBaselineUnit,
      totalVolumeAcceptedUnit:
        record.totalVolumeAcceptedUnit || recordBaselineUnit,
      activeCellResidualVolume: record.activeCellResidualVolume,
      activeCellResidualUnit:
        record.activeCellResidualUnit || recordBaselineUnit,
      activeCellInertVolume: record.activeCellInertVolume,
      activeCellInertUnit: record.activeCellInertUnit || recordBaselineUnit,
      closedCellResidualVolume: record.closedCellResidualVolume,
      closedCellResidualUnit:
        record.closedCellResidualUnit || recordBaselineUnit,
      closedCellInertVolume: record.closedCellInertVolume,
      closedCellInertUnit: record.closedCellInertUnit || recordBaselineUnit,
    });
    setActiveCellEntries(
      (record.activeCellEntries || []).map((entry, index) => ({
        ...entry,
        unit: entry.unit || recordBaselineUnit,
        key: `reverted-active-${index}-${Date.now()}`,
      })),
    );
    setClosedCellEntries(
      (record.closedCellEntries || []).map((entry, index) => ({
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
    // Load haulers
    setHaulers(
      mergeHaulersByName(record.accreditedHaulers || [], recordBaselineUnit),
    );
    setEditingRevertedId(record._id);
    setSubmitted(false);
    setBaselineSaved(true);
    setHistoryDetailModal(null);
    setActiveMenu("data-entry");
    setActiveTab("disposal");
    // Cascade address dropdowns if codes are available
    if (record.companyRegion) fetchProvinces(record.companyRegion);
    if (record.companyProvince) fetchMunicipalities(record.companyProvince);
    if (record.companyMunicipality) fetchBarangays(record.companyMunicipality);
    Swal.fire({
      icon: "info",
      title: "Edit Reverted Entry",
      html: `<b>Reason for revert:</b> ${record.revertReason || "Not specified"}<br/><br/>Please review and update the data across all tabs, then submit again.`,
      confirmButtonColor: "#1a3353",
    });
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
      fetchSubmissions();
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
        if (cap.exceeded) {
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
        const ts = s.revertedAt || s.updatedAt;
        return ts && new Date(ts).getTime() <= cutoff;
      }) || null
    );
  }, [submissions]);

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

  const submitBlockers = useMemo(() => {
    const list = [];
    if (slfNonOperational) list.push(NON_OPERATIONAL_MESSAGE);
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
      list.push("Complete every required Waste Generation Information field (incl. a disposal cell for each entry).");
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
    if (unresolvedRevert) {
      list.push("Correct and resubmit your reverted submission first.");
    }
    if (ORGANIZE_CELLS_ENABLED && unplacedSubmissions.length > 0) {
      list.push("Organize past submissions in Organize Cells — assign cells and complete any missing truck capacity.");
    }
    return list;
  }, [
    slfNonOperational,
    missingGeneralInfo,
    missingBaselineInfo,
    watchedDisposalDate,
    trucks,
    wasteGenValidationIssues.length,
    allCellsUnavailable,
    missingHazardousCodeTrucks.length,
    haulerVehiclesMissingCapacity.length,
    unresolvedRevert,
    unplacedSubmissions.length,
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
        const capUnit = normalizeUnit(
          slfInfo?.cellCapacityUnits?.[idx] || slfInfo?.cellFillUnits?.[idx] || slfUnit,
        );
        const converted = convertVolume(vol, row.actualVolumeUnit || capUnit, capUnit);
        perCell.set(idx, (perCell.get(idx) || 0) + converted);
      });
    });
    perCell.forEach((addedVol, idx) => {
      const capacity = Number(slfInfo?.cellCapacities?.[idx] || 0);
      if (!(capacity > 0)) return;
      const capUnit = normalizeUnit(
        slfInfo?.cellCapacityUnits?.[idx] || slfInfo?.cellFillUnits?.[idx] || slfUnit,
      );
      const currentFill = convertVolume(
        Number(slfInfo?.cellFillValues?.[idx] || 0),
        slfInfo?.cellFillUnits?.[idx] || capUnit,
        capUnit,
      );
      const projected = currentFill + addedVol;
      const label = String(slfInfo?.cellNames?.[idx] || "").trim() || `Cell ${idx + 1}`;
      const pct = Math.round((projected / capacity) * 100);
      if (projected >= capacity) fullCells.push({ label, pct });
      else if (pct >= 80) nearFullCells.push({ label, pct });
    });
    return { fullCells, nearFullCells };
  }, [trucks, slfInfo]);

  // Every portal WRITE goes through here first. In Developer Portal Mode the
  // backend will refuse the request anyway; this just explains why instead of
  // surfacing a bare 403.
  const blockedByDeveloperContext = (action = "change this data") => {
    if (!isDeveloperContext) return false;
    showError({
      type: "error",
      title: "Developer View is Read-Only",
      message: `You are inspecting another portal user's data and cannot ${action}. Use Developer Settings → Submission RAW Data to correct records.`,
    });
    return true;
  };

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
        Swal.fire({
          icon: "success",
          title: "Submitted Successfully!",
          html: "Your disposal data has been recorded.",
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
      } else if (err.code === "ECONNABORTED") {
        showError({
          type: "error",
          title: "Request Timed Out",
          message: "The server took too long to respond. Please try again.",
        });
      } else if (err.response?.data?.code === "UNRESOLVED_REVERT") {
        // #2: backend rule block (also enforced server-side to prevent API bypass) —
        // show a clear modal with a direct action to the correction flow.
        const ctxId = err.response?.data?.ruleContext?.idNo;
        Swal.fire({
          icon: "warning",
          title: "Resolve Reverted Submission First",
          text:
            err.response?.data?.message ||
            `Please correct and resubmit your reverted submission${ctxId ? ` (${ctxId})` : ""} before submitting a new transaction.`,
          showCancelButton: true,
          confirmButtonText: "Review Submission History",
          cancelButtonText: "Close",
          confirmButtonColor: "#1a3353",
        }).then((r) => {
          if (r.isConfirmed) setActiveMenu("history");
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

  // ── Drafts & Scheduled submission handlers ──
  //
  // Save as Draft deliberately does NOT run the final-submission validation:
  // a draft exists precisely to hold incomplete work (the Waste Generation
  // required-field rules, incl. Truck Capacity, apply only at final submit).
  const handleSaveDraft = async () => {
    if (blockedByDeveloperContext("save a draft for them")) return;
    // Re-entrancy guard. The disabled state alone is not enough — a fast double
    // click fires both handlers before React flushes `savingDraft`, which created
    // two identical drafts. The ref flips synchronously; `clientRequestId` makes
    // the server reject the duplicate too, so a retry can't slip past either.
    if (queueActionRef.current) return;
    queueActionRef.current = true;
    setSavingDraft(true);
    try {
      const entry = buildSubmissionEntry();
      await api.post("/portal-queue", {
        type: "draft",
        payload: entry,
        clientRequestId: newClientRequestId(),
        slfName: activeSlfName,
        slfGenerator: activeSlfId || null,
      });
      setReviewModalOpen(false);
      Swal.fire({
        icon: "success",
        title: "Saved as Draft",
        text: "Your encoded data was saved. You can submit it later from Drafts & Scheduled.",
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
      const entry = buildSubmissionEntry();
      // `scheduledAt` is sent as an absolute ISO instant (UTC), so the server's
      // "must be in the future" check and the worker's `scheduledAt <= now` sweep
      // compare the same instant regardless of the browser's timezone.
      await api.post("/portal-queue", {
        type: "scheduled",
        payload: entry,
        scheduledAt: scheduleAt.toISOString(),
        clientRequestId: newClientRequestId(),
        slfName: activeSlfName,
        slfGenerator: activeSlfId || null,
      });
      setScheduleModalOpen(false);
      setScheduleAt(null);
      setReviewModalOpen(false);
      Swal.fire({
        icon: "success",
        title: "Submission Scheduled",
        text: "Your submission will be sent automatically at the scheduled time.",
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

  // ── Table column definitions — see columns/ ──
  const truckColumns = makeTruckColumns({ slfUnit, openTruckModal, removeTruck });

  // Hauler table columns
  const haulerColumns = makeHaulerColumns({
    slfUnit,
    baselineSaved,
    openHaulerModal,
    removeHauler,
    setHaulerDeleteModal,
    setHaulerDeleteReason,
    setHaulerDeleteFile,
  });

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

  const historyColumns = makeHistoryColumns({
    submissions,
    trucks,
    maskSensitive,
    openHistoryDetail,
    openRevertModal,
    handleEditRevertedRow,
    handleHideSubmission,
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

  const revertedCount = submissions.filter(
    (s) => s.status === "reverted",
  ).length;
  const unreadPortalNotifications = portalNotifications.filter(
    (notification) => !notification.read,
  );
  const portalNotificationCounts = {
    total: portalUnreadCount,
    messages: unreadPortalNotifications.filter(isMessageNotification).length,
    support: unreadPortalNotifications.filter(isSupportNotification).length,
    history: unreadPortalNotifications.filter((notification) =>
      [
        "reverted",
        "status_change",
        "submission_edit_approved",
        "submission_edit_rejected",
      ].includes(notification.type),
    ).length,
    requests: unreadPortalNotifications.filter((notification) =>
      ["baseline_update_approved", "baseline_update_rejected"].includes(
        notification.type,
      ),
    ).length,
  };
  const historyBadgeCount = revertedCount + portalNotificationCounts.history;
  const openPortalNotification = async (notification) => {
    const meta = getPortalNotificationMeta(notification);
    if (meta.action === "messages") {
      setMessageDrawerOpen(true);
      if (supportTickets.length === 0) fetchSupportTickets();
      markPortalNotificationsRead("messages");
    } else if (meta.action === "support") {
      setSupportDrawerOpen(true);
      setSupportTab("my-tickets");
      if (supportTickets.length === 0) fetchSupportTickets();
      markPortalNotificationsRead("support");
    } else if (meta.action === "history") {
      setActiveMenu("history");
      markPortalNotificationsRead("history");
    } else if (meta.action === "requests") {
      setActiveMenu("requests");
      markPortalNotificationsRead("requests");
    } else {
      await markPortalNotificationRead(notification);
    }
    setNotificationPanelOpen(false);
  };


  // ── Previous Notifications (full history) ──
  // Table view of every notification already loaded in portalNotifications — the
  // popover only shows the most recent few. Reuses getPortalNotificationMeta and
  // openPortalNotification; no new data source.

  // Full message + jump-to-context for a single notification opened from the
  // Previous Notifications table.
  const notificationDetailModal = (
    <Modal
      open={!!notifDetail}
      onCancel={() => setNotifDetail(null)}
      width={520}
      title={
        notifDetail ? (
          <Space>
            {getPortalNotificationMeta(notifDetail).icon}
            <span>
              {notifDetail.title ||
                getPortalNotificationMeta(notifDetail).label}
            </span>
          </Space>
        ) : (
          "Notification"
        )
      }
      footer={
        notifDetail ? (
          <Space>
            {getPortalNotificationMeta(notifDetail).action !== "none" && (
              <Button
                type="primary"
                onClick={() => {
                  const target = notifDetail;
                  setNotifDetail(null);
                  setPreviousNotifOpen(false);
                  openPortalNotification(target);
                }}
              >
                Go to details
              </Button>
            )}
            <Button onClick={() => setNotifDetail(null)}>Close</Button>
          </Space>
        ) : null
      }
    >
      {notifDetail && (
        <Descriptions size="small" column={1} bordered>
          <Descriptions.Item label="Type">
            <Tag color={getPortalNotificationMeta(notifDetail).color}>
              {getPortalNotificationMeta(notifDetail).label}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Date / Time">
            {notifDetail.createdAt
              ? dayjs(notifDetail.createdAt).format("MMM D, YYYY h:mm A")
              : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            {notifDetail.read ? "Read" : "Unread"}
          </Descriptions.Item>
          <Descriptions.Item label="Message">
            <div
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {notifDetail.message || "—"}
            </div>
          </Descriptions.Item>
        </Descriptions>
      )}
    </Modal>
  );

  const menuItems = [
    {
      key: "overview",
      icon: <DashboardOutlined />,
      label: "Dashboard",
    },
    {
      key: "data-entry",
      icon: <FileTextOutlined />,
      label: (
        <span>
          Data Entry
          {portalNotificationCounts.total > 0 &&
            activeMenu !== "data-entry" && (
              <Badge dot style={{ marginLeft: 8 }} />
            )}
        </span>
      ),
    },
    {
      key: "history",
      icon: <HistoryOutlined />,
      label: (
        <span>
          Submission History
          {historyBadgeCount > 0 && (
            <Badge
              count={historyBadgeCount}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#fa541c" }}
            />
          )}
        </span>
      ),
    },
    // {
    //   key: "cell-placement",
    //   icon: <ContainerOutlined />,
    //   label: (
    //     <span>
    //       Organize Cells
    //       {unplacedSubmissions.length > 0 && (
    //         <Badge
    //           count={unplacedSubmissions.length}
    //           size="small"
    //           style={{ marginLeft: 8, backgroundColor: "#722ed1" }}
    //         />
    //       )}
    //     </span>
    //   ),
    // },
    ...(ORGANIZE_CELLS_ENABLED
      ? [
          {
            key: "cell-placement",
            icon: <ContainerOutlined />,
            label: (
              <span>
                Organize Cells
                {unplacedSubmissions.length > 0 && (
                  <Badge
                    count={unplacedSubmissions.length}
                    size="small"
                    style={{ marginLeft: 8, backgroundColor: "#722ed1" }}
                  />
                )}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "drafts",
      icon: <FileTextOutlined />,
      label: "Drafts & Scheduled",
    },
    {
      key: "requests",
      icon: <AuditOutlined />,
      label: (
        <span>
          My Requests
          {portalNotificationCounts.requests > 0 && (
            <Badge
              count={portalNotificationCounts.requests}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#1677ff" }}
            />
          )}
        </span>
      ),
    },
  ];

  const siderContent = (
    <div>
      <div className="portal-sider-logo">
        <img
          src={embLogo}
          alt="EMBR3"
          style={{ width: 36, marginRight: collapsed && !isMobile ? 0 : 10 }}
        />
        {(!collapsed || isMobile) && (
          <div>
            <Text
              strong
              style={{
                color: "#fff",
                fontSize: 14,
                display: "block",
                lineHeight: 1.2,
              }}
            >
              SLF Portal
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
              EMBR3 ESWMP
            </Text>
          </div>
        )}
      </div>
      <Menu
        mode="inline"
        selectedKeys={[activeMenu]}
        onClick={({ key }) => {
          if (key === "cell-placement") {
            openCellOrganizer();
            if (isMobile) setMobileDrawer(false);
            return;
          }
          setActiveMenu(key);
          if (key === "history") markPortalNotificationsRead("history");
          if (key === "requests") markPortalNotificationsRead("requests");
          if (isMobile) setMobileDrawer(false);
        }}
        items={menuItems}
        style={{ background: "transparent", borderRight: 0, color: "#fff" }}
        theme="dark"
      />
    </div>
  );

  const userDisplay = portalUser
    ? `${portalUser.firstName} ${portalUser.lastName}`
    : "";

  const userMenuItems = [
    {
      key: "info",
      label: (
        <div style={{ padding: "4px 0" }}>
          <Text strong style={{ display: "block" }}>
            {userDisplay}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {portalUser?.email}
          </Text>
          <br />
          <Tag color="blue" style={{ marginTop: 4 }}>
            {activeSlfName}
          </Tag>
        </div>
      ),
      disabled: true,
    },
    { type: "divider" },
    { key: "profile", icon: <UserOutlined />, label: "View Profile" },
    { key: "logout", icon: <LogoutOutlined />, label: "Logout", danger: true },
  ];

  // ── Data Entry Content ──
  const renderUnitMeasurementControl = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", border: "1px solid #91caff", borderRadius: 8, background: "#e6f4ff", maxWidth: "100%" }}>
      <DatabaseOutlined style={{ color: "#1677ff" }} />
      {!isMobile && <Text strong style={{ fontSize: 12, color: "#003eb3", whiteSpace: "nowrap" }}>Unit of Measurement</Text>}
      <Select size="small" value={baselineUnit || slfUnit} onChange={handleBaselineUnitChange} disabled={baselineSaved} placeholder="Unit" style={{ width: isMobile ? 104 : 150 }}>
        <Option value="m³">m³</Option>
        <Option value="tons">tons</Option>
      </Select>
    </div>
  );

  const renderDataEntry = () => {
    if (submitted) {
      return (
        <Card
          className="slf-result-card"
          style={{ maxWidth: 560, margin: "40px auto" }}
        >
          <Result
            status="success"
            icon={<CheckCircleOutlined style={{ color: "#1a3353" }} />}
            title="Submission Successful!"
            subTitle="Your SLF disposal data has been recorded."
            extra={
              <Button
                type="primary"
                size="large"
                onClick={() => setSubmitted(false)}
                className="slf-primary-btn"
              >
                Submit More Data
              </Button>
            }
          />
        </Card>
      );
    }

    return (
      <div style={{ maxWidth: 1680, margin: "0 auto" }}>
        {/* Accredited-hauler vehicles missing a capacity BLOCK submission, so warn
            here — up front and persistently — rather than only at submit time.
            Records encoded before Vehicle Capacity became required land here. */}
        {haulerVehiclesMissingCapacity.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12, borderRadius: 8 }}
            message="Vehicle Capacity is required on your Accredited Haulers"
            description={
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Text style={{ fontSize: 13 }}>
                  {haulerVehiclesMissingCapacity.length} vehicle
                  {haulerVehiclesMissingCapacity.length === 1 ? "" : "s"} still
                  {haulerVehiclesMissingCapacity.length === 1 ? " has" : " have"} no
                  capacity recorded. You will not be able to submit until
                  {haulerVehiclesMissingCapacity.length === 1 ? " it is" : " they are"}{" "}
                  updated.
                </Text>
                <Space size={4} wrap>
                  {haulerVehiclesMissingCapacity.slice(0, 8).map((i, idx) => (
                    <Tag key={`${i.haulerName}-${i.plateNumber}-${idx}`} color="orange">
                      {i.haulerName} · {i.plateNumber}
                    </Tag>
                  ))}
                  {haulerVehiclesMissingCapacity.length > 8 && (
                    <Tag>+{haulerVehiclesMissingCapacity.length - 8} more</Tag>
                  )}
                </Space>
                <Button size="small" type="primary" onClick={() => setActiveTab("baseline")}>
                  Request Now to update
                </Button>
              </Space>
            }
          />
        )}
        {/* SLF selector for users with multiple assigned SLFs */}
        {Array.isArray(portalUser?.assignedSlfName) &&
          portalUser.assignedSlfName.length > 1 && (
            <div ref={slfSelectorRef}>
              <Card
              size="small"
              style={{
                marginBottom: 12,
                borderRadius: 10,
                border: "1px solid #91caff",
                background: "#e6f4ff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <EnvironmentOutlined
                  style={{ color: "#1a3353", fontSize: 16 }}
                />
                <Text strong style={{ fontSize: 13 }}>
                  Select SLF Facility:
                </Text>
                <Select
                  value={selectedSlfIdx}
                  onChange={(val) => {
                    setSelectedSlfIdx(val);
                    setBaselineSaved(false);
                    setSlfInfo(null);
                    setHaulers([]);
                    setTrucks([]);
                    setActiveCellEntries([]);
                    setClosedCellEntries([]);
                    baselineForm.resetFields();
                    companyForm.resetFields();
                    entryForm.resetFields();
                  }}
                  style={{ minWidth: 280 }}
                  options={portalUser.assignedSlfName.map((name, i) => ({
                    label: name,
                    value: i,
                  }))}
                />
              </div>
              </Card>
            </div>
          )}
        <Row gutter={[16, 16]} align="top">
          <Col xs={24} xl={19}>
            {/* SLF Name (read-only, from assigned SLF) */}
            <AssignedSlfDashboard
              activeSlfName={activeSlfName}
              slfInfo={slfInfo}
              slfInfoLoading={slfInfoLoading}
              baselineUnit={baselineUnit || slfUnit}
              baselineSaved={baselineSaved}
              baselineForm={baselineForm}
              activeCellEntries={activeCellEntries}
              closedCellEntries={closedCellEntries}
              haulers={haulers}
              isMobile={isMobile}
              hasReviewMissing={hasReviewMissing}
              submitBlockers={submitBlockers}
              loading={loading}
              slfCardExpanded={slfCardExpanded}
              handleReviewOpen={handleReviewOpen}
              handleOpenWasteReceived={handleOpenWasteReceived}
            />

            {/* Disposal Data Form */}
            <Card className="slf-section" style={{ marginTop: 20 }}>
              <div ref={dataEntryTabsRef}>
                <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                tabBarExtraContent={renderUnitMeasurementControl()}
                // Only the open Data Entry tab stays mounted. antd otherwise keeps
                // every tab you have visited alive, so the hauler/vehicle tables,
                // cell grids and their derived arrays from other tabs all sat in
                // memory behind the one on screen.
                //
                // The forms themselves are antd Form instances owned by this
                // component (companyForm / entryForm / …), so unmounting a PANE does
                // not discard entered values — the draft state lives above the tab.
                destroyOnHidden
                // Localized per-tab spinner while that tab's source data loads.
                items={withTabLoading([
                  {
                    key: "basic-info",
                    label: (
                      <span>
                        <InfoCircleOutlined />{" "}
                        {isMobile ? "Basic Info" : "Basic Information"}
                        <RequiredDot show={missingGeneralInfo} />
                      </span>
                    ),
                    children: (
                      <BasicInfoTab
                        companyForm={companyForm}
                        entryForm={entryForm}
                        regions={regions}
                        provinces={provinces}
                        municipalities={municipalities}
                        barangays={barangays}
                        loadingAddress={loadingAddress}
                        fetchProvinces={fetchProvinces}
                        fetchMunicipalities={fetchMunicipalities}
                        fetchBarangays={fetchBarangays}
                        addressLocked={baselineSaved}
                      />
                    ),
                  },
                  {
                    key: "baseline",
                    label: (
                      <span>
                        <DatabaseOutlined />{" "}
                        {isMobile ? "Baseline" : "Baseline Data"}
                        <RequiredDot show={missingBaselineInfo} />
                        {baselineSaved && (
                          <CheckCircleOutlined
                            style={{ color: "#52c41a", marginLeft: 6 }}
                          />
                        )}
                      </span>
                    ),
                    children: (
                      <div ref={baselinePanelRef}>
                        {baselineSaved && (
                          <div
                            ref={baselineStatusRef}
                            style={{
                              background: baselineUpdatePending
                                ? "#e6f7ff"
                                : "#fff7e6",
                              border: `1px solid ${baselineUpdatePending ? "#91d5ff" : "#ffe58f"}`,
                              borderRadius: 6,
                              padding: "10px 14px",
                              marginBottom: 16,
                              display: "flex",
                              alignItems: isMobile ? "flex-start" : "center",
                              justifyContent: "space-between",
                              flexWrap: "wrap",
                              gap: 8,
                            }}
                          >
                            <div>
                              <InfoCircleOutlined
                                style={{
                                  color: baselineUpdatePending
                                    ? "#1890ff"
                                    : "#faad14",
                                  marginRight: 8,
                                }}
                              />
                              <Text
                                style={{
                                  color: baselineUpdatePending
                                    ? "#096dd9"
                                    : "#ad6800",
                                }}
                              >
                                {baselineUpdatePending
                                  ? "Your baseline update request is pending admin approval. Please wait for a response."
                                  : "Baseline data is locked after your first submission. To request changes, click the button."}
                              </Text>
                            </div>
                            <div ref={baselineActionRef}>
                              <Space wrap>
                                {!baselineUpdatePending && (
                                  <Button
                                    type="primary"
                                    size="small"
                                    icon={<SendOutlined />}
                                    loading={baselineUpdateLoading}
                                    onClick={handleBaselineUpdateRequest}
                                    style={{
                                      background: "#fa8c16",
                                      borderColor: "#fa8c16",
                                    }}
                                  >
                                    Request Update
                                  </Button>
                                )}
                                {baselineUpdatePending && (
                                  <Tag
                                    color="processing"
                                    icon={<ClockCircleOutlined />}
                                  >
                                    Awaiting Approval
                                  </Tag>
                                )}
                                <Button
                                  size="small"
                                  icon={<ReloadOutlined />}
                                  loading={baselineRefreshLoading}
                                  onClick={refreshBaselineStatus}
                                >
                                  Refresh
                                </Button>
                              </Space>
                            </div>
                          </div>
                        )}
                        <Form
                          form={baselineForm}
                          layout="vertical"
                          requiredMark={false}
                          disabled={baselineSaved}
                        >
                          {/* ── Unit of Measurement ── */}
                          <div
                            style={{
                              background:
                                "linear-gradient(135deg, #e6f4ff 0%, #f0f5ff 100%)",
                              border: "1px solid #91caff",
                              borderRadius: 10,
                              padding: "12px 16px",
                              marginBottom: 16,
                              marginLeft: "auto",
                              width: "min(100%, 420px)",
                              display: "none",
                              alignItems: "center",
                              gap: 12,
                              flexWrap: "wrap",
                            }}
                          >
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 8,
                                background: "#1677ff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <DatabaseOutlined
                                style={{ color: "#fff", fontSize: 15 }}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 130 }}>
                              <Text
                                strong
                                style={{
                                  fontSize: 12,
                                  color: "#003eb3",
                                  display: "block",
                                }}
                              >
                                Unit of Measurement
                              </Text>
                              <Text type="secondary" style={{ fontSize: 10 }}>
                                Applies to all portal volume fields
                              </Text>
                            </div>
                            <Select
                              value={baselineUnit || slfUnit}
                              onChange={handleBaselineUnitChange}
                              disabled={baselineSaved}
                              placeholder="Select unit of measurement"
                              style={{ width: 170 }}
                            >
                              <Option value="m³">m³ (cubic meters)</Option>
                              <Option value="tons">tons</Option>
                            </Select>
                          </div>

                          {/* ── Volume of Waste Accepted ── */}
                          <div
                            style={{
                              background: "#fff",
                              border: "1px solid #e8e8e8",
                              borderRadius: 10,
                              overflow: "hidden",
                              marginBottom: 14,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "10px 16px",
                                background:
                                  "linear-gradient(90deg, #1a3353 0%, #244b7a 100%)",
                              }}
                            >
                              <BarChartOutlined
                                style={{ color: "#fff", fontSize: 13 }}
                              />
                              <Text
                                strong
                                style={{ color: "#fff", fontSize: 13 }}
                              >
                                Volume of Waste Accepted
                              </Text>
                              <Text
                                style={{
                                  color: "rgba(255,255,255,0.55)",
                                  fontSize: 11,
                                  marginLeft: 2,
                                }}
                              >
                                (since start of operation)
                              </Text>
                            </div>
                            <div style={{ padding: "14px 16px 8px" }}>
                              <Row gutter={[12, 0]}>
                                <Col xs={24} sm={14} md={10}>
                                  <Form.Item
                                    name="totalVolumeAccepted"
                                    label="Total Volume Accepted"
                                    required
                                    rules={[
                                      { required: true, message: "Required" },
                                    ]}
                                  >
                                    <InputNumber
                                      placeholder="0.00"
                                      style={{ width: "100%" }}
                                      min={0}
                                      step={0.01}
                                      precision={2}
                                      // Editable only when cell entries aren't
                                      // driving the total; a facility declaring a
                                      // lump baseline (no cell rows) must be able to
                                      // type it, or it stays 0. `baselineSaved` is
                                      // kept so the explicit prop doesn't override
                                      // the Form-level lock.
                                      disabled={baselineSaved || cellVolumeTotalIsAuthoritative}
                                      addonAfter={
                                        (baselineUnit || slfUnit) === "m³" ? "m³" : "tons"
                                      }
                                      // #2: 0 is a VALID Total Volume Accepted —
                                      // the previous `v ? … : ""` formatter blanked
                                      // out a saved zero (and any falsy-but-valid
                                      // value), making real data look missing. Only
                                      // an empty/null/undefined value renders blank.
                                      formatter={(v) =>
                                        v === "" || v === null || v === undefined
                                          ? ""
                                          : Number(v).toLocaleString(undefined, {
                                              maximumFractionDigits: 2,
                                            })
                                      }
                                      parser={(v) => {
                                        const cleaned = String(v ?? "").replace(
                                          /,/g,
                                          "",
                                        );
                                        return cleaned === "" ? null : cleaned;
                                      }}
                                    />
                                  </Form.Item>
                                  <Text type="secondary" style={{ fontSize: 11 }}>
                                    {cellVolumeTotalIsAuthoritative
                                      ? "Auto-calculated from Active Cell Volume plus Closed / Used-Completed Cell Volume."
                                      : "Enter the total volume accepted, or add Active / Closed cell entries below to calculate it automatically."}
                                  </Text>
                                </Col>
                              </Row>
                            </div>
                          </div>

                          <Collapse
                            bordered={false}
                            style={{
                              background: "transparent",
                              marginBottom: 14,
                            }}
                            items={[
                              {
                                key: "active",
                                label: (
                                  <Space>
                                    <CheckCircleOutlined
                                      style={{ color: "#52c41a" }}
                                    />
                                    <Text strong style={{ color: "#135200" }}>
                                      Active Cells
                                      {activeCellEntries.length > 0
                                        ? ` (${activeCellEntries.length})`
                                        : ""}
                                    </Text>
                                    {activeCellEntries.length > 0 && (
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Total:{" "}
                                        {formatEntryVolumeSummary(
                                          activeCellEntries,
                                          baselineUnit || slfUnit,
                                        )}
                                      </Text>
                                    )}
                                  </Space>
                                ),
                                extra: !baselineSaved && (
                                  <Button
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingActiveCellKey(null);
                                      setActiveCellDraft({
                                        cellName: "",
                                        wasteType: "Residual",
                                        volume: null,
                                        unit: baselineUnit || slfUnit,
                                      });
                                      setActiveCellModalOpen(true);
                                    }}
                                  >
                                    Add Entry
                                  </Button>
                                ),
                                children: (
                                  <Table
                                    dataSource={activeCellEntries}
                                    rowKey="key"
                                    size="small"
                                    pagination={false}
                                    style={{ marginBottom: 0 }}
                                    locale={{
                                      emptyText: (
                                        <Text
                                          type="secondary"
                                          style={{ fontSize: 12 }}
                                        >
                                          No entries yet.
                                          {!baselineSaved &&
                                            ' Click "Add Entry" above to add cell data.'}
                                        </Text>
                                      ),
                                    }}
                                    columns={[
                                      {
                                        title: "#",
                                        key: "idx",
                                        width: 42,
                                        render: (_, __, i) => (
                                          <Text
                                            style={{
                                              fontSize: 12,
                                              color: "#8c8c8c",
                                            }}
                                          >
                                            {i + 1}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: "Cell Name",
                                        dataIndex: "cellName",
                                        key: "cellName",
                                        render: (v) =>
                                          v || (
                                            <Text
                                              type="secondary"
                                              style={{ fontSize: 12 }}
                                            >
                                              Unnamed Cell
                                            </Text>
                                          ),
                                      },
                                      {
                                        title: "Waste Type",
                                        dataIndex: "wasteType",
                                        key: "wasteType",
                                        width: 160,
                                        render: (v) => {
                                          const isHaz = v
                                            ?.toLowerCase()
                                            .includes("hazardous");
                                          const isInert = v === "Inert";
                                          return (
                                            <Tag
                                              color={
                                                isHaz
                                                  ? "red"
                                                  : isInert
                                                    ? "blue"
                                                    : "green"
                                              }
                                              style={{ fontSize: 11 }}
                                            >
                                              {v}
                                            </Tag>
                                          );
                                        },
                                      },
                                      {
                                        title: "Volume",
                                        key: "vol",
                                        width: 140,
                                        render: (_, r) => (
                                          <Text
                                            strong
                                            style={{ color: "#52c41a" }}
                                          >
                                            {r.volume != null
                                              ? `${r.volume.toLocaleString()} ${normalizeUnit(r.unit || baselineUnit || slfUnit)}`
                                              : "—"}
                                          </Text>
                                        ),
                                      },
                                      !baselineSaved && {
                                        title: "",
                                        key: "act",
                                        width: 72,
                                        render: (_, r) => (
                                          <Space size={0}>
                                            <Button
                                              type="text"
                                              size="small"
                                              icon={<EditOutlined />}
                                              style={{ color: "#1a3353" }}
                                              onClick={() =>
                                                openCellEntryForEdit(r, {
                                                  setDraft: setActiveCellDraft,
                                                  setEditingKey: setEditingActiveCellKey,
                                                  setOpen: setActiveCellModalOpen,
                                                })
                                              }
                                            />
                                            <Button
                                              type="text"
                                              danger
                                              size="small"
                                              icon={<DeleteOutlined />}
                                              onClick={() =>
                                                setActiveCellEntries((prev) =>
                                                  prev.filter(
                                                    (e) => e.key !== r.key,
                                                  ),
                                                )
                                              }
                                            />
                                          </Space>
                                        ),
                                      },
                                    ].filter(Boolean)}
                                  />
                                ),
                              },
                              {
                                key: "closed",
                                label: (
                                  <Space>
                                    <CloseCircleOutlined
                                      style={{ color: "#722ed1" }}
                                    />
                                    <Text strong style={{ color: "#391085" }}>
                                      Closed Cells
                                      {closedCellEntries.length > 0
                                        ? ` (${closedCellEntries.length})`
                                        : ""}
                                    </Text>
                                    {closedCellEntries.length > 0 && (
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Total:{" "}
                                        {formatEntryVolumeSummary(
                                          closedCellEntries,
                                          baselineUnit || slfUnit,
                                        )}
                                      </Text>
                                    )}
                                  </Space>
                                ),
                                extra: !baselineSaved && (
                                  <Button
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingClosedCellKey(null);
                                      setClosedCellDraft({
                                        cellName: "",
                                        wasteType: "Residual",
                                        volume: null,
                                        unit: baselineUnit || slfUnit,
                                      });
                                      setClosedCellModalOpen(true);
                                    }}
                                  >
                                    Add Entry
                                  </Button>
                                ),
                                children: (
                                  <Table
                                    dataSource={closedCellEntries}
                                    rowKey="key"
                                    size="small"
                                    pagination={false}
                                    style={{ marginBottom: 0 }}
                                    locale={{
                                      emptyText: (
                                        <Text
                                          type="secondary"
                                          style={{ fontSize: 12 }}
                                        >
                                          No entries yet.
                                          {!baselineSaved &&
                                            ' Click "Add Entry" above to add cell data.'}
                                        </Text>
                                      ),
                                    }}
                                    columns={[
                                      {
                                        title: "#",
                                        key: "idx",
                                        width: 42,
                                        render: (_, __, i) => (
                                          <Text
                                            style={{
                                              fontSize: 12,
                                              color: "#8c8c8c",
                                            }}
                                          >
                                            {i + 1}
                                          </Text>
                                        ),
                                      },
                                      {
                                        title: "Cell Name",
                                        dataIndex: "cellName",
                                        key: "cellName",
                                        render: (v) =>
                                          v || (
                                            <Text
                                              type="secondary"
                                              style={{ fontSize: 12 }}
                                            >
                                              Unnamed Cell
                                            </Text>
                                          ),
                                      },
                                      {
                                        title: "Waste Type",
                                        dataIndex: "wasteType",
                                        key: "wasteType",
                                        width: 160,
                                        render: (v) => {
                                          const isHaz = v
                                            ?.toLowerCase()
                                            .includes("hazardous");
                                          const isInert = v === "Inert";
                                          return (
                                            <Tag
                                              color={
                                                isHaz
                                                  ? "red"
                                                  : isInert
                                                    ? "purple"
                                                    : "orange"
                                              }
                                              style={{ fontSize: 11 }}
                                            >
                                              {v}
                                            </Tag>
                                          );
                                        },
                                      },
                                      {
                                        title: "Volume",
                                        key: "vol",
                                        width: 140,
                                        render: (_, r) => (
                                          <Text
                                            strong
                                            style={{ color: "#722ed1" }}
                                          >
                                            {r.volume != null
                                              ? `${r.volume.toLocaleString()} ${normalizeUnit(r.unit || baselineUnit || slfUnit)}`
                                              : "—"}
                                          </Text>
                                        ),
                                      },
                                      !baselineSaved && {
                                        title: "",
                                        key: "act",
                                        width: 72,
                                        render: (_, r) => (
                                          <Space size={0}>
                                            <Button
                                              type="text"
                                              size="small"
                                              icon={<EditOutlined />}
                                              style={{ color: "#1a3353" }}
                                              onClick={() => {
                                                openCellEntryForEdit(r, {
                                                  setDraft: setClosedCellDraft,
                                                  setEditingKey: setEditingClosedCellKey,
                                                  setOpen: setClosedCellModalOpen,
                                                });
                                              }}
                                            />
                                            <Button
                                              type="text"
                                              danger
                                              size="small"
                                              icon={<DeleteOutlined />}
                                              onClick={() =>
                                                setClosedCellEntries((prev) =>
                                                  prev.filter(
                                                    (e) => e.key !== r.key,
                                                  ),
                                                )
                                              }
                                            />
                                          </Space>
                                        ),
                                      },
                                    ].filter(Boolean)}
                                  />
                                ),
                              },
                              {
                                key: "haulers",
                                label: (
                                  <Space>
                                    <TeamOutlined
                                      style={{ color: "#614700" }}
                                    />
                                    <Text strong style={{ color: "#614700" }}>
                                      Accredited Haulers
                                      {haulers.length > 0
                                        ? ` (${haulers.length})`
                                        : ""}
                                    </Text>
                                  </Space>
                                ),
                                children: (
                                  <div>
                                    <div
                                      style={{
                                        marginBottom: 12,
                                        display: "flex",
                                        gap: 8,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <Button
                                        type="primary"
                                        icon={<PlusOutlined />}
                                        className="slf-primary-btn"
                                        onClick={() => openHaulerModal(null)}
                                        disabled={baselineSaved}
                                      >
                                        Add Hauler
                                      </Button>
                                      <Button
                                        icon={<UploadOutlined />}
                                        onClick={() =>
                                          openUploadGuide("hauler")
                                        }
                                        disabled={baselineSaved}
                                      >
                                        Upload Excel/CSV
                                      </Button>
                                      <Button
                                        icon={<DownloadOutlined />}
                                        onClick={exportHaulerData}
                                        disabled={!haulers.length}
                                      >
                                        Export Hauler Data
                                      </Button>
                                      <Button
                                        type="primary"
                                        
                                        onClick={downloadHaulerTemplate}
                                      >
                                        Download Sample Template
                                      </Button>
                                    </div>
                                    <Table
                                      dataSource={haulers}
                                      columns={haulerColumns}
                                      rowKey="key"
                                      size="small"
                                      pagination={{
                                        defaultPageSize: 10,
                                        showSizeChanger: true,
                                        pageSizeOptions: ["10", "20", "50", "100"],
                                        showTotal: (total) => `${total} hauler(s)`,
                                      }}
                                      scroll={{ x: 980 }}
                                      locale={{
                                        emptyText: (
                                          <Text
                                            type="secondary"
                                            style={{ fontSize: 13 }}
                                          >
                                            No haulers added.
                                          </Text>
                                        ),
                                      }}
                                    />
                                  </div>
                                ),
                              },
                            ]}
                          />

                          {/* ── Save Baseline Update Button (visible when admin approved editing) ── */}
                          {!baselineSaved && (
                            <div
                              ref={baselineActionRef}
                              style={{
                                marginTop: 24,
                                paddingTop: 16,
                                borderTop: "1px solid #e8e8e8",
                                display: "flex",
                                justifyContent: "flex-end",
                              }}
                            >
                              <Button
                                type="primary"
                                size="large"
                                icon={<SaveOutlined />}
                                loading={baselineSavingLoading}
                                onClick={handleSaveBaselinePortal}
                                style={{
                                  background: "#1a3353",
                                  borderColor: "#1a3353",
                                  paddingLeft: 28,
                                  paddingRight: 28,
                                }}
                              >
                                Save Baseline Update
                              </Button>
                            </div>
                          )}
                        </Form>
                      </div>
                    ),
                  },
                  {
                    key: "disposal",
                    label: (
                      <span>
                        <FileTextOutlined />{" "}
                        {isMobile
                          ? "Waste Generator Info"
                          : "Waste Generator Information"}
                        <RequiredDot
                          show={
                            missingDisposalInfo ||
                            missingHazardousCodeTrucks.length > 0
                          }
                        />
                      </span>
                    ),
                    children: (
                      <WasteGeneratorPane
                        entryForm={entryForm}
                        trucks={trucks}
                        haulers={haulers}
                        slfUnit={slfUnit}
                        activeCellOptions={activeCellOptions}
                        isMobile={isMobile}
                        isRequired={isRequired}
                        fl={fl}
                        missingDisposalInfo={missingDisposalInfo}
                        missingHazardousCodeTrucks={missingHazardousCodeTrucks}
                        truckPage={truckPage}
                        setTruckPage={setTruckPage}
                        truckPageSize={truckPageSize}
                        setTruckPageSize={setTruckPageSize}
                        selectedTruckKeys={selectedTruckKeys}
                        setSelectedTruckKeys={setSelectedTruckKeys}
                        truckBulkCell={truckBulkCell}
                        setTruckBulkCell={setTruckBulkCell}
                        openTruckModal={openTruckModal}
                        removeTruck={removeTruck}
                        assignSelectedTrucksToCell={assignSelectedTrucksToCell}
                        openUploadGuide={openUploadGuide}
                        setActiveTab={setActiveTab}
                      />
                    ),
                  },
                ])}
                />
              </div>
            </Card>
          </Col>
          <Col xs={24} xl={5}>
            {/* #11: Incomplete hauler-client warning — derived from the already-
                loaded baseline haulers (no extra fetch), recalculated whenever the
                clients change. Non-blocking; distinct from validation errors. */}
            {(() => {
              // #11: list EACH incomplete hauler-client pair and the EXACT detail(s)
              // that are missing, instead of only a count — so the user knows which
              // client (and which field) to fix.
              const issues = [];
              (haulers || []).forEach((h) => {
                const haulerName = String(h.haulerName || "").trim();
                (h.privateSectorClients || []).forEach((c) => {
                  const missing = [];
                  if (!String(c.clientName || "").trim()) missing.push("Client Name");
                  if (!String(c.clientType || "").trim()) missing.push("Client Type");
                  if (!String(c.provinceName || c.province || "").trim()) missing.push("Province");
                  if (!String(c.municipalityName || c.municipality || "").trim()) missing.push("Municipality");
                  if (!haulerName) missing.push("Hauler Name");
                  if (missing.length) {
                    issues.push({
                      hauler: haulerName || "(unnamed hauler)",
                      client: String(c.clientName || "").trim() || "(unnamed client)",
                      missing,
                    });
                  }
                });
              });
              if (!issues.length) return null;
              return (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12, borderRadius: 8 }}
                  message={<Text strong style={{ fontSize: 12 }}>{issues.length} incomplete hauler-client record{issues.length === 1 ? "" : "s"}</Text>}
                  description={
                    <div style={{ fontSize: 12 }}>
                      <div style={{ marginBottom: 6 }}>
                        Complete the following client details for accurate regional reporting and submission validation:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 168, overflowY: "auto" }}>
                        {issues.slice(0, 12).map((it, i) => (
                          <li key={i} style={{ marginBottom: 3 }}>
                            <Text strong>{it.hauler}</Text>
                            {" → "}
                            <Text>{it.client}</Text>
                            {": "}
                            <Text type="danger">missing {it.missing.join(", ")}</Text>
                          </li>
                        ))}
                      </ul>
                      {issues.length > 12 && (
                        <Text type="secondary">+{issues.length - 12} more record(s)…</Text>
                      )}
                      <div style={{ marginTop: 8 }}>
                        <Button size="small" type="primary" onClick={() => setActiveTab("baseline")}>
                          Complete in Baseline Data
                        </Button>
                      </div>
                    </div>
                  }
                />
              );
            })()}
            <Card
              className="slf-section"
              title={
                <Space>
                  <QuestionCircleOutlined style={{ color: "#1a3353" }} />
                  <Text strong style={{ color: "#1a3353" }}>
                    Data Entry Guide
                  </Text>
                </Space>
              }
              style={{ position: isMobile ? "static" : "sticky", top: 76 }}
            >
              <Collapse
                size="small"
                bordered={false}
                style={{ background: "transparent" }}
                items={[
                  {
                    key: "baseline",
                    label: (
                      <Text strong style={{ fontSize: 12 }}>
                        Baseline Data
                      </Text>
                    ),
                    children: renderGuideItems(
                      [
                        "Select the unit that matches your encoded volume before adding cell entries.",
                        "Encode total volume accepted since start of operation.",
                        "Add active and closed cell entries with the correct waste type and unit.",
                        "Add accredited haulers and vehicle/client details before the first submission.",
                      ],
                      "#1677ff",
                    ),
                  },
                  {
                    key: "generator",
                    label: (
                      <Text strong style={{ fontSize: 12 }}>
                        Waste Generator Info
                      </Text>
                    ),
                    children: renderGuideItems(
                      [
                        "Choose the disposal date and add each transport entry.",
                        "Use Treated Hazardous Waste only for treated hazardous loads.",
                        "Hazardous Waste Code is required for every Treated Hazardous Waste entry.",
                        "Review truck plate, hauler, capacity, actual volume, and unit before submitting.",
                      ],
                      "#52c41a",
                    ),
                  },
                  {
                    key: "submission-rules",
                    label: (
                      <Text strong style={{ fontSize: 12 }}>
                        Submission Rules
                      </Text>
                    ),
                    children: renderGuideItems(
                      [
                        `All transport entries use your declared baseline unit ${(baselineUnit || slfUnit).replace("m3", "m³")}; mixed units are rejected on submit.`,
                        "Vehicle Capacity is required for every accredited-hauler vehicle (the over-capacity check needs it).",
                        "Truck Capacity is required for uploaded rows; when entered it must be greater than 0.",
                        "A truck's capacity may not exceed its registered capacity by more than 10%.",
                        "Complete past submissions with unassigned waste in Organize Cells before submitting new entries.",
                      ],
                      "#eb2f96",
                    ),
                  },
                  {
                    key: "notes",
                    label: (
                      <Text strong style={{ fontSize: 12 }}>
                        Reminders
                      </Text>
                    ),
                    children: renderGuideItems(
                      [
                        "Baseline data locks after submission unless an admin approves an update request.",
                        "Add hauler + client details (name, type, province, city) before the first submission.",
                        "Use My Requests to track update and edit requests; Submission History for status.",
                      ],
                      "#fa8c16",
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

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
          marginLeft: isMobile ? 0 : collapsed ? 64 : 220,
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
        <Header
          className="portal-header"
          style={{
            background: "#fff",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
            position: "sticky",
            top: 0,
            zIndex: 9,
            height: 56,
          }}
        >
          <Space>
            {isMobile && (
              <Button
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileDrawer(true)}
              />
            )}
          </Space>
          <Space size={8}>
            <Popover
              trigger="click"
              placement="bottomRight"
              open={notificationPanelOpen}
              onOpenChange={setNotificationPanelOpen}
              content={
                <PortalNotificationPanel
                  isMobile={isMobile}
                  portalNotifications={portalNotifications}
                  portalNotificationCounts={portalNotificationCounts}
                  getPortalNotificationMeta={getPortalNotificationMeta}
                  openPortalNotification={openPortalNotification}
                  markPortalNotificationsRead={markPortalNotificationsRead}
                  setNotificationPanelOpen={setNotificationPanelOpen}
                  setPreviousNotifOpen={setPreviousNotifOpen}
                />
              }
            >
              <Badge count={portalNotificationCounts.total} size="small">
                <Button
                  type={
                    portalNotificationCounts.total > 0 ? "primary" : "default"
                  }
                  shape="circle"
                  icon={<BellOutlined />}
                  aria-label="Open notifications"
                />
              </Badge>
            </Popover>
            <Tooltip title="Messages from admin">
              <Badge count={portalNotificationCounts.messages} size="small">
                <Button
                  type={
                    portalNotificationCounts.messages > 0
                      ? "primary"
                      : "default"
                  }
                  shape="circle"
                  icon={<MessageOutlined />}
                  onClick={() => {
                    setMessageDrawerOpen(true);
                    if (supportTickets.length === 0) fetchSupportTickets();
                    markPortalNotificationsRead("messages");
                  }}
                />
              </Badge>
            </Tooltip>
            <Tooltip title="Support tickets">
              <Badge count={portalNotificationCounts.support} size="small">
                <Button
                  shape="circle"
                  icon={<CustomerServiceOutlined />}
                  onClick={() => {
                    setSupportDrawerOpen(true);
                    setSupportTab("my-tickets");
                    if (supportTickets.length === 0) fetchSupportTickets();
                    markPortalNotificationsRead("support");
                  }}
                />
              </Badge>
            </Tooltip>
            <Dropdown
              menu={{
                items: userMenuItems,
                onClick: ({ key }) => {
                  if (key === "profile") setProfileModalOpen(true);
                  if (key === "logout") handleLogout();
                },
              }}
              trigger={["click"]}
            >
              <Space style={{ cursor: "pointer" }}>
                <Avatar
                  size="small"
                  style={{
                    background: "linear-gradient(135deg, #1a3353, #2d5f8a)",
                  }}
                >
                  {portalUser?.firstName?.[0]?.toUpperCase()}
                </Avatar>
                {!isMobile && (
                  <Text style={{ color: "#1a3353", fontWeight: 500 }}>
                    {userDisplay}
                  </Text>
                )}
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {/* Content */}
        <Content
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
              so this states WHOSE data is on screen and that the session cannot
              write. (The backend enforces read-only regardless of this banner.) */}
          {isDeveloperContext && (
            <div
              style={{
                background: "linear-gradient(90deg, #531dab 0%, #722ed1 100%)",
                color: "#fff",
                padding: "10px 16px",
                borderRadius: 8,
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                fontSize: 13,
              }}
            >
              <EyeOutlined />
              <Text strong style={{ color: "#fff" }}>Developer View</Text>
              <span style={{ opacity: 0.75 }}>·</span>
              <span>
                Viewing: <strong>{activeSlfName || "—"}</strong>
              </span>
              <span style={{ opacity: 0.75 }}>·</span>
              <span>
                Portal User:{" "}
                <strong>
                  {[portalUser?.firstName, portalUser?.lastName].filter(Boolean).join(" ") ||
                    portalUser?.email}
                </strong>
              </span>
              <Tag color="gold" style={{ marginInlineStart: "auto", marginInlineEnd: 0 }}>
                READ-ONLY
              </Tag>
            </div>
          )}
          {!isOnline && (
            <div
              style={{
                background: "linear-gradient(90deg, #7c3a10 0%, #b45309 100%)",
                color: "#fff",
                padding: "8px 16px",
                borderRadius: 8,
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <WifiOutlined />
              You are currently offline. Some features may be unavailable. Data
              will be sent once your connection is restored.
            </div>
          )}
          {portalAnnouncement && !announcementDismissed && (
            <div ref={announcementBannerRef}>
              <Collapse
              size="small"
              style={{
                marginBottom: 12,
                borderRadius: 8,
              }}
              items={[
                {
                  key: "announcement",
                  label: (
                    <Space wrap>
                      <Text strong>
                        {portalAnnouncement.portalAnnouncementTitle ||
                          "SLF Portal Announcement"}
                      </Text>
                      <Tag color="blue">Announcement</Tag>
                    </Space>
                  ),
                  extra: (
                    <Space size={4} onClick={(event) => event.stopPropagation()}>
                      {isPortalUpdateAnnouncement && (
                        <Button
                          size="small"
                          type="text"
                          onClick={() => openPortalUpdateTour()}
                        >
                          What's New Tour
                        </Button>
                      )}
                      {portalAnnouncement.portalAnnouncementDismissible !== false ? (
                        <Button
                          size="small"
                          type="text"
                          onClick={() => {
                            setAnnouncementDismissed(true);
                          }}
                        >
                          Dismiss
                        </Button>
                      ) : null}
                    </Space>
                  ),
                  children: (
                    <Alert
                      type={portalAnnouncement.portalAnnouncementType || "info"}
                      showIcon
                      message={null}
                      description={
                        <Space
                          direction="vertical"
                          size={8}
                          style={{ width: "100%" }}
                        >
                          <div style={{ whiteSpace: "pre-wrap" }}>
                            {portalAnnouncement.portalAnnouncementMessage}
                          </div>
                        </Space>
                      }
                    />
                  ),
                },
              ]}
              />
            </div>
          )}
          {(portalNotificationCounts.messages > 0 ||
            portalNotificationCounts.support > 0) && (
            <Card
              size="small"
              style={{
                marginBottom: 12,
                borderRadius: 8,
                borderColor: "#91caff",
                background: "#e6f4ff",
              }}
              bodyStyle={{ padding: "10px 14px" }}
            >
              <Space
                wrap
                style={{ width: "100%", justifyContent: "space-between" }}
              >
                <Space>
                  <BellOutlined style={{ color: "#1677ff" }} />
                  <Text strong>You have unread admin updates</Text>
                  {portalNotificationCounts.messages > 0 && (
                    <Tag color="blue">
                      {portalNotificationCounts.messages} message(s)
                    </Tag>
                  )}
                  {portalNotificationCounts.support > 0 && (
                    <Tag color="purple">
                      {portalNotificationCounts.support} ticket update(s)
                    </Tag>
                  )}
                </Space>
                <Space>
                  {portalNotificationCounts.messages > 0 && (
                    <Button
                      size="small"
                      type="primary"
                      icon={<MessageOutlined />}
                      onClick={() => {
                        setMessageDrawerOpen(true);
                        if (supportTickets.length === 0) fetchSupportTickets();
                        markPortalNotificationsRead("messages");
                      }}
                    >
                      Open Messages
                    </Button>
                  )}
                  {portalNotificationCounts.support > 0 && (
                    <Button
                      size="small"
                      icon={<CustomerServiceOutlined />}
                      onClick={() => {
                        setSupportDrawerOpen(true);
                        setSupportTab("my-tickets");
                        if (supportTickets.length === 0) fetchSupportTickets();
                        markPortalNotificationsRead("support");
                      }}
                    >
                      View Tickets
                    </Button>
                  )}
                </Space>
              </Space>
            </Card>
          )}
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
              onCreateSubmission={() => setActiveMenu("data-entry")}
              onViewSubmissions={() => setActiveMenu("history")}
              onOrganizeCells={openCellOrganizer}
              onBulkOrganize={async () => {
                // Ensure the unplaced placements are loaded before opening the bulk
                // modal (it reuses cellOrganizerData); open the organizer silently
                // if empty, then surface the bulk uploader.
                if (cellOrganizerData.length === 0) await openCellOrganizer();
                setBulkOrganizeOpen(true);
              }}
            />
          )}
          {activeMenu === "data-entry" && renderDataEntry()}
          {activeMenu === "history" && (
            <HistoryPanel
              submissions={submissions}
              historyColumns={historyColumns}
              loadingSubmissions={loadingSubmissions}
              onRefresh={() => fetchSubmissions(false, true)}
            />
          )}
          {activeMenu === "requests" && (
            <RequestsPanel
              myRequests={myRequests}
              myRequestsLoading={myRequestsLoading}
              onHideRequest={handleHideRequest}
            />
          )}
          {activeMenu === "drafts" && (
            <DraftsScheduledPanel
              portalUser={portalUser}
              isMobile={isMobile}
              onSubmitted={() => {
                invalidateCache(
                  `${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`,
                );
                fetchSubmissions(true, true);
              }}
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

        {ORGANIZE_CELLS_ENABLED && (
          <Modal
            title={
              <Space>
                <ContainerOutlined style={{ color: "#722ed1" }} />
                <span>Organize Cell Placement</span>
                {cellOrganizerData.length > 0 && (
                  <Tag color="purple">{cellOrganizerData.length} submission(s)</Tag>
                )}
                {cellOrganizerData.length > 0 && (
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    onClick={() => setBulkOrganizeOpen(true)}
                  >
                    Bulk Upload
                  </Button>
                )}
              </Space>
            }
            open={cellOrganizerOpen}
            onCancel={() => {
              setCellOrganizerOpen(false);
              // Release the working copy — it holds the FULL trucks[]/vehicles[] of
              // every unplaced submission, which is the heaviest thing the Portal
              // ever puts in memory. Leaving it behind kept that alive for the rest
              // of the session.
              setCellOrganizerData([]);
              setCellOrganizerSelected([]);
              setCellOrganizerExpanded([]);
            }}
            width={960}
            okText="Save Placement"
            okButtonProps={{
              icon: <SaveOutlined />,
              loading: cellOrganizerSaving,
              // No cell can accept waste, so every placement would be invalid.
              // Disabling here is what keeps the warning above honest and stops a
              // partially-valid save from writing an assignment to a full cell.
              disabled: Boolean(cellCapacityNotice),
              title: cellCapacityNotice
                ? "No disposal cell can currently accept waste"
                : undefined,
            }}
            onOk={saveCellOrganizer}
            destroyOnHidden
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", padding: "12px 16px" } }}
          >
            {/* Capacity warning. Shown INSTEAD of the old behaviour, where a full
                cell made the whole organizer render empty with no explanation.
                The rows below still list normally — only the cell dropdowns are
                gated — so the operator can see exactly what is outstanding and
                what has to happen before it can be placed. */}
            {cellCapacityNotice && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={
                  cellCapacityNotice.kind === "at-capacity"
                    ? "Your operational cell is already at 100% capacity"
                    : cellCapacityNotice.kind === "no-cells"
                      ? "No disposal cells are configured"
                      : "No disposal cell can currently accept waste"
                }
                description={
                  <div style={{ fontSize: 12 }}>
                    <div style={{ marginBottom: 6 }}>
                      The entries below still need a disposal cell, but no cell is
                      currently able to accept them. They remain outstanding and are
                      listed here so nothing is lost.
                    </div>
                    {cellCapacityNotice.cells.length > 0 && (
                      <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
                        {cellCapacityNotice.cells.map((c) => (
                          <li key={c.label}>
                            <b>{c.label}</b> — {c.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div>
                      <b>What to do:</b> assign these entries to another cell once one
                      becomes available, or contact the EMB Region III administrator to
                      open or reopen a disposal cell for this facility. Saving is
                      disabled until a cell can accept the waste, so no invalid
                      placement can be recorded.
                    </div>
                  </div>
                }
              />
            )}
            {/* The modal opens instantly; the unassigned placements stream in behind
                this. It used to await the fetch BEFORE opening, so clicking the menu
                left the app sitting with nothing on screen and feeling frozen. */}
            {cellOrganizerLoading ? (
              <div style={{ padding: "56px 0", textAlign: "center" }}>
                <Spin size="large" />
                <div style={{ marginTop: 14 }}>
                  <Text type="secondary">
                    Loading the entries that still need a disposal cell…
                  </Text>
                </div>
                <div style={{ marginTop: 18, maxWidth: 560, margin: "18px auto 0" }}>
                  <Skeleton active paragraph={{ rows: 3 }} />
                </div>
              </div>
            ) : cellOrganizerError ? (
              <Alert
                type="error"
                showIcon
                message="Could not load submissions"
                description={cellOrganizerError}
                action={
                  <Button size="small" loading={cellOrganizerLoading} onClick={openCellOrganizer}>
                    Retry
                  </Button>
                }
              />
            ) : cellOrganizerData.length === 0 ? (
              <Empty description="All your submissions are already organized into cells." />
            ) : (
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                {/* Instructions collapsed by default so the organizer opens on the
                    placement work, not a wall of steps. Expand to review the how-to. */}
                <Collapse
                  size="small"
                  defaultActiveKey={[]}
                  style={{ borderRadius: 8, background: "#e6f4ff", borderColor: "#91caff" }}
                  items={[
                    {
                      key: "how-to",
                      label: (
                        <Space size={6}>
                          <InfoCircleOutlined style={{ color: "#1677ff" }} />
                          <Text strong style={{ fontSize: 13 }}>
                            How to organize your past submissions into cells
                          </Text>
                        </Space>
                      ),
                      children: (
                        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
                          <li><b>Expand a submission card</b> below to see the trucks/vehicles that still need a disposal cell.</li>
                          <li><b>Pick a cell</b> for each row using the cell selector on the right — only cells that are <i>Open for Disposal</i> (active and not full) can be chosen.</li>
                          <li>To place many rows at once, <b>tick the checkboxes</b>, choose a cell in the purple bulk-assign bar, and press <b>Apply</b>.</li>
                          <li>If a row is missing its <b>Truck Capacity</b>, enter it (in your declared baseline unit) — historical entries need this completed here rather than at submission time.</li>
                          <li>Rows fully completed turn green. When everything is placed and every capacity is filled, click <b>Save Placement</b> to update your records and the cell fill levels.</li>
                          <li><b>Organizing is required</b> — new submissions are blocked until all past waste is placed into cells and any missing truck capacities are completed.</li>
                        </ol>
                      ),
                    },
                  ]}
                />

              {/* ── Cell Status Summary ──
                  Reads the SAME canonical admin-side data and helpers the Cell
                  Infra Overview uses, rather than re-deriving its own view:

                  • cell COUNT widens across every cell array (a stale numberOfCell
                    used to truncate the list, or show none at all),
                  • cell NAME comes from the facility's current cellNames, so an
                    admin rename is reflected here instead of a frozen "Cell N",
                  • "Not Existed" cells are excluded, matching the admin,
                  • capacity and fill are NORMALIZED before being compared — they
                    carry independent declared units, and comparing them raw made
                    cells look full when they were not,
                  • status colours come from the centralized cell status resolver
                    instead of a private colour table that could drift. */}
              {(() => {
                // While the facility is still loading, slfCellCount is 0 — returning
                // null here made the whole Cell Status card DISAPPEAR mid-load and
                // then pop in, which reads as "this SLF has no cells". Show the card
                // with a skeleton instead, so the layout is stable and the state is
                // honest: loading ≠ no cells.
                if (slfInfoLoading) {
                  return (
                    <Card size="small" style={{ borderRadius: 8, marginTop: 12 }}>
                      <Skeleton active title={{ width: "30%" }} paragraph={{ rows: 3 }} />
                    </Card>
                  );
                }
                if (!slfCellCount) return null;

                const cells = Array.from({ length: slfCellCount }, (_, idx) => {
                  const stored = slfInfo?.cellStatuses?.[idx];
                  if (isNonExistentCell(stored)) return null;
                  const rawStatus = normalizeCellStatus(stored);
                  const statusConfig = getCellStatusConfig(stored);
                  const typeConfig = getCellTypeConfig(slfInfo?.cellTypes?.[idx]);
                  const type = slfInfo?.cellTypes?.[idx] || "Residual";
                  const submissionAllowed = slfInfo?.cellSubmissionAllowed?.[idx] !== false;
                  const isOpen = isActiveCellStatus(rawStatus);

                  const capUnit = resolveCellUnit(slfInfo, idx, "capacity");
                  const fillUnit = resolveCellUnit(slfInfo, idx, "fill");
                  const capacity = convertVolume(slfInfo?.cellCapacities?.[idx], capUnit, capUnit) ?? 0;
                  const fill = convertVolume(slfInfo?.cellFillValues?.[idx], fillUnit, capUnit) ?? 0;

                  const pct = capacity > 0 ? Math.min(100, Math.round((fill / capacity) * 100)) : null;
                  const isFull = capacity > 0 && fill >= capacity;
                  return {
                    idx,
                    label: resolveCellName(slfInfo, idx),
                    status: rawStatus,
                    statusConfig,
                    typeConfig,
                    capacityStatus: getCapacityStatus(pct),
                    type,
                    submissionAllowed,
                    isOpen,
                    isFull,
                    capacity,
                    fill,
                    capUnit,
                    pct,
                  };
                }).filter(Boolean);
                if (!cells.length) return null;

                // Colours come from the centralized cell status resolver, so the
                // Portal can't drift from the admin's palette. (These replace two
                // private lookup tables that had to be kept in sync by hand.)
                const STATUS_COLOR = Object.fromEntries(
                  cells.map((c) => [c.status, c.statusConfig.color]),
                );
                const STATUS_BG = Object.fromEntries(
                  cells.map((c) => [c.status, c.statusConfig.bg]),
                );

                const pieCounts = cells.reduce((acc, c) => {
                  const key = c.isFull
                    ? "Full / Disabled"
                    : isActiveCellStatus(c.status) && c.submissionAllowed
                    ? "Open for Disposal"
                    : isActiveCellStatus(c.status) && !c.submissionAllowed
                    ? "Active (locked)"
                    : c.status || "Other";
                  acc[key] = (acc[key] || 0) + 1;
                  return acc;
                }, {});
                const PIE_COLORS = {
                  "Open for Disposal": "#52c41a",
                  "Full / Disabled": "#ff4d4f",
                  "Active (locked)": "#faad14",
                  "Used/Completed": "#8c8c8c",
                  "Closed": "#bfbfbf",
                  "Under Construction": "#fa8c16",
                  "Reserved Area": "#1677ff",
                  "Reserved Cell": "#597ef7",
                  "Not Existed": "#d9d9d9",
                };
                const pieData = Object.entries(pieCounts).map(([name, value]) => ({ name, value }));

                return (
                  <Card
                    size="small"
                    style={{
                      borderRadius: 16,
                      border: "1px solid #e7d8ff",
                      background:
                        "linear-gradient(135deg, rgba(114,46,209,0.08) 0%, rgba(255,255,255,0.98) 48%, rgba(24,144,255,0.05) 100%)",
                      boxShadow: "0 10px 30px rgba(114,46,209,0.08)",
                      overflow: "hidden",
                    }}
                    styles={{ body: { padding: "14px 16px 16px" } }}
                    title={
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <Space>
                          <div
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 10,
                              background: "linear-gradient(135deg, #722ed1 0%, #9254de 100%)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 6px 16px rgba(114,46,209,0.24)",
                            }}
                          >
                            <ContainerOutlined style={{ color: "#fff", fontSize: 16 }} />
                          </div>
                          <div>
                            <Text strong style={{ fontSize: 14, display: "block" }}>
                              Cell Infra Overview
                            </Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              Open cells only remain selectable while capacity is still available.
                            </Text>
                          </div>
                        </Space>
                        <Space size={8} wrap>
                          <Space size={6} wrap>
                            <Tag color="green">{activeCellOptions.length} open</Tag>
                            {cells.filter((c) => c.isFull).length > 0 && (
                              <Tag color="red">{cells.filter((c) => c.isFull).length} full / disabled</Tag>
                            )}
                          </Space>
                          <Button
                            type="text"
                            size="small"
                            aria-label={cellInfraCollapsed ? "Expand Cell Infra Overview" : "Collapse Cell Infra Overview"}
                            icon={cellInfraCollapsed ? <DownOutlined /> : <UpOutlined />}
                            onClick={() => setCellInfraCollapsed((v) => !v)}
                          />
                        </Space>
                      </div>
                    }
                  >
                    {!cellInfraCollapsed && (
                    <Row gutter={[10, 10]} align="middle">
                      {/* Pie chart */}
                      <Col xs={24} sm={8} style={{ textAlign: "center" }}>
                        <ResponsiveContainer width="100%" height={130}>
                          <PieChart>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={36}
                              outerRadius={56}
                              paddingAngle={2}
                              dataKey="value"
                              isAnimationActive={false}
                            >
                              {pieData.map((entry) => (
                                <RCell
                                  key={entry.name}
                                  fill={PIE_COLORS[entry.name] || "#d9d9d9"}
                                />
                              ))}
                            </Pie>
                            <RTooltip
                              formatter={(val, name) => [`${val} cell(s)`, name]}
                              contentStyle={{ fontSize: 11 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div style={{ marginTop: -8 }}>
                          {pieData.map((entry) => (
                            <Space key={entry.name} size={4} style={{ marginRight: 10 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: PIE_COLORS[entry.name] || "#d9d9d9",
                                }}
                              />
                              <Text style={{ fontSize: 10 }}>{entry.name} ({entry.value})</Text>
                            </Space>
                          ))}
                        </div>
                      </Col>

                      {/* Per-cell cards */}
                      <Col xs={24} sm={16}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))",
                            gap: 10,
                          }}
                        >
                          {cells.map((c) => {
                            const color = c.isFull
                              ? "#ff4d4f"
                              : c.isOpen && c.submissionAllowed
                              ? "#52c41a"
                              : c.isOpen
                              ? "#faad14"
                              : STATUS_COLOR[c.status] || "#8c8c8c";
                            const bg = c.isFull
                              ? "linear-gradient(135deg, #fff1f0 0%, #fff 100%)"
                              : c.isOpen && c.submissionAllowed
                              ? "#f6ffed"
                              : c.isOpen
                              ? "#fffbe6"
                              : STATUS_BG[c.status] || "#f5f5f5";
                            const statusLabel = c.isFull
                              ? "Full / Disabled"
                              : c.isOpen && c.submissionAllowed
                              ? "Open"
                              : c.isOpen
                              ? "Active (locked)"
                              : c.status;
                            return (
                              <div
                                key={c.idx}
                                style={{
                                  borderRadius: 14,
                                  border: `1.5px solid ${color}33`,
                                  background: bg,
                                  padding: "10px 11px",
                                  borderLeft: `5px solid ${color}`,
                                  position: "relative",
                                  boxShadow: c.isFull
                                    ? "0 6px 18px rgba(255,77,79,0.10)"
                                    : "0 6px 18px rgba(0,0,0,0.04)",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                    gap: 6,
                                    marginBottom: 2,
                                  }}
                                >
                                  <Text strong style={{ fontSize: 12, display: "block", color }}>
                                    {c.label}
                                  </Text>
                                  <Tag
                                    color={c.isFull ? "red" : c.isOpen && c.submissionAllowed ? "green" : c.isOpen ? "gold" : "default"}
                                    style={{ margin: 0, fontSize: 9, lineHeight: "16px", paddingInline: 6 }}
                                  >
                                    {c.isFull ? "FULL" : c.isOpen && c.submissionAllowed ? "OPEN" : c.isOpen ? "LOCKED" : "OFF"}
                                  </Tag>
                                </div>
                                <Text style={{ fontSize: 10, display: "block", color: "#595959", marginBottom: 1 }}>
                                  {statusLabel}
                                </Text>
                                <Text style={{ fontSize: 10, display: "block", color: "#8c8c8c" }}>
                                  {c.type}
                                </Text>
                                {/* {c.capacity > 0 && (
                                  <Text style={{ fontSize: 9, display: "block", color: "#8c8c8c", marginTop: 4 }}>
                                    {Number(c.fill || 0).toLocaleString()} / {Number(c.capacity).toLocaleString()} {c.capUnit}
                                  </Text>
                                )} */}
                                {c.pct != null && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      height: 6,
                                      borderRadius: 4,
                                      background: "#e0e0e0",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: "100%",
                                        borderRadius: 4,
                                        width: `${c.pct}%`,
                                        background: c.pct >= 90 ? "#ff4d4f" : c.pct >= 75 ? "#faad14" : "#52c41a",
                                      }}
                                    />
                                  </div>
                                )}
                                {c.pct != null && (
                                  <Text style={{ fontSize: 9, color: c.isFull ? "#cf1322" : "#8c8c8c", fontWeight: c.isFull ? 700 : 400 }}>
                                    {c.isFull ? "No longer available" : `${c.pct}% filled`}
                                  </Text>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </Col>
                    </Row>
                    )}
                  </Card>
                );
              })()}

              {/* ── Bulk-assign bar ── */}
              {cellOrganizerSelected.length > 0 && (
                <div
                  style={{
                    background: "linear-gradient(90deg, #391085 0%, #531dab 100%)",
                    borderRadius: 8,
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <Tag color="white" style={{ color: "#531dab", fontWeight: 700, fontSize: 12 }}>
                    {cellOrganizerSelected.length} row(s) selected
                  </Tag>
                  <Select
                    placeholder="Select cell to apply to all"
                    value={cellOrganizerBulkCell}
                    onChange={setCellOrganizerBulkCell}
                    allowClear
                    style={{ flex: 1, minWidth: 200 }}
                    options={activeCellOptions.map((o) => ({ label: o.label, value: o.value }))}
                    size="small"
                  />
                  <Button
                    size="small"
                    type="primary"
                    disabled={!cellOrganizerBulkCell}
                    onClick={applyBulkCellToSelected}
                    style={{ background: "#9254de", borderColor: "#9254de" }}
                    icon={<ContainerOutlined />}
                  >
                    Apply to Selected
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => {
                      setCellOrganizerSelected([]);
                      setCellOrganizerBulkCell(undefined);
                    }}
                    style={{ color: "rgba(255,255,255,0.75)" }}
                  >
                    Clear
                  </Button>
                </div>
              )}

              {/* ── Collapsible submission cards ── */}
              <Collapse
                accordion={false}
                activeKey={cellOrganizerExpanded}
                onChange={setCellOrganizerExpanded}
                bordered={false}
                style={{ background: "transparent" }}
                items={cellOrganizerData
                  .slice(
                    (cellOrganizerPage - 1) * cellOrganizerPageSize,
                    cellOrganizerPage * cellOrganizerPageSize,
                  )
                  .map((sub) => {
                  // The server already sent ONLY the placements that still need a
                  // cell, each carrying its canonical truckIndex/vehicleIndex — so
                  // there is no walking of trucks here, and nothing already assigned
                  // is loaded or shown.
                  const rows = (sub.placements || []).map((p) => ({
                    rowKey: `${sub._id}|${p.truckIndex}|${
                      Number.isInteger(p.vehicleIndex) ? p.vehicleIndex : "t"
                    }`,
                    truckIndex: p.truckIndex,
                    vehicleIndex: Number.isInteger(p.vehicleIndex) ? p.vehicleIndex : null,
                    plate: p.plateNumber || p.hauler || "-",
                    wasteType: p.wasteType || "Residual",
                    volume: p.actualVolume,
                    volumeUnit: p.actualVolumeUnit || baselineUnit || slfUnit,
                    cellName: p.cellName,
                    needsCell: p.needsCell !== false,
                    needsCapacity: !!p.needsCapacity,
                    capacity: p.capacity,
                  }));

                  // A row is complete when it has a cell (if it needed one) AND a
                  // positive Truck Capacity (if it was missing). Both must be done
                  // before the submission drops off the block list (#6).
                  const isRowComplete = (r) =>
                    (!r.needsCell || !!r.cellName) &&
                    (!r.needsCapacity || Number(r.capacity) > 0);
                  const placedCount = rows.filter(isRowComplete).length;
                  const allPlaced = placedCount === rows.length;
                  const subSelectedCount = rows.filter((r) =>
                    cellOrganizerSelected.includes(r.rowKey),
                  ).length;
                  const allSubSelected = subSelectedCount === rows.length;

                  return {
                    key: sub._id,
                    label: (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          flexWrap: "wrap",
                          width: "100%",
                        }}
                      >
                        {/* select-all checkbox for this submission */}
                        <Checkbox
                          checked={allSubSelected && rows.length > 0}
                          indeterminate={subSelectedCount > 0 && !allSubSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const keys = rows.map((r) => r.rowKey);
                            if (e.target.checked) {
                              setCellOrganizerSelected((prev) => [
                                ...prev.filter((k) => !keys.includes(k)),
                                ...keys,
                              ]);
                            } else {
                              setCellOrganizerSelected((prev) =>
                                prev.filter((k) => !keys.includes(k)),
                              );
                            }
                          }}
                        />
                        <Text strong style={{ fontSize: 13 }}>
                          {sub.idNo || sub.submissionId || "Submission"}
                        </Text>
                        <Tag color="blue">{sub.lguCompanyName || "—"}</Tag>
                        {sub.dateOfDisposal && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {dayjs(sub.dateOfDisposal).format("MM/DD/YYYY")}
                          </Text>
                        )}
                        <Tag
                          color={allPlaced ? "success" : "warning"}
                          style={{ marginLeft: "auto" }}
                        >
                          {placedCount}/{rows.length} placed
                        </Tag>
                      </div>
                    ),
                    style: {
                      borderRadius: 10,
                      marginBottom: 6,
                      border: "1px solid #efdbff",
                      background: "#fdf9ff",
                    },
                    styles: { header: { padding: "10px 14px" }, body: { padding: "0 14px 12px" } },
                    children: (
                      <Table
                        size="small"
                        rowKey="rowKey"
                        pagination={
                          rows.length > 10
                            ? {
                                pageSize: 10,
                                size: "small",
                                showSizeChanger: true,
                                pageSizeOptions: [10, 20, 50, 100],
                                showTotal: (total) =>
                                  `${total} row${total === 1 ? "" : "s"}`,
                              }
                            : false
                        }
                        dataSource={rows}
                        rowSelection={{
                          selectedRowKeys: cellOrganizerSelected.filter((k) =>
                            rows.some((r) => r.rowKey === k),
                          ),
                          onChange: (selectedKeys) => {
                            const otherSubs = cellOrganizerSelected.filter(
                              (k) => !rows.some((r) => r.rowKey === k),
                            );
                            setCellOrganizerSelected([...otherSubs, ...selectedKeys]);
                          },
                          columnWidth: 36,
                        }}
                        columns={[
                          { title: "Truck / Plate", dataIndex: "plate", width: 130, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text> },
                          {
                            title: "Waste Type",
                            dataIndex: "wasteType",
                            width: 150,
                            render: (v) => (
                              <Tag color={/haz|inert/i.test(v) ? "volcano" : "green"} style={{ fontSize: 11 }}>
                                {v}
                              </Tag>
                            ),
                          },
                          {
                            title: "Volume",
                            width: 100,
                            render: (_, r) => (
                              <Text style={{ fontSize: 12 }}>
                                {Number(r.volume || 0).toLocaleString()}{" "}
                                {String(r.volumeUnit).replace("m3", "m³")}
                              </Text>
                            ),
                          },
                          {
                            title: "Disposal Cell",
                            render: (_, r) => {
                              const isHaz = isHazardousWasteType(r.wasteType);
                              const opts = activeCellOptions.filter((o) =>
                                isHaz
                                  ? String(o.cellType || "").toLowerCase().includes("haz")
                                  : !String(o.cellType || "").toLowerCase().includes("haz"),
                              );
                              const cellOpts = opts.length ? opts : activeCellOptions;
                              return (
                                <Select
                                  size="small"
                                  style={{ width: "100%" }}
                                  placeholder="Select open cell"
                                  value={r.cellName || undefined}
                                  allowClear
                                  options={cellOpts.map((o) => ({ label: o.label, value: o.value }))}
                                  onChange={(val) =>
                                    updateOrganizerCell(sub._id, r.truckIndex, r.vehicleIndex, val)
                                  }
                                />
                              );
                            },
                          },
                          {
                            // Historical Truck Capacity completion (#6). Only rows
                            // that are actually missing a capacity render an input;
                            // rows that already have one show it read-only.
                            title: (
                              <span>
                                Truck Capacity{" "}
                                <Text type="secondary" style={{ fontSize: 10, fontWeight: 400 }}>
                                  ({String(baselineUnit || slfUnit).replace("m3", "m³")})
                                </Text>
                              </span>
                            ),
                            width: 140,
                            render: (_, r) =>
                              r.needsCapacity ? (
                                <InputNumber
                                  size="small"
                                  style={{ width: "100%" }}
                                  min={0}
                                  step={0.1}
                                  placeholder="Required"
                                  status={Number(r.capacity) > 0 ? "" : "warning"}
                                  value={Number(r.capacity) > 0 ? r.capacity : undefined}
                                  onChange={(val) =>
                                    updateOrganizerCapacity(sub._id, r.truckIndex, r.vehicleIndex, val)
                                  }
                                />
                              ) : (
                                <Text style={{ fontSize: 12 }}>
                                  {Number(r.capacity) > 0
                                    ? `${Number(r.capacity).toLocaleString()} ${String(baselineUnit || slfUnit).replace("m3", "m³")}`
                                    : "—"}
                                </Text>
                              ),
                          },
                        ]}
                      />
                    ),
                  };
                })}
              />
              {cellOrganizerData.length > cellOrganizerPageSize && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Pagination
                    size="small"
                    current={cellOrganizerPage}
                    pageSize={cellOrganizerPageSize}
                    total={cellOrganizerData.length}
                    showSizeChanger
                    pageSizeOptions={["5", "10", "20", "50"]}
                    showTotal={(total) =>
                      `${total} submission${total === 1 ? "" : "s"}`
                    }
                    onChange={(p, size) => {
                      setCellOrganizerPage(p);
                      setCellOrganizerPageSize(size || cellOrganizerPageSize);
                    }}
                  />
                </div>
              )}
              </Space>
            )}
          </Modal>
        )}

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
          uploadPreviewData={uploadPreviewData}
          uploadPreviewColumns={uploadPreviewColumns}
          uploadMissingColumns={uploadMissingColumns}
          setUploadPreviewData={setUploadPreviewData}
          setUploadPreviewColumns={setUploadPreviewColumns}
          setUploadMissingColumns={setUploadMissingColumns}
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
        <Modal
          title={
            <Space>
              <ClockCircleOutlined style={{ color: "#1677ff" }} />
              <span>Schedule Automatic Submission</span>
            </Space>
          }
          open={scheduleModalOpen}
          onCancel={() => setScheduleModalOpen(false)}
          onOk={handleScheduleSubmission}
          okText="Schedule"
          okButtonProps={{ loading: schedulingSubmit, icon: <ClockCircleOutlined /> }}
          destroyOnHidden
        >
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            Choose when this submission should be sent automatically. Your encoded
            data is saved now and submitted at the scheduled time.
          </Text>
          <DatePicker
            showTime
            style={{ width: "100%" }}
            value={scheduleAt}
            onChange={setScheduleAt}
            disabledDate={(d) => d && d < dayjs().startOf("day")}
            placeholder="Select date & time"
          />
        </Modal>
        <Tour
          open={updateTourOpen}
          current={updateTourCurrent}
          onChange={setUpdateTourCurrent}
          onClose={() => {
            setUpdateTourOpen(false);
            // Mark as permanently dismissed for this user
            const stableKey = portalUser?.email
              ? `${PORTAL_TOUR_DISMISSED_PREFIX}${portalUser.email}`
              : null;
            if (stableKey) secureStorage.set(stableKey, "1");
            if (portalUpdateTourSeenKey) {
              secureStorage.set(portalUpdateTourSeenKey, "1");
            }
          }}
          onFinish={() => {
            setUpdateTourOpen(false);
            // Also mark as dismissed when user completes all steps
            const stableKey = portalUser?.email
              ? `${PORTAL_TOUR_DISMISSED_PREFIX}${portalUser.email}`
              : null;
            if (stableKey) secureStorage.set(stableKey, "1");
            if (portalUpdateTourSeenKey) {
              secureStorage.set(portalUpdateTourSeenKey, "1");
            }
          }}
          steps={updateTourSteps}
        />

        {/* Bulk submit progress — percentage feedback for large submissions */}
        <Modal
          open={submitProgress.open}
          closable={false}
          maskClosable={false}
          keyboard={false}
          footer={null}
          centered
          title={
            <Space>
              <SendOutlined style={{ color: "#1a3353" }} />
              <span>Submitting Disposal Data</span>
            </Space>
          }
        >
          <Progress
            percent={submitProgress.percent}
            status={
              submitProgress.error
                ? "exception"
                : submitProgress.percent >= 100
                  ? "success"
                  : "active"
            }
            strokeColor={submitProgress.error ? undefined : "#1a3353"}
          />
          <Text
            type={submitProgress.error ? "danger" : "secondary"}
            style={{ display: "block", marginTop: 10 }}
          >
            {submitProgress.text}
          </Text>
          {!submitProgress.error && (
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 4 }}>
              Please keep this window open until the submission completes.
            </Text>
          )}
        </Modal>
        {/* Item #4: EMB Region III messages are shown via a queued SweetAlert2
            (see the msgShowingRef effect above) — no inline modal needed. */}
      </Layout>
    </Layout>
    </SensitiveMaskProvider>
  );
}
