import { useState, useEffect } from "react";
import {
  Card,
  Typography,
  Form,
  Input,
  Select,
  Switch,
  InputNumber,
  Button,
  Divider,
  Row,
  Col,
  Spin,
  Tag,
  Descriptions,
  Space,
  Table,
  Badge,
  Popconfirm,
  Tabs,
  Tooltip,
  Empty,
} from "antd";
import {
  SettingOutlined,
  MailOutlined,
  LockOutlined,
  ToolOutlined,
  GlobalOutlined,
  BgColorsOutlined,
  SaveOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  ReloadOutlined,
  DeleteOutlined,
  TeamOutlined,
  UndoOutlined,
  ExclamationCircleOutlined,
  NotificationOutlined,
  DashboardOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ApartmentOutlined,

  FundProjectionScreenOutlined,
  BankOutlined,
  CarOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  BarChartOutlined,
  EnvironmentOutlined,
  HistoryOutlined,
} from "@ant-design/icons";
import PortalUsers from "./PortalUsers";
import Swal from "sweetalert2";
import api from "../../api";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

export default function DeveloperSettings({onSettingsSaved, isDark}) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // Logs state
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logLevel, setLogLevel] = useState("all");
  const [logSearch, setLogSearch] = useState("");

  // Deleted submissions state
  const [deletedEntries, setDeletedEntries] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(false);

  // Dashboard display settings
  const DASHBOARD_TABS = [
    { key: "swm-plan", label: "10-Year SWM Plan", icon: <FundProjectionScreenOutlined /> },
    { key: "funded-mrf", label: "Funded MRF", icon: <BankOutlined /> },
    { key: "lgu-mrf", label: "LGU Initiated MRF", icon: <ApartmentOutlined /> },
    { key: "trash-traps", label: "Trash Traps", icon: <DeleteOutlined /> },
    { key: "swm-equip", label: "SWM Equipment", icon: <CarOutlined /> },
    { key: "slf-monitoring", label: "SLF Monitoring", icon: <BankOutlined /> },
    { key: "open-dumpsites", label: "Open Dumpsites", icon: <EnvironmentOutlined /> },
    { key: "residual-containment", label: "Residual Containment", icon: <SafetyCertificateOutlined /> },
    { key: "transfer-stations", label: "Transfer Stations", icon: <SwapOutlined /> },
    { key: "pds-scoping", label: "PDS (Scoping)", icon: <FileTextOutlined /> },
    { key: "tech-assist", label: "Technical Assistance", icon: <ToolOutlined /> },
    { key: "lgu-diversion", label: "LGU Assist & Diversion", icon: <TeamOutlined /> },
    { key: "data-history", label: "Data History", icon: <HistoryOutlined /> },
  ];
  const [dashboardTabs, setDashboardTabs] = useState({});
  const [dashSaving, setDashSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchLogs();
    const logInterval = setInterval(fetchLogs, 8000);
    return () => clearInterval(logInterval);
  }, []);

  const fetchSettings = async () => {
    try {
      const { data } = await api.get("/settings/app");
      setSettings(data);
      form.setFieldsValue(data);
      // Parse dashboardTabs map
      if (data.dashboardTabs) {
        const parsed = typeof data.dashboardTabs === "object" ? data.dashboardTabs : {};
        setDashboardTabs(parsed);
      }
    } catch {
      Swal.fire("Error", "Could not load settings", "error");
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    try {
      const params = { limit: 100 };
      if (logLevel !== "all") params.level = logLevel;
      if (logSearch) params.search = logSearch;
      const { data } = await api.get("/logs", { params });
      setLogs(data.logs);
      setLogsTotal(data.total);
    } catch {
      /* silent */
    } finally {
      setLogsLoading(false);
    }
  };

  const clearLogs = async () => {
    try {
      await api.delete("/logs");
      setLogs([]);
      setLogsTotal(0);
      Swal.fire({ icon: "success", title: "Logs cleared", timer: 800, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not clear logs", "error");
    }
  };

  // ── Deleted Submissions ──
  const fetchDeletedEntries = async () => {
    setDeletedLoading(true);
    try {
      const { data } = await api.get("/data-slf/trash/list");
      setDeletedEntries(data);
    } catch { /* silent */ }
    finally { setDeletedLoading(false); }
  };

  const restoreEntry = async (id) => {
    try {
      await api.patch(`/data-slf/${id}/restore`);
      setDeletedEntries((prev) => prev.filter((d) => d._id !== id));
      Swal.fire({ icon: "success", title: "Restored", text: "Submission restored successfully", timer: 1200, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not restore submission", "error");
    }
  };

  const permanentDelete = async (id) => {
    try {
      await api.delete(`/data-slf/${id}/permanent`);
      setDeletedEntries((prev) => prev.filter((d) => d._id !== id));
      Swal.fire({ icon: "success", title: "Permanently Deleted", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not delete submission", "error");
    }
  };

  const writeClientLog = (action) => {
    fetchLogs();
  };

  // ── Dashboard Tab Visibility ──
  const handleDashTabChange = (tabKey, field, value) => {
    setDashboardTabs(prev => ({
      ...prev,
      [tabKey]: { ...(prev[tabKey] || { visible: true, maintenance: false, maintenanceMessage: "" }), [field]: value },
    }));
  };

  const saveDashboardTabs = async () => {
    setDashSaving(true);
    try {
      await api.put("/settings/app", { dashboardTabs });
      Swal.fire({ icon: "success", title: "Dashboard settings saved", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not save dashboard settings", "error");
    } finally {
      setDashSaving(false);
    }
  };

  const handleSave = async (values) => {
    setSaving(true);
    try {
      const { data } = await api.put("/settings/app", values);
      setSettings(data.data);
      if (onSettingsSaved) onSettingsSaved(data.data);
      writeClientLog("settings.update");
      Swal.fire({
        icon: "success",
        title: "Settings Saved",
        timer: 1200,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <Title level={4} style={{ margin: 0 }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          Developer Settings
        </Title>
        <Text type="secondary">
          Advanced application configuration — developer access only
        </Text>
      </div>

      <Tabs
        defaultActiveKey="general"
        size="large"
        style={{ marginTop: 8 }}
        onChange={(key) => { if (key === "deleted-submissions" && deletedEntries.length === 0) fetchDeletedEntries(); }}
        items={[
          {
            key: "general",
            label: <><GlobalOutlined /> General</>,
            children: (
              <Form form={form} layout="vertical" onFinish={handleSave} initialValues={settings}>
                {/* General Settings */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <GlobalOutlined style={{ color: "#4096ff" }} />
                      <Text strong>General Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="appName" label="Application Name">
                        <Input placeholder="EMBR3 ESWMP" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="appDescription" label="Application Description">
                        <Input placeholder="Ecological Solid Waste Management Pipeline" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Theme & Appearance */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <BgColorsOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Theme &amp; Appearance</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="theme" label="Admin Theme">
                        <Select>
                          <Option value="light">Light Mode</Option>
                          <Option value="dark">Dark Mode</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="primaryColor" label="Primary Color">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="sidebarStyle" label="Sidebar Style">
                        <Select>
                          <Option value="gradient">Gradient</Option>
                          <Option value="solid">Solid</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider titlePlacement="left" style={{ fontSize: 13 }}>Sider</Divider>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="siderColor" label="Sider Color (Light)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="siderColorDark" label="Sider Color (Dark)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider titlePlacement="left" style={{ fontSize: 13 }}>Header</Divider>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="headerColor" label="Header Color (Light)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="headerColorDark" label="Header Color (Dark)">
                        <Input type="color" style={{ width: 80, height: 36, padding: 2, cursor: "pointer" }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />} size="large"
                    style={{ borderRadius: 8, fontWeight: 600, paddingLeft: 32, paddingRight: 32 }}>
                    Save Settings
                  </Button>
                </div>
              </Form>
            ),
          },
          {
            key: "portal-email",
            label: <><MailOutlined /> Portal &amp; Email</>,
            children: (
              <Form form={form} layout="vertical" onFinish={handleSave} initialValues={settings}>
                {/* Portal Settings */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <SettingOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Portal Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalTitle" label="Portal Title">
                        <Input placeholder="SLF Generators Portal" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalEnabled" label="Portal Enabled" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="portalSubtitle" label="Portal Subtitle">
                        <TextArea rows={2} placeholder="Portal subtitle text" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="requireEmailOnSubmit" label="Require Email on Submit" valuePropName="checked">
                        <Switch checkedChildren="Yes" unCheckedChildren="No" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Portal Maintenance */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <ToolOutlined style={{ color: "#fa8c16" }} />
                      <Text strong>Portal Maintenance</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalMaintenanceMode" label="Maintenance Mode" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalMaintenanceReason" label="Maintenance Reason">
                        <Select placeholder="Select reason" allowClear options={[
                          { label: "Scheduled Maintenance", value: "scheduled" },
                          { label: "Emergency Maintenance", value: "emergency" },
                          { label: "System Upgrade", value: "upgrade" },
                          { label: "Database Migration", value: "migration" },
                          { label: "Security Update", value: "security" },
                          { label: "Other", value: "other" },
                        ]} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="portalMaintenanceMessage" label="Maintenance Message">
                        <TextArea rows={2} placeholder="The portal is currently under maintenance. Please try again later." />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Portal Announcements */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <NotificationOutlined style={{ color: "#52c41a" }} />
                      <Text strong>Portal Announcements</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalAnnouncementEnabled" label="Show Announcement" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="portalAnnouncementType" label="Announcement Type">
                        <Select placeholder="Select type" allowClear options={[
                          { label: "Info", value: "info" },
                          { label: "Warning", value: "warning" },
                          { label: "Success", value: "success" },
                          { label: "Error", value: "error" },
                        ]} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="portalAnnouncementTitle" label="Announcement Title">
                        <Input placeholder="Important Notice" />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item name="portalAnnouncementMessage" label="Announcement Message">
                        <TextArea rows={3} placeholder="Enter announcement content..." />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Email Settings */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <MailOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Email Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="emailNotificationsEnabled" label="Email Notifications" valuePropName="checked">
                        <Switch checkedChildren="Enabled" unCheckedChildren="Disabled" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="emailFrom" label="From Email Address">
                        <Input placeholder="noreply@yourdomain.com" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />} size="large"
                    style={{ borderRadius: 8, fontWeight: 600, paddingLeft: 32, paddingRight: 32 }}>
                    Save Settings
                  </Button>
                </div>
              </Form>
            ),
          },
          {
            key: "security",
            label: <><LockOutlined /> Security</>,
            children: (
              <Form form={form} layout="vertical" onFinish={handleSave} initialValues={settings}>
                {/* Security Settings */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <LockOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Security Settings</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="sessionTimeout" label="Session Timeout (days)">
                        <InputNumber min={1} max={30} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="maxLoginAttempts" label="Max Login Attempts">
                        <InputNumber min={1} max={20} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="defaultRole" label="Default Role for New Users">
                        <Select>
                          <Option value="admin">Admin</Option>
                          <Option value="user">User</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="allowSignup" label="Allow Public Signup" valuePropName="checked">
                        <Switch checkedChildren="Yes" unCheckedChildren="No" />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                {/* Maintenance */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <DatabaseOutlined style={{ color: "#4096ff" }} />
                      <Text strong>Maintenance</Text>
                    </Space>
                  }
                >
                  <Row gutter={[16, 0]}>
                    <Col xs={24} md={12}>
                      <Form.Item name="maintenanceMode" label="Maintenance Mode" valuePropName="checked">
                        <Switch checkedChildren="On" unCheckedChildren="Off" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={[16, 0]}>
                    <Col xs={24}>
                      <Form.Item name="maintenanceMessage" label="Maintenance Message">
                        <TextArea rows={2} placeholder="System is under maintenance..." />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>

                <div style={{ marginTop: 24, textAlign: "right" }}>
                  <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />} size="large"
                    style={{ borderRadius: 8, fontWeight: 600, paddingLeft: 32, paddingRight: 32 }}>
                    Save Settings
                  </Button>
                </div>
              </Form>
            ),
          },
          {
            key: "system",
            label: <><ToolOutlined /> System &amp; Logs</>,
            children: (
              <>
                {/* System Info (read-only) */}
                <Card
                  style={{ marginTop: 0, borderRadius: 10 }}
                  title={
                    <Space>
                      <ToolOutlined style={{ color: "#4096ff" }} />
                      <Text strong>System Info</Text>
                    </Space>
                  }
                >
                  <Descriptions column={{ xs: 1, sm: 2 }} size="small">
                    <Descriptions.Item label="Version">
                      <Tag color="blue">1.0.0</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Environment">
                      <Tag color="green">Production</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Last Updated">
                      {settings?.updatedAt
                        ? new Date(settings.updatedAt).toLocaleString()
                        : "\u2014"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Settings ID">
                      <Text copyable type="secondary" style={{ fontSize: 12 }}>
                        {settings?._id || "\u2014"}
                      </Text>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                {/* App Logs */}
                <Card
                  style={{ marginTop: 16, borderRadius: 10 }}
                  title={
                    <Space>
                      <FileTextOutlined style={{ color: "#4096ff" }} />
                      <Text strong>App Logs</Text>
                      <Badge count={logsTotal} overflowCount={999} style={{ marginLeft: 4 }} />
                    </Space>
                  }
                  extra={
                    <Space wrap>
                      <Select
                        value={logLevel}
                        onChange={(v) => { setLogLevel(v); setTimeout(fetchLogs, 0); }}
                        style={{ width: "100%", minWidth: 90, maxWidth: 110 }}
                        size="small"
                      >
                        <Option value="all">All Levels</Option>
                        <Option value="info">Info</Option>
                        <Option value="warn">Warning</Option>
                        <Option value="error">Error</Option>
                      </Select>
                      <Input
                        placeholder="Search logs..."
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        onPressEnter={fetchLogs}
                        style={{ width: "100%", maxWidth: 180 }}
                        size="small"
                        allowClear
                      />
                      <Button size="small" icon={<ReloadOutlined />} onClick={fetchLogs}>
                        Refresh
                      </Button>
                      <Popconfirm title="Clear all logs?" onConfirm={clearLogs}>
                        <Button size="small" danger icon={<DeleteOutlined />}>
                          Clear
                        </Button>
                      </Popconfirm>
                    </Space>
                  }
                >
                  <Table
                    dataSource={logs}
                    rowKey="_id"
                    size="small"
                    loading={logsLoading}
                    pagination={{ pageSize: 30, size: "small" }}
                    scroll={{ x: 700 }}
                    style={{ fontSize: 11 }}
                    className="compact-logs-table"
                    columns={[
                      {
                        title: "Time",
                        dataIndex: "createdAt",
                        key: "createdAt",
                        width: 130,
                        render: (v) => (
                          <Text style={{ fontSize: 10, whiteSpace: "nowrap" }}>
                            {dayjs(v).format("MMM DD, HH:mm:ss")}
                          </Text>
                        ),
                      },
                      {
                        title: "Level",
                        dataIndex: "level",
                        key: "level",
                        width: 65,
                        render: (v) => {
                          const colors = { info: "blue", warn: "orange", error: "red" };
                          return <Tag color={colors[v] || "default"} style={{ fontSize: 10, padding: "0 4px", lineHeight: "18px" }}>{v?.toUpperCase()}</Tag>;
                        },
                      },
                      {
                        title: "Action",
                        dataIndex: "action",
                        key: "action",
                        width: 120,
                        render: (v) => <Tag style={{ fontSize: 10, padding: "0 4px", lineHeight: "18px" }}>{v}</Tag>,
                      },
                      {
                        title: "Message",
                        dataIndex: "message",
                        key: "message",
                        ellipsis: true,
                        render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text>,
                      },
                      {
                        title: "User",
                        dataIndex: "user",
                        key: "user",
                        width: 120,
                        ellipsis: true,
                        render: (v) => <Text style={{ fontSize: 10 }}>{v || "—"}</Text>,
                      },
                      {
                        title: "IP",
                        dataIndex: "ip",
                        key: "ip",
                        width: 100,
                        render: (v) => <Text style={{ fontSize: 10 }}>{v || "—"}</Text>,
                      },
                    ]}
                  />
                </Card>
              </>
            ),
          },          {
            key: "deleted-submissions",
            label: <><DeleteOutlined /> Deleted Submissions</>,
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={
                  <Space>
                    <DeleteOutlined style={{ color: "#ff4d4f" }} />
                    <span>Deleted Submissions</span>
                    <Tag>{deletedEntries.length}</Tag>
                  </Space>
                }
                extra={
                  <Button icon={<ReloadOutlined />} size="small" onClick={fetchDeletedEntries} loading={deletedLoading}>
                    Refresh
                  </Button>
                }
              >
                {deletedEntries.length === 0 && !deletedLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0", color: isDark ? "#666" : "#999" }}>
                    <DeleteOutlined style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }} />
                    <div>No deleted submissions</div>
                    <Button type="link" size="small" onClick={fetchDeletedEntries} style={{ marginTop: 8 }}>Load deleted submissions</Button>
                  </div>
                ) : (
                  <Table
                    dataSource={deletedEntries}
                    rowKey="_id"
                    size="small"
                    loading={deletedLoading}
                    pagination={{ pageSize: 15, size: "small" }}
                    scroll={{ x: 900 }}
                    columns={[
                      { title: "ID No.", dataIndex: "idNo", key: "idNo", width: 160, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
                      { title: "LGU/Company", dataIndex: "lguCompanyName", key: "company", ellipsis: true, width: 200 },
                      { title: "Type", dataIndex: "companyType", key: "type", width: 80, render: (v) => <Tag color={v === "LGU" ? "blue" : "purple"} bordered={false}>{v}</Tag> },
                      { title: "Status (before delete)", dataIndex: "status", key: "status", width: 140, render: (v) => <Tag color={v === "pending" ? "orange" : v === "acknowledged" ? "green" : v === "rejected" ? "red" : v === "reverted" ? "volcano" : "default"}>{v?.charAt(0).toUpperCase() + v?.slice(1)}</Tag> },
                      { title: "Deleted At", dataIndex: "deletedAt", key: "deletedAt", width: 160, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v ? dayjs(v).format("MMM DD, YYYY hh:mm A") : "—"}</Text> },
                      { title: "Deleted By", dataIndex: "deletedBy", key: "deletedBy", width: 120, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Text> },
                      {
                        title: "Actions", key: "actions", width: 200,
                        render: (_, r) => (
                          <Space size={4}>
                            <Tooltip title="Restore submission">
                              <Button size="small" icon={<UndoOutlined />} style={{ borderColor: "#52c41a", color: "#52c41a" }} onClick={() => restoreEntry(r._id)}>
                                Restore
                              </Button>
                            </Tooltip>
                            <Popconfirm
                              title="Permanently delete?"
                              description="This cannot be undone."
                              onConfirm={() => permanentDelete(r._id)}
                              okText="Delete Forever"
                              okButtonProps={{ danger: true }}
                            >
                              <Tooltip title="Delete forever">
                                <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
                              </Tooltip>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            ),
          },          {
            key: "dashboard-display",
            label: <><DashboardOutlined /> Dashboard Display</>,
            children: (
              <Card
                style={{ borderRadius: 10 }}
                title={<Space><DashboardOutlined style={{ color: "#4096ff" }} /><Text strong>Dashboard Tab Visibility & Maintenance</Text></Space>}
                extra={<Button type="primary" icon={<SaveOutlined />} loading={dashSaving} onClick={saveDashboardTabs}>Save Dashboard Settings</Button>}
              >
                <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                  Control which dashboard tabs are shown and set individual tabs to maintenance mode. Changes are reflected immediately on the Dashboard menu.
                </Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {DASHBOARD_TABS.map((tab, idx) => {
                    const cfg = dashboardTabs[tab.key] || { visible: true, maintenance: false, maintenanceMessage: "" };
                    const isVisible = cfg.visible !== false;
                    const isMaint = cfg.maintenance === true;
                    return (
                      <div key={tab.key} style={{
                        padding: "12px 16px",
                        borderBottom: idx < DASHBOARD_TABS.length - 1 ? (isDark ? "1px solid #303030" : "1px solid #f0f0f0") : "none",
                        background: !isVisible ? (isDark ? "#1f1f1f" : "#fafafa") : isMaint ? (isDark ? "rgba(250,219,20,0.1)" : "#fffbe6") : "transparent",
                        borderRadius: 6,
                        opacity: isVisible ? 1 : 0.6,
                      }}>
                        <Row align="middle" gutter={16}>
                          <Col flex="auto">
                            <Space>
                              <span style={{ fontSize: 16 }}>{tab.icon}</span>
                              <Text strong style={{ fontSize: 14 }}>{tab.label}</Text>
                              {!isVisible && <Tag color="default">Hidden</Tag>}
                              {isMaint && <Tag color="warning">Maintenance</Tag>}
                            </Space>
                          </Col>
                          <Col>
                            <Space size="middle">
                              <Tooltip title={isVisible ? "Click to hide" : "Click to show"}>
                                <Switch
                                  checked={isVisible}
                                  onChange={v => handleDashTabChange(tab.key, "visible", v)}
                                  checkedChildren={<EyeOutlined />}
                                  unCheckedChildren={<EyeInvisibleOutlined />}
                                />
                              </Tooltip>
                              <Tooltip title="Maintenance mode">
                                <Switch
                                  checked={isMaint}
                                  onChange={v => handleDashTabChange(tab.key, "maintenance", v)}
                                  checkedChildren={<ToolOutlined />}
                                  unCheckedChildren={<ToolOutlined />}
                                  disabled={!isVisible}
                                  style={isMaint ? { background: "#faad14" } : {}}
                                />
                              </Tooltip>
                            </Space>
                          </Col>
                        </Row>
                        {isMaint && isVisible && (
                          <div style={{ marginTop: 8, paddingLeft: 32 }}>
                            <Input
                              size="small"
                              placeholder="Maintenance message (optional)"
                              value={cfg.maintenanceMessage || ""}
                              onChange={e => handleDashTabChange(tab.key, "maintenanceMessage", e.target.value)}
                              style={{ maxWidth: 500 }}
                              prefix={<ExclamationCircleOutlined style={{ color: "#faad14" }} />}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Divider />
                <Row gutter={16}>
                  <Col>
                    <Button size="small" onClick={() => {
                      const all = {};
                      DASHBOARD_TABS.forEach(t => { all[t.key] = { ...(dashboardTabs[t.key] || {}), visible: true }; });
                      setDashboardTabs(all);
                    }}>Show All</Button>
                  </Col>
                  <Col>
                    <Button size="small" onClick={() => {
                      const all = {};
                      DASHBOARD_TABS.forEach(t => { all[t.key] = { ...(dashboardTabs[t.key] || {}), visible: false }; });
                      setDashboardTabs(all);
                    }}>Hide All</Button>
                  </Col>
                  <Col>
                    <Button size="small" danger onClick={() => {
                      const all = {};
                      DASHBOARD_TABS.forEach(t => { all[t.key] = { ...(dashboardTabs[t.key] || {}), maintenance: false, maintenanceMessage: "" }; });
                      setDashboardTabs(all);
                    }}>Disable All Maintenance</Button>
                  </Col>
                </Row>
              </Card>
            ),
          },          {
            key: "portal-users",
            label: <><TeamOutlined /> Portal Users</>,
            children: <PortalUsers isDark={isDark} />,
          },        ]}
      />
    </div>
  );
}
