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
  Drawer,
  Grid,
  Popover,
  Empty,
  Spin,
  List,
} from "antd";
import {
  DashboardOutlined,
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
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import AccountSettings from "./admin/AccountSettings";
const FieldSettings = lazy(() => import("./admin/FieldSettings"));
const SubmissionSettings = lazy(() => import("./admin/SubmissionSettings"));
const DeveloperSettings = lazy(() => import("./admin/DeveloperSettings"));
const DataReferences = lazy(() => import("./admin/DataReferences"));
const SLFMonitoring = lazy(() => import("./admin/SLFMonitoring"));
const SLFWasteGenerators = lazy(() => import("./admin/SLFWasteGenerators"));
const OrgChartSettings = lazy(() => import("./admin/OrgChartSettings"));
const TenYearSWMPlan = lazy(() => import("./admin/TenYearSWMPlan"));
const FundedMRF = lazy(() => import("./admin/FundedMRF"));
const LguInitiatedMRF = lazy(() => import("./admin/LguInitiatedMRF"));
const TrashTraps = lazy(() => import("./admin/TrashTraps"));
const SwmEquipment = lazy(() => import("./admin/SwmEquipment"));
const OpenDumpsites = lazy(() => import("./admin/OpenDumpsites"));
const ResidualContainment = lazy(() => import("./admin/ResidualContainment"));
const ProjectDescScoping = lazy(() => import("./admin/ProjectDescScoping"));
const TransferStations = lazy(() => import("./admin/TransferStations"));
const LguAssistDiversion = lazy(() => import("./admin/LguAssistDiversion"));
const TechnicalAssistance = lazy(() => import("./admin/TechnicalAssistance"));
const Reports = lazy(() => import("./admin/Reports"));
const SupportTab = lazy(() => import("./admin/SupportTab"));
const NotificationManagement = lazy(() => import("./admin/NotificationManagement"));
import api from "../api";
import secureStorage from "../utils/secureStorage";
import { DataRefProvider } from "../utils/dataRef";
import embLogo from "../assets/emblogo.svg";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { connectSocket, disconnectSocket } from "../utils/socket";
dayjs.extend(relativeTime);

// Fix default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const STATUS_COLORS = {
  Approved: { bg: "#52c41a", icon: "✓" },
  "For Renewal": { bg: "#faad14", icon: "▲" },
  Other: { bg: "#8c8c8c", icon: "●" },
};
const getPlanStatus = (forRenewal) => {
  if (!forRenewal) return "Other";
  if (/approved/i.test(forRenewal)) return "Approved";
  if (/renewal/i.test(forRenewal)) return "For Renewal";
  return "Other";
};
const planStatusIcon = (forRenewal) => {
  const s = STATUS_COLORS[getPlanStatus(forRenewal)];
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${s.bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:bold">${s.icon}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  });
};

/* Province boundary overlay — fetches PH province GeoJSON and highlights filtered province */
const PH_GEOJSON_URL =
  "https://raw.githubusercontent.com/macoymejia/geojsonph/master/Province/Provinces.json";
let _phGeoCache = null;

function ProvinceBoundary({ province }) {
  const map = useMap();
  const [geoData, setGeoData] = useState(null);
  useEffect(() => {
    if (!province) return;
    let cancelled = false;
    const load = async () => {
      if (!_phGeoCache) {
        try {
          const res = await fetch(PH_GEOJSON_URL);
          _phGeoCache = await res.json();
        } catch {
          _phGeoCache = null;
          return;
        }
      }
      if (!_phGeoCache || cancelled) return;
      const match = _phGeoCache.features.filter((f) => {
        const name = (
          f.properties.PROVINCE ||
          f.properties.NAME ||
          f.properties.name ||
          ""
        ).toUpperCase();
        return (
          name === province.toUpperCase() ||
          name.includes(province.toUpperCase()) ||
          province.toUpperCase().includes(name)
        );
      });
      if (cancelled) return;
      if (match.length > 0) {
        const fc = { type: "FeatureCollection", features: match };
        setGeoData(fc);
        try {
          const layer = L.geoJSON(fc);
          map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 11 });
        } catch {}
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [province, map]);
  if (!geoData) return null;
  return (
    <GeoJSON
      data={geoData}
      style={{
        color: "#1890ff",
        weight: 3,
        fillColor: "#1890ff",
        fillOpacity: 0.1,
        dashArray: "6 4",
      }}
    />
  );
}

function FitBounds({ points }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
      fitted.current = true;
    }
  }, [points, map]);
  return null;
}

const TILE_LAYERS = {
  street: {
    name: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attr: "&copy; Esri, Maxar, Earthstar",
  },
  terrain: {
    name: "Terrain",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attr: "&copy; OpenTopoMap",
  },
  dark: {
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attr: "&copy; CARTO",
  },
};

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;
const { useBreakpoint } = Grid;

export default function AdminHome() {
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [isDark, setIsDark] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#1a3353");
  const [siderColor, setSiderColor] = useState("#1a3353");
  const [siderColorDark, setSiderColorDark] = useState("#111927");
  const [headerColor, setHeaderColor] = useState("#ffffff");
  const [headerColorDark, setHeaderColorDark] = useState("#141414");
  const [sidebarStyle, setSidebarStyle] = useState("gradient");
  const [currentTime, setCurrentTime] = useState(dayjs());
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const navigate = useNavigate();

  useEffect(() => {
    const stored = secureStorage.getJSON("user");
    if (!stored) {
      navigate("/admin/login", { replace: true });
      return;
    }
    setUser(stored);

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
      })
      .catch(() => {});
  }, [navigate]);

  // ── Idle auto-logout (5 minutes of inactivity) ──
  useEffect(() => {
    const IDLE_MS = 5 * 60 * 1000;
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
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(dayjs()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  useEffect(() => {
    fetchNotifications();
    const socket = connectSocket("admin");
    socket.on("notification", () => fetchNotifications());
    socket.on("data-refresh", () => fetchNotifications());
    return () => {
      socket.off("notification");
      socket.off("data-refresh");
      disconnectSocket();
    };
  }, [fetchNotifications]);

  const markNotifRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => n._id === id ? { ...n, read: true } : n));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    try {
      await api.patch("/notifications/admin/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* silent */ }
  };

  const getNotifIcon = (type) => {
    if (type === "new_submission") return <InboxOutlined style={{ color: "#2f54eb" }} />;
    if (type === "resubmission") return <ReconciliationOutlined style={{ color: "#13c2c2" }} />;
    if (type === "new_portal_user") return <TeamOutlined style={{ color: "#52c41a" }} />;
    return <BellOutlined style={{ color: "#fa8c16" }} />;
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

  const isDeveloper = user?.role === "developer";
  const perms = user?.permissions || {};
  const hasAccess = (key, level = "view") => {
    if (isDeveloper) return true;
    const p = perms[key];
    if (p === undefined) return true;
    if (typeof p === "boolean") return p; // backward compat
    return p?.[level] !== false;
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
    if (hasAccess("slfMonitoring")) {
      slfChildren.push({
        key: "slf-monitoring",
        icon: <ReconciliationOutlined />,
        label: "SLF Data Table",
      });
    }
    if (hasAccess("submissions") || hasAccess("reports")) {
      slfChildren.push({
        key: "slf-waste-generators",
        icon: <InboxOutlined />,
        label: "Portal Submissions",
      });
    }
    if (slfChildren.length > 0) {
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
      if (isDeveloper && hasAccess("accountSettings")) {
        settingsChildren.push({
          key: "settings-accounts",
          icon: <TeamOutlined />,
          label: "Accounts & Roles",
        });
      }
      if (isDeveloper && hasAccess("portalFields")) {
        settingsChildren.push({
          key: "settings-fields",
          icon: <FormOutlined />,
          label: "Portal Fields",
        });
      }
      if (isDeveloper) {
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

    if (isDeveloper) {
      const devChildren = [
        {
          key: "dev-settings",
          icon: <ToolOutlined />,
          label: "App Settings",
        },
        {
          key: "dev-support",
          icon: <CustomerServiceOutlined />,
          label: "Support & Tickets",
        },
        {
          key: "dev-notifications",
          icon: <BellOutlined />,
          label: "Notification Management",
        },
      ];
      items.push({
        key: "developer",
        icon: <CodeOutlined />,
        label: "Developer",
        children: devChildren,
      });
    } else if (hasAccess("supportTickets")) {
      // Non-developer with support access
      items.push({ type: "divider" });
      items.push({
        key: "dev-support",
        icon: <CustomerServiceOutlined />,
        label: "Support & Tickets",
      });
    }

    return items;
  }, [isDeveloper, user?.permissions, user?.role]);

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
        return hasAccess("accountSettings") ? <AccountSettings isDark={isDark} /> : denied;
      case "settings-fields":
        return hasAccess("portalFields") ? <FieldSettings isDark={isDark} canEdit={canEdit("portalFields")} canDelete={canDelete("portalFields")} /> : denied;
      case "settings-data-refs":
        return <DataReferences isDark={isDark} canEdit={canEdit("dataReferences")} canDelete={canDelete("dataReferences")} />;
      case "settings-org-chart":
        return hasAccess("orgChart") ? <OrgChartSettings isDark={isDark} canEdit={canEdit("orgChart")} canDelete={canDelete("orgChart")} /> : denied;
      case "slf-monitoring":
        return hasAccess("slfMonitoring") ? <SLFMonitoring isDark={isDark} canEdit={canEdit("slfMonitoring")} canDelete={canDelete("slfMonitoring")} /> : denied;
      case "slf-waste-generators":
        return hasAccess("submissions") || hasAccess("reports") ? (
          <SLFWasteGenerators isDark={isDark} canEdit={canEdit("submissions")} canDelete={canDelete("submissions")} />
        ) : (
          denied
        );
      case "dev-support":
        return (isDeveloper || hasAccess("supportTickets")) ? <SupportTab isDark={isDark} /> : denied;
      case "dev-notifications":
        return isDeveloper ? <NotificationManagement isDark={isDark} /> : denied;
      case "dev-settings":
        return isDeveloper ? (
          <DeveloperSettings isDark={isDark}
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
        <img
          src={embLogo}
          alt="EMBR3"
          style={{
            height: isMobile ? 36 : collapsed ? 32 : 40,
            marginRight: isMobile ? 10 : collapsed ? 0 : 10,
            transition: "all 0.2s",
          }}
        />
        {(isMobile || !collapsed) && (
          <Title level={5} style={s.logoText}>
            EMBR3 ESWMP
          </Title>
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
            EMBR3-ESWMP v1.0.0
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
            width={260}
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
              {!isMobile && (
                <div
                  className="admin-clock"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    marginRight: 16,
                    gap: 6,
                  }}
                >
                  <ClockCircleOutlined
                    style={{ fontSize: 14, color: isDark ? "#999" : "#888" }}
                  />
                  <Text
                    style={{
                      fontSize: 13,
                      color: isDark ? "#ccc" : "#666",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {currentTime.format("ddd, MMM DD YYYY \u2014 h:mm:ss A")}
                  </Text>
                </div>
              )}
              <Switch
                checked={!isDark}
                onChange={toggleTheme}
                checkedChildren={<BulbFilled />}
                unCheckedChildren={<BulbOutlined />}
                style={{ marginRight: 12 }}
              />
              <Tooltip title="Messages (Coming Soon)">
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
                        <Button type="link" size="small" onClick={markAllRead} style={{ fontSize: 12, padding: 0 }}>Mark all as read</Button>
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
                              onClick={() => { if (!n.read) markNotifRead(n._id); }}
                              style={{
                                display: "flex", gap: 12, padding: "12px 16px",
                                cursor: n.read ? "default" : "pointer",
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
                  {user.firstName} {user.lastName}
                </Title>
                <Tag
                  color={
                    user.role === "developer"
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

function DashboardContent({ user, isDark, setActiveMenu }) {
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
  const [dashYear, setDashYear] = useState("");
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

  const filteredSlfMapPts = useMemo(() => {
    let pts = slfMapPts;
    if (slfFilterProvince)
      pts = pts.filter((p) => p.record.province === slfFilterProvince);
    if (slfFilterStatus) {
      if (slfFilterStatus === "Operational")
        pts = pts.filter(
          (p) =>
            /operational/i.test(p.record.statusOfSLF) &&
            !/non/i.test(p.record.statusOfSLF),
        );
      else if (slfFilterStatus === "Non-Operational")
        pts = pts.filter((p) => /non/i.test(p.record.statusOfSLF));
      else pts = pts.filter((p) => !p.record.statusOfSLF);
    }
    return pts;
  }, [slfMapPts, slfFilterProvince, slfFilterStatus]);

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

  const tile = TILE_LAYERS[tileKey];
  const mrfTile = TILE_LAYERS[mrfTileKey];

  const DASH_CACHE_KEY = "dashboard-stats-cache";

  const applyStats = useCallback((slfData, swmData, mrfData, lguMrfData, trapData, equipData, slfFacData, openDumpData, rcaData, pdsData, techAssistData, tsData, lguDivData) => {
    setStats((prev) => { const n = slfData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setSwmStats((prev) => { const n = swmData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setMrfStats((prev) => { const n = mrfData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setLguMrfStats((prev) => { const n = lguMrfData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setTrapStats((prev) => { const n = trapData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setEquipStats((prev) => { const n = equipData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setSlfFacStats((prev) => { const n = slfFacData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setOpenDumpStats((prev) => { const n = openDumpData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setRcaStats((prev) => { const n = rcaData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setPdsStats((prev) => { const n = pdsData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setTechAssistStats((prev) => { const n = techAssistData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setTsStats((prev) => { const n = tsData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
    setLguDivStats((prev) => { const n = lguDivData; return JSON.stringify(prev) === JSON.stringify(n) ? prev : n; });
  }, []);

  const fetchStats = useCallback(async (year) => {
    try {
      const yp = year ? `?year=${year}` : "";
      // Show cached data immediately for instant rendering
      const cacheKey = `${DASH_CACHE_KEY}-${year || "all"}`;
      const cached = secureStorage.getJSON(cacheKey);
      if (cached) {
        applyStats(cached.stats, cached.swmStats, cached.mrfStats, cached.lguMrfStats, cached.trapStats, cached.equipStats, cached.slfFacStats, cached.openDumpStats, cached.rcaStats, cached.pdsStats, cached.techAssistStats, cached.tsStats, cached.lguDivStats);
        setLoading(false);
      }
      // Always fetch fresh data from all endpoints in parallel
      const [slfRes, swmRes, mrfRes, lguMrfRes, trapRes, equipRes, slfFacRes, histRes, openDumpRes, rcaRes, pdsRes, techAssistRes, tsRes, lguDivRes] =
        await Promise.all([
          api.get("/data-slf/stats"),
          api.get(`/ten-year-swm/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/funded-mrf/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/lgu-initiated-mrf/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/trash-traps/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/swm-equipment/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/slf-facilities/stats${yp}`).catch(() => ({ data: null })),
          api.get("/data-history/summary").catch(() => ({ data: null })),
          api.get(`/open-dumpsites/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/residual-containment/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/project-desc-scoping/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/technical-assistance/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/transfer-stations/stats${yp}`).catch(() => ({ data: null })),
          api.get(`/lgu-assist-diversion/stats${yp}`).catch(() => ({ data: null })),
        ]);
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

  useEffect(() => {
    setLoading(true);
    fetchStats(dashYear);
    // Fetch dashboard tab settings
    api.get("/settings/app").then(({ data }) => {
      setDashboardTabSettings(data.dashboardTabs && typeof data.dashboardTabs === "object" ? data.dashboardTabs : {});
    }).catch(() => { setDashboardTabSettings({}); });
    const interval = setInterval(() => fetchStats(dashYear), 60000);
    return () => clearInterval(interval);
  }, [fetchStats, dashYear]);

  const statusColors = {
    pending: "#faad14",
    acknowledged: "#52c41a",
    rejected: "#ff4d4f",
  };
  const textColor = isDark ? "#e0e0e0" : "#1a3353";

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
      render: (v) => dayjs(v).format("MMM DD, YYYY h:mm A"),
    },
  ];

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
                                <span>{pt.lat.toFixed(6)}, {pt.lng.toFixed(6)}</span>
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

    const SLF_CATEGORY_DESC = {
      "Cat 1": "< 15 TPD",
      "Cat 2": "15\u201375 TPD",
      "Cat 3": "75\u2013150 TPD",
      "Cat 4": "> 150 TPD",
    };

    const SLF_CARD_H = 250;

    tabItems.push({
      key: "slf-monitoring",
      label: (
        <span>
          <BankOutlined /> SLF Monitoring
        </span>
      ),
      children: (
        <Tabs
          defaultActiveKey="slf-facilities"
          size="small"
          items={[
            {
              key: "slf-facilities",
              label: (
                <span>
                  <BankOutlined /> SLF Monitoring
                </span>
              ),
              children: (
                <>
                  {/* Row 1: Total SLF | Total Cells | LGUs Served | Private Sectors Served */}
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #2f54eb" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Total SLF"
                          value={slfFacStats.totalRecords}
                          prefix={<BankOutlined style={{ color: "#2f54eb" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 3 }} />
                          {slfByStatus["Operational"] || 0}/{slfFacStats.totalRecords} Operational
                        </Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #13c2c2" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Total Cells"
                          value={slfOps.totalCells || 0}
                          prefix={<ContainerOutlined style={{ color: "#13c2c2" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>across {slfFacStats.totalRecords} facilities</Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #fa8c16" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="LGUs Served"
                          value={slfOps.totalLGUsServed || 0}
                          prefix={<TeamOutlined style={{ color: "#fa8c16" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>from {slfFacStats.totalRecords} SLFs</Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #722ed1" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Private Sectors Served"
                          value={slfPrivateCount}
                          prefix={<BankOutlined style={{ color: "#722ed1" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>{slfPrivateCount}/{slfFacStats.totalRecords} private-owned</Text>
                      </Card>
                    </Col>
                  </Row>

                  {/* Row 2: Total Capacity | Waste Received | Leachate Ponds | Gas Vents */}
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #eb2f96" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Total Capacity"
                          value={slfOps.totalCapacity || 0}
                          prefix={<BarChartOutlined style={{ color: "#eb2f96" }} />}
                          formatter={(v) => Number(v).toLocaleString()}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>combined volume</Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #ff4d4f" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Waste Received"
                          value={slfOps.totalWasteReceived || 0}
                          suffix="tons"
                          prefix={<BarChartOutlined style={{ color: "#ff4d4f" }} />}
                          formatter={(v) => Number(v).toLocaleString()}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>total across SLFs</Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #1890ff" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Leachate Ponds"
                          value={slfOps.totalLeachatePonds || 0}
                          prefix={<AlertOutlined style={{ color: "#1890ff" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>across facilities</Text>
                      </Card>
                    </Col>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110, borderLeft: "4px solid #52c41a" }}
                        loading={loading}
                        styles={{ body: { padding: "10px 14px" } }}
                      >
                        <Statistic
                          title="Gas Vents"
                          value={slfOps.totalGasVents || 0}
                          prefix={<SafetyCertificateOutlined style={{ color: "#52c41a" }} />}
                        />
                        <Text type="secondary" style={{ fontSize: 11 }}>across facilities</Text>
                      </Card>
                    </Col>
                  </Row>

                  {/* Two-column layout: cards left, map right */}
                  <Row gutter={[16, 16]}>
                    {/* LEFT COLUMN — Stats cards */}
                    <Col xs={24} lg={14}>
                      <Row gutter={[16, 16]}>
                        {/* By Status */}
                        <Col xs={24} sm={12}>
                          <Card
                            title={
                              <>
                                <CheckCircleOutlined /> By Status
                              </>
                            }
                            style={{ borderRadius: 10, height: SLF_CARD_H }}
                            loading={loading}
                            styles={{
                              body: { overflow: "auto", height: SLF_CARD_H - 57 },
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                              }}
                            >
                              {Object.entries(slfByStatus).map(([status, count]) => (
                                <div key={status}>
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      marginBottom: 4,
                                    }}
                                  >
                                    <Text>{status}</Text>
                                    <Text strong>
                                      {count}{" "}
                                      <span style={{ color: "#999", fontWeight: 400 }}>
                                        (
                                        {slfFacStats.totalRecords > 0
                                          ? Math.round(
                                              (count / slfFacStats.totalRecords) * 100,
                                            )
                                          : 0}
                                        %)
                                      </span>
                                    </Text>
                                  </div>
                                  <Progress
                                    percent={
                                      slfFacStats.totalRecords > 0
                                        ? Math.round(
                                            (count / slfFacStats.totalRecords) * 100,
                                          )
                                        : 0
                                    }
                                    showInfo={false}
                                    strokeColor={/non/i.test(status) ? "#ff4d4f" : "#52c41a"}
                                    size="small"
                                  />
                                </div>
                              ))}
                            </div>
                          </Card>
                        </Col>

                        {/* By Category */}
                        <Col xs={24} sm={12}>
                          <Card
                            title={
                              <>
                                <BankOutlined /> By Category
                              </>
                            }
                            style={{ borderRadius: 10, height: SLF_CARD_H }}
                            loading={loading}
                            styles={{
                              body: { overflow: "auto", height: SLF_CARD_H - 57 },
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                              }}
                            >
                              {Object.entries(slfByCategory).map(([cat, count]) => (
                                <div key={cat}>
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      marginBottom: 4,
                                    }}
                                  >
                                    <Text>{cat}{SLF_CATEGORY_DESC[cat] ? ` \u2014 ${SLF_CATEGORY_DESC[cat]}` : ""}</Text>
                                    <Text strong>
                                      {count}{" "}
                                      <span style={{ color: "#999", fontWeight: 400 }}>
                                        (
                                        {slfFacStats.totalRecords > 0
                                          ? Math.round(
                                              (count / slfFacStats.totalRecords) * 100,
                                            )
                                          : 0}
                                        %)
                                      </span>
                                    </Text>
                                  </div>
                                  <Progress
                                    percent={
                                      slfFacStats.totalRecords > 0
                                        ? Math.round(
                                            (count / slfFacStats.totalRecords) * 100,
                                          )
                                        : 0
                                    }
                                    showInfo={false}
                                    strokeColor="#722ed1"
                                    size="small"
                                  />
                                </div>
                              ))}
                            </div>
                          </Card>
                        </Col>

                        {/* By Province */}
                        <Col xs={24} sm={12}>
                          <Card
                            title={
                              <>
                                <EnvironmentOutlined /> SLFs per Province
                              </>
                            }
                            style={{ borderRadius: 10, height: SLF_CARD_H }}
                            loading={loading}
                            styles={{
                              body: { overflow: "auto", height: SLF_CARD_H - 57 },
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
                              {slfProvList.map((p, i) => (
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
                                        width: `${Math.max((p.count / slfMaxProv) * 100, 4)}%`,
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

                        {/* Key Metrics */}
                        <Col xs={24} sm={12}>
                          <Card
                            title={
                              <>
                                <BarChartOutlined /> Key Metrics
                              </>
                            }
                            style={{ borderRadius: 10, height: SLF_CARD_H }}
                            loading={loading}
                            styles={{
                              body: {
                                overflow: "auto",
                                height: SLF_CARD_H - 57,
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
                                      Total Cells
                                    </Text>
                                    <Text
                                      strong
                                      style={{ fontSize: 16, color: "#13c2c2" }}
                                    >
                                      {(slfOps.totalCells || 0).toLocaleString()}
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
                                      Leachate Ponds
                                    </Text>
                                    <Text
                                      strong
                                      style={{ fontSize: 16, color: "#722ed1" }}
                                    >
                                      {(slfOps.totalLeachatePonds || 0).toLocaleString()}
                                    </Text>
                                  </div>
                                </Col>
                              </Row>
                              <Row gutter={8}>
                                <Col span={12}>
                                  <div
                                    style={{
                                      textAlign: "center",
                                      padding: "6px 4px",
                                      background: isDark ? "rgba(82,196,26,0.15)" : "#f6ffed",
                                      borderRadius: 6,
                                      border: "1px solid #b7eb8f",
                                    }}
                                  >
                                    <Text
                                      type="secondary"
                                      style={{ fontSize: 10, display: "block" }}
                                    >
                                      Gas Vents
                                    </Text>
                                    <Text
                                      strong
                                      style={{ fontSize: 16, color: "#52c41a" }}
                                    >
                                      {(slfOps.totalGasVents || 0).toLocaleString()}
                                    </Text>
                                  </div>
                                </Col>
                                <Col span={12}>
                                  <div
                                    style={{
                                      textAlign: "center",
                                      padding: "6px 4px",
                                      background: isDark ? "rgba(250,173,20,0.15)" : "#fff7e6",
                                      borderRadius: 6,
                                      border: "1px solid #ffd591",
                                    }}
                                  >
                                    <Text
                                      type="secondary"
                                      style={{ fontSize: 10, display: "block" }}
                                    >
                                      LGUs Served
                                    </Text>
                                    <Text
                                      strong
                                      style={{ fontSize: 16, color: "#fa8c16" }}
                                    >
                                      {(slfOps.totalLGUsServed || 0).toLocaleString()}
                                    </Text>
                                  </div>
                                </Col>
                              </Row>
                            </div>
                          </Card>
                        </Col>
                      </Row>
                    </Col>

                    {/* RIGHT COLUMN — SLF Map (sticky) */}
                    <Col xs={24} lg={10}>
                      <div
                        style={{
                          position: "sticky",
                          top: 80,
                          height: SLF_CARD_H * 3 + 32,
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
                          style={{ borderRadius: 10, height: "100%" }}
                          loading={loading}
                          extra={
                            <Space size={4}>
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
                                { label: "✓ Operational", value: "Operational" },
                                {
                                  label: "✕ Non-Operational",
                                  value: "Non-Operational",
                                },
                              ]}
                              style={{ minWidth: 130, flex: 1 }}
                            />
                            {(slfFilterProvince || slfFilterStatus) && (
                              <Button
                                size="small"
                                type="link"
                                danger
                                onClick={() => {
                                  setSlfFilterProvince(null);
                                  setSlfFilterStatus(null);
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
                          {filteredSlfMapPts.length > 0 ? (
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
                                  icon={slfStatusIcon(pt.record.statusOfSLF)}
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
                                        {pt.record.lgu}
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
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: 4,
                                          flexWrap: "wrap",
                                          marginBottom: 6,
                                        }}
                                      >
                                        {(() => {
                                          const s = pt.record.statusOfSLF;
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
                                        {pt.record.category && (
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: 3,
                                              background: isDark ? "rgba(114,46,209,0.15)" : "#f9f0ff",
                                              color: "#722ed1",
                                              borderRadius: 4,
                                              padding: "1px 6px",
                                              fontSize: 11,
                                            }}
                                          >
                                            {pt.record.category}
                                          </span>
                                        )}
                                      </div>
                                      <div
                                        style={{
                                          background: isDark ? "#1f1f1f" : "#fafafa",
                                          borderRadius: 6,
                                          padding: "6px 8px",
                                          marginBottom: 6,
                                        }}
                                      >
                                        {pt.record.volumeCapacity != null && (
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
                                              Capacity
                                            </span>
                                            <strong>
                                              {Number(pt.record.volumeCapacity).toLocaleString()}
                                            </strong>
                                          </div>
                                        )}
                                        {pt.record.noOfLGUServed != null && (
                                          <div
                                            style={{
                                              display: "flex",
                                              justifyContent: "space-between",
                                              marginBottom: 3,
                                            }}
                                          >
                                            <span style={{ color: "#595959" }}>
                                              <TeamOutlined
                                                style={{ color: "#fa8c16" }}
                                              />{" "}
                                              LGUs Served
                                            </span>
                                            <strong>
                                              {pt.record.noOfLGUServed}
                                            </strong>
                                          </div>
                                        )}
                                        {pt.record.yearStartedOperation && (
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
                                              Year Started
                                            </span>
                                            <strong>
                                              {pt.record.yearStartedOperation}
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
                                      {pt.record.enmo && (
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
                                          {pt.record.enmo}
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
            },
            {
              key: "waste-generators",
              label: (
                <span>
                  <DatabaseOutlined /> Waste Generators
                </span>
              ),
              children: (
                <>
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col xs={12} sm={12} md={6}>
                      <Card
                        hoverable
                        style={{ borderRadius: 10, height: 110 }}
                        loading={loading}
                      >
                        <Statistic
                          title="Total Submissions"
                          value={stats?.submissions || 0}
                          prefix={<FileTextOutlined style={{ color: "#2f54eb" }} />}
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
                          title="Generators"
                          value={stats?.generators || 0}
                          prefix={<BankOutlined style={{ color: "#722ed1" }} />}
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
                          title="Total Trucks"
                          value={stats?.totalTrucks || 0}
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
                        <Tooltip title="Click to view Waste Generators page">
                          <div
                            style={{ cursor: "pointer" }}
                            onClick={() => setActiveMenu("slf-waste-generators")}
                          >
                            <Statistic
                              title="View All Records"
                              value={stats?.submissions || 0}
                              prefix={<FileTextOutlined style={{ color: "#fa8c16" }} />}
                            />
                          </div>
                        </Tooltip>
                      </Card>
                    </Col>
                  </Row>

                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={8}>
                      <Card
                        title={
                          <>
                            <PieChartOutlined /> By Status
                          </>
                        }
                        size="small"
                        style={{ borderRadius: 10 }}
                        loading={loading}
                      >
                        {Object.entries(stats?.byStatus || {}).map(([status, count]) => (
                          <div key={status} style={{ marginBottom: 8 }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 2,
                              }}
                            >
                              <Text>{status?.charAt(0).toUpperCase() + status?.slice(1)}</Text>
                              <Text strong>{count}</Text>
                            </div>
                            <Progress
                              percent={
                                stats?.submissions > 0
                                  ? Math.round((count / stats.submissions) * 100)
                                  : 0
                              }
                              showInfo={false}
                              strokeColor={
                                status === "acknowledged"
                                  ? "#52c41a"
                                  : status === "rejected"
                                    ? "#ff4d4f"
                                    : "#faad14"
                              }
                              size="small"
                            />
                          </div>
                        ))}
                      </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                      <Card
                        title={
                          <>
                            <ApartmentOutlined /> By Company Type
                          </>
                        }
                        size="small"
                        style={{ borderRadius: 10 }}
                        loading={loading}
                      >
                        {Object.entries(stats?.byCompanyType || {}).map(
                          ([type, count]) => (
                            <div key={type} style={{ marginBottom: 8 }}>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: 2,
                                }}
                              >
                                <Text>{type || "Unspecified"}</Text>
                                <Text strong>{count}</Text>
                              </div>
                              <Progress
                                percent={
                                  stats?.submissions > 0
                                    ? Math.round((count / stats.submissions) * 100)
                                    : 0
                                }
                                showInfo={false}
                                strokeColor="#1890ff"
                                size="small"
                              />
                            </div>
                          ),
                        )}
                      </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                      <Card
                        title={
                          <>
                            <BarChartOutlined /> Waste by Type
                          </>
                        }
                        size="small"
                        style={{ borderRadius: 10 }}
                        loading={loading}
                      >
                        {(stats?.wasteByType || []).map((w) => (
                          <div key={w._id} style={{ marginBottom: 8 }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 2,
                              }}
                            >
                              <Text>{w._id || "Unspecified"}</Text>
                              <Text strong>
                                {Number(w.totalVolume).toLocaleString()} ({w.count})
                              </Text>
                            </div>
                            <Progress
                              percent={Math.min(
                                Math.round(
                                  (w.totalVolume /
                                    Math.max(
                                      ...(stats?.wasteByType || []).map(
                                        (x) => x.totalVolume,
                                      ),
                                      1,
                                    )) *
                                    100,
                                ),
                                100,
                              )}
                              showInfo={false}
                              strokeColor="#722ed1"
                              size="small"
                            />
                          </div>
                        ))}
                      </Card>
                    </Col>
                  </Row>
                </>
              ),
            },
          ]}
        />
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
      { key: "slf-monitoring", label: <span><BankOutlined /> SLF Monitoring</span> },
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
              <Empty description={<Text type="secondary">No data available{dashYear ? ` for ${dashYear}` : ""}. Records may exist in other years.</Text>} />
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
                      <Col span={12}><Text type="secondary">Date Installed:</Text>{" "}<Text strong>{trapViewRecord.dateInstalled ? dayjs(trapViewRecord.dateInstalled).format("MMM DD, YYYY") : "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Status:</Text>{" "}<Text strong>{trapViewRecord.statusOfTrashTraps || "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">HDPE Floaters:</Text>{" "}<Text strong>{trapViewRecord.noOfTrashTrapsHDPE ?? "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Waste Hauled:</Text>{" "}<Text strong>{trapViewRecord.estimatedVolumeWasteHauled ? `${Number(trapViewRecord.estimatedVolumeWasteHauled).toLocaleString()} kg` : "\u2014"}</Text></Col>
                      <Col span={12}><Text type="secondary">Last Hauling:</Text>{" "}<Text>{trapViewRecord.dateOfLastHauling ? dayjs(trapViewRecord.dateOfLastHauling).format("MMM DD, YYYY") : "\u2014"}</Text></Col>
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
                    <Col span={12}><Text type="secondary">Date of Monitoring:</Text>{" "}<Text>{trapViewRecord.dateOfMonitoring ? dayjs(trapViewRecord.dateOfMonitoring).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Report Prepared:</Text>{" "}<Text>{trapViewRecord.dateReportPrepared ? dayjs(trapViewRecord.dateReportPrepared).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Reviewed (Staff):</Text>{" "}<Text>{trapViewRecord.dateReportReviewedStaff ? dayjs(trapViewRecord.dateReportReviewedStaff).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Reviewed (Focal):</Text>{" "}<Text>{trapViewRecord.dateReportReviewedFocal ? dayjs(trapViewRecord.dateReportReviewedFocal).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                    <Col span={12}><Text type="secondary">Report Approved:</Text>{" "}<Text>{trapViewRecord.dateReportApproved ? dayjs(trapViewRecord.dateReportApproved).format("MMM D, YYYY") : "\u2014"}</Text></Col>
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
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <Title level={3} style={{ margin: 0, color: textColor }}>
            Dashboard
          </Title>
          <Text type="secondary">
            Here&apos;s a real-time overview of the system.
          </Text>
        </div>
        <Space size="middle">
          <Select
            value={dashYear}
            onChange={(v) => setDashYear(v)}
            style={{ width: 130 }}
            options={[
              { label: "All Years", value: "" },
              ...Array.from({ length: 7 }, (_, i) => {
                const y = new Date().getFullYear() - i;
                return { label: `Year ${y}`, value: y };
              }),
            ]}
          />
          {loading && <Spin size="small" />}
        </Space>
      </div>
      {/* Filter tabs by dashboard visibility settings, wrap maintenance tabs */}
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
            style={{ marginTop: 8 }}
          />
        );
      })()}
    </>
  );
}

function getStyles(isDark, opts = {}) {
  const {
    siderColor = "#1a3353",
    siderColorDark = "#111927",
    headerColor = "#ffffff",
    headerColorDark = "#141414",
    sidebarStyle = "gradient",
  } = opts;

  const baseSider = isDark ? siderColorDark : siderColor;
  const siderBg =
    sidebarStyle === "gradient"
      ? `linear-gradient(180deg, ${baseSider} 0%, ${adjustBrightness(baseSider, 30)} 100%)`
      : baseSider;

  return {
    sider: {
      background: siderBg,
      boxShadow: "2px 0 8px rgba(0,0,0,0.15)",
      display: "flex",
      flexDirection: "column",
    },
    logo: {
      height: 64,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
    },
    logoText: {
      color: "#fff",
      margin: 0,
      fontWeight: 800,
      letterSpacing: 1,
    },
    siderFooter: {
      padding: "12px 16px",
      textAlign: "center",
      borderTop: "1px solid rgba(255,255,255,0.06)",
    },
    header: {
      background: isDark ? headerColorDark : headerColor,
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      boxShadow: isDark
        ? "0 1px 4px rgba(0,0,0,0.3)"
        : "0 1px 4px rgba(0,0,0,0.06)",
      position: "sticky",
      top: 0,
      zIndex: 10,
    },
    headerRight: {
      display: "flex",
      alignItems: "center",
    },
    userInfo: {
      display: "flex",
      alignItems: "center",
      cursor: "pointer",
      padding: "4px 8px",
      borderRadius: 8,
    },
    content: {
      margin: 24,
      padding: 24,
      background: isDark ? "#1f1f1f" : "#f0f2f5",
      minHeight: 280,
      flex: "1 0 auto",
    },
    footer: {
      textAlign: "center",
      padding: "16px 24px",
      background: isDark ? "#141414" : "#fff",
      borderTop: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
    },
  };
}

// Lighten / darken a hex color by `amount` (positive = lighten)
function adjustBrightness(hex, amount) {
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((ch) => ch + ch)
      .join("");
  const num = parseInt(c, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
