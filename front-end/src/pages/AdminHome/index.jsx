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
  AppstoreOutlined,
  BellOutlined,
  MessageOutlined,
  GlobalOutlined,
  LinkOutlined,
  EyeOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
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
import { useLocation, useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import AccountSettings from "../admin/AccountSettings";
import AdminTipCard from "../admin/AdminTipCard";
import VeraChat from "../SLFPortal/Vera/VeraChat";
import VeraOnboarding from "../../components/VeraOnboarding";
import VeraNotificationBell from "./VeraNotificationBell";
const FieldSettings = lazy(() => import("../admin/FieldSettings"));
const SubmissionSettings = lazy(() => import("../admin/SubmissionSettings"));
const DeveloperSettings = lazy(() => import("../admin/DeveloperSettings"));
const DataReferences = lazy(() => import("../admin/DataReferences"));
const SLFMonitoring = lazy(() => import("../admin/SLFMonitoring"));
const SLFWasteGenerators = lazy(() => import("../admin/SLFWasteGenerators"));
const SlfClients = lazy(() => import("../admin/SlfClients"));
const DisposalActivityCalendar = lazy(() => import("../admin/DisposalActivityCalendar"));
const HaulerClientsPanel = lazy(() => import("../admin/HaulerClientsPanel"));
const SlfAnalyticsRow = lazy(() => import("../admin/SlfAnalyticsRow"));
const OrgChartSettings = lazy(() => import("../admin/OrgChartSettings"));
const TenYearSWMPlan = lazy(() => import("../admin/TenYearSWMPlan"));
const FundedMRF = lazy(() => import("../admin/FundedMRF"));
const LguInitiatedMRF = lazy(() => import("../admin/LguInitiatedMRF"));
const TrashTraps = lazy(() => import("../admin/TrashTraps"));
const SwmEquipment = lazy(() => import("../admin/SwmEquipment"));
const OpenDumpsites = lazy(() => import("../admin/OpenDumpsites"));
const ResidualContainment = lazy(() => import("../admin/ResidualContainment"));
const ProjectDescScoping = lazy(() => import("../admin/ProjectDescScoping"));
const TransferStations = lazy(() => import("../admin/TransferStations"));
const LguAssistDiversion = lazy(() => import("../admin/LguAssistDiversion"));
const TechnicalAssistance = lazy(() => import("../admin/TechnicalAssistance"));
const Reports = lazy(() => import("../admin/Reports"));
const GenerateReports = lazy(() => import("../admin/GenerateReports"));
const SupportTab = lazy(() => import("../admin/SupportTab"));
const NotificationManagement = lazy(() => import("../admin/NotificationManagement"));
const PortalUsers = lazy(() => import("../admin/PortalUsers"));
const Messaging = lazy(() => import("../admin/Messaging"));
import api from "../../api";
import { getAdminDisplayName, isDeveloper as isDeveloperUser } from "../../utils/adminIdentity";
import secureStorage from "../../utils/secureStorage";
import { DataRefProvider } from "../../utils/dataRef";
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
import { resolveMediaUrl, normalizeStoredFileUrl, getMediaKind } from "../admin/slf-monitoring/helpers.jsx";
import embLogo from "../../assets/emblogo.svg";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  GeoJSON,
  useMap,
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
import "leaflet/dist/leaflet.css";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { connectSocket, disconnectSocket, getSocket } from "../../utils/socket";
import { MAP_PRESENTATION, mapPresentationFor } from "../../utils/submissionStatus";
import { getStyles } from "./styles";
import LiveClock from "./LiveClock";
import DashboardContent from "./DashboardContent";
dayjs.extend(relativeTime);

// Fix default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});


const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

export default function AdminHome() {
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("dashboard");
  // Context handed to Portal Submissions when opened via the Disposal Activity
  // shortcut (tab + SLF/portal-user/date filters), consumed by SLFWasteGenerators.
  const [submissionsCtx, setSubmissionsCtx] = useState(null);
  const openPortalSubmissions = useCallback((ctx = {}) => {
    setSubmissionsCtx({ tab: "submissions", ...ctx });
    setActiveMenu("slf-waste-generators");
  }, []);
  const [isDark, setIsDark] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#1a3353");
  const [siderColor, setSiderColor] = useState("#1a3353");
  const [siderColorDark, setSiderColorDark] = useState("#111927");
  const [headerColor, setHeaderColor] = useState("#ffffff");
  const [headerColorDark, setHeaderColorDark] = useState("#141414");
  const [sidebarStyle, setSidebarStyle] = useState("gradient");
  const [portalAnnouncementActive, setPortalAnnouncementActive] = useState(false);
  const [portalAnnouncementModalOpen, setPortalAnnouncementModalOpen] = useState(false);
  const [currentPortalAnnouncement, setCurrentPortalAnnouncement] = useState(null);
  const [developerSettingsInitialTab, setDeveloperSettingsInitialTab] = useState("general");
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [driveMaintenanceMode, setDriveMaintenanceMode] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [notifHistoryOpen, setNotifHistoryOpen] = useState(false);
  const [notifHistory, setNotifHistory] = useState([]);
  const [notifHistoryLoading, setNotifHistoryLoading] = useState(false);
  const [notifHistoryPagination, setNotifHistoryPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [notifHistoryDateRange, setNotifHistoryDateRange] = useState(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [quickMessages, setQuickMessages] = useState([]);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [messageLoading, setMessageLoading] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();
  const location = useLocation();

  const syncPortalAnnouncementFlag = (settings = {}) => {
    const now = Date.now();
    const startsAt = settings.portalAnnouncementStartAt
      ? new Date(settings.portalAnnouncementStartAt).getTime()
      : null;
    const endsAt = settings.portalAnnouncementEndAt
      ? new Date(settings.portalAnnouncementEndAt).getTime()
      : null;
    setPortalAnnouncementActive(
      !!settings.portalAnnouncementEnabled &&
        (!startsAt || startsAt <= now) &&
        (!endsAt || endsAt >= now),
    );
    setCurrentPortalAnnouncement(settings);
  };

  const syncCurrentUser = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      const nextUser = {
        id: data._id || data.id,
        firstName: data.firstName,
        lastName: data.lastName,
        username: data.username,
        email: data.email,
        role: data.role,
        position: data.position,
        designation: data.designation,
        permissions: data.permissions,
      };
      secureStorage.setJSON("user", nextUser);
      setUser(nextUser);
      return nextUser;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const stored = secureStorage.getJSON("user");
    if (!stored) {
      navigate("/admin/login", { replace: true });
      return;
    }
    setUser(stored);
    syncCurrentUser();

    // Load theme preference
    const savedTheme = secureStorage.get("admin-theme");
    const savedColor = secureStorage.get("admin-primary-color");
    if (savedColor) setPrimaryColor(savedColor);
    if (savedTheme) {
      setIsDark(savedTheme === "dark");
    }
    // Always sync from server
    api
      .get("/settings/app")
      .then(({ data }) => {
        const dark = data.theme === "dark";
        setIsDark(dark);
        secureStorage.set("admin-theme", dark ? "dark" : "light");
        if (data.primaryColor) {
          setPrimaryColor(data.primaryColor);
          secureStorage.set("admin-primary-color", data.primaryColor);
        }
        if (data.siderColor) setSiderColor(data.siderColor);
        if (data.siderColorDark) setSiderColorDark(data.siderColorDark);
        if (data.headerColor) setHeaderColor(data.headerColor);
        if (data.headerColorDark) setHeaderColorDark(data.headerColorDark);
        if (data.sidebarStyle) setSidebarStyle(data.sidebarStyle);
        syncPortalAnnouncementFlag(data);
        setDriveMaintenanceMode(!!data.driveMaintenanceMode);
      })
      .catch(() => {});
  }, [navigate, syncCurrentUser]);

  useEffect(() => {
    const handleFocus = () => syncCurrentUser();
    window.addEventListener("focus", handleFocus);
    const interval = setInterval(syncCurrentUser, 30000);
    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, [syncCurrentUser]);

  useEffect(() => {
    if (location.pathname.endsWith("/admin/app-settings/vera-workarounds")) {
      setDeveloperSettingsInitialTab("vera-workarounds");
      setActiveMenu("dev-settings");
    }
  }, [location.pathname]);

  // ── Idle auto-logout (10 minutes of inactivity) ──
  useEffect(() => {
    if (isDeveloperUser(user)) return undefined;
    const IDLE_MS = 10 * 60 * 1000;
    let timer;
    let idledOut = false;

    const onIdle = () => {
      if (idledOut) return;
      idledOut = true;
      secureStorage.clearAll();
      Swal.fire({
        icon: "warning",
        title: "Session Expired",
        text: "You have been automatically logged out due to inactivity.",
        confirmButtonText: "OK",
        allowOutsideClick: false,
        allowEscapeKey: false,
      }).then(() => {
        window.location.replace("/eswm-pipeline/admin/login");
      });
    };

    const resetTimer = () => {
      if (idledOut) return;
      clearTimeout(timer);
      timer = setTimeout(onIdle, IDLE_MS);
    };

    const events = ["mousemove", "keydown", "mousedown", "scroll", "touchstart"];
    events.forEach((e) => document.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((e) => document.removeEventListener(e, resetTimer));
    };
  }, [user?.role]);

  // Notification polling
  const fetchNotifications = useCallback(async () => {
    try {
      setNotifLoading(true);
      const { data } = await api.get("/notifications/admin");
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch { /* silent */ }
    finally { setNotifLoading(false); }
  }, []);

  const markNotifRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => n._id === id ? { ...n, read: true } : n));
      setNotifHistory((prev) => prev.map((n) => n._id === id ? { ...n, read: true } : n));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    setMarkingAllRead(true);
    try {
      await api.patch("/notifications/admin/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setNotifHistory((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* silent */ } finally {
      setMarkingAllRead(false);
    }
  };

  const fetchNotificationHistory = useCallback(async (page = 1, pageSize = 20, range = notifHistoryDateRange) => {
    setNotifHistoryLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (range?.[0]) params.dateFrom = range[0].startOf("day").toISOString();
      if (range?.[1]) params.dateTo = range[1].endOf("day").toISOString();
      const { data } = await api.get("/notifications/admin", {
        params,
      });
      setNotifHistory(data.notifications || []);
      setNotifHistoryPagination({
        current: page,
        pageSize,
        total: data.total || 0,
      });
    } catch {
      /* silent */
    } finally {
      setNotifHistoryLoading(false);
    }
  }, [notifHistoryDateRange]);

  const openNotificationHistory = () => {
    setNotifOpen(false);
    setNotifHistoryOpen(true);
    fetchNotificationHistory(1, notifHistoryPagination.pageSize);
  };

  const openNotificationTarget = (notification) => {
    if (!notification.read) markNotifRead(notification._id);
    const target = getNotifTarget(notification.type);
    if (target) {
      setActiveMenu(target);
      setNotifOpen(false);
      setNotifHistoryOpen(false);
    }
  };

  const previewMessage = (thread) => {
    if (thread.draft?.body) return thread.draft.body;
    if (thread.lastMessage?.body) return thread.lastMessage.body;
    if (thread.lastMessage?.attachments?.length) return "Attachment sent";
    if (thread.lastMessage?.appLinks?.length) return "App data attached";
    return "No messages yet";
  };

  const applyRealtimeNotification = useCallback((payload = {}) => {
    fetchNotifications();
    if (!payload?.title) return;
    const realtimeItem = {
      _id: `rt-${Date.now()}`,
      recipient: "admin",
      type: payload.type || "notification",
      title: payload.title,
      message: payload.message || "",
      meta: payload.meta || {},
      read: false,
      createdAt: new Date().toISOString(),
    };
    setNotifications((prev) => [realtimeItem, ...prev].slice(0, 10));
    setUnreadCount((prev) => prev + 1);
  }, [fetchNotifications]);

  // VERA contextual runtime nudge: a gentle, non-intrusive status heads-up when
  // there are unread notifications. VeraChat throttles it to once per session.
  useEffect(() => {
    if (unreadCount > 0) {
      window.dispatchEvent(new CustomEvent("vera:nudge", {
        detail: {
          id: "admin_unread",
          text: `You have ${unreadCount} new notification${unreadCount === 1 ? "" : "s"}. Would you like help reviewing them?`,
          cta: true,
        },
      }));
    }
  }, [unreadCount]);

  const senderName = (sender) => {
    if (!sender) return "Unknown User";
    return `${sender.firstName || ""} ${sender.lastName || ""}`.trim() || sender.username || sender.email || "Unknown User";
  };

  const fetchMessagePreview = useCallback(async () => {
    try {
      setMessageLoading(true);
      const { data } = await api.get("/messages/conversations?folder=inbox");
      const list = Array.isArray(data) ? data : [];
      setQuickMessages(list.slice(0, 6));
      setMessageUnreadCount(list.reduce((total, thread) => total + (thread.unreadCount || 0), 0));
    } catch { /* silent */ }
    finally { setMessageLoading(false); }
  }, []);

  useEffect(() => {
    // Wait until the authenticated admin is resolved (/auth/me) before hitting
    // protected endpoints or opening the socket — otherwise the first render
    // fires /messages/conversations (401) and connects a socket with no identity.
    if (!user?.email) return undefined;
    fetchNotifications();
    fetchMessagePreview();
    const socket = connectSocket("admin", { email: user.email, userId: user.id || user._id });
    // Named handlers so cleanup removes ONLY this component's listeners.
    // (`socket.off(event)` with no handler also tears down the listeners other
    // pages registered on the same shared socket, and leaves their closures
    // attached to an orphaned socket instance.)
    const onDataRefresh = ({ target } = {}) => {
      fetchNotifications();
      if (["submissions", "baselines", "tickets", "portal-users", "notifications"].includes(target)) {
        fetchMessagePreview();
      }
    };
    const onInternalMessage = () => fetchMessagePreview();
    const onMessageRefresh = () => fetchMessagePreview();
    socket.on("notification", applyRealtimeNotification);
    socket.on("data-refresh", onDataRefresh);
    socket.on("internal-message", onInternalMessage);
    socket.on("message-refresh", onMessageRefresh);
    return () => {
      socket.off("notification", applyRealtimeNotification);
      socket.off("data-refresh", onDataRefresh);
      socket.off("internal-message", onInternalMessage);
      socket.off("message-refresh", onMessageRefresh);
      disconnectSocket();
    };
  }, [applyRealtimeNotification, fetchNotifications, fetchMessagePreview, user?.email, user?.id, user?._id]);

  const markMessageThreadRead = async (threadId) => {
    const threadUnread = quickMessages.find((thread) => thread._id === threadId)?.unreadCount || 0;
    try {
      await api.patch(`/messages/conversations/${threadId}/read`);
      setQuickMessages((prev) => prev.map((thread) => thread._id === threadId ? { ...thread, unreadCount: 0 } : thread));
      setMessageUnreadCount((prev) => Math.max(0, prev - threadUnread));
    } catch { /* silent */ }
  };

  const markAllMessagesRead = async () => {
    const unreadThreads = quickMessages.filter((thread) => thread.unreadCount > 0);
    try {
      await Promise.all(unreadThreads.map((thread) => api.patch(`/messages/conversations/${thread._id}/read`)));
      setQuickMessages((prev) => prev.map((thread) => ({ ...thread, unreadCount: 0 })));
      setMessageUnreadCount(0);
    } catch { /* silent */ }
  };

  const getNotifIcon = (type) => {
    if (type === "new_submission") return <InboxOutlined style={{ color: "#2f54eb" }} />;
    if (type === "resubmission") return <ReconciliationOutlined style={{ color: "#13c2c2" }} />;
    if (type === "new_portal_user") return <TeamOutlined style={{ color: "#52c41a" }} />;
    if (type === "portal_verification_submitted") return <SafetyCertificateOutlined style={{ color: "#722ed1" }} />;
    if (type === "support_ticket" || type === "support_ticket_reply") return <CustomerServiceOutlined style={{ color: "#fa8c16" }} />;
    if (type?.includes("baseline")) return <DatabaseOutlined style={{ color: "#1677ff" }} />;
    if (type?.includes("edit_request")) return <FormOutlined style={{ color: "#eb2f96" }} />;
    if (type === "cell_capacity_alert") return <WarningOutlined style={{ color: "#faad14" }} />;
    if (type === "portal_user_email") return <MailOutlined style={{ color: "#1677ff" }} />;
    return <BellOutlined style={{ color: "#fa8c16" }} />;
  };

  const getNotifTarget = (type) => {
    if (["new_submission", "resubmission", "baseline_update_request", "baseline_update", "submission_revert_followup", "submission_temp_deleted", "submission_edit_request", "cell_capacity_alert"].includes(type)) return "slf-waste-generators";
    if (["new_portal_user", "portal_verification_submitted", "portal_user_email"].includes(type)) return "settings-portal-users";
    if (type === "support_ticket" || type === "support_ticket_reply") return "dev-support";
    return null;
  };

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    secureStorage.set("admin-theme", next ? "dark" : "light");
  };

  const handleLogout = () => {
    secureStorage.clearAll();
    navigate("/admin/login");
  };

  const isDeveloper = isDeveloperUser(user);
  const canOpenAppSettings = isDeveloper || user?.role === "admin";
  const perms = user?.permissions || {};
  const hasAccess = (key, level = "view") => {
    if (isDeveloper) return true;
    const p = perms[key];
    if (p === undefined) return false;
    if (typeof p === "boolean") return p; // backward compat
    return p?.[level] === true;
  };
  const hasExplicitAccess = (key, level = "view") => {
    if (isDeveloper) return true;
    const p = perms[key];
    if (p === undefined) return false;
    if (typeof p === "boolean") return p;
    return p?.[level] === true;
  };
  const canEdit = (key) => hasAccess(key, "edit");
  const canDelete = (key) => hasAccess(key, "delete");

  const menuItems = useMemo(() => {
    const items = [];
    const comingSoonStyle = { opacity: 0.4, cursor: "not-allowed" };

    if (hasAccess("dashboard")) {
      items.push({
        key: "dashboard",
        icon: <DashboardOutlined />,
        label: "Dashboard",
      });
    }

    if (hasAccess("messaging")) {
      items.push({
        key: "messaging",
        icon: <MessageOutlined />,
        label: "Messaging",
      });
    }

    // ── SWM Programs ──
    const swmChildren = [];
    if (hasAccess("trashTraps")) swmChildren.push({ key: "cs-trash-traps", icon: <ExperimentOutlined />, label: "Trash Traps" });
    if (hasAccess("tenYearSwm")) swmChildren.push({ key: "10yr-plan", icon: <FundProjectionScreenOutlined />, label: "10 Year SWM Plan" });
    if (hasAccess("fundedMrf")) swmChildren.push({ key: "funded-mrf", icon: <BankOutlined />, label: "Funded MRF" });
    if (hasAccess("lguInitiatedMrf")) swmChildren.push({ key: "cs-lgu-mrf", icon: <ApartmentOutlined />, label: "LGU Initiated MRF" });
    if (hasAccess("swmEquipment")) swmChildren.push({ key: "cs-swm-equip", icon: <CarOutlined />, label: "SWM Equipments" });
    if (swmChildren.length > 0) {
      items.push({
        key: "swm-programs",
        icon: <AppstoreOutlined />,
        label: "SWM Programs",
        children: swmChildren,
      });
    }

    // ── Sanitary Landfill Monitoring ──
    const slfChildren = [];
    if (hasAccess("sanitaryLandfills") && hasAccess("slfMonitoring")) {
      slfChildren.push({
        key: "slf-monitoring",
        icon: <ReconciliationOutlined />,
        label: "SLF Data Table",
      });
    }
    if (hasAccess("sanitaryLandfills") && (hasAccess("submissions") || hasAccess("reports") || hasAccess("baselineData") || hasAccess("cellWastePlacement"))) {
      slfChildren.push({
        key: "slf-waste-generators",
        icon: <InboxOutlined />,
        label: "Portal Submissions",
      });
    }
    if (hasAccess("sanitaryLandfills") && hasAccess("slfClients")) {
      slfChildren.push({
        key: "slf-clients",
        icon: <TeamOutlined />,
        label: "Hauler Clients",
      });
    }
    if (hasAccess("sanitaryLandfills") && slfChildren.length > 0) {
      items.push({
        key: "slf-group",
        icon: <SafetyCertificateOutlined />,
        label: "Sanitary Landfill",
        children: slfChildren,
      });
    }

    // ── Monitoring & Assistance ──
    const monChildren = [];
    if (hasAccess("technicalAssistance")) monChildren.push({ key: "cs-tech-assist", icon: <FundOutlined />, label: "Technical Asst. (Brgy)" });
    if (hasAccess("transferStations")) monChildren.push({ key: "cs-transfer-station", icon: <ContainerOutlined />, label: "Transfer Station" });
    if (hasAccess("openDumpsites")) monChildren.push({ key: "cs-open-dump", icon: <DeleteOutlined />, label: "Open Dump Sites" });
    if (hasAccess("projectDescScoping")) monChildren.push({ key: "cs-pds", icon: <FileDoneOutlined />, label: "PDS (Scoping)" });
    if (hasAccess("residualContainment")) monChildren.push({ key: "cs-rca", icon: <AlertOutlined />, label: "Residual Containment" });
    if (hasAccess("lguAssistDiversion")) monChildren.push({ key: "cs-lgu-diversion", icon: <EnvironmentOutlined />, label: "LGU Asst. & Diversion" });
    if (monChildren.length > 0) {
      items.push({
        key: "monitoring-assist",
        icon: <AuditOutlined />,
        label: "Monitoring",
        children: monChildren,
      });
    }

    // ── Settings ──
    {
      const settingsChildren = [];
      if (hasAccess("portalFields")) {
        settingsChildren.push({
          key: "settings-fields",
          icon: <FormOutlined />,
          label: "Portal Fields",
        });
      }
      if (hasAccess("dataReferences")) {
        settingsChildren.push({
          key: "settings-data-refs",
          icon: <DatabaseOutlined />,
          label: "Data References",
        });
      }
      if (hasAccess("orgChart")) {
        settingsChildren.push({
          key: "settings-org-chart",
          icon: <ApartmentOutlined />,
          label: "Org Chart",
        });
      }
      // #4: Generate Reports — reporting module (replaces the standalone Generate
      // PDF Report). Gated by the same `reports` permission as the report actions.
      if (hasAccess("reports")) {
        settingsChildren.push({
          key: "settings-reports",
          icon: <FilePdfOutlined />,
          label: "Generate Reports",
        });
      }
      if (isDeveloper) {
        settingsChildren.push({
          key: "settings-portal-users",
          icon: <TeamOutlined />,
          label: "Portal User Management",
        });
      } else if (hasAccess("portalUsers")) {
        settingsChildren.push({
          key: "settings-portal-users",
          icon: <TeamOutlined />,
          label: "Portal User Management",
        });
      }
      if (settingsChildren.length > 0) {
        items.push({ type: "divider" });
        items.push({
          key: "settings",
          icon: <SettingOutlined />,
          label: "Settings",
          children: settingsChildren,
        });
      }
    }

    {
      const devChildren = [];
      // App Settings includes admin/developer VERA logs; developer-only panes
      // remain guarded inside the page and on their backend routes.
      if (canOpenAppSettings) {
        devChildren.push({
          key: "dev-settings",
          icon: <ToolOutlined />,
          label: "App Settings",
        });
      }
      if (isDeveloper) {
        devChildren.push({
          key: "settings-accounts",
          icon: <TeamOutlined />,
          label: "Accounts & Roles",
        });
      }
      if (isDeveloper || hasAccess("supportTickets")) {
        devChildren.push({
          key: "dev-support",
          icon: <CustomerServiceOutlined />,
          label: "Support & Tickets",
        });
      }
      if (isDeveloper || hasExplicitAccess("notificationManagement")) {
        devChildren.push({
          key: "dev-notifications",
          icon: <BellOutlined />,
          label: "Notification Management",
        });
      }
      if (devChildren.length > 0) {
        items.push({
          key: "developer",
          icon: <CodeOutlined />,
          label: isDeveloper ? "Developer" : "Administration",
          children: devChildren,
        });
      }
    }

    return items;
  }, [canOpenAppSettings, isDeveloper, user?.permissions, user?.role]);

  const userMenuItems = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: (
        <span>
          Profile{" "}
          {isDeveloper && (
            <Tag color="purple" style={{ marginLeft: 4, fontSize: 10 }}>
              DEV
            </Tag>
          )}
        </span>
      ),
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "Logout",
      danger: true,
    },
  ];

  const handleUserMenuClick = ({ key }) => {
    if (key === "logout") handleLogout();
    if (key === "profile") setProfileModalOpen(true);
  };

  const renderContent = () => {
    const denied = (
      <DashboardContent
        user={user}
        isDark={isDark}
        setActiveMenu={setActiveMenu}
        onOpenSubmissions={openPortalSubmissions}
        canOpenSubmissions={hasAccess("submissions")}
      />
    );
    // Coming soon pages — (none remaining)
    switch (activeMenu) {
      case "10yr-plan":
        return <TenYearSWMPlan isDark={isDark} canEdit={canEdit("tenYearSwm")} canDelete={canDelete("tenYearSwm")} />;
      case "funded-mrf":
        return <FundedMRF isDark={isDark} canEdit={canEdit("fundedMrf")} canDelete={canDelete("fundedMrf")} />;
      case "cs-lgu-mrf":
        return <LguInitiatedMRF isDark={isDark} canEdit={canEdit("lguInitiatedMrf")} canDelete={canDelete("lguInitiatedMrf")} />;
      case "cs-trash-traps":
        return <TrashTraps isDark={isDark} canEdit={canEdit("trashTraps")} canDelete={canDelete("trashTraps")} />;
      case "cs-swm-equip":
        return <SwmEquipment isDark={isDark} canEdit={canEdit("swmEquipment")} canDelete={canDelete("swmEquipment")} />;
      case "cs-open-dump":
        return <OpenDumpsites isDark={isDark} canEdit={canEdit("openDumpsites")} canDelete={canDelete("openDumpsites")} />;
      case "cs-rca":
        return <ResidualContainment isDark={isDark} canEdit={canEdit("residualContainment")} canDelete={canDelete("residualContainment")} />;
      case "cs-pds":
        return <ProjectDescScoping isDark={isDark} canEdit={canEdit("projectDescScoping")} canDelete={canDelete("projectDescScoping")} />;
      case "cs-transfer-station":
        return <TransferStations isDark={isDark} canEdit={canEdit("transferStations")} canDelete={canDelete("transferStations")} />;
      case "cs-lgu-diversion":
        return <LguAssistDiversion isDark={isDark} canEdit={canEdit("lguAssistDiversion")} canDelete={canDelete("lguAssistDiversion")} />;
      case "cs-tech-assist":
        return <TechnicalAssistance isDark={isDark} canEdit={canEdit("technicalAssistance")} canDelete={canDelete("technicalAssistance")} />;
      case "settings-accounts":
        // Developer-only (direct-URL/menu-selection guard).
        return isDeveloper ? <AccountSettings isDark={isDark} /> : denied;
      case "settings-portal-users":
        return (isDeveloper || hasAccess("portalUsers")) ? (
          <PortalUsers
            isDark={isDark}
            canEdit={isDeveloper || canEdit("portalUsers")}
            canDelete={isDeveloper || canDelete("portalUsers")}
            canEmail={isDeveloper || hasExplicitAccess("portalUserEmail", "edit")}
            canSeePortalData={isDeveloper || hasExplicitAccess("portalData")}
          />
        ) : denied;
      case "messaging":
        return hasAccess("messaging") ? <Messaging isDark={isDark} currentUser={user} driveDisabled={driveMaintenanceMode} /> : denied;
      case "settings-fields":
        return hasAccess("portalFields") ? <FieldSettings isDark={isDark} canEdit={canEdit("portalFields")} canDelete={canDelete("portalFields")} /> : denied;
      case "settings-data-refs":
        return hasAccess("dataReferences") ? <DataReferences isDark={isDark} canEdit={canEdit("dataReferences")} canDelete={canDelete("dataReferences")} /> : denied;
      case "settings-org-chart":
        return hasAccess("orgChart") ? <OrgChartSettings isDark={isDark} canEdit={canEdit("orgChart")} canDelete={canDelete("orgChart")} /> : denied;
      // #4: new reporting module. Old "generate-pdf-report" deep links redirect here.
      case "settings-reports":
      case "generate-pdf-report":
        return hasAccess("reports") ? (
          <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
            <GenerateReports isDark={isDark} />
          </Suspense>
        ) : denied;
      case "slf-monitoring":
        return hasAccess("slfMonitoring") ? <SLFMonitoring isDark={isDark} canEdit={canEdit("slfMonitoring")} canDelete={canDelete("slfMonitoring")} driveDisabled={driveMaintenanceMode} /> : denied;
      case "slf-waste-generators":
        return hasAccess("submissions") || hasAccess("reports") || hasAccess("baselineData") || hasAccess("cellWastePlacement") ? (
          <SLFWasteGenerators
            isDark={isDark}
            canViewSubmissions={hasAccess("submissions")}
            canEdit={canEdit("submissions")}
            canDelete={canDelete("submissions")}
            canViewReports={hasAccess("reports")}
            canEditReports={canEdit("reports")}
            canDeleteReports={canDelete("reports")}
            canViewBaseline={hasAccess("baselineData")}
            canEditBaseline={canEdit("baselineData")}
            canDeleteBaseline={canDelete("baselineData")}
            canOverrideBaselineUnlock={isDeveloper}
            canViewCellPlacement={hasAccess("cellWastePlacement")}
            canEditCellPlacement={canEdit("cellWastePlacement")}
            canRepairIds={isDeveloper}
            isDeveloper={isDeveloper}
            initialTab={submissionsCtx?.tab || null}
            submissionsContext={submissionsCtx}
          />
        ) : (
          denied
        );
      case "slf-clients":
        return hasAccess("slfClients") ? (
          <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}><Spin /></div>}>
            <SlfClients
              isDark={isDark}
              canView={hasAccess("slfClients")}
              canEdit={canEdit("slfClients")}
              canDelete={canDelete("slfClients")}
            />
          </Suspense>
        ) : denied;
      case "dev-support":
        return (isDeveloper || hasAccess("supportTickets")) ? <SupportTab isDark={isDark} canEdit={canEdit("supportTickets")} canDelete={canDelete("supportTickets")} /> : denied;
      case "dev-notifications":
        return (isDeveloper || hasExplicitAccess("notificationManagement")) ? <NotificationManagement isDark={isDark} /> : denied;
      case "dev-settings":
        return canOpenAppSettings ? (
          <DeveloperSettings
            isDark={isDark}
            isDeveloper={isDeveloper}
            initialActiveKey={developerSettingsInitialTab}
            onSettingsSaved={(s) => {
              if (s.primaryColor) {
                setPrimaryColor(s.primaryColor);
                secureStorage.set("admin-primary-color", s.primaryColor);
              }
              if (s.theme) {
                setIsDark(s.theme === "dark");
                secureStorage.set("admin-theme", s.theme);
              }
              if (s.siderColor) setSiderColor(s.siderColor);
              if (s.siderColorDark) setSiderColorDark(s.siderColorDark);
              if (s.headerColor) setHeaderColor(s.headerColor);
              if (s.headerColorDark) setHeaderColorDark(s.headerColorDark);
              if (s.sidebarStyle) setSidebarStyle(s.sidebarStyle);
              syncPortalAnnouncementFlag(s);
            }}
          />
        ) : (
          <DashboardContent
            user={user}
            isDark={isDark}
            setActiveMenu={setActiveMenu}
          />
        );
      default:
        return (
          <DashboardContent
            user={user}
            isDark={isDark}
            setActiveMenu={setActiveMenu}
          />
        );
    }
  };

  // Theme-aware styles
  const s = useMemo(
    () =>
      getStyles(isDark, {
        siderColor,
        siderColorDark,
        headerColor,
        headerColorDark,
        sidebarStyle,
      }),
    [
      isDark,
      siderColor,
      siderColorDark,
      headerColor,
      headerColorDark,
      sidebarStyle,
    ],
  );

  const siderMenu = (
    <>
      <div style={s.logo}>
        <Tooltip title={!isMobile && collapsed ? "EMBR3 ESWMP — Ecological Solid Waste Management Pipeline" : ""} placement="right">
          <img
            src={embLogo}
            alt="EMBR3"
            style={{
              height: isMobile ? 36 : collapsed ? 32 : 40,
              marginRight: isMobile ? 10 : collapsed ? 0 : 10,
              transition: "all 0.2s",
            }}
          />
        </Tooltip>
        {(isMobile || !collapsed) && (
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.15 }}>
            <Title level={5} style={{ ...s.logoText, marginBottom: 0 }}>
              EMBR3 ESWMP
            </Title>
            {/* Secondary, subordinate subtitle — wraps to 2 lines, never widens the Sider. */}
            <Text
              style={{
                color: isDark ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.7)",
                fontSize: 10,
                lineHeight: 1.2,
                whiteSpace: "normal",
                maxWidth: 168,
              }}
            >
              Ecological Solid Waste Management Pipeline
            </Text>
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activeMenu]}
          onClick={({ key }) => {
            setActiveMenu(key);
            if (isMobile) setDrawerOpen(false);
          }}
          items={menuItems}
          inlineIndent={12}
          style={{
            background: "transparent",
            borderRight: 0,
            padding: "8px 0",
          }}
          className="sider-menu"
        />
      </div>
      {(isMobile || !collapsed) && (
        <div style={s.siderFooter}>
          <Text
            style={{
              color: "rgba(255,255,255,0.35)",
              fontSize: 10,
              letterSpacing: 0.5,
            }}
          >
            {/* Injected from package.json at build time (see vite.config.js) so
                this can never drift from the released version again. */}
            EMBR3-ESWMP v{__APP_VERSION__}
          </Text>
        </div>
      )}
    </>
  );

  // Block rendering until auth is checked — prevents dashboard flash
  if (!user) return null;

  return (
    <DataRefProvider>
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: { colorPrimary: primaryColor },
      }}
    >
      <Layout style={{ minHeight: "100vh" }} data-theme={isDark ? "dark" : "light"}>
        {/* Desktop Sider */}
        {!isMobile && (
          <Sider
            trigger={null}
            collapsible
            collapsed={collapsed}
            style={s.sider}
            width={220}
          >
            {siderMenu}
          </Sider>
        )}

        {/* Mobile Drawer */}
        {isMobile && (
          <Drawer
            placement="left"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            size={260}
            styles={{
              body: {
                padding: 0,
                background: isDark
                  ? siderColorDark || "#111927"
                  : siderColor || "#1a3353",
                display: "flex",
                flexDirection: "column",
              },
            }}
            closable={false}
          >
            {siderMenu}
          </Drawer>
        )}

        <Layout style={{ height: "100vh", overflow: "auto" }}>
          <Header style={s.header}>
            <Button
              type="text"
              icon={
                isMobile ? (
                  <MenuUnfoldOutlined />
                ) : collapsed ? (
                  <MenuUnfoldOutlined />
                ) : (
                  <MenuFoldOutlined />
                )
              }
              onClick={() =>
                isMobile ? setDrawerOpen(true) : setCollapsed(!collapsed)
              }
              style={{ fontSize: 18, color: isDark ? "#fff" : undefined }}
            />
            <div className="admin-header-right">
              {!isMobile && <LiveClock isDark={isDark} />}
              <Tooltip title="Check SLF portal announcements">
                <Tag
                  color={portalAnnouncementActive ? "green" : "default"}
                  icon={<BellOutlined />}
                  onClick={() => setPortalAnnouncementModalOpen(true)}
                  style={{
                    cursor: "pointer",
                    marginRight: 12,
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  Portal Announcements
                </Tag>  
              </Tooltip>
              <Switch
                checked={!isDark}
                onChange={toggleTheme}
                checkedChildren={<BulbFilled />}
                unCheckedChildren={<BulbOutlined />}
                style={{ marginRight: 12 }}
              />
              <Popover
                open={messageOpen}
                onOpenChange={(open) => {
                  setMessageOpen(open);
                  if (open) fetchMessagePreview();
                }}
                trigger="click"
                placement="bottomRight"
                arrow={false}
                overlayInnerStyle={{ padding: 0, borderRadius: 12, overflow: "hidden" }}
                overlayStyle={{ width: 380 }}
                content={
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 10px", borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0" }}>
                      <Space size={8}><MessageOutlined /><Text strong style={{ fontSize: 15 }}>Messages</Text></Space>
                      {messageUnreadCount > 0 && (
                        <Button type="link" size="small" onClick={markAllMessagesRead} style={{ fontSize: 12, padding: 0 }}>Mark as read</Button>
                      )}
                    </div>
                    <div style={{ maxHeight: 420, overflowY: "auto" }}>
                      {messageLoading && quickMessages.length === 0 ? (
                        <div style={{ padding: 16 }}><Skeleton active avatar paragraph={{ rows: 3 }} /></div>
                      ) : quickMessages.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No messages" style={{ padding: "40px 0" }} />
                      ) : (
                        <List
                          dataSource={quickMessages}
                          renderItem={(thread) => {
                            const isUnread = thread.unreadCount > 0;
                            const lastSender = thread.lastMessage?.sender;
                            return (
                              <div
                                key={thread._id}
                                onClick={() => {
                                  setActiveMenu("messaging");
                                  setMessageOpen(false);
                                }}
                                style={{
                                  display: "flex", gap: 12, padding: "12px 16px",
                                  cursor: "pointer",
                                  background: isUnread ? (isDark ? "rgba(47,84,235,0.06)" : "#f0f5ff") : "transparent",
                                  borderBottom: isDark ? "1px solid #303030" : "1px solid #f5f5f5",
                                }}
                              >
                                <Avatar style={{ backgroundColor: isUnread ? "#2f54eb" : (isDark ? "#303030" : "#d9e6f2") }} icon={<UserOutlined />} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                    <Text strong={isUnread} style={{ fontSize: 13 }} ellipsis>{thread.subject}</Text>
                                    <Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{dayjs(thread.lastMessageAt || thread.updatedAt).fromNow()}</Text>
                                  </div>
                                  <Text type="secondary" style={{ display: "block", fontSize: 12 }} ellipsis>
                                    {lastSender ? `${senderName(lastSender)}: ` : ""}{previewMessage(thread)}
                                  </Text>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                                    {isUnread ? <Badge count={thread.unreadCount} size="small" /> : <Text type="secondary" style={{ fontSize: 11 }}>Read</Text>}
                                    {isUnread && (
                                      <Button
                                        type="link"
                                        size="small"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          markMessageThreadRead(thread._id);
                                        }}
                                        style={{ padding: 0, fontSize: 12 }}
                                      >
                                        Mark as read
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          }}
                        />
                      )}
                    </div>
                    <div style={{ padding: 12, borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0", textAlign: "center" }}>
                      <Button type="primary" block icon={<MessageOutlined />} onClick={() => { setActiveMenu("messaging"); setMessageOpen(false); }}>
                        See all in Messaging
                      </Button>
                    </div>
                  </div>
                }
              >
                <Badge count={messageUnreadCount} size="small" offset={[-6, 6]} style={{ backgroundColor: "#2f54eb", boxShadow: isDark ? "0 0 0 2px #141414" : "0 0 0 2px #fff", fontSize: 10, lineHeight: "16px", height: 16, minWidth: 16, padding: "0 4px" }}>
                  <Tooltip title="Messages">
                    <Button
                      type="text"
                      icon={<MessageOutlined />}
                      style={{
                        fontSize: 18,
                        color: isDark ? "#999" : "#666",
                        marginRight: 4,
                      }}
                    />
                  </Tooltip>
                </Badge>
              </Popover>
              <Popover
                open={notifOpen}
                onOpenChange={setNotifOpen}
                trigger="click"
                placement="bottomRight"
                arrow={false}
                overlayInnerStyle={{ padding: 0, borderRadius: 12, overflow: "hidden" }}
                overlayStyle={{ width: 380 }}
                content={
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 10px", borderBottom: isDark ? "1px solid #303030" : "1px solid #f0f0f0" }}>
                      <Text strong style={{ fontSize: 15 }}>Notifications</Text>
                      {unreadCount > 0 && (
                        <Button type="link" size="small" loading={markingAllRead} onClick={markAllRead} style={{ fontSize: 12, padding: 0 }}>Mark all as read</Button>
                      )}
                    </div>
                    <div style={{ maxHeight: 420, overflowY: "auto" }}>
                      {notifLoading && notifications.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "40px 0" }}><Spin size="small" /></div>
                      ) : notifications.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notifications" style={{ padding: "40px 0" }} />
                      ) : (
                        <List
                          dataSource={notifications}
                          renderItem={(n) => (
                            <div
                              key={n._id}
                            onClick={() => {
                              openNotificationTarget(n);
                            }}
                              style={{
                                display: "flex", gap: 12, padding: "12px 16px",
                                cursor: getNotifTarget(n.type) ? "pointer" : (n.read ? "default" : "pointer"),
                                background: n.read ? "transparent" : (isDark ? "rgba(47,84,235,0.06)" : "#f0f5ff"),
                                borderBottom: isDark ? "1px solid #303030" : "1px solid #f5f5f5",
                                transition: "background 0.2s",
                              }}
                            >
                              <div style={{ width: 36, height: 36, borderRadius: "50%", background: isDark ? "#1f1f1f" : "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                                {getNotifIcon(n.type)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                  <Text strong={!n.read} style={{ fontSize: 13, lineHeight: 1.3 }}>{n.title}</Text>
                                  {!n.read && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#2f54eb", flexShrink: 0, marginTop: 4 }} />}
                                </div>
                                <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.message}</Text>
                                <Text type="secondary" style={{ fontSize: 11, marginTop: 2, display: "block" }}>{dayjs(n.createdAt).fromNow()}</Text>
                              </div>
                            </div>
                          )}
                        />
                      )}
                    </div>
                    <div style={{ padding: 12, borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0", textAlign: "center" }}>
                      <Button type="link" block icon={<BellOutlined />} onClick={openNotificationHistory}>
                        View previous notifications
                      </Button>
                    </div>
                  </div>
                }
              >
                <Badge count={unreadCount} size="small" offset={[-6, 6]} style={{ backgroundColor: "#ff4d4f", boxShadow: isDark ? "0 0 0 2px #141414" : "0 0 0 2px #fff", fontSize: 10, lineHeight: "16px", height: 16, minWidth: 16, padding: "0 4px" }}>
                  <Button
                    type="text"
                    icon={<BellOutlined />}
                    style={{
                      fontSize: 18,
                      color: isDark ? "#999" : "#666",
                      marginRight: 12,
                    }}
                  />
                </Badge>
              </Popover>
              {/* Dedicated VERA notification bell — separate icon + dropdown from the
                  standard bell above; surfaces deterministic VERA findings. */}
              <VeraNotificationBell isDark={isDark} userId={user?.email || user?.id || user?._id} />
              <Dropdown
                menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
                trigger={["click"]}
              >
                <div style={s.userInfo}>
                  <Avatar
                    style={{ backgroundColor: isDark ? "#2a4060" : "#1a3353" }}
                    icon={<UserOutlined />}
                  />
                  <Text
                    strong
                    style={{
                      marginLeft: 8,
                      cursor: "pointer",
                      color: isDark ? "#fff" : undefined,
                    }}
                  >
                    {user?.firstName}
                  </Text>
                </div>
              </Dropdown>
            </div>
          </Header>

          <Content
            className="admin-content"
            style={{ background: isDark ? "#1f1f1f" : "#f0f2f5" }}
          >
            {driveMaintenanceMode && (
              <Alert
                type="error"
                banner
                showIcon
                icon={<AlertOutlined />}
                message="Google Drive is currently in maintenance mode."
                description="All file uploads (documents, images, LOI attachments) are disabled until Drive access is restored. Data entry and Excel imports are unaffected. Go to Developer Settings → Portal & Email to disable maintenance mode once Drive is available again."
                style={{ marginBottom: 0, borderRadius: 0 }}
              />
            )}
            <Suspense fallback={<div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 80 }}><Spin size="large" /></div>}>
            {renderContent()}
            </Suspense>
          </Content>

          <div style={s.footer}>
            <Text style={{ color: isDark ? "#666" : "#999", fontSize: 12 }}>
              © 2026 EMBR3 — Ecological Solid Waste Management Pipeline. All
              rights reserved.
            </Text>
          </div>
        </Layout>
      </Layout>

      {/* VERA — Admin assistant (role-gated to admin KB by the backend; developer
          topics are refused). Ticket actions hidden on the admin side. */}
      <VeraChat activeMenu={activeMenu} isMobile={isMobile} hideTicketActions />
      <VeraOnboarding portal="admin" userId={user?.email || user?.id || user?._id} />

      <Modal
        title={
          <Space size={12}>
            <Avatar
              shape="square"
              size={40}
              icon={<BellOutlined />}
              style={{
                background: currentPortalAnnouncement?.portalAnnouncementEnabled
                  ? "linear-gradient(135deg, #1a3353 0%, #2f54eb 100%)"
                  : "linear-gradient(135deg, #8c8c8c 0%, #bfbfbf 100%)",
                color: "#fff",
                borderRadius: 12,
              }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>
                SLF Portal Announcement
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Review the currently published header announcement and its visibility.
              </Text>
            </div>
          </Space>
        }
        open={portalAnnouncementModalOpen}
        onCancel={() => setPortalAnnouncementModalOpen(false)}
        footer={
          <Space>
            <Button
              onClick={() => {
                setPortalAnnouncementModalOpen(false);
                setDeveloperSettingsInitialTab("announcements");
                setActiveMenu("dev-settings");
              }}
            >
              Manage Announcement
            </Button>
            <Button type="primary" onClick={() => setPortalAnnouncementModalOpen(false)}>Close</Button>
          </Space>
        }
        width={760}
        styles={{
          body: {
            maxHeight: "68vh",
            overflowY: "auto",
            paddingRight: 8,
          },
        }}
      >
        {currentPortalAnnouncement?.portalAnnouncementEnabled ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card
              bordered={false}
              style={{
                borderRadius: 18,
                background:
                  currentPortalAnnouncement.portalAnnouncementType === "warning"
                    ? "linear-gradient(135deg, #fff7e6 0%, #fff1b8 100%)"
                    : currentPortalAnnouncement.portalAnnouncementType === "error"
                      ? "linear-gradient(135deg, #fff1f0 0%, #ffccc7 100%)"
                      : currentPortalAnnouncement.portalAnnouncementType === "success"
                        ? "linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)"
                        : "linear-gradient(135deg, #f0f5ff 0%, #d6e4ff 100%)",
                boxShadow: "0 14px 34px rgba(0,0,0,0.08)",
              }}
            >
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                <Space wrap>
                  <Tag color={currentPortalAnnouncement.portalAnnouncementType || "blue"} style={{ borderRadius: 999, paddingInline: 10 }}>
                    {(currentPortalAnnouncement.portalAnnouncementType || "info").toUpperCase()}
                  </Tag>
                  <Tag color="green" style={{ borderRadius: 999, paddingInline: 10 }}>
                    PUBLISHED
                  </Tag>
                </Space>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#1a3353", lineHeight: 1.15 }}>
                  {currentPortalAnnouncement.portalAnnouncementTitle || "SLF Portal Announcement"}
                </div>
                <Text style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.75, color: "#243b53" }}>
                  {currentPortalAnnouncement.portalAnnouncementMessage || "No announcement message set."}
                </Text>
              </Space>
            </Card>
          </Space>
        ) : (
          <Card
            bordered={false}
            style={{
              borderRadius: 18,
              background: "linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%)",
              textAlign: "center",
            }}
          >
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No published portal announcement" />
            <Button
              type="primary"
              style={{ marginTop: 8 }}
              onClick={() => {
                setPortalAnnouncementModalOpen(false);
                setDeveloperSettingsInitialTab("announcements");
                setActiveMenu("dev-settings");
              }}
            >
              Create Announcement
            </Button>
          </Card>
        )}
      </Modal>

      <Modal
        title={
          <Space>
            <BellOutlined />
            <span>Previous Notifications</span>
            {unreadCount > 0 && <Badge count={unreadCount} size="small" />}
          </Space>
        }
        open={notifHistoryOpen}
        onCancel={() => setNotifHistoryOpen(false)}
        footer={
          <Space>
            {unreadCount > 0 && <Button loading={markingAllRead} onClick={markAllRead}>Mark all as read</Button>}
            <Button type="primary" onClick={() => setNotifHistoryOpen(false)}>Close</Button>
          </Space>
        }
        width={860}
      >
        <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
          <DatePicker.RangePicker
            value={notifHistoryDateRange}
            onChange={(range) => {
              setNotifHistoryDateRange(range);
              fetchNotificationHistory(1, notifHistoryPagination.pageSize, range);
            }}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchNotificationHistory(1, notifHistoryPagination.pageSize, notifHistoryDateRange)} loading={notifHistoryLoading}>
            Refresh
          </Button>
        </Space>
        <List
          loading={notifHistoryLoading}
          dataSource={notifHistory}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No previous notifications" /> }}
          pagination={
            notifHistoryPagination.total > notifHistoryPagination.pageSize
              ? {
                  current: notifHistoryPagination.current,
                  pageSize: notifHistoryPagination.pageSize,
                  total: notifHistoryPagination.total,
                  showSizeChanger: true,
                  pageSizeOptions: ["10", "20", "50"],
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
                  onChange: (page, pageSize) => fetchNotificationHistory(page, pageSize, notifHistoryDateRange),
                }
              : false
          }
          renderItem={(notification) => {
            const target = getNotifTarget(notification.type);
            return (
              <List.Item
                key={notification._id}
                onClick={() => openNotificationTarget(notification)}
                style={{
                  cursor: target || !notification.read ? "pointer" : "default",
                  padding: "12px 4px",
                  background: notification.read ? "transparent" : isDark ? "rgba(47,84,235,0.06)" : "#f0f5ff",
                  borderRadius: 8,
                  marginBottom: 4,
                }}
              >
                <List.Item.Meta
                  avatar={
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: isDark ? "#1f1f1f" : "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                      {getNotifIcon(notification.type)}
                    </div>
                  }
                  title={
                    <Space size={6} wrap>
                      <Text strong={!notification.read}>{notification.title}</Text>
                      {!notification.read && <Badge status="processing" text="Unread" />}
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ display: "block" }}>{notification.message}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(notification.createdAt).format("MMM D, YYYY h:mm A")}</Text>
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Modal>

      <Modal
        title={
          <Space>
            <UserOutlined /> My Profile
          </Space>
        }
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        footer={
          <Button onClick={() => setProfileModalOpen(false)}>Close</Button>
        }
      >
        {user && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <Avatar
                size={72}
                style={{ backgroundColor: primaryColor }}
                icon={<UserOutlined />}
              />
              <div style={{ marginTop: 12 }}>
                <Title level={4} style={{ margin: 0 }}>
                  {getAdminDisplayName(user) || "Admin"}
                </Title>
                <Tag
                  color={
                    isDeveloperUser(user)
                      ? "purple"
                      : user.role === "admin"
                        ? "gold"
                        : "blue"
                  }
                  style={{ marginTop: 6 }}
                >
                  {user.role?.toUpperCase()}
                </Tag>
              </div>
            </div>
            <Divider style={{ margin: "12px 0" }} />
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
              <Descriptions.Item label="Position">
                {user.position || "\u2014"}
              </Descriptions.Item>
              <Descriptions.Item label="Designation">
                {user.designation || "\u2014"}
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Modal>
    </ConfigProvider>
    </DataRefProvider>
  );
}

function ComingSoonContent({ isDark, title, description }) {
  const textColor = isDark ? "#e0e0e0" : "#1a3353";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 400,
      }}
    >
      <Card
        style={{
          borderRadius: 16,
          textAlign: "center",
          maxWidth: 480,
          width: "100%",
          boxShadow: isDark
            ? "0 4px 24px rgba(0,0,0,0.3)"
            : "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.25 }}>🚧</div>
        <Title level={3} style={{ margin: 0, color: textColor }}>
          {title}
        </Title>
        <Text
          type="secondary"
          style={{ display: "block", marginTop: 8, fontSize: 15 }}
        >
          {description ||
            "This module is currently under development and will be available soon."}
        </Text>
        <Tag
          color="gold"
          style={{ marginTop: 20, fontSize: 13, padding: "4px 16px" }}
        >
          Coming Soon
        </Tag>
      </Card>
    </div>
  );
}

