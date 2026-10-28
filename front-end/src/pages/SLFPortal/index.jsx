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
  Skeleton,
  message,
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
import api, { logClientError } from "../../api";
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
  PORTAL_FEATURE_TOUR_SEEN_PREFIX,
  PORTAL_FEATURE_TOUR_OPT_OUT_PREFIX,
  ORGANIZE_CELLS_ENABLED,
} from "./constants";
import {
  PORTAL_FEATURE_TOUR_VERSION,
  PORTAL_FEATURE_TOUR_STEPS,
  PORTAL_FEATURE_TOUR_VERA_PROMPT,
} from "./portalFeatureTour";
import {
  validateWasteGeneration,
  formatWasteGenIssues,
  validateTransportUnits,
  validateCapacityMagnitude,
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
  splitOrganizerWork,
  plannedM3ByCell,
  cellChoicesFor,
  applyCellToRows,
  autoPlace,
  organizerProgress,
  rowVolumeM3,
  roomLeftM3,
} from "./organizeCellRules";
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
  buildHaulerExportRows,
} from "./haulerNormalization";
import {
  uploadHeaderKey,
  isEmptyUploadValue,
  cleanUploadText,
  parseUploadNumber,
  normalizeUploadUnit,
  getUploadMissingColumns,
  getUploadRowErrors,
  getUploadRelationshipErrors,
  findUploadHauler,
  findUploadClientsForHauler,
  resolveUploadCell,
  parseHaulerUploadRow,
  annotateHaulerUploadRows,
  summarizeHaulerUpload,
  UPLOAD_COLUMNS,
} from "./uploadHelpers";
import {
  buildHaulerVeraContext,
  HAULER_VERA_ASSESSMENT_PROMPT,
} from "./haulerVeraContext";
import {
  alignDisposalRow,
  detectSystemGeneratedFile,
  isTripRow,
  summarizeAlignment,
} from "./systemGeneratedUpload";
import { summarizeBaselineCompleteness } from "./baselineCompleteness";
import BaselineCompletionModal from "./BaselineCompletionModal";
import { inheritEntryCell, vehicleNeedsCell } from "./cellPlacement";
import {
  buildDisposalVeraContext,
  DISPOSAL_VERA_ASSESSMENT_PROMPT,
} from "./disposalVeraContext";
import { convertVolume, resolveCellUnit, resolveFacilityUnit } from "../../utils/volumeUnits";
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
function resolveTotalVolumeForSave({
  authoritative,
  computed,
  mountedValue,
  storeValue,
  baselineValue,
}) {
  const candidate = authoritative ? computed : (mountedValue ?? storeValue);
  const explicitlyOnScreen =
    mountedValue !== undefined && mountedValue !== null && mountedValue !== "" && Number(mountedValue) > 0;
  const meaningful = authoritative || explicitlyOnScreen || Number(candidate) > 0;
  if (meaningful) return candidate;
  return Number(baselineValue) > 0 ? baselineValue : undefined;
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

/**
 * A handler whose IDENTITY never changes but whose BODY is always the latest one.
 *
 * Memoized children (OverviewPanel) re-render whenever a prop identity changes.
 * An inline `onClick={() => ...}` is a new function on every render, so the child
 * re-renders every time regardless of whether its data moved — which is what made
 * `memo()` on those panels do nothing.
 *
 * `useCallback` would be the usual answer, but it needs an exact dependency list,
 * and a missed dependency here means a handler quietly closing over stale state —
 * a correctness bug traded for a performance win. This keeps the newest closure in
 * a ref and hands out one stable wrapper, so there is no dependency list to get
 * wrong and no stale reads.
 */
function useStableCallback(fn) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args) => ref.current?.(...args), []);
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
  // Which Collapse section Edit Accredited Hauler opens on ("basic" | "clients").
  const [haulerModalFocus, setHaulerModalFocus] = useState("basic");
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
  // Bumped by the socket handler when something an admin changed affects the
  // client roster. Sits beside the two counters above for the same reason: the
  // fetch it drives lives far below the handler that needs to trigger it.
  const [wasteReceivedRefresh, setWasteReceivedRefresh] = useState(0);
  // The last bump the waste-received effect acted on, so a plain menu switch is
  // told apart from an admin-driven invalidation.
  const lastWasteRefreshRef = useRef(0);
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
  // The SLF's Total Volume Accepted as the SERVER resolves it (GET /baseline).
  //
  // Held apart from the form on purpose. The form is written by several hydration
  // paths — the baseline load, the socket refresh, Edit & Resubmit — and any of
  // them can leave it blank or stamp a submission's stale snapshot over it. This
  // is the facility-level fact, so it is the authority for what to display, what
  // to send, and whether the submit gate is satisfied. `null` = the server has no
  // value for this SLF, which is a real state and different from "not loaded".
  const [baselineTotalVolume, setBaselineTotalVolume] = useState(null);
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
  const supportTicketsLoadAttemptedRef = useRef(false);
  const [portalNotifications, setPortalNotifications] = useState([]);
  const [portalUnreadCount, setPortalUnreadCount] = useState(0);
  // Queued drafts / scheduled runs that failed to submit — drives the sidebar
  // badge on Drafts & Scheduled.
  const [queueAttentionCount, setQueueAttentionCount] = useState(0);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  // "Previous Notifications" full-history modal + the single notification opened
  // for its complete message. Reuses the already-fetched portalNotifications list
  // (no extra fetch, no second store).
  const [previousNotifOpen, setPreviousNotifOpen] = useState(false);
  const [notifDetail, setNotifDetail] = useState(null);
  const [portalSettings, setPortalSettings] = useState(null);
  const [portalAnnouncement, setPortalAnnouncement] = useState(null);
  // Which announcement VERSION this user dismissed. Version-keyed rather than a
  // boolean so a newly published announcement still reaches them — muting the
  // banner forever would be worse than the reload-and-it's-back behaviour this
  // replaces, since it is how maintenance and rollout notices are delivered.
  const [announcementDismissedVersion, setAnnouncementDismissedVersion] = useState(null);
  // Temporarily overrides the dismissal while the tour is running: the tour's
  // first step points at the banner, so it has to be on screen to be pointed at.
  const [announcementRevealed, setAnnouncementRevealed] = useState(false);
  const [updateTourOpen, setUpdateTourOpen] = useState(false);
  const [updateTourCurrent, setUpdateTourCurrent] = useState(0);
  // "Don't show again" for the What's New tour. The SERVER copy is the source of
  // truth (see PATCH /portal-auth/ui-preferences) because logout wipes
  // localStorage; this holds the resolved answer for the session so neither the
  // tour nor the banner can act before the preferences have been read.
  const [tourDismissed, setTourDismissed] = useState(false);
  const [uiPrefsLoaded, setUiPrefsLoaded] = useState(false);
  const announcementBannerRef = useRef(null);
  // ── Feature tour (versioned, separate from the orientation tour above) ──
  // Records WHICH release the user has seen, so a portal user who dismissed the
  // orientation tour is still shown a workflow change. See portalFeatureTour.js.
  const [featureTourSeenVersion, setFeatureTourSeenVersion] = useState(null);
  // Permanent "Don't show this again" for the feature tour, independent of the
  // release marker above.
  const [featureTourOptOut, setFeatureTourOptOut] = useState(false);
  const [featureTourOpen, setFeatureTourOpen] = useState(false);
  const [featureTourCurrent, setFeatureTourCurrent] = useState(0);
  // Which Baseline sections are expanded. Closed by default, as before — this is
  // state only so the feature tour can open the panel its steps point at.
  const [baselineSections, setBaselineSections] = useState([]);
  const featureTourAutoOpenedRef = useRef(false);
  // Set the instant the orientation tour claims the screen, so the feature
  // tour's auto-open — a separate effect in the same commit — can see it.
  const updateTourClaimedRef = useRef(false);
  const haulerUploadRef = useRef(null);
  const haulerExportRef = useRef(null);
  const haulerTableRef = useRef(null);
  // Feature-tour anchors for this release: the incomplete-records panel, the
  // disposal upload button, and the Transport & Disposal table.
  const baselineGapsRef = useRef(null);
  const truckUploadRef = useRef(null);
  const truckTableRef = useRef(null);
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
  // The fix-everything-in-one-place editor for incomplete baseline records,
  // opened from the warning panel in the Data Entry pane.
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  // What detectSystemGeneratedFile made of the file that is currently previewed
  // (disposal uploads only; null for a hauler upload). Advisory — it changes what
  // the preview explains, never whether a row is valid.
  const [uploadDetection, setUploadDetection] = useState(null);
  // ── VERA assessment of an upload ──
  // Deliberately separate from the validation outcome: "the preview is valid but
  // VERA could not answer" must be sayable without reading as a validation
  // failure. The cycle ref discards a late answer that describes a file the user
  // has already replaced. Named for the hauler upload it was built for; it now
  // also carries the disposal upload's assessment, which asks a different
  // question of a different snapshot but needs exactly this state machine.
  const [haulerVeraStage, setHaulerVeraStage] = useState("idle"); // idle | assessing | done | failed
  const [haulerVeraComment, setHaulerVeraComment] = useState("");
  const [haulerVeraError, setHaulerVeraError] = useState(null);
  const [haulerVeraSource, setHaulerVeraSource] = useState(null);
  const haulerVeraCycleRef = useRef(0);
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
  //
  // Each pane's `children` is a THUNK, and only the open tab's thunk is called.
  // `destroyOnHidden` already keeps hidden panes out of the DOM, but the JSX for
  // all three was still evaluated on every render — building the full element
  // tree for the hauler/vehicle tables and both cell grids even while you were
  // on another tab. That work is what made Data Entry slow to open and sluggish
  // to type in. Now a hidden tab costs nothing until you switch to it.
  const withTabLoading = (items) =>
    items.map((item) => {
      const isLoading = TAB_DEPENDENCIES[item.key]?.() ?? false;
      if (isLoading) {
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
      }
      if (typeof item.children !== "function") return item;
      // Build the open pane only. A hidden pane renders nothing — antd keeps the
      // tab itself, and the forms live above this component, so nothing entered
      // is lost by not rendering the pane.
      return { ...item, children: item.key === activeTab ? item.children() : null };
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

  // Mirrors the server's required-submission gate (routes/dataSLF.js →
  // hasPositiveRequiredNumber): a submission is rejected unless Total Volume
  // Accepted is a POSITIVE number. Testing only for "not empty" let a locked
  // baseline holding 0 / a non-numeric value pass the Review & Submit blockage and
  // then fail at the server with "Baseline Data is incomplete".
  // A watched value is only reliable once its field has been RENDERED. Edit &
  // Resubmit loads a reverted submission and lands the user on the Disposal tab,
  // so General Information is never mounted — every watch read `undefined` and
  // the blockage claimed the company details were missing while the record (and
  // the form store) held them all along. Reading the STORE as the fallback fixes
  // that without losing reactivity: the watches still drive the re-render, the
  // store supplies the value.
  const companyStore = companyForm.getFieldsValue(true) || {};
  const baselineStore = baselineForm.getFieldsValue(true) || {};
  const resolveField = (watched, store, field) =>
    watched !== undefined && watched !== null ? watched : store?.[field];

  // THE Total Volume Accepted this session is working with, in one place.
  //
  // Order matters. The form comes first (an operator editing an unlocked baseline
  // must see their own typing win), and the SERVER's resolved figure backs it —
  // because the form can legitimately be blank while the facility has a value:
  // Edit & Resubmit hydrates from a submission, and a submission's copy is a
  // SNAPSHOT that may be absent or stale. Live example: reverted SLF-LGU-PA-0016
  // stores 0 while Prime Waste Solution's baseline holds 596,981.38 — so opening
  // it put 0 in a DISABLED field and the submit gate reported the baseline
  // incomplete, with no way to fix it from that screen.
  //
  // A stored 0 from the form is still honoured; it is only the ABSENCE of a form
  // value that falls through to the facility's figure.
  const effectiveTotalVolumeAccepted = (() => {
    const fromForm = resolveField(
      watchedTotalVolumeAccepted,
      baselineStore,
      "totalVolumeAccepted",
    );
    if (fromForm !== undefined && fromForm !== null && fromForm !== "") return fromForm;
    return baselineTotalVolume;
  })();
  const missingBaselineInfo = !(Number(effectiveTotalVolumeAccepted) > 0);
  const missingGeneralInfo = [
    resolveField(watchedCompanyName, companyStore, "lguCompanyName"),
    resolveField(watchedCompanyRegion, companyStore, "companyRegion"),
    resolveField(watchedCompanyProvince, companyStore, "companyProvince"),
    resolveField(watchedCompanyMunicipality, companyStore, "companyMunicipality"),
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
  const tourDismissedKey = portalUser?.email
    ? `${PORTAL_TOUR_DISMISSED_PREFIX}${portalUser.email}`
    : null;
  const featureTourSeenKey = portalUser?.email
    ? `${PORTAL_FEATURE_TOUR_SEEN_PREFIX}${portalUser.email}`
    : null;
  const featureTourOptOutKey = portalUser?.email
    ? `${PORTAL_FEATURE_TOUR_OPT_OUT_PREFIX}${portalUser.email}`
    : null;
  // The tour is DUE when the user has not seen THIS release. A user who
  // dismissed the orientation tour, or a previous feature tour, is still shown
  // this one — which is the whole reason the marker is a version.
  // The tour is DUE when this release has not been seen AND the user has not
  // opted out for good. The two are separate answers: finishing or closing the
  // tour says "seen this one", and the next release is new information worth
  // offering once; the "Don't show this again" button says NEVER, and honouring
  // that only until the next version bump made the button's label untrue.
  const featureTourDue =
    !featureTourOptOut && featureTourSeenVersion !== PORTAL_FEATURE_TOUR_VERSION;

  // `manual: true` = the user asked for it from What's New, which always opens.
  // Only the AUTOMATIC opening honours the seen-marker.
  const openFeatureTour = useCallback(
    ({ manual = true } = {}) => {
      if (!manual && !featureTourDue) return;
      // Every step points at something on Data Entry → Baseline → Accredited
      // Haulers, and that panel's content is not mounted while it is collapsed —
      // so it is opened first, or every step would anchor to nothing and antd
      // would render them centred, which reads as a broken tour.
      setActiveMenu("data-entry");
      setActiveTab("baseline");
      setBaselineSections((prev) => (prev.includes("haulers") ? prev : [...prev, "haulers"]));
      setFeatureTourCurrent(0);
      // One frame for the panel to mount its content before antd measures the
      // first target.
      setTimeout(() => setFeatureTourOpen(true), 160);
    },
    [featureTourDue],
  );

  // ONE place that records "seen", used by every exit from the feature tour.
  // The local mirror is written first so the answer survives a failed request;
  // the server copy is what makes it survive logout.
  const markFeatureTourSeen = useCallback(() => {
    setFeatureTourOpen(false);
    setFeatureTourSeenVersion(PORTAL_FEATURE_TOUR_VERSION);
    try {
      if (featureTourSeenKey) secureStorage.set(featureTourSeenKey, PORTAL_FEATURE_TOUR_VERSION);
    } catch { /* storage blocked — the server copy still answers next login */ }
    api
      .patch("/portal-auth/ui-preferences", {
        featureTourVersionSeen: PORTAL_FEATURE_TOUR_VERSION,
      })
      .catch(() => {
        // Best-effort, exactly like the orientation tour: never interrupt the
        // user with an error for closing a tour.
      });
  }, [featureTourSeenKey]);

  // "Don't show this again" — the button, which means NEVER.
  //
  // Records the release as seen AND sets the permanent opt-out. Recording both
  // matters: the opt-out is what stops the next version reopening it, and the
  // version keeps the two answers consistent for anything that reads the marker.
  const optOutOfFeatureTour = useCallback(() => {
    setFeatureTourOpen(false);
    setFeatureTourOptOut(true);
    setFeatureTourSeenVersion(PORTAL_FEATURE_TOUR_VERSION);
    try {
      if (featureTourOptOutKey) secureStorage.set(featureTourOptOutKey, "1");
      if (featureTourSeenKey) secureStorage.set(featureTourSeenKey, PORTAL_FEATURE_TOUR_VERSION);
    } catch { /* storage blocked — the server copy still answers next login */ }
    api
      .patch("/portal-auth/ui-preferences", {
        featureTourOptOut: true,
        featureTourVersionSeen: PORTAL_FEATURE_TOUR_VERSION,
      })
      .catch(() => {
        // Best-effort, like every other tour write: never interrupt somebody for
        // closing a tour. The local mirror already holds it for this browser.
      });
  }, [featureTourOptOutKey, featureTourSeenKey]);

  // Hand the user to VERA with the question already asked, so "tell me more"
  // lands them in a conversation rather than an empty chat. Closing the tour
  // first also marks it seen — they got the walkthrough, just conversationally.
  const askVeraAboutFeature = useCallback(
    (question) => {
      markFeatureTourSeen();
      window.dispatchEvent(
        new CustomEvent("vera:open", {
          detail: { ask: question || PORTAL_FEATURE_TOUR_VERA_PROMPT },
        }),
      );
    },
    [markFeatureTourSeen],
  );

  // `manual: true` = the user clicked "What's New Tour" themselves, which always
  // opens it. Only the AUTOMATIC opening honours the preference — a dismissal
  // that also disabled the button left the user with no way back in.
  const openPortalUpdateTour = useCallback(
    ({ manual = true } = {}) => {
      if (!manual && (tourDismissed || (tourDismissedKey && secureStorage.get(tourDismissedKey) === "1"))) {
        return;
      }
      // Claimed SYNCHRONOUSLY, before any state update. The feature tour's
      // auto-open runs as a separate effect in the SAME commit, where
      // `updateTourOpen` is still the previous render's `false` — so a state
      // flag cannot stop the two from opening on top of each other. A ref is
      // visible immediately, which is what actually holds the second one back.
      updateTourClaimedRef.current = true;
      // Show the banner for the duration of the tour without discarding the
      // user's dismissal — the first step targets it.
      setAnnouncementRevealed(true);
      setActiveMenu("data-entry");
      setUpdateTourCurrent(0);
      setUpdateTourOpen(true);
    },
    [tourDismissed, tourDismissedKey],
  );

  // ONE place that records "never show this again", used by every exit from the
  // tour. The local mirror is written first so the answer survives even if the
  // request fails; the server copy is what makes it survive logout.
  const dismissTourPermanently = useCallback(() => {
    setUpdateTourOpen(false);
    setTourDismissed(true);
    // Hand the banner back to whatever the user's own dismissal says.
    setAnnouncementRevealed(false);
    try {
      if (tourDismissedKey) secureStorage.set(tourDismissedKey, "1");
      if (portalUpdateTourSeenKey) secureStorage.set(portalUpdateTourSeenKey, "1");
    } catch { /* storage blocked — the server copy still answers next login */ }
    api.patch("/portal-auth/ui-preferences", { tourDismissed: true }).catch(() => {
      // Best-effort: the local mirror already suppresses it in this browser, and
      // the next successful dismissal will persist it. Never interrupt the user
      // with an error for closing a tour.
    });
  }, [portalUpdateTourSeenKey, tourDismissedKey]);

  // Dismissing the announcement banner. Persisted against the CURRENT version, so
  // it stays gone across reloads and logins but a new announcement still appears.
  const dismissAnnouncement = useCallback(() => {
    if (!portalAnnouncementVersion) return;
    setAnnouncementDismissedVersion(portalAnnouncementVersion);
    setAnnouncementRevealed(false);
    api
      .patch("/portal-auth/ui-preferences", {
        announcementDismissedVersion: portalAnnouncementVersion,
      })
      .catch(() => {
        // Best-effort, exactly like the tour: it is hidden for this session
        // regardless, and a failed write only costs the banner reappearing later.
      });
  }, [portalAnnouncementVersion]);

  // The banner is hidden only when THIS announcement is the one that was
  // dismissed — and never while the tour is pointing at it.
  const announcementDismissed =
    !announcementRevealed &&
    !!portalAnnouncementVersion &&
    announcementDismissedVersion === portalAnnouncementVersion;

  // Resolve both dismissals once per signed-in user, server first. Until this
  // answers, `uiPrefsLoaded` holds back the tour's auto-open AND the banner, so a
  // slow response can never flash either at somebody who already dismissed them.
  useEffect(() => {
    if (!portalUser?.email) return undefined;
    let cancelled = false;
    // The local mirror answers instantly and covers the offline case; the server
    // is what makes the choice survive logout, which is the whole point.
    let mirrored = false;
    try { mirrored = tourDismissedKey && secureStorage.get(tourDismissedKey) === "1"; } catch { /* blocked */ }
    if (mirrored) setTourDismissed(true);
    try {
      const seen = featureTourSeenKey && secureStorage.get(featureTourSeenKey);
      if (seen) setFeatureTourSeenVersion(seen);
      // The opt-out mirror answers before the server does, so a user who said
      // "never" does not get one flash of the tour on a slow connection.
      if (featureTourOptOutKey && secureStorage.get(featureTourOptOutKey) === "1") {
        setFeatureTourOptOut(true);
      }
    } catch { /* blocked */ }

    api
      .get("/portal-auth/ui-preferences")
      .then(({ data }) => {
        if (cancelled) return;
        if (data?.tourDismissed) {
          setTourDismissed(true);
          // Re-seat the mirror: a logout wiped it, and this is the read that
          // repairs it for the rest of the session.
          try { if (tourDismissedKey) secureStorage.set(tourDismissedKey, "1"); } catch { /* blocked */ }
        }
        if (data?.announcementDismissedVersion) {
          setAnnouncementDismissedVersion(data.announcementDismissedVersion);
        }
        if (data?.featureTourVersionSeen) {
          setFeatureTourSeenVersion(data.featureTourVersionSeen);
          try {
            if (featureTourSeenKey) secureStorage.set(featureTourSeenKey, data.featureTourVersionSeen);
          } catch { /* blocked */ }
        }
        if (data?.featureTourOptOut) {
          setFeatureTourOptOut(true);
          // Re-seat the mirror the same way the orientation tour's does: a logout
          // wipes it, and this read is what repairs it for the session.
          try {
            if (featureTourOptOutKey) secureStorage.set(featureTourOptOutKey, "1");
          } catch { /* blocked */ }
        }
      })
      .catch(() => { /* keep whatever the mirror said */ })
      .finally(() => { if (!cancelled) setUiPrefsLoaded(true); });

    return () => { cancelled = true; };
  }, [portalUser?.email, tourDismissedKey, featureTourSeenKey, featureTourOptOutKey]);

  // Feature-tour steps: copy comes from portalFeatureTour.js (VERA reads the
  // same list), targets are resolved here because the refs are local. A step
  // whose target is not mounted falls back to the haulers panel rather than
  // anchoring to nothing — antd renders a targetless step centred, which reads
  // as a broken tour.
  const featureTourSteps = useMemo(() => {
    // Each step names the TAB its target lives on as well as the ref. The Data
    // Entry tabs render their children lazily, so a step pointing into a tab that
    // is not open would anchor to nothing and antd would centre it — which reads
    // as a broken tour. The order below crosses tabs exactly once.
    const targets = {
      completeness: { ref: baselineGapsRef, tab: "baseline" },
      "special-zones": { ref: haulerTableRef, tab: "baseline" },
      "system-generated": { ref: truckUploadRef, tab: "disposal" },
      mismatch: { ref: truckUploadRef, tab: "disposal" },
      "preview-grid": { ref: truckUploadRef, tab: "disposal" },
      "cell-placement": { ref: truckTableRef, tab: "disposal" },
    };
    return PORTAL_FEATURE_TOUR_STEPS.map((step) => ({
      key: step.key,
      title: step.title,
      description: (
        <div>
          <div style={{ marginBottom: 8 }}>{step.description}</div>
          <Space size={8} wrap>
            <Button
              size="small"
              type="link"
              style={{ padding: 0, height: "auto" }}
              onClick={() => askVeraAboutFeature(step.ask)}
            >
              Ask VERA about this →
            </Button>
            {/* Offered on EVERY step, not only the last. Closing the tour is not
                the same as never wanting to see it — this is the action that says
                so.
                It calls optOutOfFeatureTour, NOT markFeatureTourSeen: the latter
                records only the current release, so the tour came back at the
                next version bump for someone who had explicitly asked it not to.
                What's New still reopens it on demand. */}
            <Button
              size="small"
              type="link"
              style={{ padding: 0, height: "auto", color: "#8c8c8c" }}
              onClick={optOutOfFeatureTour}
            >
              Don&apos;t show this again
            </Button>
          </Space>
        </div>
      ),
      tab: targets[step.key]?.tab || "baseline",
      target: () => targets[step.key]?.ref?.current || haulerTableRef.current,
      placement: "top",
    }));
  }, [askVeraAboutFeature, optOutOfFeatureTour]);

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
        // Say plainly what finishing does. The tour has always stopped appearing
        // once closed or completed — the label makes that a promise the user can
        // see, rather than something they have to test by logging out.
        nextButtonProps: { children: "Got it — don't show again" },
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

  // `preserveSelection` = we are HYDRATING an existing record's address, not
  // reacting to the user picking a new Region. The clearing below is correct for
  // a user change (a new region invalidates the province/municipality/barangay
  // beneath it) but destructive when loading stored values: Edit & Resubmit
  // called all three cascaders straight after setFieldsValue, so the record's
  // Province, Municipality and Barangay were wiped the instant they were loaded.
  const fetchProvinces = (regionCode, { preserveSelection = false } = {}) => {
    setProvinces([]);
    if (!preserveSelection) {
      setMunicipalities([]);
      setBarangays([]);
      companyForm.setFieldsValue({
        companyProvince: undefined,
        companyMunicipality: undefined,
        companyBarangay: undefined,
      });
    }
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

  const fetchMunicipalities = (provinceCode, { preserveSelection = false } = {}) => {
    setMunicipalities([]);
    if (!preserveSelection) {
      setBarangays([]);
      companyForm.setFieldsValue({
        companyMunicipality: undefined,
        companyBarangay: undefined,
      });
    }
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

  const fetchBarangays = (municipalityCode, { preserveSelection = false } = {}) => {
    setBarangays([]);
    if (!preserveSelection) companyForm.setFieldsValue({ companyBarangay: undefined });
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
    // Wait for the tour preference before deciding anything. This check has to
    // come BEFORE the seen-marker below: marking the announcement seen and then
    // bailing out would consume the session's one chance to show it, so a slow
    // preference read would silently swallow the announcement entirely.
    if (!uiPrefsLoaded) return;
    const key = `portal-announcement-seen-${portalAnnouncement.updatedAt || portalAnnouncement._id || portalAnnouncement.portalAnnouncementTitle}`;
    if (secureStorage.sessionGet(key) === "1") return;
    secureStorage.sessionSet(key, "1");
    if (isPortalUpdateAnnouncement) {
      if (
        !tourDismissed &&
        portalUpdateTourSeenKey &&
        secureStorage.get(portalUpdateTourSeenKey) !== "1"
      ) {
        openPortalUpdateTour({ manual: false });
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
    tourDismissed,
    uiPrefsLoaded,
  ]);

  // Auto-open the FEATURE tour once, for a user who has not seen this release.
  //
  // Gated on `uiPrefsLoaded` so a slow preference read can never flash the tour
  // at somebody who already dismissed it, and held behind the orientation tour
  // so the two can never fight over the screen. The ref makes it at most once
  // per mount regardless of how often this re-runs.
  useEffect(() => {
    if (!uiPrefsLoaded || featureTourAutoOpenedRef.current) return;
    if (!portalUser?.email || !featureTourDue) return;
    // Both the state AND the ref: the state covers a later render, the ref
    // covers the orientation tour claiming the screen earlier in THIS commit
    // (which an announcement mentioning "update" or "what's new" triggers).
    // The feature tour stays due, so it opens on the next visit instead.
    if (updateTourOpen || updateTourClaimedRef.current) return;
    featureTourAutoOpenedRef.current = true;
    openFeatureTour({ manual: false });
  }, [uiPrefsLoaded, portalUser?.email, featureTourDue, updateTourOpen, openFeatureTour]);

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
  //
  // …and only while the baseline is UNLOCKED. The auto-calculation exists so that
  // EDITING the cell entries keeps the total honest — but a locked baseline's
  // entries cannot be edited, so recomputing there can only replace the stored
  // figure with a derived one. Two ways that bites:
  //   • Edit & Resubmit loads a reverted submission's cell entries — a SNAPSHOT
  //     taken when that submission was created — into the same state the baseline
  //     tab uses, and the recomputed sum was then sent as the record's Total
  //     Volume Accepted. Live data: 19 of the 26 outstanding reverted submissions
  //     would resubmit a substituted figure, e.g. Prime Waste Solution's real
  //     baseline of 596,981.38 going back as 318,065.35.
  //   • A locked baseline whose stored total legitimately differs from the sum of
  //     its rows (General Tinio stores 9 against rows summing 27) DISPLAYED the
  //     recomputed number, so the portal showed a figure the database did not hold.
  // Locked means "show what is stored", in both cases.
  const cellVolumeTotalIsAuthoritative =
    !baselineSaved && hasCellVolumeEntries && computedTotalVolumeAccepted > 0;

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

  // Bound to this SLF's open cells. ONE resolver shared by the upload parser and
  // the preview editor (see uploadHelpers#resolveUploadCell), so a cell typed or
  // picked in the preview resolves exactly like one that came from the file.
  const resolveUploadCellValue = (value) => resolveUploadCell(activeCellOptions, value);

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
      // convertVolume returns NULL for a unit it cannot convert — deliberately,
      // so nothing counts an unlabelled figure as if it were in the target unit.
      // That null fell straight into the comparison below, and `null > anything`
      // is false, so a load in an unconvertible unit reported "not exceeded" and
      // sailed through the capacity gate no matter how large it was.
      //
      // Unconvertible is NOT "within capacity" — it is "not comparable", and the
      // caller has to say so rather than pass it. Reported, never silently
      // allowed and never silently blocked as an exceedance it isn't.
      if (volInCapUnit === null) {
        return { hasCapacity: true, exceeded: false, unconvertible: true, maxAllowed };
      }
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
        //
        // A placement missing its Truck Capacity is pre-filled from the capacity
        // this SLF already declared for that plate on its baseline (the server
        // resolves it — see buildBaselineCapacityIndex). The operator confirms by
        // saving rather than re-typing a figure they have already encoded; a
        // plate with nothing on file is left blank and still asks for one.
        placements: (sub.placements || []).map((p) =>
          p.needsCapacity && !(Number(p.capacity) > 0) && Number(p.suggestedCapacity) > 0
            ? {
                ...p,
                capacity: Number(p.suggestedCapacity),
                capacityUnit: p.suggestedCapacityUnit || p.capacityUnit || "",
                capacityPrefilled: true,
              }
            : p,
        ),
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

  // The organizer's two jobs, and the session's progress — see organizeCellRules.
  // Placed waste never appears as placement work: it is only listed (separately)
  // when it is still missing a Truck Capacity.
  const organizerWork = useMemo(() => splitOrganizerWork(cellOrganizerData), [cellOrganizerData]);
  const organizerStats = useMemo(() => organizerProgress(cellOrganizerData), [cellOrganizerData]);
  // m³ already chosen per cell in this session — every cell picker counts it.
  const organizerPlanned = useMemo(() => plannedM3ByCell(cellOrganizerData), [cellOrganizerData]);

  // " · 1,234 m³ left" — the cell's room once this session's choices are taken,
  // in the unit the cell picker shows. Empty for a cell with no declared capacity.
  const cellRoomLabel = (opt, planned) => {
    const room = roomLeftM3(opt, planned);
    if (!Number.isFinite(room)) return "";
    const unit = String(opt?.unit || "m³").replace("m3", "m³");
    const shown = convertVolume(room, "m³", unit) ?? room;
    return ` · ${Number(shown).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit} left`;
  };

  const cellPatchFor = (opt) => ({
    cellName: opt?.value || "",
    cellType: opt?.cellType || "",
    cellIndex: opt && typeof opt.cellIndex === "number" ? opt.cellIndex : null,
  });

  // Assign a cell to ONE unassigned placement, addressed by its canonical
  // truckIndex/vehicleIndex (which the server preserved).
  const updateOrganizerCell = (subId, truckIndex, vehicleIndex, cellValue) => {
    const opt = activeCellOptions.find((o) => o.value === cellValue);
    const patch = cellValue ? cellPatchFor(opt) : { cellName: "", cellType: "", cellIndex: null };
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
  // How many capacities the baseline filled in and the operator has not yet
  // overridden — surfaced in the organizer so the prefill is never silent.
  const prefilledCapacityCount = useMemo(
    () =>
      cellOrganizerData.reduce(
        (total, sub) =>
          total +
          (sub.placements || []).filter((p) => p.capacityPrefilled && Number(p.capacity) > 0).length,
        0,
      ),
    [cellOrganizerData],
  );

  const updateOrganizerCapacity = (subId, truckIndex, vehicleIndex, capacityValue) => {
    setCellOrganizerData((prev) =>
      prev.map((sub) => {
        if (sub._id !== subId) return sub;
        return {
          ...sub,
          placements: (sub.placements || []).map((p) =>
            p.truckIndex === truckIndex && p.vehicleIndex === vehicleIndex
              ? {
                  ...p,
                  capacity: capacityValue,
                  capacityUnit: baselineUnit || p.capacityUnit || slfUnit,
                  // Once the operator types over it, it is their figure, not the
                  // baseline's — drop the label.
                  capacityPrefilled: false,
                }
              : p,
          ),
        };
      }),
    );
  };

  // Apply the bulk cell to the checked rows — only those it can legally take.
  // It used to write the chosen cell into EVERY checked row: a residual cell into
  // a hazardous load, or past the cell's remaining room.
  const applyBulkCellToSelected = () => {
    if (!cellOrganizerBulkCell || cellOrganizerSelected.length === 0) return;
    const opt = activeCellOptions.find((o) => o.value === cellOrganizerBulkCell);
    if (!opt) return;
    const res = applyCellToRows(cellOrganizerData, cellOrganizerSelected, opt, cellPatchFor);
    setCellOrganizerData(res.data);
    setCellOrganizerSelected([]);
    setCellOrganizerBulkCell(undefined);
    const skippedTotal = res.skipped.type + res.skipped.capacity;
    if (skippedTotal) {
      const parts = [];
      if (res.skipped.type) parts.push(`${res.skipped.type} whose waste type does not fit ${opt.cellName || opt.value}`);
      if (res.skipped.capacity) parts.push(`${res.skipped.capacity} that would exceed its remaining room`);
      message.warning(`Placed ${res.applied} row(s). Skipped ${parts.join(" and ")}.`, 6);
    } else {
      message.success(`Placed ${res.applied} row(s) in ${opt.cellName || opt.value}.`);
    }
  };

  // Auto-place every row that has no cell yet into the type-compatible open cell
  // with the most room left, largest loads first. Nothing is saved — the operator
  // reviews the choices and presses Save Placement.
  const autoPlaceOrganizer = () => {
    const res = autoPlace(cellOrganizerData, activeCellOptions, cellPatchFor);
    setCellOrganizerData(res.data);
    if (!res.placed && !res.unplaceable) {
      message.info("Every row already has a cell selected.");
    } else if (res.unplaceable) {
      message.warning(
        `Placed ${res.placed} row(s). ${res.unplaceable} could not be placed — no open cell of the right type has room for them.`,
        6,
      );
    } else {
      message.success(`Placed ${res.placed} row(s). Review the cells, then Save Placement.`);
    }
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
              // A placement counts as carrying a cell only with a VALID cell
              // IDENTIFIER. A legacy row can hold a cellName copy with no
              // cellIndex — the server treats that as unassigned (which is why it
              // is offered here). Sending it as `{ cellIndex: null, cellName }`
              // made the backend skip the row while the modal still reported
              // "Waste Placement Saved", so the arrangement never persisted.
              //
              // Only waste that NEEDED a cell sends one. Placed waste listed for
              // its capacity already carries its own cell, and re-sending it made
              // every untouched capacity row look like a change — so "Nothing to
              // Save" could never fire.
              const hasCell = p.needsCell !== false && !!p.cellName && Number.isInteger(p.cellIndex);
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
      // Forced: organizing changes each submission's unplaced/missing-capacity
      // counts, and a cached list would keep showing them as still needing work.
      fetchSubmissions(true, true);
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
      .catch((err) => {
        if (ac.signal.aborted) return;
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
        // Lock is decided FIRST and independently of the payload check below —
        // a baseline saved with company information only still locks.
        const lock = resolveBaselineLock(data);
        setBaselineSaved(lock.locked);
        setBaselineUpdatePending(lock.updatePending);
        // Recorded BEFORE the payload check: this is the facility's figure and it
        // must be held even when the rest of the baseline is thin, because it is
        // what every later fallback reads.
        setBaselineTotalVolume(
          data?.totalVolumeAccepted == null ? null : Number(data.totalVolumeAccepted),
        );

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

  // The other half of the History badge is `revertedCount`, derived from
  // `submissions` — and that list was only refreshed while the History or
  // Overview menu was open (see the effect below). So an admin reverting a
  // submission while the operator was on Data Entry moved the badge not at all
  // until they happened to navigate to the very screen the badge exists to send
  // them to. This subscribes wherever they are; the initial load and the 60s
  // fallback poll stay with the menus that actually render the list, so nothing
  // starts polling in the background.
  useEffect(() => {
    if (!portalUser?.email) return undefined;
    if (activeMenu === "history" || activeMenu === "overview") return undefined; // owned below
    const sock = connectSocket("portal", portalUser.email);
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        fetchSubmissions(true);
      }, 400);
    };
    sock.on("notification", handler);
    sock.on("data-refresh", handler);
    return () => {
      clearTimeout(timer);
      sock.off("notification", handler);
      sock.off("data-refresh", handler);
    };
  }, [activeMenu, portalUser?.email, fetchSubmissions]);

  useEffect(() => {
    if ((activeMenu === "history" || activeMenu === "overview") && portalUser) {
      // Entering history/overview used to blow the cache away and force a full
      // refetch EVERY time, which is why each menu switch showed a loading state
      // for data the portal already had. The force-refresh existed so admin
      // status changes appeared immediately — but the socket handler below
      // already delivers those the moment they happen, and the 60s poll backs it
      // up. So force only when the data is actually cold.
      const subsKey = `subs:${portalUser?.email || ""}`;
      if (!isMenuDataFresh(subsKey)) {
        markMenuFetched(subsKey);
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        fetchSubmissions(false, true);
      }
      // Real-time refresh via socket + fallback 60s polling
      const sock = connectSocket("portal", portalUser.email);
      const handler = () => {
        // Something actually changed — drop the menu-entry cache so the next
        // switch re-reads rather than trusting a now-stale timestamp.
        invalidateMenuCache();
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
      // `hauler-clients` is what the admin's Hauler Clients editor emits (see
      // notifyHaulerClientChange). It was not listed here, so an admin adding,
      // renaming or deleting a client reached the portal and was dropped on the
      // floor — the Overview's Clients Served and Accredited Haulers cards kept
      // showing the pre-edit roster until the page was reloaded by hand.
      const ROSTER_TARGETS = ["facility", "submissions", "baselines", "hauler-clients"];
      if (!target || ROSTER_TARGETS.includes(target)) {
        setSlfInfoRefresh((n) => n + 1);
        invalidateCache(`${PORTAL_SUBMISSIONS_CACHE_KEY}-${portalUser?.email || ""}`);
        fetchSubmissions(true);
        // The client roster comes from the waste-received summary, which nothing
        // here refetched. Bumping the counter is all this handler does — the
        // effect that owns that fetch knows the active SLF (and therefore its
        // cache key), which this closure does not.
        setWasteReceivedRefresh((n) => n + 1);
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
      // A cell is required per vehicle only when neither the vehicle NOR the
      // entry already has one. When the entry has been placed — through Assign to
      // Cell, an upload, or its own cell field — that placement is inherited by
      // every vehicle on save (inheritEntryCell in handleSaveTruck), so demanding
      // it again asks the operator to re-choose a cell the waste is already in.
      if (vehicleNeedsCell(v, truckDraft, activeCellOptions.length))
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
      if (cap.unconvertible) {
        vehErr.actualVolume = `Waste volume unit "${v.actualVolumeUnit}" cannot be compared with the truck capacity unit "${(capacityUnit || slfUnit).replace("m3", "m³")}". Set the volume unit to ${(baselineUnit || slfUnit).replace("m3", "m³")}.`;
      } else if (cap.exceeded) {
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

  // `focus` decides which Collapse section the modal opens on, so the row's
  // client-list action lands the user on Clients instead of making them hunt
  // for it. Note the file picker itself is NOT auto-opened: browsers only allow
  // input.click() inside a user gesture, so a dialog fired on modal mount would
  // be suppressed — the user clicks Upload Client List there.
  const openHaulerModal = (record, focus = "basic") => {
    setHaulerModalFocus(focus);
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
    // Empty means "this edit did not supply an address", never "clear it" — the
    // same rule the company address already uses. Only `officeAddress` is stored
    // on a baseline hauler (the office* PSGC codes are not persisted), so on a
    // re-edit the cascading selects come back empty and the composed string
    // collapses to "" — which used to wipe the saved hauler address.
    const resolvedAddress = addressParts.join(", ") || haulerDraft.officeAddress || "";
    const finalDraft = normalizeHaulerRecord(
      { ...haulerDraft, officeAddress: resolvedAddress },
      0,
      baselineUnit || slfUnit,
    );
    // Drop the blank rows openHaulerModal pads out to `numberOfTrucks`. Persisting
    // them created phantom vehicles with no capacity, which then permanently
    // blocked submission via haulerVehiclesMissingCapacity. Same predicate
    // cleanHaulerForSubmit already uses.
    finalDraft.vehicles = (finalDraft.vehicles || []).filter(
      (v) =>
        v.plateNumber?.trim() ||
        v.vehicleType?.trim() ||
        v.capacity != null ||
        (v.selectedClients || []).length > 0,
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
        // The CELL is inherited by EVERY vehicle, not only the first — unlike the
        // volume and waste type above, which are genuinely per-vehicle and would
        // be double-counted if copied across. A cell is a placement of the whole
        // entry: all of its vehicles went to it. Restricting this to the first
        // vehicle is what left vehicles 2..n of an already-placed entry showing
        // no cell and demanding one.
        cellName: v.cellName || record.cellName || "",
        cellType: v.cellType || record.cellType || "",
        cellIndex:
          typeof v.cellIndex === "number"
            ? v.cellIndex
            : typeof record.cellIndex === "number"
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
      clientName: String(clientDraft.clientName || "").trim(),
      clientAddress: String(clientDraft.clientAddress || "").trim(),
      regionName,
      provinceName,
      municipalityName,
    };
    const existing = haulerDraft.privateSectorClients || [];
    if (editingClientKey != null) {
      // Merge onto the stored record so fields the modal does not edit survive.
      // The legacy `address` alias is dropped: the modal now owns clientAddress,
      // and leaving the alias would resurrect an address the user just cleared.
      updateHaulerDraft(
        "privateSectorClients",
        existing.map((c) => {
          if (c.key !== editingClientKey) return c;
          // eslint-disable-next-line no-unused-vars
          const { address, ...stored } = c;
          return { ...stored, ...toSave, key: editingClientKey };
        }),
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
  //    baseline). CSV with UTF-8 BOM (preserves PH characters) and
  //    formula-injection-safe cells. ──
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
  // The export's headers and field order ARE UPLOAD_COLUMNS.hauler, and every
  // value is placed by buildHaulerExportRows under the field the parser reads it
  // from — so the file this button produces is by construction a file the
  // uploader accepts, i.e. a working bulk-EDIT sheet rather than a read-only
  // report.
  //
  // It used to emit a layout of its own (Hauler Office Address / Client Ref /
  // Region / Province / City/Municipality) with no Number of Trucks column at
  // all and no vehicle columns: the uploader rejected it outright for a missing
  // required column, and its leading address column was read as the hauler's
  // NAME — so nothing exported here could ever be edited and sent back.
  const exportHaulerData = () => {
    const rows = [UPLOAD_COLUMNS.hauler.map((column) => column.label)];
    (haulers || []).forEach((hauler) => {
      buildHaulerExportRows(hauler, baselineUnit || slfUnit).forEach((row) =>
        rows.push(UPLOAD_COLUMNS.hauler.map((column) => row[column.field] ?? "")),
      );
    });
    const who = String(portalUser?.companyName || portalUser?.email || "portal").replace(/[^a-z0-9]+/gi, "_");
    downloadCsv(rows, `hauler-data_${who}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ONE hauler, same 13-column layout — offered inside Edit Accredited Hauler
  // so a single record can be pulled out and corrected without exporting, and
  // then having to find it in, the whole facility's file.
  const exportSingleHaulerData = (hauler) => {
    if (!hauler?.haulerName) return;
    const rows = [
      UPLOAD_COLUMNS.hauler.map((column) => column.label),
      ...buildHaulerExportRows(hauler, baselineUnit || slfUnit).map((row) =>
        UPLOAD_COLUMNS.hauler.map((column) => row[column.field] ?? ""),
      ),
    ];
    const who = String(hauler.haulerName).replace(/[^a-z0-9]+/gi, "_");
    downloadCsv(rows, `hauler-data_${who}_${new Date().toISOString().slice(0, 10)}.csv`);
  };
  // The Accredited Haulers sample template. Its headers, sample values and rules
  // are generated from UPLOAD_COLUMNS.hauler — the same definitions the uploader
  // parses and validates with, and the same ones Export Hauler Data writes — so
  // the template, the export and the uploader are ONE format by construction and
  // a file downloaded here always imports.
  //
  // It previously emitted HAULER_EXPORT_HEADERS (the hauler-DATA export layout),
  // which has no "Number of Trucks" column at all and leads with "Hauler Office
  // Address": the uploader rejected the file for a missing required column, and
  // the office address was read as the hauler's NAME.
  const downloadHaulerTemplate = () => {
    const sampleValue = (field) =>
      UPLOAD_COLUMNS.hauler.find((column) => column.field === field)?.sample || "";
    const haulerRow = (values) =>
      UPLOAD_COLUMNS.hauler.map((column) => {
        // Hauler Name and Number of Trucks identify the hauler and are validated
        // per row, so every row of the same hauler repeats them.
        if (column.field === "haulerName" || column.field === "numberOfTrucks") {
          return column.sample || "";
        }
        return values[column.field] ?? "";
      });
    // Row 1 — a full record: one vehicle plus its clients.
    const sampleRow = UPLOAD_COLUMNS.hauler.map((column) => column.sample || "");
    // Row 2 — the SAME hauler with a different plate, which teaches the
    // one-row-per-vehicle grouping rule instead of describing it.
    const secondVehicleRow = haulerRow({
      plateNumber: "DEF-5678",
      vehicleType: "Compactor",
      capacity: "12",
      capacityUnit: sampleValue("capacityUnit"),
    });
    // Row 3 — a clients-only continuation row: no plate at all, carrying a
    // second client group whose type and location differ from row 1's. This is
    // exactly the shape Export Hauler Data writes for a hauler with more client
    // groups than vehicles, so the template teaches the file the export produces
    // rather than only the file a hand-typed import would.
    const extraClientsRow = haulerRow({
      privateSectorClients: "GHI Municipality",
      clientType: "LGU",
      clientAddress: "Baliuag, Bulacan",
      clientRegion: sampleValue("clientRegion"),
      clientProvince: "Bulacan",
      clientMunicipality: "Baliuag",
    });
    const workbook = buildUploadTemplateWorkbook({
      type: "hauler",
      sheetName: "Accredited Haulers",
      sampleRows: [sampleRow, secondVehicleRow, extraClientsRow],
      listValidations: [
        { label: "Capacity Unit", values: "tons,m3,m³" },
        { label: "Client Type", values: "Private,LGU" },
      ],
      instructions: [
        ["Accredited Haulers Upload Instructions"],
        ["Matching key", "Hauler Name. A name that already exists on this baseline UPDATES that hauler; a new name ADDS one. Matching ignores letter case and extra spaces."],
        ["Nothing is deleted", "This upload only adds and updates. Haulers that are not in the file stay exactly as they are — remove a hauler from the Accredited Haulers table instead."],
        ["One row = one vehicle", "Repeat the Hauler Name on another row to register a second vehicle. The Plate Number identifies the vehicle being updated."],
        ["Blank cells keep stored values", "An empty optional cell means \"leave what is already saved\". It never clears a field."],
        ["Repeated rows", "Two rows with the same Hauler Name AND Plate Number are merged into one — the later non-blank value wins. The preview flags them as Duplicate so an unintended repeat is visible. Rows that carry no Plate Number at all are clients-only rows and are compared by their client list instead."],
        ["Clients", "Comma-separate several client names in one cell. Client Type, Client Address, Client Region, Client Province and Client City/Municipality apply to every client on that row. List clients with a different type or location on another row of the same hauler."],
        ["Client requirements", "A NEW client needs the same details the Add Client form asks for: Client Type (Private or LGU) and Client Province, which is what classifies it within or outside Region 3. On an update these may be left blank to keep what is stored."],
        ["Editing exported data", "\"Export Hauler Data\" writes these exact columns, so the export can be corrected in Excel and uploaded straight back. Row 3 of the sample sheet shows the clients-only row the export uses when a hauler serves more client groups than it has vehicles."],
        ["Saving", "The import updates the on-screen Accredited Haulers table only. Click \"Save Baseline Update\" to persist it."],
        [],
        ["Common upload errors"],
        ["Missing Hauler Name or Number of Trucks column"],
        ["Blank Hauler Name or Number of Trucks value"],
        ["Number of Trucks or Capacity that is zero, negative or not a number"],
        ["Capacity Unit that is not tons, m3 or m³"],
        ["Client Type that is not Private or LGU"],
      ],
    });
    XLSX.writeFile(workbook, "Accredited_Haulers_Template.xlsx");
  };

  const handleSaveTruck = () => {
    if (!validateTruck()) return;
    // Every transport-entry unit is forced to the SLF's declared baseline unit so
    // an entry can never carry a mismatched unit (see validateTransportUnits).
    const entryUnit = baselineUnit || slfUnit;
    // Flatten first vehicle into top-level fields for backward compat.
    //
    // A vehicle with NO cell of its own inherits the ENTRY's placement. The entry
    // is placed as a whole — that is what Assign to Cell does, and what a cell
    // chosen on the entry means — so every vehicle in it went to that cell.
    //
    // This is not cosmetic. The server reads placement from EACH VEHICLE and
    // ignores the truck-level cell when vehicles are present (see
    // portalAuth#summarizeCellAssignment), so a vehicle left without one is
    // counted as unplaced waste and lands the operator in the Organize Cells
    // backlog for an entry they had already placed.
    const vehicles = inheritEntryCell(
      (truckDraft.vehicles || []).map(({ key, ...rest }) => ({
        ...rest,
        capacityUnit: entryUnit,
        actualVolumeUnit: entryUnit,
      })),
      truckDraft,
    );
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
      supportTicketsLoadAttemptedRef.current = true;
    } catch (err) {
      supportTicketsLoadAttemptedRef.current = true;
      showError({
        type: "error",
        title: "Could Not Load Support Tickets",
        message:
          err.response?.data?.message ||
          "We couldn't load your support tickets. Please check your connection and try again.",
      });
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
    // A scheduled run that exhausted its retries. The record is still in the
    // queue and is retryable, so the notice takes the operator to it.
    if (notification.type === "scheduled_submission_failed") {
      return {
        label: "Scheduled Submission",
        color: "red",
        icon: <CloseCircleOutlined />,
        action: "drafts",
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

  // ── The BADGE feed: always on, wherever the operator is ─────────────────────
  //
  // The unread counts used to be fetched and subscribed inside the effect below,
  // which is gated on `shouldLoadPortalActivityData` — the notification panel
  // being open, or the History / Requests menu being active. So on Data Entry,
  // Overview and Drafts (where an operator spends nearly all of their time) NO
  // socket listener was attached and no count was ever fetched: the bell badge
  // sat at whatever it had been, and a reverted submission or an admin message
  // arriving right then showed nothing at all.
  //
  // A badge whose only job is to tell you something arrived cannot be gated on
  // already looking at the thing it is pointing to. This effect owns the counts
  // and nothing else: it subscribes once per signed-in session and re-reads on
  // each event, coalesced so one admin action that emits several events costs one
  // request. The heavier panel payloads (support tickets) stay gated below.
  // How many queued drafts / scheduled runs FAILED to submit.
  //
  // Counted here, not in DraftsScheduledPanel, because that panel is unmounted on
  // every other menu — and this is precisely the number the operator needs while
  // they are somewhere else.
  //
  // `countOnly` makes the server answer with the NUMBER. This used to download
  // every failed record — each one carrying a whole submission payload — and
  // then call `.length` on the array, on every socket event that touched the
  // account. A badge is not worth a payload download, let alone a repeated one.
  const fetchQueueAttention = useCallback(async () => {
    if (!portalEmail) return;
    try {
      const { data } = await api.get("/portal-queue", {
        params: { email: portalEmail, status: "failed", countOnly: 1 },
      });
      setQueueAttentionCount(
        Array.isArray(data) ? data.length : Number(data?.count) || 0,
      );
    } catch {
      /* silent — a badge must never break the page */
    }
  }, [portalEmail]);

  useEffect(() => {
    if (!portalUser?.email) return undefined;
    fetchPortalNotifications();
    fetchQueueAttention();
    const sock = connectSocket("portal", portalUser.email);
    let timer = null;
    const refreshBadges = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        fetchPortalNotifications();
        fetchQueueAttention();
      }, 400);
    };
    sock.on("notification", refreshBadges);
    sock.on("data-refresh", refreshBadges);
    return () => {
      clearTimeout(timer);
      sock.off("notification", refreshBadges);
      sock.off("data-refresh", refreshBadges);
    };
  }, [portalUser?.email, fetchPortalNotifications, fetchQueueAttention]);

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
    };
    if (
      (supportDrawerOpen || messageDrawerOpen) &&
      !supportTicketsLoadAttemptedRef.current
    ) {
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
    supportDrawerOpen,
    messageDrawerOpen,
    supportTickets.length,
    fetchSupportTickets,
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

  // ── Accredited-hauler upload: what the import will DO with each row ──
  // One cell carries both the operation and, when the row cannot be imported,
  // the reason — so an administrator never has to reconcile the uploaded file
  // against the baseline table by hand.
  const HAULER_UPLOAD_STATUS_META = {
    new: { color: "green", label: "New", hint: "Will be added" },
    update: { color: "blue", label: "Update", hint: "Existing hauler — will be updated" },
    duplicate: { color: "orange", label: "Duplicate", hint: "Merged into an earlier row" },
    invalid: { color: "red", label: "Invalid", hint: "Fix before importing" },
  };
  const renderHaulerUploadStatus = (row = {}) => {
    const meta = HAULER_UPLOAD_STATUS_META[row._status] || HAULER_UPLOAD_STATUS_META.new;
    return (
      <Space direction="vertical" size={2} style={{ width: "100%" }}>
        <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
          {meta.label}
        </Tag>
        {row._errors?.length ? (
          <Text type="danger" style={{ fontSize: 10, lineHeight: 1.3 }}>
            {row._errors.join("; ")}
          </Text>
        ) : row._duplicateOfRow != null ? (
          <Text type="warning" style={{ fontSize: 10, lineHeight: 1.3 }}>
            Same hauler and plate as row {row._duplicateOfRow} — merged into it.
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 10, lineHeight: 1.3 }}>
            {meta.hint}
          </Text>
        )}
      </Space>
    );
  };

  // ── Excel/CSV Upload Handlers ──
  // The workbook is parsed entirely in the browser, on the main thread. A file
  // past this size is not a disposal log — it is an export with pictures or a
  // decade of sheets — and parsing it froze the tab with the progress bar
  // stuck at "Reading file…", which read as an upload that hung. Refuse it
  // with the reason instead. The submission itself carries only the parsed
  // rows, so this bounds browser work, not what the server accepts.
  const MAX_UPLOAD_FILE_MB = 20;
  const handleExcelUpload = (file, type) => {
    const effectiveType = type || uploadType || "truck";
    setUploadType(effectiveType);
    setUploadProgressError(false);
    setUploadProgress(8);
    setUploadStatusText("Reading file…");
    setUploadProgressOpen(true);
    if (file && file.size > MAX_UPLOAD_FILE_MB * 1024 * 1024) {
      setUploadProgressError(true);
      setUploadStatusText(
        `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB; uploads are limited to ${MAX_UPLOAD_FILE_MB} MB. Remove images or extra sheets, or split it into smaller files.`,
      );
      logClientError({
        message: "Upload rejected: file too large",
        meta: { stage: "excel-upload", sizeBytes: file.size, name: file.name, type: effectiveType },
      });
      return false;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      setUploadProgressError(true);
      setUploadStatusText("Could not read the file. Please try again.");
      logClientError({
        message: "Upload failed: file could not be read",
        meta: { stage: "excel-upload", name: file?.name, type: effectiveType },
      });
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
        // PASS 1 — file values → the Portal's row shape. No validation and no
        // baseline lookups yet: the alignment pass below has to see the raw
        // Hauler / Client the file actually wrote, and the detector has to see
        // them before anything rewrites them.
        const parsedRows = jsonData.map((row, i) => {
          const normalized = { key: `upload-${i}-${Date.now()}`, _rowNumber: i + 2 };
          // Haulers are mapped by the shared schema (uploadHelpers) rather than
          // an inline header chain, so the sample template and the parser can
          // never drift apart.
          if (effectiveType !== "truck") {
            Object.assign(
              normalized,
              parseHaulerUploadRow(row, { fallbackUnit: baselineUnit || slfUnit }),
            );
          }
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
                // Canonical, not cosmetic: helpers#normalizeUnit only rewrites
                // "m3" → "m³", so "Tons"/"TONS"/"M3"/"t" reached the submit gate
                // as-is and were rejected as a unit mismatch against an identical
                // baseline unit. normalizeUploadUnit folds those onto the one
                // spelling the app converts with, and leaves a genuinely unknown
                // unit alone for getUploadRowErrors to reject by name.
                normalized.actualVolumeUnit = normalizeUploadUnit(value, baselineUnit || slfUnit);
              else if (UPLOAD_COLUMNS.truck.find((column) => column.field === "cellName")?.matches(k))
                Object.assign(normalized, resolveUploadCellValue(value));
              else if (k.includes("waste") && k.includes("type"))
                normalized.wasteType = cleanUploadText(value);
              else if (k.includes("haz") || k.includes("code"))
                normalized.hazWasteCode = cleanUploadText(value)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
            }
          }
          return normalized;
        });

        // PASS 2 — drop spreadsheet remnants, then work out whether this is a
        // machine export rather than a hand-made file.
        //
        // A remnant is a row carrying no date, ticket, plate, cell, waste type or
        // volume — nothing a trip is made of — typically a stray number an
        // operator left in a cell below the data. The real Prime Waste Solution
        // export ends with three of them. They could only ever fail validation,
        // and while they were in the batch they appeared in the list of clients
        // missing from the baseline as bare numbers. The count is reported rather
        // than the removal being silent.
        //
        // Detection itself is advisory: it changes what the preview SAYS and what
        // VERA is shown, never whether a row is valid. See systemGeneratedUpload
        // for why a gate system writes one party into both columns.
        const tripRows =
          effectiveType === "truck" ? parsedRows.filter(isTripRow) : parsedRows;
        const skippedStrayRows = parsedRows.length - tripRows.length;
        const detection =
          effectiveType === "truck"
            ? { ...detectSystemGeneratedFile(headers, tripRows), skippedStrayRows }
            : { isSystemGenerated: false, skippedStrayRows: 0 };
        setUploadDetection(effectiveType === "truck" ? detection : null);
        if (effectiveType === "truck" && tripRows.length === 0) {
          setUploadProgressError(true);
          setUploadStatusText(
            "No disposal entries found. Every row is missing a date, ticket number, plate, cell, waste type and volume — check that the first sheet holds the disposal data.",
          );
          return;
        }

        // PASS 3 — resolve each row against the baseline, then validate.
        //
        // Alignment runs BEFORE validation deliberately: where it succeeds it has
        // rewritten Hauler / Client to the baseline's own spelling, so the ordinary
        // relationship check then passes — and, because those are the canonical
        // names, so does the server's identical check at submit time. Where it
        // fails it contributes an error naming the record that is actually
        // missing, in place of the relationship check's "hauler is not assigned",
        // which was true but pointed at the wrong thing.
        const normalized = tripRows.map((parsed) => {
          const row = effectiveType === "truck" ? alignDisposalRow(parsed, haulers) : parsed;
          const alignmentErrors = row._alignmentErrors || [];
          const relationshipErrors =
            effectiveType === "truck" && alignmentErrors.length === 0
              ? getUploadRelationshipErrors(row, haulers)
              : [];
          if (effectiveType === "truck" && alignmentErrors.length === 0 && relationshipErrors.length === 0) {
            const matchedHauler = findUploadHauler(haulers, row.hauler);
            // Plural: a single Client cell may name several clients served on the
            // same trip. All of them are bound to the row, so the submission
            // records every client the waste actually came from.
            const matchedClients = findUploadClientsForHauler(matchedHauler, row.client).clients;
            if (matchedClients.length) row._matchedClients = matchedClients;
          }
          const cellKnown = effectiveType !== "truck" || !row.cellName || row.cellIndex != null || activeCellOptions.length === 0;
          return {
            ...row,
            _errors: [
              ...getUploadRowErrors(row, effectiveType),
              ...alignmentErrors,
              ...relationshipErrors,
              ...(cellKnown ? [] : [`Row ${row._rowNumber} — Cell or Disposal Area "${row.cellName}" is not an available cell under this SLF.`]),
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
              width: 100,
            },
            { title: "Disposal Date", dataIndex: "disposalDate", key: "disposalDate", width: 130 },
            {
              // Merged: these two are ONE fact — a trip is attributed through
              // Hauler → Client, they are validated as a pair, and every alignment
              // and mismatch message names both. Side by side they cost 340px of a
              // grid that already scrolls sideways; stacked in one cell they cost
              // 260 and read as the relationship they are. `stackedFields` keeps
              // each of them individually editable (see the preview modal's
              // column mapper).
              title: "Hauler → Client",
              key: "haulerClient",
              width: 300,
              stackedFields: [
                { field: "hauler", label: "Hauler" },
                { field: "client", label: "Client" },
              ],
            },
            {
              // What the file said versus what it was resolved to. A row the
              // alignment pass rewrote MUST show that it was rewritten: the
              // operator is about to import a trip attributed to a hauler/client
              // pair the file did not literally name, and they have to be able to
              // see — and reject — that before it is saved.
              title: "Match",
              key: "alignment",
              width: 100,
              render: (_, row) => {
                const alignment = row._alignment;
                if (!alignment) {
                  return <Tag color="green">Exact</Tag>;
                }
                if (alignment.status === "aligned") {
                  return (
                    <Tooltip
                      title={`${alignment.note} Written in the file as: "${alignment.originalHauler}" / "${alignment.originalClient}".`}
                    >
                      <Tag color="gold">Matched · {alignment.method}</Tag>
                    </Tooltip>
                  );
                }
                if (alignment.status === "mismatch") {
                  return (
                    <Tooltip
                      title={`${alignment.note} Resolve it in the panel above the table.`}
                    >
                      <Tag color="volcano">Name mismatch</Tag>
                    </Tooltip>
                  );
                }
                return (
                  <Tooltip title={alignment.note}>
                    <Tag color="red">
                      {alignment.status === "ambiguous" ? "Ambiguous" : "Not on baseline"}
                    </Tag>
                  </Tooltip>
                );
              },
            },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 120,
            },
            {
              // Merged: three numbers that are only meaningful together. The unit
              // applies to BOTH the capacity and the volume, and the one check an
              // operator makes here — is the load plausible against the truck's
              // registered capacity? — needs all three in the same glance. Three
              // separate columns put the unit two columns away from the figures it
              // qualifies, and cost 310px instead of 170.
              title: "Capacity / Volume",
              key: "capacityVolume",
              width: 150,
              stackedFields: [
                { field: "truckCapacity", label: "Truck capacity" },
                { field: "actualVolume", label: "Volume disposed" },
                { field: "actualVolumeUnit", label: "Unit" },
              ],
            },
            {
              // Narrow on purpose, and only viable because the picker now shows
              // the cell's VALUE once chosen ("Cell 4" — see optionLabelProp in
              // the preview modal) rather than its descriptive label. The full
              // "Cell 4 - Treated Hazardous Waste" still appears in the dropdown,
              // where it is what you actually read while choosing; at this width
              // it would otherwise have wrapped onto three or four lines in every
              // row. A value from the file that is not a cell at all is the one
              // exception — it wraps, and is flagged in red.
              title: "Cell",
              dataIndex: "cellName",
              key: "cellName",
              width: 100,
            },
            { title: "Waste Type", dataIndex: "wasteType", key: "wasteType", width: 190 },
            {
              // The messages are TEXT, not a tag.
              //
              // They used to be joined into one `<Tag color="red">`, and a Tag is
              // an inline-block with `white-space: nowrap` — so a row's errors
              // became a single unbreakable box wider than the column, which the
              // table then widened the whole column to fit, pushing every other
              // column off to the side. The td already wraps (see
              // .slf-upload-preview-table in SLFPortal.css); only the Tag did not.
              // The relationship and alignment messages are full sentences, so this
              // was guaranteed to distort the grid on any file with a problem.
              //
              // A short Tag now carries the COUNT — which is what the eye scans
              // for — and the messages sit under it in a wrapping block, one per
              // line rather than comma-joined, so several issues on one row stay
              // readable.
              title: "Validation",
              key: "validation",
              // The widest column in the grid, and deliberately so: it is the only
              // one holding sentences rather than values. The relationship and
              // alignment messages name a hauler AND a client AND the fix, so at
              // anything narrower they wrapped into a tall, thin ribbon that was
              // harder to read than the error it described. The table scrolls
              // sideways under a pinned header, so the extra width costs nothing
              // the operator cannot scroll to.
              width: 380,
              onCell: () => ({
                style: {
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  verticalAlign: "top",
                },
              }),
              render: (_, row) => {
                const errors = row._errors || [];
                if (errors.length === 0) return <Tag color="green">Ready</Tag>;
                return (
                  <div style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                    <Tag color="red" style={{ marginInlineEnd: 0, marginBottom: 4 }}>
                      {errors.length} issue{errors.length === 1 ? "" : "s"}
                    </Tag>
                    <div style={{ color: "#a8071a", fontSize: 12.5, lineHeight: 1.4 }}>
                      {errors.map((message, index) => (
                        <div key={index} style={{ marginTop: index === 0 ? 0 : 3 }}>
                          {message}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              },
            },
            {
              title: "Actions",
              key: "actions",
              width: 80,
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
            { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
            {
              title: "Action",
              key: "status",
              width: 140,
              render: (_, row) => renderHaulerUploadStatus(row),
            },
            {
              title: "Hauler Name",
              dataIndex: "haulerName",
              key: "haulerName",
              width: 160,
            },
            {
              title: "Trucks",
              dataIndex: "numberOfTrucks",
              key: "numberOfTrucks",
              width: 62,
            },
            {
              title: "Office Address",
              dataIndex: "officeAddress",
              key: "officeAddress",
              width: 140,
            },
            {
              title: "Plate No.",
              dataIndex: "plateNumber",
              key: "plateNumber",
              width: 92,
            },
            {
              title: "Vehicle Type",
              dataIndex: "vehicleType",
              key: "vehicleType",
              width: 100,
            },
            { title: "Capacity", dataIndex: "capacity", key: "capacity", width: 72 },
            // Editable because it is VALIDATED (the stored unit is enum-constrained):
            // an unusable unit in the file must be fixable here rather than sending
            // the user back to the spreadsheet.
            { title: "Unit", dataIndex: "capacityUnit", key: "capacityUnit", width: 74 },
            {
              title: "Clients",
              dataIndex: "privateSectorClients",
              key: "privateSectorClients",
              width: 146,
              render: (val) =>
                Array.isArray(val) && val.length > 0
                  ? val.join(", ")
                  : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
            },
            { title: "Client Type", dataIndex: "clientType", key: "clientType", width: 86 },
            { title: "Client Address", dataIndex: "clientAddress", key: "clientAddress", width: 120 },
            { title: "Client Region", dataIndex: "clientRegion", key: "clientRegion", width: 110 },
            { title: "Client Province", dataIndex: "clientProvince", key: "clientProvince", width: 104 },
            {
              title: "Client City/Municipality",
              dataIndex: "clientMunicipality",
              key: "clientMunicipality",
              width: 120,
            },
            {
              title: "",
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

        // VERA assesses only a CLEAN hauler preview — decided here from the
        // just-parsed rows and the missing-column result, never from state that
        // has not re-rendered yet. A file with any failing row goes back to the
        // user to correct instead; there is nothing to second-guess until the
        // rows are at least valid.
        if (effectiveType === "hauler") {
          haulerVeraCycleRef.current += 1;
          const cleanPreview =
            missingColumns.length === 0 &&
            normalized.length > 0 &&
            normalized.every((row) => !row._errors?.length);
          if (cleanPreview) {
            const annotated = annotateHaulerUploadRows(normalized, haulers);
            runUploadVeraAssessment({
              message: HAULER_VERA_ASSESSMENT_PROMPT,
              pageContext: buildHaulerVeraContext(
                annotated,
                summarizeHaulerUpload(annotated),
                haulers,
              ),
            });
          } else {
            setHaulerVeraStage("idle");
            setHaulerVeraComment("");
            setHaulerVeraError(null);
            setHaulerVeraSource(null);
          }
        }

        // A disposal upload asks VERA when there is something it can usefully
        // explain: rows the alignment pass matched for the operator (which they
        // should confirm before importing), rows it could not (which name the
        // baseline records to encode), or a file that looks machine-generated. A
        // clean, ordinary file needs no commentary and gets none.
        if (effectiveType === "truck") {
          haulerVeraCycleRef.current += 1;
          const alignment = summarizeAlignment(normalized);
          const worthExplaining =
            normalized.length > 0 &&
            (detection.isSystemGenerated ||
              alignment.alignedCount > 0 ||
              alignment.ambiguousCount > 0 ||
              alignment.mismatches.length > 0 ||
              alignment.needsEncoding.length > 0);
          if (worthExplaining) {
            runUploadVeraAssessment({
              message: DISPOSAL_VERA_ASSESSMENT_PROMPT,
              pageContext: buildDisposalVeraContext(normalized, alignment, detection),
            });
          } else {
            setHaulerVeraStage("idle");
            setHaulerVeraComment("");
            setHaulerVeraError(null);
            setHaulerVeraSource(null);
          }
        }
      } catch (err) {
        setUploadProgressError(true);
        setUploadStatusText(
          "Could not parse the uploaded file. Please check the format and try again.",
        );
        // Was silent: a file the parser rejects left no trace for an admin to
        // act on when the operator reported "the upload doesn't work".
        logClientError({
          message: `Upload failed: ${err?.message || "could not parse workbook"}`,
          meta: { stage: "excel-upload", name: file?.name, sizeBytes: file?.size, type: effectiveType },
        });
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

  // The preview rows the modal actually renders, and the ones the import reads.
  //
  // The new/update/duplicate classification is DERIVED from the parsed rows and
  // the haulers currently on the baseline, never stored on the rows — so it
  // stays correct after an inline edit, after a row is deleted from the preview,
  // and after a baseline refresh, with no re-annotation step to forget.
  const uploadPreviewRows = useMemo(
    () =>
      uploadType === "hauler"
        ? annotateHaulerUploadRows(uploadPreviewData, haulers)
        : uploadPreviewData,
    [uploadPreviewData, haulers, uploadType],
  );
  const uploadPreviewSummary = useMemo(
    () =>
      uploadType === "hauler"
        ? summarizeHaulerUpload(uploadPreviewRows)
        : {
            total: uploadPreviewRows.length,
            invalid: uploadPreviewRows.filter((row) => row._errors?.length).length,
            valid: uploadPreviewRows.filter((row) => !row._errors?.length).length,
          },
    [uploadPreviewRows, uploadType],
  );

  // ── VERA assessment of an upload preview ──────────────────────────────────
  //
  // Same discipline as Bulk Organize Cells: VERA is a SECOND OPINION, never a
  // gate. It is invoked deliberately (never from an effect, which would re-fire
  // on every re-render), and a failure to reach it leaves the import exactly as
  // available as it was.
  //
  // The stage is separate from the validation outcome for the same reason: "the
  // preview is valid but VERA could not answer" has to be a state the UI can say
  // out loud, rather than one that reads as a validation problem.
  //
  // WHEN IT RUNS differs by upload kind, and deliberately so:
  //   · hauler   — only on a CLEAN preview. There is nothing useful to say about
  //                rows that have not passed validation yet; VERA is pointed at
  //                what such an import gets wrong QUIETLY.
  //   · disposal — on a failing preview too. A machine-exported disposal file
  //                fails every row with the same unhelpful message, and the
  //                alignment pass already knows which baseline records are
  //                missing. Explaining that IS the help.
  const runUploadVeraAssessment = useCallback(
    async ({ message, pageContext }) => {
      const cycle = haulerVeraCycleRef.current;
      setHaulerVeraStage("assessing");
      setHaulerVeraComment("");
      setHaulerVeraError(null);
      try {
        const { data } = await api.post("/vera/chat", {
          message,
          history: [],
          page: "data-entry",
          pageContext,
        });
        // A newer file was uploaded (or the preview was closed) while this was in
        // flight — its answer describes rows that are no longer on screen.
        if (haulerVeraCycleRef.current !== cycle) return;
        if (data?.ok && data.answer) {
          setHaulerVeraComment(String(data.answer));
          setHaulerVeraSource(data.source || null);
          setHaulerVeraStage("done");
        } else {
          // The server explains WHY (disabled / rate limited / duplicate). Show
          // its reason rather than inventing one, and never a placeholder.
          setHaulerVeraError(
            data?.message || "VERA could not assess this upload right now.",
          );
          setHaulerVeraStage("failed");
        }
      } catch (err) {
        if (haulerVeraCycleRef.current !== cycle) return;
        setHaulerVeraError(
          err.response?.data?.message ||
            "VERA could not be reached. Your previewed data is unaffected.",
        );
        setHaulerVeraStage("failed");
      }
    },
    [],
  );

  // What the loaded baseline is missing — recomputed whenever the haulers change,
  // so completing a record in the Baseline tab clears it from the warning without
  // a reload. Feeds the incomplete-records panel and the hauler table's per-row
  // indicator, which is why it is derived once here rather than in either of them.
  const baselineGaps = useMemo(
    () => summarizeBaselineCompleteness(haulers),
    [haulers],
  );

  // What the previewed disposal rows resolved to, re-derived on every render from
  // the rows themselves — so it stays true after an inline edit or a deletion.
  const uploadAlignmentSummary = useMemo(
    () => (uploadType === "truck" ? summarizeAlignment(uploadPreviewRows) : null),
    [uploadPreviewRows, uploadType],
  );

  // Re-assess the rows as they stand NOW — after inline preview edits or a row
  // deletion — which is also what the Retry path uses.
  const reassessHaulerUpload = useCallback(() => {
    haulerVeraCycleRef.current += 1;
    runUploadVeraAssessment(
      uploadType === "truck"
        ? {
            message: DISPOSAL_VERA_ASSESSMENT_PROMPT,
            pageContext: buildDisposalVeraContext(
              uploadPreviewRows,
              uploadAlignmentSummary,
              uploadDetection,
            ),
          }
        : {
            message: HAULER_VERA_ASSESSMENT_PROMPT,
            pageContext: buildHaulerVeraContext(
              uploadPreviewRows,
              uploadPreviewSummary,
              haulers,
            ),
          },
    );
  }, [
    runUploadVeraAssessment,
    uploadType,
    uploadPreviewRows,
    uploadPreviewSummary,
    uploadAlignmentSummary,
    uploadDetection,
    haulers,
  ]);

  const handleConfirmUpload = () => {
    if (uploadPreviewRows.length === 0) return;
    const invalidRows = uploadPreviewRows.filter((row) => row._errors?.length);
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
                selectedClients: d._matchedClients || [],
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
        selectedClients: d._matchedClients || [],
      }));
      const uploadDates = [...new Set(newTrucks.map((truck) => truck.disposalDate).filter(Boolean))];
      if (uploadDates.length === 1 && !entryForm.getFieldValue("dateOfDisposal")) {
        entryForm.setFieldsValue({ dateOfDisposal: dayjs(uploadDates[0]) });
      }
      setTrucks((prev) => [...prev, ...newTrucks]);
    } else {
      const newHaulers = uploadPreviewRows.map((d) => ({
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
        // Location is stored as the *Name fields, never as PSGC codes: the
        // Region 3 classification and the server's "incomplete client" check
        // both read regionName / provinceName / municipalityName, so a province
        // spelled out in a spreadsheet ends up exactly as usable as one picked
        // in the Add Client form.
        privateSectorClients: (d.privateSectorClients || []).map((client, index) =>
          typeof client === "string"
            ? {
                key: `${d.key}-client-${index}`,
                clientName: client,
                clientType: d.clientType || "Private",
                clientAddress: d.clientAddress || "",
                regionName: d.clientRegion || "",
                provinceName: d.clientProvince || "",
                municipalityName: d.clientMunicipality || "",
              }
            : {
                ...client,
                clientType: client.clientType || d.clientType || "Private",
                clientAddress: client.clientAddress || d.clientAddress || "",
                regionName: client.regionName || d.clientRegion || "",
                provinceName: client.provinceName || d.clientProvince || "",
                municipalityName: client.municipalityName || d.clientMunicipality || "",
              },
        ),
      }));
      setHaulers((prev) =>
        mergeHaulersByName([...prev, ...newHaulers], baselineUnit || slfUnit),
      );
    }
    const importedSummary = uploadPreviewSummary;
    setUploadModalOpen(false);
    setUploadPreviewData([]);
    setUploadMissingColumns([]);
    setUploadDetection(null);
    Swal.fire({
      icon: "success",
      title: "Data Imported",
      text:
        uploadType === "hauler"
          ? `${importedSummary.newHaulers} hauler(s) added, ${importedSummary.updatedHaulers} updated. Click "Save Baseline Update" to persist the changes.`
          : `${importedSummary.total} records imported successfully.`,
      timer: uploadType === "hauler" ? 3200 : 1500,
      showConfirmButton: false,
    });
  };

  // Update preview data cell
  /**
   * Re-run alignment and validation over one previewed row.
   *
   * The SAME sequence the initial parse applies (align → validate), extracted so
   * an edited row is judged by exactly the rules the file was. Before this, an
   * inline edit re-ran the relationship check but not the alignment pass, so
   * correcting a client by hand left the row's `_alignment` describing the value
   * it no longer held — and a row fixed through a mismatch suggestion could never
   * clear, because nothing re-resolved it.
   *
   * `fleet` is passed in rather than read from state so a caller that is fixing
   * the baseline and the rows in one go can validate against the NEW fleet
   * instead of the one React has not re-rendered with yet.
   */
  const revalidateUploadRow = useCallback(
    (row, fleet = haulers) => {
      if (uploadType !== "truck") {
        return {
          ...row,
          _errors: [...getUploadRowErrors(row, uploadType || "truck")],
        };
      }
      const aligned = alignDisposalRow(row, fleet);
      const alignmentErrors = aligned._alignmentErrors || [];
      const relationshipErrors =
        alignmentErrors.length === 0 ? getUploadRelationshipErrors(aligned, fleet) : [];
      const matchedHauler =
        alignmentErrors.length === 0 && relationshipErrors.length === 0
          ? findUploadHauler(fleet, aligned.hauler)
          : null;
      // One trip can serve SEVERAL clients written into one cell
      // ("A, B, C"). findUploadClientsForHauler tries the cell whole first and
      // only then as a list, so a client name containing a comma still resolves.
      const matchedClients = matchedHauler
        ? findUploadClientsForHauler(matchedHauler, aligned.client).clients
        : [];
      const cellKnown =
        !aligned.cellName || aligned.cellIndex != null || activeCellOptions.length === 0;
      return {
        ...aligned,
        _matchedClients: matchedClients.length ? matchedClients : undefined,
        _relationshipErrors: relationshipErrors,
        _errors: [
          ...getUploadRowErrors(aligned, "truck"),
          ...alignmentErrors,
          ...relationshipErrors,
          ...(cellKnown
            ? []
            : [`Row ${aligned._rowNumber} — Cell or Disposal Area "${aligned.cellName}" is not an available cell under this SLF.`]),
        ],
      };
    },
    [uploadType, haulers, activeCellOptions],
  );

  const updateUploadCell = (key, field, value) => {
    setUploadPreviewData((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        // Re-split clients string back to array so downstream merge works correctly
        const coercedValue =
          field === "privateSectorClients" && typeof value === "string"
            ? value.split(",").map((s) => s.trim()).filter(Boolean)
            : value;
        // Editing the CELL must re-resolve its identifier, not just its label.
        // The import writes `cellIndex` (the canonical reference); leaving the
        // originally-parsed index in place meant an edited cell silently
        // imported the waste into the cell that came from the FILE, not the one
        // the user picked in the preview.
        const cellPatch =
          field === "cellName" ? resolveUploadCellValue(coercedValue) : null;
        return revalidateUploadRow({ ...row, [field]: coercedValue, ...(cellPatch || {}) });
      }),
    );
  };

  // ── Resolving a client MISMATCH from the upload preview ────────────────────
  //
  // A mismatch is the baseline and the file disagreeing about how to spell the
  // same client — not a client the baseline is missing. There are two honest ways
  // to settle that, and which one is right is the operator's call, not ours:
  //
  //   · the BASELINE is right → rewrite the file's rows to the stored name. The
  //     baseline is untouched; only this import changes.
  //   · the FILE is right → correct the client on the hauler. That is a baseline
  //     edit, so it lands in the draft and needs Save Baseline Update, exactly
  //     like Add Client and the per-hauler client upload.
  //
  // Both apply to EVERY row carrying that pair, because one decision about one
  // client should not have to be repeated forty times.

  /** The file is wrong: point its rows at the client the baseline already has. */
  const useStoredClientForRows = useCallback(
    (entry, storedName) => {
      const affected = new Set(entry?.rowKeys || []);
      if (!affected.size || !storedName) return;
      setUploadPreviewData((prev) =>
        prev.map((row) =>
          affected.has(row.key) ? revalidateUploadRow({ ...row, client: storedName }) : row,
        ),
      );
    },
    [revalidateUploadRow],
  );

  /**
   * The file is right: change the client ON THE HAULER.
   *
   * `storedName` renames that client in place; omitting it adds the file's value
   * as a new client instead. The rows are revalidated against the NEW fleet in
   * the same tick — passing it explicitly rather than relying on `haulers`, which
   * this render still sees as the old list.
   */
  const applyClientFixToHauler = useCallback(
    (entry, storedName = "") => {
      const haulerKey = cleanUploadText(entry?.hauler).toLowerCase();
      const target = cleanUploadText(entry?.client);
      if (!haulerKey || !target) return;
      const nextFleet = haulers.map((hauler) => {
        if (cleanUploadText(hauler.haulerName || hauler.name).toLowerCase() !== haulerKey) {
          return hauler;
        }
        const clients = Array.isArray(hauler.privateSectorClients)
          ? hauler.privateSectorClients.map((client) =>
              typeof client === "string" ? { clientName: client } : { ...client },
            )
          : [];
        if (storedName) {
          const index = clients.findIndex(
            (client) =>
              cleanUploadText(client.clientName).toLowerCase() ===
              cleanUploadText(storedName).toLowerCase(),
          );
          if (index >= 0) {
            // A RENAME keeps the record — and with it the client's type, province
            // and municipality, which is the whole reason renaming beats adding.
            clients[index] = { ...clients[index], clientName: target };
            return { ...hauler, privateSectorClients: clients };
          }
        }
        // Added with the type carried over from the closest existing client where
        // there is one, since a new client with no type is itself an incomplete
        // record. Province and municipality are deliberately left blank — they
        // are not guessable, and the completeness panel will ask for them.
        const donor = clients.find((client) => cleanUploadText(client.clientType));
        clients.push({
          key: `client-fix-${Date.now()}`,
          clientName: target,
          clientType: donor?.clientType || "Private",
        });
        return { ...hauler, privateSectorClients: clients };
      });
      setHaulers(nextFleet);
      setUploadPreviewData((prev) => prev.map((row) => revalidateUploadRow(row, nextFleet)));
    },
    [haulers, revalidateUploadRow],
  );

  /**
   * Build a sample-template workbook FROM the upload schema.
   *
   * Both templates are generated here, from the same UPLOAD_COLUMNS the parser
   * and the row validators read, so a downloaded template always carries exactly
   * the headers the uploader accepts and the Instructions sheet always states the
   * rules that are actually enforced.
   */
  const buildUploadTemplateWorkbook = ({ type, sheetName, sampleRows, instructions, listValidations = [] }) => {
    const headers = UPLOAD_COLUMNS[type].map((column) => column.label);
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
    worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(18, header.length + 2) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ...instructions,
        [],
        ["Column", "Required", "Accepted format", "Sample", "Validation rule"],
        ...UPLOAD_COLUMNS[type].map((column) => [
          column.label,
          column.required ? "Required" : "Optional",
          column.format || "Text",
          column.sample || "",
          column.description || "",
        ]),
      ]),
      "Instructions",
    );
    if (worksheet["!ref"]) {
      worksheet["!dataValidation"] = listValidations
        .map(({ label, values }) => {
          const index = headers.indexOf(label);
          if (index < 0) return null;
          const col = XLSX.utils.encode_col(index);
          return { sqref: `${col}2:${col}200`, type: "list", formula1: `"${values}"` };
        })
        .filter(Boolean);
    }
    return workbook;
  };

  const downloadDisposalTemplate = () => {
    const workbook = buildUploadTemplateWorkbook({
      type: "truck",
      sheetName: "Disposal Entries",
      sampleRows: [UPLOAD_COLUMNS.truck.map((column) => column.sample || "")],
      listValidations: [
        { label: "Waste Type", values: "Residual,Hazardous Waste,Treated Hazardous Waste" },
        { label: "Unit of Measurement", values: "tons,m3,m³" },
      ],
      instructions: [
      ["Waste Generator Disposal Entry Upload Instructions"],
      ["Relationship rule", "Selected SLF -> Hauler -> Client. The Client column is required and must identify a client assigned to the specified hauler under the selected SLF."],
      ["No auto-create", "The upload does not create new clients. Add or correct clients in Baseline / Accredited Haulers first."],
      ["Dates", "Use YYYY-MM-DD, MM/DD/YYYY, or a real Excel date value. All rows in one import must use the same disposal date."],
      ["Numbers", "Waste Volume and Truck Capacity must be positive numbers. Commas are accepted."],
      ["Units", "Use tons, m3, or m³. The unit must match the selected SLF's declared baseline unit."],
      ["Cells", "Use an available Cell or Disposal Area from the selected SLF. Example: Cell 1."],
      [],
      ["Common upload errors"],
      ["Missing Client column"],
      ["Empty Client value"],
      ["Client exists but belongs to another hauler or SLF"],
      ["Duplicate or inactive client record"],
      ["Unknown cell/disposal area"],
      ],
    });
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
  // ── Edit a saved draft ── { id, label } of the Drafts & Scheduled record whose
  // data is loaded into Data Entry. Save as Draft updates THAT record, and a
  // successful Review & Submit removes it from the queue.
  const [editingDraft, setEditingDraft] = useState(null);

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
    setEditingRevertedId(null);
    setResubmitComment("");
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
      label: payload.dateOfDisposal ? dayjs(payload.dateOfDisposal).format("MMM D, YYYY") : "undated",
    });
    setSubmitted(false);
    setActiveMenu("data-entry");
    setActiveTab("disposal");
    const keepSelection = { preserveSelection: true };
    if (companyFields.companyRegion) fetchProvinces(companyFields.companyRegion, keepSelection);
    if (companyFields.companyProvince) fetchMunicipalities(companyFields.companyProvince, keepSelection);
    if (companyFields.companyMunicipality) fetchBarangays(companyFields.companyMunicipality, keepSelection);
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
      if (editingDraft) {
        api.delete(`/portal-queue/${editingDraft.id}`).catch(() => {});
        setEditingDraft(null);
      }
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

  // ── Drafts & Scheduled submission handlers ──
  //
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
      const entry = buildSubmissionEntry();
      // Editing a draft opened from Drafts & Scheduled: update THAT record, even
      // if its disposal date was changed (the facility+date match below would
      // otherwise file a second draft and leave the original behind).
      const { data } = editingDraft
        ? await api.put(`/portal-queue/${editingDraft.id}`, {
            type: "draft",
            payload: entry,
            slfName: activeSlfName,
            slfGenerator: activeSlfId || null,
          })
        : await api.post("/portal-queue", {
            type: "draft",
            payload: entry,
            clientRequestId: newClientRequestId(),
            slfName: activeSlfName,
            slfGenerator: activeSlfId || null,
          });
      setReviewModalOpen(false);
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
    } else if (meta.action === "drafts") {
      setActiveMenu("drafts");
      await markPortalNotificationRead(notification);
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
      label: (
        <span>
          Drafts & Scheduled
          {queueAttentionCount > 0 && (
            <Badge
              count={queueAttentionCount}
              size="small"
              style={{ marginLeft: 8, backgroundColor: "#fa541c" }}
            />
          )}
        </span>
      ),
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
              handleReviewOpen={stableReviewOpen}
              handleSaveDraft={stableSaveDraft}
              savingDraft={savingDraft}
              handleOpenWasteReceived={stableOpenWasteReceived}
              revertToResolve={editingRevertedId ? null : unresolvedRevert}
              onResolveRevert={stableEditRevertedRow}
              resubmittingIdNo={resubmittingIdNo}
              editingDraftLabel={editingDraft?.label || null}
              onStopEditingDraft={stopEditingDraft}
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
                    children: () => (
                      <BasicInfoTab
                        companyForm={companyForm}
                        entryForm={entryForm}
                        regions={regions}
                        provinces={provinces}
                        municipalities={municipalities}
                        barangays={barangays}
                        loadingAddress={loadingAddress}
                        fetchProvinces={stableFetchProvinces}
                        fetchMunicipalities={stableFetchMunicipalities}
                        fetchBarangays={stableFetchBarangays}
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
                    children: () => (
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
                            // Controlled so the feature tour can open the
                            // Accredited Haulers panel it points at. Left closed
                            // by default exactly as before; nothing else changes
                            // the user's own expand/collapse behaviour.
                            activeKey={baselineSections}
                            onChange={setBaselineSections}
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
                                      <span ref={haulerUploadRef}>
                                        <Button
                                          icon={<UploadOutlined />}
                                          onClick={() =>
                                            openUploadGuide("hauler")
                                          }
                                          disabled={baselineSaved}
                                        >
                                          Upload Excel/CSV
                                        </Button>
                                      </span>
                                      <span ref={haulerExportRef}>
                                        <Button
                                          icon={<DownloadOutlined />}
                                          onClick={exportHaulerData}
                                          disabled={!haulers.length}
                                        >
                                          Export Hauler Data
                                        </Button>
                                      </span>
                                      <Button
                                        type="primary"
                                        icon={<DownloadOutlined />}
                                        onClick={downloadHaulerTemplate}
                                      >
                                        Download Sample Template
                                      </Button>
                                      {/* Always available, not only while the
                                          release is new — a user who closed the
                                          tour early needs a way back in, and
                                          this is where its steps point. */}
                                      <Tooltip title="Replay the tour of what changed in bulk hauler and client updates">
                                        <Button
                                          type="link"
                                          icon={<BulbOutlined />}
                                          onClick={() => openFeatureTour()}
                                        >
                                          What&apos;s new
                                        </Button>
                                      </Tooltip>
                                    </div>
                                    <div ref={haulerTableRef}>
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
                                      // Summed from the columns rather than
                                      // hardcoded, so the header and the body can
                                      // never disagree about where a column
                                      // starts. The literal 980 it replaced was
                                      // already short of the real total, and each
                                      // column added since made it shorter.
                                      scroll={{
                                        x: haulerColumns.reduce(
                                          (sum, col) => sum + (Number(col?.width) || 120),
                                          0,
                                        ),
                                      }}
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
                    children: () => (
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
                        truckUploadRef={truckUploadRef}
                        truckTableRef={truckTableRef}
                      />
                    ),
                  },
                ])}
                />
              </div>
            </Card>
          </Col>
          <Col xs={24} xl={5}>
            {/* Incomplete baseline warning — derived from the already-loaded
                haulers (no extra fetch), recalculated whenever they change.
                Non-blocking; distinct from validation errors.

                It covers the HAULER as well as its clients. It used to look only
                at clients, so a hauler with no office address or with no clients
                at all read as complete — the second of which is the reason a
                disposal upload rejects every one of that hauler's trips.

                The rule itself lives in baselineCompleteness so this panel, the
                hauler table and VERA's server-side view of the same facility
                cannot drift apart on what "incomplete" means. */}
            {(() => {
              const completeness = baselineGaps;
              if (!completeness.total) return null;
              const onlyAddresses = completeness.requiredCount === 0;
              return (
                <div ref={baselineGapsRef}>
                <Alert
                  type={onlyAddresses ? "info" : "warning"}
                  showIcon
                  style={{ marginBottom: 12, borderRadius: 8 }}
                  message={
                    <Text strong style={{ fontSize: 12 }}>
                      {completeness.total} incomplete baseline record
                      {completeness.total === 1 ? "" : "s"}
                    </Text>
                  }
                  description={
                    <div style={{ fontSize: 12 }}>
                      <div style={{ marginBottom: 6 }}>
                        {onlyAddresses
                          ? "Everything needed for reporting is present. These records are only missing contact details EMB Region III asks for:"
                          : "Complete these details for accurate regional reporting and to keep disposal uploads from being rejected:"}
                      </div>
                      {completeness.haulersMissingAddress > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          <Text type="secondary">
                            {completeness.haulersMissingAddress} hauler
                            {completeness.haulersMissingAddress === 1 ? " has" : "s have"} no office
                            address
                            {completeness.clientsMissingAddress > 0
                              ? `, and ${completeness.clientsMissingAddress} client${completeness.clientsMissingAddress === 1 ? " has" : "s have"} no address.`
                              : "."}
                          </Text>
                        </div>
                      )}
                      <ul style={{ margin: 0, paddingLeft: 16, maxHeight: 168, overflowY: "auto" }}>
                        {completeness.rows.slice(0, 12).map((row, i) => (
                          <li key={i} style={{ marginBottom: 3 }}>
                            <Text strong>{row.hauler}</Text>
                            {row.client ? (
                              <>
                                {" → "}
                                <Text>{row.client}</Text>
                              </>
                            ) : null}
                            {": "}
                            {row.required.length > 0 && (
                              <Text type="danger">missing {row.required.join(", ")}</Text>
                            )}
                            {row.required.length > 0 && row.recommended.length > 0 && "; "}
                            {row.recommended.length > 0 && (
                              <Text type="secondary">no {row.recommended.join(", ")}</Text>
                            )}
                          </li>
                        ))}
                      </ul>
                      {completeness.total > 12 && (
                        <Text type="secondary">+{completeness.total - 12} more record(s)…</Text>
                      )}
                      <div style={{ marginTop: 8 }}>
                        <Space size={6} wrap>
                          {/* Fix them HERE. Sending the operator to the Accredited
                              Haulers tab meant finding each record by hand — open
                              the hauler, find the client inside it, fill one field,
                              close, repeat — which with eighty haulers is why the
                              gaps never closed. */}
                          <Button
                            size="small"
                            type="primary"
                            onClick={() => setCompletionModalOpen(true)}
                          >
                            Complete {completeness.total} record
                            {completeness.total === 1 ? "" : "s"}
                          </Button>
                          <Button size="small" onClick={() => setActiveTab("baseline")}>
                            Open Baseline Data
                          </Button>
                        </Space>
                      </div>
                    </div>
                  }
                />
                </div>
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
                  getPortalNotificationMeta={stableNotificationMeta}
                  openPortalNotification={stableOpenNotification}
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
          {isDeveloperContext && (
            <div
              className="slf-dev-banner"
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
              {/* The dot separators only make sense while this reads as one line.
                  Below md the banner wraps into stacked rows and they are hidden
                  (see .slf-dev-banner), where they would otherwise dangle at the
                  end of a line as stray punctuation. */}
              <span className="slf-dev-banner-sep" style={{ opacity: 0.75 }}>·</span>
              <span className="slf-dev-banner-field">
                Viewing: <strong>{activeSlfName || "—"}</strong>
              </span>
              <span className="slf-dev-banner-sep" style={{ opacity: 0.75 }}>·</span>
              <span className="slf-dev-banner-field">
                Portal User:{" "}
                <strong>
                  {[portalUser?.firstName, portalUser?.lastName].filter(Boolean).join(" ") ||
                    portalUser?.email}
                </strong>
              </span>
              {/* `margin-inline-start: auto` right-aligns the tag on a single-line
                  banner, but once the banner wraps it strands the tag alone on the
                  last row. The class drops the auto margin below md. */}
              {/* The mode WRITES now, so the banner has to say so. A stale
                  "READ-ONLY" tag over a session that can submit, save a baseline
                  and delete a draft is worse than no tag: it tells the developer
                  their next click is safe when it is not. */}
              <Tag
                className="slf-dev-banner-tag"
                color="volcano"
                style={{ marginInlineStart: "auto", marginInlineEnd: 0 }}
              >
                FULL CONTROL — WRITES ARE LIVE
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
          {/* `uiPrefsLoaded` gates the banner so a dismissed announcement is never
              rendered and then yanked away. If the preference read fails the flag
              still flips, so the banner shows — an announcement seen twice beats
              one that is never seen. */}
          {portalAnnouncement && uiPrefsLoaded && !announcementDismissed && (
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
                            dismissAnnouncement();
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

        {ORGANIZE_CELLS_ENABLED && (
          <Modal
            title={
              <Space>
                <ContainerOutlined style={{ color: "#722ed1" }} />
                <span>Organize Cell Placement</span>
                {organizerWork.placementSubs.length > 0 && (
                  <Tag color="purple">{organizerWork.placementSubs.length} submission(s) to place</Tag>
                )}
                {cellOrganizerData.length > 0 && (
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    onClick={() => setBulkOrganizeOpen(true)}
                    type="primary"
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
                          <li>Only waste that has <b>no disposal cell yet</b> is listed for placement. Waste that is already placed is never offered again — moving it is an EMB correction.</li>
                          <li><b>Pick a cell</b> for each row. Only cells that fit the <b>waste type</b> are offered (hazardous waste → a hazardous cell, residual waste → a residual cell), each with the room it has left <i>after the rows you have already chosen</i>.</li>
                          <li>To place many rows at once, <b>tick the checkboxes</b>, choose a cell in the purple bar and press <b>Apply</b> — rows that cell cannot take are skipped and counted. Or press <b>Auto-place</b> to fill every empty row into the compatible cell with the most room.</li>
                          <li>Placed waste still missing a <b>Truck Capacity</b> is listed separately at the bottom. Where that plate&apos;s capacity is on your <b>Baseline Data</b> it is filled in and marked <i>from baseline</i>; check it and edit only if that trip was different.</li>
                          <li>Click <b>Save Placement</b> to record your choices and update the cell fill levels. New submissions stay blocked until all past waste is placed and every missing capacity is completed.</li>
                        </ol>
                      ),
                    },
                  ]}
                />

                {/* Pre-filled capacities are stated up front: numbers appear in a
                    form the operator is about to submit, so where they came from
                    must be visible rather than implied. */}
                {prefilledCapacityCount > 0 && (
                  <Alert
                    type="success"
                    showIcon
                    message={`${prefilledCapacityCount} truck capacit${prefilledCapacityCount === 1 ? "y was" : "ies were"} filled in from your Baseline Data`}
                    description="These plates already have a declared capacity on your baseline, so you do not need to re-encode them. Each one is marked “from baseline” — review it and edit only if that trip was different. Nothing is saved until you click Save Placement."
                  />
                )}

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

              {/* ── Session progress + Auto-place ── */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #efdbff",
                  background: "#fdf9ff",
                }}
              >
                {organizerStats.toPlace > 0 ? (
                  <div style={{ flex: "1 1 240px", minWidth: 200 }}>
                    <Text style={{ fontSize: 12 }}>
                      <b>{organizerStats.placed.toLocaleString()}</b> of{" "}
                      <b>{organizerStats.toPlace.toLocaleString()}</b> unplaced load
                      {organizerStats.toPlace === 1 ? "" : "s"} assigned a cell
                    </Text>
                    <Progress
                      percent={Math.round((organizerStats.placed / organizerStats.toPlace) * 100)}
                      size="small"
                      strokeColor="#722ed1"
                      showInfo={false}
                      style={{ margin: 0 }}
                    />
                  </div>
                ) : (
                  <Text style={{ fontSize: 12, flex: "1 1 240px" }}>
                    <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 6 }} />
                    All your waste is already placed in cells.
                  </Text>
                )}
                {organizerStats.capacityNeeded > 0 && (
                  <Tag color={organizerStats.capacityFilled >= organizerStats.capacityNeeded ? "green" : "orange"} style={{ margin: 0 }}>
                    Truck capacity: {organizerStats.capacityFilled}/{organizerStats.capacityNeeded}
                  </Tag>
                )}
                {organizerStats.toPlace > organizerStats.placed && activeCellOptions.length > 0 && (
                  <Tooltip title="Fill every row that has no cell into the open cell of the right waste type with the most room left, largest loads first. Nothing is saved until you press Save Placement.">
                    <Button size="small" icon={<ThunderboltOutlined />} onClick={autoPlaceOrganizer}>
                      Auto-place {(organizerStats.toPlace - organizerStats.placed).toLocaleString()} row
                      {organizerStats.toPlace - organizerStats.placed === 1 ? "" : "s"}
                    </Button>
                  </Tooltip>
                )}
              </div>

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
                    options={activeCellOptions.map((o) => ({
                      label: `${o.label}${cellRoomLabel(o, organizerPlanned)}`,
                      value: o.value,
                    }))}
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
                items={organizerWork.placementSubs
                  .slice(
                    (cellOrganizerPage - 1) * cellOrganizerPageSize,
                    cellOrganizerPage * cellOrganizerPageSize,
                  )
                  .map((sub) => {
                  // ONLY waste that has no cell yet (splitOrganizerWork). Placed
                  // waste that is merely missing a Truck Capacity is listed in its
                  // own section below and never appears here as placement work.
                  const rows = (sub.placements || []).map((p) => ({
                    placement: p,
                    rowKey: `${sub._id}|${p.truckIndex}|${
                      Number.isInteger(p.vehicleIndex) ? p.vehicleIndex : "t"
                    }`,
                    truckIndex: p.truckIndex,
                    vehicleIndex: Number.isInteger(p.vehicleIndex) ? p.vehicleIndex : null,
                    plate: p.plateNumber || p.hauler || "-",
                    wasteType: p.wasteType || "Residual",
                    volume: p.actualVolume,
                    volumeUnit: p.actualVolumeUnit || baselineUnit || slfUnit,
                    // A cell counts only with a valid cell IDENTIFIER. A legacy
                    // name-only copy (cellName without cellIndex) is unassigned —
                    // showing it made the row read as "placed" while nothing could
                    // be written back, so the arrangement never persisted. Once the
                    // user picks a cell, updateOrganizerCell writes a real
                    // cellIndex and the selection renders normally.
                    cellName: Number.isInteger(p.cellIndex) ? p.cellName : undefined,
                    needsCell: p.needsCell !== false,
                    needsCapacity: !!p.needsCapacity,
                    capacity: p.capacity,
                    // Pre-filled from the baseline fleet, shown so the operator
                    // knows where the number came from and can correct it.
                    capacityPrefilled: !!p.capacityPrefilled,
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
                              // Only cells that fit the WASTE TYPE, with the room each
                              // has left after every OTHER row's choice in this
                              // session. There is no fallback to "any open cell":
                              // that fallback is how a hazardous load could be
                              // offered a residual cell.
                              const planned = new Map(organizerPlanned);
                              if (r.cellName && Number.isInteger(r.placement.cellIndex)) {
                                const own = rowVolumeM3(r.placement);
                                planned.set(r.placement.cellIndex, (planned.get(r.placement.cellIndex) || 0) - own);
                              }
                              const choices = cellChoicesFor(r.placement, activeCellOptions, planned);
                              if (!choices.length) {
                                return (
                                  <Tooltip title={`No open cell accepts ${r.wasteType} waste. Contact EMB Region III to open one.`}>
                                    <Select
                                      size="small"
                                      style={{ width: "100%" }}
                                      disabled
                                      status="warning"
                                      placeholder={`No open ${/haz|inert/i.test(r.wasteType) ? "hazardous" : "residual"} cell`}
                                    />
                                  </Tooltip>
                                );
                              }
                              return (
                                <Select
                                  size="small"
                                  style={{ width: "100%" }}
                                  placeholder="Select open cell"
                                  value={r.cellName || undefined}
                                  allowClear
                                  status={r.cellName ? "" : "warning"}
                                  popupMatchSelectWidth={false}
                                  options={choices.map(({ option: o, fits, room }) => ({
                                    value: o.value,
                                    // A full option stays selectable only if it is the
                                    // row's current choice, so the value still renders.
                                    disabled: !fits && o.value !== r.cellName,
                                    label: `${o.label}${Number.isFinite(room) ? cellRoomLabel(o, planned) : ""}${fits ? "" : " — not enough room"}`,
                                  }))}
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
                                <Space direction="vertical" size={0} style={{ width: "100%" }}>
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
                                  {r.capacityPrefilled && Number(r.capacity) > 0 && (
                                    <Tooltip title="Taken from this plate's capacity on your Baseline Data. Edit it if this trip was different.">
                                      <Text type="secondary" style={{ fontSize: 10 }}>
                                        from baseline
                                      </Text>
                                    </Tooltip>
                                  )}
                                </Space>
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
              {organizerWork.placementSubs.length > cellOrganizerPageSize && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Pagination
                    size="small"
                    current={cellOrganizerPage}
                    pageSize={cellOrganizerPageSize}
                    total={organizerWork.placementSubs.length}
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

              {/* ── Already placed — Truck Capacity still needed ──
                  Waste that HAS a cell is never placement work. It is listed here
                  only because a historical trip is missing its Truck Capacity,
                  which still blocks new submissions. The cell is shown, never
                  offered for change. */}
              {organizerWork.capacityRows.length > 0 && (
                <Collapse
                  size="small"
                  defaultActiveKey={organizerWork.placementSubs.length ? [] : ["capacity"]}
                  style={{ borderRadius: 10, background: "#fffbe6", borderColor: "#ffe58f" }}
                  items={[
                    {
                      key: "capacity",
                      label: (
                        <Space size={8} wrap>
                          <InfoCircleOutlined style={{ color: "#d48806" }} />
                          <Text strong style={{ fontSize: 13 }}>
                            Already placed — Truck Capacity still needed
                          </Text>
                          <Tag color="orange" style={{ margin: 0 }}>
                            {organizerWork.capacityRows.filter((c) => !(Number(c.placement.capacity) > 0)).length} of{" "}
                            {organizerWork.capacityRows.length} missing
                          </Tag>
                        </Space>
                      ),
                      children: (
                        <Table
                          size="small"
                          rowKey="key"
                          dataSource={organizerWork.capacityRows}
                          pagination={
                            organizerWork.capacityRows.length > 10
                              ? { pageSize: 10, size: "small", showSizeChanger: false, showTotal: (t) => `${t} load${t === 1 ? "" : "s"}` }
                              : false
                          }
                          columns={[
                            {
                              title: "Submission",
                              width: 150,
                              render: (_, c) => (
                                <div style={{ lineHeight: 1.3 }}>
                                  <Text style={{ fontSize: 12 }}>{c.sub.idNo || c.sub.submissionId || "Submission"}</Text>
                                  {c.sub.dateOfDisposal && (
                                    <div>
                                      <Text type="secondary" style={{ fontSize: 11 }}>
                                        {dayjs(c.sub.dateOfDisposal).format("MM/DD/YYYY")}
                                      </Text>
                                    </div>
                                  )}
                                </div>
                              ),
                            },
                            { title: "Truck / Plate", width: 120, render: (_, c) => <Text style={{ fontSize: 12 }}>{c.placement.plateNumber || c.placement.hauler || "-"}</Text> },
                            {
                              title: "Volume",
                              width: 100,
                              render: (_, c) => (
                                <Text style={{ fontSize: 12 }}>
                                  {Number(c.placement.actualVolume || 0).toLocaleString()}{" "}
                                  {String(c.placement.actualVolumeUnit || baselineUnit || slfUnit).replace("m3", "m³")}
                                </Text>
                              ),
                            },
                            {
                              title: "Placed in",
                              render: (_, c) => (
                                <Tag color="purple" bordered={false} style={{ margin: 0 }}>
                                  {c.placement.cellName || `Cell ${Number(c.placement.cellIndex) + 1}`}
                                </Tag>
                              ),
                            },
                            {
                              title: (
                                <span>
                                  Truck Capacity{" "}
                                  <Text type="secondary" style={{ fontSize: 10, fontWeight: 400 }}>
                                    ({String(baselineUnit || slfUnit).replace("m3", "m³")})
                                  </Text>
                                </span>
                              ),
                              width: 150,
                              render: (_, c) => (
                                <Space direction="vertical" size={0} style={{ width: "100%" }}>
                                  <InputNumber
                                    size="small"
                                    style={{ width: "100%" }}
                                    min={0}
                                    step={0.1}
                                    placeholder="Required"
                                    status={Number(c.placement.capacity) > 0 ? "" : "warning"}
                                    value={Number(c.placement.capacity) > 0 ? c.placement.capacity : undefined}
                                    onChange={(val) =>
                                      updateOrganizerCapacity(
                                        c.sub._id,
                                        c.placement.truckIndex,
                                        Number.isInteger(c.placement.vehicleIndex) ? c.placement.vehicleIndex : null,
                                        val,
                                      )
                                    }
                                  />
                                  {c.placement.capacityPrefilled && Number(c.placement.capacity) > 0 && (
                                    <Tooltip title="Taken from this plate's capacity on your Baseline Data. Edit it if this trip was different.">
                                      <Text type="secondary" style={{ fontSize: 10 }}>from baseline</Text>
                                    </Tooltip>
                                  )}
                                </Space>
                              ),
                            },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
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
          uploadPreviewSummary={uploadPreviewSummary}
          uploadPreviewColumns={uploadPreviewColumns}
          uploadMissingColumns={uploadMissingColumns}
          uploadDetection={uploadDetection}
          uploadAlignmentSummary={uploadAlignmentSummary}
          onUseStoredClient={useStoredClientForRows}
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
        {/* Closing (X / mask / Esc) and finishing both mean the same thing to the
            user — "I'm done with this" — so both route through the ONE helper
            that records it server-side. It previously wrote only to localStorage,
            which logout wipes, so the tour came back on the next sign-in. */}
        <Tour
          open={updateTourOpen}
          current={updateTourCurrent}
          onChange={setUpdateTourCurrent}
          onClose={dismissTourPermanently}
          onFinish={dismissTourPermanently}
          steps={updateTourSteps}
        />

        {/* Feature tour — one time per RELEASE.
            CLOSING it (X, Esc, clicking away) closes it for now and does NOT
            record the release as seen: dismissing something in the middle of a
            task is not a decision never to see it. Two actions do record it —
            finishing the last step, and the "Don't show this again" button on
            every step — and What's New reopens it on demand either way. */}
        <Tour
          open={featureTourOpen}
          current={featureTourCurrent}
          // Steps span both Data Entry tabs, and the tabs render lazily — so when
          // the next step lives on the other one, switch first and let it mount
          // before antd measures the target. Advancing immediately would anchor
          // the step to nothing.
          onChange={(next) => {
            const tab = featureTourSteps[next]?.tab;
            if (tab && tab !== activeTab) {
              setActiveTab(tab);
              setTimeout(() => setFeatureTourCurrent(next), 160);
              return;
            }
            setFeatureTourCurrent(next);
          }}
          onClose={() => setFeatureTourOpen(false)}
          onFinish={markFeatureTourSeen}
          steps={featureTourSteps}
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
