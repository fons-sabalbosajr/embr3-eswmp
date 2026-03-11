import { useState, useEffect, useMemo, useCallback } from "react";
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
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import Swal from "sweetalert2";
import AccountSettings from "./admin/AccountSettings";
import FieldSettings from "./admin/FieldSettings";
import SubmissionSettings from "./admin/SubmissionSettings";
import DeveloperSettings from "./admin/DeveloperSettings";
import SLFMonitoring from "./admin/SLFMonitoring";
import Reports from "./admin/Reports";
import api from "../api";
import secureStorage from "../utils/secureStorage";
import embLogo from "../assets/emblogo.svg";
import dayjs from "dayjs";

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
        { key: "cs-10yr-plan", icon: <FundProjectionScreenOutlined />, label: "10 Year SWM Plan", disabled: true, style: comingSoonStyle },
        { key: "cs-funded-mrf", icon: <BankOutlined />, label: "Funded MRF", disabled: true, style: comingSoonStyle },
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
        "cs-10yr-plan": "10 Year SWM Plan",
        "cs-funded-mrf": "Funded MRF",
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
          width={260}
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
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await api.get("/data-slf/stats");
      setStats(data);
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

  return (
    <>
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
