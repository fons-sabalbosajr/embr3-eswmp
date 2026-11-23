import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Card,
  List,
  Segmented,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Divider,
  Row,
  Col,
  Typography,
  DatePicker,
  Tooltip,
  Tabs,
  Collapse,
  Statistic,
  Descriptions,
  Badge,
  Popconfirm,
  Switch,
  Spin,
  Empty,
  Progress,
  Skeleton,
  Alert,
  Upload,
  Image,
  message,
  Checkbox,
  Avatar,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SearchOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  ReloadOutlined,
  TeamOutlined,
  CalendarOutlined,
  BarChartOutlined,
  InboxOutlined,
  CarOutlined,
  FilterOutlined,
  ClearOutlined,
  SafetyCertificateOutlined,
  BankOutlined,
  MinusCircleOutlined,
  LinkOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  AlertOutlined,
  UserOutlined,
  SolutionOutlined,
  UndoOutlined,
  BellOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  MailOutlined,
  SendOutlined,
  WarningOutlined,
  UploadOutlined,
  TableOutlined,
  PieChartOutlined,
  FileImageOutlined,
  FolderOutlined,
  FilePdfOutlined,
  CalculatorOutlined,
  CopyOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import _Swal from "sweetalert2";
// All SweetAlert2 popups in this file appear over AntD modals (z-index ≥ 1000).
const Swal = _Swal.mixin({ customClass: { container: "swal-over-modal" } });
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { getAdminDisplayName } from "../../utils/adminIdentity";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import { useDataRef } from "../../utils/dataRef";
import excludeDummy from "../../utils/excludeDummy";
import dayjs from "dayjs";
import {
  buildFilters,
  matchesFilter,
  rowMatchesSearch,
} from "./shared/tableFilters";
import {
  PieChart,
  Pie,
  Cell as RCell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import ResponsiveTable from "./shared/ResponsiveTable";
import {
  fetchAllSubmissions,
  getSubmissionVolumeSummary,
  getTruckCapacityText,
  getTruckPlateText,
  normalizeSubmissionRecord,
} from "./shared/submissionRecords";

const { Title, Text } = Typography;
import SlfDashboardTab, {
  sumBy,
  groupMetric,
  topMetric,
  computeFields,
  formatCompact,
  DashboardMetricCard,
  InsightStat,
  getStatusTag,
  buildSubmissionFacilityIndex,
  getFacilityCandidateSubmissions,
  expandSlfNames,
  getFacilitySlfNames,
  getBaselineSlfNames,
  getSubmissionSlfNames,
  getRecordIds,
  getSubmissionSlfId,
  getDataEntryId,
  submissionMatchesFacility,
  parseCellIndex,
  getTruckCellIndex,
  hasTruckVolume,
  findBestCellIndex,
  CACHE_KEY,
  CACHE_TTL,
  buildBaselineMap,
  findBaselineForFacility,
  enrichFacilityWithBaseline,
  R3_PROVINCES,
} from "./slf-monitoring/SlfDashboardTab";
import WasteBaselineInfo from "./slf-monitoring/WasteBaselineInfo";
import { makeMonitoringColumns } from "./slf-monitoring/monitoringColumns";
import MapPreviewModal from "./slf-monitoring/modals/MapPreviewModal";
import FilePreviewModal from "./slf-monitoring/modals/FilePreviewModal";
import UnitToolModal from "./slf-monitoring/modals/UnitToolModal";
import SlfWasteModal from "./slf-monitoring/modals/SlfWasteModal";
import DailySubmissionsModal from "./slf-monitoring/modals/DailySubmissionsModal";
import SlfInsightModal from "./slf-monitoring/modals/SlfInsightModal";
import SlfInsightDetailModal from "./slf-monitoring/modals/SlfInsightDetailModal";
import ConversionToolsModal from "./slf-monitoring/modals/ConversionToolsModal";
import SlfLguModal from "./slf-monitoring/modals/SlfLguModal";
import CellAssignmentModal from "./slf-monitoring/modals/CellAssignmentModal";
import SlfDetailModal from "./slf-monitoring/modals/SlfDetailModal";
import SlfEditModal from "./slf-monitoring/modals/SlfEditModal";
import PortalGenerators from "./slf-monitoring/PortalGenerators";
import HaulerClientsTab from "./slf-monitoring/HaulerClientsTab";
import HaulerClientsEditor from "./slf-monitoring/HaulerClientsEditor";
import {
  resolveCellName,
  getCellTypeConfig,
  getSlfCapacityColor,
  isNonExistentCell,
} from "../../utils/cellVisuals";
import {
  ACCENT,
  CHART_COLORS,
  managementStatusSummary,
  asStringArray,
  formatStringArray,
  normalizeUnit,
  normalizeCellStatus,
  isActiveCellStatus,
  isCompletedCellStatus,
  ACTIVE_VOLUME_STATUSES,
  TON_PER_M3,
  UNIT_OPTIONS,
  CELL_STATUS_OPTIONS,
  CELL_STATUS_COLORS,
  PERMIT_STATUS_OPTIONS,
  DP_TYPE_OPTIONS,
  WWTF_TYPE_OPTIONS,
  RECEIVING_FACILITY_TYPE_OPTIONS,
  GALLERY_COMPONENT_OPTIONS,
  getUploadHeaders,
  formatFileSize,
  getUploadFileSize,
  validateSlfUpload,
  renderSlfUploadItem,
  renderUploadStatusCell,
  slfUploadProps,
  uploadEventToFileList,
  convertVolume,
  resolveFacilityUnit,
  getWasteKind,
  isHazardousCellType,
  resolveMediaUrl,
  resolveMediaOpenUrl,
  resolveMediaPreviewUrl,
  getMediaKind,
  normalizeStoredFileUrl,
  fileNameFromUrl,
  getServedClientCount,
} from "./slf-monitoring/helpers.jsx";

const EMPTY_ROWS = [];

// Extract the original filename to PERSIST on save. Freshly uploaded rows expose
// it via the server response; already-saved rows keep the previously stored
// `fileName`; AntD's item name is the last resort. The opaque URL id is never used.
const uploadNameFromValue = (value, existing = "") => {
  const file = Array.isArray(value) ? value[0] : null;
  return file?.response?.name || existing || file?.name || "";
};

const fileUrlFromUploadFile = (file) =>
  typeof file === "string" ? file : file?.response?.url || file?.url || "";

const defaultPreventiveFileDescription = (name) =>
  `Uploaded preventive measure file: ${name || "supporting document"}`;

function ensureSlfDetailTabStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("slf-detail-tabs-styles")) return;
  const style = document.createElement("style");
  style.id = "slf-detail-tabs-styles";
  style.textContent = `
    .slf-detail-tabs .ant-tabs-tab { border-radius: 6px; margin: 2px 6px !important; padding: 6px 12px !important; transition: background .15s, opacity .15s; }
    .slf-detail-tabs .ant-tabs-tab .ant-tabs-tab-btn { opacity: .68; font-weight: 500; }
    .slf-detail-tabs .ant-tabs-tab:hover { background: rgba(22,119,255,.10); }
    .slf-detail-tabs .ant-tabs-tab:hover .ant-tabs-tab-btn { opacity: 1; }
    .slf-detail-tabs .ant-tabs-tab-active { background: rgba(22,119,255,.16); }
    .slf-detail-tabs .ant-tabs-tab-active .ant-tabs-tab-btn { opacity: 1; font-weight: 700; }
    .slf-detail-tabs .ant-tabs-tab:focus-visible { outline: 2px solid #1677ff; outline-offset: 1px; }
  `;
  document.head.appendChild(style);
}

export default function SLFMonitoring({
  canEdit = true,
  canDelete = true,
  isDark,
  driveDisabled = false,
}) {
  ensureSlfDetailTabStyles();
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({
    label: p,
    value: p,
  }));
  const monthOptions = getValues("target-month").map((m) => ({
    label: m.replace(/^\d+\./, ""),
    value: m,
  }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({
    label: v,
    value: v,
  }));
  const slfStatusOptions = getValues("slf-status").map((v) => ({
    label: v,
    value: v,
  }));
  const ownershipOptions = getValues("ownership").map((v) => ({
    label: v,
    value: v,
  }));
  const wasteTypeOptions = getValues("waste-type").map((v) => ({
    label: v,
    value: v,
  }));
  const enmoOptions = getValues("enmo").map((v) => ({ label: v, value: v }));
  const eswmStaffOptions = getValues("eswm-staff").map((v) => ({
    label: v,
    value: v,
  }));
  const focalOptions = getValues("eswm-focal").map((v) => ({
    label: v,
    value: v,
  }));
  const districtDefaults = ["Lone", "1st", "2nd", "3rd", "4th", "5th"];
  const districtRefValues = getValues("congressional-district");
  const districtOptions = (() => {
    const merged = [
      ...districtDefaults,
      ...districtRefValues.filter((v) => !districtDefaults.includes(v)),
    ];
    return merged.map((v) => ({
      label: v === "Lone" ? "Lone District" : `${v} District`,
      value: v,
    }));
  })();
  const categoryDefaults = [
    { label: "Category 1 \u2014 < 15 TPD", value: "Cat 1" },
    { label: "Category 2 \u2014 15\u201375 TPD", value: "Cat 2" },
    { label: "Category 3 \u2014 75\u2013150 TPD", value: "Cat 3" },
    { label: "Category 4 \u2014 > 150 TPD", value: "Cat 4" },
  ];
  const categoryRefValues = getValues("slf-category");
  const categoryOptions = (() => {
    const defaultVals = categoryDefaults.map((d) => d.value);
    const extra = categoryRefValues
      .filter((v) => !defaultVals.includes(v))
      .map((v) => ({ label: v, value: v }));
    return [...categoryDefaults, ...extra];
  })();

  const [records, setRecords] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [loading, setLoading] = useState(true); // start true so spinner shows on first mount
  // Dedicated state for the Refresh button so it spins ONLY for a user-triggered
  // refresh — not for unrelated background loads that also toggle `loading`.
  const [refreshing, setRefreshing] = useState(false);
  const [loadingGen, setLoadingGen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [galleryViewMode, setGalleryViewMode] = useState("tiled");
  const [detailYearRecords, setDetailYearRecords] = useState([]);
  const [detailYear, setDetailYear] = useState(null);
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false);
  const [baselineData, setBaselineData] = useState(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [detailSubmissionsLoading, setDetailSubmissionsLoading] =
    useState(false);
  const [detailDashboardError, setDetailDashboardError] = useState(null);
  // FULL submissions (with trucks[]/vehicles[]) for the ONE facility whose detail
  // modal is open. Kept out of the page-wide `slfSubmissions` so the heavy payload
  // is dropped the moment the modal closes instead of accumulating per facility.
  const [detailSubmissions, setDetailSubmissions] = useState([]);
  // Real, measured progress for the detail-modal load — { stage, done, total }.
  // Never a fabricated percentage: `done`/`total` are actual record counts and the
  // stage names are the actual steps the effect runs.
  const [detailProgress, setDetailProgress] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editYear, setEditYear] = useState(null);
  const [editYearRecords, setEditYearRecords] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [filterProvince, setFilterProvince] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  // Data Year the table is showing. `null` = "Latest per SLF" (the historical
  // behaviour). Without this the table only ever rendered each facility's newest
  // dataYear row, so a record saved against an EARLIER year vanished from view the
  // moment it was created — it was still in the database, just never listed.
  const [filterDataYear, setFilterDataYear] = useState(null);
  const [quickFilter, setQuickFilter] = useState(null);
  // #5: filter bar is now toggled from the header toolbar (collapsed by default so
  // the table gets more vertical space); the active-filter count stays on the button.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [slfInsightModal, setSlfInsightModal] = useState(null);
  const [slfLguModal, setSlfLguModal] = useState(false);
  const [slfWasteModal, setSlfWasteModal] = useState(false);
  const [convArea, setConvArea] = useState(null);
  const [convDepth, setConvDepth] = useState(null);
  const [convVol, setConvVol] = useState(null);
  const [convDensity, setConvDensity] = useState(0.2);
  const [convM3ToTons, setConvM3ToTons] = useState(null);
  const [convModalOpen, setConvModalOpen] = useState(false);
  const [unitToolOpen, setUnitToolOpen] = useState(false);
  const [unitToolValue, setUnitToolValue] = useState("tons");
  // In-app file/PDF preview modal (Documents + Preventive Measures viewers).
  const [filePreview, setFilePreview] = useState({ open: false, url: "", name: "" });
  const openFilePreview = useCallback((url, name = "") => {
    const raw = normalizeStoredFileUrl(url) || (typeof url === "string" ? url : "");
    if (!raw) return;
    setFilePreview({ open: true, url: raw, name: name || "" });
  }, []);
  const [saving, setSaving] = useState(false);
  const [capacityAlertModal, setCapacityAlertModal] = useState(null);
  const [capacityAlertSending, setCapacityAlertSending] = useState(false);
  const [mapPreview, setMapPreview] = useState(null);
  const [slfSubmissions, setSlfSubmissions] = useState([]);
  // facilityId → the server's canonical per-cell rollup. See /data-slf/cell-occupancy.
  const [cellOccupancy, setCellOccupancy] = useState({});
  const [cellAssignmentModal, setCellAssignmentModal] = useState(null);
  // The placement editor now fetches its facility's real submissions on open, so
  // its trigger needs a pending state to stop a second click firing a second fetch.
  const [cellAssignmentLoading, setCellAssignmentLoading] = useState(false);
  const [cellAssignmentSaving, setCellAssignmentSaving] = useState(false);
  const [cellActionSaving, setCellActionSaving] = useState({});
  const cellActionSavingRef = useRef({});
  const [dailySubmissionsModal, setDailySubmissionsModal] = useState({
    open: false,
    cell: null,
    rows: [],
  });
  const [form] = Form.useForm();
  // False once the page unmounts — guards the async fetch chains below from
  // seating a large dataset into a component that is already gone.
  const aliveRef = useRef(true);

  const normalizeSlfSubmissions = (items = []) =>
    (items || []).map(normalizeSubmissionRecord);

  const updateFacilityLocal = useCallback((facility) => {
    if (!facility?._id) return;
    const updatedRecord = { ...facility, ...computeFields(facility) };
    setRecords((prev) => prev.map((r) => (r._id === facility._id ? updatedRecord : r)));
    setEditYearRecords((prev) => prev.map((r) => (r._id === facility._id ? updatedRecord : r)));
    setEditing((prev) => (prev?._id === facility._id ? updatedRecord : prev));
    setDetailModal((prev) => (prev?._id === facility._id ? updatedRecord : prev));
    invalidateCache(`${CACHE_KEY}-fast`);
    invalidateCache(`${CACHE_KEY}-full`);
    secureStorage.invalidateDashboard();
  }, []);

  const saveCellStatusNow = useCallback(async (index, nextStatus) => {
    if (!editing?._id) return;
    const key = `status-${index}`;
    if (cellActionSavingRef.current[key]) return;
    const prevStatuses = [...(form.getFieldValue("cellStatuses") || [])];
    const prevAllowed = [...(form.getFieldValue("cellSubmissionAllowed") || [])];
    const nextStatuses = [...prevStatuses];
    const nextAllowed = [...prevAllowed];
    nextStatuses[index] = nextStatus;
    if (!isActiveCellStatus(nextStatus)) nextAllowed[index] = false;
    form.setFieldsValue({ cellStatuses: nextStatuses, cellSubmissionAllowed: nextAllowed });
    cellActionSavingRef.current[key] = true;
    setCellActionSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const { data } = await api.patch(`/slf-facilities/${editing._id}/cell-status`, {
        cellIndex: index,
        status: nextStatus,
      });
      updateFacilityLocal(data);
    } catch (err) {
      form.setFieldsValue({ cellStatuses: prevStatuses, cellSubmissionAllowed: prevAllowed });
      message.error(err.response?.data?.message || "Could not update cell status.");
    } finally {
      cellActionSavingRef.current[key] = false;
      setCellActionSaving((prev) => ({ ...prev, [key]: false }));
    }
  }, [editing?._id, form, updateFacilityLocal]);

  const saveCellSubmissionAllowedNow = useCallback(async (index, allowed) => {
    if (!editing?._id) return;
    const key = `portal-${index}`;
    if (cellActionSavingRef.current[key]) return;
    const prevAllowed = [...(form.getFieldValue("cellSubmissionAllowed") || [])];
    const nextAllowed = [...prevAllowed];
    nextAllowed[index] = allowed;
    form.setFieldsValue({ cellSubmissionAllowed: nextAllowed });
    cellActionSavingRef.current[key] = true;
    setCellActionSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const { data } = await api.patch(`/slf-facilities/${editing._id}/cell-submission-allowed`, {
        cellIndex: index,
        allowed,
      });
      updateFacilityLocal(data);
    } catch (err) {
      form.setFieldsValue({ cellSubmissionAllowed: prevAllowed });
      message.error(err.response?.data?.message || "Could not update portal cell availability.");
    } finally {
      cellActionSavingRef.current[key] = false;
      setCellActionSaving((prev) => ({ ...prev, [key]: false }));
    }
  }, [editing?._id, form, updateFacilityLocal]);

  const fetchRecords = useCallback(async (skipCache = false) => {
    // ── Phase 1: Load facilities + baselines first → render table immediately ──
    // Submissions (needed for cell-fill %) are fetched in the background below.
    let facilitiesCache = null;
    let baselineMapCache = null;
    const FAST_CACHE_KEY = `${CACHE_KEY}-fast`;
    await fetchWithCache(
      FAST_CACHE_KEY,
      async () => {
        const [{ data: facilities }, { data: baselines }, summaryRes] =
          await Promise.all([
            api.get("/slf-facilities"),
            api.get("/data-slf/baselines"),
            api.get("/data-slf/summary-by-slf").catch(() => ({ data: [] })),
          ]);
        // Defensive: exclude dummy/test facilities from the monitoring dashboard
        // (backend already excludes them from /slf-facilities by default).
        facilitiesCache = excludeDummy(facilities || []);
        baselineMapCache = buildBaselineMap(baselines || []);
        // Per-SLF waste totals from a fast server aggregation seed the summary
        // tiles immediately, so they no longer wait for the heavy submissions
        // list (phase 2 still refines exact cell-fill %).
        const wasteByName = new Map();
        (Array.isArray(summaryRes.data) ? summaryRes.data : []).forEach(
          (row) => {
            const total = Number(row.totalM3 || 0) + Number(row.totalTons || 0);
            if (row.slfName && total > 0) {
              wasteByName.set(String(row.slfName).trim().toLowerCase(), total);
            }
          },
        );
        return {
          records: facilitiesCache.map((record) => {
            const enriched = enrichFacilityWithBaseline(
              record,
              findBaselineForFacility(record, baselineMapCache),
              [], // no submissions yet — cell-fill loads in phase 2
            );
            if (!(enriched.actualResidualWasteReceived > 0)) {
              const seed =
                wasteByName.get(
                  String(record.lgu || "")
                    .trim()
                    .toLowerCase(),
                ) ||
                wasteByName.get(
                  String(record.slfName || "")
                    .trim()
                    .toLowerCase(),
                );
              if (seed > 0) enriched.actualResidualWasteReceived = seed;
            }
            return enriched;
          }),
        };
      },
      {
        ttl: CACHE_TTL,
        force: skipCache,
        onData: (data) => {
          if (!aliveRef.current) return; // page already left — don't re-seat data
          const rows = Array.isArray(data) ? data : data?.records || [];
          setRecords(rows.map((r) => ({ ...r, ...computeFields(r) })));
        },
        onError: () => {
          if (aliveRef.current)
            Swal.fire("Error", "Failed to load SLF facilities", "error");
        },
        onStart: () => setLoading(true),
        onEnd: () => setLoading(false),
      },
    );

    // ── Phase 2 (background): submissions only → re-enrich for cell-fill % ──
    try {
      const FULL_CACHE_KEY = `${CACHE_KEY}-full`;
      await fetchWithCache(
        FULL_CACHE_KEY,
        async () => {
          // Only the cell-volume rollup is fetched here; facilities and baselines
          // are reused from Phase 1 to avoid duplicate requests.
          //
          // This used to be `/data-slf?mode=list&cellUsage=true` — an UNPAGINATED
          // read of every submission (measured: 3.2MB / ~39s against the live DB)
          // whose only job was to let buildFacilityCellUsage sum truck volumes per
          // cell. /data-slf/cell-usage does that collapse in the database and
          // returns the same totals in ~285KB / ~3s. Anything needing real per-truck
          // rows (the detail modal, the cell-assignment editor) fetches its own
          // facility's full records on demand.
          //
          // `/data-slf/cell-occupancy` is the AUTHORITATIVE per-cell rollup
          // (server-side computeCellOccupancy — the same function that writes
          // SlfFacility.cellFillValues). It replaces the browser's own
          // re-derivation of Waste in Cell, which could not see per-vehicle
          // placements and disagreed with the stored gauge after a cell move.
          // The cell-usage rows are still fetched for the per-truck drill-downs
          // that need real submission rows; both requests run in parallel.
          const calls = [api.get("/data-slf/cell-usage"), api.get("/data-slf/cell-occupancy")];
          if (!facilitiesCache) calls.push(api.get("/slf-facilities"));
          if (!baselineMapCache) calls.push(api.get("/data-slf/baselines"));
          const res = await Promise.all(calls);
          const submissions = res[0].data;
          const occupancyByFacility = res[1]?.data?.byFacility || {};
          let idx = 2;
          if (!facilitiesCache)
            facilitiesCache = excludeDummy(res[idx++]?.data || []);
          if (!baselineMapCache)
            baselineMapCache = buildBaselineMap(res[idx]?.data || []);
          const normalizedSubmissions = normalizeSlfSubmissions(
            Array.isArray(submissions) ? submissions : submissions?.data || [],
          );
          const submissionIndex = buildSubmissionFacilityIndex(
            normalizedSubmissions,
          );
          return {
            records: facilitiesCache.map((record) =>
              enrichFacilityWithBaseline(
                record,
                findBaselineForFacility(record, baselineMapCache),
                getFacilityCandidateSubmissions(record, submissionIndex),
                occupancyByFacility[String(record._id)] || null,
              ),
            ),
            // Keep the lean set in memory for table-level cell math; the detail
            // modal fetches the richer per-facility data when opened.
            submissions: normalizedSubmissions,
            occupancy: occupancyByFacility,
          };
        },
        {
          ttl: CACHE_TTL,
          force: skipCache,
          onData: (data) => {
            // Phase 2 resolves in the background. If the admin navigated away while
            // it was in flight, bailing here is what stops a large submissions array
            // from being seated into a component that no longer exists.
            if (!aliveRef.current) return;
            const rows = Array.isArray(data) ? data : data?.records || [];
            setSlfSubmissions(
              Array.isArray(data) ? [] : data?.submissions || [],
            );
            setCellOccupancy(Array.isArray(data) ? {} : data?.occupancy || {});
            // Silently replace records with fully-enriched version (no spinner)
            setRecords(rows.map((r) => ({ ...r, ...computeFields(r) })));
          },
        },
      );
    } catch {
      // Phase 2 failure is non-fatal — table already shows from Phase 1
    }
  }, []);

  const fetchGenerators = useCallback(async () => {
    setLoadingGen(true);
    try {
      const { data } = await api.get("/slf-generators");
      setGenerators(data);
    } catch {
      /* silent */
    } finally {
      setLoadingGen(false);
    }
  }, []);

  // User-triggered refresh: owns its own spinner, always awaits the refetch,
  // catches failures and resets in finally (so it can never hang), and ignores
  // re-clicks while already refreshing.
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchRecords(true);
    } catch {
      /* fetchRecords surfaces its own error; nothing else to do here */
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, [refreshing, fetchRecords]);

  useEffect(() => {
    fetchRecords();
    fetchGenerators();
  }, [fetchRecords, fetchGenerators]);

  // Page-exit cleanup. `fetchRecords` runs a two-phase background chain that can
  // still be in flight when the admin navigates away; without this, a response
  // landing after unmount would push a fresh multi-hundred-KB array back into
  // state, and React keeps that final state object reachable from the pending
  // closure until it settles. Marking the page dead lets those callbacks bail,
  // and dropping the big arrays here releases them immediately rather than
  // waiting on the closures to unwind.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      setRecords(EMPTY_ROWS);
      setSlfSubmissions(EMPTY_ROWS);
      setDetailSubmissions(EMPTY_ROWS);
      setGenerators(EMPTY_ROWS);
      setDetailYearRecords(EMPTY_ROWS);
      setDailySubmissionsModal({ open: false, cell: null, rows: EMPTY_ROWS });
    };
  }, []);

  // Keep the SLF Monitoring Dashboard + Waste Generators tabs in sync with newly
  // submitted portal data. Driven by live socket events (no aggressive polling),
  // so it stays fresh without adding load to the SLF Data Table page.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    // Debounce: a burst of submissions/baseline events (e.g. a bulk portal upload)
    // otherwise fires one full heavy refetch PER event. Collapse them into a single
    // refresh, and clear the pending timer on unmount so it never fires into a dead
    // component.
    let refreshTimer = null;
    const handler = ({ target } = {}) => {
      // "facility" is emitted by refreshFacilityCellOccupancy — the write that
      // changes Waste in Cell after a placement is organized, moved or corrected.
      if (!target || target === "submissions" || target === "baselines" || target === "facility") {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          refreshTimer = null;
          if (!aliveRef.current) return;
          invalidateCache(`${CACHE_KEY}-fast`);
          invalidateCache(`${CACHE_KEY}-full`);
          fetchRecords(true);
          fetchGenerators();
        }, 800);
      }
    };
    socket.on("data-refresh", handler);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.off("data-refresh", handler);
    };
  }, [fetchRecords, fetchGenerators]);

  // Fetch baseline + submission data when the detail modal opens for a facility.
  //
  // Both requests are ABORTED and their results ignored when the user switches to
  // another facility (or closes the modal) before they land. Without this, opening
  // facility A then quickly opening B let A's slower response overwrite B's
  // submissions/baseline — the modal would show B's title over A's data.
  useEffect(() => {
    setDetailDashboardError(null);
    if (!detailModal) {
      setBaselineData(null);
      setDetailSubmissionsLoading(false);
      setDetailProgress(null);
      setDetailSubmissions(EMPTY_ROWS); // release the heavy per-facility payload
      return undefined;
    }

    // Switching facilities must not stack payloads: drop the previous facility's
    // full submissions before loading the next one.
    setDetailSubmissions(EMPTY_ROWS);

    const controller = new AbortController();
    let cancelled = false; // guards the state writes even after an abort resolves

    const candidateNames = expandSlfNames(getFacilitySlfNames(detailModal));
    if (candidateNames.length === 0) {
      setBaselineData(null);
    } else {
      setLoadingBaseline(true);
      // Cached: this endpoint returns EVERY SLF's baseline (a ~440 KB payload) and
      // was re-downloaded on every single facility open just to pick one row out
      // of it. The cache collapses that to one request per TTL.
      fetchWithCache(
        `${CACHE_KEY}-baselines`,
        () =>
          api
            .get("/data-slf/baselines", { signal: controller.signal })
            .then(({ data }) => data || []),
        {
          ttl: CACHE_TTL,
          onData: (data) => {
            if (cancelled) return;
            setBaselineData(
              findBaselineForFacility(
                detailModal,
                buildBaselineMap(data || []),
              ),
            );
          },
          onError: () => {
            if (cancelled) return;
            setBaselineData(null);
            setDetailDashboardError("Failed to load baseline data.");
          },
        },
      ).finally(() => {
        if (!cancelled) setLoadingBaseline(false);
      });
    }

    // Lazy-load FULL submissions for just this facility so the detail modal shows
    // rich data (company, ID, trucks) without keeping every submission in memory.
    const slfName = detailModal.slfName || detailModal.lgu || "";
    if (slfName) {
      setDetailSubmissionsLoading(true);
      setDetailProgress({ stage: "Loading submissions", done: 0, total: 0 });
      // Paged: scoped to one facility, but a busy SLF still runs to hundreds of
      // records with their trucks attached — too much for a single response.
      // The abort signal is forwarded so closing the modal stops the loop
      // instead of letting it fetch every remaining page.
      fetchAllSubmissions(
        { includeTrucks: true, search: slfName },
        { signal: controller.signal },
      )
        .then((rows) => {
          if (cancelled) return;
          setDetailProgress({
            stage: "Normalizing records",
            done: 0,
            total: rows.length,
          });
          const full = rows.map(normalizeSubmissionRecord);
          setDetailProgress({
            stage: "Preparing results",
            done: rows.length,
            total: rows.length,
          });
          // Held SEPARATELY from the page-wide lean `slfSubmissions`, and released
          // when the modal closes (see the cleanup below).
          //
          // This used to merge the heavy records — each carrying its full
          // trucks[]/vehicles[] payload — straight into `slfSubmissions`, where
          // they stayed for the life of the page. Every facility you opened
          // permanently upgraded another slice of the array to full-fat, so
          // browsing facilities grew the heap monotonically and nothing was ever
          // freed until you left the page entirely.
          setDetailSubmissions(full);
        })
        .catch((err) => {
          // An aborted request is an expected outcome of navigating away, not a failure.
          if (
            cancelled ||
            err?.name === "CanceledError" ||
            err?.code === "ERR_CANCELED"
          )
            return;
          setDetailDashboardError("Failed to load submission data.");
        })
        .finally(() => {
          if (!cancelled) {
            setDetailSubmissionsLoading(false);
            setDetailProgress(null);
          }
        });
    } else {
      setDetailSubmissionsLoading(false);
    }

    return () => {
      cancelled = true;
      controller.abort();
      // Drop the heavy payload when the modal closes or the page unmounts, so a
      // late-resolving response can never re-seat a large dataset we no longer show.
      setDetailSubmissions(EMPTY_ROWS);
      // Its rows hold references INTO that payload (each row keeps a `submission`
      // and a `truck`), so leaving them behind would pin the whole thing.
      setDailySubmissionsModal({ open: false, cell: null, rows: EMPTY_ROWS });
    };
  }, [detailModal]);

  // Fetch cross-year history when viewing a facility record
  useEffect(() => {
    if (!detailModal) {
      setDetailYearRecords([]);
      setDetailYear(null);
      setDetailHistoryLoading(false);
      return;
    }
    const lgu = detailModal.lgu;
    if (!lgu) {
      setDetailYearRecords([]);
      setDetailYear(detailModal.dataYear || new Date().getFullYear());
      setDetailHistoryLoading(false);
      return;
    }
    setDetailHistoryLoading(true);
    // Same stale-response guard as the effect above — switching facilities must
    // not let the previous facility's history land in the open modal.
    const controller = new AbortController();
    let cancelled = false;
    api
      .get(`/slf-facilities/history/${encodeURIComponent(lgu)}`, {
        signal: controller.signal,
      })
      .then(({ data }) => {
        if (cancelled) return;
        const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
        setDetailYearRecords(enriched);
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      })
      .catch((err) => {
        if (
          cancelled ||
          err?.name === "CanceledError" ||
          err?.code === "ERR_CANCELED"
        )
          return;
        setDetailYearRecords([]);
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      })
      .finally(() => {
        if (!cancelled) setDetailHistoryLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detailModal]);

  // ONE canonical set of submissions for the open facility. Previously three
  // separate places each re-filtered the whole page-wide array and kept their own
  // copy; now they all read this. Prefers the full per-facility payload when it has
  // arrived, else falls back to the lean page-wide list.
  const facilitySubmissions = useMemo(() => {
    if (!detailModal) return EMPTY_ROWS;
    const source = detailSubmissions.length
      ? detailSubmissions
      : slfSubmissions;
    return source.filter(
      (sub) =>
        ACTIVE_VOLUME_STATUSES.has(sub.status || "pending") &&
        submissionMatchesFacility(detailModal, sub),
    );
  }, [detailModal, detailSubmissions, slfSubmissions]);

  const detailViewRecord = useMemo(() => {
    if (!detailModal) return null;
    const baseRecord =
      detailYearRecords.length === 0
        ? detailModal
        : detailYearRecords.find(
            (r) => (r.dataYear || new Date().getFullYear()) === detailYear,
          ) || null;
    // Cell fill comes from the server rollup so View SLF Details, the SLF
    // Dashboard gauges and Cell Infrastructure all show the same Waste in Cell.
    // Submissions are still passed for the fallback path.
    return enrichFacilityWithBaseline(
      baseRecord,
      baselineData,
      facilitySubmissions,
      cellOccupancy[String(baseRecord?._id || "")] || null,
    );
  }, [
    baselineData,
    detailModal,
    detailYearRecords,
    detailYear,
    facilitySubmissions,
    cellOccupancy,
  ]);

  // Consolidated dashboard data for the "SLF Dashboard" tab in the view modal.
  const detailDashboard = useMemo(() => {
    const facility = detailViewRecord;
    if (!facility || !detailModal) return null;
    const subs = facilitySubmissions; // shared — no second full-array filter pass
    const unit = normalizeUnit(
      facility.wasteReceivedUnit ||
        facility.volumeCapacityUnit ||
        facility.baselineUnit ||
        "m³",
    );
    let totalTrucks = 0;
    let totalVolume = 0;
    let residual = 0;
    let hazardous = 0;
    const generators = new Map();
    const monthMap = new Map();
    const companyTypeCounts = { LGU: 0, Private: 0 };
    const statusCounts = {};
    const cellCount = Number(
      facility.numberOfCell || facility.cellCapacities?.length || 0,
    );
    const cellUsed = Array(cellCount).fill(0);
    const tableRows = [];

    subs.forEach((sub) => {
      const status = sub.status || "pending";
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const ct = sub.companyType === "Private" ? "Private" : "LGU";
      companyTypeCounts[ct] = (companyTypeCounts[ct] || 0) + 1;
      const gName = sub.lguCompanyName || "Unknown";
      const month = sub.dateOfDisposal
        ? dayjs(sub.dateOfDisposal).format("YYYY-MM")
        : sub.createdAt
          ? dayjs(sub.createdAt).format("YYYY-MM")
          : "Unknown";
      let subVolume = 0;
      (sub.trucks || []).forEach((truck) => {
        totalTrucks += 1;
        const placements = (truck.vehicles || []).filter(
          (v) => Number(v.actualVolume || 0) > 0,
        );
        const items = placements.length
          ? placements.map((v) => ({
              vol: v.actualVolume,
              vunit: v.actualVolumeUnit || truck.actualVolumeUnit,
              wt: v.wasteType || truck.wasteType,
              cellIndex: v.cellIndex,
            }))
          : [
              {
                vol: truck.actualVolume,
                vunit: truck.actualVolumeUnit,
                wt: truck.wasteType,
                cellIndex: truck.cellIndex,
              },
            ];
        items.forEach(({ vol, vunit, wt, cellIndex }) => {
          const v = convertVolume(vol, vunit || unit, unit);
          if (!v) return;
          totalVolume += v;
          subVolume += v;
          if (getWasteKind(wt) === "hazardous") hazardous += v;
          else residual += v;
          generators.set(gName, (generators.get(gName) || 0) + v);
          monthMap.set(month, (monthMap.get(month) || 0) + v);
          const idx = Number(cellIndex);
          if (Number.isInteger(idx) && idx >= 0 && idx < cellCount)
            cellUsed[idx] += v;
        });
      });
      tableRows.push({
        _id: sub._id,
        idNo: sub.idNo,
        dateOfDisposal: sub.dateOfDisposal,
        lguCompanyName: sub.lguCompanyName,
        companyType: sub.companyType,
        truckCount: (sub.trucks || []).length,
        volume: Math.round(subVolume),
        status,
      });
    });

    const cellData = Array.from({ length: cellCount }, (_, i) => {
      const capacity = convertVolume(
        facility.cellCapacities?.[i] || 0,
        facility.cellCapacityUnits?.[i] || unit,
        unit,
      );
      const base = convertVolume(
        facility.cellFillValues?.[i] || 0,
        facility.cellFillUnits?.[i] || unit,
        unit,
      );
      // `cellFillValues[i]` is ALREADY the complete Waste in Cell — baseline plus
      // valid submissions, each counted exactly once. enrichFacilityWithBaseline
      // fills it from the server rollup (computeCellOccupancy, which also writes
      // the persisted SlfFacility.cellFillValues), and its client-side fallback
      // produces the same complete total.
      //
      // Adding the locally re-summed `cellUsed[i]` on top therefore counted every
      // PLACED submission twice: a cell holding 100 baseline + 30 submitted read
      // as 160. That inflated the fill percentage, the capacity chart and the
      // ">= 90%" cellsAtRisk alerts on this tab. The local sum also cannot see
      // per-vehicle placements, so it was never the authoritative figure.
      //
      // It is kept only as the fallback for a facility that has no fill figure at
      // all (no rollup entry and nothing stored), which is the one case where the
      // submissions this page already loaded are the best available answer.
      const storedFill = facility.cellFillValues?.[i];
      const hasStoredFill =
        storedFill !== null && storedFill !== undefined && storedFill !== "";
      const used = Math.round(hasStoredFill ? base : cellUsed[i]);
      return {
        // Read the CURRENT name from the facility's cell infrastructure, so a
        // renamed cell updates here instead of showing a stale "Cell N".
        name: resolveCellName(facility, i),
        capacity: Math.round(capacity),
        used,
        type: facility.cellTypes?.[i] || "Residual",
        status: facility.cellStatuses?.[i] || "Active Cell",
        pct: capacity > 0 ? Math.min(100, (used / capacity) * 100) : null,
      };
    });

    // Monthly trend — CONTINUOUS between the first and last month that carry
    // submissions.
    //
    // This used to emit only the months that happen to hold a record, so a month
    // with no disposals was simply absent from the series. The area chart then
    // joined the two months either side of the gap, drawing a straight line across
    // it: a facility that submitted in January and March rendered as though
    // February had been interpolated somewhere between the two, and the x-axis
    // silently skipped it. A month with no submissions is a real, meaningful zero,
    // so it is emitted as one and the chart drops to the axis.
    //
    // Keys are "YYYY-MM", so a plain sort is already chronological.
    const monthKeys = Array.from(monthMap.keys())
      .filter((m) => m !== "Unknown")
      .sort();
    const monthly = [];
    if (monthKeys.length) {
      const first = dayjs(`${monthKeys[0]}-01`);
      const last = dayjs(`${monthKeys[monthKeys.length - 1]}-01`);
      // Bounded walk: a malformed stored date cannot spin this into a huge series.
      const MAX_MONTHS = 120;
      let cursor = first;
      for (let i = 0; i < MAX_MONTHS; i += 1) {
        if (!cursor.isValid() || !last.isValid()) break;
        const key = cursor.format("YYYY-MM");
        monthly.push({
          month: cursor.format("MMM YY"),
          volume: Math.round(monthMap.get(key) || 0),
        });
        if (key === last.format("YYYY-MM")) break;
        cursor = cursor.add(1, "month");
      }
    }

    const topGenerators = Array.from(generators.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, v]) => ({
        name: name.length > 18 ? `${name.slice(0, 17)}…` : name,
        value: Math.round(v),
      }));

    const companyTypeData = Object.entries(companyTypeCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));

    const statusData = Object.entries(statusCounts).map(([name, value]) => ({
      name: name.replace("_", " "),
      value,
    }));

    return {
      unit,
      totalSubmissions: subs.length,
      totalTrucks,
      totalVolume: Math.round(totalVolume),
      residual: Math.round(residual),
      hazardous: Math.round(hazardous),
      generatorCount: generators.size,
      companyTypeData,
      statusData,
      cellData,
      monthly,
      topGenerators,
      tableRows,
    };
  }, [detailViewRecord, detailModal, facilitySubmissions]);

  const openDailySubmissionsModal = (cellRow) => {
    if (!detailViewRecord) return;
    const targetIndex =
      cellRow?.index != null
        ? cellRow.index
        : parseCellIndex(cellRow?.cellName);
    const fallbackIndex = targetIndex != null ? targetIndex : 0;
    const rows = facilitySubmissions
      // One row per PLACEMENT, not per truck. A multi-vehicle trip records its
      // volume and its cell on each VEHICLE and leaves the truck level at 0, so
      // reading only the truck dropped those rows entirely — the drill-down came
      // up empty for exactly the cells whose waste arrived that way.
      .flatMap((submission) =>
        (submission.trucks || []).flatMap((truck, truckIndex) => {
          const vehicles = (truck.vehicles || []).filter(
            (v) => Number(v?.actualVolume || 0) > 0,
          );
          if (!vehicles.length) {
            return [
              {
                key: `${submission._id}-${truckIndex}`,
                submission,
                truck,
                truckIndex,
                volume: Number(truck?.actualVolume || 0),
                cellIndex: getTruckCellIndex(truck),
              },
            ];
          }
          return vehicles.map((vehicle) => ({
            key: `${submission._id}-${truckIndex}-${(truck.vehicles || []).indexOf(vehicle)}`,
            submission,
            // The row renders truck-level columns (hauler, ticket) alongside the
            // vehicle's own plate/volume, so both travel with it.
            truck: { ...truck, ...vehicle, hauler: truck.hauler || truck.haulerName },
            truckIndex,
            vehicle,
            volume: Number(vehicle?.actualVolume || 0),
            cellIndex:
              getTruckCellIndex(vehicle) ?? getTruckCellIndex(truck),
          }));
        }),
      )
      .filter((item) => {
        if (!(item.volume > 0)) return false;
        const placedIndex = findBestCellIndex(
          detailViewRecord._cellUsageRows || [],
          item.truck?.wasteType,
          item.cellIndex,
        );
        return placedIndex === fallbackIndex;
      });
    setDailySubmissionsModal({ open: true, cell: cellRow, rows });
  };

  const generatorOptions = useMemo(
    () => generators.map((g) => ({ label: g.slfName, value: g._id })),
    [generators],
  );

  const toFileList = (arr) =>
    (arr || []).map((item, i) =>
      typeof item === "string"
        ? {
            uid: `existing-${i}`,
            name: item.split("/").pop() || item,
            status: "done",
            url: item,
          }
        : item,
    );

  const toPreventiveFileList = (urls = [], details = []) => {
    const detailByUrl = new Map(
      (details || []).filter((d) => d?.url).map((d) => [d.url, d]),
    );
    return toFileList(urls).map((file) => {
      const url = fileUrlFromUploadFile(file);
      const detail = detailByUrl.get(url) || {};
      const name = detail.fileName || file.name || fileNameFromUrl(url, "file");
      return {
        ...file,
        name,
        fileName: name,
        description: detail.description || file.description || defaultPreventiveFileDescription(name),
        docType: detail.docType || file.docType || "Preventive Measures",
      };
    });
  };

  const preventiveUploadEventToFileList = (event) => {
    const list = uploadEventToFileList(event) || [];
    return list.map((file) => {
      const url = fileUrlFromUploadFile(file);
      if (!url || file.description) return file;
      const name = file.response?.name || file.name || fileNameFromUrl(url, "file");
      return {
        ...file,
        fileName: name,
        description: defaultPreventiveFileDescription(name),
        docType: "Preventive Measures",
      };
    });
  };

  const populateForm = (record) => {
    const receivingFacilities = record.receivingFacilities?.length
      ? record.receivingFacilities
      : (record.mrfDetails || []).map((item) => ({
          mrfTypes: item.type ? [item.type] : [],
          mrfName: item.name || "",
          status: item.status || "Active",
          description: item.notes || "",
        }));
    const dischargePermits = record.dischargePermits?.length
      ? record.dischargePermits
      : record.dischargePermit ||
          record.dischargePermitValidity ||
          record.dischargePermitStatus
        ? [
            {
              permitNo: record.dischargePermit,
              validity: record.dischargePermitValidity,
              status: record.dischargePermitStatus,
            },
          ]
        : [];
    const permitToOperatePermits = record.permitToOperatePermits?.length
      ? record.permitToOperatePermits
      : record.permitToOperate ||
          record.permitToOperateValidity ||
          record.permitToOperateStatus
        ? [
            {
              permitNo: record.permitToOperate,
              validity: record.permitToOperateValidity,
              status: record.permitToOperateStatus,
            },
          ]
        : [];
    // THE declared unit (same rule as the View modal, the portal and the server).
    const declaredCellUnit = normalizeUnit(resolveFacilityUnit(record)) || "tons";
    // The form edits every cell in that one unit, so each stored figure is
    // CONVERTED into it here. Showing a cell's stored number under the facility
    // unit — and then saving it stamped with that unit — reinterpreted the
    // quantity (General Tinio: 2,052 m³ read and saved as 2,052 tons).
    const inDeclaredUnit = (values = [], units = []) =>
      (values || []).map((value, i) => {
        if (value === null || value === undefined || value === "") return value;
        const converted = convertVolume(value, units?.[i] || declaredCellUnit, declaredCellUnit);
        return converted === null ? value : Math.round(converted * 1000) / 1000;
      });
    const cellSlots = Math.max(record.numberOfCell || 0, (record.cellCapacities || []).length);
    form.setFieldsValue({
      ...record,
      cellNames:
        record.cellNames ||
        Array.from({ length: record.numberOfCell || 0 }, () => ""),
      cellCapacities: inDeclaredUnit(record.cellCapacities, record.cellCapacityUnits),
      cellCapacityUnits: Array.from({ length: cellSlots }, () => declaredCellUnit),
      cellStatuses: (
        record.cellStatuses ||
        Array.from({ length: record.numberOfCell || 0 }, () => "Active Cell")
      ).map(normalizeCellStatus),
      cellTypes:
        record.cellTypes ||
        Array.from({ length: record.numberOfCell || 0 }, () => "Residual"),
      cellSubmissionAllowed:
        record.cellSubmissionAllowed ||
        Array.from({ length: record.numberOfCell || 0 }, () => true),
      cellNotes:
        record.cellNotes ||
        Array.from({ length: record.numberOfCell || 0 }, () => ""),
      cellFillValues: record.cellFillValues
        ? inDeclaredUnit(record.cellFillValues, record.cellFillUnits)
        : Array.from({ length: record.numberOfCell || 0 }, () => null),
      cellFillUnits: Array.from({ length: cellSlots }, () => declaredCellUnit),
      volumeCapacity:
        record.volumeCapacity != null && record.volumeCapacity !== ""
          ? convertVolume(record.volumeCapacity, record.volumeCapacityUnit || declaredCellUnit, declaredCellUnit) ?? record.volumeCapacity
          : record.volumeCapacity,
      actualResidualWasteReceived:
        record.actualResidualWasteReceived != null && record.actualResidualWasteReceived !== ""
          ? convertVolume(record.actualResidualWasteReceived, record.wasteReceivedUnit || declaredCellUnit, declaredCellUnit) ?? record.actualResidualWasteReceived
          : record.actualResidualWasteReceived,
      wasteReceivedUnit: declaredCellUnit,
      lguServedList: record.lguServedList || [],
      privateCompaniesServed: record.privateCompaniesServed || [],
      volumeCapacityUnit: declaredCellUnit,
      receivingVolumeCapacityUnit: record.receivingVolumeCapacityUnit || declaredCellUnit,
      wastewaterTreatmentFacilityType: asStringArray(
        record.wastewaterTreatmentFacilityType,
      ),
      wastewaterTreatmentFacilityRemarks:
        record.wastewaterTreatmentFacilityRemarks || "",
      receivingFacilities,
      leachatePondDetails: (record.leachatePondDetails || []).map((p) => ({
        ...p,
        attachments: toFileList(p.attachments),
      })),
      gasVentDetails: (record.gasVentDetails || []).map((v) => ({
        ...v,
        attachments: toFileList(v.attachments),
      })),
      dateOfMonitoring: record.dateOfMonitoring
        ? dayjs(record.dateOfMonitoring)
        : null,
      dateReportPrepared: record.dateReportPrepared
        ? dayjs(record.dateReportPrepared)
        : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff
        ? dayjs(record.dateReportReviewedStaff)
        : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal
        ? dayjs(record.dateReportReviewedFocal)
        : null,
      estimatedVolumeWasteUnit: record.estimatedVolumeWasteUnit || declaredCellUnit,
      dateReportApproved: record.dateReportApproved
        ? dayjs(record.dateReportApproved)
        : null,
      dischargePermitValidity: record.dischargePermitValidity
        ? dayjs(record.dischargePermitValidity)
        : null,
      permitToOperateValidity: record.permitToOperateValidity
        ? dayjs(record.permitToOperateValidity)
        : null,
      dischargePermits: dischargePermits.map((permit) => ({
        ...permit,
        validity: permit.validity ? dayjs(permit.validity) : null,
      })),
      permitToOperatePermits: permitToOperatePermits.map((permit) => ({
        ...permit,
        validity: permit.validity ? dayjs(permit.validity) : null,
      })),
      commitmentFiles: toFileList(record.commitmentFiles || []),
      progressReportFiles: toFileList(record.progressReportFiles || []),
      preventiveMeasureFiles: toPreventiveFileList(
        record.preventiveMeasureFiles || [],
        record.preventiveMeasureFileDetails || [],
      ),
      scrpDetails: (record.scrpDetails || []).map((row) => ({
        ...row,
        attachments: toFileList(row.attachments),
      })),
      galleryPhotos: toFileList(record.galleryPhotos || []),
      galleryItems: (record.galleryItems || []).map((item, i) => ({
        ...item,
        folder: item.folder ? [item.folder] : [],
        url: item.url
          ? [
              {
                uid: `gallery-${i}`,
                name: item.fileName || "photo",
                status: "done",
                url: item.url,
              },
            ]
          : [],
      })),
      slfDocuments: (record.slfDocuments || []).map((d) => ({
        ...d,
        url: d.url
          ? [
              {
                uid: `doc-${d.url}`,
                name: d.fileName || d.title || "document",
                status: "done",
                url: d.url,
              },
            ]
          : [],
      })),
    });
  };

  const openAdd = () => {
    // A new facility has no loaded figures: whatever is typed is a declaration.
    setEditing(null);
    setEditYear(new Date().getFullYear());
    setEditYearRecords([]);
    form.resetFields();
    form.setFieldsValue({
      // New SLF records default to tons (admin can switch to m³ via Set Field Units).
      volumeCapacityUnit: "tons",
      wasteReceivedUnit: "tons",
      estimatedVolumeWasteUnit: "tons",
      lguServedList: [],
      privateCompaniesServed: [],
      cellNotes: [],
      cellFillValues: [],
      cellCapacityUnits: [],
      cellFillUnits: [],
      dischargePermits: [],
      permitToOperatePermits: [],
      leachatePondDetails: [],
      gasVentDetails: [],
      receivingFacilities: [],
      wastewaterTreatmentFacilityType: [],
      wastewaterTreatmentFacilityRemarks: "",
      commitmentFiles: [],
      progressReportFiles: [],
      preventiveMeasureFiles: [],
      scrpDetails: [],
      galleryItems: [],
    });
    setModalOpen(true);
  };
  const openEdit = (record) => {
    const yr = record.dataYear || new Date().getFullYear();
    setEditing(record);
    setEditYear(yr);
    populateForm(record);
    // Fetch all year records for this LGU
    if (record.lgu) {
      api
        .get(`/slf-facilities/history/${encodeURIComponent(record.lgu)}`)
        .then(({ data }) => setEditYearRecords(data))
        .catch(() => setEditYearRecords([]));
    } else {
      setEditYearRecords([]);
    }
    setModalOpen(true);
  };

  const handleEditYearChange = (yr) => {
    setEditYear(yr);
    const match = editYearRecords.find(
      (r) => (r.dataYear || new Date().getFullYear()) === yr,
    );
    if (match) {
      setEditing(match);
      form.resetFields();
      populateForm(match);
    } else {
      // Blank record for this year — keep location fields from current editing
      const current = editing || {};
      setEditing({
        _id: null,
        lgu: current.lgu,
        province: current.province,
        barangay: current.barangay,
        latitude: current.latitude,
        longitude: current.longitude,
        eccNo: current.eccNo,
      });
      form.resetFields();
      form.setFieldsValue({
        province: current.province,
        lgu: current.lgu,
        barangay: current.barangay,
        latitude: current.latitude,
        longitude: current.longitude,
        eccNo: current.eccNo,
        volumeCapacityUnit: "tons",
        receivingVolumeCapacityUnit: "tons",
        wasteReceivedUnit: "tons",
        estimatedVolumeWasteUnit: "tons",
        lguServedList: [],
        privateCompaniesServed: [],
        cellNotes: [],
        cellFillValues: [],
        cellCapacityUnits: [],
        cellFillUnits: [],
        dischargePermits: [],
        permitToOperatePermits: [],
        leachatePondDetails: [],
        gasVentDetails: [],
        receivingFacilities: [],
        wastewaterTreatmentFacilityType: [],
        wastewaterTreatmentFacilityRemarks: "",
        commitmentFiles: [],
        progressReportFiles: [],
        preventiveMeasureFiles: [],
        scrpDetails: [],
        galleryItems: [],
      });
    }
  };

  const getActiveCellOptions = () => {
    const count = Number(
      form.getFieldValue("numberOfCell") || editing?.numberOfCell || 0,
    );
    const statuses =
      form.getFieldValue("cellStatuses") || editing?.cellStatuses || [];
    const types = form.getFieldValue("cellTypes") || editing?.cellTypes || [];
    const names = form.getFieldValue("cellNames") || editing?.cellNames || [];
    return Array.from({ length: count }, (_, index) => {
      const status = normalizeCellStatus(statuses[index]);
      // Canonical name from the cell infrastructure, not a hardcoded "Cell N".
      const name = resolveCellName({ cellNames: names }, index);
      return {
        index,
        label: `${name} - ${types[index] || "Residual"} (${status})`,
        name,
        type: types[index] || "Residual",
        status,
      };
    }).filter((cell) => isActiveCellStatus(cell.status));
  };

  // Real, per-truck submissions for the facility being edited.
  //
  // This MUST NOT read the page-wide `slfSubmissions`: that array now holds the
  // database-collapsed cell-usage rollup, whose `trucks` entries are merged buckets
  // rather than actual trucks. The placement editor writes back by truckIndex /
  // vehicleIndex, so feeding it collapsed rows would assign cells to the wrong
  // trucks. Fetch the facility's own records instead — the same on-demand pattern
  // the detail modal already uses, and scoped server-side by slfGenerator so it
  // stays a small request.
  const fetchEditingSubmissions = useCallback(async (record) => {
    const generatorId =
      record?.slfGenerator && typeof record.slfGenerator === "object"
        ? record.slfGenerator._id
        : record?.slfGenerator || record?._id;
    if (!generatorId) return [];
    // Page through rather than taking a single capped page: the endpoint's limit is
    // clamped to 100 server-side, and a facility quietly exceeding that would drop
    // submissions out of the placement editor instead of erroring.
    const PAGE_SIZE = 100;
    const rows = [];
    for (let page = 1; ; page += 1) {
      const { data } = await api.get("/data-slf", {
        params: {
          mode: "list",
          slfGenerator: generatorId,
          includeTrucks: true,
          limit: PAGE_SIZE,
          page,
        },
      });
      const batch = Array.isArray(data) ? data : data?.data || [];
      rows.push(...batch);
      const total = Array.isArray(data) ? batch.length : Number(data?.total || 0);
      if (batch.length < PAGE_SIZE || rows.length >= total) break;
    }
    return rows
      .map(normalizeSubmissionRecord)
      .filter(
        (submission) =>
          submissionMatchesFacility(record || {}, submission) &&
          hasTruckVolume(submission),
      )
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, []);

  const openCellAssignmentModal = async () => {
    setCellAssignmentLoading(true);
    try {
      const submissions = await fetchEditingSubmissions(editing || {});
      setCellAssignmentModal({
        submissions,
        selectedId: submissions[0]?._id || null,
      });
    } catch {
      Swal.fire({
        icon: "error",
        title: "Could not load submissions",
        text: "The cell assignment data could not be loaded. Please try again.",
      });
    } finally {
      setCellAssignmentLoading(false);
    }
  };

  const updateCellAssignmentLocal = (
    submissionId,
    truckIndex,
    cellIndex,
    vehicleIndex = null,
  ) => {
    const cell = getActiveCellOptions().find(
      (item) => item.index === cellIndex,
    );
    const cellPatch = {
      cellIndex,
      cellName: cell?.name || "",
      cellType: cell?.type || "",
    };
    setCellAssignmentModal((prev) => ({
      ...prev,
      submissions: (prev?.submissions || []).map((submission) => {
        if (submission._id !== submissionId) return submission;
        const trucks = (submission.trucks || []).map((truck, index) => {
          if (index !== truckIndex) return truck;
          if (Number.isInteger(vehicleIndex) && Array.isArray(truck.vehicles)) {
            const vehicles = truck.vehicles.map((veh, vIdx) =>
              vIdx === vehicleIndex ? { ...veh, ...cellPatch } : veh,
            );
            // keep truck-level synced with first vehicle
            const synced = vehicleIndex === 0 ? cellPatch : {};
            return { ...truck, ...synced, vehicles };
          }
          const vehicles = Array.isArray(truck.vehicles)
            ? truck.vehicles.map((veh) => ({ ...veh, ...cellPatch }))
            : truck.vehicles;
          return { ...truck, ...cellPatch, vehicles };
        });
        return { ...submission, trucks };
      }),
    }));
  };

  const saveCellAssignments = async () => {
    const submission = (cellAssignmentModal?.submissions || []).find(
      (item) => item._id === cellAssignmentModal.selectedId,
    );
    if (!submission) return;
    setCellAssignmentSaving(true);
    try {
      const assignments = [];
      (submission.trucks || []).forEach((truck, truckIndex) => {
        if (Array.isArray(truck.vehicles) && truck.vehicles.length > 0) {
          truck.vehicles.forEach((veh, vehicleIndex) => {
            assignments.push({
              truckIndex,
              vehicleIndex,
              cellIndex: veh.cellIndex,
              cellName: veh.cellName,
              cellType: veh.cellType,
            });
          });
        } else {
          assignments.push({
            truckIndex,
            cellIndex: truck.cellIndex,
            cellName: truck.cellName,
            cellType: truck.cellType,
          });
        }
      });
      const { data } = await api.patch(
        `/data-slf/${submission._id}/cell-assignments`,
        { assignments },
      );
      const updated = data.data || submission;
      setSlfSubmissions((prev) =>
        prev.map((item) => (item._id === updated._id ? updated : item)),
      );
      setCellAssignmentModal((prev) => ({
        ...prev,
        submissions: (prev?.submissions || []).map((item) =>
          item._id === updated._id ? updated : item,
        ),
      }));
      await fetchRecords(true);
      Swal.fire("Saved", "Submission waste placement was updated.", "success");
    } catch (error) {
      Swal.fire(
        "Error",
        error.response?.data?.message || "Failed to update cell assignments",
        "error",
      );
    } finally {
      setCellAssignmentSaving(false);
    }
  };

  const handleSave = async ({ refreshAfterSave = true } = {}) => {
    if (!editYear) {
      Swal.fire(
        "Year Required",
        "Please select a year before saving.",
        "warning",
      );
      return;
    }
    let saved = false;
    let savedYear = null;
    let savedIdentity = null;
    const wasEditing = Boolean(editing?._id);
    setSaving(true);
    try {
      const values = await form.validateFields();
      const fromFileList = (fl) =>
        (fl || [])
          .filter((f) => f.status !== "error" && f.status !== "uploading")
          .map((f) =>
            typeof f === "string"
              ? f
              : f.response?.url || f.url || f.name || "",
          )
          .filter(Boolean);
      const existingRecord = editing || {};
      // The Global Unit Tool and other controls set values via form.setFieldsValue
      // on fields that are NOT rendered as <Form.Item> (e.g. wasteReceivedUnit,
      // volumeCapacityUnit, estimatedVolumeWasteUnit, cellCapacityUnits,
      // cellFillUnits) or that live on a tab that `destroyOnHidden` has unmounted.
      // `validateFields()` only returns MOUNTED, registered fields, so those unit
      // changes were invisible here and the save silently reverted them to the old
      // stored unit. `getFieldsValue(true)` returns the ENTIRE form store (registered
      // or not, mounted or not), so it captures exactly those values. It sits between
      // the validated values and the existing record: validated user input wins,
      // then the live store, then the record on disk.
      const storeValues = form.getFieldsValue(true);
      const fieldValue = (key, fallback) =>
        values[key] !== undefined
          ? values[key]
          : storeValues[key] !== undefined
            ? storeValues[key]
            : (existingRecord[key] ?? fallback);
      // Like `fieldValue`, fall back to the live form store before the stored
      // record: the SLF edit modal's Tabs uses `destroyInactiveTabPane`, so a file
      // field whose tab (e.g. Preventive Measures) is not the active pane at save
      // time is unmounted and absent from `validateFields()`. Reading `storeValues`
      // keeps those just-uploaded files instead of reverting to the old record.
      const fileFieldValue = (key) =>
        values[key] !== undefined
          ? fromFileList(values[key])
          : storeValues[key] !== undefined
            ? fromFileList(storeValues[key])
            : existingRecord[key] || [];
      const fileListFieldValue = (key) =>
        values[key] !== undefined
          ? values[key]
          : storeValues[key] !== undefined
            ? storeValues[key]
            : toFileList(existingRecord[key] || []);
      const buildPreventiveMeasureFileDetails = (list) => {
        const existingDetails = new Map(
          (existingRecord.preventiveMeasureFileDetails || [])
            .filter((d) => d?.url)
            .map((d) => [d.url, d]),
        );
        return (list || [])
          .map((file) => {
            const url = fileUrlFromUploadFile(file);
            if (!url) return null;
            const existing = existingDetails.get(url) || {};
            const fileName = file.response?.name || file.fileName || file.name || existing.fileName || fileNameFromUrl(url, "file");
            return {
              url,
              fileName,
              description: String(file.description || existing.description || defaultPreventiveFileDescription(fileName)).trim(),
              docType: file.docType || existing.docType || "Preventive Measures",
            };
          })
          .filter(Boolean);
      };
      const dateFieldValue = (key) =>
        values[key] !== undefined
          ? (values[key]?.toISOString?.() ?? null)
          : existingRecord[key] || null;
      const existingLeachateDetails = existingRecord.leachatePondDetails || [];
      const existingGasVentDetails = existingRecord.gasVentDetails || [];
      const dischargePermits = fieldValue("dischargePermits", [])
        .map((permit) => ({
          ...permit,
          validity: permit.validity?.toISOString?.() ?? null,
        }))
        .filter(
          (permit) =>
            permit.permitNo ||
            permit.permitType ||
            permit.validity ||
            permit.status,
        );
      const permitToOperatePermits = fieldValue("permitToOperatePermits", [])
        .map((permit) => ({
          ...permit,
          validity: permit.validity?.toISOString?.() ?? null,
        }))
        .filter(
          (permit) => permit.permitNo || permit.validity || permit.status,
        );
      const receivingFacilities = fieldValue("receivingFacilities", [])
        .map((facility) => ({
          mrfTypes: facility.mrfTypes || [],
          mrfName: facility.mrfName || "",
          status: facility.status || "",
          description: facility.description || "",
        }))
        .filter(
          (facility) =>
            facility.mrfTypes.length ||
            facility.mrfName ||
            facility.status ||
            facility.description,
        );
      const hasWastewaterTreatmentFacility = fieldValue(
        "hasWastewaterTreatmentFacility",
        false,
      );
      const leachatePondDetails = fieldValue("leachatePondDetails", []).map(
        (p, index) => ({
          ...p,
          wastewaterTreatmentFacilityType: asStringArray(
            p.wastewaterTreatmentFacilityType,
          ),
          attachments:
            p.attachments !== undefined
              ? fromFileList(p.attachments)
              : existingLeachateDetails[index]?.attachments || [],
        }),
      );
      const gasVentDetails = fieldValue("gasVentDetails", []).map(
        (v, index) => ({
          ...v,
          attachments:
            v.attachments !== undefined
              ? fromFileList(v.attachments)
              : existingGasVentDetails[index]?.attachments || [],
        }),
      );
      const lguServedList = fieldValue("lguServedList", []);
      const privateCompaniesServed = fieldValue("privateCompaniesServed", []);
      const ownership = fieldValue("ownership", "");
      const preventiveMeasureFileList = fileListFieldValue("preventiveMeasureFiles");
      // #5/#7: cells follow the facility's single declared baseline unit. The edit
      // cards no longer offer a per-cell unit picker, so stamp every cell's unit to
      // the baseline here (values are already entered/kept in that unit facility-wide
      // via the unit-change handlers).
      // Same declared-unit rule as everywhere else. The form already holds every
      // cell's figure CONVERTED into this unit (see openEdit), so stamping it on
      // every cell is a label that matches the number, not a reinterpretation.
      const baselineCellUnit =
        normalizeUnit(
          resolveFacilityUnit({
            volumeCapacityUnit: fieldValue("volumeCapacityUnit"),
            cellCapacityUnits: fieldValue("cellCapacityUnits", []),
            wasteReceivedUnit: fieldValue("wasteReceivedUnit"),
            cellFillUnits: fieldValue("cellFillUnits", []),
          }),
        ) || "tons";
      const cellCountForUnits =
        Number(fieldValue("numberOfCell", 0)) ||
        (fieldValue("cellCapacities", []) || []).length;
      const uniformCellUnits = Array.from(
        { length: cellCountForUnits },
        () => baselineCellUnit,
      );
      const payload = {
        ...values,
        dataYear: editYear,
        // Auto-compute noOfLGUServed from the multi-select lists
        noOfLGUServed: /private/i.test(ownership || "")
          ? privateCompaniesServed.length
          : lguServedList.length,
        lguServedList,
        privateCompaniesServed,
        cellNames: fieldValue("cellNames", []).map((n) =>
          String(n || "").trim(),
        ),
        cellStatuses: fieldValue("cellStatuses", []).map(normalizeCellStatus),
        cellCapacities: fieldValue("cellCapacities", []),
        cellCapacityUnits: uniformCellUnits,
        cellTypes: fieldValue("cellTypes", []),
        cellSubmissionAllowed: fieldValue("cellSubmissionAllowed", []),
        cellNotes: fieldValue("cellNotes", []),
        cellFillValues: fieldValue("cellFillValues", []),
        cellFillUnits: uniformCellUnits,
        // Explicitly carry the facility-level unit fields. They are set by the
        // Global Unit Tool via setFieldsValue but are NOT <Form.Item>s, so `...values`
        // (validateFields output) omits them and a m³→tons change was being dropped
        // on save. `fieldValue` now reads the live form store, so these reflect the
        // applied unit. The tool relabels units only (never converts the numbers),
        // matching its confirm dialog.
        volumeCapacityUnit: normalizeUnit(
          fieldValue("volumeCapacityUnit", baselineCellUnit),
        ),
        receivingVolumeCapacityUnit: normalizeUnit(
          fieldValue("receivingVolumeCapacityUnit", baselineCellUnit),
        ),
        wasteReceivedUnit: normalizeUnit(
          fieldValue("wasteReceivedUnit", baselineCellUnit),
        ),
        estimatedVolumeWasteUnit: normalizeUnit(
          fieldValue("estimatedVolumeWasteUnit", baselineCellUnit),
        ),
        hasWastewaterTreatmentFacility,
        wastewaterTreatmentFacilityType: hasWastewaterTreatmentFacility
          ? asStringArray(fieldValue("wastewaterTreatmentFacilityType", []))
          : [],
        wastewaterTreatmentFacilityRemarks: hasWastewaterTreatmentFacility
          ? fieldValue("wastewaterTreatmentFacilityRemarks", "") || ""
          : "",
        receivingFacilities,
        leachatePondDetails,
        gasVentDetails,
        dateOfMonitoring: dateFieldValue("dateOfMonitoring"),
        dateReportPrepared: dateFieldValue("dateReportPrepared"),
        dateReportReviewedStaff: dateFieldValue("dateReportReviewedStaff"),
        dateReportReviewedFocal: dateFieldValue("dateReportReviewedFocal"),
        noOfLeachatePond: leachatePondDetails.length,
        numberOfGasVents: gasVentDetails.length,
        dateReportApproved: dateFieldValue("dateReportApproved"),
        dischargePermits,
        dischargePermit: dischargePermits[0]?.permitNo || "",
        dischargePermitValidity: dischargePermits[0]?.validity || null,
        dischargePermitStatus: dischargePermits[0]?.status || "",
        permitToOperatePermits,
        permitToOperate: permitToOperatePermits[0]?.permitNo || "",
        permitToOperateValidity: permitToOperatePermits[0]?.validity || null,
        permitToOperateStatus: permitToOperatePermits[0]?.status || "",
        commitmentFiles: fileFieldValue("commitmentFiles"),
        progressReportFiles: fileFieldValue("progressReportFiles"),
        preventiveMeasureFiles: fromFileList(preventiveMeasureFileList),
        preventiveMeasureFileDetails: buildPreventiveMeasureFileDetails(preventiveMeasureFileList),
        scrpDetails: fieldValue("scrpDetails", [])
          .map((row) => ({
            ...row,
            attachments:
              row.attachments !== undefined
                ? fromFileList(row.attachments)
                : row.attachments || [],
          }))
          .filter(
            (row) =>
              row.planTitle ||
              row.status ||
              row.remarks ||
              row.attachments?.length,
          ),
        galleryPhotos: fileFieldValue("galleryPhotos"),
        galleryItems: fieldValue("galleryItems", [])
          .map((item) => ({
            ...item,
            url: Array.isArray(item.url)
              ? fromFileList(item.url)[0] || ""
              : item.url || "",
            fileName: uploadNameFromValue(item.url, item.fileName),
            folder: Array.isArray(item.folder)
              ? item.folder[0] || ""
              : item.folder || "",
          }))
          .filter(
            (item) => item.url || item.caption || item.folder || item.component,
          ),
        slfDocuments: fieldValue("slfDocuments", [])
          .map((d) => ({
            ...d,
            url: Array.isArray(d.url)
              ? fromFileList(d.url)[0] || ""
              : d.url || "",
            fileName: uploadNameFromValue(d.url, d.fileName),
          }))
          .filter((d) => d.title || d.url || d.description || d.docType),
      };
      Object.assign(payload, computeFields(payload));
      // Waste in Cell is no longer typed here: it is always baseline + approved
      // submissions, recomputed by the server after this save. The derived
      // figures are sent back only so cells keep their place when the list
      // changes; the server never treats them as a declaration.
      if (editing && editing._id) {
        const { data } = await api.put(
          `/slf-facilities/${editing._id}`,
          payload,
        );
        const updatedRecord = { ...data, ...computeFields(data) };
        setRecords((prev) => {
          const exists = prev.some((r) => r._id === data._id);
          if (exists)
            return prev.map((r) => (r._id === data._id ? updatedRecord : r));
          return [...prev, updatedRecord];
        });
        setEditYearRecords((prev) => {
          const exists = prev.some((r) => r._id === data._id);
          if (exists)
            return prev.map((r) => (r._id === data._id ? updatedRecord : r));
          return [...prev, updatedRecord];
        });
        setEditing(updatedRecord);
        setDetailModal((prev) =>
          prev?._id === data._id ? updatedRecord : prev,
        );
        invalidateCache(`${CACHE_KEY}-fast`);
        invalidateCache(`${CACHE_KEY}-full`);
        secureStorage.invalidateDashboard();
        savedYear = data.dataYear ?? editYear;
        savedIdentity = data;
        Swal.fire(
          "Saved",
          `${payload.lgu || "SLF"} data records successfully saved!`,
          "success",
        );
        saved = true;
      } else {
        const { data } = await api.post("/slf-facilities", payload);
        const createdRecord = { ...data, ...computeFields(data) };
        setRecords((prev) => [...prev, createdRecord]);
        setEditYearRecords((prev) => [...prev, createdRecord]);
        setEditing(createdRecord);
        invalidateCache(`${CACHE_KEY}-fast`);
        invalidateCache(`${CACHE_KEY}-full`);
        secureStorage.invalidateDashboard();
        savedYear = data.dataYear ?? editYear;
        savedIdentity = data;
        Swal.fire(
          "Saved",
          `${payload.lgu || "SLF"} data records successfully saved!`,
          "success",
        );
        saved = true;
      }
    } catch (err) {
      if (err.errorFields?.length) {
        Swal.fire(
          "Missing or Invalid Fields",
          err.errorFields[0]?.errors?.[0] ||
            "Please check the highlighted fields before saving.",
          "warning",
        );
      } else if (err.response) {
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
      } else {
        Swal.fire("Error", err.message || "Save failed", "error");
      }
    }
    setSaving(false);
    if (!saved) return;

    if (!refreshAfterSave) return;

    // The server — not the local optimistic state above — is the source of truth
    // for what the table shows. Re-read it so the row reflects exactly what was
    // persisted (and so a failed/partial write can't leave a phantom row behind).
    await fetchRecords(true);
    // A record saved against a year other than the facility's newest one is hidden
    // by the default "latest per SLF" view, which is what made saved records look
    // like they had disappeared. Point the table at the year that was just written.
    if (savedYear != null && savedIdentity) {
      const facilityKey = (r) =>
        [r.province, r.lgu, r.barangay].filter(Boolean).join("|").toLowerCase();
      const savedKey = facilityKey(savedIdentity);
      const hiddenByNewerYear = records.some(
        (r) => facilityKey(r) === savedKey && (r.dataYear || 0) > savedYear,
      );
      if (hiddenByNewerYear) setFilterDataYear(savedYear);
    }

    if (!wasEditing) {
      setModalOpen(false);
      setConvArea(null);
      setConvDepth(null);
      setConvVol(null);
      setConvDensity(0.2);
      setConvM3ToTons(null);
      setConvModalOpen(false);
      setUnitToolOpen(false);
    }
  };

  const syncWasteReceivedFromCellFills = (nextFills, nextUnits) => {
    const units = nextUnits || form.getFieldValue("cellFillUnits") || [];
    const targetUnit = normalizeUnit(
      form.getFieldValue("wasteReceivedUnit") || units.find(Boolean) || "m³",
    );
    const total = (nextFills || []).reduce(
      (sum, value, index) =>
        sum + convertVolume(value, units[index] || targetUnit, targetUnit),
      0,
    );
    form.setFieldsValue({
      actualResidualWasteReceived: Number(total.toFixed(3)),
      wasteReceivedUnit: targetUnit,
    });
  };

  const handleCellCapacityUnitChange = (index, value) => {
    const unit = normalizeUnit(value);
    const nextCapacityUnits = [
      ...(form.getFieldValue("cellCapacityUnits") || []),
    ];
    const nextFillUnits = [...(form.getFieldValue("cellFillUnits") || [])];
    nextCapacityUnits[index] = unit;
    nextFillUnits[index] = unit;
    form.setFieldsValue({
      cellCapacityUnits: nextCapacityUnits,
      cellFillUnits: nextFillUnits,
      volumeCapacityUnit: unit,
      receivingVolumeCapacityUnit: unit,
      wasteReceivedUnit: unit,
    });
    syncWasteReceivedFromCellFills(
      form.getFieldValue("cellFillValues") || [],
      nextFillUnits,
    );
  };

  const handleCellFillUnitChange = (index, value) => {
    const nextUnits = [...(form.getFieldValue("cellFillUnits") || [])];
    const unit = normalizeUnit(value);
    nextUnits[index] = unit;
    form.setFieldsValue({ cellFillUnits: nextUnits, wasteReceivedUnit: unit });
    syncWasteReceivedFromCellFills(
      form.getFieldValue("cellFillValues") || [],
      nextUnits,
    );
  };

  const openMapPreview = () => {
    const latitude = form.getFieldValue("latitude");
    const longitude = form.getFieldValue("longitude");
    if (
      latitude == null ||
      longitude == null ||
      Number.isNaN(Number(latitude)) ||
      Number.isNaN(Number(longitude))
    ) {
      message.warning("Enter valid latitude and longitude first.");
      return;
    }
    setMapPreview({
      latitude: Number(latitude),
      longitude: Number(longitude),
      label: form.getFieldValue("lgu") || editing?.lgu || "SLF Location",
    });
  };

  const sendCapacityAlert = async () => {
    if (!capacityAlertModal?.record?._id || !capacityAlertModal?.cell) return;
    setCapacityAlertSending(true);
    try {
      const { record, cell, message: customMessage } = capacityAlertModal;
      const { data } = await api.post(
        `/slf-facilities/${record._id}/cell-capacity-alert`,
        {
          cellIndex: cell.index,
          percent: cell.pct,
          threshold: 80,
          message:
            customMessage ||
            `${record.lgu || "Assigned SLF"} Cell ${cell.index + 1} is ${cell.pct}% full. Please review disposal planning and available cell capacity.`,
        },
      );
      Swal.fire(
        "Notification Sent",
        `${data?.notified || 0} assigned portal user(s) notified.`,
        "success",
      );
      setCapacityAlertModal(null);
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to send cell capacity alert.",
        "error",
      );
    } finally {
      setCapacityAlertSending(false);
    }
  };

  const applyUnitTool = async () => {
    const unit = normalizeUnit(unitToolValue || "m³");
    const cellCount = Math.max(
      Number(form.getFieldValue("numberOfCell") || 0),
      (form.getFieldValue("cellCapacities") || []).length,
      (form.getFieldValue("cellFillValues") || []).length,
    );
    const applyUnits = async () => {
      form.setFieldsValue({
        volumeCapacityUnit: unit,
        receivingVolumeCapacityUnit: unit,
        wasteReceivedUnit: unit,
        estimatedVolumeWasteUnit: unit,
        cellCapacityUnits: Array.from({ length: cellCount }, () => unit),
        cellFillUnits: Array.from({ length: cellCount }, () => unit),
      });
      setUnitToolOpen(false);
      if (editing?._id) {
        await handleSave({ refreshAfterSave: false });
      } else {
        message.success(`Units set to ${unit}. Save the SLF record to persist the change.`);
      }
    };

    // The unit currently declared on the facility (any of its unit fields).
    const currentUnit = normalizeUnit(
      form.getFieldValue("volumeCapacityUnit") ||
        form.getFieldValue("wasteReceivedUnit") ||
        form.getFieldValue("receivingVolumeCapacityUnit") ||
        form.getFieldValue("estimatedVolumeWasteUnit") ||
        (form.getFieldValue("cellCapacityUnits") || []).find(Boolean) ||
        "",
    );

    // Any existing numeric value a relabel (no conversion) would silently reinterpret.
    const numericFields = [
      form.getFieldValue("volumeCapacity"),
      form.getFieldValue("receivingVolumeCapacity"),
      form.getFieldValue("actualResidualWasteReceived"),
      form.getFieldValue("estimatedVolumeWaste"),
      ...(form.getFieldValue("cellCapacities") || []),
      ...(form.getFieldValue("cellFillValues") || []),
    ];
    const sample = numericFields.map(Number).find((n) => Number.isFinite(n) && n > 0);

    // Warn ONLY when this actually reinterprets data: the unit is genuinely
    // changing AND the facility already has values. The tool relabels every unit
    // field but does NOT convert the numbers, so make that explicit before saving.
    // SweetAlert (over-modal) keeps the confirm uniform with the rest of the app.
    const explanation = currentUnit && currentUnit !== unit && sample !== undefined
      ? `This sets the unit on <b>every</b> capacity, fill, receiving and estimated field of this SLF (and all its cells) from <b>${currentUnit}</b> to <b>${unit}</b> — but it does <b>not</b> convert the numbers. For example, <b>${sample} ${currentUnit}</b> will become <b>${sample} ${unit}</b> (not the converted equivalent). Only continue if the stored values are already in ${unit}; otherwise cancel and enter the correct ${unit} values.`
      : `This sets the unit on <b>every</b> capacity, fill, receiving and estimated field of this SLF (and all its cells) to <b>${unit}</b>. It updates labels only and does <b>not</b> convert any numeric values.`;
    const result = await Swal.fire({
      icon: "warning",
      title: `Apply ${unit} to all SLF unit fields?`,
      html: explanation,
      showCancelButton: true,
      confirmButtonText: `Yes, apply ${unit}`,
      cancelButtonText: "Cancel",
      confirmButtonColor: "#faad14",
    });
    if (result.isConfirmed) await applyUnits();
  };

  const copyText = async (value, label = "Value") => {
    const text = String(value ?? "");
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      message.success(`${label} copied`);
    } catch {
      message.error("Copy failed. Please select and copy the value manually.");
    }
  };

  const reviewAndDeleteRecord = async (record) => {
    const reviewHtml = `
      <div style="text-align:left;font-size:13px;line-height:1.7;">
        <div><strong>LGU:</strong> ${record.lgu || "N/A"}</div>
        <div><strong>Province:</strong> ${record.province || "N/A"}</div>
        <div><strong>Data Year:</strong> ${record.dataYear || "N/A"}</div>
        <div><strong>Status:</strong> ${record.statusOfSLF || "N/A"}</div>
        <div><strong>Category:</strong> ${record.category || "N/A"}</div>
      </div>
    `;

    const result = await Swal.fire({
      icon: "warning",
      title: "Review Before Deletion",
      html: `${reviewHtml}<p style="margin-top:12px;">This record will be moved to Deleted SLF Data in Developer Settings.</p>`,
      showCancelButton: true,
      confirmButtonText: "Move to Trash",
      confirmButtonColor: "#ff4d4f",
      cancelButtonText: "Cancel",
    });

    if (!result.isConfirmed) return;

    try {
      await api.delete(`/slf-facilities/${record._id}`);
      setRecords((prev) => prev.filter((r) => r._id !== record._id));
      invalidateCache(`${CACHE_KEY}-fast`);
      invalidateCache(`${CACHE_KEY}-full`);
      secureStorage.invalidateDashboard();
      // Re-read from the server so the table matches what was actually deleted —
      // e.g. an earlier dataYear row for the same SLF now takes the visible slot.
      await fetchRecords(true);
      Swal.fire({
        icon: "success",
        title: "Moved to Trash",
        timer: 1100,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Failed to delete record", "error");
    }
  };

  // Available years from data — kept for edit/detail modals (year navigation)
  const availableYears = useMemo(() => {
    const cy = new Date().getFullYear();
    const years = [
      ...new Set([cy, cy - 1, ...records.map((r) => r.dataYear || cy)]),
    ];
    return years.sort((a, b) => b - a);
  }, [records]);

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) data = data.filter((r) => rowMatchesSearch(r, searchText));
    if (filterProvince)
      data = data.filter((r) => matchesFilter(r.province, filterProvince));
    if (filterStatus)
      data = data.filter((r) => matchesFilter(r.statusOfSLF, filterStatus));
    if (filterCategory)
      data = data.filter((r) => matchesFilter(r.category, filterCategory));
    if (filterMonth)
      data = data.filter((r) => matchesFilter(r.targetMonth, filterMonth));

    if (quickFilter === "operational") {
      data = data.filter(
        (r) =>
          /operational/i.test(r.statusOfSLF || "") &&
          !/non/i.test(r.statusOfSLF || ""),
      );
    }
    if (quickFilter === "withCells") {
      data = data.filter((r) => Number(r.numberOfCell || 0) > 0);
    }
    if (quickFilter === "withLGUs") {
      data = data.filter((r) => getServedClientCount(r) > 0);
    }
    if (quickFilter === "private") {
      data = data.filter((r) => /private/i.test(r.ownership || ""));
    }
    if (quickFilter === "withCapacity") {
      data = data.filter((r) => Number(r.volumeCapacity || 0) > 0);
    }
    if (quickFilter === "withWaste") {
      data = data.filter((r) => Number(r.actualResidualWasteReceived || 0) > 0);
    }
    if (quickFilter === "withLeachate") {
      data = data.filter((r) => Number(r.noOfLeachatePond || 0) > 0);
    }
    if (quickFilter === "withGas") {
      data = data.filter((r) => Number(r.numberOfGasVents || 0) > 0);
    }

    // A specific Data Year is an EXACT view: show every record stored for that
    // year and skip the "latest per facility" collapse entirely, so a record saved
    // against an older year is visible instead of being hidden behind a newer one.
    if (filterDataYear != null) {
      return data.filter(
        (r) => (r.dataYear || new Date().getFullYear()) === filterDataYear,
      );
    }

    // Default view: deduplicate by facility — keep only the latest dataYear record.
    const map = new Map();
    for (const r of data) {
      const key =
        [r.province, r.lgu, r.barangay]
          .filter(Boolean)
          .join("|")
          .toLowerCase() || r._id;
      const existing = map.get(key);
      if (!existing || (r.dataYear || 0) > (existing.dataYear || 0)) {
        map.set(key, r);
      }
    }
    return [...map.values()];
  }, [
    records,
    searchText,
    filterProvince,
    filterStatus,
    filterCategory,
    filterMonth,
    filterDataYear,
    quickFilter,
  ]);

  const hasFilters =
    searchText ||
    filterProvince ||
    filterStatus ||
    filterCategory ||
    filterMonth ||
    filterDataYear != null ||
    quickFilter;
  // Count of active dropdown/quick filters (search shown separately) — badged on
  // the header Filters button so the indicator stays visible when collapsed (#5).
  const activeFilterCount = [
    filterProvince,
    filterStatus,
    filterCategory,
    filterMonth,
    filterDataYear,
    quickFilter,
  ].filter((value) => value != null && value !== "").length;
  const clearFilters = () => {
    setSearchText("");
    setFilterProvince(null);
    setFilterStatus(null);
    setFilterCategory(null);
    setFilterMonth(null);
    setFilterDataYear(null);
    setQuickFilter(null);
  };
  // Summary tiles — single memoized pass over `filtered` (was ~25 separate
  // filter/reduce loops on every render → main tile-summary bottleneck).
  const tileStats = useMemo(() => {
    let opCount = 0,
      nonOpCount = 0,
      totalCapacity = 0,
      totalLGUs = 0,
      totalCells = 0,
      totalLeachate = 0,
      totalGasVents = 0,
      totalWaste = 0,
      privateSectorCount = 0,
      cellsWithData = 0,
      lgusWithData = 0,
      capacityWithData = 0,
      wasteWithData = 0,
      leachateWithData = 0,
      gasVentsWithData = 0,
      privateClientsTotal = 0,
      receivingCapacityTotal = 0,
      region3LguServed = 0,
      hasTons = false,
      hasM3 = false;
    const cellStatusSummary = {};
    const leachateStatusSummary = {};
    const gasStatusSummary = {};

    for (const r of filtered) {
      const status = r.statusOfSLF || "";
      if (/operational/i.test(status) && !/non/i.test(status)) opCount++;
      if (/non/i.test(status)) nonOpCount++;
      totalCapacity += r.volumeCapacity || 0;
      const servedCount = getServedClientCount(r);
      totalLGUs += servedCount;
      totalCells += r.numberOfCell || 0;
      totalLeachate += r.noOfLeachatePond || 0;
      totalGasVents += r.numberOfGasVents || 0;
      totalWaste += r.actualResidualWasteReceived || 0;
      const isPrivate = /private/i.test(r.ownership);
      if (isPrivate) {
        privateSectorCount++;
      }
      if (r.numberOfCell > 0) cellsWithData++;
      if (servedCount > 0) lgusWithData++;
      if (r.volumeCapacity > 0) capacityWithData++;
      if (r.actualResidualWasteReceived > 0) wasteWithData++;
      if (r.noOfLeachatePond > 0) leachateWithData++;
      if (r.numberOfGasVents > 0) gasVentsWithData++;
      privateClientsTotal += (r.privateCompaniesServed || []).length;
      receivingCapacityTotal += r.receivingVolumeCapacity || 0;
      if (R3_PROVINCES.includes(r.province))
        region3LguServed += servedCount;
      const u = normalizeUnit(r.wasteReceivedUnit);
      if (u === "tons") hasTons = true;
      if (u === "m³") hasM3 = true;

      const cellCount = Number(r.numberOfCell || 0);
      const statuses = r.cellStatuses || [];
      if (statuses.length > 0) {
        statuses.slice(0, cellCount || statuses.length).forEach((s) => {
          const k = s || "Unspecified";
          cellStatusSummary[k] = (cellStatusSummary[k] || 0) + 1;
        });
      } else if (cellCount > 0) {
        cellStatusSummary.Recorded =
          (cellStatusSummary.Recorded || 0) + cellCount;
      }
      const ponds = r.leachatePondDetails || [];
      if (ponds.length > 0) {
        ponds.forEach((p) => {
          const k = p.status || "Active";
          leachateStatusSummary[k] = (leachateStatusSummary[k] || 0) + 1;
        });
      } else if (Number(r.noOfLeachatePond || 0) > 0) {
        leachateStatusSummary.Recorded =
          (leachateStatusSummary.Recorded || 0) + Number(r.noOfLeachatePond);
      }
      const vents = r.gasVentDetails || [];
      if (vents.length > 0) {
        vents.forEach((v) => {
          const k = v.status || "Active";
          gasStatusSummary[k] = (gasStatusSummary[k] || 0) + 1;
        });
      } else if (Number(r.numberOfGasVents || 0) > 0) {
        gasStatusSummary.Recorded =
          (gasStatusSummary.Recorded || 0) + Number(r.numberOfGasVents);
      }
    }
    return {
      totalRecords: filtered.length,
      opCount,
      nonOpCount,
      totalCapacity,
      totalLGUs,
      totalCells,
      totalLeachate,
      totalGasVents,
      totalWaste,
      privateSectorCount,
      cellsWithData,
      lgusWithData,
      capacityWithData,
      wasteWithData,
      leachateWithData,
      gasVentsWithData,
      privateWithData: privateSectorCount,
      privateClientsTotal,
      receivingCapacityTotal,
      region3LguServed,
      outsideRegionLguServed: Math.max(0, totalLGUs - region3LguServed),
      capacityUsePercent:
        totalCapacity > 0
          ? Math.min(100, (totalWaste / totalCapacity) * 100)
          : 0,
      wasteUnitLabel: hasTons && !hasM3 ? "tons" : "m³",
      cellStatusSummary,
      leachateStatusSummary,
      gasStatusSummary,
    };
  }, [filtered]);
  const {
    totalRecords,
    opCount,
    nonOpCount,
    totalCapacity,
    totalLGUs,
    totalCells,
    totalLeachate,
    totalGasVents,
    totalWaste,
    wasteUnitLabel,
    privateSectorCount,
    cellsWithData,
    lgusWithData,
    capacityWithData,
    wasteWithData,
    leachateWithData,
    gasVentsWithData,
    privateWithData,
    privateClientsTotal,
    receivingCapacityTotal,
    region3LguServed,
    outsideRegionLguServed,
    capacityUsePercent,
    cellStatusSummary,
    leachateStatusSummary,
    gasStatusSummary,
  } = tileStats;

  const insightConfig = useMemo(() => {
    const ownershipBreakdown = groupMetric(
      filtered,
      (r) => r.ownership,
      () => 1,
    );
    const statusBreakdown = groupMetric(
      filtered,
      (r) => r.statusOfSLF,
      () => 1,
    );
    const categoryCapacity = groupMetric(
      filtered,
      (r) => r.category,
      (r) => r.volumeCapacity || 0,
    );
    const provinceCapacity = groupMetric(
      filtered,
      (r) => r.province,
      (r) => r.volumeCapacity || 0,
    );
    const provinceWaste = groupMetric(
      filtered,
      (r) => r.province,
      (r) => r.actualResidualWasteReceived || 0,
    );
    const lguData = topMetric(
      filtered,
      getServedClientCount,
      "LGUs served",
    );
    const cellData = topMetric(filtered, (r) => r.numberOfCell || 0, "cells");
    const privateData = filtered
      .map((record) => ({
        name: record.lgu || record.facilityName || "Unspecified SLF",
        province: record.province || "-",
        status: record.statusOfSLF || "-",
        ownership: record.ownership || "-",
        value:
          (record.privateCompaniesServed || []).length ||
          (/private/i.test(record.ownership || "") ? 1 : 0),
        label: "private sector served",
      }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
    const leachateData = topMetric(
      filtered,
      (r) => r.noOfLeachatePond || 0,
      "ponds",
    );
    const gasData = topMetric(
      filtered,
      (r) => r.numberOfGasVents || 0,
      "vents",
    );
    const wasteData = topMetric(
      filtered,
      (r) => r.actualResidualWasteReceived || 0,
      "received",
    );
    const capacityData = topMetric(
      filtered,
      (r) => r.volumeCapacity || 0,
      "capacity",
    );
    const statusToChart = (summary) =>
      Object.entries(summary)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    return {
      cells: {
        title: "Cell Infrastructure Management",
        icon: <ExperimentOutlined style={{ color: "#1a3353" }} />,
        color: "#1a3353",
        primary: totalCells,
        primaryTitle: "Total Cells",
        stats: [
          { title: "Facilities with Cells", value: cellsWithData },
          {
            title: "Avg Cells / SLF",
            value: cellsWithData ? (totalCells / cellsWithData).toFixed(1) : 0,
          },
          { title: "Operational SLFs", value: opCount },
        ],
        chartData: cellData.slice(0, 10),
        pieData: statusToChart(cellStatusSummary),
        narration: `${cellsWithData} of ${totalRecords} SLFs have encoded cell infrastructure. The portfolio records ${totalCells.toLocaleString()} cells, with status mix shown below for operational planning and follow-up.`,
      },
      lgu: {
        title: "LGUs Served",
        icon: <TeamOutlined style={{ color: "#1677ff" }} />,
        color: "#1677ff",
        primary: totalLGUs,
        primaryTitle: "Total LGUs Served",
        stats: [
          { title: "Reporting SLFs", value: lgusWithData },
          { title: "Within Region 3", value: region3LguServed },
          { title: "Outside Region 3", value: outsideRegionLguServed },
        ],
        chartData: lguData.slice(0, 10),
        pieData: [
          { name: "Within Region 3", value: region3LguServed },
          { name: "Outside Region 3", value: outsideRegionLguServed },
        ].filter((item) => item.value > 0),
        narration: `${lgusWithData} SLFs report LGU coverage. Region 3 accounts for ${region3LguServed.toLocaleString()} served LGUs, while ${outsideRegionLguServed.toLocaleString()} are tagged outside Region 3 or without a Region 3 province match.`,
      },
      private: {
        title: "Private Sector Served",
        icon: <BankOutlined style={{ color: "#2d5f8a" }} />,
        color: "#2d5f8a",
        primary: privateClientsTotal || privateSectorCount,
        primaryTitle: privateClientsTotal ? "Private Clients" : "Private SLFs",
        stats: [
          { title: "Private-Owned SLFs", value: privateSectorCount },
          { title: "Client Records", value: privateClientsTotal },
          { title: "Reporting SLFs", value: privateWithData },
        ],
        chartData: privateData.slice(0, 10),
        pieData: ownershipBreakdown,
        narration: privateClientsTotal
          ? `${privateClientsTotal.toLocaleString()} private sector client records are attached to SLF facilities. Use the ranking to spot facilities serving the largest private client groups.`
          : `${privateSectorCount.toLocaleString()} facilities are tagged as private-owned. Client-level lists are not yet encoded for all records, so ownership is used as the current private sector signal.`,
      },
      gas: {
        title: "Gas Management",
        icon: <ExperimentOutlined style={{ color: "#52c41a" }} />,
        color: "#52c41a",
        primary: totalGasVents,
        primaryTitle: "Gas Management Records",
        stats: [
          { title: "SLFs with Gas Management", value: gasVentsWithData },
          {
            title: "Avg Records / SLF",
            value: gasVentsWithData
              ? (totalGasVents / gasVentsWithData).toFixed(1)
              : 0,
          },
          { title: "Operational SLFs", value: opCount },
        ],
        chartData: gasData.slice(0, 10),
        pieData: statusToChart(gasStatusSummary),
        narration: `${gasVentsWithData} SLFs report gas management infrastructure. The status breakdown highlights vents that are active, under maintenance, decommissioned, or only recorded at count level.`,
      },
      leachate: {
        title: "Leachate Management",
        icon: <AlertOutlined style={{ color: "#69b1ff" }} />,
        color: "#69b1ff",
        primary: totalLeachate,
        primaryTitle: "Leachate Treatment Plant",
        stats: [
          { title: "SLFs with Ponds", value: leachateWithData },
          {
            title: "Avg Ponds / SLF",
            value: leachateWithData
              ? (totalLeachate / leachateWithData).toFixed(1)
              : 0,
          },
          { title: "Non-Operational SLFs", value: nonOpCount },
        ],
        chartData: leachateData.slice(0, 10),
        pieData: statusToChart(leachateStatusSummary),
        narration: `${leachateWithData} SLFs have leachate pond records. Facilities with higher pond counts may need closer review of pond condition notes, maintenance status, and supporting attachments.`,
      },
      waste: {
        title: "Waste Received",
        icon: <BarChartOutlined style={{ color: "#ff4d4f" }} />,
        color: "#ff4d4f",
        primary: totalWaste,
        primaryTitle: "Waste Received",
        primarySuffix: filtered.some(
          (r) => normalizeUnit(r.wasteReceivedUnit) === "tons",
        )
          ? "tons"
          : "m³",
        stats: [
          { title: "Reporting SLFs", value: wasteWithData },
          {
            title: "Avg / Facility",
            value: wasteWithData ? Math.round(totalWaste / wasteWithData) : 0,
            suffix: filtered.some(
              (r) => normalizeUnit(r.wasteReceivedUnit) === "tons",
            )
              ? "tons"
              : "m³",
          },
          {
            title: "Capacity Use",
            value: capacityUsePercent.toFixed(1),
            suffix: "%",
          },
        ],
        chartData: wasteData.slice(0, 10),
        pieData: provinceWaste.slice(0, 8),
        narration: `${wasteWithData} SLFs report waste received. The total follows the latest portal baseline active-cell entries where available and is ${totalWaste.toLocaleString()}, equivalent to ${capacityUsePercent.toFixed(1)}% of encoded total capacity where comparable.`,
      },
      capacity: {
        title: "SLF Total Capacities",
        icon: <DatabaseOutlined style={{ color: "#fa8c16" }} />,
        color: "#fa8c16",
        primary: totalCapacity,
        primaryTitle: "Total Capacity",
        stats: [
          { title: "Facilities with Data", value: capacityWithData },
          { title: "Receiving Capacity", value: receivingCapacityTotal },
          {
            title: "Capacity Used",
            value: capacityUsePercent.toFixed(1),
            suffix: "%",
          },
        ],
        chartData: capacityData.slice(0, 10),
        pieData: categoryCapacity.length
          ? categoryCapacity
          : provinceCapacity.slice(0, 8),
        narration: `${capacityWithData} SLFs have encoded capacity. The encoded total is ${totalCapacity.toLocaleString()}, with ${receivingCapacityTotal.toLocaleString()} recorded as receiving volume capacity and ${capacityUsePercent.toFixed(1)}% represented by waste received.`,
      },
    };
  }, [
    capacityUsePercent,
    capacityWithData,
    cellStatusSummary,
    cellsWithData,
    filtered,
    gasStatusSummary,
    gasVentsWithData,
    leachateStatusSummary,
    leachateWithData,
    lgusWithData,
    nonOpCount,
    opCount,
    outsideRegionLguServed,
    privateClientsTotal,
    privateSectorCount,
    privateWithData,
    receivingCapacityTotal,
    region3LguServed,
    totalCapacity,
    totalCells,
    totalGasVents,
    totalLGUs,
    totalLeachate,
    totalRecords,
    totalWaste,
    wasteWithData,
  ]);

  const renderInsightModal = () => {
    const config = insightConfig[slfInsightModal];
    if (!config) return null;
    const maxBar = Math.max(...config.chartData.map((item) => item.value), 1);
    if (slfInsightModal === "cells") {
      const statusBucket = (status, fill, capacity) => {
        const raw = normalizeCellStatus(status);
        const lower = String(raw || "").toLowerCase();
        if (/reserved/.test(lower)) return "Reserved";
        if (/used|completed|closed/.test(lower)) return "Used / Completed";
        if (Number(fill || 0) > 0 && Number(capacity || 0) > Number(fill || 0)) return "In Use";
        if (isActiveCellStatus(raw)) return "Active";
        return raw || "Unspecified";
      };
      const facilityCellSummary = (record) => {
        const count = Math.max(
          Number(record.numberOfCell || 0),
          record.cellStatuses?.length || 0,
          record.cellCapacities?.length || 0,
          record.cellTypes?.length || 0,
          record.cellNames?.length || 0,
        );
        const summary = { total: 0, residual: 0, hazardous: 0, statuses: {} };
        for (let index = 0; index < count; index += 1) {
          const status = record.cellStatuses?.[index] || "Active Cell";
          if (isNonExistentCell(status)) continue;
          const type = record.cellTypes?.[index] || "Residual";
          const capacity = Number(record.cellCapacities?.[index] || 0);
          const fill = Number(record.cellFillValues?.[index] || 0);
          summary.total += 1;
          if (isHazardousCellType(type)) summary.hazardous += 1;
          else summary.residual += 1;
          const bucket = statusBucket(status, fill, capacity);
          summary.statuses[bucket] = (summary.statuses[bucket] || 0) + 1;
        }
        return summary;
      };
      const provinceGroups = Object.entries(
        filtered.reduce((groups, record) => {
          const province = record.province || "Unspecified Province";
          if (!groups[province]) groups[province] = [];
          groups[province].push(record);
          return groups;
        }, {}),
      )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([province, facilities]) => ({
          province,
          facilities: facilities
            .map((record) => ({ record, summary: facilityCellSummary(record) }))
            .filter(({ summary }) => summary.total > 0)
            .sort((a, b) => String(a.record.lgu || "").localeCompare(String(b.record.lgu || ""))),
        }))
        .filter((group) => group.facilities.length > 0);
      return (
        <SlfInsightModal
          slfInsightModal={slfInsightModal}
          setSlfInsightModal={setSlfInsightModal}
          setDetailModal={setDetailModal}
          config={config}
          provinceGroups={provinceGroups}
          totalCells={totalCells}
          cellsWithData={cellsWithData}
          opCount={opCount}
        />
      );
    }
    return (
      <SlfInsightDetailModal
        slfInsightModal={slfInsightModal}
        setSlfInsightModal={setSlfInsightModal}
        config={config}
        maxBar={maxBar}
      />
    );
  };

  // Category descriptions
  const CATEGORY_DESC = {
    "Cat 1": "< 15 TPD",
    "Cat 2": "15–75 TPD",
    "Cat 3": "75–150 TPD",
    "Cat 4": "> 150 TPD",
  };

  const getCategoryLabel = (value) => {
    const match = String(value || "").match(/^cat\s*(\d+)$/i);
    return match ? `Category ${match[1]}` : value;
  };

  const columns = makeMonitoringColumns({
    canEdit,
    canDelete,
    records,
    CATEGORY_DESC,
    getCategoryLabel,
    openEdit,
    setDetailModal,
    reviewAndDeleteRecord,
  });

  const handleExport = () => {
    const rows = filtered.map((r, i) => ({
      "#": i + 1,
      Province: r.province,
      LGU: r.lgu,
      Barangay: r.barangay,
      Ownership: r.ownership,
      Category: r.category,
      Status: r.statusOfSLF,
      "Year Started": r.yearStartedOperation,
      "Capacity per day": r.receivingVolumeCapacity ?? r.volumeCapacity,
      "Capacity Unit": normalizeUnit(
        r.receivingVolumeCapacity != null
          ? r.receivingVolumeCapacityUnit || r.volumeCapacityUnit || "m³"
          : r.volumeCapacityUnit || "m³",
      ),
      "LGUs Served": getServedClientCount(r),
      Cells: r.numberOfCell,
      "Leachate & Gas": `Leachate: ${r.noOfLeachatePond || 0}; Gas: ${r.numberOfGasVents || 0}`,
      "Waste Received": r.actualResidualWasteReceived,
      "Waste Received Unit": normalizeUnit(r.wasteReceivedUnit || "m³"),
      "Target Month": r.targetMonth,
      ENMO: r.enmo,
      Focal: r.focalPerson,
    }));
    exportToExcel(rows, "SLF_Facilities_Data");
  };

  return (
    <div className="admin-page" style={{ padding: 0 }}>
      <div
        className="admin-page-head"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Sanitary Landfill Facility Database
          </Title>
          <Text type="secondary">
            Sanitary landfill facility records and portal-submitted waste
            generator data.
          </Text>
        </div>
        {/* #5: page-header toolbar — Filters, Add Record, Export, Refresh moved to
            the upper-right; the active-record/filter indicator stays visible. Wraps
            below the title on smaller screens. */}
        <Space wrap size={8} style={{ justifyContent: "flex-end" }}>
          <Tag variant="filled" color={hasFilters ? "blue" : "default"}>
            {filtered.length} / {records.length} records
          </Tag>
          <Input
            placeholder="Search..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 180 }}
            size="small"
            allowClear
          />
          <Badge count={activeFilterCount} size="small" offset={[-2, 2]}>
            <Button
              size="small"
              type={filtersOpen || hasFilters ? "primary" : "default"}
              ghost={filtersOpen || hasFilters}
              icon={<FilterOutlined />}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              Filters
            </Button>
          </Badge>
          {canEdit && (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={openAdd}
              style={{ background: ACCENT, borderColor: ACCENT }}
            >
              Add Record
            </Button>
          )}
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            Export
          </Button>
          <Tooltip title="Refresh data">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
              loading={refreshing}
            />
          </Tooltip>
        </Space>
      </div>

      {/* Single-page SLF Data Table (tab-pane wrapper removed — only one pane
          existed, so its content is rendered directly). */}
      <div className="slf-data-table-page">
        {filtersOpen && (
          <Card
            size="small"
            style={{ borderRadius: 10, marginBottom: 12 }}
            bodyStyle={{ padding: "10px 16px" }}
          >
            <Row gutter={[10, 10]} align="middle">
              <Col>
                <FilterOutlined style={{ color: ACCENT, marginRight: 6 }} />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Filters:
                </Text>
              </Col>
              <Col flex="auto">
                <Space wrap size={8}>
                  <Select
                    placeholder="Province"
                    value={filterProvince}
                    onChange={setFilterProvince}
                    allowClear
                    style={{
                      width: "100%",
                      minWidth: 120,
                      maxWidth: 160,
                    }}
                    size="small"
                    options={provinceOptions}
                    suffixIcon={<EnvironmentOutlined />}
                  />
                  <Select
                    placeholder="Status"
                    value={filterStatus}
                    onChange={setFilterStatus}
                    allowClear
                    style={{
                      width: "100%",
                      minWidth: 110,
                      maxWidth: 160,
                    }}
                    size="small"
                    options={buildFilters(records, "statusOfSLF")}
                    suffixIcon={<SafetyCertificateOutlined />}
                  />
                  <Select
                    placeholder="Category"
                    value={filterCategory}
                    onChange={setFilterCategory}
                    allowClear
                    style={{
                      width: "100%",
                      minWidth: 110,
                      maxWidth: 150,
                    }}
                    size="small"
                    options={buildFilters(records, "category")}
                  />
                  <Select
                    placeholder="Target Month"
                    value={filterMonth}
                    onChange={setFilterMonth}
                    allowClear
                    style={{
                      width: "100%",
                      minWidth: 110,
                      maxWidth: 150,
                    }}
                    size="small"
                    options={monthOptions}
                    suffixIcon={<CalendarOutlined />}
                  />
                  <Tooltip title="Latest shows each SLF's most recent data year only. Pick a year to see every record stored for that year.">
                    <Select
                      placeholder="Data Year"
                      value={filterDataYear}
                      onChange={setFilterDataYear}
                      allowClear
                      style={{
                        width: "100%",
                        minWidth: 110,
                        maxWidth: 150,
                      }}
                      size="small"
                      options={[
                        { label: "Latest per SLF", value: null },
                        ...availableYears.map((year) => ({
                          label: String(year),
                          value: year,
                        })),
                      ]}
                      suffixIcon={<CalendarOutlined />}
                    />
                  </Tooltip>
                  {hasFilters && (
                    <Tooltip title="Clear all filters">
                      <Button
                        size="small"
                        type="link"
                        danger
                        icon={<ClearOutlined />}
                        onClick={clearFilters}
                      >
                        Clear
                      </Button>
                    </Tooltip>
                  )}
                </Space>
              </Col>
            </Row>
          </Card>
        )}

        {/* Table */}
        <Card size="small" style={{ borderRadius: 10 }}>
          <ResponsiveTable
            className="slf-table"
            dataSource={filtered}
            columns={columns}
            rowKey="_id"
            loading={loading && records.length === 0}
            size="small"
            pagination={{
              pageSize: 50,
              showSizeChanger: true,
              showTotal: (t) => `${t} records`,
            }}
          />
        </Card>
      </div>

      {/* Add/Edit Modal */}
      <SlfEditModal
        isDark={isDark}
        canEdit={canEdit}
        driveDisabled={driveDisabled}
        modalOpen={modalOpen}
        setModalOpen={setModalOpen}
        editing={editing}
        form={form}
        saving={saving}
        handleSave={handleSave}
        loading={loading}
        records={records}
        provinceOptions={provinceOptions}
        districtOptions={districtOptions}
        categoryOptions={categoryOptions}
        ownershipOptions={ownershipOptions}
        mbaOptions={mbaOptions}
        slfStatusOptions={slfStatusOptions}
        cellActionSaving={cellActionSaving}
        saveCellStatusNow={saveCellStatusNow}
        saveCellSubmissionAllowedNow={saveCellSubmissionAllowedNow}
        preventiveUploadEventToFileList={preventiveUploadEventToFileList}
        openFilePreview={openFilePreview}
        openMapPreview={openMapPreview}
        setUnitToolOpen={setUnitToolOpen}
        setConvModalOpen={setConvModalOpen}
        setConvArea={setConvArea}
        setConvDepth={setConvDepth}
        setConvVol={setConvVol}
        setConvDensity={setConvDensity}
        setConvM3ToTons={setConvM3ToTons}
      />

      <MapPreviewModal mapPreview={mapPreview} setMapPreview={setMapPreview} />

      {/* -- File / PDF Preview Modal -- */}
      <FilePreviewModal filePreview={filePreview} setFilePreview={setFilePreview} />

      {/* -- Capacity Converter Modal -- */}
      <ConversionToolsModal
        convModalOpen={convModalOpen}
        setConvModalOpen={setConvModalOpen}
        convArea={convArea}
        setConvArea={setConvArea}
        convDepth={convDepth}
        setConvDepth={setConvDepth}
        convVol={convVol}
        setConvVol={setConvVol}
        convDensity={convDensity}
        setConvDensity={setConvDensity}
        convM3ToTons={convM3ToTons}
        setConvM3ToTons={setConvM3ToTons}
        copyText={copyText}
        form={form}
      />
      <UnitToolModal
        unitToolOpen={unitToolOpen}
        setUnitToolOpen={setUnitToolOpen}
        unitToolValue={unitToolValue}
        setUnitToolValue={setUnitToolValue}
        applyUnitTool={applyUnitTool}
      />

      {/* Detail Modal */}
      <SlfDetailModal
        isDark={isDark}
        detailModal={detailModal}
        setDetailModal={setDetailModal}
        detailViewRecord={detailViewRecord}
        detailDashboard={detailDashboard}
        detailDashboardError={detailDashboardError}
        detailProgress={detailProgress}
        detailHistoryLoading={detailHistoryLoading}
        detailSubmissionsLoading={detailSubmissionsLoading}
        baselineData={baselineData}
        loadingBaseline={loadingBaseline}
        galleryViewMode={galleryViewMode}
        setGalleryViewMode={setGalleryViewMode}
        openFilePreview={openFilePreview}
        openDailySubmissionsModal={openDailySubmissionsModal}
        setCapacityAlertModal={setCapacityAlertModal}
      />

      {renderInsightModal()}

      {/* -- LGU Served Drill-Down Modal -- */}
      <SlfLguModal
        slfLguModal={slfLguModal}
        setSlfLguModal={setSlfLguModal}
        records={records}
        capacityAlertModal={capacityAlertModal}
        setCapacityAlertModal={setCapacityAlertModal}
        capacityAlertSending={capacityAlertSending}
        sendCapacityAlert={sendCapacityAlert}
      />

      {/* -- Waste Received Drill-Down Modal -- */}
      <SlfWasteModal
        slfWasteModal={slfWasteModal}
        setSlfWasteModal={setSlfWasteModal}
        records={records}
      />
      <DailySubmissionsModal
        dailySubmissionsModal={dailySubmissionsModal}
        setDailySubmissionsModal={setDailySubmissionsModal}
      />
      <CellAssignmentModal
        isDark={isDark}
        cellAssignmentModal={cellAssignmentModal}
        setCellAssignmentModal={setCellAssignmentModal}
        cellAssignmentSaving={cellAssignmentSaving}
        saveCellAssignments={saveCellAssignments}
        updateCellAssignmentLocal={updateCellAssignmentLocal}
        getActiveCellOptions={getActiveCellOptions}
        records={records}
      />
    </div>
  );
}
