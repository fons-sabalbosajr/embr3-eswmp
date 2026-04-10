import { useState, useEffect } from "react";
import {
  Table,
  Button,
  Select,
  Tag,
  Space,
  Typography,
  Card,
  Popconfirm,
  Input,
  Modal,
  Switch,
  Descriptions,
  Tooltip,
  Form,
  Avatar,
  Divider,
  Collapse,
  Row,
  Col,
  Badge,
} from "antd";
import {
  DeleteOutlined,
  SearchOutlined,
  UserOutlined,
  CrownOutlined,
  CodeOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
  EditOutlined,
  DashboardOutlined,
  FileTextOutlined,
  EnvironmentOutlined,
  BarChartOutlined,
  SettingOutlined,
  TeamOutlined,
  ToolOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";

const { Title, Text } = Typography;
const { Option } = Select;

const PERMISSION_GROUPS = [
  { group: "General", icon: <DashboardOutlined />, color: "#1890ff", items: [
    { key: "dashboard", label: "Dashboard" },
    { key: "submissions", label: "SLF Submissions" },
    { key: "slfMonitoring", label: "SLF Monitoring" },
    { key: "reports", label: "Reports" },
  ]},
  { group: "SWM Programs", icon: <ExperimentOutlined />, color: "#13c2c2", items: [
    { key: "tenYearSwm", label: "10-Year SWM Plan" },
    { key: "fundedMrf", label: "Funded MRF" },
    { key: "lguInitiatedMrf", label: "LGU Initiated MRF" },
    { key: "trashTraps", label: "Trash Traps" },
    { key: "swmEquipment", label: "SWM Equipment" },
  ]},
  { group: "Monitoring & Assistance", icon: <EnvironmentOutlined />, color: "#722ed1", items: [
    { key: "technicalAssistance", label: "Technical Assistance" },
    { key: "transferStations", label: "Transfer Stations" },
    { key: "openDumpsites", label: "Open Dumpsites" },
    { key: "projectDescScoping", label: "PDS (Scoping)" },
    { key: "residualContainment", label: "Residual Containment" },
    { key: "lguAssistDiversion", label: "LGU Assist & Diversion" },
  ]},
  { group: "Settings", icon: <SettingOutlined />, color: "#fa8c16", items: [
    { key: "accountSettings", label: "Accounts & Roles" },
    { key: "portalFields", label: "Portal Fields" },
    { key: "dataReferences", label: "Data References" },
  ]},
];

export default function AccountSettings() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editModal, setEditModal] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [accessModal, setAccessModal] = useState(null);
  const [permEdits, setPermEdits] = useState({});
  const [savingPerms, setSavingPerms] = useState(false);

  const currentUser = secureStorage.getJSON("user");
  const isDeveloper = currentUser?.role === "developer";

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(fetchUsers, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchUsers = async () => {
    try {
      const { data } = await api.get("/users");
      setUsers(data);
    } catch {
      Swal.fire("Error", "Could not load users", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId, role) => {
    try {
      await api.patch(`/users/${userId}/role`, { role });
      setUsers((prev) =>
        prev.map((u) => (u._id === userId ? { ...u, role } : u))
      );
      Swal.fire({ icon: "success", title: "Role Updated", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not update role", "error");
    }
  };

  const handleDelete = async (userId) => {
    try {
      await api.delete(`/users/${userId}`);
      setUsers((prev) => prev.filter((u) => u._id !== userId));
      Swal.fire({ icon: "success", title: "User Deleted", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not delete user", "error");
    }
  };

  const openEditModal = (record) => {
    setEditModal(record);
    setEditValues({ username: record.username || "", position: record.position || "", designation: record.designation || "" });
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await api.patch(`/users/${editModal._id}/profile`, editValues);
      setUsers((prev) =>
        prev.map((u) => (u._id === editModal._id ? { ...u, ...editValues } : u))
      );
      setEditModal(null);
      Swal.fire({ icon: "success", title: "Profile Updated", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not update profile", "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const openAccessModal = (record) => {
    setAccessModal(record);
    setPermEdits(record.permissions || {});
  };

  const savePermissions = async () => {
    setSavingPerms(true);
    try {
      await api.patch(`/users/${accessModal._id}/permissions`, { permissions: permEdits });
      setUsers((prev) =>
        prev.map((u) => (u._id === accessModal._id ? { ...u, permissions: permEdits } : u))
      );
      setAccessModal(null);
      Swal.fire({ icon: "success", title: "Access Updated", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not update access", "error");
    } finally {
      setSavingPerms(false);
    }
  };

  const filtered = users.filter(
    (u) =>
      u.firstName?.toLowerCase().includes(search.toLowerCase()) ||
      u.lastName?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.username?.toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    {
      title: "Name",
      key: "name",
      render: (_, r) => (
        <Space>
          <UserOutlined />
          <Text strong>{r.firstName} {r.lastName}</Text>
        </Space>
      ),
    },
    { title: "Email", dataIndex: "email", key: "email" },
    {
      title: "Username",
      key: "username",
      render: (_, r) => <Text>{r.username || "—"}</Text>,
    },
    {
      title: "Position",
      key: "position",
      render: (_, r) => <Text>{r.position || "—"}</Text>,
    },
    {
      title: "Designation",
      key: "designation",
      render: (_, r) => <Text>{r.designation || "—"}</Text>,
    },
    {
      title: "Status",
      key: "verified",
      render: (_, r) =>
        r.isVerified ? <Tag color="green">Verified</Tag> : <Tag color="orange">Pending</Tag>,
    },
    {
      title: "Role",
      key: "role",
      render: (_, r) => (
        <Select value={r.role} onChange={(val) => handleRoleChange(r._id, val)} style={{ width: 140 }} size="small">
          <Option value="developer"><CodeOutlined style={{ color: "#722ed1" }} /> Developer</Option>
          <Option value="admin"><CrownOutlined style={{ color: "#faad14" }} /> Admin</Option>
          <Option value="user"><UserOutlined /> User</Option>
        </Select>
      ),
    },
    {
      title: "Action",
      key: "action",
      render: (_, r) => (
        <Space>
          <Tooltip title="Edit User">
            <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEditModal(r)} />
          </Tooltip>
          {isDeveloper && r.role !== "developer" && (
            <Tooltip title="Manage Access">
              <Button type="text" icon={<SafetyCertificateOutlined />} size="small" onClick={() => openAccessModal(r)} style={{ color: "#722ed1" }} />
            </Tooltip>
          )}
          <Popconfirm title="Delete this user?" onConfirm={() => handleDelete(r._id)} okText="Yes" cancelText="No">
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 4 }}>Account Management</Title>
      <Text type="secondary">Manage user accounts, roles, and access permissions</Text>

      <Card style={{ marginTop: 16, borderRadius: 10 }}>
        <Space style={{ marginBottom: 16, flexWrap: "wrap", width: "100%" }}>
          <Input
            placeholder="Search users..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 360 }}
            allowClear
          />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const rows = filtered.map((u) => ({
                Name: `${u.firstName} ${u.lastName}`,
                Email: u.email,
                Position: u.position || "",
                Designation: u.designation || "",
                Role: u.role,
                Verified: u.isVerified ? "Yes" : "No",
              }));
              exportToExcel(rows, "Users");
            }}
          >
            Export Excel
          </Button>
        </Space>
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          size="middle"
          scroll={{ x: 900 }}
        />
      </Card>

      {/* ── Edit User Modal ── */}
      <Modal
        title={<Space><EditOutlined /> <span>Edit User — {editModal?.firstName} {editModal?.lastName}</span></Space>}
        open={!!editModal}
        onCancel={() => setEditModal(null)}
        onOk={saveProfile}
        confirmLoading={savingProfile}
        okText="Save Changes"
      >
        {editModal && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <Avatar size={64} style={{ backgroundColor: "#1a3353" }} icon={<UserOutlined />} />
              <div style={{ marginTop: 8 }}>
                <Text strong style={{ fontSize: 16 }}>{editModal.firstName} {editModal.lastName}</Text>
              </div>
              <Text type="secondary">{editModal.email}</Text>
            </div>
            <Divider style={{ margin: "12px 0" }} />
            <Form layout="vertical">
              <Form.Item label="Username">
                <Input
                  value={editValues.username}
                  onChange={(e) => setEditValues((v) => ({ ...v, username: e.target.value }))}
                  placeholder="Enter username"
                />
              </Form.Item>
              <Form.Item label="Position">
                <Input
                  value={editValues.position}
                  onChange={(e) => setEditValues((v) => ({ ...v, position: e.target.value }))}
                  placeholder="Enter position"
                />
              </Form.Item>
              <Form.Item label="Designation">
                <Input
                  value={editValues.designation}
                  onChange={(e) => setEditValues((v) => ({ ...v, designation: e.target.value }))}
                  placeholder="Enter designation"
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      {/* ── Manage Access Modal ── */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: "#722ed1" }} />
            <span>Manage Access — {accessModal?.firstName} {accessModal?.lastName}</span>
          </Space>
        }
        open={!!accessModal}
        onCancel={() => setAccessModal(null)}
        onOk={savePermissions}
        confirmLoading={savingPerms}
        okText="Save Permissions"
        width={600}
      >
        {accessModal && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16, padding: "12px 0", background: "linear-gradient(135deg, #f6f8fc 0%, #eef2f7 100%)", borderRadius: 8 }}>
              <Avatar size={48} style={{ backgroundColor: accessModal.role === "admin" ? "#faad14" : "#1a3353" }} icon={<UserOutlined />} />
              <div style={{ marginTop: 8 }}>
                <Text strong>{accessModal.firstName} {accessModal.lastName}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>{accessModal.email}</Text>
                <br />
                <Tag color={accessModal.role === "admin" ? "gold" : "blue"} style={{ marginTop: 4 }}>{accessModal.role}</Tag>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
              <Text strong>Module Permissions</Text>
              <Space size={4}>
                <Button size="small" type="link" onClick={() => {
                  const all = {};
                  PERMISSION_GROUPS.forEach(g => g.items.forEach(i => { all[i.key] = true; }));
                  setPermEdits(all);
                }}>Enable All</Button>
                <Button size="small" type="link" danger onClick={() => {
                  const all = {};
                  PERMISSION_GROUPS.forEach(g => g.items.forEach(i => { all[i.key] = false; }));
                  setPermEdits(all);
                }}>Disable All</Button>
              </Space>
            </div>
            <Collapse
              defaultActiveKey={PERMISSION_GROUPS.map(g => g.group)}
              bordered={false}
              size="small"
              items={PERMISSION_GROUPS.map(g => {
                const enabledCount = g.items.filter(i => permEdits[i.key] !== false).length;
                return {
                  key: g.group,
                  label: (
                    <Space>
                      <span style={{ color: g.color }}>{g.icon}</span>
                      <Text strong style={{ fontSize: 13 }}>{g.group}</Text>
                      <Badge count={`${enabledCount}/${g.items.length}`} style={{ backgroundColor: enabledCount === g.items.length ? "#52c41a" : "#faad14", fontSize: 10 }} />
                    </Space>
                  ),
                  extra: (
                    <Switch
                      size="small"
                      checked={enabledCount === g.items.length}
                      onClick={(_, e) => e.stopPropagation()}
                      onChange={(checked) => {
                        const updates = {};
                        g.items.forEach(i => { updates[i.key] = checked; });
                        setPermEdits(p => ({ ...p, ...updates }));
                      }}
                    />
                  ),
                  children: (
                    <Row gutter={[8, 4]}>
                      {g.items.map(i => (
                        <Col key={i.key} xs={24} sm={12}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderRadius: 6, background: permEdits[i.key] !== false ? "rgba(82,196,26,0.06)" : "rgba(0,0,0,0.02)" }}>
                            <Text style={{ fontSize: 12 }}>{i.label}</Text>
                            <Switch size="small" checked={permEdits[i.key] !== false} onChange={(checked) => setPermEdits(p => ({ ...p, [i.key]: checked }))} />
                          </div>
                        </Col>
                      ))}
                    </Row>
                  ),
                };
              })}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
