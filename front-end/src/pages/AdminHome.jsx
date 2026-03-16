import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import AccountSettings from "./admin/AccountSettings";
import FieldSettings from "./admin/FieldSettings";
import SubmissionSettings from "./admin/SubmissionSettings";
import DeveloperSettings from "./admin/DeveloperSettings";
import SLFMonitoring from "./admin/SLFMonitoring";
import TenYearSWMPlan from "./admin/TenYearSWMPlan";
import FundedMRF from "./admin/FundedMRF";
import Reports from "./admin/Reports";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import embLogo from "../assets/emblogo.svg";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import dayjs from "dayjs";

// Fix default Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
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
const PH_GEOJSON_URL = "https://raw.githubusercontent.com/macoymejia/geojsonph/master/Province/Provinces.json";
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
        } catch { _phGeoCache = null; return; }
      }
      if (!_phGeoCache || cancelled) return;
      const match = _phGeoCache.features.filter((f) => {
        const name = (f.properties.PROVINCE || f.properties.NAME || f.properties.name || "").toUpperCase();
        return name === province.toUpperCase() || name.includes(province.toUpperCase()) || province.toUpperCase().includes(name);
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
    return () => { cancelled = true; };
  }, [province, map]);
  if (!geoData) return null;
  return <GeoJSON data={geoData} style={{ color: "#1890ff", weight: 3, fillColor: "#1890ff", fillOpacity: 0.10, dashArray: "6 4" }} />;
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
  street: { name: "Street", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  satellite: { name: "Satellite", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: '&copy; Esri, Maxar, Earthstar' },
  terrain: { name: "Terrain", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: '&copy; OpenTopoMap' },
  dark: { name: "Dark", url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attr: '&copy; CARTO' },
};

const { Header, Sider, Content } = Layout;
const { Title, Text } = Typography;

export default function AdminHome() {
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState(null);
  const [activeMenu, setActiveMenu] = useState("slf-overview");
  const [isDark, setIsDark] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#1a3353");
  const [siderColor, setSiderColor] = useState("#1a3353");
  const [siderColorDark, setSiderColorDark] = useState("#111927");
  const [headerColor, setHeaderColor] = useState("#ffffff");
  const [headerColorDark, setHeaderColorDark] = useState("#141414");
  const [sidebarStyle, setSidebarStyle] = useState("gradient");
  const [currentTime, setCurrentTime] = useState(dayjs());
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const stored = secureStorage.getJSON("user");
    if (!stored) {
      navigate("/login");
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

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(dayjs()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    secureStorage.set("admin-theme", next ? "dark" : "light");
  };

  const handleLogout = () => {
    Swal.fire({
      title: "Logout",
      text: "Are you sure you want to logout?",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#1a3353",
      confirmButtonText: "Yes, logout",
    }).then((result) => {
      if (result.isConfirmed) {
        secureStorage.clearAll();
        navigate("/login");
      }
    });
  };

  const isDeveloper = user?.role === "developer";
  const perms = user?.permissions || {};
  const hasAccess = (key) => isDeveloper || perms[key] !== false;

  const menuItems = useMemo(() => {
    const items = [];
    const comingSoonStyle = { opacity: 0.4, cursor: "not-allowed" };

    if (hasAccess("dashboard")) {
      items.push({ key: "dashboard", icon: <DashboardOutlined />, label: "Dashboard" });
    }

    // ── SWM Programs ──
    items.push({
      key: "swm-programs",
      icon: <AppstoreOutlined />,
      label: "SWM Programs",
      children: [
        { key: "cs-trash-traps", icon: <ExperimentOutlined />, label: "Trash Traps", disabled: true, style: comingSoonStyle },
        { key: "10yr-plan", icon: <FundProjectionScreenOutlined />, label: "10 Year SWM Plan" },
        { key: "funded-mrf", icon: <BankOutlined />, label: "Funded MRF" },
        { key: "cs-lgu-mrf", icon: <ApartmentOutlined />, label: "LGU Initiated MRF", disabled: true, style: comingSoonStyle },
        { key: "cs-swm-equip", icon: <CarOutlined />, label: "SWM Equipments", disabled: true, style: comingSoonStyle },
      ],
    });

    // ── Sanitary Landfill Monitoring ──
    const slfChildren = [];
    slfChildren.push({ key: "slf-overview", icon: <DashboardOutlined />, label: "Overview" });
    if (hasAccess("submissions")) {
      slfChildren.push({ key: "submissions", icon: <InboxOutlined />, label: "Submissions" });
    }
    if (hasAccess("slfMonitoring")) {
      slfChildren.push({ key: "slf-monitoring", icon: <ReconciliationOutlined />, label: "SLF Facilities" });
    }
    if (hasAccess("reports")) {
      slfChildren.push({ key: "reports", icon: <BarChartOutlined />, label: "Reports" });
    }
    if (slfChildren.length > 0) {
      items.push({ key: "slf-group", icon: <SafetyCertificateOutlined />, label: "Sanitary Landfill", children: slfChildren });
    }

    // ── Monitoring & Assistance ──
    items.push({
      key: "monitoring-assist",
      icon: <AuditOutlined />,
      label: "Monitoring",
      children: [
        { key: "cs-tech-assist", icon: <FundOutlined />, label: "Technical Asst. (Brgy)", disabled: true, style: comingSoonStyle },
        { key: "cs-transfer-station", icon: <ContainerOutlined />, label: "Transfer Station", disabled: true, style: comingSoonStyle },
        { key: "cs-open-dump", icon: <DeleteOutlined />, label: "Open Dump Sites", disabled: true, style: comingSoonStyle },
        { key: "cs-pds", icon: <FileDoneOutlined />, label: "PDS (Scoping)", disabled: true, style: comingSoonStyle },
        { key: "cs-rca", icon: <AlertOutlined />, label: "Residual Containment", disabled: true, style: comingSoonStyle },
        { key: "cs-lgu-diversion", icon: <EnvironmentOutlined />, label: "LGU Asst. & Diversion", disabled: true, style: comingSoonStyle },
      ],
    });

    // ── Settings ──
    const settingsChildren = [];
    if (hasAccess("accountSettings")) {
      settingsChildren.push({ key: "settings-accounts", icon: <TeamOutlined />, label: "Accounts & Roles" });
    }
    if (hasAccess("portalFields")) {
      settingsChildren.push({ key: "settings-fields", icon: <FormOutlined />, label: "Portal Fields" });
    }
    if (settingsChildren.length > 0) {
      items.push({ type: "divider" });
      items.push({ key: "settings", icon: <SettingOutlined />, label: "Settings", children: settingsChildren });
    }

    if (isDeveloper) {
      items.push({
        key: "developer",
        icon: <CodeOutlined />,
        label: "Developer",
        children: [
          {
            key: "dev-settings",
            icon: <ToolOutlined />,
            label: "App Settings",
          },
        ],
      });
    }

    return items;
  }, [isDeveloper, user?.permissions]);

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
    const denied = <DashboardContent user={user} isDark={isDark} setActiveMenu={setActiveMenu} />;

    // Coming soon pages
    if (activeMenu.startsWith("cs-")) {
      const csLabels = {
        "cs-trash-traps": "SWM Trash Traps",
        "cs-lgu-mrf": "LGU Initiated MRF",
        "cs-swm-equip": "SWM Equipments",
        "cs-tech-assist": "SWM Technical Assistance (Barangay)",
        "cs-transfer-station": "SWM Transfer Station",
        "cs-open-dump": "Open Dump Sites",
        "cs-pds": "Project Description for Scoping (PDS)",
        "cs-rca": "Residual Containment Area Monitoring",
        "cs-lgu-diversion": "LGU Assistance & Waste Diversion",
      };
      return <ComingSoonContent isDark={isDark} title={csLabels[activeMenu] || "Module"} />;
    }

    switch (activeMenu) {
      case "slf-overview":
        return <DashboardContent user={user} isDark={isDark} setActiveMenu={setActiveMenu} />;
      case "10yr-plan":
        return <TenYearSWMPlan />;
      case "funded-mrf":
        return <FundedMRF />;
      case "settings-accounts":
        return hasAccess("accountSettings") ? <AccountSettings /> : denied;
      case "settings-fields":
        return hasAccess("portalFields") ? <FieldSettings /> : denied;
      case "submissions":
        return hasAccess("submissions") ? <SubmissionSettings /> : denied;
      case "slf-monitoring":
        return hasAccess("slfMonitoring") ? <SLFMonitoring /> : denied;
      case "reports":
        return hasAccess("reports") ? <Reports /> : denied;
      case "dev-settings":
        return isDeveloper ? <DeveloperSettings onSettingsSaved={(s) => {
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
        }} /> : <DashboardContent user={user} isDark={isDark} setActiveMenu={setActiveMenu} />;
      default:
        return <DashboardContent user={user} isDark={isDark} setActiveMenu={setActiveMenu} />;
    }
  };

  // Theme-aware styles
  const s = useMemo(
    () => getStyles(isDark, { siderColor, siderColorDark, headerColor, headerColorDark, sidebarStyle }),
    [isDark, siderColor, siderColorDark, headerColor, headerColorDark, sidebarStyle]
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: { colorPrimary: primaryColor },
      }}
    >
      <Layout style={{ minHeight: "100vh" }}>
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          style={s.sider}
          width={220}
        >
          <div style={s.logo}>
            <img
              src={embLogo}
              alt="EMBR3"
              style={{
                height: collapsed ? 32 : 40,
                marginRight: collapsed ? 0 : 10,
                transition: "all 0.2s",
              }}
            />
            {!collapsed && (
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
                if (!key.startsWith("cs-")) setActiveMenu(key);
              }}
              items={menuItems}
              style={{ background: "transparent", borderRight: 0, padding: "8px 0" }}
              className="sider-menu"
            />
          </div>
          {!collapsed && (
            <div style={s.siderFooter}>
              <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, letterSpacing: 0.5 }}>
                ESWMP v1.0.0
              </Text>
            </div>
          )}
        </Sider>

        <Layout style={{ height: "100vh", overflow: "auto" }}>
          <Header style={s.header}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: 18, color: isDark ? "#fff" : undefined }}
            />
            <div style={s.headerRight}>
              <div style={{ display: "flex", alignItems: "center", marginRight: 16, gap: 6 }}>
                <ClockCircleOutlined style={{ fontSize: 14, color: isDark ? "#999" : "#888" }} />
                <Text style={{ fontSize: 13, color: isDark ? "#ccc" : "#666", whiteSpace: "nowrap" }}>
                  {currentTime.format("ddd, MMM DD YYYY \u2014 h:mm:ss A")}
                </Text>
              </div>
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
                  style={{ fontSize: 18, color: isDark ? "#999" : "#666", marginRight: 4 }}
                />
              </Tooltip>
              <Tooltip title="Notifications (Coming Soon)">
                <Badge count={0} size="small">
                  <Button
                    type="text"
                    icon={<BellOutlined />}
                    style={{ fontSize: 18, color: isDark ? "#999" : "#666", marginRight: 12 }}
                  />
                </Badge>
              </Tooltip>
              <Dropdown
                menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
                trigger={["click"]}
              >
                <div style={s.userInfo}>
                  <Avatar
                    style={{ backgroundColor: "#1a3353" }}
                    icon={<UserOutlined />}
                  />
                  <Text strong style={{ marginLeft: 8, cursor: "pointer", color: isDark ? "#fff" : undefined }}>
                    {user?.firstName}
                  </Text>
                </div>
              </Dropdown>
            </div>
          </Header>

          <Content style={s.content}>{renderContent()}</Content>

          <div style={s.footer}>
            <Text style={{ color: isDark ? "#666" : "#999", fontSize: 12 }}>
              © 2026 EMBR3 — Ecological Solid Waste Management Pipeline. All rights reserved.
            </Text>
          </div>
        </Layout>
      </Layout>

      <Modal
        title={<Space><UserOutlined /> My Profile</Space>}
        open={profileModalOpen}
        onCancel={() => setProfileModalOpen(false)}
        footer={<Button onClick={() => setProfileModalOpen(false)}>Close</Button>}
      >
        {user && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <Avatar size={72} style={{ backgroundColor: primaryColor }} icon={<UserOutlined />} />
              <div style={{ marginTop: 12 }}>
                <Title level={4} style={{ margin: 0 }}>{user.firstName} {user.lastName}</Title>
                <Tag color={user.role === "developer" ? "purple" : user.role === "admin" ? "gold" : "blue"} style={{ marginTop: 6 }}>
                  {user.role?.toUpperCase()}
                </Tag>
              </div>
            </div>
            <Divider style={{ margin: "12px 0" }} />
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
              <Descriptions.Item label="Position">{user.position || "\u2014"}</Descriptions.Item>
              <Descriptions.Item label="Designation">{user.designation || "\u2014"}</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Modal>

    </ConfigProvider>
  );
}

function ComingSoonContent({ isDark, title, description }) {
  const textColor = isDark ? "#e0e0e0" : "#1a3353";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
      <Card
        style={{
          borderRadius: 16,
          textAlign: "center",
          maxWidth: 480,
          width: "100%",
          boxShadow: isDark ? "0 4px 24px rgba(0,0,0,0.3)" : "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.25 }}>🚧</div>
        <Title level={3} style={{ margin: 0, color: textColor }}>{title}</Title>
        <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 15 }}>
          {description || "This module is currently under development and will be available soon."}
        </Text>
        <Tag color="gold" style={{ marginTop: 20, fontSize: 13, padding: "4px 16px" }}>Coming Soon</Tag>
      </Card>
    </div>
  );
}

function DashboardContent({ user, isDark, setActiveMenu }) {
  const [stats, setStats] = useState(null);
  const [swmStats, setSwmStats] = useState(null);
  const [mrfStats, setMrfStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tileKey, setTileKey] = useState("street");
  const [mapFilterProvince, setMapFilterProvince] = useState(null);
  const [mapFilterStatus, setMapFilterStatus] = useState(null);
  const [mapViewRecord, setMapViewRecord] = useState(null);
  const [mrfTileKey, setMrfTileKey] = useState("street");
  const [mrfFilterProvince, setMrfFilterProvince] = useState(null);
  const [mrfFilterStatus, setMrfFilterStatus] = useState(null);

  const mapPts = useMemo(() => ((swmStats && swmStats.mapData) || [])
    .filter((r) => r.latitude && r.longitude && !isNaN(r.latitude) && !isNaN(r.longitude))
    .map((r) => ({ lat: Number(r.latitude), lng: Number(r.longitude), record: r })),
  [swmStats && swmStats.mapData]);

  const filteredMapPts = useMemo(() => {
    let pts = mapPts;
    if (mapFilterProvince) pts = pts.filter((p) => p.record.province === mapFilterProvince);
    if (mapFilterStatus) pts = pts.filter((p) => getPlanStatus(p.record.forRenewal) === mapFilterStatus);
    return pts;
  }, [mapPts, mapFilterProvince, mapFilterStatus]);

  const provinceOptions = useMemo(() => {
    const set = new Set(mapPts.map((p) => p.record.province).filter(Boolean));
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [mapPts]);

  // MRF map points
  const mrfMapPts = useMemo(() => ((mrfStats && mrfStats.mapData) || [])
    .filter((r) => r.latitude && r.longitude && !isNaN(r.latitude) && !isNaN(r.longitude))
    .map((r) => ({ lat: Number(r.latitude), lng: Number(r.longitude), record: r })),
  [mrfStats && mrfStats.mapData]);

  const filteredMrfMapPts = useMemo(() => {
    let pts = mrfMapPts;
    if (mrfFilterProvince) pts = pts.filter((p) => p.record.province === mrfFilterProvince);
    if (mrfFilterStatus) {
      if (mrfFilterStatus === "Operational") pts = pts.filter((p) => /operational/i.test(p.record.statusOfMRF) && !/non/i.test(p.record.statusOfMRF));
      else if (mrfFilterStatus === "Non-Operational") pts = pts.filter((p) => /non/i.test(p.record.statusOfMRF));
      else pts = pts.filter((p) => !p.record.statusOfMRF);
    }
    return pts;
  }, [mrfMapPts, mrfFilterProvince, mrfFilterStatus]);

  const mrfProvinceOptions = useMemo(() => {
    const set = new Set(mrfMapPts.map((p) => p.record.province).filter(Boolean));
    return [...set].sort().map((v) => ({ label: v, value: v }));
  }, [mrfMapPts]);

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

  const tile = TILE_LAYERS[tileKey];
  const mrfTile = TILE_LAYERS[mrfTileKey];

  const fetchStats = useCallback(async () => {
    try {
      const [slfRes, swmRes, mrfRes] = await Promise.all([
        api.get("/data-slf/stats"),
        api.get("/ten-year-swm/stats").catch(() => ({ data: null })),
        api.get("/funded-mrf/stats").catch(() => ({ data: null })),
      ]);
      setStats(slfRes.data);
      setSwmStats(swmRes.data);
      setMrfStats(mrfRes.data);
    } catch {
      /* silently fail */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 8000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const statusColors = { pending: "#faad14", acknowledged: "#52c41a", rejected: "#ff4d4f" };
  const textColor = isDark ? "#e0e0e0" : "#1a3353";

  const pendingCount = stats?.byStatus?.pending || 0;
  const ackCount = stats?.byStatus?.acknowledged || 0;
  const rejCount = stats?.byStatus?.rejected || 0;
  const totalSub = stats?.submissions || 0;

  const months = (stats?.monthlyData || []).map((m) => ({
    label: dayjs().month(m._id.month - 1).format("MMM") + " " + m._id.year,
    count: m.count,
    volume: m.totalVolume,
  }));
  const maxCount = Math.max(...months.map((m) => m.count), 1);

  const recentColumns = [
    { title: "ID", dataIndex: "idNo", key: "idNo", render: (v) => <Tag>{v}</Tag> },
    { title: "Company", dataIndex: "lguCompanyName", key: "lguCompanyName" },
    { title: "Type", dataIndex: "companyType", key: "companyType" },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v) => <Tag color={statusColors[v]}>{v?.charAt(0).toUpperCase() + v?.slice(1)}</Tag>,
    },
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v) => dayjs(v).format("MMM DD, YYYY h:mm A"),
    },
  ];

  // Build tab items — only show tabs that have data
  const tabItems = [];

  // Overview tab always shows
  tabItems.push({
    key: "overview",
    label: <><DashboardOutlined /> Overview</>,
    children: (
      <>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable style={{ borderRadius: 10 }} loading={loading}>
              <Statistic
                title="SLF Facilities"
                value={stats?.generators || 0}
                prefix={<ReconciliationOutlined style={{ color: "#1a3353" }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable style={{ borderRadius: 10 }} loading={loading}>
              <Statistic
                title="Total Submissions"
                value={totalSub}
                prefix={<InboxOutlined style={{ color: "#2d5f8a" }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable style={{ borderRadius: 10 }} loading={loading}>
              <Statistic
                title="Pending"
                value={pendingCount}
                styles={{ content: { color: "#faad14" } }}
                prefix={<ClockCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card hoverable style={{ borderRadius: 10 }} loading={loading}>
              <Statistic
                title="Total Trucks"
                value={stats?.totalTrucks || 0}
                prefix={<RiseOutlined style={{ color: "#52c41a" }} />}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={12}>
            <Card title={<><PieChartOutlined /> Submission Status</>} style={{ borderRadius: 10 }} loading={loading}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "Acknowledged", count: ackCount, color: "#52c41a" },
                  { label: "Pending", count: pendingCount, color: "#faad14" },
                  { label: "Rejected", count: rejCount, color: "#ff4d4f" },
                ].map((s) => (
                  <div key={s.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <Text style={{ color: isDark ? "#ccc" : undefined }}>{s.label}</Text>
                      <Text strong style={{ color: isDark ? "#fff" : undefined }}>
                        {s.count} {totalSub > 0 && <span style={{ color: "#999", fontWeight: 400 }}>({Math.round((s.count / totalSub) * 100)}%)</span>}
                      </Text>
                    </div>
                    <Progress
                      percent={totalSub > 0 ? Math.round((s.count / totalSub) * 100) : 0}
                      strokeColor={s.color}
                      showInfo={false}
                      size="small"
                    />
                  </div>
                ))}
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title={<><BarChartOutlined /> Waste Disposal by Type</>} style={{ borderRadius: 10 }} loading={loading}>
              {(stats?.wasteByType || []).length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {stats.wasteByType.map((w) => (
                    <div key={w._id || "unknown"}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <Text style={{ color: isDark ? "#ccc" : undefined }}>{w._id || "Unknown"}</Text>
                        <Text strong style={{ color: isDark ? "#fff" : undefined }}>
                          {w.totalVolume.toLocaleString()} tons ({w.count} trips)
                        </Text>
                      </div>
                      <Progress
                        percent={100}
                        strokeColor={w._id === "Residual" ? "#1890ff" : "#ff7a45"}
                        showInfo={false}
                        size="small"
                      />
                    </div>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Company breakdown: LGU ({stats?.byCompanyType?.LGU || 0}) · Private ({stats?.byCompanyType?.Private || 0})
                    </Text>
                  </div>
                </div>
              ) : (
                <Text type="secondary">No waste data yet.</Text>
              )}
            </Card>
          </Col>
        </Row>
      </>
    ),
  });

  // Trends tab — show only if monthly data exists
  if (months.length > 0) {
    tabItems.push({
      key: "trends",
      label: <><BarChartOutlined /> Trends</>,
      children: (
        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card title={<><BarChartOutlined /> Monthly Submissions</>} style={{ borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 220, padding: "0 4px" }}>
                {months.map((m, i) => (
                  <div
                    key={i}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
                  >
                    <Text style={{ fontSize: 11, color: isDark ? "#ccc" : "#666", marginBottom: 4 }}>
                      {m.count}
                    </Text>
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 48,
                        height: `${Math.max((m.count / maxCount) * 180, 8)}px`,
                        background: "linear-gradient(180deg, #1a3353 0%, #4fc3f7 100%)",
                        borderRadius: "4px 4px 0 0",
                        transition: "height 0.5s ease",
                      }}
                    />
                    <Text style={{ fontSize: 10, color: isDark ? "#aaa" : "#999", marginTop: 4 }}>
                      {m.label}
                    </Text>
                  </div>
                ))}
              </div>
            </Card>
          </Col>
          {months.some((m) => m.volume > 0) && (
            <Col xs={24}>
              <Card title={<><RiseOutlined /> Monthly Volume (tons)</>} style={{ borderRadius: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 220, padding: "0 4px" }}>
                  {months.map((m, i) => {
                    const maxVol = Math.max(...months.map((x) => x.volume), 1);
                    return (
                      <div
                        key={i}
                        style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
                      >
                        <Text style={{ fontSize: 11, color: isDark ? "#ccc" : "#666", marginBottom: 4 }}>
                          {m.volume?.toLocaleString()}
                        </Text>
                        <div
                          style={{
                            width: "100%",
                            maxWidth: 48,
                            height: `${Math.max((m.volume / maxVol) * 180, 8)}px`,
                            background: "linear-gradient(180deg, #389e0d 0%, #95de64 100%)",
                            borderRadius: "4px 4px 0 0",
                            transition: "height 0.5s ease",
                          }}
                        />
                        <Text style={{ fontSize: 10, color: isDark ? "#aaa" : "#999", marginTop: 4 }}>
                          {m.label}
                        </Text>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Col>
          )}
        </Row>
      ),
    });
  }

  // Recent Activity tab — show only if submissions exist
  if ((stats?.recentSubmissions || []).length > 0) {
    tabItems.push({
      key: "activity",
      label: <><FileTextOutlined /> Recent Activity</>,
      children: (
        <Card title={<><FileTextOutlined /> Recent Submissions</>} style={{ borderRadius: 10 }}>
          <Table
            dataSource={stats.recentSubmissions}
            columns={recentColumns}
            rowKey="_id"
            size="small"
            pagination={false}
            scroll={{ x: 600 }}
          />
        </Card>
      ),
    });
  }

  // 10-Year SWM Plan tab
  if (swmStats && swmStats.totalRecords > 0) {
    const provList = swmStats.byProvinceList || [];
    const maxProvCount = Math.max(...provList.map((p) => p.count), 1);
    const divProv = swmStats.diversionByProvince || [];
    const wc = swmStats.wasteComposition || {};

    const CARD_H = 280;

    tabItems.push({
      key: "swm-plan",
      label: <><FundProjectionScreenOutlined /> 10-Year SWM Plan</>,
      children: (
        <>
        {/* Row 1: Full-width stat tiles */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Total LGUs" value={swmStats.totalRecords} prefix={<EnvironmentOutlined style={{ color: "#1a3353" }} />} />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Compliant" value={swmStats.byCompliance?.Compliant || 0} prefix={<SafetyCertificateOutlined style={{ color: "#52c41a" }} />} />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Non-Compliant" value={swmStats.byCompliance?.["Non-Compliant"] || 0} styles={{ content: { color: "#ff4d4f" } }} prefix={<ClockCircleOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Avg. Diversion" value={((wc.avgDiversionRate || 0) * 100).toFixed(1)} suffix="%" prefix={<RiseOutlined style={{ color: "#1890ff" }} />} />
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
                <Card title={<><PieChartOutlined /> Compliance Status</>} style={{ borderRadius: 10, height: CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {[
                      { label: "Compliant", count: swmStats.byCompliance?.Compliant || 0, color: "#52c41a" },
                      { label: "Non-Compliant", count: swmStats.byCompliance?.["Non-Compliant"] || 0, color: "#ff4d4f" },
                      { label: "Pending", count: swmStats.byCompliance?.Pending || 0, color: "#faad14" },
                    ].map((s) => (
                      <div key={s.label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text style={{ color: isDark ? "#ccc" : undefined }}>{s.label}</Text>
                          <Text strong style={{ color: isDark ? "#fff" : undefined }}>
                            {s.count} {swmStats.totalRecords > 0 && <span style={{ color: "#999", fontWeight: 400 }}>({Math.round((s.count / swmStats.totalRecords) * 100)}%)</span>}
                          </Text>
                        </div>
                        <Progress percent={swmStats.totalRecords > 0 ? Math.round((s.count / swmStats.totalRecords) * 100) : 0} strokeColor={s.color} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Waste Composition */}
              <Col xs={24} sm={12}>
                <Card title={<><BarChartOutlined /> Waste Composition</>} style={{ borderRadius: 10, height: CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {[
                      { label: "Biodegradable", pct: (wc.avgBiodegradable || 0) * 100, color: "#52c41a" },
                      { label: "Recyclable", pct: (wc.avgRecyclable || 0) * 100, color: "#1890ff" },
                      { label: "Residual", pct: (wc.avgResidual || 0) * 100, color: "#ff4d4f" },
                      { label: "Special", pct: (wc.avgSpecial || 0) * 100, color: "#722ed1" },
                    ].map((w) => (
                      <div key={w.label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text style={{ color: isDark ? "#ccc" : undefined }}>{w.label}</Text>
                          <Text strong style={{ color: isDark ? "#fff" : undefined }}>{w.pct.toFixed(1)}%</Text>
                        </div>
                        <Progress percent={Math.round(w.pct)} strokeColor={w.color} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* LGUs per Province */}
              <Col xs={24} sm={12}>
                <Card title={<><BarChartOutlined /> LGUs per Province</>} style={{ borderRadius: 10, height: CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 170, padding: "0 2px" }}>
                    {provList.map((p, i) => (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Text style={{ fontSize: 10, color: isDark ? "#ccc" : "#666", marginBottom: 2 }}>{p.count}</Text>
                        <div style={{ width: "100%", maxWidth: 32, height: `${Math.max((p.count / maxProvCount) * 140, 6)}px`, background: "linear-gradient(180deg, #1a3353 0%, #4fc3f7 100%)", borderRadius: "3px 3px 0 0", transition: "height 0.5s ease" }} />
                        <Text style={{ fontSize: 8, color: isDark ? "#aaa" : "#999", marginTop: 2, textAlign: "center" }}>{p._id}</Text>
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Diversion Rate by Province */}
              <Col xs={24} sm={12}>
                <Card title={<><RiseOutlined /> Diversion by Province</>} style={{ borderRadius: 10, height: CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {divProv.slice(0, 7).map((d) => (
                      <div key={d._id}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <Text style={{ color: isDark ? "#ccc" : undefined, fontSize: 12 }}>{d._id}</Text>
                          <Text strong style={{ color: isDark ? "#fff" : undefined, fontSize: 12 }}>
                            {(d.avgDiversion * 100).toFixed(1)}% <span style={{ color: "#999", fontWeight: 400, fontSize: 10 }}>({d.count})</span>
                          </Text>
                        </div>
                        <Progress percent={Math.round(d.avgDiversion * 100)} strokeColor={d.avgDiversion * 100 >= 50 ? "#52c41a" : "#faad14"} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Renewal Status */}
              <Col xs={24} sm={12}>
                <Card title="Renewal Status" style={{ borderRadius: 10, height: CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.entries(swmStats.renewalStatus || {}).map(([key, count]) => (
                      <div key={key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text style={{ color: isDark ? "#ccc" : undefined }}>{key}</Text>
                          <Text strong style={{ color: isDark ? "#fff" : undefined }}>{count}</Text>
                        </div>
                        <Progress percent={swmStats.totalRecords > 0 ? Math.round((count / swmStats.totalRecords) * 100) : 0} strokeColor={key === "Approved" ? "#52c41a" : key === "For Renewal" ? "#faad14" : "#1890ff"} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Manila Bay Area */}
              <Col xs={24} sm={12}>
                <Card title="Manila Bay Area" style={{ borderRadius: 10, height: CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.entries(swmStats.byManilaBayArea || {}).map(([key, count]) => (
                      <div key={key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text style={{ color: isDark ? "#ccc" : undefined }}>{key || "Unspecified"}</Text>
                          <Text strong style={{ color: isDark ? "#fff" : undefined }}>{count}</Text>
                        </div>
                        <Progress percent={swmStats.totalRecords > 0 ? Math.round((count / swmStats.totalRecords) * 100) : 0} strokeColor={key === "MBA" ? "#1890ff" : "#8c8c8c"} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>
            </Row>
          </Col>

          {/* RIGHT COLUMN — Map (sticky) */}
          <Col xs={24} lg={10}>
            <div style={{ position: "sticky", top: 80, height: "calc(100vh - 200px)", minHeight: 520 }}>
              <Card
                size="small"
                title={<><GlobalOutlined /> LGU Location Map <Tag bordered={false} color="blue">{filteredMapPts.length} plotted</Tag>{filteredMapPts.length !== mapPts.length && <Tag bordered={false} color="default">of {mapPts.length}</Tag>}</>}
                style={{ borderRadius: 10, height: "100%" }}
                loading={loading}
                extra={
                  <Space size={4}>
                    <Tooltip title="Street"><Button size="small" type={tileKey === "street" ? "primary" : "default"} icon={<GlobalOutlined />} onClick={() => setTileKey("street")} /></Tooltip>
                    <Tooltip title="Satellite"><Button size="small" type={tileKey === "satellite" ? "primary" : "default"} icon={<EnvironmentOutlined />} onClick={() => setTileKey("satellite")} /></Tooltip>
                    <Tooltip title="Terrain"><Button size="small" type={tileKey === "terrain" ? "primary" : "default"} icon={<FundOutlined />} onClick={() => setTileKey("terrain")} /></Tooltip>
                    <Tooltip title="Dark"><Button size="small" type={tileKey === "dark" ? "primary" : "default"} icon={<AppstoreOutlined />} onClick={() => setTileKey("dark")} /></Tooltip>
                  </Space>
                }
                styles={{ body: { padding: 0, height: "calc(100% - 100px)" } }}
              >
                {/* Filter bar */}
                <div style={{ display: "flex", gap: 6, padding: "8px 10px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" }}>
                  <Select size="small" allowClear placeholder="Province" value={mapFilterProvince} onChange={setMapFilterProvince} options={provinceOptions} style={{ minWidth: 120, flex: 1 }} />
                  <Select size="small" allowClear placeholder="Plan Status" value={mapFilterStatus} onChange={setMapFilterStatus} options={[{ label: "✓ Approved", value: "Approved" }, { label: "▲ For Renewal", value: "For Renewal" }, { label: "● Other", value: "Other" }]} style={{ minWidth: 110, flex: 1 }} />
                  {(mapFilterProvince || mapFilterStatus) && <Button size="small" type="link" danger onClick={() => { setMapFilterProvince(null); setMapFilterStatus(null); }}>Clear</Button>}
                  {/* Legend */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", fontSize: 11, color: "#999" }}>
                    <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#52c41a", marginRight: 3, verticalAlign: "middle" }} />Approved</span>
                    <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#faad14", marginRight: 3, verticalAlign: "middle" }} />For Renewal</span>
                    <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#8c8c8c", marginRight: 3, verticalAlign: "middle" }} />Other</span>
                  </div>
                </div>
                {filteredMapPts.length > 0 ? (
                  <MapContainer
                    center={[15.0, 120.7]}
                    zoom={8}
                    style={{ height: "100%", width: "100%", borderRadius: "0 0 10px 10px" }}
                    scrollWheelZoom={true}
                    zoomControl={false}
                  >
                    <TileLayer key={tileKey} attribution={tile.attr} url={tile.url} />
                    <FitBounds points={filteredMapPts} />
                    <ProvinceBoundary key={mapFilterProvince || "__none__"} province={mapFilterProvince} />
                    {filteredMapPts.map((pt, idx) => (
                      <Marker
                        key={pt.record._id || idx}
                        position={[pt.lat, pt.lng]}
                        icon={planStatusIcon(pt.record.forRenewal)}
                      >
                        <Popup maxWidth={320} minWidth={260}>
                          <div className="popup-light" style={{ fontSize: 12, lineHeight: 1.7, padding: 2 }}>
                            {/* Header */}
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{pt.record.municipality}</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#e6f7ff", color: "#1890ff", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}><EnvironmentOutlined /> {pt.record.province}</span>
                              {pt.record.congressionalDistrict && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#f0f0f0", color: "#595959", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>{pt.record.congressionalDistrict}</span>}
                              {pt.record.manilaBayArea && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: pt.record.manilaBayArea === "MBA" ? "#e6f7ff" : "#f5f5f5", color: pt.record.manilaBayArea === "MBA" ? "#1890ff" : "#8c8c8c", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}><GlobalOutlined /> {pt.record.manilaBayArea}</span>}
                            </div>
                            <hr style={{ margin: "4px 0 6px", border: "none", borderTop: "1px solid #f0f0f0" }} />

                            {/* Compliance & Renewal */}
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                              {(() => { const r = pt.record.remarksAndRecommendation || ""; const isC = /compliant/i.test(r) && !/non/i.test(r); const isNC = /non/i.test(r) && /compliant/i.test(r); return <span className={`status-badge ${isC ? "status-badge-compliant" : isNC ? "status-badge-noncompliant" : "status-badge-pending"}`}><SafetyCertificateOutlined /> {isC ? "Compliant" : isNC ? "Non-Compliant" : "Pending"}</span>; })()}
                              {pt.record.forRenewal && <span className={`status-badge ${/approved/i.test(pt.record.forRenewal) ? "status-badge-approved" : /renewal/i.test(pt.record.forRenewal) ? "status-badge-renewal" : "status-badge-other"}`}><AuditOutlined /> {pt.record.forRenewal}</span>}
                            </div>

                            {/* Plan Info */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
                              {pt.record.typeOfSWMPlan && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><FileDoneOutlined style={{ color: "#1890ff" }} /> <span style={{ color: "#595959" }}>Plan:</span> <strong>{pt.record.typeOfSWMPlan}</strong></div>}
                              {pt.record.periodCovered && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><ClockCircleOutlined style={{ color: "#722ed1" }} /> <span style={{ color: "#595959" }}>Period:</span> {pt.record.periodCovered}</div>}
                              {pt.record.yearApproved && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><AuditOutlined style={{ color: "#52c41a" }} /> <span style={{ color: "#595959" }}>Approved:</span> {pt.record.yearApproved}</div>}
                            </div>

                            {/* Environmental Data */}
                            <div style={{ background: "#fafafa", borderRadius: 6, padding: "6px 8px", marginBottom: 6 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ color: "#595959" }}><BarChartOutlined style={{ color: "#1890ff" }} /> Diversion Rate</span>
                                <strong style={{ color: pt.record.wasteDiversionRate >= 0.25 ? "#52c41a" : "#ff4d4f" }}>{pt.record.wasteDiversionRate ? `${(pt.record.wasteDiversionRate * 100).toFixed(1)}%` : "—"}</strong>
                              </div>
                              {pt.record.totalWasteGeneration != null && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ color: "#595959" }}><DeleteOutlined style={{ color: "#ff4d4f" }} /> Waste Gen.</span>
                                <strong>{pt.record.totalWasteGeneration.toLocaleString()} tons</strong>
                              </div>}
                              {pt.record.pcg != null && <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#595959" }}><ExperimentOutlined style={{ color: "#722ed1" }} /> PCG</span>
                                <strong>{pt.record.pcg}</strong>
                              </div>}
                            </div>

                            {/* Waste Composition mini bars */}
                            {(pt.record.biodegradablePercent || pt.record.recyclablePercent || pt.record.residualPercent || pt.record.specialPercent) && (
                              <div style={{ marginBottom: 6 }}>
                                <div style={{ fontSize: 11, color: "#595959", marginBottom: 2, fontWeight: 600 }}>Waste Composition</div>
                                <div style={{ display: "flex", gap: 2, height: 8, borderRadius: 4, overflow: "hidden" }}>
                                  {pt.record.biodegradablePercent > 0 && <div title={`Biodegradable ${(pt.record.biodegradablePercent * 100).toFixed(1)}%`} style={{ flex: pt.record.biodegradablePercent, background: "#52c41a" }} />}
                                  {pt.record.recyclablePercent > 0 && <div title={`Recyclable ${(pt.record.recyclablePercent * 100).toFixed(1)}%`} style={{ flex: pt.record.recyclablePercent, background: "#1890ff" }} />}
                                  {pt.record.residualPercent > 0 && <div title={`Residual ${(pt.record.residualPercent * 100).toFixed(1)}%`} style={{ flex: pt.record.residualPercent, background: "#ff4d4f" }} />}
                                  {pt.record.specialPercent > 0 && <div title={`Special ${(pt.record.specialPercent * 100).toFixed(1)}%`} style={{ flex: pt.record.specialPercent, background: "#722ed1" }} />}
                                </div>
                                <div style={{ display: "flex", gap: 8, fontSize: 10, color: "#999", marginTop: 2, flexWrap: "wrap" }}>
                                  <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "#52c41a", marginRight: 2 }} />Bio {(pt.record.biodegradablePercent * 100).toFixed(0)}%</span>
                                  <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "#1890ff", marginRight: 2 }} />Rec {(pt.record.recyclablePercent * 100).toFixed(0)}%</span>
                                  <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "#ff4d4f", marginRight: 2 }} />Res {(pt.record.residualPercent * 100).toFixed(0)}%</span>
                                  <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: "#722ed1", marginRight: 2 }} />Spc {(pt.record.specialPercent * 100).toFixed(0)}%</span>
                                </div>
                              </div>
                            )}

                            {/* Disposal */}
                            {pt.record.lguFinalDisposal && <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}><ContainerOutlined style={{ color: "#fa8c16" }} /> <span style={{ color: "#595959" }}>Disposal:</span> {pt.record.lguFinalDisposal}</div>}

                            {/* Personnel */}
                            <hr style={{ margin: "4px 0 5px", border: "none", borderTop: "1px solid #f0f0f0" }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {pt.record.focalPerson && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><UserOutlined style={{ color: "#1890ff" }} /> <span style={{ color: "#595959" }}>Focal:</span> <strong>{pt.record.focalPerson}</strong></div>}
                              {pt.record.enmoAssigned && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><TeamOutlined style={{ color: "#52c41a" }} /> <span style={{ color: "#595959" }}>ENMO:</span> {pt.record.enmoAssigned}</div>}
                            </div>

                            {/* Remarks */}
                            {pt.record.remarksAndRecommendation && (
                              <div style={{ marginTop: 6, background: "#fffbe6", borderRadius: 4, padding: "4px 6px", fontSize: 11, color: "#ad8b00" }}>
                                <AlertOutlined /> {pt.record.remarksAndRecommendation}
                              </div>
                            )}

                            {/* Signed Document */}
                            {pt.record.signedDocument && (
                              <a href={pt.record.signedDocument} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, padding: "4px 8px", background: "#e6f7ff", borderRadius: 4, fontSize: 11, color: "#1890ff", textDecoration: "none", fontWeight: 600 }}>
                                <LinkOutlined /> View Signed Document
                              </a>
                            )}

                            {/* Quick Actions */}
                            <div style={{ display: "flex", gap: 4, marginTop: 8, paddingTop: 6, borderTop: "1px solid #f0f0f0" }}>
                              <button onClick={() => { api.get(`/ten-year-swm/${pt.record._id}`).then(({ data }) => setMapViewRecord(data)).catch(() => setMapViewRecord(pt.record)); }} className="popup-action-btn" title="View Full Record"><EyeOutlined /> View</button>
                              <button onClick={() => { const txt = `${pt.record.municipality}, ${pt.record.province} (${pt.lat}, ${pt.lng})`; navigator.clipboard.writeText(txt); }} className="popup-action-btn" title="Copy Location"><CopyOutlined /> Copy</button>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                ) : (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
    const opRate = mrfStats.totalRecords > 0 ? (opCount / mrfStats.totalRecords) * 100 : 0;
    const avgDiv = (fs.avgDiversionRate || 0) * 100;

    const MRF_CARD_H = 280;

    tabItems.push({
      key: "funded-mrf",
      label: <><BankOutlined /> Funded MRF</>,
      children: (
        <>
        {/* Row 1: Stat tiles */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Total MRFs" value={mrfStats.totalRecords} prefix={<BankOutlined style={{ color: "#1a3353" }} />} />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Operational" value={opCount} prefix={<CheckCircleOutlined style={{ color: "#52c41a" }} />} />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Non-Operational" value={nonOpCount} styles={{ content: { color: "#ff4d4f" } }} prefix={<CloseCircleOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable style={{ borderRadius: 10, height: 110 }} loading={loading}>
              <Statistic title="Total Funding" value={fs.totalFunding || 0} prefix={<span style={{ color: "#faad14", fontWeight: 700, fontSize: 18 }}>₱</span>} formatter={(v) => Number(v).toLocaleString()} />
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
                <Card title={<><PieChartOutlined /> Operational Status</>} style={{ borderRadius: 10, height: MRF_CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: MRF_CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {[
                      { label: "Operational", count: opCount, color: "#52c41a", icon: <CheckCircleOutlined /> },
                      { label: "Non-Operational", count: nonOpCount, color: "#ff4d4f", icon: <CloseCircleOutlined /> },
                      { label: "Unknown", count: mrfStats.byStatus?.Unknown || 0, color: "#d9d9d9", icon: <ClockCircleOutlined /> },
                    ].map((s) => (
                      <div key={s.label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text>{s.label}</Text>
                          <Text strong>{s.count} <span style={{ color: "#999", fontWeight: 400 }}>({mrfStats.totalRecords > 0 ? Math.round((s.count / mrfStats.totalRecords) * 100) : 0}%)</span></Text>
                        </div>
                        <Progress percent={mrfStats.totalRecords > 0 ? Math.round((s.count / mrfStats.totalRecords) * 100) : 0} strokeColor={s.color} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Key Metrics — Enhanced */}
              <Col xs={24} sm={12}>
                <Card title={<><BarChartOutlined /> Key Metrics</>} style={{ borderRadius: 10, height: MRF_CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: MRF_CARD_H - 57, padding: "12px 16px" } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Operational Rate with circular progress */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 10px", background: "linear-gradient(135deg, #f6ffed 0%, #fcffe6 100%)", borderRadius: 8, border: "1px solid #d9f7be" }}>
                      <Progress type="circle" percent={Math.round(opRate)} size={48} strokeColor={{ "0%": "#52c41a", "100%": "#95de64" }} format={(p) => <span style={{ fontSize: 12, fontWeight: 700 }}>{p}%</span>} />
                      <div><Text type="secondary" style={{ fontSize: 11 }}>Operational Rate</Text><br /><Text strong style={{ fontSize: 16, color: "#389e0d" }}>{opRate.toFixed(1)}%</Text></div>
                    </div>
                    {/* Avg Diversion Rate with circular progress */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 10px", background: "linear-gradient(135deg, #e6f7ff 0%, #f0f5ff 100%)", borderRadius: 8, border: "1px solid #bae7ff" }}>
                      <Progress type="circle" percent={Math.round(avgDiv)} size={48} strokeColor={{ "0%": "#1890ff", "100%": "#69c0ff" }} format={(p) => <span style={{ fontSize: 12, fontWeight: 700 }}>{p}%</span>} />
                      <div><Text type="secondary" style={{ fontSize: 11 }}>Avg. Diversion Rate</Text><br /><Text strong style={{ fontSize: 16, color: "#096dd9" }}>{avgDiv.toFixed(1)}%</Text></div>
                    </div>
                    {/* Bottom stats row */}
                    <Row gutter={8}>
                      <Col span={8}>
                        <div style={{ textAlign: "center", padding: "6px 4px", background: "#f9f0ff", borderRadius: 6, border: "1px solid #efdbff" }}>
                          <Text type="secondary" style={{ fontSize: 10, display: "block" }}>Brgys Served</Text>
                          <Text strong style={{ fontSize: 16, color: "#722ed1" }}>{(fs.totalBrgyServed || 0).toLocaleString()}</Text>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{ textAlign: "center", padding: "6px 4px", background: "#fff7e6", borderRadius: 6, border: "1px solid #ffe7ba" }}>
                          <Text type="secondary" style={{ fontSize: 10, display: "block" }}>Avg. Funding</Text>
                          <Text strong style={{ fontSize: 16, color: "#d48806" }}>₱{Math.round(fs.avgFunding || 0).toLocaleString()}</Text>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{ textAlign: "center", padding: "6px 4px", background: "#fff1f0", borderRadius: 6, border: "1px solid #ffccc7" }}>
                          <Text type="secondary" style={{ fontSize: 10, display: "block" }}>Waste Gen.</Text>
                          <Text strong style={{ fontSize: 16, color: "#cf1322" }}>{(fs.totalWasteGen || 0).toLocaleString()}</Text>
                        </div>
                      </Col>
                    </Row>
                  </div>
                </Card>
              </Col>

              {/* MRFs per Province */}
              <Col xs={24} sm={12}>
                <Card title={<><BarChartOutlined /> MRFs per Province</>} style={{ borderRadius: 10, height: MRF_CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: MRF_CARD_H - 57 } }}>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 170, padding: "0 2px" }}>
                    {mrfProvList.map((p, i) => (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Text style={{ fontSize: 10, color: "#666", marginBottom: 2 }}>{p.count}</Text>
                        <div style={{ width: "100%", maxWidth: 32, height: `${Math.max((p.count / mrfMaxProvCount) * 140, 6)}px`, background: "linear-gradient(180deg, #2f54eb 0%, #85a5ff 100%)", borderRadius: "3px 3px 0 0", transition: "height 0.5s ease" }} />
                        <Text style={{ fontSize: 8, color: "#999", marginTop: 2, textAlign: "center" }}>{p._id}</Text>
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Diversion Rate by Province */}
              <Col xs={24} sm={12}>
                <Card title={<><RiseOutlined /> Diversion by Province</>} style={{ borderRadius: 10, height: MRF_CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: MRF_CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {mrfDivProv.slice(0, 7).map((d) => (
                      <div key={d._id}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <Text style={{ fontSize: 12 }}>{d._id}</Text>
                          <Text strong style={{ fontSize: 12 }}>{(d.avgDiversion * 100).toFixed(1)}% <span style={{ color: "#999", fontWeight: 400, fontSize: 10 }}>({d.count})</span></Text>
                        </div>
                        <Progress percent={Math.round(d.avgDiversion * 100)} strokeColor={d.avgDiversion * 100 >= 50 ? "#52c41a" : "#faad14"} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* MRF Type Distribution */}
              <Col xs={24} sm={12}>
                <Card title={<><BankOutlined /> MRF Type</>} style={{ borderRadius: 10, height: MRF_CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: MRF_CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.entries(mrfStats.byMRFType || {}).map(([key, count]) => (
                      <div key={key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text>{key || "Unspecified"}</Text>
                          <Text strong>{count}</Text>
                        </div>
                        <Progress percent={mrfStats.totalRecords > 0 ? Math.round((count / mrfStats.totalRecords) * 100) : 0} strokeColor="#2f54eb" showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>

              {/* Manila Bay Area */}
              <Col xs={24} sm={12}>
                <Card title="Manila Bay Area" style={{ borderRadius: 10, height: MRF_CARD_H }} loading={loading} styles={{ body: { overflow: "auto", height: MRF_CARD_H - 57 } }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {Object.entries(mrfStats.byManilaBayArea || {}).map(([key, count]) => (
                      <div key={key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text>{key || "Unspecified"}</Text>
                          <Text strong>{count}</Text>
                        </div>
                        <Progress percent={mrfStats.totalRecords > 0 ? Math.round((count / mrfStats.totalRecords) * 100) : 0} strokeColor={key === "MBA" ? "#1890ff" : "#8c8c8c"} showInfo={false} size="small" />
                      </div>
                    ))}
                  </div>
                </Card>
              </Col>
            </Row>
          </Col>

          {/* RIGHT COLUMN — MRF Map (sticky) */}
          <Col xs={24} lg={10}>
            <div style={{ position: "sticky", top: 80, height: "calc(100vh - 200px)", minHeight: 520 }}>
              <Card
                size="small"
                title={<><GlobalOutlined /> MRF Location Map <Tag bordered={false} color="blue">{filteredMrfMapPts.length} plotted</Tag>{filteredMrfMapPts.length !== mrfMapPts.length && <Tag bordered={false} color="default">of {mrfMapPts.length}</Tag>}</>}
                style={{ borderRadius: 10, height: "100%" }}
                loading={loading}
                extra={
                  <Space size={4}>
                    <Tooltip title="Street"><Button size="small" type={mrfTileKey === "street" ? "primary" : "default"} icon={<GlobalOutlined />} onClick={() => setMrfTileKey("street")} /></Tooltip>
                    <Tooltip title="Satellite"><Button size="small" type={mrfTileKey === "satellite" ? "primary" : "default"} icon={<EnvironmentOutlined />} onClick={() => setMrfTileKey("satellite")} /></Tooltip>
                    <Tooltip title="Terrain"><Button size="small" type={mrfTileKey === "terrain" ? "primary" : "default"} icon={<FundOutlined />} onClick={() => setMrfTileKey("terrain")} /></Tooltip>
                    <Tooltip title="Dark"><Button size="small" type={mrfTileKey === "dark" ? "primary" : "default"} icon={<AppstoreOutlined />} onClick={() => setMrfTileKey("dark")} /></Tooltip>
                  </Space>
                }
                styles={{ body: { padding: 0, height: "calc(100% - 100px)" } }}
              >
                {/* Filter bar */}
                <div style={{ display: "flex", gap: 6, padding: "8px 10px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" }}>
                  <Select size="small" allowClear placeholder="Province" value={mrfFilterProvince} onChange={setMrfFilterProvince} options={mrfProvinceOptions} style={{ minWidth: 120, flex: 1 }} />
                  <Select size="small" allowClear placeholder="Status" value={mrfFilterStatus} onChange={setMrfFilterStatus} options={[{ label: "✓ Operational", value: "Operational" }, { label: "✕ Non-Operational", value: "Non-Operational" }]} style={{ minWidth: 130, flex: 1 }} />
                  {(mrfFilterProvince || mrfFilterStatus) && <Button size="small" type="link" danger onClick={() => { setMrfFilterProvince(null); setMrfFilterStatus(null); }}>Clear</Button>}
                  {/* Legend */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", fontSize: 11, color: "#999" }}>
                    <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#52c41a", marginRight: 3, verticalAlign: "middle" }} />Operational</span>
                    <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#ff4d4f", marginRight: 3, verticalAlign: "middle" }} />Non-Op</span>
                    <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#8c8c8c", marginRight: 3, verticalAlign: "middle" }} />Unknown</span>
                  </div>
                </div>
                {filteredMrfMapPts.length > 0 ? (
                  <MapContainer
                    center={[15.0, 120.7]}
                    zoom={8}
                    style={{ height: "100%", width: "100%", borderRadius: "0 0 10px 10px" }}
                    scrollWheelZoom={true}
                    zoomControl={false}
                  >
                    <TileLayer key={mrfTileKey} attribution={mrfTile.attr} url={mrfTile.url} />
                    <FitBounds points={filteredMrfMapPts} />
                    <ProvinceBoundary key={mrfFilterProvince || "__mrf_none__"} province={mrfFilterProvince} />
                    {filteredMrfMapPts.map((pt, idx) => (
                      <Marker
                        key={pt.record._id || idx}
                        position={[pt.lat, pt.lng]}
                        icon={mrfStatusIcon(pt.record.statusOfMRF)}
                      >
                        <Popup maxWidth={300} minWidth={240}>
                          <div className="popup-light" style={{ fontSize: 12, lineHeight: 1.7, padding: 2 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{pt.record.municipality}</div>
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#e6f7ff", color: "#1890ff", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}><EnvironmentOutlined /> {pt.record.province}</span>
                              {pt.record.barangay && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#f0f0f0", color: "#595959", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}>{pt.record.barangay}</span>}
                              {pt.record.manilaBayArea && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: pt.record.manilaBayArea === "MBA" ? "#e6f7ff" : "#f5f5f5", color: pt.record.manilaBayArea === "MBA" ? "#1890ff" : "#8c8c8c", borderRadius: 4, padding: "1px 6px", fontSize: 11 }}><GlobalOutlined /> {pt.record.manilaBayArea}</span>}
                            </div>
                            <hr style={{ margin: "4px 0 6px", border: "none", borderTop: "1px solid #f0f0f0" }} />
                            {pt.record.typeOfMRF && <div style={{ marginBottom: 4 }}><BankOutlined style={{ color: "#2f54eb" }} /> <span style={{ color: "#595959" }}>Type:</span> <strong>{pt.record.typeOfMRF}</strong></div>}
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                              {(() => { const s = pt.record.statusOfMRF; const isOp = /operational/i.test(s) && !/non/i.test(s); const isNon = /non/i.test(s); return <span className={`status-badge ${isOp ? "status-badge-compliant" : isNon ? "status-badge-noncompliant" : "status-badge-pending"}`}><SafetyCertificateOutlined /> {isOp ? "Operational" : isNon ? "Non-Operational" : "Unknown"}</span>; })()}
                            </div>
                            <div style={{ background: "#fafafa", borderRadius: 6, padding: "6px 8px", marginBottom: 6 }}>
                              {pt.record.amountGranted != null && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ color: "#595959" }}><span style={{ color: "#faad14", fontWeight: 700 }}>₱</span> Funding</span>
                                <strong>₱{pt.record.amountGranted.toLocaleString()}</strong>
                              </div>}
                              {pt.record.yearGranted && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                                <span style={{ color: "#595959" }}><CalendarOutlined style={{ color: "#722ed1" }} /> Year</span>
                                <strong>{pt.record.yearGranted}</strong>
                              </div>}
                              <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#595959" }}><BarChartOutlined style={{ color: "#1890ff" }} /> Diversion</span>
                                <strong style={{ color: pt.record.wasteDiversionRate >= 0.25 ? "#52c41a" : "#ff4d4f" }}>{pt.record.wasteDiversionRate ? `${(pt.record.wasteDiversionRate * 100).toFixed(1)}%` : "—"}</strong>
                              </div>
                            </div>
                            {pt.record.focalPerson && <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}><UserOutlined style={{ color: "#1890ff" }} /> <span style={{ color: "#595959" }}>Focal:</span> <strong>{pt.record.focalPerson}</strong></div>}
                            {pt.record.enmoAssigned && <div style={{ display: "flex", alignItems: "center", gap: 5 }}><TeamOutlined style={{ color: "#52c41a" }} /> <span style={{ color: "#595959" }}>ENMO:</span> {pt.record.enmoAssigned}</div>}
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                ) : (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
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

  return (
    <>
      <Modal
        title={<Space><FileTextOutlined />{mapViewRecord?.municipality}, {mapViewRecord?.province}</Space>}
        open={!!mapViewRecord}
        onCancel={() => setMapViewRecord(null)}
        footer={<Button onClick={() => setMapViewRecord(null)}>Close</Button>}
        width={800}
      >
        {mapViewRecord && (
          <Tabs items={[
            { key: "general", label: <><EnvironmentOutlined /> General Info</>, children: (
              <>
                <Row gutter={[16, 12]}>
                  <Col span={12}><Text type="secondary"><EnvironmentOutlined /> Province:</Text> <Text strong>{mapViewRecord.province}</Text></Col>
                  <Col span={12}><Text type="secondary"><EnvironmentOutlined /> Municipality:</Text> <Text strong>{mapViewRecord.municipality}</Text></Col>
                  <Col span={12}><Text type="secondary">Manila Bay Area:</Text> {mapViewRecord.manilaBayArea === "MBA" ? <Tag color="blue" bordered={false}>MBA</Tag> : <Tag color="default" bordered={false}>{mapViewRecord.manilaBayArea || "\u2014"}</Tag>}</Col>
                  <Col span={12}><Text type="secondary">Congressional District:</Text> <Text>{mapViewRecord.congressionalDistrict || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Coordinates:</Text> <Text>{mapViewRecord.latitude}, {mapViewRecord.longitude}</Text></Col>
                </Row>
                <Divider plain orientation="left"><AuditOutlined /> Plan Details</Divider>
                <Row gutter={[16, 12]}>
                  <Col span={12}><Text type="secondary"><FileTextOutlined /> Plan Type:</Text> {mapViewRecord.typeOfSWMPlan ? <Tag color="geekblue" bordered={false}>{mapViewRecord.typeOfSWMPlan}</Tag> : "\u2014"}</Col>
                  <Col span={12}><Text type="secondary"><FileTextOutlined /> Resolution No.:</Text> <Text>{mapViewRecord.resolutionNo || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary"><ClockCircleOutlined /> Period Covered:</Text> <Tag bordered={false}>{mapViewRecord.periodCovered || "\u2014"}</Tag></Col>
                  <Col span={12}><Text type="secondary"><ClockCircleOutlined /> Year Approved:</Text> <Text>{mapViewRecord.yearApproved || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary"><ClockCircleOutlined /> End Period:</Text> <Text>{mapViewRecord.endPeriod || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Status:</Text> {/approved/i.test(mapViewRecord.forRenewal) ? <Tag color="green" bordered={false}>{mapViewRecord.forRenewal}</Tag> : /renewal/i.test(mapViewRecord.forRenewal) ? <Tag color="orange" bordered={false}>{mapViewRecord.forRenewal}</Tag> : <Tag bordered={false}>{mapViewRecord.forRenewal || "\u2014"}</Tag>}</Col>
                </Row>
                <Divider plain orientation="left"><TeamOutlined /> Personnel</Divider>
                <Row gutter={[16, 12]}>
                  <Col span={8}><Text type="secondary"><UserOutlined /> Focal Person:</Text><br /><Text strong>{mapViewRecord.focalPerson || "\u2014"}</Text></Col>
                  <Col span={8}><Text type="secondary"><UserOutlined /> ESWM Staff:</Text><br /><Text strong>{mapViewRecord.eswmStaff || "\u2014"}</Text></Col>
                  <Col span={8}><Text type="secondary"><TeamOutlined /> ENMO Assigned:</Text><br /><Text strong>{mapViewRecord.enmoAssigned || "\u2014"}</Text></Col>
                </Row>
                {mapViewRecord.signedDocument && (<>
                  <Divider plain orientation="left"><LinkOutlined /> Document</Divider>
                  <a href={mapViewRecord.signedDocument} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px", background: "#e6f7ff", borderRadius: 4, fontSize: 13, color: "#1890ff", textDecoration: "none", fontWeight: 600 }}><LinkOutlined /> View Signed Document</a>
                </>)}
              </>
            )},
            { key: "monitoring", label: <><ClockCircleOutlined /> Monitoring</>, children: (
              <Row gutter={[16, 12]}>
                <Col span={12}><Text type="secondary">Target Month:</Text> <Text>{mapViewRecord.targetMonth || "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">IIS Number:</Text> <Text>{mapViewRecord.iisNumber || "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Date of Monitoring:</Text> <Text>{mapViewRecord.dateOfMonitoring ? dayjs(mapViewRecord.dateOfMonitoring).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Report Prepared:</Text> <Text>{mapViewRecord.dateReportPrepared ? dayjs(mapViewRecord.dateReportPrepared).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Reviewed (Staff):</Text> <Text>{mapViewRecord.dateReportReviewedStaff ? dayjs(mapViewRecord.dateReportReviewedStaff).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Reviewed (Focal):</Text> <Text>{mapViewRecord.dateReportReviewedFocal ? dayjs(mapViewRecord.dateReportReviewedFocal).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Report Approved:</Text> <Text>{mapViewRecord.dateReportApproved ? dayjs(mapViewRecord.dateReportApproved).format("MMM D, YYYY") : "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Tracking:</Text> <Text>{mapViewRecord.trackingOfReports || "\u2014"}</Text></Col>
              </Row>
            )},
            { key: "compliance", label: <><SafetyCertificateOutlined /> Compliance</>, children: (
              <>
                <Row gutter={[16, 12]}>
                  <Col span={24}><Text type="secondary">Remarks & Recommendation:</Text><br /><Text>{mapViewRecord.remarksAndRecommendation || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Source Reduction:</Text> <Text>{mapViewRecord.sourceReduction || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Segregated Collection:</Text> <Text>{mapViewRecord.segregatedCollection || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Storage & Set-out:</Text> <Text>{mapViewRecord.storageAndSetout || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Processing/MRF:</Text> <Text>{mapViewRecord.processingMRF || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Transfer Station:</Text> <Text>{mapViewRecord.transferStation || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Disposal Facilities:</Text> <Text>{mapViewRecord.disposalFacilities || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">LGU Final Disposal:</Text> <Text>{mapViewRecord.lguFinalDisposal || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Advise Letter Date:</Text> <Text>{mapViewRecord.adviseLetterDateIssued || "\u2014"}</Text></Col>
                  <Col span={12}><Text type="secondary">Compliance to Advise:</Text> <Text>{mapViewRecord.complianceToAdvise || "\u2014"}</Text></Col>
                  <Col span={24}><Text type="secondary">Remarks:</Text> <Text>{mapViewRecord.remarks || "\u2014"}</Text></Col>
                </Row>
              </>
            )},
            { key: "waste", label: <><BarChartOutlined /> Waste Data</>, children: (
              <Row gutter={[16, 12]}>
                <Col span={12}><Text type="secondary">Total Waste Generation:</Text> <Text strong>{mapViewRecord.totalWasteGeneration != null ? `${mapViewRecord.totalWasteGeneration.toLocaleString()} tons` : "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">PCG:</Text> <Text strong>{mapViewRecord.pcg ?? "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Waste Diversion Rate:</Text> <Text strong>{mapViewRecord.wasteDiversionRate != null ? `${(mapViewRecord.wasteDiversionRate * 100).toFixed(1)}%` : "\u2014"}</Text></Col>
                <Col span={12}><Text type="secondary">Disposal Rate:</Text> <Text strong>{mapViewRecord.disposalRate != null ? `${(mapViewRecord.disposalRate * 100).toFixed(1)}%` : "\u2014"}</Text></Col>
                <Divider plain orientation="left">Composition</Divider>
                <Col span={12}><Text type="secondary" style={{ color: "#52c41a" }}>Biodegradable:</Text> <Text>{mapViewRecord.biodegradableWaste ?? "\u2014"} ({mapViewRecord.biodegradablePercent != null ? `${(mapViewRecord.biodegradablePercent * 100).toFixed(1)}%` : "\u2014"})</Text></Col>
                <Col span={12}><Text type="secondary" style={{ color: "#1890ff" }}>Recyclable:</Text> <Text>{mapViewRecord.recyclableWaste ?? "\u2014"} ({mapViewRecord.recyclablePercent != null ? `${(mapViewRecord.recyclablePercent * 100).toFixed(1)}%` : "\u2014"})</Text></Col>
                <Col span={12}><Text type="secondary" style={{ color: "#ff4d4f" }}>Residual:</Text> <Text>{mapViewRecord.residualWasteForDisposal ?? "\u2014"} ({mapViewRecord.residualPercent != null ? `${(mapViewRecord.residualPercent * 100).toFixed(1)}%` : "\u2014"})</Text></Col>
                <Col span={12}><Text type="secondary" style={{ color: "#722ed1" }}>Special:</Text> <Text>{mapViewRecord.specialWaste ?? "\u2014"} ({mapViewRecord.specialPercent != null ? `${(mapViewRecord.specialPercent * 100).toFixed(1)}%` : "\u2014"})</Text></Col>
              </Row>
            )},
          ]} />
        )}
      </Modal>

      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0, color: textColor }}>
          Dashboard
        </Title>
        <Text type="secondary">
          Welcome back, {user?.firstName}! Here&apos;s a real-time overview.
        </Text>
      </div>

      <Tabs
        defaultActiveKey="overview"
        items={tabItems}
        size="large"
        style={{ marginTop: 8 }}
      />
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
      boxShadow: isDark ? "0 1px 4px rgba(0,0,0,0.3)" : "0 1px 4px rgba(0,0,0,0.06)",
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
  if (c.length === 3) c = c.split("").map((ch) => ch + ch).join("");
  const num = parseInt(c, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
