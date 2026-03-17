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
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

export default function DeveloperSettings({ onSettingsSaved }) {
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

  const writeClientLog = (action) => {
    // will be picked up by polling
    fetchLogs();
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
                    pagination={{ pageSize: 20, size: "small" }}
                    scroll={{ x: 800 }}
                    columns={[
                      {
                        title: "Time",
                        dataIndex: "createdAt",
                        key: "createdAt",
                        width: 160,
                        render: (v) => (
                          <Text style={{ fontSize: 12 }}>
                            {dayjs(v).format("MMM DD, HH:mm:ss")}
                          </Text>
                        ),
                      },
                      {
                        title: "Level",
                        dataIndex: "level",
                        key: "level",
                        width: 80,
                        render: (v) => {
                          const colors = { info: "blue", warn: "orange", error: "red" };
                          return <Tag color={colors[v] || "default"}>{v?.toUpperCase()}</Tag>;
                        },
                      },
                      {
                        title: "Action",
                        dataIndex: "action",
                        key: "action",
                        width: 150,
                        render: (v) => <Tag>{v}</Tag>,
                      },
                      {
                        title: "Message",
                        dataIndex: "message",
                        key: "message",
                        ellipsis: true,
                      },
                      {
                        title: "User",
                        dataIndex: "user",
                        key: "user",
                        width: 160,
                        ellipsis: true,
                        render: (v) => v || "\u2014",
                      },
                      {
                        title: "IP",
                        dataIndex: "ip",
                        key: "ip",
                        width: 120,
                        render: (v) => <Text style={{ fontSize: 11 }}>{v || "\u2014"}</Text>,
                      },
                    ]}
                  />
                </Card>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
