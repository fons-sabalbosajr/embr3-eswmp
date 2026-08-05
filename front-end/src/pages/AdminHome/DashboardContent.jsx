import { useState, useEffect, useMemo, useCallback, useRef, Suspense, lazy } from "react";
import {
  Layout,
  Menu,
  Typography,
  Card,
  Row,
  Col,
  Statistic,
  Avatar,
  Dropdown,
  Button,
  Switch,
  ConfigProvider,
  theme as antTheme,
  Tag,
  Table,
  Progress,
  Modal,
  Descriptions,
  Divider,
  Space,
  Tabs,
  Badge,
  Tooltip,
  Select,
  DatePicker,
  Drawer,
  Grid,
  Popover,
  Empty,
  Spin,
  Skeleton,
  List,
  Collapse,
  Alert,
} from "antd";
import {
  DashboardOutlined,
  ReloadOutlined,
  FileTextOutlined,
  TeamOutlined,
  BarChartOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ReconciliationOutlined,
  InboxOutlined,
  FormOutlined,
  BulbOutlined,
  BulbFilled,
  ToolOutlined,
  CodeOutlined,
  RiseOutlined,
  PieChartOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  FundProjectionScreenOutlined,
  BankOutlined,
  CarOutlined,
  ExperimentOutlined,
  ApartmentOutlined,
  FilePdfOutlined,
  AlertOutlined,
  AuditOutlined,
  ContainerOutlined,
  DeleteOutlined,
  FileDoneOutlined,
  FundOutlined,
  SafetyCertificateOutlined,
  RobotOutlined,
  AppstoreOutlined,
  BellOutlined,
  MessageOutlined,
  GlobalOutlined,
  LinkOutlined,
  EyeOutlined,
  DownloadOutlined,
  CopyOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  SwapOutlined,
  CustomerServiceOutlined,
  WarningOutlined,
  FireOutlined,
  TableOutlined,
  MailOutlined,
} from "@ant-design/icons";
import VeraCard from "../admin/VeraCard";
import PreventionMeasuresPanel from "../admin/PreventionMeasuresPanel";
import { resolveMediaOpenUrl } from "../admin/slf-monitoring/helpers.jsx";
import api from "../../api";
import GaugeMeter, { computeGaugePercent } from "../../components/GaugeMeter";
import {
  resolveCellName,
  getCellStatusConfig,
  getCellTypeConfig,
  isNonExistentCell,
  getSlfColor,
  getSlfCapacityColor,
} from "../../utils/cellVisuals";
import { convertVolume, resolveCellUnit } from "../../utils/volumeUnits";
import secureStorage from "../../utils/secureStorage";
import { getSocket } from "../../utils/socket";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
} from "react-leaflet";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import L from "leaflet";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  STATUS_COLORS,
  getPlanStatus,
  planStatusIcon,
  classifySlfStatus,
  firstSlfPhoto,
  MAP_MARKER,
  TILE_LAYERS,
} from "./constants";
import { ProvinceBoundary, FitBounds } from "./MapPrimitives";
import DashboardSkeleton from "./DashboardSkeleton";

dayjs.extend(relativeTime);

const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

// Lazy-loaded panels embedded inside dashboard tabs (Suspense-wrapped at each use).
const DisposalActivityCalendar = lazy(() => import("../admin/DisposalActivityCalendar"));
const HaulerClientsPanel = lazy(() => import("../admin/HaulerClientsPanel"));
const ClientServedSummary = lazy(() => import("../admin/ClientServedSummary"));
const SlfManagementBySlf = lazy(() => import("../admin/SlfManagementBySlf"));
const PreventiveMeasuresBySlf = lazy(() => import("../admin/PreventiveMeasuresBySlf"));
const SlfAnalyticsRow = lazy(() => import("../admin/SlfAnalyticsRow"));
const ClientRelationshipView = lazy(() => import("../admin/ClientRelationshipView"));

// Poll cadence shared by the stats fan-out and the served-clients tile, so the two
// stay in step. Module scope keeps it out of effect dependency lists.
const STATS_POLL_MS = 60000;

export default function DashboardContent({ user, isDark, setActiveMenu, onOpenSubmissions, canOpenSubmissions }) {
  const screens = useBreakpoint();
  const [stats, setStats] = useState(null);
  const [swmStats, setSwmStats] = useState(null);
  const [mrfStats, setMrfStats] = useState(null);
  const [lguMrfStats, setLguMrfStats] = useState(null);
  const [trapStats, setTrapStats] = useState(null);
  const [equipStats, setEquipStats] = useState(null);
  const [slfFacStats, setSlfFacStats] = useState(null);
  const [openDumpStats, setOpenDumpStats] = useState(null);
  const [rcaStats, setRcaStats] = useState(null);
  const [pdsStats, setPdsStats] = useState(null);
  const [techAssistStats, setTechAssistStats] = useState(null);
  const [tsStats, setTsStats] = useState(null);
  const [lguDivStats, setLguDivStats] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dashTab, setDashTab] = useState(null);
  const [dashboardTabSettings, setDashboardTabSettings] = useState(null);
  const [slfClientSummary, setSlfClientSummary] = useState({ lgu: 0, private: 0, total: 0, loading: true, error: false });
  const [tileKey, setTileKey] = useState("street");
  const [mapFilterProvince, setMapFilterProvince] = useState(null);
  const [mapFilterStatus, setMapFilterStatus] = useState(null);
  const [mapViewRecord, setMapViewRecord] = useState(null);
  const [mrfTileKey, setMrfTileKey] = useState("street");
  const [mrfFilterProvince, setMrfFilterProvince] = useState(null);
  const [mrfFilterStatus, setMrfFilterStatus] = useState(null);
  const [lguTileKey, setLguTileKey] = useState("street");
  const [lguFilterProvince, setLguFilterProvince] = useState(null);
  const [lguFilterStatus, setLguFilterStatus] = useState(null);
  const [trapTileKey, setTrapTileKey] = useState("street");
  const [trapFilterProvince, setTrapFilterProvince] = useState(null);
  const [trapFilterStatus, setTrapFilterStatus] = useState(null);
  const [trapViewRecord, setTrapViewRecord] = useState(null);
  const [equipTileKey, setEquipTileKey] = useState("street");
  const [equipFilterProvince, setEquipFilterProvince] = useState(null);
  const [equipFilterType, setEquipFilterType] = useState(null);
  const [slfTileKey, setSlfTileKey] = useState("street");
  const [slfFilterProvince, setSlfFilterProvince] = useState(null);
  const [slfFilterStatus, setSlfFilterStatus] = useState(null);
  const [slfDashModal, setSlfDashModal] = useState(null); // { type: dashboard metric key }
  const [preventiveSlfModal, setPreventiveSlfModal] = useState(null); // { _id, lgu, province, files, details } | null
  const [preventiveDashModal, setPreventiveDashModal] = useState(false);
  const [preventionPanel, setPreventionPanel] = useState(null); // { facilityId, slfName } | null
  const [preventiveFileViewer, setPreventiveFileViewer] = useState(null); // { url, fileName, slfName, province } | null
  const [preventiveFileZoom, setPreventiveFileZoom] = useState(100);
  const [slfCellDrill, setSlfCellDrill] = useState(null); // selected SLF in Cell Infrastructure modal → per-cell cards
  const [cellProvinceExpanded, setCellProvinceExpanded] = useState(null);

  const getPreventiveFileName = (url, fallback = "document") => {
    const clean = String(url || "").split("?")[0].split("#")[0];
    try { return decodeURIComponent(clean.split("/").pop() || "") || fallback; }
    catch { return fallback; }
  };
  const getPreventiveFileKind = (fileName, url) => {
    const value = `${fileName || ""} ${url || ""}`.toLowerCase().split("?")[0].split("#")[0];
    if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(value)) return "image";
    if (/\.pdf$/i.test(value)) return "pdf";
    if (/\.(docx?|rtf)$/i.test(value)) return "word";
    return "file";
  };
  const absoluteMediaUrl = (url) => {
    const resolved = resolveMediaOpenUrl(url);
    try { return new URL(resolved, window.location.origin).href; }
    catch { return resolved; }
  };
  const openPreventiveFileViewer = (file) => {
    setPreventiveFileZoom(100);
    setPreventiveFileViewer(file);
  };

  const mapPts = useMemo(
    () =>
      ((swmStats && swmStats.mapData) || [])
        .filter(
          (r) =>
            r.latitude &&
            r.longitude &&
            !isNaN(r.latitude) &&
            !isNaN(r.longitude),
        )
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [swmStats && swmStats.mapData],
  );

  const filteredMapPts = useMemo(() => {
    let pts = mapPts;
    if (mapFilterProvince)
      pts = pts.filter((p) => p.record.province === mapFilterProvince);
    if (mapFilterStatus)
      pts = pts.filter(
        (p) => getPlanStatus(p.record.forRenewal) === mapFilterStatus,
      );
    return pts;
  }, [mapPts, mapFilterProvince, mapFilterStatus]);

  const provinceOptions = useMemo(() => {
    const set = new Set(mapPts.map((p) => p.record.province).filter(Boolean));
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [mapPts]);

  // MRF map points
  const mrfMapPts = useMemo(
    () =>
      ((mrfStats && mrfStats.mapData) || [])
        .filter(
          (r) =>
            r.latitude &&
            r.longitude &&
            !isNaN(r.latitude) &&
            !isNaN(r.longitude),
        )
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [mrfStats && mrfStats.mapData],
  );

  const filteredMrfMapPts = useMemo(() => {
    let pts = mrfMapPts;
    if (mrfFilterProvince)
      pts = pts.filter((p) => p.record.province === mrfFilterProvince);
    if (mrfFilterStatus) {
      if (mrfFilterStatus === "Operational")
        pts = pts.filter(
          (p) =>
            /operational/i.test(p.record.statusOfMRF) &&
            !/non/i.test(p.record.statusOfMRF),
        );
      else if (mrfFilterStatus === "Non-Operational")
        pts = pts.filter((p) => /non/i.test(p.record.statusOfMRF));
      else pts = pts.filter((p) => !p.record.statusOfMRF);
    }
    return pts;
  }, [mrfMapPts, mrfFilterProvince, mrfFilterStatus]);

  const mrfProvinceOptions = useMemo(() => {
    const set = new Set(
      mrfMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [mrfMapPts]);

  // LGU MRF map points
  const lguMapPts = useMemo(
    () =>
      ((lguMrfStats && lguMrfStats.mapData) || [])
        .filter(
          (r) =>
            r.latitude &&
            r.longitude &&
            !isNaN(r.latitude) &&
            !isNaN(r.longitude),
        )
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [lguMrfStats && lguMrfStats.mapData],
  );

  const filteredLguMapPts = useMemo(() => {
    let pts = lguMapPts;
    if (lguFilterProvince)
      pts = pts.filter((p) => p.record.province === lguFilterProvince);
    if (lguFilterStatus) {
      if (lguFilterStatus === "Operational")
        pts = pts.filter(
          (p) =>
            /operational/i.test(p.record.statusOfMRF) &&
            !/non/i.test(p.record.statusOfMRF),
        );
      else if (lguFilterStatus === "Non-Operational")
        pts = pts.filter((p) => /non/i.test(p.record.statusOfMRF));
      else pts = pts.filter((p) => !p.record.statusOfMRF);
    }
    return pts;
  }, [lguMapPts, lguFilterProvince, lguFilterStatus]);

  const lguProvinceOptions = useMemo(() => {
    const set = new Set(
      lguMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [lguMapPts]);

  // Trash Trap map points — validate within PH bounds
  const trapMapPts = useMemo(
    () =>
      ((trapStats && trapStats.mapData) || [])
        .filter((r) => {
          const lat = Number(r.latitude);
          const lng = Number(r.longitude);
          return (
            lat && lng && !isNaN(lat) && !isNaN(lng) &&
            lat >= 4.5 && lat <= 21.5 && lng >= 116 && lng <= 127
          );
        })
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [trapStats && trapStats.mapData],
  );

  const filteredTrapMapPts = useMemo(() => {
    let pts = trapMapPts;
    if (trapFilterProvince)
      pts = pts.filter((p) => p.record.province === trapFilterProvince);
    if (trapFilterStatus) {
      if (trapFilterStatus === "Operational")
        pts = pts.filter(
          (p) =>
            /operational/i.test(p.record.statusOfTrashTraps) &&
            !/non/i.test(p.record.statusOfTrashTraps),
        );
      else if (trapFilterStatus === "Non-Operational")
        pts = pts.filter((p) => /non/i.test(p.record.statusOfTrashTraps));
      else pts = pts.filter((p) => !p.record.statusOfTrashTraps);
    }
    return pts;
  }, [trapMapPts, trapFilterProvince, trapFilterStatus]);

  const trapProvinceOptions = useMemo(() => {
    const set = new Set(
      trapMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [trapMapPts]);

  // SWM Equipment map points
  const equipMapPts = useMemo(
    () =>
      ((equipStats && equipStats.mapData) || [])
        .filter(
          (r) =>
            r.latitude &&
            r.longitude &&
            !isNaN(r.latitude) &&
            !isNaN(r.longitude),
        )
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [equipStats && equipStats.mapData],
  );

  const filteredEquipMapPts = useMemo(() => {
    let pts = equipMapPts;
    if (equipFilterProvince)
      pts = pts.filter((p) => p.record.province === equipFilterProvince);
    if (equipFilterType)
      pts = pts.filter((p) => p.record.typeOfEquipment === equipFilterType);
    return pts;
  }, [equipMapPts, equipFilterProvince, equipFilterType]);

  const equipProvinceOptions = useMemo(() => {
    const set = new Set(
      equipMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [equipMapPts]);

  const equipTypeOptions = useMemo(() => {
    const set = new Set(
      equipMapPts.map((p) => p.record.typeOfEquipment).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [equipMapPts]);

  // SLF Facility map points — validate within PH bounds
  const slfMapPts = useMemo(
    () =>
      ((slfFacStats && slfFacStats.mapData) || [])
        .filter((r) => {
          const lat = Number(r.latitude);
          const lng = Number(r.longitude);
          return (
            lat && lng && !isNaN(lat) && !isNaN(lng) &&
            lat >= 4.5 && lat <= 21.5 && lng >= 116 && lng <= 127
          );
        })
        .map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          record: r,
        })),
    [slfFacStats && slfFacStats.mapData],
  );

  // SLF Location Map: per-SLF submission status FOR THE SELECTED CALENDAR DATE,
  // keyed by SLF id (declared before the map-status memos below that read it, to
  // avoid a TDZ access during render). The map is date-specific: it reflects the
  // day chosen in the Disposal Calendar, not an overall "latest" status.
  const [slfToday, setSlfToday] = useState({ byId: {}, generatedAt: null, loading: false, error: false });

  // Resolved marker status for an SLF on the selected date, or "no-data" when the
  // SLF has no disposal activity that date. Used by BOTH the markers and the
  // Status filter so they can never disagree.
  const slfMarkerStatusKey = (record) =>
    slfToday.byId[String(record._id)]?.submissionStatus || "no-data";
  const filteredSlfMapPts = useMemo(() => {
    let pts = slfMapPts;
    if (slfFilterProvince)
      pts = pts.filter((p) => p.record.province === slfFilterProvince);
    if (slfFilterStatus)
      pts = pts.filter((p) => slfMarkerStatusKey(p.record) === slfFilterStatus);
    return pts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slfMapPts, slfFilterProvince, slfFilterStatus, slfToday.byId]);

  const slfProvinceOptions = useMemo(() => {
    const set = new Set(
      slfMapPts.map((p) => p.record.province).filter(Boolean),
    );
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [slfMapPts]);

  const trapStatusIcon = (statusOfTrashTraps) => {
    const isOp =
      /operational/i.test(statusOfTrashTraps) &&
      !/non/i.test(statusOfTrashTraps);
    const isNonOp = /non/i.test(statusOfTrashTraps);
    const bg = isOp ? "#52c41a" : isNonOp ? "#ff4d4f" : "#8c8c8c";
    const icon = isOp ? "✓" : isNonOp ? "✕" : "●";
    return L.divIcon({
      className: "",
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${icon}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
    });
  };

  const equipStatusIcon = (record) => {
    const shredderOp =
      /operational/i.test(record.statusOfBioShredder) &&
      !/non/i.test(record.statusOfBioShredder);
    const composterOp =
      /operational/i.test(record.statusOfBioComposter) &&
      !/non/i.test(record.statusOfBioComposter);
    const bg =
      shredderOp && composterOp
        ? "#52c41a"
        : shredderOp || composterOp
          ? "#faad14"
          : "#ff4d4f";
    const icon =
      shredderOp && composterOp ? "✓" : shredderOp || composterOp ? "▲" : "✕";
    return L.divIcon({
      className: "",
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${icon}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
    });
  };

  const mrfStatusIcon = (statusOfMRF) => {
    const isOp = /operational/i.test(statusOfMRF) && !/non/i.test(statusOfMRF);
    const isNonOp = /non/i.test(statusOfMRF);
    const bg = isOp ? "#52c41a" : isNonOp ? "#ff4d4f" : "#8c8c8c";
    const icon = isOp ? "✓" : isNonOp ? "✕" : "●";
    return L.divIcon({
      className: "",
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${icon}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
    });
  };

  // ── SLF Location Map: today's submission status (one aggregated request) ──
  // Selected map day (official Manila "today" by default). Marker status is
  // computed for THIS date; future dates are disabled.
  const [slfMapDate, setSlfMapDate] = useState(() => dayjs());
  const slfTodayAbort = useRef(null);
  const fetchTodayStatus = useCallback(async (dateStr) => {
    // Cancel any obsolete in-flight request (fast date/filter changes).
    if (slfTodayAbort.current) slfTodayAbort.current.abort();
    const controller = new AbortController();
    slfTodayAbort.current = controller;
    setSlfToday((p) => ({ ...p, loading: true }));
    try {
      const { data } = await api.get("/data-slf/today-status", {
        params: dateStr ? { date: dateStr } : {},
        signal: controller.signal,
      });
      const byId = {};
      (data?.statuses || []).forEach((s) => { byId[String(s.slfId)] = s; });
      setSlfToday({ byId, generatedAt: data?.generatedAt || new Date().toISOString(), loading: false, error: false });
    } catch (err) {
      if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return; // superseded
      setSlfToday((p) => ({ ...p, loading: false, error: true }));
    }
  }, []);
  const slfDateStr = slfMapDate ? slfMapDate.format("YYYY-MM-DD") : "";
  useEffect(() => {
    let id = null;
    const refresh = () => fetchTodayStatus(slfDateStr);
    const start = () => { if (!id) id = setInterval(refresh, 5 * 60 * 1000); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };
    const onVis = () => { if (document.hidden) stop(); else { refresh(); start(); } };
    refresh();
    start();
    document.addEventListener("visibilitychange", onVis);
    // Smooth in-place refresh (map layer only, not the whole dashboard) when a
    // submission/calendar record is created/updated/deleted/acknowledged/reverted —
    // markers for the selected date update without a stale cache.
    const socket = getSocket();
    const onRefresh = ({ target } = {}) => {
      if (["submissions", "slf-waste-generators", "baselines"].includes(target)) refresh();
    };
    if (socket) socket.on("data-refresh", onRefresh);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      if (socket) socket.off("data-refresh", onRefresh);
    };
  }, [fetchTodayStatus, slfDateStr]);

  const slfStatusIcon = (statusOfSLF) => {
    const isOp = /operational/i.test(statusOfSLF) && !/non/i.test(statusOfSLF);
    const isNonOp = /non/i.test(statusOfSLF);
    const bg = isOp ? "#52c41a" : isNonOp ? "#ff4d4f" : "#8c8c8c";
    const icon = isOp ? "✓" : isNonOp ? "✕" : "●";
    return L.divIcon({
      className: "",
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${icon}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12],
    });
  };

  const staticMarker = (color, glyph) => L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${glyph}</div>`,
    iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -12],
  });
  const pulseMarker = (color, glyph, ringClass) => L.divIcon({
    className: "",
    html: `<div class="slf-today"><span class="${ringClass}"></span><div class="slf-today-dot" style="background:${color}">${glyph}</div></div>`,
    iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -14],
  });
  // ONE marker per SLF, keyed to that SLF's disposal status FOR THE SELECTED
  // CALENDAR DATE so the marker matches the Disposal Activity calendar. Resolved
  // by strict priority so concurrent conditions never draw conflicting pulses.
  // Only attention-states (pending / resubmission) pulse; settled states are
  // static. Colours/glyphs come from the shared MAP_MARKER config.
  //   1 Non-operational restriction   → red ✕ (static, highest priority)
  //   2 Pending resubmission          → orange ↻ (pulse)
  //   3 Pending initial submission    → yellow ◷ (pulse)
  //   4 Reverted (sent back)          → orange ↺ (static)
  //   5 Rejected (not accepted)       → red ⊘ (static)
  //   6 Acknowledged                  → blue ✓ (static)
  //   7 No activity for the date      → light-gray – (static)  [neutral default]
  const slfMarkerIcon = (record) => {
    const op = classifySlfStatus(record.statusOfSLF);
    if (op === "nonOperational") return staticMarker("#ff4d4f", "✕");
    const sub = slfToday.byId[String(record._id)]?.submissionStatus || "no-data";
    if (sub === "pending-resubmission") {
      const m = MAP_MARKER["pending-resubmission"];
      return pulseMarker(m.color, m.glyph, m.ring);
    }
    if (sub === "pending") {
      const m = MAP_MARKER.pending;
      return pulseMarker(m.color, m.glyph, m.ring);
    }
    if (sub === "reverted") { const m = MAP_MARKER.reverted; return staticMarker(m.color, m.glyph); }
    if (sub === "rejected") { const m = MAP_MARKER.rejected; return staticMarker(m.color, m.glyph); }
    if (sub === "acknowledged") { const m = MAP_MARKER.acknowledged; return staticMarker(m.color, m.glyph); }
    // Fallback: no calendar record ever vs. a resolved no-submission state.
    const m = MAP_MARKER[sub] || MAP_MARKER["no-data"];
    return staticMarker(m.color, m.glyph);
  };

  const tile = TILE_LAYERS[tileKey];
  const mrfTile = TILE_LAYERS[mrfTileKey];

  const DASH_CACHE_KEY = "dashboard-stats-cache";

  const applyStats = useCallback((slfData, swmData, mrfData, lguMrfData, trapData, equipData, slfFacData, openDumpData, rcaData, pdsData, techAssistData, tsData, lguDivData) => {
    setStats(slfData);
    setSwmStats(swmData);
    setMrfStats(mrfData);
    setLguMrfStats(lguMrfData);
    setTrapStats(trapData);
    setEquipStats(equipData);
    setSlfFacStats(slfFacData);
    setOpenDumpStats(openDumpData);
    setRcaStats(rcaData);
    setPdsStats(pdsData);
    setTechAssistStats(techAssistData);
    setTsStats(tsData);
    setLguDivStats(lguDivData);
  }, []);

  // One dashboard refresh fans out to 15 endpoints, so two overlapping runs mean 30
  // in-flight requests competing for the same connection. Coalesce concurrent
  // callers onto the run already in progress, and remember when it finished so the
  // visibility-aware poll below can tell whether a catch-up fetch is actually due.
  const statsInFlightRef = useRef(null);
  const lastStatsFetchRef = useRef(0);

  const runFetchStats = useCallback(async () => {
    try {
      // Show cached data immediately for instant rendering
      const cacheKey = `${DASH_CACHE_KEY}-all`;
      const cached = secureStorage.getJSON(cacheKey);
      if (cached) {
        applyStats(cached.stats, cached.swmStats, cached.mrfStats, cached.lguMrfStats, cached.trapStats, cached.equipStats, cached.slfFacStats, cached.openDumpStats, cached.rcaStats, cached.pdsStats, cached.techAssistStats, cached.tsStats, cached.lguDivStats);
        setLoading(false);
      }
      // Start every endpoint in parallel, but unblock the primary dashboard as
      // soon as the SLF stats are ready. The slower maintenance modules continue
      // hydrating their tabs in the background.
      const slfReq = api.get("/data-slf/stats").catch(() => ({ data: null }));
      const slfFacReq = api.get("/slf-facilities/stats").catch(() => ({ data: null }));
      const restReqs = Promise.all([
        api.get("/ten-year-swm/stats").catch(() => ({ data: null })),
        api.get("/funded-mrf/stats").catch(() => ({ data: null })),
        api.get("/lgu-initiated-mrf/stats").catch(() => ({ data: null })),
        api.get("/trash-traps/stats").catch(() => ({ data: null })),
        api.get("/swm-equipment/stats").catch(() => ({ data: null })),
        api.get("/data-history/summary").catch(() => ({ data: null })),
        api.get("/open-dumpsites/stats").catch(() => ({ data: null })),
        api.get("/residual-containment/stats").catch(() => ({ data: null })),
        api.get("/project-desc-scoping/stats").catch(() => ({ data: null })),
        api.get("/technical-assistance/stats").catch(() => ({ data: null })),
        api.get("/transfer-stations/stats").catch(() => ({ data: null })),
        api.get("/lgu-assist-diversion/stats").catch(() => ({ data: null })),
      ]);

      const [slfRes, slfFacRes] = await Promise.all([slfReq, slfFacReq]);
      setStats(slfRes.data);
      setSlfFacStats(slfFacRes.data);
      setLoading(false);

      const [swmRes, mrfRes, lguMrfRes, trapRes, equipRes, histRes, openDumpRes, rcaRes, pdsRes, techAssistRes, tsRes, lguDivRes] = await restReqs;
      applyStats(slfRes.data, swmRes.data, mrfRes.data, lguMrfRes.data, trapRes.data, equipRes.data, slfFacRes.data, openDumpRes.data, rcaRes.data, pdsRes.data, techAssistRes.data, tsRes.data, lguDivRes.data);
      if (histRes.data) setHistoryData(histRes.data);
      secureStorage.setJSON(cacheKey, {
        stats: slfRes.data,
        swmStats: swmRes.data,
        mrfStats: mrfRes.data,
        lguMrfStats: lguMrfRes.data,
        trapStats: trapRes.data,
        equipStats: equipRes.data,
        slfFacStats: slfFacRes.data,
        openDumpStats: openDumpRes.data,
        rcaStats: rcaRes.data,
        pdsStats: pdsRes.data,
        techAssistStats: techAssistRes.data,
        tsStats: tsRes.data,
        lguDivStats: lguDivRes.data,
        ts: Date.now(),
      });
    } catch {
      /* silently fail */
    } finally {
      setLoading(false);
    }
  }, [applyStats]);

  // Public entry point: coalesces concurrent callers (poll tick, socket burst,
  // mount) onto a single in-flight run rather than stacking fan-outs.
  const fetchStats = useCallback(async () => {
    if (statsInFlightRef.current) return statsInFlightRef.current;
    const run = runFetchStats();
    statsInFlightRef.current = run;
    try {
      await run;
    } finally {
      statsInFlightRef.current = null;
      lastStatsFetchRef.current = Date.now();
    }
    return undefined;
  }, [runFetchStats]);

  useEffect(() => {
    setLoading(true);
    fetchStats();
    // Fetch dashboard tab settings
    api.get("/settings/app").then(({ data }) => {
      setDashboardTabSettings(data.dashboardTabs && typeof data.dashboardTabs === "object" ? data.dashboardTabs : {});
    }).catch(() => { setDashboardTabSettings({}); });

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchStats();
    };
    const interval = setInterval(tick, STATS_POLL_MS);
    const onVisibility = () => {
      if (document.hidden) return;
      if (Date.now() - lastStatsFetchRef.current >= STATS_POLL_MS) fetchStats();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchStats]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const REFRESH_TARGETS = new Set([
      "submissions", "baselines", "facility", "slf-facilities", "slf-clients", "region3-lgu", "hauler-requests",
    ]);
    let refreshTimer = null;
    const onRefresh = ({ target } = {}) => {
      if (target && !REFRESH_TARGETS.has(target)) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        fetchStats();
      }, 800);
    };
    socket.on("data-refresh", onRefresh);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.off("data-refresh", onRefresh);
    };
  }, [fetchStats]);

  const fetchClientSummary = useCallback(async () => {
    try {
      const { data } = await api.get("/slf-clients/summary");
      setSlfClientSummary({
        lgu: data?.lgu || 0,
        private: data?.private || 0,
        total: data?.total || 0,
        loading: false,
        error: false,
      });
    } catch {
      setSlfClientSummary((prev) => ({ ...prev, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    fetchClientSummary();
    // Same visibility rule as the main stats poll — no point refreshing a tile
    // nobody is looking at.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchClientSummary();
    }, STATS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchClientSummary]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    let timer = null;
    const onRefresh = ({ target } = {}) => {
      if (target !== "slf-clients") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fetchClientSummary(); }, 800);
    };
    socket.on("data-refresh", onRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off("data-refresh", onRefresh);
    };
  }, [fetchClientSummary]);

  const statusColors = {
    pending: "#faad14",
    acknowledged: "#52c41a",
    rejected: "#ff4d4f",
  };
  const textColor = isDark ? "#e0e0e0" : "#1a3353";

  if (loading && !stats && !swmStats && !mrfStats && !lguMrfStats && !trapStats && !equipStats && !slfFacStats) {
    return <DashboardSkeleton isDark={isDark} />;
  }

  const pendingCount = stats?.byStatus?.pending || 0;
  const ackCount = stats?.byStatus?.acknowledged || 0;
  const rejCount = stats?.byStatus?.rejected || 0;
  const totalSub = stats?.submissions || 0;

  const months = (stats?.monthlyData || []).map((m) => ({
    label:
      dayjs()
        .month(m._id.month - 1)
        .format("MMM") +
      " " +
      m._id.year,
    count: m.count,
    volume: m.totalVolume,
  }));
  const maxCount = Math.max(...months.map((m) => m.count), 1);

  const recentColumns = [
    {
      title: "ID",
      dataIndex: "idNo",
      key: "idNo",
      render: (v) => <Tag>{v}</Tag>,
    },
    { title: "Company", dataIndex: "lguCompanyName", key: "lguCompanyName" },
    { title: "Type", dataIndex: "companyType", key: "companyType" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v) => (
        <Tag color={statusColors[v]}>
          {v?.charAt(0).toUpperCase() + v?.slice(1)}
        </Tag>
      ),
    },
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v) => dayjs(v).format("MM/DD/YYYY h:mm A"),
    },
  ];
  const statusChartData = Object.entries(stats?.byStatus || {}).map(([name, value]) => ({
    name: name ? name.charAt(0).toUpperCase() + name.slice(1) : "Unspecified",
    value,
  }));
  const companyTypeChartData = Object.entries(stats?.byCompanyType || {}).map(([name, value]) => ({
    name: name || "Unspecified",
    value,
  }));
  const wasteTypeChartData = (stats?.wasteByType || []).map((item) => ({
    name: item._id || "Unspecified",
    volume: Number(item.totalVolume || 0),
    count: item.count || 0,
  }));
  const monthlyChartData = months.map((item) => ({
    name: item.label,
    submissions: item.count,
    volume: Number(item.volume || 0),
  }));
  const chartPalette = ["#2f54eb", "#52c41a", "#faad14", "#ff4d4f", "#13c2c2", "#722ed1"];

  const CURRENT_YEAR = new Date().getFullYear();

  // Build tab items — only show tabs that have data
  const tabItems = [];

  // 10-Year SWM Plan tab
  if (swmStats && swmStats.totalRecords > 0) {
    const provList = swmStats.byProvinceList || [];
    const maxProvCount = Math.max(...provList.map((p) => p.count), 1);
    const divProv = swmStats.diversionByProvince || [];
    const wc = swmStats.wasteComposition || {};

    const CARD_H = 280;

    tabItems.push({
      key: "swm-plan",
      label: (
        <span>
          <FundProjectionScreenOutlined /> 10-Year SWM Plan
        </span>
      ),
      children: (
        <>
          {/* Row 1: Full-width stat tiles */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total LGUs"
                  value={swmStats.totalRecords}
                  prefix={<EnvironmentOutlined style={{ color: isDark ? "#a0b4c8" : "#1a3353" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Compliant"
                  value={swmStats.byCompliance?.Compliant || 0}
                  prefix={
                    <SafetyCertificateOutlined style={{ color: "#52c41a" }} />
                  }
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Non-Compliant"
                  value={swmStats.byCompliance?.["Non-Compliant"] || 0}
                  styles={{ content: { color: "#ff4d4f" } }}
                  prefix={<ClockCircleOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Avg. Diversion"
                  value={((wc.avgDiversionRate || 0) * 100).toFixed(1)}
                  suffix="%"
                  prefix={<RiseOutlined style={{ color: "#1890ff" }} />}
                />
              </Card>
            </Col>
          </Row>

          {/* Two-column layout: cards left, map right */}
          <Row gutter={[16, 16]}>
            {/* LEFT COLUMN — Stats cards */}
            <Col xs={24} lg={14}>
              <Row gutter={[16, 16]}>
                {/* Compliance Status */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <PieChartOutlined /> Compliance Status
                      </>
                    }
                    style={{ borderRadius: 10, height: CARD_H }}
                    loading={loading}
                    styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {[
                        {
                          label: "Compliant",
                          count: swmStats.byCompliance?.Compliant || 0,
                          color: "#52c41a",
                        },
                        {
                          label: "Non-Compliant",
                          count: swmStats.byCompliance?.["Non-Compliant"] || 0,
                          color: "#ff4d4f",
                        },
                        {
                          label: "Pending",
                          count: swmStats.byCompliance?.Pending || 0,
                          color: "#faad14",
                        },
                      ].map((s) => (
                        <div key={s.label}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text
                              style={{ color: isDark ? "#ccc" : undefined }}
                            >
                              {s.label}
                            </Text>
                            <Text
                              strong
                              style={{ color: isDark ? "#fff" : undefined }}
                            >
                              {s.count}{" "}
                              {swmStats.totalRecords > 0 && (
                                <span
                                  style={{ color: "#999", fontWeight: 400 }}
                                >
                                  (
                                  {Math.round(
                                    (s.count / swmStats.totalRecords) * 100,
                                  )}
                                  %)
                                </span>
                              )}
                            </Text>
                          </div>
                          <Progress
                            percent={
                              swmStats.totalRecords > 0
                                ? Math.round(
                                    (s.count / swmStats.totalRecords) * 100,
                                  )
                                : 0
                            }
                            strokeColor={s.color}
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Waste Composition */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> Waste Composition
                      </>
                    }
                    style={{ borderRadius: 10, height: CARD_H }}
                    loading={loading}
                    styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {[
                        {
                          label: "Biodegradable",
                          pct: (wc.avgBiodegradable || 0) * 100,
                          color: "#52c41a",
                        },
                        {
                          label: "Recyclable",
                          pct: (wc.avgRecyclable || 0) * 100,
                          color: "#1890ff",
                        },
                        {
                          label: "Residual",
                          pct: (wc.avgResidual || 0) * 100,
                          color: "#ff4d4f",
                        },
                        {
                          label: "Special",
                          pct: (wc.avgSpecial || 0) * 100,
                          color: "#722ed1",
                        },
                      ].map((w) => (
                        <div key={w.label}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text
                              style={{ color: isDark ? "#ccc" : undefined }}
                            >
                              {w.label}
                            </Text>
                            <Text
                              strong
                              style={{ color: isDark ? "#fff" : undefined }}
                            >
                              {w.pct.toFixed(1)}%
                            </Text>
                          </div>
                          <Progress
                            percent={Math.round(w.pct)}
                            strokeColor={w.color}
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* LGUs per Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> LGUs per Province
                      </>
                    }
                    style={{ borderRadius: 10, height: CARD_H }}
                    loading={loading}
                    styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        maxHeight: 170,
                        overflowY: "auto",
                        padding: "0 2px",
                      }}
                    >
                      {provList.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#aaa" : "#999",
                              minWidth: 70,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p._id}
                          </Text>
                          <div
                            style={{
                              flex: 1,
                              height: 16,
                              background: isDark ? "#2a2a2a" : "#f5f5f5",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max((p.count / maxProvCount) * 100, 4)}%`,
                                height: "100%",
                                background:
                                  "linear-gradient(90deg, #1a3353 0%, #4fc3f7 100%)",
                                borderRadius: "3px 0 0 3px",
                                transition: "width 0.5s ease",
                              }}
                            />
                          </div>
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#ccc" : "#666",
                              minWidth: 20,
                              textAlign: "right",
                              fontWeight: 600,
                            }}
                          >
                            {p.count}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Diversion Rate by Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <RiseOutlined /> Diversion by Province
                      </>
                    }
                    style={{ borderRadius: 10, height: CARD_H }}
                    loading={loading}
                    styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {divProv.slice(0, 7).map((d) => (
                        <div key={d._id}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 2,
                            }}
                          >
                            <Text
                              style={{
                                color: isDark ? "#ccc" : undefined,
                                fontSize: 12,
                              }}
                            >
                              {d._id}
                            </Text>
                            <Text
                              strong
                              style={{
                                color: isDark ? "#fff" : undefined,
                                fontSize: 12,
                              }}
                            >
                              {(d.avgDiversion * 100).toFixed(1)}%{" "}
                              <span
                                style={{
                                  color: "#999",
                                  fontWeight: 400,
                                  fontSize: 10,
                                }}
                              >
                                ({d.count})
                              </span>
                            </Text>
                          </div>
                          <Progress
                            percent={Math.round(d.avgDiversion * 100)}
                            strokeColor={
                              d.avgDiversion * 100 >= 50 ? "#52c41a" : "#faad14"
                            }
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Renewal Status */}
                <Col xs={24} sm={12}>
                  <Card
                    title="Renewal Status"
                    style={{ borderRadius: 10, height: CARD_H }}
                    loading={loading}
                    styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(swmStats.renewalStatus || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text
                                style={{ color: isDark ? "#ccc" : undefined }}
                              >
                                {key}
                              </Text>
                              <Text
                                strong
                                style={{ color: isDark ? "#fff" : undefined }}
                              >
                                {count}
                              </Text>
                            </div>
                            <Progress
                              percent={
                                swmStats.totalRecords > 0
                                  ? Math.round(
                                      (count / swmStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor={
                                key === "Approved"
                                  ? "#52c41a"
                                  : key === "For Renewal"
                                    ? "#faad14"
                                    : "#1890ff"
                              }
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>

                {/* Manila Bay Area */}
                <Col xs={24} sm={12}>
                  <Card
                    title="Manila Bay Area"
                    style={{ borderRadius: 10, height: CARD_H }}
                    loading={loading}
                    styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(swmStats.byManilaBayArea || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text
                                style={{ color: isDark ? "#ccc" : undefined }}
                              >
                                {key || "Unspecified"}
                              </Text>
                              <Text
                                strong
                                style={{ color: isDark ? "#fff" : undefined }}
                              >
                                {count}
                              </Text>
                            </div>
                            <Progress
                              percent={
                                swmStats.totalRecords > 0
                                  ? Math.round(
                                      (count / swmStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor={
                                key === "MBA" ? "#1890ff" : "#8c8c8c"
                              }
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>
              </Row>
            </Col>

            {/* RIGHT COLUMN — Map (sticky) */}
            <Col xs={24} lg={10}>
              <div
                style={{
                  position: "sticky",
                  top: 80,
                  height: CARD_H * 3 + 32,
                }}
              >
                <Card
                  size="small"
                  title={
                    <>
                      <GlobalOutlined /> LGU Location Map{" "}
                      <Tag bordered={false} color="blue">
                        {filteredMapPts.length} plotted
                      </Tag>
                      {filteredMapPts.length !== mapPts.length && (
                        <Tag bordered={false} color="default">
                          of {mapPts.length}
                        </Tag>
                      )}
                    </>
                  }
                  style={{ borderRadius: 10, height: "100%" }}
                  loading={loading}
                  extra={
                    <Space size={4}>
                      <Tooltip title="Street">
                        <Button
                          size="small"
                          type={tileKey === "street" ? "primary" : "default"}
                          icon={<GlobalOutlined />}
                          onClick={() => setTileKey("street")}
                        />
                      </Tooltip>
                      <Tooltip title="Satellite">
                        <Button
                          size="small"
                          type={tileKey === "satellite" ? "primary" : "default"}
                          icon={<EnvironmentOutlined />}
                          onClick={() => setTileKey("satellite")}
                        />
                      </Tooltip>
                      <Tooltip title="Terrain">
                        <Button
                          size="small"
                          type={tileKey === "terrain" ? "primary" : "default"}
                          icon={<FundOutlined />}
                          onClick={() => setTileKey("terrain")}
                        />
                      </Tooltip>
                      <Tooltip title="Dark">
                        <Button
                          size="small"
                          type={tileKey === "dark" ? "primary" : "default"}
                          icon={<AppstoreOutlined />}
                          onClick={() => setTileKey("dark")}
                        />
                      </Tooltip>
                    </Space>
                  }
                  styles={{
                    body: { padding: 0, height: "calc(100% - 100px)" },
                  }}
                >
                  {/* Filter bar */}
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "8px 10px",
                      background: isDark ? "#1f1f1f" : "#fafafa",
                      borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                      flexWrap: "wrap",
                    }}
                  >
                    <Select
                      size="small"
                      allowClear
                      placeholder="Province"
                      value={mapFilterProvince}
                      onChange={setMapFilterProvince}
                      options={provinceOptions}
                      style={{ minWidth: 120, flex: 1 }}
                    />
                    <Select
                      size="small"
                      allowClear
                      placeholder="Plan Status"
                      value={mapFilterStatus}
                      onChange={setMapFilterStatus}
                      options={[
                        { label: "✓ Approved", value: "Approved" },
                        { label: "▲ For Renewal", value: "For Renewal" },
                        { label: "● Other", value: "Other" },
                      ]}
                      style={{ minWidth: 110, flex: 1 }}
                    />
                    {(mapFilterProvince || mapFilterStatus) && (
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          setMapFilterProvince(null);
                          setMapFilterStatus(null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    {/* Legend */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "#999",
                      }}
                    >
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#52c41a",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Approved
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#faad14",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        For Renewal
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#8c8c8c",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Other
                      </span>
                    </div>
                  </div>
                  {filteredMapPts.length > 0 ? (
                    <MapContainer
                      center={[15.0, 120.7]}
                      zoom={8}
                      style={{
                        height: "100%",
                        width: "100%",
                        borderRadius: "0 0 10px 10px",
                      }}
                      scrollWheelZoom={true}
                      zoomControl={false}
                    >
                      <TileLayer
                        key={tileKey}
                        attribution={tile.attr}
                        url={tile.url}
                      />
                      <FitBounds points={filteredMapPts} />
                      <ProvinceBoundary
                        key={mapFilterProvince || "__none__"}
                        province={mapFilterProvince}
                      />
                      {filteredMapPts.map((pt, idx) => (
                        <Marker
                          key={pt.record._id || idx}
                          position={[pt.lat, pt.lng]}
                          icon={planStatusIcon(pt.record.forRenewal)}
                        >
                          <Popup maxWidth={320} minWidth={260}>
                            <div
                              className="popup-light"
                              style={{
                                fontSize: 12,
                                lineHeight: 1.7,
                                padding: 2,
                              }}
                            >
                              {/* Header */}
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  marginBottom: 2,
                                }}
                              >
                                {pt.record.municipality}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                                    color: "#1890ff",
                                    borderRadius: 4,
                                    padding: "1px 6px",
                                    fontSize: 11,
                                  }}
                                >
                                  <EnvironmentOutlined /> {pt.record.province}
                                </span>
                                {pt.record.congressionalDistrict && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background: isDark ? "#303030" : "#f0f0f0",
                                      color: "#595959",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    {pt.record.congressionalDistrict}
                                  </span>
                                )}
                                {pt.record.manilaBayArea && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background:
                                        pt.record.manilaBayArea === "MBA"
                                          ? (isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff")
                                          : (isDark ? "#303030" : "#f5f5f5"),
                                      color:
                                        pt.record.manilaBayArea === "MBA"
                                          ? "#1890ff"
                                          : "#8c8c8c",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    <GlobalOutlined /> {pt.record.manilaBayArea}
                                  </span>
                                )}
                              </div>
                              <hr
                                style={{
                                  margin: "4px 0 6px",
                                  border: "none",
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              />

                              {/* Compliance & Renewal */}
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                {(() => {
                                  const r =
                                    pt.record.remarksAndRecommendation || "";
                                  const isC =
                                    /compliant/i.test(r) && !/non/i.test(r);
                                  const isNC =
                                    /non/i.test(r) && /compliant/i.test(r);
                                  return (
                                    <span
                                      className={`status-badge ${isC ? "status-badge-compliant" : isNC ? "status-badge-noncompliant" : "status-badge-pending"}`}
                                    >
                                      <SafetyCertificateOutlined />{" "}
                                      {isC
                                        ? "Compliant"
                                        : isNC
                                          ? "Non-Compliant"
                                          : "Pending"}
                                    </span>
                                  );
                                })()}
                                {pt.record.forRenewal && (
                                  <span
                                    className={`status-badge ${/approved/i.test(pt.record.forRenewal) ? "status-badge-approved" : /renewal/i.test(pt.record.forRenewal) ? "status-badge-renewal" : "status-badge-other"}`}
                                  >
                                    <AuditOutlined /> {pt.record.forRenewal}
                                  </span>
                                )}
                              </div>

                              {/* Plan Info */}
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 3,
                                  marginBottom: 6,
                                }}
                              >
                                {pt.record.typeOfSWMPlan && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                    }}
                                  >
                                    <FileDoneOutlined
                                      style={{ color: "#1890ff" }}
                                    />{" "}
                                    <span style={{ color: "#595959" }}>
                                      Plan:
                                    </span>{" "}
                                    <strong>{pt.record.typeOfSWMPlan}</strong>
                                  </div>
                                )}
                                {pt.record.periodCovered && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                    }}
                                  >
                                    <ClockCircleOutlined
                                      style={{ color: "#722ed1" }}
                                    />{" "}
                                    <span style={{ color: "#595959" }}>
                                      Period:
                                    </span>{" "}
                                    {pt.record.periodCovered}
                                  </div>
                                )}
                                {pt.record.yearApproved && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                    }}
                                  >
                                    <AuditOutlined
                                      style={{ color: "#52c41a" }}
                                    />{" "}
                                    <span style={{ color: "#595959" }}>
                                      Approved:
                                    </span>{" "}
                                    {pt.record.yearApproved}
                                  </div>
                                )}
                              </div>

                              {/* Environmental Data */}
                              <div
                                style={{
                                  background: isDark ? "#1f1f1f" : "#fafafa",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  marginBottom: 6,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    marginBottom: 3,
                                  }}
                                >
                                  <span style={{ color: "#595959" }}>
                                    <BarChartOutlined
                                      style={{ color: "#1890ff" }}
                                    />{" "}
                                    Diversion Rate
                                  </span>
                                  <strong
                                    style={{
                                      color:
                                        pt.record.wasteDiversionRate >= 0.25
                                          ? "#52c41a"
                                          : "#ff4d4f",
                                    }}
                                  >
                                    {pt.record.wasteDiversionRate
                                      ? `${(pt.record.wasteDiversionRate * 100).toFixed(1)}%`
                                      : "—"}
                                  </strong>
                                </div>
                                {pt.record.totalWasteGeneration != null && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      marginBottom: 3,
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      <DeleteOutlined
                                        style={{ color: "#ff4d4f" }}
                                      />{" "}
                                      Waste Gen.
                                    </span>
                                    <strong>
                                      {pt.record.totalWasteGeneration.toLocaleString()}{" "}
                                      tons
                                    </strong>
                                  </div>
                                )}
                                {pt.record.pcg != null && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      <ExperimentOutlined
                                        style={{ color: "#722ed1" }}
                                      />{" "}
                                      PCG
                                    </span>
                                    <strong>{pt.record.pcg}</strong>
                                  </div>
                                )}
                              </div>

                              {/* Waste Composition mini bars */}
                              {(pt.record.biodegradablePercent ||
                                pt.record.recyclablePercent ||
                                pt.record.residualPercent ||
                                pt.record.specialPercent) && (
                                <div style={{ marginBottom: 6 }}>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: "#595959",
                                      marginBottom: 2,
                                      fontWeight: 600,
                                    }}
                                  >
                                    Waste Composition
                                  </div>
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: 2,
                                      height: 8,
                                      borderRadius: 4,
                                      overflow: "hidden",
                                    }}
                                  >
                                    {pt.record.biodegradablePercent > 0 && (
                                      <div
                                        title={`Biodegradable ${(pt.record.biodegradablePercent * 100).toFixed(1)}%`}
                                        style={{
                                          flex: pt.record.biodegradablePercent,
                                          background: "#52c41a",
                                        }}
                                      />
                                    )}
                                    {pt.record.recyclablePercent > 0 && (
                                      <div
                                        title={`Recyclable ${(pt.record.recyclablePercent * 100).toFixed(1)}%`}
                                        style={{
                                          flex: pt.record.recyclablePercent,
                                          background: "#1890ff",
                                        }}
                                      />
                                    )}
                                    {pt.record.residualPercent > 0 && (
                                      <div
                                        title={`Residual ${(pt.record.residualPercent * 100).toFixed(1)}%`}
                                        style={{
                                          flex: pt.record.residualPercent,
                                          background: "#ff4d4f",
                                        }}
                                      />
                                    )}
                                    {pt.record.specialPercent > 0 && (
                                      <div
                                        title={`Special ${(pt.record.specialPercent * 100).toFixed(1)}%`}
                                        style={{
                                          flex: pt.record.specialPercent,
                                          background: "#722ed1",
                                        }}
                                      />
                                    )}
                                  </div>
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: 8,
                                      fontSize: 10,
                                      color: "#999",
                                      marginTop: 2,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <span>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          width: 6,
                                          height: 6,
                                          borderRadius: 1,
                                          background: "#52c41a",
                                          marginRight: 2,
                                        }}
                                      />
                                      Bio{" "}
                                      {(
                                        pt.record.biodegradablePercent * 100
                                      ).toFixed(0)}
                                      %
                                    </span>
                                    <span>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          width: 6,
                                          height: 6,
                                          borderRadius: 1,
                                          background: "#1890ff",
                                          marginRight: 2,
                                        }}
                                      />
                                      Rec{" "}
                                      {(
                                        pt.record.recyclablePercent * 100
                                      ).toFixed(0)}
                                      %
                                    </span>
                                    <span>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          width: 6,
                                          height: 6,
                                          borderRadius: 1,
                                          background: "#ff4d4f",
                                          marginRight: 2,
                                        }}
                                      />
                                      Res{" "}
                                      {(
                                        pt.record.residualPercent * 100
                                      ).toFixed(0)}
                                      %
                                    </span>
                                    <span>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          width: 6,
                                          height: 6,
                                          borderRadius: 1,
                                          background: "#722ed1",
                                          marginRight: 2,
                                        }}
                                      />
                                      Spc{" "}
                                      {(pt.record.specialPercent * 100).toFixed(
                                        0,
                                      )}
                                      %
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* Disposal */}
                              {pt.record.lguFinalDisposal && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    marginBottom: 4,
                                  }}
                                >
                                  <ContainerOutlined
                                    style={{ color: "#fa8c16" }}
                                  />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Disposal:
                                  </span>{" "}
                                  {pt.record.lguFinalDisposal}
                                </div>
                              )}

                              {/* Personnel */}
                              <hr
                                style={{
                                  margin: "4px 0 5px",
                                  border: "none",
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              />
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                }}
                              >
                                {pt.record.focalPerson && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                    }}
                                  >
                                    <UserOutlined
                                      style={{ color: "#1890ff" }}
                                    />{" "}
                                    <span style={{ color: "#595959" }}>
                                      Focal:
                                    </span>{" "}
                                    <strong>{pt.record.focalPerson}</strong>
                                  </div>
                                )}
                                {pt.record.enmoAssigned && (
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                    }}
                                  >
                                    <TeamOutlined
                                      style={{ color: "#52c41a" }}
                                    />{" "}
                                    <span style={{ color: "#595959" }}>
                                      ENMO:
                                    </span>{" "}
                                    {pt.record.enmoAssigned}
                                  </div>
                                )}
                              </div>

                              {/* Remarks */}
                              {pt.record.remarksAndRecommendation && (
                                <div
                                  style={{
                                    marginTop: 6,
                                    background: isDark ? "rgba(250,219,20,0.15)" : "#fffbe6",
                                    borderRadius: 4,
                                    padding: "4px 6px",
                                    fontSize: 11,
                                    color: "#ad8b00",
                                  }}
                                >
                                  <AlertOutlined />{" "}
                                  {pt.record.remarksAndRecommendation}
                                </div>
                              )}

                              {/* Signed Document */}
                              {pt.record.signedDocument && (
                                <a
                                  href={pt.record.signedDocument}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    marginTop: 6,
                                    padding: "4px 8px",
                                    background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                                    borderRadius: 4,
                                    fontSize: 11,
                                    color: "#1890ff",
                                    textDecoration: "none",
                                    fontWeight: 600,
                                  }}
                                >
                                  <LinkOutlined /> View Signed Document
                                </a>
                              )}

                              {/* Quick Actions */}
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  marginTop: 8,
                                  paddingTop: 6,
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              >
                                <button
                                  onClick={() => {
                                    api
                                      .get(`/ten-year-swm/${pt.record._id}`)
                                      .then(({ data }) =>
                                        setMapViewRecord(data),
                                      )
                                      .catch(() => setMapViewRecord(pt.record));
                                  }}
                                  className="popup-action-btn"
                                  title="View Full Record"
                                >
                                  <EyeOutlined /> View
                                </button>
                                <button
                                  onClick={() => {
                                    const txt = `${pt.record.municipality}, ${pt.record.province} (${pt.lat}, ${pt.lng})`;
                                    navigator.clipboard.writeText(txt);
                                  }}
                                  className="popup-action-btn"
                                  title="Copy Location"
                                >
                                  <CopyOutlined /> Copy
                                </button>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                    </MapContainer>
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text type="secondary">No coordinate data available</Text>
                    </div>
                  )}
                </Card>
              </div>
            </Col>
          </Row>
        </>
      ),
    });
  }

  // Funded MRF tab
  if (mrfStats && mrfStats.totalRecords > 0) {
    const mrfProvList = mrfStats.byProvinceList || [];
    const mrfMaxProvCount = Math.max(...mrfProvList.map((p) => p.count), 1);
    const mrfDivProv = mrfStats.diversionByProvince || [];
    const fs = mrfStats.fundingStats || {};
    const opCount = mrfStats.byStatus?.Operational || 0;
    const nonOpCount = mrfStats.byStatus?.["Non-Operational"] || 0;
    const opRate =
      mrfStats.totalRecords > 0 ? (opCount / mrfStats.totalRecords) * 100 : 0;
    const avgDiv = (fs.avgDiversionRate || 0) * 100;

    const MRF_CARD_H = 280;

    tabItems.push({
      key: "funded-mrf",
      label: (
        <span>
          <BankOutlined /> Funded MRF
        </span>
      ),
      children: (
        <>
          {/* Row 1: Stat tiles */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total MRFs"
                  value={mrfStats.totalRecords}
                  prefix={<BankOutlined style={{ color: isDark ? "#a0b4c8" : "#1a3353" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Operational"
                  value={opCount}
                  prefix={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Non-Operational"
                  value={nonOpCount}
                  styles={{ content: { color: "#ff4d4f" } }}
                  prefix={<CloseCircleOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total Funding"
                  value={fs.totalFunding || 0}
                  prefix={
                    <span
                      style={{
                        color: "#faad14",
                        fontWeight: 700,
                        fontSize: 18,
                      }}
                    >
                      ₱
                    </span>
                  }
                  formatter={(v) => Number(v).toLocaleString()}
                />
              </Card>
            </Col>
          </Row>

          {/* Two-column layout: cards left, map right */}
          <Row gutter={[16, 16]}>
            {/* LEFT COLUMN — Stats cards */}
            <Col xs={24} lg={14}>
              <Row gutter={[16, 16]}>
                {/* Operational Status */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <PieChartOutlined /> Operational Status
                      </>
                    }
                    style={{ borderRadius: 10, height: MRF_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: MRF_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {[
                        {
                          label: "Operational",
                          count: opCount,
                          color: "#52c41a",
                          icon: <CheckCircleOutlined />,
                        },
                        {
                          label: "Non-Operational",
                          count: nonOpCount,
                          color: "#ff4d4f",
                          icon: <CloseCircleOutlined />,
                        },
                        {
                          label: "Not Yet Monitored",
                          count: mrfStats.byStatus?.["Not Yet Monitored"] || 0,
                          color: "#d9d9d9",
                          icon: <ClockCircleOutlined />,
                        },
                      ].map((s) => (
                        <div key={s.label}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text>{s.label}</Text>
                            <Text strong>
                              {s.count}{" "}
                              <span style={{ color: "#999", fontWeight: 400 }}>
                                (
                                {mrfStats.totalRecords > 0
                                  ? Math.round(
                                      (s.count / mrfStats.totalRecords) * 100,
                                    )
                                  : 0}
                                %)
                              </span>
                            </Text>
                          </div>
                          <Progress
                            percent={
                              mrfStats.totalRecords > 0
                                ? Math.round(
                                    (s.count / mrfStats.totalRecords) * 100,
                                  )
                                : 0
                            }
                            strokeColor={s.color}
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Key Metrics — Enhanced */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> Key Metrics
                      </>
                    }
                    style={{ borderRadius: 10, height: MRF_CARD_H }}
                    loading={loading}
                    styles={{
                      body: {
                        overflow: "auto",
                        height: MRF_CARD_H - 57,
                        padding: "12px 16px",
                      },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      {/* Operational Rate with circular progress */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "6px 10px",
                          background:
                            isDark ? "linear-gradient(135deg, rgba(82,196,26,0.12) 0%, rgba(250,219,20,0.08) 100%)" : "linear-gradient(135deg, #f6ffed 0%, #fcffe6 100%)",
                          borderRadius: 8,
                          border: isDark ? "1px solid rgba(82,196,26,0.3)" : "1px solid #d9f7be",
                        }}
                      >
                        <Progress
                          type="circle"
                          percent={Math.round(opRate)}
                          size={48}
                          strokeColor={{ "0%": "#52c41a", "100%": "#95de64" }}
                          format={(p) => (
                            <span style={{ fontSize: 12, fontWeight: 700 }}>
                              {p}%
                            </span>
                          )}
                        />
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Operational Rate
                          </Text>
                          <br />
                          <Text
                            strong
                            style={{ fontSize: 16, color: "#389e0d" }}
                          >
                            {opRate.toFixed(1)}%
                          </Text>
                        </div>
                      </div>
                      {/* Avg Diversion Rate with circular progress */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "6px 10px",
                          background:
                            isDark ? "linear-gradient(135deg, rgba(22,119,255,0.12) 0%, rgba(47,84,235,0.08) 100%)" : "linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)",
                          borderRadius: 8,
                          border: isDark ? "1px solid rgba(22,119,255,0.3)" : "1px solid #bae7ff",
                        }}
                      >
                        <Progress
                          type="circle"
                          percent={Math.round(avgDiv)}
                          size={48}
                          strokeColor={{ "0%": "#1890ff", "100%": "#69c0ff" }}
                          format={(p) => (
                            <span style={{ fontSize: 12, fontWeight: 700 }}>
                              {p}%
                            </span>
                          )}
                        />
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Avg. Diversion Rate
                          </Text>
                          <br />
                          <Text
                            strong
                            style={{ fontSize: 16, color: "#096dd9" }}
                          >
                            {avgDiv.toFixed(1)}%
                          </Text>
                        </div>
                      </div>
                      {/* Bottom stats row */}
                      <Row gutter={8}>
                        <Col span={8}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "6px 4px",
                              background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff",
                              borderRadius: 6,
                              border: isDark ? "1px solid rgba(114,46,209,0.3)" : "1px solid #efdbff",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Brgys Served
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#722ed1" }}
                            >
                              {(fs.totalBrgyServed || 0).toLocaleString()}
                            </Text>
                          </div>
                        </Col>
                        <Col span={8}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "6px 4px",
                              background: isDark ? "rgba(250,173,20,0.15)" : "#fff7e6",
                              borderRadius: 6,
                              border: isDark ? "1px solid rgba(250,173,20,0.3)" : "1px solid #ffe7ba",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Avg. Funding
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#d48806" }}
                            >
                              ₱{Math.round(fs.avgFunding || 0).toLocaleString()}
                            </Text>
                          </div>
                        </Col>
                        <Col span={8}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "6px 4px",
                              background: isDark ? "rgba(255,77,79,0.15)" : "#fff1f0",
                              borderRadius: 6,
                              border: isDark ? "1px solid rgba(255,77,79,0.3)" : "1px solid #ffccc7",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Waste Gen.
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#cf1322" }}
                            >
                              {(fs.totalWasteGen || 0).toLocaleString()}
                            </Text>
                          </div>
                        </Col>
                      </Row>
                    </div>
                  </Card>
                </Col>

                {/* MRFs per Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> MRFs per Province
                      </>
                    }
                    style={{ borderRadius: 10, height: MRF_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: MRF_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        maxHeight: 170,
                        overflowY: "auto",
                        padding: "0 2px",
                      }}
                    >
                      {mrfProvList.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#aaa" : "#999",
                              minWidth: 70,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p._id}
                          </Text>
                          <div
                            style={{
                              flex: 1,
                              height: 16,
                              background: isDark ? "#2a2a2a" : "#f5f5f5",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max((p.count / mrfMaxProvCount) * 100, 4)}%`,
                                height: "100%",
                                background:
                                  "linear-gradient(90deg, #2f54eb 0%, #85a5ff 100%)",
                                borderRadius: "3px 0 0 3px",
                                transition: "width 0.5s ease",
                              }}
                            />
                          </div>
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#ccc" : "#666",
                              minWidth: 20,
                              textAlign: "right",
                              fontWeight: 600,
                            }}
                          >
                            {p.count}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Diversion Rate by Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <RiseOutlined /> Diversion by Province
                      </>
                    }
                    style={{ borderRadius: 10, height: MRF_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: MRF_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {mrfDivProv.slice(0, 7).map((d) => (
                        <div key={d._id}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 2,
                            }}
                          >
                            <Text style={{ fontSize: 12 }}>{d._id}</Text>
                            <Text strong style={{ fontSize: 12 }}>
                              {(d.avgDiversion * 100).toFixed(1)}%{" "}
                              <span
                                style={{
                                  color: "#999",
                                  fontWeight: 400,
                                  fontSize: 10,
                                }}
                              >
                                ({d.count})
                              </span>
                            </Text>
                          </div>
                          <Progress
                            percent={Math.round(d.avgDiversion * 100)}
                            strokeColor={
                              d.avgDiversion * 100 >= 50 ? "#52c41a" : "#faad14"
                            }
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* MRF Type Distribution */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BankOutlined /> MRF Type
                      </>
                    }
                    style={{ borderRadius: 10, height: MRF_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: MRF_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(mrfStats.byMRFType || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text>{key || "Unspecified"}</Text>
                              <Text strong>{count}</Text>
                            </div>
                            <Progress
                              percent={
                                mrfStats.totalRecords > 0
                                  ? Math.round(
                                      (count / mrfStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor="#2f54eb"
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>

                {/* Manila Bay Area */}
                <Col xs={24} sm={12}>
                  <Card
                    title="Manila Bay Area"
                    style={{ borderRadius: 10, height: MRF_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: MRF_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(mrfStats.byManilaBayArea || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text>{key || "Unspecified"}</Text>
                              <Text strong>{count}</Text>
                            </div>
                            <Progress
                              percent={
                                mrfStats.totalRecords > 0
                                  ? Math.round(
                                      (count / mrfStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor={
                                key === "MBA" ? "#1890ff" : "#8c8c8c"
                              }
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>
              </Row>
            </Col>

            {/* RIGHT COLUMN — MRF Map (sticky) */}
            <Col xs={24} lg={10}>
              <div
                style={{
                  position: "sticky",
                  top: 80,
                  height: MRF_CARD_H * 3 + 32,
                }}
              >
                <Card
                  size="small"
                  title={
                    <>
                      <GlobalOutlined /> MRF Location Map{" "}
                      <Tag bordered={false} color="blue">
                        {filteredMrfMapPts.length} plotted
                      </Tag>
                      {filteredMrfMapPts.length !== mrfMapPts.length && (
                        <Tag bordered={false} color="default">
                          of {mrfMapPts.length}
                        </Tag>
                      )}
                    </>
                  }
                  style={{ borderRadius: 10, height: "100%" }}
                  loading={loading}
                  extra={
                    <Space size={4}>
                      <Tooltip title="Street">
                        <Button
                          size="small"
                          type={mrfTileKey === "street" ? "primary" : "default"}
                          icon={<GlobalOutlined />}
                          onClick={() => setMrfTileKey("street")}
                        />
                      </Tooltip>
                      <Tooltip title="Satellite">
                        <Button
                          size="small"
                          type={
                            mrfTileKey === "satellite" ? "primary" : "default"
                          }
                          icon={<EnvironmentOutlined />}
                          onClick={() => setMrfTileKey("satellite")}
                        />
                      </Tooltip>
                      <Tooltip title="Terrain">
                        <Button
                          size="small"
                          type={
                            mrfTileKey === "terrain" ? "primary" : "default"
                          }
                          icon={<FundOutlined />}
                          onClick={() => setMrfTileKey("terrain")}
                        />
                      </Tooltip>
                      <Tooltip title="Dark">
                        <Button
                          size="small"
                          type={mrfTileKey === "dark" ? "primary" : "default"}
                          icon={<AppstoreOutlined />}
                          onClick={() => setMrfTileKey("dark")}
                        />
                      </Tooltip>
                    </Space>
                  }
                  styles={{
                    body: { padding: 0, height: "calc(100% - 100px)" },
                  }}
                >
                  {/* Filter bar */}
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "8px 10px",
                      background: isDark ? "#1f1f1f" : "#fafafa",
                      borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                      flexWrap: "wrap",
                    }}
                  >
                    <Select
                      size="small"
                      allowClear
                      placeholder="Province"
                      value={mrfFilterProvince}
                      onChange={setMrfFilterProvince}
                      options={mrfProvinceOptions}
                      style={{ minWidth: 120, flex: 1 }}
                    />
                    <Select
                      size="small"
                      allowClear
                      placeholder="Status"
                      value={mrfFilterStatus}
                      onChange={setMrfFilterStatus}
                      options={[
                        { label: "✓ Operational", value: "Operational" },
                        {
                          label: "✕ Non-Operational",
                          value: "Non-Operational",
                        },
                      ]}
                      style={{ minWidth: 130, flex: 1 }}
                    />
                    {(mrfFilterProvince || mrfFilterStatus) && (
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          setMrfFilterProvince(null);
                          setMrfFilterStatus(null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    {/* Legend */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "#999",
                      }}
                    >
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#52c41a",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Operational
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#ff4d4f",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Non-Op
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#8c8c8c",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Not Yet Monitored
                      </span>
                    </div>
                  </div>
                  {filteredMrfMapPts.length > 0 ? (
                    <MapContainer
                      center={[15.0, 120.7]}
                      zoom={8}
                      style={{
                        height: "100%",
                        width: "100%",
                        borderRadius: "0 0 10px 10px",
                      }}
                      scrollWheelZoom={true}
                      zoomControl={false}
                    >
                      <TileLayer
                        key={mrfTileKey}
                        attribution={mrfTile.attr}
                        url={mrfTile.url}
                      />
                      <FitBounds points={filteredMrfMapPts} />
                      <ProvinceBoundary
                        key={mrfFilterProvince || "__mrf_none__"}
                        province={mrfFilterProvince}
                      />
                      {filteredMrfMapPts.map((pt, idx) => (
                        <Marker
                          key={pt.record._id || idx}
                          position={[pt.lat, pt.lng]}
                          icon={mrfStatusIcon(pt.record.statusOfMRF)}
                        >
                          <Popup maxWidth={300} minWidth={240}>
                            <div
                              className="popup-light"
                              style={{
                                fontSize: 12,
                                lineHeight: 1.7,
                                padding: 2,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  marginBottom: 2,
                                }}
                              >
                                {pt.record.municipality}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                                    color: "#1890ff",
                                    borderRadius: 4,
                                    padding: "1px 6px",
                                    fontSize: 11,
                                  }}
                                >
                                  <EnvironmentOutlined /> {pt.record.province}
                                </span>
                                {pt.record.barangay && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background: isDark ? "#303030" : "#f0f0f0",
                                      color: "#595959",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    {pt.record.barangay}
                                  </span>
                                )}
                                {pt.record.manilaBayArea && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background:
                                        pt.record.manilaBayArea === "MBA"
                                          ? (isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff")
                                          : (isDark ? "#303030" : "#f5f5f5"),
                                      color:
                                        pt.record.manilaBayArea === "MBA"
                                          ? "#1890ff"
                                          : "#8c8c8c",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    <GlobalOutlined /> {pt.record.manilaBayArea}
                                  </span>
                                )}
                              </div>
                              <hr
                                style={{
                                  margin: "4px 0 6px",
                                  border: "none",
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              />
                              {pt.record.typeOfMRF && (
                                <div style={{ marginBottom: 4 }}>
                                  <BankOutlined style={{ color: "#2f54eb" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Type:
                                  </span>{" "}
                                  <strong>{pt.record.typeOfMRF}</strong>
                                </div>
                              )}
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                {(() => {
                                  const s = pt.record.statusOfMRF;
                                  const isOp =
                                    /operational/i.test(s) && !/non/i.test(s);
                                  const isNon = /non/i.test(s);
                                  return (
                                    <span
                                      className={`status-badge ${isOp ? "status-badge-compliant" : isNon ? "status-badge-noncompliant" : "status-badge-pending"}`}
                                    >
                                      <SafetyCertificateOutlined />{" "}
                                      {isOp
                                        ? "Operational"
                                        : isNon
                                          ? "Non-Operational"
                                          : "Not Yet Monitored"}
                                    </span>
                                  );
                                })()}
                              </div>
                              <div
                                style={{
                                  background: isDark ? "#1f1f1f" : "#fafafa",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  marginBottom: 6,
                                }}
                              >
                                {pt.record.amountGranted != null && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      marginBottom: 3,
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      <span
                                        style={{
                                          color: "#faad14",
                                          fontWeight: 700,
                                        }}
                                      >
                                        ₱
                                      </span>{" "}
                                      Funding
                                    </span>
                                    <strong>
                                      ₱
                                      {pt.record.amountGranted.toLocaleString()}
                                    </strong>
                                  </div>
                                )}
                                {pt.record.yearGranted && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      marginBottom: 3,
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      <CalendarOutlined
                                        style={{ color: "#722ed1" }}
                                      />{" "}
                                      Year
                                    </span>
                                    <strong>{pt.record.yearGranted}</strong>
                                  </div>
                                )}
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <span style={{ color: "#595959" }}>
                                    <BarChartOutlined
                                      style={{ color: "#1890ff" }}
                                    />{" "}
                                    Diversion
                                  </span>
                                  <strong
                                    style={{
                                      color:
                                        pt.record.wasteDiversionRate >= 0.25
                                          ? "#52c41a"
                                          : "#ff4d4f",
                                    }}
                                  >
                                    {pt.record.wasteDiversionRate
                                      ? `${(pt.record.wasteDiversionRate * 100).toFixed(1)}%`
                                      : "—"}
                                  </strong>
                                </div>
                              </div>
                              {pt.record.focalPerson && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    marginBottom: 2,
                                  }}
                                >
                                  <UserOutlined style={{ color: "#1890ff" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Focal:
                                  </span>{" "}
                                  <strong>{pt.record.focalPerson}</strong>
                                </div>
                              )}
                              {pt.record.enmoAssigned && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                  }}
                                >
                                  <TeamOutlined style={{ color: "#52c41a" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    ENMO:
                                  </span>{" "}
                                  {pt.record.enmoAssigned}
                                </div>
                              )}
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                    </MapContainer>
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text type="secondary">No coordinate data available</Text>
                    </div>
                  )}
                </Card>
              </div>
            </Col>
          </Row>
        </>
      ),
    });
  }

  // LGU Initiated MRF tab
  if (lguMrfStats && lguMrfStats.totalRecords > 0) {
    const lguProvList = lguMrfStats.byProvinceList || [];
    const lguMaxProvCount = Math.max(...lguProvList.map((p) => p.count), 1);
    const lguDivProv = lguMrfStats.diversionByProvince || [];
    const lfs = lguMrfStats.fundingStats || {};
    const lguOpCount = lguMrfStats.byStatus?.Operational || 0;
    const lguNonOpCount = lguMrfStats.byStatus?.["Non-Operational"] || 0;
    const lguOpRate =
      lguMrfStats.totalRecords > 0
        ? (lguOpCount / lguMrfStats.totalRecords) * 100
        : 0;
    const lguAvgDiv = (lfs.avgDiversionRate || 0) * 100;

    const LGU_CARD_H = 280;

    tabItems.push({
      key: "lgu-mrf",
      label: (
        <span>
          <ApartmentOutlined /> LGU Initiated MRF
        </span>
      ),
      children: (
        <>
          {/* Row 1: Stat tiles */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total LGU MRFs"
                  value={lguMrfStats.totalRecords}
                  prefix={<ApartmentOutlined style={{ color: "#13c2c2" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Operational"
                  value={lguOpCount}
                  prefix={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Non-Operational"
                  value={lguNonOpCount}
                  styles={{ content: { color: "#ff4d4f" } }}
                  prefix={<CloseCircleOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total Est. Cost"
                  value={lfs.totalCost || 0}
                  prefix={
                    <span
                      style={{
                        color: "#722ed1",
                        fontWeight: 700,
                        fontSize: 18,
                      }}
                    >
                      ₱
                    </span>
                  }
                  formatter={(v) => Number(v).toLocaleString()}
                />
              </Card>
            </Col>
          </Row>

          {/* Two-column layout: cards left, map right */}
          <Row gutter={[16, 16]}>
            {/* LEFT COLUMN — Stats cards */}
            <Col xs={24} lg={14}>
              <Row gutter={[16, 16]}>
                {/* Operational Status */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <PieChartOutlined /> Operational Status
                      </>
                    }
                    style={{ borderRadius: 10, height: LGU_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: LGU_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {[
                        {
                          label: "Operational",
                          count: lguOpCount,
                          color: "#52c41a",
                          icon: <CheckCircleOutlined />,
                        },
                        {
                          label: "Non-Operational",
                          count: lguNonOpCount,
                          color: "#ff4d4f",
                          icon: <CloseCircleOutlined />,
                        },
                        {
                          label: "Not Yet Monitored",
                          count:
                            lguMrfStats.byStatus?.["Not Yet Monitored"] || 0,
                          color: "#d9d9d9",
                          icon: <ClockCircleOutlined />,
                        },
                      ].map((s) => (
                        <div key={s.label}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text>{s.label}</Text>
                            <Text strong>
                              {s.count}{" "}
                              <span style={{ color: "#999", fontWeight: 400 }}>
                                (
                                {lguMrfStats.totalRecords > 0
                                  ? Math.round(
                                      (s.count / lguMrfStats.totalRecords) *
                                        100,
                                    )
                                  : 0}
                                %)
                              </span>
                            </Text>
                          </div>
                          <Progress
                            percent={
                              lguMrfStats.totalRecords > 0
                                ? Math.round(
                                    (s.count / lguMrfStats.totalRecords) * 100,
                                  )
                                : 0
                            }
                            strokeColor={s.color}
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Key Metrics */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> Key Metrics
                      </>
                    }
                    style={{ borderRadius: 10, height: LGU_CARD_H }}
                    loading={loading}
                    styles={{
                      body: {
                        overflow: "auto",
                        height: LGU_CARD_H - 57,
                        padding: "12px 16px",
                      },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "6px 10px",
                          background:
                            isDark ? "linear-gradient(135deg, rgba(82,196,26,0.12) 0%, rgba(250,219,20,0.08) 100%)" : "linear-gradient(135deg, #f6ffed 0%, #fcffe6 100%)",
                          borderRadius: 8,
                          border: isDark ? "1px solid rgba(82,196,26,0.3)" : "1px solid #d9f7be",
                        }}
                      >
                        <Progress
                          type="circle"
                          percent={Math.round(lguOpRate)}
                          size={48}
                          strokeColor={{ "0%": "#52c41a", "100%": "#95de64" }}
                          format={(p) => (
                            <span style={{ fontSize: 12, fontWeight: 700 }}>
                              {p}%
                            </span>
                          )}
                        />
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Operational Rate
                          </Text>
                          <br />
                          <Text
                            strong
                            style={{ fontSize: 16, color: "#389e0d" }}
                          >
                            {lguOpRate.toFixed(1)}%
                          </Text>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "6px 10px",
                          background:
                            isDark ? "linear-gradient(135deg, rgba(22,119,255,0.12) 0%, rgba(47,84,235,0.08) 100%)" : "linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)",
                          borderRadius: 8,
                          border: isDark ? "1px solid rgba(22,119,255,0.3)" : "1px solid #bae7ff",
                        }}
                      >
                        <Progress
                          type="circle"
                          percent={Math.round(lguAvgDiv)}
                          size={48}
                          strokeColor={{ "0%": "#1890ff", "100%": "#69c0ff" }}
                          format={(p) => (
                            <span style={{ fontSize: 12, fontWeight: 700 }}>
                              {p}%
                            </span>
                          )}
                        />
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Avg. Diversion Rate
                          </Text>
                          <br />
                          <Text
                            strong
                            style={{ fontSize: 16, color: "#096dd9" }}
                          >
                            {lguAvgDiv.toFixed(1)}%
                          </Text>
                        </div>
                      </div>
                      <Row gutter={8}>
                        <Col span={12}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "6px 4px",
                              background: isDark ? "rgba(19,194,194,0.15)" : "#e6fffb",
                              borderRadius: 6,
                              border: "1px solid #87e8de",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Brgys Served
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#13c2c2" }}
                            >
                              {(lfs.totalBrgyServed || 0).toLocaleString()}
                            </Text>
                          </div>
                        </Col>
                        <Col span={12}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "6px 4px",
                              background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff",
                              borderRadius: 6,
                              border: isDark ? "1px solid rgba(114,46,209,0.3)" : "1px solid #efdbff",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Avg. Cost
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#722ed1" }}
                            >
                              ₱{Math.round(lfs.avgCost || 0).toLocaleString()}
                            </Text>
                          </div>
                        </Col>
                      </Row>
                    </div>
                  </Card>
                </Col>

                {/* MRFs per Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> LGU MRFs per Province
                      </>
                    }
                    style={{ borderRadius: 10, height: LGU_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: LGU_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        maxHeight: 170,
                        overflowY: "auto",
                        padding: "0 2px",
                      }}
                    >
                      {lguProvList.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#aaa" : "#999",
                              minWidth: 70,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p._id}
                          </Text>
                          <div
                            style={{
                              flex: 1,
                              height: 16,
                              background: isDark ? "#2a2a2a" : "#f5f5f5",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max((p.count / lguMaxProvCount) * 100, 4)}%`,
                                height: "100%",
                                background:
                                  "linear-gradient(90deg, #13c2c2 0%, #87e8de 100%)",
                                borderRadius: "3px 0 0 3px",
                                transition: "width 0.5s ease",
                              }}
                            />
                          </div>
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#ccc" : "#666",
                              minWidth: 20,
                              textAlign: "right",
                              fontWeight: 600,
                            }}
                          >
                            {p.count}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Diversion Rate by Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <RiseOutlined /> Diversion by Province
                      </>
                    }
                    style={{ borderRadius: 10, height: LGU_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: LGU_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {lguDivProv.slice(0, 7).map((d) => (
                        <div key={d._id}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 2,
                            }}
                          >
                            <Text style={{ fontSize: 12 }}>{d._id}</Text>
                            <Text strong style={{ fontSize: 12 }}>
                              {(d.avgDiversion * 100).toFixed(1)}%{" "}
                              <span
                                style={{
                                  color: "#999",
                                  fontWeight: 400,
                                  fontSize: 10,
                                }}
                              >
                                ({d.count})
                              </span>
                            </Text>
                          </div>
                          <Progress
                            percent={Math.round(d.avgDiversion * 100)}
                            strokeColor={
                              d.avgDiversion * 100 >= 50 ? "#52c41a" : "#faad14"
                            }
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* MRF Type Distribution */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <ApartmentOutlined /> MRF Type
                      </>
                    }
                    style={{ borderRadius: 10, height: LGU_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: LGU_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(lguMrfStats.byMRFType || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text>{key || "Unspecified"}</Text>
                              <Text strong>{count}</Text>
                            </div>
                            <Progress
                              percent={
                                lguMrfStats.totalRecords > 0
                                  ? Math.round(
                                      (count / lguMrfStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor="#13c2c2"
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>

                {/* Manila Bay Area */}
                <Col xs={24} sm={12}>
                  <Card
                    title="Manila Bay Area"
                    style={{ borderRadius: 10, height: LGU_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: LGU_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(lguMrfStats.byManilaBayArea || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text>{key || "Unspecified"}</Text>
                              <Text strong>{count}</Text>
                            </div>
                            <Progress
                              percent={
                                lguMrfStats.totalRecords > 0
                                  ? Math.round(
                                      (count / lguMrfStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor={
                                key === "MBA" ? "#1890ff" : "#8c8c8c"
                              }
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>
              </Row>
            </Col>

            {/* RIGHT COLUMN — LGU MRF Map (sticky) */}
            <Col xs={24} lg={10}>
              <div
                style={{
                  position: "sticky",
                  top: 80,
                  height: LGU_CARD_H * 3 + 32,
                }}
              >
                <Card
                  size="small"
                  title={
                    <>
                      <GlobalOutlined /> LGU MRF Location Map{" "}
                      <Tag bordered={false} color="cyan">
                        {filteredLguMapPts.length} plotted
                      </Tag>
                      {filteredLguMapPts.length !== lguMapPts.length && (
                        <Tag bordered={false} color="default">
                          of {lguMapPts.length}
                        </Tag>
                      )}
                    </>
                  }
                  style={{ borderRadius: 10, height: "100%" }}
                  loading={loading}
                  extra={
                    <Space size={4}>
                      <Tooltip title="Street">
                        <Button
                          size="small"
                          type={lguTileKey === "street" ? "primary" : "default"}
                          icon={<GlobalOutlined />}
                          onClick={() => setLguTileKey("street")}
                        />
                      </Tooltip>
                      <Tooltip title="Satellite">
                        <Button
                          size="small"
                          type={
                            lguTileKey === "satellite" ? "primary" : "default"
                          }
                          icon={<EnvironmentOutlined />}
                          onClick={() => setLguTileKey("satellite")}
                        />
                      </Tooltip>
                      <Tooltip title="Terrain">
                        <Button
                          size="small"
                          type={
                            lguTileKey === "terrain" ? "primary" : "default"
                          }
                          icon={<FundOutlined />}
                          onClick={() => setLguTileKey("terrain")}
                        />
                      </Tooltip>
                      <Tooltip title="Dark">
                        <Button
                          size="small"
                          type={lguTileKey === "dark" ? "primary" : "default"}
                          icon={<AppstoreOutlined />}
                          onClick={() => setLguTileKey("dark")}
                        />
                      </Tooltip>
                    </Space>
                  }
                  styles={{
                    body: { padding: 0, height: "calc(100% - 100px)" },
                  }}
                >
                  {/* Filter bar */}
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "8px 10px",
                      background: isDark ? "#1f1f1f" : "#fafafa",
                      borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                      flexWrap: "wrap",
                    }}
                  >
                    <Select
                      size="small"
                      allowClear
                      placeholder="Province"
                      value={lguFilterProvince}
                      onChange={setLguFilterProvince}
                      options={lguProvinceOptions}
                      style={{ minWidth: 120, flex: 1 }}
                    />
                    <Select
                      size="small"
                      allowClear
                      placeholder="Status"
                      value={lguFilterStatus}
                      onChange={setLguFilterStatus}
                      options={[
                        { label: "\u2713 Operational", value: "Operational" },
                        {
                          label: "\u2715 Non-Operational",
                          value: "Non-Operational",
                        },
                      ]}
                      style={{ minWidth: 130, flex: 1 }}
                    />
                    {(lguFilterProvince || lguFilterStatus) && (
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          setLguFilterProvince(null);
                          setLguFilterStatus(null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    {/* Legend */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "#999",
                      }}
                    >
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#52c41a",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Operational
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#ff4d4f",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Non-Op
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#8c8c8c",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Not Yet Monitored
                      </span>
                    </div>
                  </div>
                  {filteredLguMapPts.length > 0 ? (
                    <MapContainer
                      center={[15.0, 120.7]}
                      zoom={8}
                      style={{
                        height: "100%",
                        width: "100%",
                        borderRadius: "0 0 10px 10px",
                      }}
                      scrollWheelZoom={true}
                      zoomControl={false}
                    >
                      <TileLayer
                        key={lguTileKey}
                        attribution={TILE_LAYERS[lguTileKey].attr}
                        url={TILE_LAYERS[lguTileKey].url}
                      />
                      <FitBounds points={filteredLguMapPts} />
                      <ProvinceBoundary
                        key={lguFilterProvince || "__lgu_none__"}
                        province={lguFilterProvince}
                      />
                      {filteredLguMapPts.map((pt, idx) => (
                        <Marker
                          key={pt.record._id || idx}
                          position={[pt.lat, pt.lng]}
                          icon={mrfStatusIcon(pt.record.statusOfMRF)}
                        >
                          <Popup maxWidth={300} minWidth={240}>
                            <div
                              className="popup-light"
                              style={{
                                fontSize: 12,
                                lineHeight: 1.7,
                                padding: 2,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  marginBottom: 2,
                                }}
                              >
                                {pt.record.municipality}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    background: isDark ? "rgba(19,194,194,0.15)" : "#e6fffb",
                                    color: "#13c2c2",
                                    borderRadius: 4,
                                    padding: "1px 6px",
                                    fontSize: 11,
                                  }}
                                >
                                  <EnvironmentOutlined /> {pt.record.province}
                                </span>
                                {pt.record.barangay && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background: isDark ? "#303030" : "#f0f0f0",
                                      color: "#595959",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    {pt.record.barangay}
                                  </span>
                                )}
                                {pt.record.manilaBayArea && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background:
                                        pt.record.manilaBayArea === "MBA"
                                          ? (isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff")
                                          : (isDark ? "#303030" : "#f5f5f5"),
                                      color:
                                        pt.record.manilaBayArea === "MBA"
                                          ? "#1890ff"
                                          : "#8c8c8c",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    <GlobalOutlined /> {pt.record.manilaBayArea}
                                  </span>
                                )}
                              </div>
                              <hr
                                style={{
                                  margin: "4px 0 6px",
                                  border: "none",
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              />
                              {pt.record.typeOfMRF && (
                                <div style={{ marginBottom: 4 }}>
                                  <ApartmentOutlined
                                    style={{ color: "#13c2c2" }}
                                  />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Type:
                                  </span>{" "}
                                  <strong>{pt.record.typeOfMRF}</strong>
                                </div>
                              )}
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                {(() => {
                                  const s = pt.record.statusOfMRF;
                                  const isOp =
                                    /operational/i.test(s) && !/non/i.test(s);
                                  const isNon = /non/i.test(s);
                                  return (
                                    <span
                                      className={`status-badge ${isOp ? "status-badge-compliant" : isNon ? "status-badge-noncompliant" : "status-badge-pending"}`}
                                    >
                                      <SafetyCertificateOutlined />{" "}
                                      {isOp
                                        ? "Operational"
                                        : isNon
                                          ? "Non-Operational"
                                          : "Not Yet Monitored"}
                                    </span>
                                  );
                                })()}
                              </div>
                              <div
                                style={{
                                  background: isDark ? "#1f1f1f" : "#fafafa",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  marginBottom: 6,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <span style={{ color: "#595959" }}>
                                    <BarChartOutlined
                                      style={{ color: "#1890ff" }}
                                    />{" "}
                                    Diversion
                                  </span>
                                  <strong
                                    style={{
                                      color:
                                        pt.record.wasteDiversionRate >= 0.25
                                          ? "#52c41a"
                                          : "#ff4d4f",
                                    }}
                                  >
                                    {pt.record.wasteDiversionRate
                                      ? `${(pt.record.wasteDiversionRate * 100).toFixed(1)}%`
                                      : "\u2014"}
                                  </strong>
                                </div>
                              </div>
                              {pt.record.focalPerson && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    marginBottom: 2,
                                  }}
                                >
                                  <UserOutlined style={{ color: "#13c2c2" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Focal:
                                  </span>{" "}
                                  <strong>{pt.record.focalPerson}</strong>
                                </div>
                              )}
                              {pt.record.enmoAssigned && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                  }}
                                >
                                  <TeamOutlined style={{ color: "#52c41a" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    ENMO:
                                  </span>{" "}
                                  {pt.record.enmoAssigned}
                                </div>
                              )}
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                    </MapContainer>
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text type="secondary">No coordinate data available</Text>
                    </div>
                  )}
                </Card>
              </div>
            </Col>
          </Row>
        </>
      ),
    });
  }

  // ── Trash Traps Dashboard Tab ──
  if (trapStats && trapStats.totalRecords > 0) {
    const trapProvList = trapStats.byProvinceList || [];
    const trapMaxProv = Math.max(...trapProvList.map((p) => p.count), 1);
    const trapByStatus = trapStats.byStatus || {};
    const trapOp = trapByStatus.Operational || 0;
    const trapNonOp = trapByStatus["Non-Operational"] || 0;
    const trapNotMonitored = trapByStatus["Not Yet Monitored"] || 0;
    const trapOpRate =
      trapStats.totalRecords > 0 ? (trapOp / trapStats.totalRecords) * 100 : 0;
    const trapOps = trapStats.operationStats || {};
    const trapTile = TILE_LAYERS[trapTileKey];

    const TRAP_CARD_H = 280;

    tabItems.push({
      key: "trash-traps",
      label: (
        <span>
          <DeleteOutlined /> Trash Traps
        </span>
      ),
      children: (
        <>
          {/* Row 1: Stat tiles */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total Traps"
                  value={trapStats.totalRecords}
                  prefix={<ExperimentOutlined style={{ color: "#13c2c2" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Operational"
                  value={trapOp}
                  valueStyle={{ color: "#52c41a" }}
                  prefix={<CheckCircleOutlined />}
                  suffix={
                    <span
                      style={{ color: "#999", fontSize: 14, fontWeight: 400 }}
                    >
                      ({trapOpRate.toFixed(0)}%)
                    </span>
                  }
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Non-Operational"
                  value={trapNonOp}
                  valueStyle={{ color: "#ff4d4f" }}
                  prefix={<CloseCircleOutlined />}
                  suffix={
                    <span
                      style={{ color: "#999", fontSize: 14, fontWeight: 400 }}
                    >
                      (
                      {(trapStats.totalRecords > 0
                        ? (trapNonOp / trapStats.totalRecords) * 100
                        : 0
                      ).toFixed(0)}
                      %)
                    </span>
                  }
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="HDPE Floaters"
                  value={trapOps.totalHDPE || 0}
                  prefix={<ToolOutlined style={{ color: "#1890ff" }} />}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total Waste Hauled"
                  value={trapOps.totalWasteHauled || 0}
                  suffix="kg"
                  prefix={<BarChartOutlined style={{ color: "#722ed1" }} />}
                  formatter={(v) => Number(v).toLocaleString()}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Avg Waste/Trap"
                  value={(trapOps.avgWasteHauled || 0).toFixed(1)}
                  suffix="kg"
                  prefix={<BarChartOutlined style={{ color: "#13c2c2" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Op. Rate"
                  value={trapOpRate.toFixed(1)}
                  suffix="%"
                  prefix={<RiseOutlined style={{ color: "#faad14" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Tooltip title="Click to view Trash Traps page">
                  <div
                    style={{ cursor: "pointer" }}
                    onClick={() => setActiveMenu("cs-trash-traps")}
                  >
                    <Statistic
                      title="View All Records"
                      value={trapStats.totalRecords}
                      prefix={<FileTextOutlined style={{ color: "#fa8c16" }} />}
                    />
                  </div>
                </Tooltip>
              </Card>
            </Col>
          </Row>

          {/* Two-column layout: cards left, map right */}
          <Row gutter={[16, 16]}>
            {/* LEFT COLUMN — Stats cards */}
            <Col xs={24} lg={14}>
              <Row gutter={[16, 16]}>
                {/* Operational Status */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <PieChartOutlined /> Operational Status
                      </>
                    }
                    style={{ borderRadius: 10, height: TRAP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: TRAP_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {[
                        {
                          label: "Operational",
                          count: trapOp,
                          color: "#52c41a",
                          icon: <CheckCircleOutlined />,
                        },
                        {
                          label: "Non-Operational",
                          count: trapNonOp,
                          color: "#ff4d4f",
                          icon: <CloseCircleOutlined />,
                        },
                        {
                          label: "Not Yet Monitored",
                          count: trapNotMonitored,
                          color: "#d9d9d9",
                          icon: <ClockCircleOutlined />,
                        },
                      ].map((s) => (
                        <div key={s.label}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text>
                              {s.icon} {s.label}
                            </Text>
                            <Text strong>
                              {s.count}{" "}
                              <span style={{ color: "#999", fontWeight: 400 }}>
                                (
                                {trapStats.totalRecords > 0
                                  ? Math.round(
                                      (s.count / trapStats.totalRecords) * 100,
                                    )
                                  : 0}
                                %)
                              </span>
                            </Text>
                          </div>
                          <Progress
                            percent={
                              trapStats.totalRecords > 0
                                ? Math.round(
                                    (s.count / trapStats.totalRecords) * 100,
                                  )
                                : 0
                            }
                            strokeColor={s.color}
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Key Metrics */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> Key Metrics
                      </>
                    }
                    style={{ borderRadius: 10, height: TRAP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: {
                        overflow: "auto",
                        height: TRAP_CARD_H - 57,
                        padding: "12px 16px",
                      },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "6px 10px",
                          background:
                            isDark ? "linear-gradient(135deg, rgba(19,194,194,0.12) 0%, rgba(47,84,235,0.08) 100%)" : "linear-gradient(135deg, #e6fffb 0%, #f0f5ff 100%)",
                          borderRadius: 8,
                          border: "1px solid #87e8de",
                        }}
                      >
                        <Progress
                          type="circle"
                          percent={Math.round(trapOpRate)}
                          size={48}
                          strokeColor={{ "0%": "#13c2c2", "100%": "#87e8de" }}
                          format={(p) => (
                            <span style={{ fontSize: 12, fontWeight: 700 }}>
                              {p}%
                            </span>
                          )}
                        />
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            Operational Rate
                          </Text>
                          <br />
                          <Text
                            strong
                            style={{ fontSize: 16, color: "#13c2c2" }}
                          >
                            {trapOpRate.toFixed(1)}%
                          </Text>
                        </div>
                      </div>
                      <Row gutter={8}>
                        <Col span={12}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "6px 4px",
                              background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                              borderRadius: 6,
                              border: isDark ? "1px solid rgba(22,119,255,0.3)" : "1px solid #bae7ff",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              HDPE Floaters
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#1890ff" }}
                            >
                              {(trapOps.totalHDPE || 0).toLocaleString()}
                            </Text>
                          </div>
                        </Col>
                        <Col span={12}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "6px 4px",
                              background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff",
                              borderRadius: 6,
                              border: isDark ? "1px solid rgba(114,46,209,0.3)" : "1px solid #efdbff",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Waste Hauled
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#722ed1" }}
                            >
                              {(trapOps.totalWasteHauled || 0).toLocaleString()}{" "}
                              kg
                            </Text>
                          </div>
                        </Col>
                      </Row>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "6px 4px",
                          background: isDark ? "rgba(250,219,20,0.12)" : "#fcffe6",
                          borderRadius: 6,
                          border: "1px solid #fffb8f",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          Avg Waste per Trap
                        </Text>
                        <Text strong style={{ fontSize: 16, color: "#faad14" }}>
                          {(trapOps.avgWasteHauled || 0).toFixed(1)} kg
                        </Text>
                      </div>
                    </div>
                  </Card>
                </Col>

                {/* Traps per Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> Traps per Province
                      </>
                    }
                    style={{ borderRadius: 10, height: TRAP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: TRAP_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        maxHeight: 170,
                        overflowY: "auto",
                        padding: "0 2px",
                      }}
                    >
                      {trapProvList.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#aaa" : "#999",
                              minWidth: 70,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p._id}
                          </Text>
                          <div
                            style={{
                              flex: 1,
                              height: 16,
                              background: isDark ? "#2a2a2a" : "#f5f5f5",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max((p.count / trapMaxProv) * 100, 4)}%`,
                                height: "100%",
                                background:
                                  "linear-gradient(90deg, #13c2c2 0%, #87e8de 100%)",
                                borderRadius: "3px 0 0 3px",
                                transition: "width 0.5s ease",
                              }}
                            />
                          </div>
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#ccc" : "#666",
                              minWidth: 20,
                              textAlign: "right",
                              fontWeight: 600,
                            }}
                          >
                            {p.count}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Manila Bay Area */}
                <Col xs={24} sm={12}>
                  <Card
                    title="Manila Bay Area"
                    style={{ borderRadius: 10, height: TRAP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: TRAP_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(trapStats.byManilaBayArea || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text>{key || "Unspecified"}</Text>
                              <Text strong>
                                {count}{" "}
                                <span
                                  style={{ color: "#999", fontWeight: 400 }}
                                >
                                  (
                                  {trapStats.totalRecords > 0
                                    ? Math.round(
                                        (count / trapStats.totalRecords) * 100,
                                      )
                                    : 0}
                                  %)
                                </span>
                              </Text>
                            </div>
                            <Progress
                              percent={
                                trapStats.totalRecords > 0
                                  ? Math.round(
                                      (count / trapStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor={
                                key === "MBA" ? "#1890ff" : "#8c8c8c"
                              }
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>
              </Row>
            </Col>

            {/* RIGHT COLUMN — Trap Map (sticky) */}
            <Col xs={24} lg={10}>
              <div
                style={{
                  position: "sticky",
                  top: 80,
                  height: TRAP_CARD_H * 2 + 16,
                }}
              >
                <Card
                  size="small"
                  title={
                    <>
                      <GlobalOutlined /> Trash Trap Location Map{" "}
                      <Tag bordered={false} color="cyan">
                        {filteredTrapMapPts.length} plotted
                      </Tag>
                      {filteredTrapMapPts.length !== trapMapPts.length && (
                        <Tag bordered={false} color="default">
                          of {trapMapPts.length}
                        </Tag>
                      )}
                    </>
                  }
                  style={{ borderRadius: 10, height: "100%" }}
                  loading={loading}
                  extra={
                    <Space size={4}>
                      <Tooltip title="Street">
                        <Button
                          size="small"
                          type={
                            trapTileKey === "street" ? "primary" : "default"
                          }
                          icon={<GlobalOutlined />}
                          onClick={() => setTrapTileKey("street")}
                        />
                      </Tooltip>
                      <Tooltip title="Satellite">
                        <Button
                          size="small"
                          type={
                            trapTileKey === "satellite" ? "primary" : "default"
                          }
                          icon={<EnvironmentOutlined />}
                          onClick={() => setTrapTileKey("satellite")}
                        />
                      </Tooltip>
                      <Tooltip title="Terrain">
                        <Button
                          size="small"
                          type={
                            trapTileKey === "terrain" ? "primary" : "default"
                          }
                          icon={<FundOutlined />}
                          onClick={() => setTrapTileKey("terrain")}
                        />
                      </Tooltip>
                      <Tooltip title="Dark">
                        <Button
                          size="small"
                          type={trapTileKey === "dark" ? "primary" : "default"}
                          icon={<AppstoreOutlined />}
                          onClick={() => setTrapTileKey("dark")}
                        />
                      </Tooltip>
                    </Space>
                  }
                  styles={{
                    body: { padding: 0, height: "calc(100% - 100px)" },
                  }}
                >
                  {/* Filter bar */}
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "8px 10px",
                      background: isDark ? "#1f1f1f" : "#fafafa",
                      borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                      flexWrap: "wrap",
                    }}
                  >
                    <Select
                      size="small"
                      allowClear
                      placeholder="Province"
                      value={trapFilterProvince}
                      onChange={setTrapFilterProvince}
                      options={trapProvinceOptions}
                      style={{ minWidth: 120, flex: 1 }}
                    />
                    <Select
                      size="small"
                      allowClear
                      placeholder="Status"
                      value={trapFilterStatus}
                      onChange={setTrapFilterStatus}
                      options={[
                        { label: "✓ Operational", value: "Operational" },
                        {
                          label: "✕ Non-Operational",
                          value: "Non-Operational",
                        },
                      ]}
                      style={{ minWidth: 130, flex: 1 }}
                    />
                    {(trapFilterProvince || trapFilterStatus) && (
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          setTrapFilterProvince(null);
                          setTrapFilterStatus(null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    {/* Legend */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "#999",
                      }}
                    >
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#52c41a",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Operational
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#ff4d4f",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Non-Op
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#8c8c8c",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Not Yet Monitored
                      </span>
                    </div>
                  </div>
                  {filteredTrapMapPts.length > 0 ? (
                    <MapContainer
                      center={[15.0, 120.7]}
                      zoom={8}
                      style={{
                        height: "100%",
                        width: "100%",
                        borderRadius: "0 0 10px 10px",
                      }}
                      scrollWheelZoom={true}
                      zoomControl={false}
                    >
                      <TileLayer
                        key={trapTileKey}
                        attribution={trapTile.attr}
                        url={trapTile.url}
                      />
                      <FitBounds points={filteredTrapMapPts} />
                      <ProvinceBoundary
                        key={trapFilterProvince || "__trap_none__"}
                        province={trapFilterProvince}
                      />
                      {filteredTrapMapPts.map((pt, idx) => (
                        <Marker
                          key={pt.record._id || idx}
                          position={[pt.lat, pt.lng]}
                          icon={trapStatusIcon(pt.record.statusOfTrashTraps)}
                        >
                          <Popup maxWidth={300} minWidth={240}>
                            <div
                              className="popup-light"
                              style={{
                                fontSize: 12,
                                lineHeight: 1.7,
                                padding: 2,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  marginBottom: 2,
                                }}
                              >
                                {pt.record.municipality}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    background: isDark ? "rgba(19,194,194,0.15)" : "#e6fffb",
                                    color: "#13c2c2",
                                    borderRadius: 4,
                                    padding: "1px 6px",
                                    fontSize: 11,
                                  }}
                                >
                                  <EnvironmentOutlined /> {pt.record.province}
                                </span>
                                {pt.record.barangay && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background: isDark ? "#303030" : "#f0f0f0",
                                      color: "#595959",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    {pt.record.barangay}
                                  </span>
                                )}
                                {pt.record.manilaBayArea && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background:
                                        pt.record.manilaBayArea === "MBA"
                                          ? (isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff")
                                          : (isDark ? "#303030" : "#f5f5f5"),
                                      color:
                                        pt.record.manilaBayArea === "MBA"
                                          ? "#1890ff"
                                          : "#8c8c8c",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    <GlobalOutlined /> {pt.record.manilaBayArea}
                                  </span>
                                )}
                              </div>
                              <hr
                                style={{
                                  margin: "4px 0 6px",
                                  border: "none",
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              />
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                {(() => {
                                  const s = pt.record.statusOfTrashTraps;
                                  const isOp =
                                    /operational/i.test(s) && !/non/i.test(s);
                                  const isNon = /non/i.test(s);
                                  return (
                                    <span
                                      className={`status-badge ${isOp ? "status-badge-compliant" : isNon ? "status-badge-noncompliant" : "status-badge-pending"}`}
                                    >
                                      <SafetyCertificateOutlined />{" "}
                                      {isOp
                                        ? "Operational"
                                        : isNon
                                          ? "Non-Operational"
                                          : "Not Yet Monitored"}
                                    </span>
                                  );
                                })()}
                              </div>
                              <div
                                style={{
                                  background: isDark ? "#1f1f1f" : "#fafafa",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  marginBottom: 6,
                                }}
                              >
                                {pt.record.noOfTrashTrapsHDPE != null && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      marginBottom: 3,
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      <ToolOutlined
                                        style={{ color: "#1890ff" }}
                                      />{" "}
                                      HDPE Floaters
                                    </span>
                                    <strong>
                                      {pt.record.noOfTrashTrapsHDPE}
                                    </strong>
                                  </div>
                                )}
                                {pt.record.estimatedVolumeWasteHauled !=
                                  null && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      marginBottom: 3,
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      <BarChartOutlined
                                        style={{ color: "#722ed1" }}
                                      />{" "}
                                      Waste Hauled
                                    </span>
                                    <strong>
                                      {Number(
                                        pt.record.estimatedVolumeWasteHauled,
                                      ).toLocaleString()}{" "}
                                      kg
                                    </strong>
                                  </div>
                                )}
                                {pt.record.dateInstalled && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      <CalendarOutlined
                                        style={{ color: "#13c2c2" }}
                                      />{" "}
                                      Installed
                                    </span>
                                    <strong>
                                      {dayjs(pt.record.dateInstalled).format(
                                        "MMM DD, YYYY",
                                      )}
                                    </strong>
                                  </div>
                                )}
                              </div>
                              {pt.record.focalPerson && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    marginBottom: 2,
                                  }}
                                >
                                  <UserOutlined style={{ color: "#13c2c2" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Focal:
                                  </span>{" "}
                                  <strong>{pt.record.focalPerson}</strong>
                                </div>
                              )}
                              {pt.record.enmoAssigned && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                  }}
                                >
                                  <TeamOutlined style={{ color: "#52c41a" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    ENMO:
                                  </span>{" "}
                                  {pt.record.enmoAssigned}
                                </div>
                              )}
                              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4, color: "#8c8c8c", fontSize: 11 }}>
                                <EnvironmentOutlined style={{ color: "#faad14" }} />
                                <span>{pt.lat.toFixed(3)}, {pt.lng.toFixed(3)}</span>
                              </div>
                              {/* Quick Actions */}
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  marginTop: 8,
                                  paddingTop: 6,
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              >
                                <button
                                  onClick={() => {
                                    api
                                      .get(`/trash-traps/${pt.record._id}`)
                                      .then(({ data }) => setTrapViewRecord(data))
                                      .catch(() => setTrapViewRecord(pt.record));
                                  }}
                                  className="popup-action-btn"
                                  title="View Full Record"
                                >
                                  <EyeOutlined /> View
                                </button>
                                <button
                                  onClick={() => {
                                    const txt = `${pt.record.municipality}, ${pt.record.province} (${pt.lat}, ${pt.lng})`;
                                    navigator.clipboard.writeText(txt);
                                  }}
                                  className="popup-action-btn"
                                  title="Copy Location"
                                >
                                  <CopyOutlined /> Copy
                                </button>
                              </div>
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                    </MapContainer>
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text type="secondary">No coordinate data available</Text>
                    </div>
                  )}
                </Card>
              </div>
            </Col>
          </Row>
        </>
      ),
    });
  }

  // ── SWM Equipment Dashboard Tab ──
  if (equipStats && equipStats.totalRecords > 0) {
    const equipProvList = equipStats.byProvinceList || [];
    const equipMaxProv = Math.max(...equipProvList.map((p) => p.count), 1);
    const equipByType = equipStats.byType || {};
    const equipOps = equipStats.equipmentStatus || {};
    const equipTile = TILE_LAYERS[equipTileKey];

    const EQUIP_CARD_H = 280;

    tabItems.push({
      key: "swm-equip",
      label: (
        <span>
          <CarOutlined /> SWM Equipment
        </span>
      ),
      children: (
        <>
          {/* Row 1: Stat tiles */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Total Equipment"
                  value={equipStats.totalRecords}
                  prefix={<CarOutlined style={{ color: "#fa8c16" }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Soil Enhancer"
                  value={equipOps.totalSoilEnhancer || 0}
                  suffix="kg"
                  prefix={<BarChartOutlined style={{ color: "#722ed1" }} />}
                  formatter={(v) => Number(v).toLocaleString()}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Statistic
                  title="Chairs Produced"
                  value={equipOps.totalChairsProduced || 0}
                  prefix={
                    <SafetyCertificateOutlined style={{ color: "#13c2c2" }} />
                  }
                  formatter={(v) => Number(v).toLocaleString()}
                />
              </Card>
            </Col>
            <Col xs={12} sm={12} md={6}>
              <Card
                hoverable
                style={{ borderRadius: 10, height: 110 }}
                loading={loading}
              >
                <Tooltip title="Click to view SWM Equipment page">
                  <div
                    style={{ cursor: "pointer" }}
                    onClick={() => setActiveMenu("cs-swm-equip")}
                  >
                    <Statistic
                      title="View All Records"
                      value={equipStats.totalRecords}
                      prefix={<FileTextOutlined style={{ color: "#fa8c16" }} />}
                    />
                  </div>
                </Tooltip>
              </Card>
            </Col>
          </Row>

          {/* Two-column layout: cards left, map right */}
          <Row gutter={[16, 16]}>
            {/* LEFT COLUMN — Stats cards */}
            <Col xs={24} lg={14}>
              <Row gutter={[16, 16]}>
                {/* Equipment per Province */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> Equipment per Province
                      </>
                    }
                    style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: EQUIP_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        maxHeight: 170,
                        overflowY: "auto",
                        padding: "0 2px",
                      }}
                    >
                      {equipProvList.map((p, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#aaa" : "#999",
                              minWidth: 70,
                              textAlign: "right",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p._id}
                          </Text>
                          <div
                            style={{
                              flex: 1,
                              height: 16,
                              background: isDark ? "#2a2a2a" : "#f5f5f5",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max((p.count / equipMaxProv) * 100, 4)}%`,
                                height: "100%",
                                background:
                                  "linear-gradient(90deg, #fa8c16 0%, #ffc069 100%)",
                                borderRadius: "3px 0 0 3px",
                                transition: "width 0.5s ease",
                              }}
                            />
                          </div>
                          <Text
                            style={{
                              fontSize: 10,
                              color: isDark ? "#ccc" : "#666",
                              minWidth: 20,
                              textAlign: "right",
                              fontWeight: 600,
                            }}
                          >
                            {p.count}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Equipment Type Distribution */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <CarOutlined /> By Equipment Type
                      </>
                    }
                    style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: EQUIP_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(equipByType).map(([type, count]) => (
                        <div key={type}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: 4,
                            }}
                          >
                            <Text>{type}</Text>
                            <Text strong>
                              {count}{" "}
                              <span style={{ color: "#999", fontWeight: 400 }}>
                                (
                                {equipStats.totalRecords > 0
                                  ? Math.round(
                                      (count / equipStats.totalRecords) * 100,
                                    )
                                  : 0}
                                %)
                              </span>
                            </Text>
                          </div>
                          <Progress
                            percent={
                              equipStats.totalRecords > 0
                                ? Math.round(
                                    (count / equipStats.totalRecords) * 100,
                                  )
                                : 0
                            }
                            strokeColor="#fa8c16"
                            showInfo={false}
                            size="small"
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                {/* Manila Bay Area */}
                <Col xs={24} sm={12}>
                  <Card
                    title="Manila Bay Area"
                    style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: { overflow: "auto", height: EQUIP_CARD_H - 57 },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      {Object.entries(equipStats.byManilaBayArea || {}).map(
                        ([key, count]) => (
                          <div key={key}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <Text>{key || "Unspecified"}</Text>
                              <Text strong>
                                {count}{" "}
                                <span
                                  style={{ color: "#999", fontWeight: 400 }}
                                >
                                  (
                                  {equipStats.totalRecords > 0
                                    ? Math.round(
                                        (count / equipStats.totalRecords) * 100,
                                      )
                                    : 0}
                                  %)
                                </span>
                              </Text>
                            </div>
                            <Progress
                              percent={
                                equipStats.totalRecords > 0
                                  ? Math.round(
                                      (count / equipStats.totalRecords) * 100,
                                    )
                                  : 0
                              }
                              strokeColor={
                                key === "MBA" ? "#1890ff" : "#8c8c8c"
                              }
                              showInfo={false}
                              size="small"
                            />
                          </div>
                        ),
                      )}
                    </div>
                  </Card>
                </Col>

                {/* Key Metrics */}
                <Col xs={24} sm={12}>
                  <Card
                    title={
                      <>
                        <BarChartOutlined /> Key Metrics
                      </>
                    }
                    style={{ borderRadius: 10, height: EQUIP_CARD_H }}
                    loading={loading}
                    styles={{
                      body: {
                        overflow: "auto",
                        height: EQUIP_CARD_H - 57,
                        padding: "12px 16px",
                      },
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <Row gutter={8}>
                        <Col span={12}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "8px 4px",
                              background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff",
                              borderRadius: 6,
                              border: isDark ? "1px solid rgba(114,46,209,0.3)" : "1px solid #efdbff",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Soil Enhancer
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#722ed1" }}
                            >
                              {(
                                equipOps.totalSoilEnhancer || 0
                              ).toLocaleString()}{" "}
                              kg
                            </Text>
                          </div>
                        </Col>
                        <Col span={12}>
                          <div
                            style={{
                              textAlign: "center",
                              padding: "8px 4px",
                              background: isDark ? "rgba(19,194,194,0.15)" : "#e6fffb",
                              borderRadius: 6,
                              border: "1px solid #87e8de",
                            }}
                          >
                            <Text
                              type="secondary"
                              style={{ fontSize: 10, display: "block" }}
                            >
                              Chairs Produced
                            </Text>
                            <Text
                              strong
                              style={{ fontSize: 16, color: "#13c2c2" }}
                            >
                              {(
                                equipOps.totalChairsProduced || 0
                              ).toLocaleString()}
                            </Text>
                          </div>
                        </Col>
                      </Row>
                      <div
                        style={{
                          textAlign: "center",
                          padding: "8px 4px",
                          background: isDark ? "rgba(250,173,20,0.15)" : "#fff7e6",
                          borderRadius: 6,
                          border: "1px solid #ffd591",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          Total Equipment Records
                        </Text>
                        <Text strong style={{ fontSize: 16, color: "#fa8c16" }}>
                          {equipStats.totalRecords}
                        </Text>
                        <Text
                          type="secondary"
                          style={{ fontSize: 10, display: "block" }}
                        >
                          {Object.keys(equipByType).length} equipment types
                        </Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              </Row>
            </Col>

            {/* RIGHT COLUMN — Equipment Map (sticky) */}
            <Col xs={24} lg={10}>
              <div
                style={{
                  position: "sticky",
                  top: 80,
                  height: EQUIP_CARD_H * 3 + 32,
                }}
              >
                <Card
                  size="small"
                  title={
                    <>
                      <GlobalOutlined /> Equipment Location Map{" "}
                      <Tag bordered={false} color="orange">
                        {filteredEquipMapPts.length} plotted
                      </Tag>
                      {filteredEquipMapPts.length !== equipMapPts.length && (
                        <Tag bordered={false} color="default">
                          of {equipMapPts.length}
                        </Tag>
                      )}
                    </>
                  }
                  style={{ borderRadius: 10, height: "100%" }}
                  loading={loading}
                  extra={
                    <Space size={4}>
                      <Tooltip title="Street">
                        <Button
                          size="small"
                          type={
                            equipTileKey === "street" ? "primary" : "default"
                          }
                          icon={<GlobalOutlined />}
                          onClick={() => setEquipTileKey("street")}
                        />
                      </Tooltip>
                      <Tooltip title="Satellite">
                        <Button
                          size="small"
                          type={
                            equipTileKey === "satellite" ? "primary" : "default"
                          }
                          icon={<EnvironmentOutlined />}
                          onClick={() => setEquipTileKey("satellite")}
                        />
                      </Tooltip>
                      <Tooltip title="Terrain">
                        <Button
                          size="small"
                          type={
                            equipTileKey === "terrain" ? "primary" : "default"
                          }
                          icon={<FundOutlined />}
                          onClick={() => setEquipTileKey("terrain")}
                        />
                      </Tooltip>
                      <Tooltip title="Dark">
                        <Button
                          size="small"
                          type={equipTileKey === "dark" ? "primary" : "default"}
                          icon={<AppstoreOutlined />}
                          onClick={() => setEquipTileKey("dark")}
                        />
                      </Tooltip>
                    </Space>
                  }
                  styles={{
                    body: { padding: 0, height: "calc(100% - 100px)" },
                  }}
                >
                  {/* Filter bar */}
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      padding: "8px 10px",
                      background: isDark ? "#1f1f1f" : "#fafafa",
                      borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                      flexWrap: "wrap",
                    }}
                  >
                    <Select
                      size="small"
                      allowClear
                      placeholder="Province"
                      value={equipFilterProvince}
                      onChange={setEquipFilterProvince}
                      options={equipProvinceOptions}
                      style={{ minWidth: 120, flex: 1 }}
                    />
                    <Select
                      size="small"
                      allowClear
                      placeholder="Equipment Type"
                      value={equipFilterType}
                      onChange={setEquipFilterType}
                      options={equipTypeOptions}
                      style={{ minWidth: 140, flex: 1 }}
                    />
                    {(equipFilterProvince || equipFilterType) && (
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          setEquipFilterProvince(null);
                          setEquipFilterType(null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    {/* Legend */}
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "#999",
                      }}
                    >
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#52c41a",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Both Op
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#faad14",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Partial
                      </span>
                      <span>
                        <span
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#ff4d4f",
                            marginRight: 3,
                            verticalAlign: "middle",
                          }}
                        />
                        Non-Op
                      </span>
                    </div>
                  </div>
                  {filteredEquipMapPts.length > 0 ? (
                    <MapContainer
                      center={[15.0, 120.7]}
                      zoom={8}
                      style={{
                        height: "100%",
                        width: "100%",
                        borderRadius: "0 0 10px 10px",
                      }}
                      scrollWheelZoom={true}
                      zoomControl={false}
                    >
                      <TileLayer
                        key={equipTileKey}
                        attribution={equipTile.attr}
                        url={equipTile.url}
                      />
                      <FitBounds points={filteredEquipMapPts} />
                      <ProvinceBoundary
                        key={equipFilterProvince || "__equip_none__"}
                        province={equipFilterProvince}
                      />
                      {filteredEquipMapPts.map((pt, idx) => (
                        <Marker
                          key={pt.record._id || idx}
                          position={[pt.lat, pt.lng]}
                          icon={equipStatusIcon(pt.record)}
                        >
                          <Popup maxWidth={300} minWidth={240}>
                            <div
                              className="popup-light"
                              style={{
                                fontSize: 12,
                                lineHeight: 1.7,
                                padding: 2,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 14,
                                  marginBottom: 2,
                                }}
                              >
                                {pt.record.municipality}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  gap: 4,
                                  flexWrap: "wrap",
                                  marginBottom: 6,
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    background: isDark ? "rgba(250,173,20,0.15)" : "#fff7e6",
                                    color: "#fa8c16",
                                    borderRadius: 4,
                                    padding: "1px 6px",
                                    fontSize: 11,
                                  }}
                                >
                                  <EnvironmentOutlined /> {pt.record.province}
                                </span>
                                {pt.record.barangay && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background: isDark ? "#303030" : "#f0f0f0",
                                      color: "#595959",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    {pt.record.barangay}
                                  </span>
                                )}
                                {pt.record.manilaBayArea && (
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                      background:
                                        pt.record.manilaBayArea === "MBA"
                                          ? (isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff")
                                          : (isDark ? "#303030" : "#f5f5f5"),
                                      color:
                                        pt.record.manilaBayArea === "MBA"
                                          ? "#1890ff"
                                          : "#8c8c8c",
                                      borderRadius: 4,
                                      padding: "1px 6px",
                                      fontSize: 11,
                                    }}
                                  >
                                    <GlobalOutlined /> {pt.record.manilaBayArea}
                                  </span>
                                )}
                              </div>
                              <hr
                                style={{
                                  margin: "4px 0 6px",
                                  border: "none",
                                  borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                                }}
                              />
                              {pt.record.typeOfEquipment && (
                                <div style={{ marginBottom: 4 }}>
                                  <CarOutlined style={{ color: "#fa8c16" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Type:
                                  </span>{" "}
                                  <strong>{pt.record.typeOfEquipment}</strong>
                                </div>
                              )}
                              <div
                                style={{
                                  background: isDark ? "#1f1f1f" : "#fafafa",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  marginBottom: 6,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    marginBottom: 3,
                                  }}
                                >
                                  <span style={{ color: "#595959" }}>
                                    Bio-Shredder
                                  </span>
                                  {(() => {
                                    const s = pt.record.statusOfBioShredder;
                                    const isOp =
                                      /operational/i.test(s) && !/non/i.test(s);
                                    return (
                                      <strong
                                        style={{
                                          color: isOp ? "#52c41a" : "#ff4d4f",
                                        }}
                                      >
                                        {isOp
                                          ? "✓ Operational"
                                          : /non/i.test(s)
                                            ? "✕ Non-Op"
                                            : "—"}
                                      </strong>
                                    );
                                  })()}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    marginBottom: 3,
                                  }}
                                >
                                  <span style={{ color: "#595959" }}>
                                    Bio-Composter
                                  </span>
                                  {(() => {
                                    const s = pt.record.statusOfBioComposter;
                                    const isOp =
                                      /operational/i.test(s) && !/non/i.test(s);
                                    return (
                                      <strong
                                        style={{
                                          color: isOp ? "#52c41a" : "#ff4d4f",
                                        }}
                                      >
                                        {isOp
                                          ? "✓ Operational"
                                          : /non/i.test(s)
                                            ? "✕ Non-Op"
                                            : "—"}
                                      </strong>
                                    );
                                  })()}
                                </div>
                                {pt.record.statusOfCCTV && (
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                    }}
                                  >
                                    <span style={{ color: "#595959" }}>
                                      CCTV
                                    </span>
                                    {(() => {
                                      const s = pt.record.statusOfCCTV;
                                      const isOp =
                                        /operational/i.test(s) &&
                                        !/non/i.test(s);
                                      return (
                                        <strong
                                          style={{
                                            color: isOp ? "#52c41a" : "#ff4d4f",
                                          }}
                                        >
                                          {isOp
                                            ? "✓ Operational"
                                            : /non/i.test(s)
                                              ? "✕ Non-Op"
                                              : "—"}
                                        </strong>
                                      );
                                    })()}
                                  </div>
                                )}
                              </div>
                              {pt.record.focalPerson && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                    marginBottom: 2,
                                  }}
                                >
                                  <UserOutlined style={{ color: "#fa8c16" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    Focal:
                                  </span>{" "}
                                  <strong>{pt.record.focalPerson}</strong>
                                </div>
                              )}
                              {pt.record.enmoAssigned && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 5,
                                  }}
                                >
                                  <TeamOutlined style={{ color: "#52c41a" }} />{" "}
                                  <span style={{ color: "#595959" }}>
                                    ENMO:
                                  </span>{" "}
                                  {pt.record.enmoAssigned}
                                </div>
                              )}
                            </div>
                          </Popup>
                        </Marker>
                      ))}
                    </MapContainer>
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text type="secondary">No coordinate data available</Text>
                    </div>
                  )}
                </Card>
              </div>
            </Col>
          </Row>
        </>
      ),
    });
  }

  // ── SLF Monitoring Dashboard Tab ──
  if (slfFacStats && slfFacStats.totalRecords > 0) {
    const slfProvList = slfFacStats.byProvinceList || [];
    const slfMaxProv = Math.max(...slfProvList.map((p) => p.count), 1);
    const slfByStatus = slfFacStats.byStatus || {};
    const slfByCategory = slfFacStats.byCategory || {};
    const slfByOwnership = slfFacStats.byOwnership || {};
    const slfOps = slfFacStats.operationStats || {};
    const slfTile = TILE_LAYERS[slfTileKey];
    const slfPrivateCount = slfByOwnership["Private"] || slfByOwnership["private"] || 0;

    // #6: single source of truth for the SLF totals. Both the dashboard tile and
    // the Facility Portfolio modal derive Total / Operational / Non-Operational
    // from the SAME actual SLF Data Table records (managementData) with ONE status
    // classifier — never hardcoded and never diverging between the two views.
    const slfMgmt = slfFacStats.managementData || [];
    const slfCounts = slfMgmt.reduce(
      (acc, r) => {
        acc.total += 1;
        acc[classifySlfStatus(r.statusOfSLF)] += 1;
        return acc;
      },
      { total: 0, operational: 0, nonOperational: 0, unmonitored: 0 },
    );
    const preventiveFileFacilityCount = slfMgmt.filter(
      (row) => (row.preventiveMeasureFiles?.length || 0) > 0,
    ).length;

    const SLF_CATEGORY_DESC = {
      "Cat 1": "< 15 TPD",
      "Cat 2": "15\u201375 TPD",
      "Cat 3": "75\u2013150 TPD",
      "Cat 4": "> 150 TPD",
    };

    // #2/#3: shorter stacked cards → a shorter SLF Location Map card. The left
    // column is two rows (Status/Category, then Prevention), so the map height is
    // 2 card heights + their single gutter, keeping the map aligned with the left
    // column and the vertical spacing minimal.
    const SLF_CARD_H = 300;
    const SLF_MAP_H = SLF_CARD_H * 2 + 16;

    tabItems.push({
      key: "slf-monitoring",
      label: (
        <span>
          <BankOutlined /> Sanitary Landfill
        </span>
      ),
      children: (
        // #2: single-tab wrapper removed — only "SLF Monitoring General Dashboard"
        // existed, so its content is rendered directly (no nested Tabs).
        <>
                  {/* Row 1: Total SLF | Total Cells | LGUs Served | Private Sectors Served */}
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col xs={12} sm={8} lg={4}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #2f54eb", cursor: "pointer" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                        onClick={() => setSlfDashModal({ type: "total" })}
                      >
                        <Statistic
                          title={
                            <Tooltip title="Counts SLFs whose official facility status is classified Operational (same definition used on the map, Cell Infrastructure and reports). A non-operational facility is never counted as operational even if it still submits data. Excludes deleted and test records.">
                              <span>Operational SLFs <InfoCircleOutlined style={{ color: "#8c8c8c", fontSize: 12 }} /></span>
                            </Tooltip>
                          }
                          value={slfCounts.operational}
                          prefix={<BankOutlined style={{ color: "#2f54eb" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {slfCounts.total} total registered
                          <CloseCircleOutlined style={{ color: "#ff4d4f", margin: "0 3px 0 6px" }} />
                          {slfCounts.nonOperational} non-operational
                          {slfCounts.unmonitored > 0 && (
                            <span> · {slfCounts.unmonitored} not yet monitored</span>
                          )}
                        </Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={8} lg={4}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #13c2c2", cursor: "pointer" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                        onClick={() => setSlfDashModal({ type: "cells" })}
                      >
                        <Statistic
                          title="Total Cells"
                          value={slfOps.totalCells || 0}
                          prefix={<ContainerOutlined style={{ color: "#13c2c2" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>across {slfFacStats.totalRecords} facilities</Text>
                      </Card>
                    </Col>
                    {/* Combined: LGUs Served + Private Sectors Served — one tile,
                        tabbed modal (see combo: "served"). */}
                    <Col xs={24} sm={24} lg={8}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #fa8c16", cursor: "pointer" }}
                        loading={loading || slfClientSummary.loading}
                        styles={{ body: { padding: "10px 14px" } }}
                        onClick={() => setSlfDashModal({ combo: "served" })}
                      >
                        {/* DB-driven unique-client counts from the managed SLF Clients
                            collection. On a fetch error, fall back to the facility-derived
                            counts so the tile is never blank. */}
                        <Row gutter={16} align="middle">
                          <Col span={12}>
                            <Statistic
                              title="LGUs Served"
                              value={slfClientSummary.error ? (slfOps.totalLGUsServed || 0) : slfClientSummary.lgu}
                              prefix={<TeamOutlined style={{ color: "#fa8c16" }} />}
                            />
                          </Col>
                          <Col span={12}>
                            <Statistic
                              title="Private Sectors Served"
                              value={slfClientSummary.error ? slfPrivateCount : slfClientSummary.private}
                              prefix={<BankOutlined style={{ color: "#722ed1" }} />}
                            />
                          </Col>
                        </Row>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {slfClientSummary.error ? (
                            <Text type="warning" style={{ fontSize: 11 }}>Live count unavailable — showing facility estimate</Text>
                          ) : slfClientSummary.total === 0 ? (
                            <Text type="secondary" style={{ fontSize: 11 }}>No clients recorded yet — click to manage</Text>
                          ) : (
                            <>
                              Unique clients:{" "}
                              <Text style={{ fontSize: 11, color: "#1677ff", fontWeight: 600 }}>
                                {slfClientSummary.lgu} LGU
                              </Text>{" "}
                              ·{" "}
                              <Text style={{ fontSize: 11, color: "#722ed1", fontWeight: 600 }}>
                                {slfClientSummary.private} Private
                              </Text>{" "}
                              — click for details
                            </>
                          )}
                        </Text>
                      </Card>
                    </Col>
                    {/* #3: Leachate + Gas merged into the same top row so all summary
                        tiles sit on ONE horizontal row on desktop (they wrap on
                        smaller screens). Total Capacity + Waste Received tiles remain
                        folded into the Total Cells modal. */}
                    <Col xs={12} sm={12} lg={4}>
                      <Card
                        hoverable
                        onClick={() => setSlfDashModal({ type: "leachate" })}
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #1890ff", cursor: "pointer" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Leachate Management"
                          value={slfOps.totalLeachatePonds || 0}
                          prefix={<AlertOutlined style={{ color: "#1890ff" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>Click to view Leachate Treatment Plant</Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} lg={4}>
                      <Card
                        hoverable
                        onClick={() => setSlfDashModal({ type: "gas" })}
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #52c41a", cursor: "pointer" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Gas Management"
                          value={slfOps.totalGasVents || 0}
                          prefix={<SafetyCertificateOutlined style={{ color: "#52c41a" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>Click to view gas management</Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} lg={4}>
                      <Card
                        hoverable
                        onClick={() => setPreventiveDashModal(true)}
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #fa541c", cursor: "pointer" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Preventive Measures"
                          value={slfOps.totalPreventionDocuments || 0}
                          prefix={<SafetyCertificateOutlined style={{ color: "#fa541c" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>Fire Prevention &amp; Trash Slide — click to view</Text>
                      </Card>
                    </Col>
                  </Row>

                  {/* Second row: SLF Disposal Calendar (left) + SLF Location Map
                      (right), side by side on desktop, stacked on smaller screens. */}
                  <Row gutter={[16, 16]} align="stretch">
                    {/* LEFT COLUMN — SLF Disposal Calendar. Height is pinned to the
                        same SLF_MAP_H as the Location Map so both cards are exactly
                        equal on desktop; on smaller screens the map stacks below and
                        the calendar falls back to its natural height. */}
                    <Col xs={24} lg={14}>
                      <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
                        <DisposalActivityCalendar
                          isDark={isDark}
                          height={screens?.lg ? SLF_MAP_H : undefined}
                          onOpenSubmissions={onOpenSubmissions}
                          canOpenSubmissions={canOpenSubmissions}
                          // Share the selected disposal date with the SLF map so a
                          // day-click updates the map's date-specific markers.
                          selectedDate={slfMapDate}
                          onSelectDate={setSlfMapDate}
                        />
                      </Suspense>
                    </Col>

                    {/* RIGHT COLUMN — SLF Map (sticky) */}
                    <Col xs={24} lg={10}>
                      <div
                        style={{
                          position: "sticky",
                          top: 80,
                          height: SLF_MAP_H,
                        }}
                      >
                        <Card
                          size="small"
                          title={
                            <>
                              <GlobalOutlined /> SLF Location Map{" "}
                              <Tag bordered={false} color="blue">
                                {filteredSlfMapPts.length} plotted
                              </Tag>
                              {filteredSlfMapPts.length !== slfMapPts.length && (
                                <Tag bordered={false} color="default">
                                  of {slfMapPts.length}
                                </Tag>
                              )}
                            </>
                          }
                          style={{
                            borderRadius: 10,
                            height: "100%",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                          }}
                          loading={loading}
                          extra={
                            <Space size={4}>
                              {slfToday.generatedAt && (
                                <Text type="secondary" style={{ fontSize: 10 }}>
                                  {slfToday.error ? "status unavailable" : `updated ${new Date(slfToday.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                                </Text>
                              )}
                              <Tooltip title="Refresh today's submission status">
                                <Button
                                  size="small"
                                  icon={<ReloadOutlined />}
                                  loading={slfToday.loading}
                                  onClick={() => fetchTodayStatus(slfDateStr)}
                                />
                              </Tooltip>
                              <Tooltip title="Street">
                                <Button
                                  size="small"
                                  type={slfTileKey === "street" ? "primary" : "default"}
                                  icon={<GlobalOutlined />}
                                  onClick={() => setSlfTileKey("street")}
                                />
                              </Tooltip>
                              <Tooltip title="Satellite">
                                <Button
                                  size="small"
                                  type={slfTileKey === "satellite" ? "primary" : "default"}
                                  icon={<EnvironmentOutlined />}
                                  onClick={() => setSlfTileKey("satellite")}
                                />
                              </Tooltip>
                              <Tooltip title="Terrain">
                                <Button
                                  size="small"
                                  type={slfTileKey === "terrain" ? "primary" : "default"}
                                  icon={<FundOutlined />}
                                  onClick={() => setSlfTileKey("terrain")}
                                />
                              </Tooltip>
                              <Tooltip title="Dark">
                                <Button
                                  size="small"
                                  type={slfTileKey === "dark" ? "primary" : "default"}
                                  icon={<AppstoreOutlined />}
                                  onClick={() => setSlfTileKey("dark")}
                                />
                              </Tooltip>
                            </Space>
                          }
                          styles={{
                            body: {
                              padding: 0,
                              flex: 1,
                              minHeight: 0,
                              display: "flex",
                              flexDirection: "column",
                            },
                          }}
                        >
                          {/* Filter bar */}
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              padding: "8px 10px",
                              background: isDark ? "#1f1f1f" : "#fafafa",
                              borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
                              flexWrap: "wrap",
                              flex: "0 0 auto",
                            }}
                          >
                            <Select
                              size="small"
                              allowClear
                              placeholder="Province"
                              value={slfFilterProvince}
                              onChange={setSlfFilterProvince}
                              options={slfProvinceOptions}
                              style={{ minWidth: 120, flex: 1 }}
                            />
                            <Select
                              size="small"
                              allowClear
                              placeholder="Status"
                              value={slfFilterStatus}
                              onChange={setSlfFilterStatus}
                              options={[
                                { label: "✓ Acknowledged", value: "acknowledged" },
                                { label: "◷ Pending Submission", value: "pending" },
                                { label: "↻ Pending Resubmission", value: "pending-resubmission" },
                                { label: "↺ Reverted", value: "reverted" },
                                { label: "⊘ Rejected", value: "rejected" },
                                { label: "– No Activity", value: "no-data" },
                              ]}
                              style={{ minWidth: 160, flex: 1 }}
                            />
                            {/* Submission-status date (official tz today by default; no future dates). */}
                            <DatePicker
                              size="small"
                              allowClear={false}
                              value={slfMapDate}
                              onChange={(d) => setSlfMapDate(d || dayjs())}
                              disabledDate={(d) => d && d.isAfter(dayjs(), "day")}
                              format="MMM D, YYYY"
                              style={{ minWidth: 130, flex: 1 }}
                            />
                            {slfToday.loading && <Spin size="small" />}
                            {(slfFilterProvince || slfFilterStatus || !slfMapDate.isSame(dayjs(), "day")) && (
                              <Button
                                size="small"
                                type="link"
                                danger
                                onClick={() => {
                                  setSlfFilterProvince(null);
                                  setSlfFilterStatus(null);
                                  setSlfMapDate(dayjs());
                                }}
                              >
                                Clear
                              </Button>
                            )}
                            {/* Legend — priority order; wraps cleanly so chips never
                                overlap the filters/map controls on narrow screens. */}
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "6px 12px",
                                alignItems: "center",
                                marginLeft: "auto",
                                fontSize: 11,
                                lineHeight: 1.4,
                                color: "#999",
                                maxWidth: "100%",
                              }}
                            >
                              {[
                                { title: "Assigned SLF is non-operational — cell subject to EMB R3 verification (highest priority)", color: "#ff4d4f", glyph: "✕", label: "Non-operational" },
                                { title: "Pending resubmission for the selected date — previously reverted, resubmitted and awaiting review (pulsing orange)", color: MAP_MARKER["pending-resubmission"].color, glyph: "↻", label: "Pending Resubmission", ring: "rgba(250,140,22,0.35)" },
                                { title: "Pending initial submission for the selected date, awaiting review (pulsing yellow)", color: MAP_MARKER.pending.color, glyph: "◷", label: "Pending Submission", ring: "rgba(250,173,20,0.35)" },
                                { title: "Submission reverted for correction on the selected date", color: MAP_MARKER.reverted.color, glyph: "↺", label: "Reverted" },
                                { title: "Submission rejected (not accepted) on the selected date", color: MAP_MARKER.rejected.color, glyph: "⊘", label: "Rejected" },
                                { title: "Acknowledged submission for the selected date", color: MAP_MARKER.acknowledged.color, glyph: "✓", label: "Acknowledged" },
                                { title: "No disposal activity for the selected date", color: MAP_MARKER["no-data"].color, glyph: "–", label: "No activity" },
                              ].map((it) => (
                                <span key={it.label} title={it.title} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                                  <span style={{ flex: "0 0 auto", width: 10, height: 10, borderRadius: "50%", background: it.color, boxShadow: it.ring ? `0 0 0 3px ${it.ring}` : "none" }} />
                                  {it.label}
                                </span>
                              ))}
                            </div>
                          </div>
                          {/* CSS-only pulse for submitted-today markers; respects reduced-motion. */}
                          <style>{`
                            .slf-today { position: relative; width: 22px; height: 22px; }
                            .slf-today-dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: bold; position: absolute; top: 1px; left: 1px; z-index: 1; }
                            .slf-today-ring { position: absolute; top: 1px; left: 1px; width: 20px; height: 20px; border-radius: 50%; background: rgba(22,119,255,0.55); z-index: 0; animation: slfPulse 1.8s ease-out infinite; }
                            .slf-today-badge { position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; border-radius: 50%; background: #1677ff; color: #fff; font-size: 9px; line-height: 12px; text-align: center; border: 1.5px solid #fff; z-index: 2; }
                            .slf-wait-dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; background: #faad14; position: absolute; top: 1px; left: 1px; z-index: 1; }
                            .slf-wait-ring { position: absolute; top: 1px; left: 1px; width: 20px; height: 20px; border-radius: 50%; background: rgba(250,173,20,0.5); z-index: 0; animation: slfPulse 2.1s ease-out infinite; }
                            .slf-resub-ring { position: absolute; top: 1px; left: 1px; width: 20px; height: 20px; border-radius: 50%; background: rgba(250,140,22,0.5); z-index: 0; animation: slfPulse 2.0s ease-out infinite; }
                            @keyframes slfPulse { 0% { transform: scale(1); opacity: 0.7; } 70% { transform: scale(2.3); opacity: 0; } 100% { transform: scale(2.3); opacity: 0; } }
                            @media (prefers-reduced-motion: reduce) { .slf-today-ring, .slf-wait-ring, .slf-resub-ring { animation: none; box-shadow: 0 0 0 3px rgba(22,119,255,0.35); } .slf-wait-ring { box-shadow: 0 0 0 3px rgba(250,173,20,0.35); } .slf-resub-ring { box-shadow: 0 0 0 3px rgba(250,140,22,0.35); } }
                          `}</style>
                          {filteredSlfMapPts.length > 0 ? (
                            <MapContainer
                              center={[15.0, 120.7]}
                              zoom={8}
                              style={{
                                flex: 1,
                                minHeight: 0,
                                width: "100%",
                                borderRadius: "0 0 10px 10px",
                              }}
                              scrollWheelZoom={true}
                              zoomControl={false}
                            >
                              <TileLayer
                                key={slfTileKey}
                                attribution={slfTile.attr}
                                url={slfTile.url}
                              />
                              <FitBounds points={filteredSlfMapPts} />
                              <ProvinceBoundary
                                key={slfFilterProvince || "__slf_none__"}
                                province={slfFilterProvince}
                              />
                              {filteredSlfMapPts.map((pt, idx) => (
                                <Marker
                                  key={pt.record._id || idx}
                                  position={[pt.lat, pt.lng]}
                                  icon={slfMarkerIcon(pt.record)}
                                >
                                  <Popup maxWidth={300} minWidth={250}>
                                    {(() => {
                                      const rec = pt.record;
                                      const photo = firstSlfPhoto(rec);
                                      const s = rec.statusOfSLF;
                                      const isOp = /operational/i.test(s) && !/non/i.test(s);
                                      const isNon = /non/i.test(s);
                                      const muted = isDark ? "#8c8c8c" : "#8c8c8c";
                                      const label = isDark ? "#bfbfbf" : "#595959";
                                      const InfoRow = ({ icon, text, value }) => (
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: label, minWidth: 0 }}>
                                            {icon}
                                            <span style={{ whiteSpace: "nowrap" }}>{text}</span>
                                          </span>
                                          <strong style={{ textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</strong>
                                        </div>
                                      );
                                      return (
                                        <div
                                          className="popup-light"
                                          style={{ fontSize: 12, lineHeight: 1.55, padding: 0, maxWidth: 280 }}
                                        >
                                          {/* Latest Disposal Calendar status — the same state the marker shows
                                              (icon shape + label + tooltip text, not colour alone). */}
                                          {(() => {
                                            const day = slfToday.byId[String(rec._id)];
                                            const key = day?.submissionStatus || "no-data";
                                            const STATUS_LABELS = {
                                              acknowledged: "Acknowledged",
                                              pending: "Pending Submission",
                                              "pending-resubmission": "Pending Resubmission",
                                              reverted: "Reverted",
                                              rejected: "Rejected",
                                              "no-submission": "No Submission",
                                              "no-data": "No Activity",
                                            };
                                            const m = MAP_MARKER[key] || MAP_MARKER["no-data"];
                                            const color = m.color;
                                            const count = day?.submissionCount;
                                            const vol = day?.totalVolume;
                                            const dateLabel = slfMapDate ? slfMapDate.format("MMM D, YYYY") : "";
                                            return (
                                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "0 0 6px" }}>
                                                <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
                                                <strong style={{ color }}>{m.glyph} {STATUS_LABELS[key] || "No Activity"}</strong>
                                                <span style={{ color: muted, fontSize: 11 }}>· {dateLabel}{count ? ` · ${count} record${count === 1 ? "" : "s"}` : ""}{vol ? ` · ${vol} m³` : ""}</span>
                                              </div>
                                            );
                                          })()}
                                          {/* Photo banner (first valid gallery photo) or placeholder (#5) */}
                                          <div
                                            style={{
                                              position: "relative",
                                              height: 118,
                                              margin: "-2px -2px 8px",
                                              borderRadius: "8px 8px 0 0",
                                              overflow: "hidden",
                                              background: isDark
                                                ? "linear-gradient(135deg,#1f2933,#111a22)"
                                                : "linear-gradient(135deg,#e6f4ff,#f0f5ff)",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                            }}
                                          >
                                            {photo ? (
                                              <img
                                                src={photo}
                                                alt={rec.lgu}
                                                loading="lazy"
                                                referrerPolicy="no-referrer"
                                                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                                onError={(e) => {
                                                  e.currentTarget.style.display = "none";
                                                  e.currentTarget.parentNode.querySelector("[data-ph]").style.display = "flex";
                                                }}
                                              />
                                            ) : null}
                                            <div
                                              data-ph
                                              style={{
                                                display: photo ? "none" : "flex",
                                                position: "absolute",
                                                inset: 0,
                                                flexDirection: "column",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 4,
                                                color: "#8ab4d8",
                                              }}
                                            >
                                              <BankOutlined style={{ fontSize: 26 }} />
                                              <span style={{ fontSize: 11, color: muted }}>No photo available</span>
                                            </div>
                                            {/* Status ribbon over the photo */}
                                            <span
                                              className={`status-badge ${isOp ? "status-badge-compliant" : isNon ? "status-badge-noncompliant" : "status-badge-pending"}`}
                                              style={{ position: "absolute", top: 8, left: 8, fontSize: 11 }}
                                            >
                                              <SafetyCertificateOutlined />{" "}
                                              {isOp ? "Operational" : isNon ? "Non-Operational" : "Not Yet Monitored"}
                                            </span>
                                          </div>

                                          <div style={{ padding: "0 4px 4px" }}>
                                            <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.25, marginBottom: 4 }}>
                                              {rec.lgu}
                                            </div>
                                            {/* Location + tags */}
                                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                                              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff", color: "#1890ff", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
                                                <EnvironmentOutlined /> {rec.province}
                                              </span>
                                              {rec.barangay && (
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: isDark ? "#303030" : "#f0f0f0", color: "#595959", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
                                                  {rec.barangay}
                                                </span>
                                              )}
                                              {rec.category && (
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff", color: "#722ed1", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
                                                  {rec.category}
                                                </span>
                                              )}
                                              {rec.manilaBayArea === "MBA" && (
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff", color: "#1890ff", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>
                                                  <GlobalOutlined /> MBA
                                                </span>
                                              )}
                                            </div>
                                            {/* Key metadata */}
                                            <div style={{ background: isDark ? "#1f1f1f" : "#fafafa", borderRadius: 6, padding: "6px 8px" }}>
                                              {rec.volumeCapacity != null && (
                                                <InfoRow icon={<BarChartOutlined style={{ color: "#722ed1" }} />} text="Capacity" value={`${Number(rec.volumeCapacity).toLocaleString()} m³`} />
                                              )}
                                              {rec.noOfLGUServed != null && (
                                                <InfoRow icon={<TeamOutlined style={{ color: "#fa8c16" }} />} text="LGUs Served" value={rec.noOfLGUServed} />
                                              )}
                                              {rec.yearStartedOperation && (
                                                <InfoRow icon={<CalendarOutlined style={{ color: "#13c2c2" }} />} text="Year Started" value={rec.yearStartedOperation} />
                                              )}
                                              {rec.ownership && (
                                                <InfoRow icon={<BankOutlined style={{ color: "#2f54eb" }} />} text="Ownership" value={rec.ownership} />
                                              )}
                                            </div>
                                            {(rec.focalPerson || rec.enmo) && (
                                              <div style={{ marginTop: 6 }}>
                                                {rec.focalPerson && (
                                                  <div style={{ display: "flex", alignItems: "center", gap: 5, color: label }}>
                                                    <UserOutlined style={{ color: "#13c2c2" }} /> Focal: <strong>{rec.focalPerson}</strong>
                                                  </div>
                                                )}
                                                {rec.enmo && (
                                                  <div style={{ display: "flex", alignItems: "center", gap: 5, color: label }}>
                                                    <TeamOutlined style={{ color: "#52c41a" }} /> ENMO: <strong>{rec.enmo}</strong>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </Popup>
                                </Marker>
                              ))}
                            </MapContainer>
                          ) : (
                            <div
                              style={{
                                flex: 1,
                                minHeight: 0,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Text type="secondary">No coordinate data available</Text>
                            </div>
                          )}
                        </Card>
                      </div>
                    </Col>
                  </Row>

                  {/* ── Analytics row (replaces By Status / By Category):
                        Waste Submission Trends · Most Active Portal Users ·
                        Waste Volume by SLF. Self-contained data + charts. ── */}
                  <div style={{ marginTop: 16 }}>
                    <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
                      <SlfAnalyticsRow isDark={isDark} period="daily" />
                    </Suspense>
                  </div>

                  {/* Preventive Measures moved to a compact summary tile beside Gas
                      Management (opens the grouped-by-SLF modal). */}

                  {/* ── SLF Dashboard Drill-Down Modals ── */}
                  {slfDashModal && (() => {
                    const mgmtData = (slfFacStats.managementData || []);
                    const PAG = { pageSize: 15, showSizeChanger: true, pageSizeOptions: ["10", "15", "25", "50"], showTotal: (t) => `${t} total entries` };
                    // Long LGU/SLF and province names are clipped with an ellipsis and
                    // revealed in full on hover, so a fixed-width column never wraps to a
                    // taller row or pushes the table past the modal edge.
                    // #3: no `fixed: "left"` — a sticky first column forces a
                    // horizontal scroll container even when the table fits, leaving it
                    // detached from the modal width. Long names ellipsis with a tooltip
                    // instead. Horizontal scroll is enabled per-table only when the
                    // summed column widths genuinely overflow (see recordsScroll below).
                    const slfCol = { title: "LGU / SLF", dataIndex: "slfName", width: 200, ellipsis: { showTitle: false }, render: (v) => <Tooltip title={v}><Text strong style={{ fontSize: 12 }}>{v}</Text></Tooltip> };
                    // A table fits the modal (~1120px body) when its columns sum under
                    // this budget; otherwise it scrolls horizontally to max-content.
                    const recordsScrollX = (cols) => {
                      const sum = (cols || []).reduce((s, c) => s + (Number(c.width) || 160), 0);
                      return sum > 1080 ? "max-content" : undefined;
                    };
                    const provCol = { title: "Province", dataIndex: "province", width: 150, ellipsis: { showTitle: false }, render: (v) => <Tooltip title={v || "—"}><Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Text></Tooltip> };
                    const metricColor = {
                      total: "#2f54eb",
                      cells: "#13c2c2",
                      lgu: "#fa8c16",
                      private: "#722ed1",
                      capacity: "#eb2f96",
                      waste: "#ff4d4f",
                      leachate: "#1890ff",
                      gas: "#52c41a",
                      trashSlide: "#fa8c16",
                      firePrev: "#ff4d4f",
                      preventive: "#fa541c",
                    };
                    const metricValue = (type, row) => {
                      if (type === "total") return 1;
                      if (type === "cells") return row.numberOfCell || 0;
                      if (type === "lgu") return row.noOfLGUServed || 0;
                      if (type === "private") return /private/i.test(row.ownership || "") ? 1 : 0;
                      if (type === "capacity") return row.volumeCapacity || 0;
                      if (type === "waste") return row.actualResidualWasteReceived || 0;
                      if (type === "leachate") return row.noOfLeachatePond || 0;
                      if (type === "gas") return row.numberOfGasVents || 0;
                      if (type === "trashSlide") return row.trashSlideMeasures?.length || 0;
                      if (type === "firePrev") return row.firePrevMeasures?.length || 0;
                      if (type === "preventive") return row.preventiveMeasureFiles?.length || 0;
                      return 0;
                    };

                    const modalConfig = {
                      total: {
                        title: <Space><BankOutlined style={{ color: "#2f54eb" }} /> Total SLF — Facility Portfolio</Space>,
                        filter: () => true,
                        metricLabel: "facilities",
                        flatten: (r) => [{ key: r._id || r.lgu, slfName: r.lgu, province: r.province, status: r.statusOfSLF, ownership: r.ownership, category: r.category, dataYear: r.dataYear }],
                        columns: [
                          slfCol, provCol,
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v ? <Tag color={v.toLowerCase().includes("non") ? "red" : "green"}>{v}</Tag> : "—" },
                          { title: "Ownership", dataIndex: "ownership", width: 130, render: (v) => v || "—" },
                          { title: "Category", dataIndex: "category", width: 90, render: (v) => v ? <Tag color="purple">{v}</Tag> : "—" },
                          { title: "Year", dataIndex: "dataYear", width: 90, align: "center", render: (v) => v || "—" },
                        ],
                      },
                      leachate: {
                        title: <Space><AlertOutlined style={{ color: "#1890ff" }} /> Leachate Management — All Pond Details</Space>,
                        metricLabel: "ponds",
                        filter: (r) => (r.noOfLeachatePond || 0) > 0,
                        flatten: (r) => (r.leachatePondDetails || []).length > 0
                          ? r.leachatePondDetails.map((p, i) => ({ key: `${r.lgu}_${i}`, slfName: r.lgu, province: r.province, pondNo: p.pondNo ?? i + 1, description: p.description, status: p.status, attachments: p.attachments || [] }))
                          : [{ key: r.lgu, slfName: r.lgu, province: r.province, pondNo: "—", description: `${r.noOfLeachatePond} pond(s) — no details entered`, status: "—", attachments: [] }],
                        columns: [
                          slfCol, provCol,
                          { title: "Pond No.", dataIndex: "pondNo", width: 90, align: "center" },
                          { title: "Description", dataIndex: "description", ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v && v !== "—" ? <Tag color={v === "Active" ? "blue" : v === "Under Maintenance" ? "orange" : "default"}>{v}</Tag> : "—" },
                          { title: "Attachments", dataIndex: "attachments", width: 110, align: "center", render: (v) => (v || []).length ? <Tag color="geekblue">{v.length} file(s)</Tag> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                        ],
                      },
                      gas: {
                        title: <Space><SafetyCertificateOutlined style={{ color: "#52c41a" }} /> Gas Management — All Vent Details</Space>,
                        metricLabel: "vents",
                        filter: (r) => (r.numberOfGasVents || 0) > 0,
                        flatten: (r) => (r.gasVentDetails || []).length > 0
                          ? r.gasVentDetails.map((g, i) => ({ key: `${r.lgu}_${i}`, slfName: r.lgu, province: r.province, ventNo: g.ventNo ?? i + 1, ventType: g.ventType, description: g.description, status: g.status, attachments: g.attachments || [] }))
                          : [{ key: r.lgu, slfName: r.lgu, province: r.province, ventNo: "—", ventType: "—", description: `${r.numberOfGasVents} vent(s) — no details entered`, status: "—", attachments: [] }],
                        columns: [
                          slfCol, provCol,
                          { title: "Vent No.", dataIndex: "ventNo", width: 90, align: "center" },
                          { title: "Type", dataIndex: "ventType", width: 130, render: (v) => v || "—" },
                          { title: "Description", dataIndex: "description", ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v && v !== "—" ? <Tag color={v === "Active" ? "green" : v === "Under Maintenance" ? "orange" : "default"}>{v}</Tag> : "—" },
                          { title: "Attachments", dataIndex: "attachments", width: 110, align: "center", render: (v) => (v || []).length ? <Tag color="cyan">{v.length} file(s)</Tag> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                        ],
                      },
                      trashSlide: {
                        title: <Space><WarningOutlined style={{ color: "#fa8c16" }} /> Trash Slide Prevention — All Measures</Space>,
                        metricLabel: "measures",
                        filter: (r) => (r.trashSlideMeasures?.length || 0) > 0,
                        flatten: (r) => (r.trashSlideMeasures || []).map((m, i) => ({ key: `${r.lgu}_${i}`, facilityId: r._id, slfName: r.lgu, province: r.province, measure: m.measure, description: m.description, status: m.status, attachments: m.attachments || [] })),
                        columns: [
                          slfCol, provCol,
                          { title: "Measure", dataIndex: "measure", width: 200, ellipsis: { showTitle: false }, render: (v) => <Tooltip title={v}>{v || "—"}</Tooltip> },
                          { title: "Description", dataIndex: "description", width: 320, ellipsis: { showTitle: false }, render: (v) => v ? <Tooltip title={v}>{v}</Tooltip> : <Text type="secondary">—</Text> },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v ? <Tag color={v === "Implemented" ? "green" : v === "Pending" ? "orange" : "default"}>{v}</Tag> : "—" },
                          { title: "Documents & Summary", dataIndex: "attachments", width: 180, align: "center", render: (v, row) => (v || []).length ? <Button size="small" icon={<RobotOutlined />} onClick={() => setPreventionPanel({ facilityId: row.facilityId, slfName: row.slfName })}>{v.length} doc{v.length === 1 ? "" : "s"} · Summarize</Button> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                        ],
                      },
                      firePrev: {
                        title: <Space><FireOutlined style={{ color: "#ff4d4f" }} /> Fire Prevention — All Measures</Space>,
                        metricLabel: "measures",
                        filter: (r) => (r.firePrevMeasures?.length || 0) > 0,
                        flatten: (r) => (r.firePrevMeasures || []).map((m, i) => ({ key: `${r.lgu}_${i}`, facilityId: r._id, slfName: r.lgu, province: r.province, measure: m.measure, description: m.description, status: m.status, attachments: m.attachments || [] })),
                        columns: [
                          slfCol, provCol,
                          { title: "Measure", dataIndex: "measure", width: 200, ellipsis: { showTitle: false }, render: (v) => <Tooltip title={v}>{v || "—"}</Tooltip> },
                          { title: "Description", dataIndex: "description", width: 320, ellipsis: { showTitle: false }, render: (v) => v ? <Tooltip title={v}>{v}</Tooltip> : <Text type="secondary">—</Text> },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v ? <Tag color={v === "Implemented" ? "green" : v === "Pending" ? "orange" : "default"}>{v}</Tag> : "—" },
                          { title: "Documents & Summary", dataIndex: "attachments", width: 180, align: "center", render: (v, row) => (v || []).length ? <Button size="small" icon={<RobotOutlined />} onClick={() => setPreventionPanel({ facilityId: row.facilityId, slfName: row.slfName })}>{v.length} doc{v.length === 1 ? "" : "s"} · Summarize</Button> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                        ],
                      },
                      // Flat "Preventive Measures" files uploaded in the SLF Data
                      // Table's Preventive Measures tab (stored as preventiveMeasureFiles).
                      // These previously had no dashboard tab, so "Other SLF" files never
                      // surfaced here and could not be opened.
                      preventive: {
                        title: <Space><SafetyCertificateOutlined style={{ color: "#fa541c" }} /> Preventive Measures (Fire Prevention and Trash Slide) — Files</Space>,
                        metricLabel: "files",
                        filter: (r) => (r.preventiveMeasureFiles?.length || 0) > 0,
                        flatten: (r) => (r.preventiveMeasureFiles || []).map((url, i) => {
                          const fileName = getPreventiveFileName(url, "document");
                          return { key: `${r.lgu}_${i}`, facilityId: r._id, slfName: r.lgu, province: r.province, url, fileName, kind: getPreventiveFileKind(fileName, url) };
                        }),
                        columns: [
                          slfCol, provCol,
                          { title: "File", dataIndex: "fileName", ellipsis: { showTitle: false }, render: (v) => <Tooltip title={v}><Space size={6}><FileTextOutlined style={{ color: "#fa541c" }} /><Text style={{ fontSize: 12 }}>{v}</Text></Space></Tooltip> },
                          { title: "Action", dataIndex: "url", width: 150, align: "center", render: (url, row) => url ? (
                            <Space size={4}>
                              <Tooltip title="View in modal"><Button size="small" icon={<EyeOutlined />} onClick={() => openPreventiveFileViewer({ url, fileName: row.fileName || getPreventiveFileName(url, "document"), slfName: row.slfName, province: row.province, kind: row.kind })} /></Tooltip>
                              <Tooltip title="Open in new tab"><Button size="small" icon={<LinkOutlined />} onClick={() => window.open(resolveMediaOpenUrl(url), "_blank", "noopener,noreferrer")}>Open</Button></Tooltip>
                            </Space>
                          ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                        ],
                      },
                      cells: {
                        title: <Space><ContainerOutlined style={{ color: "#13c2c2" }} /> Cell Infrastructure — All Facilities</Space>,
                        metricLabel: "cells",
                        filter: (r) => (r.numberOfCell || 0) > 0,
                        flatten: (r) => {
                          const caps = r.cellCapacities || [];
                          const fills = r.cellFillValues || [];
                          const maxCap = Math.max(...caps.filter(c => c != null), 1);
                          return Array.from({ length: r.numberOfCell || 0 }, (_, i) => ({
                            key: `${r.lgu}_${i}`,
                            slfName: r.lgu,
                            province: r.province,
                            cellNo: i + 1,
                            type: (r.cellTypes || [])[i] || "—",
                            capacity: caps[i] ?? null,
                            fill: fills[i] ?? null,
                            maxCap,
                            status: (r.cellStatuses || [])[i] || "—",
                          }));
                        },
                        columns: [
                          slfCol, provCol,
                          { title: "Cell No.", dataIndex: "cellNo", width: 90, align: "center", render: (v) => <Tag color="cyan" style={{ fontWeight: 700, minWidth: 42, textAlign: "center" }}>Cell {v}</Tag> },
                          { title: "Type", dataIndex: "type", width: 140, render: (v) => {
                            if (!v || v === "—") return "—";
                            const color = v.toLowerCase().includes("hazard") ? "red" : v.toLowerCase().includes("resid") ? "geekblue" : "blue";
                            return <Tag color={color}>{v}</Tag>;
                          }},
                          { title: "Fill / Capacity", key: "capacityViz", width: 150, align: "center", render: (_, row) => {
                            if (row.capacity == null) return <Text type="secondary">—</Text>;
                            // Gauge = cell fill vs this cell's capacity (falls back to
                            // relative-to-largest when no fill value is recorded).
                            const pct = row.fill != null
                              ? computeGaugePercent({ usedCapacity: row.fill, totalCapacity: row.capacity })
                              : computeGaugePercent({ usedCapacity: row.capacity, totalCapacity: row.maxCap });
                            const gcolor = (pct ?? 0) > 75 ? "#ff4d4f" : (pct ?? 0) > 40 ? "#fa8c16" : "#52c41a";
                            return (
                              <div>
                                <GaugeMeter percent={pct} size={72} thickness={7} color={gcolor} noDataText="—" />
                                <Text type="secondary" style={{ fontSize: 10 }}>{Number(row.capacity).toLocaleString()} m³</Text>
                              </div>
                            );
                          }},
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => {
                            if (!v || v === "—") return "—";
                            const cfgStatus = getCellStatusConfig(v);
                            return <Tag color={cfgStatus.tag}>{cfgStatus.label || v}</Tag>;
                          } },
                        ],
                      },
                      capacity: {
                        title: <Space><BarChartOutlined style={{ color: "#eb2f96" }} /> Total Capacity — Per SLF</Space>,
                        metricLabel: "capacity",
                        filter: (r) => (r.volumeCapacity || 0) > 0,
                        flatten: (r) => [{ key: r.lgu, slfName: r.lgu, province: r.province, volumeCapacity: r.volumeCapacity, status: r.statusOfSLF, ownership: r.ownership, category: r.category }],
                        columns: [
                          slfCol, provCol,
                          { title: "Volume Capacity (m³)", dataIndex: "volumeCapacity", width: 190, align: "right", render: (v) => v ? <Text strong style={{ color: "#eb2f96" }}>{Number(v).toLocaleString()}</Text> : "—" },
                          { title: "Ownership", dataIndex: "ownership", width: 130, render: (v) => v || "—" },
                          { title: "Category", dataIndex: "category", width: 90, render: (v) => v ? <Tag color="purple">{v}</Tag> : "—" },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v ? <Tag color={v.toLowerCase().includes("non") ? "red" : "green"}>{v}</Tag> : "—" },
                        ],
                      },
                      lgu: {
                        title: <Space><TeamOutlined style={{ color: "#fa8c16" }} /> LGUs Served — Per SLF</Space>,
                        metricLabel: "LGUs served",
                        filter: (r) => (r.noOfLGUServed || 0) > 0,
                        flatten: (r) => [{ key: r.lgu, slfName: r.lgu, province: r.province, lguCount: r.noOfLGUServed, status: r.statusOfSLF, ownership: r.ownership, category: r.category }],
                        columns: [
                          slfCol, provCol,
                          { title: "LGUs Served", dataIndex: "lguCount", width: 120, align: "center", render: (v) => <Tag color="orange" style={{ fontWeight: 700 }}>{v ?? "—"}</Tag> },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v ? <Tag color={v.toLowerCase().includes("non") ? "red" : "green"}>{v}</Tag> : "—" },
                          { title: "Ownership", dataIndex: "ownership", width: 130, render: (v) => v || "—" },
                          { title: "Category", dataIndex: "category", width: 90, render: (v) => v ? <Tag color="purple">{v}</Tag> : "—" },
                        ],
                      },
                      waste: {
                        title: <Space><BarChartOutlined style={{ color: "#ff4d4f" }} /> Waste Received — Per SLF</Space>,
                        metricLabel: "tons received",
                        filter: (r) => (r.actualResidualWasteReceived || 0) > 0,
                        flatten: (r) => [{ key: r.lgu, slfName: r.lgu, province: r.province, wasteReceived: r.actualResidualWasteReceived, status: r.statusOfSLF, ownership: r.ownership }],
                        columns: [
                          slfCol, provCol,
                          { title: "Waste Received (tons)", dataIndex: "wasteReceived", width: 180, align: "right", render: (v) => v ? Number(v).toLocaleString() : "—" },
                          { title: "Ownership", dataIndex: "ownership", width: 130, render: (v) => v || "—" },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v ? <Tag color={v.toLowerCase().includes("non") ? "red" : "green"}>{v}</Tag> : "—" },
                        ],
                      },
                      private: {
                        title: <Space><BankOutlined style={{ color: "#722ed1" }} /> Private Sector Served — SLF Portfolio</Space>,
                        metricLabel: "private SLFs",
                        filter: (r) => /private/i.test(r.ownership || ""),
                        flatten: (r) => [{ key: r.lgu, slfName: r.lgu, province: r.province, ownership: r.ownership, status: r.statusOfSLF, category: r.category, lguCount: r.noOfLGUServed || 0 }],
                        columns: [
                          slfCol, provCol,
                          { title: "Ownership", dataIndex: "ownership", width: 130, render: (v) => <Tag color="purple">{v || "Private"}</Tag> },
                          { title: "LGUs Served", dataIndex: "lguCount", width: 120, align: "center", render: (v) => <Tag color="orange" style={{ fontWeight: 700 }}>{v ?? "—"}</Tag> },
                          { title: "Category", dataIndex: "category", width: 90, render: (v) => v ? <Tag color="purple">{v}</Tag> : "—" },
                          { title: "Status", dataIndex: "status", width: 150, render: (v) => v ? <Tag color={v.toLowerCase().includes("non") ? "red" : "green"}>{v}</Tag> : "—" },
                        ],
                      },
                    };
                    // ── Combined tabbed modals ──
                    // LGUs + Private Sectors Served, and Trash Slide + Fire
                    // Prevention, share one modal with a tab per sub-metric. Each
                    // tab reuses the same per-type config (filter/flatten/columns),
                    // so there is no duplicated data logic.
                    if (slfDashModal.combo) {
                      const comboMeta = {
                        served: {
                          title: <Space><TeamOutlined style={{ color: "#fa8c16" }} /> LGUs &amp; Private Sectors Served</Space>,
                          tabs: [
                            { key: "summary", label: <span><BarChartOutlined /> Summary</span>, custom: "summary" },
                            { key: "lgu", label: <span><TeamOutlined /> LGUs Served</span> },
                            { key: "private", label: <span><BankOutlined /> Private Sectors Served</span> },
                          ],
                        },
                        prevention: {
                          title: <Space><SafetyCertificateOutlined style={{ color: "#fa541c" }} /> Preventive Measures (Fire Prevention and Trash Slide)</Space>,
                          tabs: [
                            { key: "preventive", label: <span><FileTextOutlined /> Files</span> },
                          ],
                        },
                      }[slfDashModal.combo];
                      if (!comboMeta) return null;
                      return (
                        <Modal
                          open
                          title={comboMeta.title}
                          onCancel={() => setSlfDashModal(null)}
                          footer={
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <Button onClick={() => setSlfDashModal(null)}>Close</Button>
                              <Button type="primary" icon={<TableOutlined />} onClick={() => { setSlfDashModal(null); setActiveMenu("slf-monitoring"); }}>
                                View in SLF Monitoring
                              </Button>
                            </div>
                          }
                          width={1400}
                          style={{ top: 24, maxWidth: "96vw" }}
                          destroyOnHidden
                          styles={{ body: { maxHeight: "calc(100vh - 200px)", overflowY: "auto", overflowX: "hidden" } }}
                        >
                          <Tabs
                            defaultActiveKey={comboMeta.tabs[0].key}
                            items={comboMeta.tabs.map((t) => {
                              // Overview tab: tiles + charts derived from the same
                              // relationship-map endpoint the LGU/Private tabs use.
                              if (t.custom === "summary") {
                                return {
                                  key: t.key,
                                  label: t.label,
                                  children: (
                                    <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
                                      <ClientServedSummary />
                                    </Suspense>
                                  ),
                                };
                              }
                              // Custom-rendered tabs (e.g. Clients from Haulers) do not
                              // use the filter/flatten/columns config.
                              if (t.custom === "clients") {
                                return {
                                  key: t.key,
                                  label: t.label,
                                  children: (
                                    <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
                                      <HaulerClientsPanel />
                                    </Suspense>
                                  ),
                                };
                              }
                              // Item #2: LGUs Served / Private Sectors — master-list-based
                              // relationship map (deduped by client id, multi-hauler/SLF
                              // detection, unserved LGUs), replacing the old submission-derived
                              // filter/flatten view.
                              if (t.key === "lgu" || t.key === "private") {
                                return {
                                  key: t.key,
                                  label: t.label,
                                  children: (
                                    <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
                                      <ClientRelationshipView type={t.key === "lgu" ? "LGU" : "Private Sector"} />
                                    </Suspense>
                                  ),
                                };
                              }
                              const c = modalConfig[t.key];
                              const rows = mgmtData.filter(c.filter);
                              const data = rows.flatMap(c.flatten);
                              const total = rows.reduce((sum, row) => sum + metricValue(t.key, row), 0);
                              return {
                                key: t.key,
                                label: t.label,
                                children: (
                                  <>
                                    <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                                      <Col xs={12} md={8}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title={c.metricLabel} value={total} formatter={(v) => Number(v || 0).toLocaleString()} valueStyle={{ color: metricColor[t.key] }} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={8}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Reporting SLFs" value={rows.length} />
                                        </Card>
                                      </Col>
                                      <Col xs={24} md={8}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Record Rows" value={data.length} />
                                        </Card>
                                      </Col>
                                    </Row>
                                    {data.length ? (
                                      <Table dataSource={data} columns={c.columns} size="small" tableLayout="fixed" pagination={PAG} scroll={{ x: recordsScrollX(c.columns), y: 420 }} bordered />
                                    ) : (
                                      <Empty description="No records available for this category." />
                                    )}
                                  </>
                                ),
                              };
                            })}
                          />
                        </Modal>
                      );
                    }

                    const cfg = modalConfig[slfDashModal.type];
                    const sourceRows = cfg ? mgmtData.filter(cfg.filter) : [];
                    const flatData = cfg ? sourceRows.flatMap(cfg.flatten) : [];
                    const color = metricColor[slfDashModal.type] || "#2f54eb";
                    const totalMetricValue = sourceRows.reduce((sum, row) => sum + metricValue(slfDashModal.type, row), 0);
                    const provinceData = Object.entries(sourceRows.reduce((acc, row) => {
                      const province = row.province || "Unspecified";
                      acc[province] = (acc[province] || 0) + metricValue(slfDashModal.type, row);
                      return acc;
                    }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
                    const statusData = Object.entries(sourceRows.reduce((acc, row) => {
                      const status = row.statusOfSLF || "Unspecified";
                      acc[status] = (acc[status] || 0) + 1;
                      return acc;
                    }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
                    const topFacilities = sourceRows
                      .map((row) => ({
                        name: row.lgu || "Unspecified SLF",
                        province: row.province || "—",
                        status: row.statusOfSLF || "—",
                        value: metricValue(slfDashModal.type, row),
                      }))
                      .sort((a, b) => b.value - a.value)
                      .slice(0, 8);
                    const maxProvince = Math.max(...provinceData.map((item) => item.value), 1);
                    const maxFacility = Math.max(...topFacilities.map((item) => item.value), 1);

                    // ── Gauge data for Cell Infrastructure & Total Capacity ──
                    // Per-facility cell utilization = summed cell fill / summed cell
                    // capacity. computeGaugePercent returns null when capacity data
                    // is missing so the gauge shows "No capacity data available".
                    // Every total below is rendered as m³, so every value is
                    // NORMALIZED to m³ first. Previously the raw stored numbers were
                    // summed straight into an "m³" label — a facility that declares
                    // tons (via Set Field Units) silently contributed tons, making
                    // the total 5× too low for that SLF. Cell capacity and cell fill
                    // can even carry DIFFERENT units on the same cell, so each is
                    // converted from its own declared unit.
                    const toM3 = (value, unit) => convertVolume(value, unit, "m³");
                    const cellGaugeFacilities = mgmtData
                      .filter((r) => (r.numberOfCell || 0) > 0)
                      .map((r) => {
                        const caps = r.cellCapacities || [];
                        const fills = r.cellFillValues || [];
                        const statuses = r.cellStatuses || [];
                        const types = r.cellTypes || [];
                        const n = r.numberOfCell || 0;
                        let totalCap = 0, totalFill = 0, opCells = 0;
                        const cells = [];
                        for (let i = 0; i < n; i++) {
                          const status = statuses[i] || "";
                          // Same rule as the Cell Infra Overview: a cell that does
                          // not exist is neither listed nor counted.
                          if (isNonExistentCell(status)) continue;
                          const statusConfig = getCellStatusConfig(status);
                          const capUnit = resolveCellUnit(r, i, "capacity");
                          const fillUnit = resolveCellUnit(r, i, "fill");
                          const cap = toM3(caps[i], capUnit) ?? 0;
                          const fill = toM3(fills[i], fillUnit);
                          if (cap > 0) { totalCap += cap; totalFill += Number(fill || 0); }
                          if (statusConfig.key === "active") opCells++;
                          cells.push({
                            index: i,
                            // Canonical name from the cell infrastructure.
                            name: resolveCellName(r, i),
                            type: types[i] || "—",
                            status: status || "—",
                            statusConfig,
                            typeConfig: getCellTypeConfig(types[i]),
                            capacity: cap > 0 ? cap : null,
                            fill: Number.isFinite(fill) ? fill : null,
                            remaining: cap > 0 && Number.isFinite(fill) ? Math.max(0, cap - fill) : null,
                            unit: "m³", // normalized
                            percent: computeGaugePercent({ usedCapacity: fill, totalCapacity: cap }),
                          });
                        }
                        return {
                          key: r._id || r.lgu, name: r.lgu, province: r.province,
                          status: r.statusOfSLF, numberOfCell: cells.length, opCells, totalCap, totalFill, cells,
                          percent: computeGaugePercent({ usedCapacity: totalFill, totalCapacity: totalCap }),
                        };
                      })
                      .sort((a, b) => (b.opCells - a.opCells) || (b.numberOfCell - a.numberOfCell));
                    const cellsOverall = cellGaugeFacilities.reduce(
                      (a, f) => ({ cap: a.cap + f.totalCap, fill: a.fill + f.totalFill, cells: a.cells + f.numberOfCell, op: a.op + f.opCells }),
                      { cap: 0, fill: 0, cells: 0, op: 0 },
                    );
                    const cellsOverallPercent = computeGaugePercent({ usedCapacity: cellsOverall.fill, totalCapacity: cellsOverall.cap });
                    // Group facility tiles by province for the modal. A stable global
                    // index is carried alongside each facility so the SLF palette
                    // colour stays consistent regardless of grouping. Province groups
                    // are ordered by facility count (busiest first), then name.
                    const stripProvince = (p) => String(p || "").replace(/^Province of\s+/i, "").trim() || "Unspecified";
                    const cellGaugeByProvince = (() => {
                      const groups = new Map();
                      cellGaugeFacilities.forEach((f, idx) => {
                        const prov = stripProvince(f.province);
                        if (!groups.has(prov)) groups.set(prov, []);
                        groups.get(prov).push({ f, idx });
                      });
                      return [...groups.entries()].sort(
                        (a, b) => (b[1].length - a[1].length) || a[0].localeCompare(b[0]),
                      );
                    })();
                    // Selected SLF for the Cell Infrastructure per-cell drill-down.
                    const drillFacility = slfCellDrill ? cellGaugeFacilities.find((f) => f.key === slfCellDrill) : null;
                    const provinceActiveKeys = cellProvinceExpanded ?? (cellGaugeByProvince.length <= 1 ? cellGaugeByProvince.map(([province]) => province) : []);

                    // Per-facility volume-capacity utilization = waste received / volume capacity.
                    // volumeCapacity and actualResidualWasteReceived each carry their
                    // OWN declared unit (volumeCapacityUnit / wasteReceivedUnit) and
                    // may disagree, so both are normalized to m³ before the ratio and
                    // before summing across SLFs.
                    const capacityGaugeFacilities = mgmtData
                      .filter((r) => (r.volumeCapacity || 0) > 0)
                      .map((r) => {
                        const cap = toM3(r.volumeCapacity, r.volumeCapacityUnit) ?? 0;
                        const used = toM3(r.actualResidualWasteReceived, r.wasteReceivedUnit) ?? 0;
                        return {
                          key: r._id || r.lgu, name: r.lgu, province: r.province, status: r.statusOfSLF,
                          totalCap: cap, used,
                          percent: computeGaugePercent({ usedCapacity: used, totalCapacity: cap }),
                        };
                      })
                      .sort((a, b) => b.totalCap - a.totalCap);
                    const capacityOverall = capacityGaugeFacilities.reduce(
                      (a, f) => ({ cap: a.cap + f.totalCap, used: a.used + f.used }),
                      { cap: 0, used: 0 },
                    );
                    const capacityOverallPercent = computeGaugePercent({ usedCapacity: capacityOverall.used, totalCapacity: capacityOverall.cap });
                    return (
                      <Modal
                        open
                        title={cfg.title}
                        onCancel={() => { setSlfDashModal(null); setSlfCellDrill(null); }}
                        footer={
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <Button onClick={() => { setSlfDashModal(null); setSlfCellDrill(null); }}>Close</Button>
                            <Button type="primary" icon={<TableOutlined />} onClick={() => { setSlfDashModal(null); setSlfCellDrill(null); setActiveMenu("slf-monitoring"); }}>
                              View in SLF Data Table
                            </Button>
                          </div>
                        }
                        width={1160}
                        style={{ top: 24, maxWidth: "96vw" }}
                        styles={{
                          body: {
                            maxHeight: "calc(100vh - 160px)",
                            overflowY: "auto",
                            overflowX: "hidden",
                          },
                        }}
                        destroyOnHidden
                      >
                        {flatData.length === 0 ? (
                          <Empty description="No data available for this category." />
                        ) : (
                          (() => {
                            const dashItems = [
                              {
                                key: "dashboard",
                                label: <span><PieChartOutlined /> Dashboard</span>,
                                children: (slfDashModal.type === "leachate" || slfDashModal.type === "gas") ? (
                                  <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
                                    <SlfManagementBySlf facilities={sourceRows} kind={slfDashModal.type} />
                                  </Suspense>
                                ) : slfDashModal.type === "cells" ? (
                                  <>
                                    {/* #1: summary tiles removed — the modal now shows
                                        the facility/cell gauges directly. */}
                                    <Card
                                      size="small"
                                      title={
                                        drillFacility ? (
                                          <Space wrap>
                                            <Button size="small" type="primary" onClick={() => setSlfCellDrill(null)}>← Back</Button>
                                            <span>{drillFacility.name} — Cell Breakdown</span>
                                          </Space>
                                        ) : (
                                          <>Sanitary Landfill Cell Operations <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>(click a card for cell details)</Text></>
                                        )
                                      }
                                      style={{ borderRadius: 8 }}
                                      styles={{ body: { maxHeight: "min(78vh, 1000px)", overflowY: "auto" } }}
                                    >
                                      {cellGaugeFacilities.length === 0 ? (
                                        <Empty description="No cell infrastructure data available." />
                                      ) : drillFacility ? (
                                        <>
                                          <div style={{ marginBottom: 12 }}>
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                              {drillFacility.province} • {drillFacility.numberOfCell} cells • {drillFacility.opCells} operational
                                            </Text>
                                          </div>
                                          <Row gutter={[12, 12]}>
                                            {drillFacility.cells.map((c) => (
                                              <Col xs={12} sm={8} md={6} key={c.index}>
                                                {/* #1: gauge auto-colored by Cell TYPE
                                                    (stroke) and Cell STATUS (fill style
                                                    + opacity), matching Cell Infra
                                                    Overview's CellGauge. */}
                                                <Card size="small" style={{ borderRadius: 8, height: "100%", borderTop: `3px solid ${c.typeConfig.color}` }}>
                                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6 }}>
                                                    <Text strong style={{ fontSize: 12 }}>{c.name}</Text>
                                                    <Badge status={c.statusConfig.badge} text={<span style={{ fontSize: 10 }}>{c.status}</span>} />
                                                  </div>
                                                  <GaugeMeter
                                                    percent={c.percent}
                                                    size={96}
                                                    thickness={6}
                                                    color={c.typeConfig.color}
                                                    fillStyle={c.statusConfig.fill}
                                                    fillOpacity={c.statusConfig.opacity}
                                                  />
                                                  <div style={{ fontSize: 11, marginTop: 6 }}>
                                                    <div><Text type="secondary">Type: </Text><Tag color={c.typeConfig.tag} style={{ margin: 0, fontSize: 10 }}>{c.type}</Tag></div>
                                                    <div>
                                                      <Text type="secondary">Capacity: </Text>
                                                      {c.capacity != null ? `${c.capacity.toLocaleString()} ${c.unit}` : <Text type="secondary">No capacity data available</Text>}
                                                    </div>
                                                    {c.fill != null && <div><Text type="secondary">Used: </Text>{c.fill.toLocaleString()} {c.unit}</div>}
                                                    {c.remaining != null && <div><Text type="secondary">Remaining: </Text>{c.remaining.toLocaleString()} {c.unit}</div>}
                                                    {c.capacity == null && c.fill == null && (
                                                      <div><Text type="secondary" italic>No numeric data recorded for this cell.</Text></div>
                                                    )}
                                                  </div>
                                                </Card>
                                              </Col>
                                            ))}
                                          </Row>
                                        </>
                                      ) : (
                                        /* Render EVERY facility with cell data — no cap (modal
                                           body scrolls), grouped by province with a header per
                                           group so operators can scan each province at a glance. */
                                        <>
                                          <Collapse
                                            size="small"
                                            activeKey={provinceActiveKeys}
                                            onChange={(keys) => setCellProvinceExpanded(Array.isArray(keys) ? keys : [keys].filter(Boolean))}
                                            items={cellGaugeByProvince.map(([province, items]) => ({
                                              key: province,
                                              label: (
                                                <Space size={8} wrap>
                                                  <EnvironmentOutlined style={{ color: "#1677ff" }} />
                                                  <Text strong style={{ fontSize: 13 }}>{province}</Text>
                                                  <Tag color="blue" style={{ marginLeft: 2 }}>{items.length} SLF{items.length === 1 ? "" : "s"}</Tag>
                                                </Space>
                                              ),
                                              children: (
                                                <Row gutter={[12, 12]}>
                                                  {items.map(({ f, idx }) => {
                                                    // Each SLF keeps its own palette colour below the
                                                    // warning band; the gauge then escalates to
                                                    // warning/alarming/critical as it fills.
                                                    const slfColor = getSlfColor(f.key, idx);
                                                    const gaugeColor = getSlfCapacityColor(f.percent, {
                                                      baseColor: slfColor,
                                                      exists: f.numberOfCell > 0,
                                                    });
                                                    return (
                                                      <Col xs={12} sm={8} md={6} key={f.key}>
                                                        <Card size="small" hoverable onClick={() => setSlfCellDrill(f.key)} style={{ borderRadius: 8, textAlign: "center", height: "100%", cursor: "pointer", borderTop: `3px solid ${slfColor}` }}>
                                                          {/* #1: thinner arc, coloured by SLF palette + capacity band */}
                                                          <GaugeMeter percent={f.percent} size={112} thickness={6} color={gaugeColor} />
                                                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{f.name}</div>
                                                          <Text type="secondary" style={{ fontSize: 11 }}>{f.province}</Text>
                                                          <div style={{ marginTop: 4 }}>
                                                            <Tag color="cyan">{f.numberOfCell} cells</Tag>
                                                            <Tag color="green">{f.opCells} op</Tag>
                                                          </div>
                                                          <div style={{ marginTop: 2 }}><Text type="secondary" style={{ fontSize: 10 }}>Click to view cells</Text></div>
                                                        </Card>
                                                      </Col>
                                                    );
                                                  })}
                                                </Row>
                                              ),
                                            }))}
                                          />
                                        </>
                                      )}
                                    </Card>
                                  </>
                                ) : slfDashModal.type === "capacity" ? (
                                  <>
                                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                                      <Col xs={24} md={8}>
                                        <Card size="small" style={{ borderRadius: 8, border: `1px solid ${color}33`, background: `${color}0d` }}>
                                          <GaugeMeter
                                            percent={capacityOverallPercent}
                                            color={color}
                                            label="Overall Capacity Used"
                                            valueText={capacityOverall.cap > 0 ? `${capacityOverall.used.toLocaleString()} / ${capacityOverall.cap.toLocaleString()} m³` : undefined}
                                          />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={8}>
                                        <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }}>
                                          <Statistic title="Total Capacity (m³)" value={capacityOverall.cap} valueStyle={{ color, fontSize: 22 }} formatter={(v) => Number(v || 0).toLocaleString()} />
                                        </Card>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Waste Received (m³)" value={capacityOverall.used} valueStyle={{ fontSize: 22 }} formatter={(v) => Number(v || 0).toLocaleString()} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={8}>
                                        <Card size="small" style={{ borderRadius: 8, marginBottom: 12 }}>
                                          <Statistic title="Facilities w/ Capacity" value={capacityGaugeFacilities.length} valueStyle={{ fontSize: 22 }} />
                                        </Card>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Province Coverage" value={provinceData.length} valueStyle={{ fontSize: 22 }} />
                                        </Card>
                                      </Col>
                                    </Row>
                                    <Card size="small" title={<><BarChartOutlined /> SLF Capacity Gauges</>} style={{ borderRadius: 8 }}>
                                      {capacityGaugeFacilities.length === 0 ? (
                                        <Empty description="No capacity data available." />
                                      ) : (
                                        <Row gutter={[12, 12]}>
                                          {/* Render every facility (no 12-cap) — modal scrolls. */}
                                          {capacityGaugeFacilities.map((f, idx) => {
                                            const slfColor = getSlfColor(f.key, idx);
                                            const gaugeColor = getSlfCapacityColor(f.percent, {
                                              baseColor: slfColor,
                                              exists: f.totalCap > 0,
                                            });
                                            return (
                                              <Col xs={12} sm={8} md={6} key={f.key}>
                                                <Card size="small" style={{ borderRadius: 8, textAlign: "center", height: "100%", borderTop: `3px solid ${slfColor}` }}>
                                                  <GaugeMeter percent={f.percent} size={112} color={gaugeColor} />
                                                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{f.name}</div>
                                                  <Text type="secondary" style={{ fontSize: 11 }}>{f.province}</Text>
                                                  <div style={{ marginTop: 4 }}>
                                                    <Tag color="magenta">{Number(f.totalCap).toLocaleString()} m³</Tag>
                                                  </div>
                                                </Card>
                                              </Col>
                                            );
                                          })}
                                        </Row>
                                      )}
                                    </Card>
                                  </>
                                ) : slfDashModal.type === "waste" ? (
                                  <>
                                    {/* Waste Received — charts sourced from Portal Submissions (/data-slf/stats). */}
                                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8, border: `1px solid ${color}33`, background: `${color}0d` }}>
                                          <Statistic title="Facility Waste Received" value={totalMetricValue} suffix={cfg.metricLabel} valueStyle={{ color, fontSize: 20 }} formatter={(v) => Number(v || 0).toLocaleString()} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Portal Submissions" value={stats?.submissions || 0} valueStyle={{ fontSize: 20 }} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Portal Truck Trips" value={stats?.totalTrucks || 0} valueStyle={{ fontSize: 20 }} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Reporting SLFs" value={sourceRows.length} valueStyle={{ fontSize: 20 }} />
                                        </Card>
                                      </Col>
                                    </Row>
                                    <Row gutter={[16, 16]}>
                                      <Col xs={24} lg={14}>
                                        <Card size="small" title={<><BarChartOutlined /> Monthly Waste Volume — Portal Submissions</>} style={{ borderRadius: 8, height: "100%" }}>
                                          {monthlyChartData.length === 0 ? (
                                            <Empty description="No portal submission data available." />
                                          ) : (
                                            <ResponsiveContainer width="100%" height={260}>
                                              <BarChart data={monthlyChartData}>
                                                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                <XAxis dataKey="name" fontSize={11} />
                                                <YAxis fontSize={11} />
                                                <RechartsTooltip formatter={(v, n) => [Number(v).toLocaleString(), n === "volume" ? "Volume" : "Submissions"]} />
                                                <Bar dataKey="volume" fill={color} radius={[4, 4, 0, 0]} name="volume" isAnimationActive={false} />
                                              </BarChart>
                                            </ResponsiveContainer>
                                          )}
                                        </Card>
                                      </Col>
                                      <Col xs={24} lg={10}>
                                        <Card size="small" title="Waste by Type — Portal Submissions" style={{ borderRadius: 8, height: "100%" }}>
                                          {wasteTypeChartData.length === 0 ? (
                                            <Empty description="No waste-type data available." />
                                          ) : (
                                            <ResponsiveContainer width="100%" height={260}>
                                              <BarChart data={wasteTypeChartData} layout="vertical">
                                                <XAxis type="number" fontSize={11} />
                                                <YAxis type="category" dataKey="name" width={90} fontSize={11} />
                                                <RechartsTooltip formatter={(v) => Number(v).toLocaleString()} />
                                                <Bar dataKey="volume" fill={color} radius={[0, 4, 4, 0]} name="volume" isAnimationActive={false} />
                                              </BarChart>
                                            </ResponsiveContainer>
                                          )}
                                        </Card>
                                      </Col>
                                    </Row>
                                  </>
                                ) : (slfDashModal.type === "leachate" || slfDashModal.type === "gas") ? (
                                  (() => {
                                    // Domain summary + status distribution derived
                                    // ONLY from fields that exist on the records
                                    // (pond/vent details). No fabricated metrics.
                                    const hasDetail = (r) => r.status && r.status !== "—";
                                    const detailRows = flatData.filter(hasDetail);
                                    const opCount = detailRows.filter((r) => /active|operational/i.test(r.status || "")).length;
                                    const maintCount = detailRows.filter((r) => /maintenance/i.test(r.status || "")).length;
                                    const statusDist = Object.entries(
                                      detailRows.reduce((acc, r) => {
                                        const s = String(r.status || "Unspecified");
                                        acc[s] = (acc[s] || 0) + 1;
                                        return acc;
                                      }, {}),
                                    ).map(([name, value]) => ({ name, value }));
                                    const STATUS_COLORS = { Active: "#52c41a", Operational: "#52c41a", "Under Maintenance": "#faad14" };
                                    const PIE_COLORS = ["#1890ff", "#52c41a", "#faad14", "#722ed1", "#13c2c2", "#eb2f96", "#8c8c8c"];
                                    const isLeachate = slfDashModal.type === "leachate";
                                    return (
                                  <>
                                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8, border: `1px solid ${color}33`, background: `${color}0d` }}>
                                          <Statistic title={`Total ${cfg.metricLabel}`} value={totalMetricValue} valueStyle={{ color, fontSize: 22 }} prefix={isLeachate ? <AlertOutlined /> : <SafetyCertificateOutlined />} formatter={(v) => Number(v || 0).toLocaleString()} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Facilities w/ Systems" value={sourceRows.length} valueStyle={{ fontSize: 22 }} prefix={<BankOutlined style={{ color }} />} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Operational" value={opCount} valueStyle={{ fontSize: 22, color: "#52c41a" }} prefix={<CheckCircleOutlined />} suffix={maintCount > 0 ? <Text type="secondary" style={{ fontSize: 12 }}>· {maintCount} maint.</Text> : null} />
                                        </Card>
                                      </Col>
                                      <Col xs={12} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Detail Records" value={detailRows.length} valueStyle={{ fontSize: 22 }} prefix={<FileTextOutlined style={{ color }} />} />
                                        </Card>
                                      </Col>
                                    </Row>
                                    <Row gutter={[16, 16]}>
                                      <Col xs={24} lg={10}>
                                        <Card size="small" title={<><PieChartOutlined /> Status Distribution</>} style={{ borderRadius: 8, height: "100%" }}>
                                          {statusDist.length === 0 ? (
                                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No status details recorded." style={{ padding: "30px 0" }} />
                                          ) : (
                                            <ResponsiveContainer width="100%" height={240}>
                                              <RePieChart>
                                                <Pie data={statusDist} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={statusDist.length > 1 ? 3 : 0} dataKey="value" isAnimationActive={false} label={({ name, value }) => `${name}: ${value}`}>
                                                  {statusDist.map((entry, i) => (
                                                    <Cell key={i} fill={STATUS_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]} />
                                                  ))}
                                                </Pie>
                                                <RechartsTooltip formatter={(v) => Number(v).toLocaleString()} />
                                              </RePieChart>
                                            </ResponsiveContainer>
                                          )}
                                        </Card>
                                      </Col>
                                      <Col xs={24} lg={14}>
                                        <Card size="small" title={<><BarChartOutlined /> Top SLFs by {cfg.metricLabel}</>} style={{ borderRadius: 8, height: "100%" }}>
                                          <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                            {topFacilities.map((item, index) => {
                                              const percent = Math.round((item.value / maxFacility) * 100);
                                              return (
                                                <div key={`${item.name}-${index}`}>
                                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                                                    <Text strong style={{ fontSize: 12 }}>{index + 1}. {item.name}</Text>
                                                    <Text style={{ fontSize: 12, color }}>{Number(item.value).toLocaleString()} {cfg.metricLabel}</Text>
                                                  </div>
                                                  <Progress percent={percent} showInfo={false} strokeColor={color} trailColor="#f0f0f0" size="small" />
                                                  <Text type="secondary" style={{ fontSize: 11 }}>{item.province} • {item.status}</Text>
                                                </div>
                                              );
                                            })}
                                          </Space>
                                        </Card>
                                      </Col>
                                    </Row>
                                  </>
                                    );
                                  })()
                                ) : (
                                  <>
                                    {/* #6: Total SLF portfolio leads with the verified
                                        Total / Operational / Non-Operational counts —
                                        the SAME slfCounts used by the dashboard tile
                                        (single source, single classifier). Other metric
                                        modals keep the generic metric summary. */}
                                    {slfDashModal.type === "total" ? (
                                      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                                        <Col xs={12} md={6}>
                                          <Card size="small" style={{ borderRadius: 8, border: `1px solid ${color}33`, background: `${color}0d` }}>
                                            <Statistic title="Total SLF Facilities" value={slfCounts.total} valueStyle={{ color, fontSize: 22 }} formatter={(v) => Number(v || 0).toLocaleString()} />
                                          </Card>
                                        </Col>
                                        <Col xs={12} md={6}>
                                          <Card size="small" style={{ borderRadius: 8 }}>
                                            <Statistic title="Operational" value={slfCounts.operational} prefix={<CheckCircleOutlined style={{ color: "#52c41a" }} />} valueStyle={{ color: "#52c41a", fontSize: 22 }} />
                                          </Card>
                                        </Col>
                                        <Col xs={12} md={6}>
                                          <Card size="small" style={{ borderRadius: 8 }}>
                                            <Statistic title="Non-Operational" value={slfCounts.nonOperational} prefix={<CloseCircleOutlined style={{ color: "#ff4d4f" }} />} valueStyle={{ color: "#ff4d4f", fontSize: 22 }} />
                                          </Card>
                                        </Col>
                                        <Col xs={12} md={6}>
                                          <Card size="small" style={{ borderRadius: 8 }}>
                                            <Statistic title="Provinces Covered" value={provinceData.length} valueStyle={{ fontSize: 22 }} />
                                          </Card>
                                        </Col>
                                      </Row>
                                    ) : (
                                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                                      <Col xs={24} md={6}>
                                        <Card size="small" style={{ borderRadius: 8, border: `1px solid ${color}33`, background: `${color}0d` }}>
                                          <Statistic title="Metric Total" value={totalMetricValue} suffix={cfg.metricLabel} valueStyle={{ color, fontSize: 22 }} formatter={(v) => Number(v || 0).toLocaleString()} />
                                        </Card>
                                      </Col>
                                      <Col xs={24} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Reporting SLFs" value={sourceRows.length} valueStyle={{ fontSize: 22 }} />
                                        </Card>
                                      </Col>
                                      <Col xs={24} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Province Coverage" value={provinceData.length} valueStyle={{ fontSize: 22 }} />
                                        </Card>
                                      </Col>
                                      <Col xs={24} md={6}>
                                        <Card size="small" style={{ borderRadius: 8 }}>
                                          <Statistic title="Record Rows" value={flatData.length} valueStyle={{ fontSize: 22 }} />
                                        </Card>
                                      </Col>
                                    </Row>
                                    )}

                                    <Row gutter={[16, 16]}>
                                      <Col xs={24} lg={14}>
                                        <Card size="small" title="Top SLFs" style={{ borderRadius: 8, height: "100%" }}>
                                          <Space direction="vertical" size={10} style={{ width: "100%" }}>
                                            {topFacilities.map((item, index) => {
                                              const percent = Math.round((item.value / maxFacility) * 100);
                                              return (
                                                <div key={`${item.name}-${index}`}>
                                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
                                                    <Text strong style={{ fontSize: 12 }}>{index + 1}. {item.name}</Text>
                                                    <Text style={{ fontSize: 12, color }}>{Number(item.value).toLocaleString()} {cfg.metricLabel}</Text>
                                                  </div>
                                                  <Progress percent={percent} showInfo={false} strokeColor={color} trailColor="#f0f0f0" size="small" />
                                                  <Text type="secondary" style={{ fontSize: 11 }}>{item.province} • {item.status}</Text>
                                                </div>
                                              );
                                            })}
                                          </Space>
                                        </Card>
                                      </Col>
                                      <Col xs={24} lg={10}>
                                        <Card size="small" title="Province Breakdown" style={{ borderRadius: 8, marginBottom: 16 }}>
                                          <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                            {provinceData.slice(0, 8).map((item) => {
                                              const percent = Math.round((item.value / maxProvince) * 100);
                                              return (
                                                <div key={item.name}>
                                                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
                                                    <span>{item.name}</span>
                                                    <strong>{Number(item.value).toLocaleString()}</strong>
                                                  </div>
                                                  <Progress percent={percent} showInfo={false} strokeColor={color} size="small" />
                                                </div>
                                              );
                                            })}
                                          </Space>
                                        </Card>
                                        <Card size="small" title="Status Mix" style={{ borderRadius: 8 }}>
                                          <Space size={[6, 6]} wrap>
                                            {statusData.map((item) => (
                                              <Tag key={item.name} color={item.name.toLowerCase().includes("non") ? "red" : item.name.toLowerCase().includes("operational") ? "green" : "default"}>
                                                {item.name}: {item.value}
                                              </Tag>
                                            ))}
                                          </Space>
                                        </Card>
                                      </Col>
                                    </Row>
                                  </>
                                ),
                              },
                              // #1: the Cell Infrastructure — All Facilities modal
                              // drops the Records tab (its Dashboard now carries the
                              // full per-cell breakdown, matching Cell Infra Overview).
                              // Other metric modals keep their Records table.
                              slfDashModal.type === "cells"
                                ? null
                                : {
                                    key: "records",
                                    label: <span><TableOutlined /> Records</span>,
                                    children: (
                                      <Table
                                        dataSource={flatData}
                                        columns={cfg.columns}
                                        size="small"
                                        tableLayout="fixed"
                                        pagination={PAG}
                                        scroll={{ x: recordsScrollX(cfg.columns) }}
                                        bordered
                                      />
                                    ),
                                  },
                            ].filter(Boolean);
                            // #1/#2: a single-pane modal (e.g. Cell Infrastructure —
                            // All Facilities, whose Records tab was removed) renders its
                            // content DIRECTLY, with no unnecessary Tabs wrapper.
                            return dashItems.length === 1 ? (
                              dashItems[0].children
                            ) : (
                              <Tabs defaultActiveKey="dashboard" items={dashItems} />
                            );
                          })()
                        )}
                      </Modal>
                    );
                  })()}

                </>
      ),
    });
  }

  /* ─── Data History Tab ─── */
  {
    const HIST_CATEGORIES = [
      { key: "tenYearPlan",          label: "10-Year SWM Plan", liveStats: swmStats },
      { key: "fundedMrf",            label: "Funded MRF",       liveStats: mrfStats },
      { key: "lguMrf",               label: "LGU-Initiated MRF", liveStats: lguMrfStats },
      { key: "slf",                  label: "SLF Facilities",   liveStats: slfFacStats },
      { key: "trashTraps",           label: "Trash Traps",      liveStats: trapStats },
      { key: "swmEquipment",         label: "SWM Equipment",    liveStats: equipStats },
      { key: "residualContainment",  label: "Residual Containment", liveStats: rcaStats },
      { key: "transferStation",      label: "Transfer Stations", liveStats: tsStats },
      { key: "openDumpsite",         label: "Open Dumpsites",   liveStats: openDumpStats },
      { key: "fundedRehab",          label: "Funded Rehab",     liveStats: null },
    ];

    const HIST_YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 4 + i);

    const getCount = (catKey, yr) => {
      if (yr === CURRENT_YEAR) {
        const cat = HIST_CATEGORIES.find((c) => c.key === catKey);
        return cat?.liveStats?.totalRecords ?? "—";
      }
      const arr = historyData?.[catKey];
      if (!arr) return "—";
      const rec = arr.find((r) => r.year === yr);
      return rec?.totalRecords ?? 0;
    };

    const getChange = (catKey, yr) => {
      const cur = getCount(catKey, yr);
      const prev = getCount(catKey, yr - 1);
      if (typeof cur !== "number" || typeof prev !== "number" || prev === 0) return null;
      return ((cur - prev) / prev) * 100;
    };

    const histMax = Math.max(
      ...HIST_CATEGORIES.flatMap((c) =>
        HIST_YEARS.map((y) => {
          const v = getCount(c.key, y);
          return typeof v === "number" ? v : 0;
        })
      ),
      1
    );

    const histColumns = [
      {
        title: "Category",
        dataIndex: "label",
        key: "label",
        fixed: "left",
        width: 180,
        render: (text) => <strong>{text}</strong>,
      },
      ...HIST_YEARS.map((yr) => ({
        title: yr === CURRENT_YEAR ? <Tag color="blue">{yr} (Live)</Tag> : String(yr),
        dataIndex: `y${yr}`,
        key: `y${yr}`,
        width: 150,
        align: "center",
        render: (_, row) => {
          const val = getCount(row.key, yr);
          const pct = typeof val === "number" ? (val / histMax) * 100 : 0;
          const change = yr > 2022 ? getChange(row.key, yr) : null;
          return (
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{typeof val === "number" ? val.toLocaleString() : val}</div>
              {typeof val === "number" && (
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: isDark ? "rgba(255,255,255,0.08)" : "#f0f0f0",
                    marginTop: 4,
                  }}
                >
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      width: `${pct}%`,
                      background: yr === CURRENT_YEAR ? "#1890ff" : "#52c41a",
                      transition: "width 0.4s",
                    }}
                  />
                </div>
              )}
              {change !== null && (
                <span style={{ fontSize: 11, color: change >= 0 ? "#52c41a" : "#ff4d4f" }}>
                  {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
                </span>
              )}
            </div>
          );
        },
      })),
    ];

    const histTableData = HIST_CATEGORIES.map((c) => ({
      key: c.key,
      label: c.label,
    }));

    // Build per-category province detail
    const expandedRowRender = (record) => {
      const arr = historyData?.[record.key];
      if (!arr || arr.length === 0) return <span style={{ color: "#999" }}>No historical province data available.</span>;

      // Gather all province names across years
      const provSet = new Set();
      arr.forEach((r) => r.byProvince?.forEach((p) => provSet.add(p.province)));
      const provinces = [...provSet].sort();

      if (provinces.length === 0) return <span style={{ color: "#999" }}>No province breakdown available.</span>;

      const provColumns = [
        { title: "Province", dataIndex: "province", key: "province", fixed: "left", width: 160 },
        ...arr.map((r) => ({
          title: String(r.year),
          dataIndex: `y${r.year}`,
          key: `y${r.year}`,
          width: 100,
          align: "center",
        })),
      ];

      const provData = provinces.map((prov) => {
        const row = { key: prov, province: prov };
        arr.forEach((r) => {
          const found = r.byProvince?.find((p) => p.province === prov);
          row[`y${r.year}`] = found?.count ?? 0;
        });
        return row;
      });

      return (
        <Table
          columns={provColumns}
          dataSource={provData}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
          style={{ margin: "8px 0" }}
        />
      );
    };

  // ── Open Dumpsites Dashboard Tab ──
  if (openDumpStats && openDumpStats.totalRecords > 0) {
    const odByStatus = openDumpStats.byStatus || {};
    const odByProv = openDumpStats.byProvince || {};
    const odProvList = Object.entries(odByProv).map(([k, v]) => ({ province: k, count: v })).sort((a, b) => b.count - a.count);
    const odMaxProv = Math.max(...odProvList.map(p => p.count), 1);
    tabItems.push({
      key: "open-dumpsites",
      label: <span><EnvironmentOutlined /> Open Dumpsites</span>,
      children: (<>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Sites" value={openDumpStats.totalRecords} prefix={<EnvironmentOutlined style={{ color: "#ff4d4f" }} />} /></Card></Col>
          {Object.entries(odByStatus).slice(0, 3).map(([k, v]) => (
            <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} valueStyle={{ color: k.toLowerCase().includes("rehab") ? "#52c41a" : k.toLowerCase().includes("open") ? "#ff4d4f" : "#faad14" }} /></Card></Col>
          ))}
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
              {odProvList.map(p => (
                <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / odMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#ff4d4f" /></div>
              ))}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
              {Object.entries(odByStatus).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / openDumpStats.totalRecords) * 100)} format={() => v} size="small" /></div>
              ))}
            </Card>
          </Col>
        </Row>
        <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={() => setActiveMenu("cs-open-dump")}>View All Open Dumpsites →</Button></Col></Row>
      </>),
    });
  }

  // ── Residual Containment Dashboard Tab ──
  if (rcaStats && rcaStats.totalRecords > 0) {
    const rcaByStatus = rcaStats.byStatus || {};
    const rcaByProv = rcaStats.byProvince || {};
    const rcaProvList = Object.entries(rcaByProv).map(([k, v]) => ({ province: k, count: v })).sort((a, b) => b.count - a.count);
    const rcaMaxProv = Math.max(...rcaProvList.map(p => p.count), 1);
    tabItems.push({
      key: "residual-containment",
      label: <span><SafetyCertificateOutlined /> Residual Containment</span>,
      children: (<>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Facilities" value={rcaStats.totalRecords} prefix={<SafetyCertificateOutlined style={{ color: "#722ed1" }} />} /></Card></Col>
          {Object.entries(rcaByStatus).slice(0, 3).map(([k, v]) => (
            <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} valueStyle={{ color: k.toLowerCase().includes("operational") && !k.toLowerCase().includes("non") ? "#52c41a" : "#ff4d4f" }} /></Card></Col>
          ))}
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
              {rcaProvList.map(p => (
                <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / rcaMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#722ed1" /></div>
              ))}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
              {Object.entries(rcaByStatus).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / rcaStats.totalRecords) * 100)} format={() => v} size="small" /></div>
              ))}
            </Card>
          </Col>
        </Row>
        <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={() => setActiveMenu("cs-rca")}>View All Residual Containment →</Button></Col></Row>
      </>),
    });
  }

  // ── Transfer Stations Dashboard Tab ──
  if (tsStats && tsStats.totalRecords > 0) {
    const tsByStatus = tsStats.byStatus || {};
    const tsByProv = tsStats.byProvince || {};
    const tsProvList = Object.entries(tsByProv).map(([k, v]) => ({ province: k, count: v })).sort((a, b) => b.count - a.count);
    const tsMaxProv = Math.max(...tsProvList.map(p => p.count), 1);
    tabItems.push({
      key: "transfer-stations",
      label: <span><SwapOutlined /> Transfer Stations</span>,
      children: (<>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Stations" value={tsStats.totalRecords} prefix={<SwapOutlined style={{ color: "#13c2c2" }} />} /></Card></Col>
          {Object.entries(tsByStatus).slice(0, 3).map(([k, v]) => (
            <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} valueStyle={{ color: k.toLowerCase().includes("operational") && !k.toLowerCase().includes("non") ? "#52c41a" : "#faad14" }} /></Card></Col>
          ))}
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
              {tsProvList.map(p => (
                <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / tsMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#13c2c2" /></div>
              ))}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
              {Object.entries(tsByStatus).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / tsStats.totalRecords) * 100)} format={() => v} size="small" /></div>
              ))}
            </Card>
          </Col>
        </Row>
        <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={() => setActiveMenu("cs-transfer-station")}>View All Transfer Stations →</Button></Col></Row>
      </>),
    });
  }

  // ── Project Description Scoping Dashboard Tab ──
  if (pdsStats && pdsStats.totalRecords > 0) {
    const pdsByStatus = pdsStats.byStatus || {};
    const pdsByProv = pdsStats.byProvince || {};
    const pdsProvList = Object.entries(pdsByProv).map(([k, v]) => ({ province: k, count: v })).sort((a, b) => b.count - a.count);
    const pdsMaxProv = Math.max(...pdsProvList.map(p => p.count), 1);
    tabItems.push({
      key: "pds-scoping",
      label: <span><FileTextOutlined /> PDS (Scoping)</span>,
      children: (<>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Records" value={pdsStats.totalRecords} prefix={<FileTextOutlined style={{ color: "#1890ff" }} />} /></Card></Col>
          {Object.entries(pdsByStatus).slice(0, 3).map(([k, v]) => (
            <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} /></Card></Col>
          ))}
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
              {pdsProvList.map(p => (
                <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / pdsMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#1890ff" /></div>
              ))}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
              {Object.entries(pdsByStatus).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / pdsStats.totalRecords) * 100)} format={() => v} size="small" /></div>
              ))}
            </Card>
          </Col>
        </Row>
        <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={() => setActiveMenu("cs-pds")}>View All PDS Records →</Button></Col></Row>
      </>),
    });
  }

  // ── Technical Assistance Dashboard Tab ──
  if (techAssistStats && techAssistStats.totalRecords > 0) {
    const taByStatus = techAssistStats.byStatus || {};
    const taByProv = techAssistStats.byProvince || {};
    const taByFacility = techAssistStats.byFacilityType || {};
    const taProvList = Object.entries(taByProv).map(([k, v]) => ({ province: k, count: v })).sort((a, b) => b.count - a.count);
    const taMaxProv = Math.max(...taProvList.map(p => p.count), 1);
    tabItems.push({
      key: "tech-assist",
      label: <span><ToolOutlined /> Technical Assistance</span>,
      children: (<>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Records" value={techAssistStats.totalRecords} prefix={<ToolOutlined style={{ color: "#fa8c16" }} />} /></Card></Col>
          {Object.entries(taByStatus).slice(0, 3).map(([k, v]) => (
            <Col key={k} xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title={k} value={v} /></Card></Col>
          ))}
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
              {taProvList.map(p => (
                <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / taMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#fa8c16" /></div>
              ))}
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
              {Object.entries(taByStatus).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / techAssistStats.totalRecords) * 100)} format={() => v} size="small" /></div>
              ))}
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card title="By Facility Type" size="small" style={{ borderRadius: 10 }}>
              {Object.entries(taByFacility).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / techAssistStats.totalRecords) * 100)} format={() => v} size="small" strokeColor="#722ed1" /></div>
              ))}
            </Card>
          </Col>
        </Row>
        <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={() => setActiveMenu("cs-tech-assist")}>View All Technical Assistance →</Button></Col></Row>
      </>),
    });
  }

  // ── LGU Assist & Diversion Dashboard Tab ──
  if (lguDivStats && lguDivStats.totalRecords > 0) {
    const ldByStatus = lguDivStats.byStatus || {};
    const ldByProv = lguDivStats.byProvince || {};
    const ldWaste = lguDivStats.wasteStats || {};
    const ldProvList = Object.entries(ldByProv).map(([k, v]) => ({ province: k, count: v })).sort((a, b) => b.count - a.count);
    const ldMaxProv = Math.max(...ldProvList.map(p => p.count), 1);
    tabItems.push({
      key: "lgu-diversion",
      label: <span><TeamOutlined /> LGU Assist & Diversion</span>,
      children: (<>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total LGUs" value={lguDivStats.totalRecords} prefix={<TeamOutlined style={{ color: "#52c41a" }} />} /></Card></Col>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Avg Diversion" value={(ldWaste.avgDiversion || 0).toFixed(1)} suffix="%" prefix={<RiseOutlined style={{ color: "#1890ff" }} />} /></Card></Col>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Waste Gen" value={ldWaste.totalWasteGen || 0} prefix={<BarChartOutlined style={{ color: "#ff4d4f" }} />} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
          <Col xs={12} sm={12} md={6}><Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}><Statistic title="Total Diverted" value={ldWaste.totalDiverted || 0} prefix={<BarChartOutlined style={{ color: "#52c41a" }} />} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
        </Row>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Card title="By Province" size="small" style={{ borderRadius: 10 }}>
              {ldProvList.map(p => (
                <div key={p.province} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{p.province}</Text><Progress percent={Math.round((p.count / ldMaxProv) * 100)} format={() => p.count} size="small" strokeColor="#52c41a" /></div>
              ))}
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="By Status" size="small" style={{ borderRadius: 10 }}>
              {Object.entries(ldByStatus).map(([k, v]) => (
                <div key={k} style={{ marginBottom: 6 }}><Text style={{ fontSize: 12 }}>{k}</Text><Progress percent={Math.round((v / lguDivStats.totalRecords) * 100)} format={() => v} size="small" /></div>
              ))}
            </Card>
          </Col>
        </Row>
        <Row style={{ marginTop: 16 }}><Col span={24}><Button type="link" onClick={() => setActiveMenu("cs-lgu-diversion")}>View All LGU Assist & Diversion →</Button></Col></Row>
      </>),
    });
  }

    // Ensure all expected tabs exist even when they have no data for the selected year
    const ALL_DASH_TABS = [
      { key: "swm-plan", label: <span><FundProjectionScreenOutlined /> 10-Year SWM Plan</span> },
      { key: "funded-mrf", label: <span><BankOutlined /> Funded MRF</span> },
      { key: "lgu-mrf", label: <span><ApartmentOutlined /> LGU Initiated MRF</span> },
      { key: "trash-traps", label: <span><DeleteOutlined /> Trash Traps</span> },
      { key: "swm-equip", label: <span><CarOutlined /> SWM Equipment</span> },
      { key: "slf-monitoring", label: <span><BankOutlined /> General Dashboard</span> },
      { key: "open-dumpsites", label: <span><EnvironmentOutlined /> Open Dumpsites</span> },
      { key: "residual-containment", label: <span><SafetyCertificateOutlined /> Residual Containment</span> },
      { key: "transfer-stations", label: <span><SwapOutlined /> Transfer Stations</span> },
      { key: "pds-scoping", label: <span><FileTextOutlined /> PDS (Scoping)</span> },
      { key: "tech-assist", label: <span><ToolOutlined /> Technical Assistance</span> },
      { key: "lgu-diversion", label: <span><TeamOutlined /> LGU Assist & Diversion</span> },
    ];
    const existingKeys = new Set(tabItems.map(t => t.key));
    for (const tab of ALL_DASH_TABS) {
      if (!existingKeys.has(tab.key)) {
        tabItems.push({
          key: tab.key,
          label: tab.label,
          children: (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <Empty description={<Text type="secondary">No data available. Records may exist in hidden years.</Text>} />
            </div>
          ),
        });
      }
    }

    tabItems.push({
      key: "data-history",
      label: (
        <span>
          <HistoryOutlined /> Data History
        </span>
      ),
      children: (
        <div style={{ padding: "0 4px" }}>
          {/* Summary Cards */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            {HIST_CATEGORIES.slice(0, 6).map((cat) => {
              const latest = getCount(cat.key, CURRENT_YEAR);
              const prev = getCount(cat.key, CURRENT_YEAR - 1);
              const change = typeof latest === "number" && typeof prev === "number" && prev > 0
                ? ((latest - prev) / prev) * 100 : null;
              return (
                <Col xs={24} sm={12} md={8} lg={4} key={cat.key}>
                  <Card
                    size="small"
                    style={{
                      borderRadius: 10,
                      textAlign: "center",
                      background: isDark ? "#1f1f1f" : "#fafafa",
                    }}
                  >
                    <Statistic
                      title={cat.label}
                      value={typeof latest === "number" ? latest : 0}
                      suffix={
                        change !== null ? (
                          <span style={{ fontSize: 12, color: change >= 0 ? "#52c41a" : "#ff4d4f" }}>
                            {change >= 0 ? "▲" : "▼"}{Math.abs(change).toFixed(1)}%
                          </span>
                        ) : null
                      }
                    />
                    <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>vs {CURRENT_YEAR - 1}</div>
                  </Card>
                </Col>
              );
            })}
          </Row>

          {/* Year-over-year table */}
          <Card
            title={
              <Space>
                <HistoryOutlined />
                Year-over-Year Comparison ({CURRENT_YEAR - 4} – {CURRENT_YEAR})
              </Space>
            }
            style={{ borderRadius: 12, marginBottom: 20 }}
          >
            <Table
              columns={histColumns}
              dataSource={histTableData}
              pagination={false}
              scroll={{ x: 950 }}
              size="middle"
              expandable={{
                expandedRowRender,
                rowExpandable: (record) => {
                  const arr = historyData?.[record.key];
                  return arr && arr.some((r) => r.byProvince?.length > 0);
                },
              }}
            />
          </Card>

          {/* Status breakdown per category */}
          {historyData && (
            <Card
              title={
                <Space>
                  <BarChartOutlined />
                  Status Breakdown by Year
                </Space>
              }
              style={{ borderRadius: 12 }}
            >
              <Row gutter={[16, 16]}>
                {HIST_CATEGORIES.filter((c) => {
                  const arr = historyData[c.key];
                  return arr && arr.some((r) => r.byStatus?.length > 0);
                }).map((cat) => {
                  const arr = historyData[cat.key];
                  // Show the most recent year's status breakdown
                  const latest = [...arr].sort((a, b) => b.year - a.year)[0];
                  const statuses = latest?.byStatus || [];
                  const total = statuses.reduce((s, v) => s + v.count, 0) || 1;
                  const statusColors = {
                    Operational: "#52c41a", Operating: "#52c41a", Active: "#52c41a",
                    "Non-Operational": "#ff4d4f", Closed: "#ff4d4f", Inactive: "#ff4d4f",
                    "Under Construction": "#faad14", Proposed: "#1890ff",
                    "For Closure": "#ff7a45", Compliant: "#52c41a", "Not Compliant": "#ff4d4f",
                    "For Compliance": "#faad14", Completed: "#52c41a", Ongoing: "#1890ff",
                  };

                  return (
                    <Col xs={24} sm={12} md={8} key={cat.key}>
                      <Card size="small" title={cat.label} style={{ borderRadius: 8 }}>
                        <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>
                          Latest: {latest?.year}
                        </div>
                        {statuses.map((s) => (
                          <div key={s.status} style={{ marginBottom: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                              <span>{s.status}</span>
                              <span>{s.count} ({((s.count / total) * 100).toFixed(0)}%)</span>
                            </div>
                            <div
                              style={{
                                height: 6,
                                borderRadius: 3,
                                background: isDark ? "rgba(255,255,255,0.08)" : "#f0f0f0",
                              }}
                            >
                              <div
                                style={{
                                  height: 6,
                                  borderRadius: 3,
                                  width: `${(s.count / total) * 100}%`,
                                  background: statusColors[s.status] || "#1890ff",
                                  transition: "width 0.4s",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            </Card>
          )}
        </div>
      ),
    });
  }

  return (
    <>
      <style>{`
        .ant-modal-body,
        .ant-modal-body .ant-table-body,
        .ant-modal-body .ant-table-content,
        .ant-modal-body [style*="overflow"] {
          scrollbar-width: thin;
          scrollbar-color: ${isDark ? "#4b5563 #151b23" : "#b8c2cc transparent"};
          scroll-behavior: smooth;
        }
        .ant-modal-body::-webkit-scrollbar,
        .ant-modal-body .ant-table-body::-webkit-scrollbar,
        .ant-modal-body .ant-table-content::-webkit-scrollbar,
        .ant-modal-body [style*="overflow"]::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .ant-modal-body::-webkit-scrollbar-track,
        .ant-modal-body .ant-table-body::-webkit-scrollbar-track,
        .ant-modal-body .ant-table-content::-webkit-scrollbar-track,
        .ant-modal-body [style*="overflow"]::-webkit-scrollbar-track {
          background: ${isDark ? "#151b23" : "transparent"};
          border-radius: 999px;
        }
        .ant-modal-body::-webkit-scrollbar-thumb,
        .ant-modal-body .ant-table-body::-webkit-scrollbar-thumb,
        .ant-modal-body .ant-table-content::-webkit-scrollbar-thumb,
        .ant-modal-body [style*="overflow"]::-webkit-scrollbar-thumb {
          background: ${isDark ? "#4b5563" : "#b8c2cc"};
          border-radius: 999px;
          border: 2px solid ${isDark ? "#151b23" : "transparent"};
        }
        .ant-modal-body::-webkit-scrollbar-thumb:hover,
        .ant-modal-body .ant-table-body::-webkit-scrollbar-thumb:hover,
        .ant-modal-body .ant-table-content::-webkit-scrollbar-thumb:hover,
        .ant-modal-body [style*="overflow"]::-webkit-scrollbar-thumb:hover {
          background: ${isDark ? "#64748b" : "#8fa1b3"};
        }
      `}</style>
      {" "}
      {/* Trash Trap View Modal */}
      <Modal
        title={
          <Space>
            <ExperimentOutlined />
            {trapViewRecord?.municipality}, {trapViewRecord?.province}
          </Space>
        }
        open={!!trapViewRecord}
        onCancel={() => setTrapViewRecord(null)}
        footer={<Button onClick={() => setTrapViewRecord(null)}>Close</Button>}
        width={800}
      >
        {trapViewRecord && (
          <Tabs
            items={[
              {
                key: "general",
                label: (<span><EnvironmentOutlined /> General Info</span>),
                children: (
                  <>
                    <Row gutter={[16, 12]}>
                      <Col span={12}><Text type="secondary"><EnvironmentOutlined /> Province:</Text>{" "}<Text strong>{trapViewRecord.province}</Text></Col>
                      <Col span={12}><Text type="secondary"><EnvironmentOutlined /> Municipality:</Text>{" "}<Text strong>{trapViewRecord.municipality}</Text></Col>
                      <Col span={12}><Text type="secondary">Barangay:</Text>{" "}<Text>{trapViewRecord.barangay || "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Manila Bay Area:</Text>{" "}{trapViewRecord.manilaBayArea === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : <Tag color="default" bordered={false}>{trapViewRecord.manilaBayArea || "\u2014"}</Tag>}</Col>
                      <Col span={12}><Text type="secondary">Coordinates:</Text>{" "}<Text>{trapViewRecord.latitude}, {trapViewRecord.longitude}</Text></Col>
                    </Row>
                    <Divider plain orientation="left"><ExperimentOutlined /> Trap Details</Divider>
                    <Row gutter={[16, 12]}>
                      <Col span={12}><Text type="secondary">Date Installed:</Text>{" "}<Text strong>{trapViewRecord.dateInstalled ? dayjs(trapViewRecord.dateInstalled).format("MM/DD/YYYY") : "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Status:</Text>{" "}<Text strong>{trapViewRecord.statusOfTrashTraps || "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">HDPE Floaters:</Text>{" "}<Text strong>{trapViewRecord.noOfTrashTrapsHDPE ?? "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Waste Hauled:</Text>{" "}<Text strong>{trapViewRecord.estimatedVolumeWasteHauled ? `${Number(trapViewRecord.estimatedVolumeWasteHauled).toLocaleString()} kg` : "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Last Hauling:</Text>{" "}<Text>{trapViewRecord.dateOfLastHauling ? dayjs(trapViewRecord.dateOfLastHauling).format("MM/DD/YYYY") : "\u2014"}</Text></Col>
                    </Row>
                    <Divider plain orientation="left"><SafetyCertificateOutlined /> Accessories</Divider>
                    <Row gutter={[16, 12]}>
                      <Col span={12}><Text type="secondary">Waste Lifter:</Text>{" "}<Text>{trapViewRecord.statusOfWasteLifter || "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Plastic Boat:</Text>{" "}<Text>{trapViewRecord.statusOfPlasticBoat || "\u2014"}</Text></Col>
                    </Row>
                    <Divider plain orientation="left"><TeamOutlined /> Personnel</Divider>
                    <Row gutter={[16, 12]}>
                      <Col span={8}><Text type="secondary">Focal Person:</Text><br /><Text strong>{trapViewRecord.focalPerson || "\u2014"}</Text></Col>
                      <Col span={8}><Text type="secondary">ESWM Staff:</Text><br /><Text strong>{trapViewRecord.eswmStaff || "\u2014"}</Text></Col>
                      <Col span={8}><Text type="secondary">ENMO Assigned:</Text><br /><Text strong>{trapViewRecord.enmoAssigned || "\u2014"}</Text></Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "monitoring",
                label: (<span><CalendarOutlined /> Monitoring</span>),
                children: (
                  <Row gutter={[16, 12]}>
                    <Col span={12}><Text type="secondary">Target Month:</Text>{" "}<Text>{trapViewRecord.targetMonth || "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">IIS Number:</Text>{" "}<Text>{trapViewRecord.iisNumber || "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Date of Monitoring:</Text>{" "}<Text>{trapViewRecord.dateOfMonitoring ? dayjs(trapViewRecord.dateOfMonitoring).format("MM/DD/YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Report Prepared:</Text>{" "}<Text>{trapViewRecord.dateReportPrepared ? dayjs(trapViewRecord.dateReportPrepared).format("MM/DD/YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Reviewed (Staff):</Text>{" "}<Text>{trapViewRecord.dateReportReviewedStaff ? dayjs(trapViewRecord.dateReportReviewedStaff).format("MM/DD/YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Reviewed (Focal):</Text>{" "}<Text>{trapViewRecord.dateReportReviewedFocal ? dayjs(trapViewRecord.dateReportReviewedFocal).format("MM/DD/YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Report Approved:</Text>{" "}<Text>{trapViewRecord.dateReportApproved ? dayjs(trapViewRecord.dateReportApproved).format("MM/DD/YYYY") : "\u2014"}</Text></Col>
                    <Col span={8}><Text type="secondary">Days Prepared:</Text>{" "}<Text strong>{trapViewRecord.totalDaysReportPrepared ?? "\u2014"}</Text></Col>
                    <Col span={8}><Text type="secondary">Days Staff Review:</Text>{" "}<Text strong>{trapViewRecord.totalDaysReviewedStaff ?? "\u2014"}</Text></Col>
                    <Col span={8}><Text type="secondary">Days Focal Review:</Text>{" "}<Text strong>{trapViewRecord.totalDaysReviewedFocal ?? "\u2014"}</Text></Col>
                  </Row>
                ),
              },
              {
                key: "compliance",
                label: (<span><SafetyCertificateOutlined /> Compliance</span>),
                children: (
                  <Row gutter={[16, 12]}>
                    <Col span={24}><Text type="secondary">Remarks:</Text><br /><Text>{trapViewRecord.remarks || "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Advise Letter:</Text>{" "}<Text>{trapViewRecord.adviseLetterDateIssued || "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Compliance:</Text>{" "}<Text>{trapViewRecord.complianceToAdvise || "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Signed Report:</Text>{" "}<Text>{trapViewRecord.signedReport || "\u2014"}</Text></Col>
                  </Row>
                ),
              },
            ]}
          />
        )}
      </Modal>
      {/* 10-Year SWM Plan View Modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            {mapViewRecord?.municipality}, {mapViewRecord?.province}
          </Space>
        }
        open={!!mapViewRecord}
        onCancel={() => setMapViewRecord(null)}
        footer={<Button onClick={() => setMapViewRecord(null)}>Close</Button>}
        width={800}
      >
        {mapViewRecord && (
          <Tabs
            items={[
              {
                key: "general",
                label: (
                  <span>
                    <EnvironmentOutlined /> General Info
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={[16, 12]}>
                      <Col span={12}>
                        <Text type="secondary">
                          <EnvironmentOutlined /> Province:
                        </Text>{" "}
                        <Text strong>{mapViewRecord.province}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">
                          <EnvironmentOutlined /> Municipality:
                        </Text>{" "}
                        <Text strong>{mapViewRecord.municipality}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Manila Bay Area:</Text>{" "}
                        {mapViewRecord.manilaBayArea === "MBA" ? (
                          <Tag color="blue" bordered={false}>
                            MBA
                          </Tag>
                        ) : (
                          <Tag color="default" bordered={false}>
                            {mapViewRecord.manilaBayArea || "\u2014"}
                          </Tag>
                        )}
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Congressional District:</Text>{" "}
                        <Text>
                          {mapViewRecord.congressionalDistrict || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Coordinates:</Text>{" "}
                        <Text>
                          {mapViewRecord.latitude}, {mapViewRecord.longitude}
                        </Text>
                      </Col>
                    </Row>
                    <Divider plain orientation="left">
                      <AuditOutlined /> Plan Details
                    </Divider>
                    <Row gutter={[16, 12]}>
                      <Col span={12}>
                        <Text type="secondary">
                          <FileTextOutlined /> Plan Type:
                        </Text>{" "}
                        {mapViewRecord.typeOfSWMPlan ? (
                          <Tag color="geekblue" bordered={false}>
                            {mapViewRecord.typeOfSWMPlan}
                          </Tag>
                        ) : (
                          "\u2014"
                        )}
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">
                          <FileTextOutlined /> Resolution No.:
                        </Text>{" "}
                        <Text>{mapViewRecord.resolutionNo || "\u2014"}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">
                          <ClockCircleOutlined /> Period Covered:
                        </Text>{" "}
                        <Tag bordered={false}>
                          {mapViewRecord.periodCovered || "\u2014"}
                        </Tag>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">
                          <ClockCircleOutlined /> Year Approved:
                        </Text>{" "}
                        <Text>{mapViewRecord.yearApproved || "\u2014"}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">
                          <ClockCircleOutlined /> End Period:
                        </Text>{" "}
                        <Text>{mapViewRecord.endPeriod || "\u2014"}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Status:</Text>{" "}
                        {/approved/i.test(mapViewRecord.forRenewal) ? (
                          <Tag color="green" bordered={false}>
                            {mapViewRecord.forRenewal}
                          </Tag>
                        ) : /renewal/i.test(mapViewRecord.forRenewal) ? (
                          <Tag color="orange" bordered={false}>
                            {mapViewRecord.forRenewal}
                          </Tag>
                        ) : (
                          <Tag bordered={false}>
                            {mapViewRecord.forRenewal || "\u2014"}
                          </Tag>
                        )}
                      </Col>
                    </Row>
                    <Divider plain orientation="left">
                      <TeamOutlined /> Personnel
                    </Divider>
                    <Row gutter={[16, 12]}>
                      <Col span={8}>
                        <Text type="secondary">
                          <UserOutlined /> Focal Person:
                        </Text>
                        <br />
                        <Text strong>
                          {mapViewRecord.focalPerson || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={8}>
                        <Text type="secondary">
                          <UserOutlined /> ESWM Staff:
                        </Text>
                        <br />
                        <Text strong>
                          {mapViewRecord.eswmStaff || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={8}>
                        <Text type="secondary">
                          <TeamOutlined /> ENMO Assigned:
                        </Text>
                        <br />
                        <Text strong>
                          {mapViewRecord.enmoAssigned || "\u2014"}
                        </Text>
                      </Col>
                    </Row>
                    {mapViewRecord.signedDocument && (
                      <>
                        <Divider plain orientation="left">
                          <LinkOutlined /> Document
                        </Divider>
                        <a
                          href={mapViewRecord.signedDocument}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 12px",
                            background: isDark ? "rgba(22,119,255,0.15)" : "#e6f7ff",
                            borderRadius: 4,
                            fontSize: 13,
                            color: "#1890ff",
                            textDecoration: "none",
                            fontWeight: 600,
                          }}
                        >
                          <LinkOutlined /> View Signed Document
                        </a>
                      </>
                    )}
                  </>
                ),
              },
              {
                key: "monitoring",
                label: (
                  <span>
                    <ClockCircleOutlined /> Monitoring
                  </span>
                ),
                children: (
                  <Row gutter={[16, 12]}>
                    <Col span={12}>
                      <Text type="secondary">Target Month:</Text>{" "}
                      <Text>{mapViewRecord.targetMonth || "\u2014"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">IIS Number:</Text>{" "}
                      <Text>{mapViewRecord.iisNumber || "\u2014"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Date of Monitoring:</Text>{" "}
                      <Text>
                        {mapViewRecord.dateOfMonitoring
                          ? dayjs(mapViewRecord.dateOfMonitoring).format(
                              "MMM D, YYYY",
                            )
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Report Prepared:</Text>{" "}
                      <Text>
                        {mapViewRecord.dateReportPrepared
                          ? dayjs(mapViewRecord.dateReportPrepared).format(
                              "MMM D, YYYY",
                            )
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Reviewed (Staff):</Text>{" "}
                      <Text>
                        {mapViewRecord.dateReportReviewedStaff
                          ? dayjs(mapViewRecord.dateReportReviewedStaff).format(
                              "MMM D, YYYY",
                            )
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Reviewed (Focal):</Text>{" "}
                      <Text>
                        {mapViewRecord.dateReportReviewedFocal
                          ? dayjs(mapViewRecord.dateReportReviewedFocal).format(
                              "MMM D, YYYY",
                            )
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Report Approved:</Text>{" "}
                      <Text>
                        {mapViewRecord.dateReportApproved
                          ? dayjs(mapViewRecord.dateReportApproved).format(
                              "MMM D, YYYY",
                            )
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Tracking:</Text>{" "}
                      <Text>{mapViewRecord.trackingOfReports || "\u2014"}</Text>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "compliance",
                label: (
                  <span>
                    <SafetyCertificateOutlined /> Compliance
                  </span>
                ),
                children: (
                  <>
                    <Row gutter={[16, 12]}>
                      <Col span={24}>
                        <Text type="secondary">Remarks & Recommendation:</Text>
                        <br />
                        <Text>
                          {mapViewRecord.remarksAndRecommendation || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Source Reduction:</Text>{" "}
                        <Text>{mapViewRecord.sourceReduction || "\u2014"}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Segregated Collection:</Text>{" "}
                        <Text>
                          {mapViewRecord.segregatedCollection || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Storage & Set-out:</Text>{" "}
                        <Text>
                          {mapViewRecord.storageAndSetout || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Processing/MRF:</Text>{" "}
                        <Text>{mapViewRecord.processingMRF || "\u2014"}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Transfer Station:</Text>{" "}
                        <Text>{mapViewRecord.transferStation || "\u2014"}</Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Disposal Facilities:</Text>{" "}
                        <Text>
                          {mapViewRecord.disposalFacilities || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">LGU Final Disposal:</Text>{" "}
                        <Text>
                          {mapViewRecord.lguFinalDisposal || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Advise Letter Date:</Text>{" "}
                        <Text>
                          {mapViewRecord.adviseLetterDateIssued || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={12}>
                        <Text type="secondary">Compliance to Advise:</Text>{" "}
                        <Text>
                          {mapViewRecord.complianceToAdvise || "\u2014"}
                        </Text>
                      </Col>
                      <Col span={24}>
                        <Text type="secondary">Remarks:</Text>{" "}
                        <Text>{mapViewRecord.remarks || "\u2014"}</Text>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: "waste",
                label: (
                  <span>
                    <BarChartOutlined /> Waste Data
                  </span>
                ),
                children: (
                  <Row gutter={[16, 12]}>
                    <Col span={12}>
                      <Text type="secondary">Total Waste Generation:</Text>{" "}
                      <Text strong>
                        {mapViewRecord.totalWasteGeneration != null
                          ? `${mapViewRecord.totalWasteGeneration.toLocaleString()} tons`
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">PCG:</Text>{" "}
                      <Text strong>{mapViewRecord.pcg ?? "\u2014"}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Waste Diversion Rate:</Text>{" "}
                      <Text strong>
                        {mapViewRecord.wasteDiversionRate != null
                          ? `${(mapViewRecord.wasteDiversionRate * 100).toFixed(1)}%`
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Disposal Rate:</Text>{" "}
                      <Text strong>
                        {mapViewRecord.disposalRate != null
                          ? `${(mapViewRecord.disposalRate * 100).toFixed(1)}%`
                          : "\u2014"}
                      </Text>
                    </Col>
                    <Divider plain orientation="left">
                      Composition
                    </Divider>
                    <Col span={12}>
                      <Text type="secondary" style={{ color: "#52c41a" }}>
                        Biodegradable:
                      </Text>{" "}
                      <Text>
                        {mapViewRecord.biodegradableWaste ?? "\u2014"} (
                        {mapViewRecord.biodegradablePercent != null
                          ? `${(mapViewRecord.biodegradablePercent * 100).toFixed(1)}%`
                          : "\u2014"}
                        )
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary" style={{ color: "#1890ff" }}>
                        Recyclable:
                      </Text>{" "}
                      <Text>
                        {mapViewRecord.recyclableWaste ?? "\u2014"} (
                        {mapViewRecord.recyclablePercent != null
                          ? `${(mapViewRecord.recyclablePercent * 100).toFixed(1)}%`
                          : "\u2014"}
                        )
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary" style={{ color: "#ff4d4f" }}>
                        Residual:
                      </Text>{" "}
                      <Text>
                        {mapViewRecord.residualWasteForDisposal ?? "\u2014"} (
                        {mapViewRecord.residualPercent != null
                          ? `${(mapViewRecord.residualPercent * 100).toFixed(1)}%`
                          : "\u2014"}
                        )
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary" style={{ color: "#722ed1" }}>
                        Special:
                      </Text>{" "}
                      <Text>
                        {mapViewRecord.specialWaste ?? "\u2014"} (
                        {mapViewRecord.specialPercent != null
                          ? `${(mapViewRecord.specialPercent * 100).toFixed(1)}%`
                          : "\u2014"}
                        )
                      </Text>
                    </Col>
                  </Row>
                ),
              },
            ]}
          />
        )}
      </Modal>
     <div style={{ marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div style={{ marginRight: "auto", minWidth: 180 }}>
          <Title level={3} style={{ margin: 0, color: textColor, lineHeight: 1.15 }}>Dashboard</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>System overview, monitoring summaries, and current portal activity.</Text>
        </div>
        {loading && <Spin size="small" />}
        {/* VERA assistant card — opens the shared VeraChat via the `vera:open` event. */}
        <VeraCard isDark={isDark} />
      </div>
     {dashboardTabSettings === null ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}><Spin /></div>
      ) : (() => {
        const filteredTabs = tabItems
          .filter(t => {
            const cfg = dashboardTabSettings[t.key];
            return !cfg || cfg.visible !== false;
          })
          .map(t => {
            const cfg = dashboardTabSettings[t.key];
            if (cfg && cfg.maintenance) {
              return {
                ...t,
                label: <span>{t.label} <Tag color="warning" style={{ marginLeft: 4, fontSize: 10 }}>Maintenance</Tag></span>,
                children: (
                  <div style={{ textAlign: "center", padding: "80px 20px" }}>
                    <ToolOutlined style={{ fontSize: 48, color: "#faad14", marginBottom: 16 }} />
                    <Title level={4} style={{ color: "#faad14" }}>Under Maintenance</Title>
                    <Text type="secondary">{cfg.maintenanceMessage || "This dashboard section is currently under maintenance. Please check back later."}</Text>
                  </div>
                ),
              };
            }
            return t;
          });

        // Set initial dashTab to first visible tab
        const activeKey = filteredTabs.some(t => t.key === dashTab) ? dashTab : filteredTabs[0]?.key;

        return (
          <Tabs
            activeKey={activeKey}
            onChange={setDashTab}
            items={filteredTabs}
            size="large"
            style={{ marginTop: 0 }}
            // Top-level dashboard tabs. antd keeps every pane you have visited
            // mounted, so without this the SLF gauge grids, charts and their
            // derived arrays from earlier tabs all stayed live behind the one you
            // are actually looking at — memory grew with each tab visited and only
            // came back on a full page change.
            destroyOnHidden
          />
        );
      })()}

      {preventiveFileViewer && (() => {
        const viewUrl = absoluteMediaUrl(preventiveFileViewer.url);
        const fileName = preventiveFileViewer.fileName || getPreventiveFileName(preventiveFileViewer.url, "document");
        const kind = preventiveFileViewer.kind || getPreventiveFileKind(fileName, preventiveFileViewer.url);
        const pdfUrl = `${viewUrl.split("#")[0]}#zoom=${preventiveFileZoom}`;
        const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(viewUrl)}`;
        const previewUrl = kind === "word" ? officeUrl : kind === "pdf" ? pdfUrl : viewUrl;
        const copyLink = () => navigator.clipboard?.writeText(viewUrl).catch(() => {});
        const openNewTab = () => window.open(viewUrl, "_blank", "noopener,noreferrer");
        const downloadFile = () => {
          const a = document.createElement("a");
          a.href = viewUrl;
          a.download = fileName;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };
        return (
          <Modal
            open
            title={
              <Space size={8} wrap>
                {kind === "pdf" ? <FilePdfOutlined style={{ color: "#fa541c" }} /> : <FileTextOutlined style={{ color: "#fa541c" }} />}
                <Tooltip title={fileName}>
                  <Text strong ellipsis style={{ maxWidth: 420 }}>{fileName}</Text>
                </Tooltip>
                {preventiveFileViewer.slfName && <Tag color="orange">{preventiveFileViewer.slfName}</Tag>}
                {preventiveFileViewer.province && <Tag>{preventiveFileViewer.province}</Tag>}
              </Space>
            }
            onCancel={() => setPreventiveFileViewer(null)}
            footer={<Button onClick={() => setPreventiveFileViewer(null)}>Close</Button>}
            width={1100}
            style={{ top: 24, maxWidth: "96vw" }}
            destroyOnHidden
            styles={{ body: { padding: 0, overflow: "hidden" } }}
          >
            <div style={{ padding: "10px 12px", borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0", display: "flex", gap: 8, justifyContent: "space-between", flexWrap: "wrap", alignItems: "center" }}>
              <Space size={6} wrap>
                <Button size="small" icon={<ZoomOutOutlined />} disabled={kind === "word" || preventiveFileZoom <= 50} onClick={() => setPreventiveFileZoom((z) => Math.max(50, z - 10))}>Zoom out</Button>
                <Button size="small" onClick={() => setPreventiveFileZoom(100)} disabled={kind === "word" || preventiveFileZoom === 100}>Reset {kind === "word" ? "" : `${preventiveFileZoom}%`}</Button>
                <Button size="small" icon={<ZoomInOutlined />} disabled={kind === "word" || preventiveFileZoom >= 200} onClick={() => setPreventiveFileZoom((z) => Math.min(200, z + 10))}>Zoom in</Button>
              </Space>
              <Space size={6} wrap>
                <Tooltip title="Copy file link"><Button size="small" icon={<CopyOutlined />} onClick={copyLink}>Copy</Button></Tooltip>
                <Tooltip title="Open in new browser tab"><Button size="small" icon={<LinkOutlined />} onClick={openNewTab}>Open</Button></Tooltip>
                <Tooltip title="Download file"><Button size="small" icon={<DownloadOutlined />} onClick={downloadFile}>Download</Button></Tooltip>
              </Space>
            </div>
            <div style={{ height: "72vh", background: isDark ? "#101418" : "#f5f7fa", overflow: "auto", display: "flex", alignItems: "stretch", justifyContent: "center" }}>
              {kind === "image" ? (
                <div style={{ minWidth: "100%", padding: 18, textAlign: "center" }}>
                  <img
                    src={viewUrl}
                    alt={fileName}
                    style={{ width: `${preventiveFileZoom}%`, maxWidth: "none", borderRadius: 8, boxShadow: isDark ? "0 8px 28px rgba(0,0,0,0.45)" : "0 8px 28px rgba(0,0,0,0.12)" }}
                  />
                </div>
              ) : kind === "pdf" || kind === "word" ? (
                <iframe
                  key={`${kind}-${preventiveFileZoom}-${viewUrl}`}
                  src={previewUrl}
                  title={fileName}
                  style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
                />
              ) : (
                <div style={{ padding: 32, maxWidth: 560, margin: "auto" }}>
                  <Alert
                    type="info"
                    showIcon
                    message="Preview is not available for this file type."
                    description="Use Open or Download from the toolbar to view the file with a compatible application."
                  />
                </div>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* Per-SLF Preventive Measures — files + descriptions for one facility. */}
      {preventiveSlfModal && (() => {
        const detailByUrl = new Map(
          (preventiveSlfModal.details || [])
            .filter((d) => d?.url)
            .map((d) => [d.url, d]),
        );
        const rows = (preventiveSlfModal.files || []).map((url, i) => {
          const detail = detailByUrl.get(url) || {};
          const fileName = detail.fileName || getPreventiveFileName(url, "document");
          return {
            key: `${i}`,
            url,
            fileName,
            description: detail.description || "",
            docType: detail.docType || "Preventive Measures",
            kind: getPreventiveFileKind(fileName, url),
          };
        });
        return (
          <Modal
            open
            title={
              <Space size={8} wrap>
                <SafetyCertificateOutlined style={{ color: "#fa541c" }} />
                <Text strong>{preventiveSlfModal.lgu}</Text>
                {preventiveSlfModal.province && <Tag>{preventiveSlfModal.province}</Tag>}
                <Tag color="orange">{rows.length} file{rows.length === 1 ? "" : "s"}</Tag>
              </Space>
            }
            onCancel={() => setPreventiveSlfModal(null)}
            footer={<Button onClick={() => setPreventiveSlfModal(null)}>Close</Button>}
            width={860}
            style={{ top: 32, maxWidth: "96vw" }}
            styles={{ body: { maxHeight: "calc(100vh - 220px)", overflowY: "auto" } }}
            destroyOnHidden
          >
            {rows.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No preventive measure files for this SLF." />
            ) : (
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={rows}
                columns={[
                  {
                    title: "File",
                    dataIndex: "fileName",
                    ellipsis: { showTitle: false },
                    render: (v, r) => (
                      <Tooltip title={v}>
                        <Space size={6}>
                          <FileTextOutlined style={{ color: "#fa541c" }} />
                          <Text style={{ fontSize: 12 }}>{v}</Text>
                        </Space>
                      </Tooltip>
                    ),
                  },
                  {
                    title: "Description",
                    dataIndex: "description",
                    render: (v) =>
                      v ? (
                        <Text style={{ fontSize: 12 }}>{v}</Text>
                      ) : (
                        <Text type="secondary">—</Text>
                      ),
                  },
                  {
                    title: "Type",
                    dataIndex: "docType",
                    width: 160,
                    render: (v) => <Tag color="orange">{v}</Tag>,
                  },
                  {
                    title: "Action",
                    dataIndex: "url",
                    width: 150,
                    align: "center",
                    render: (url, row) =>
                      url ? (
                        <Space size={4}>
                          <Tooltip title="View in modal">
                            <Button
                              size="small"
                              icon={<EyeOutlined />}
                              onClick={() =>
                                openPreventiveFileViewer({
                                  url,
                                  fileName: row.fileName,
                                  slfName: preventiveSlfModal.lgu,
                                  province: preventiveSlfModal.province,
                                  kind: row.kind,
                                })
                              }
                            />
                          </Tooltip>
                          <Tooltip title="Open in new tab">
                            <Button
                              size="small"
                              icon={<LinkOutlined />}
                              onClick={() => window.open(resolveMediaOpenUrl(url), "_blank", "noopener,noreferrer")}
                            >
                              Open
                            </Button>
                          </Tooltip>
                        </Space>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
                      ),
                  },
                ]}
              />
            )}
          </Modal>
        );
      })()}

      {/* Preventive Measures — grouped by SLF (tiles, category pie, thumbnail grid). */}
      <Modal
        open={preventiveDashModal}
        title={<Space><SafetyCertificateOutlined style={{ color: "#fa541c" }} /> <Text strong>Preventive Measures (Fire Prevention and Trash Slide)</Text></Space>}
        onCancel={() => setPreventiveDashModal(false)}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Button onClick={() => setPreventiveDashModal(false)}>Close</Button>
            <Button type="primary" icon={<TableOutlined />} onClick={() => { setPreventiveDashModal(false); setActiveMenu("slf-monitoring"); }}>View in SLF Monitoring</Button>
          </div>
        }
        width={1160}
        style={{ top: 24, maxWidth: "96vw" }}
        styles={{ body: { maxHeight: "calc(100vh - 160px)", overflowY: "auto", overflowX: "hidden" } }}
        destroyOnHidden
      >
        {preventiveDashModal && (
          <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
            <PreventiveMeasuresBySlf
              facilities={slfFacStats?.managementData || []}
              getFileName={getPreventiveFileName}
              getKind={getPreventiveFileKind}
              resolveThumbUrl={resolveMediaOpenUrl}
              onOpenFile={(entry) => openPreventiveFileViewer({ url: entry.url, fileName: entry.fileName, slfName: entry.slfName, province: entry.province, kind: entry.kind })}
            />
          </Suspense>
        )}
      </Modal>

      {/* Per-SLF Prevention Measures — official narrative + VERA document summaries. */}
      <PreventionMeasuresPanel
        open={!!preventionPanel}
        facilityId={preventionPanel?.facilityId}
        slfName={preventionPanel?.slfName}
        onClose={() => setPreventionPanel(null)}
      />
    </>
  );
}
