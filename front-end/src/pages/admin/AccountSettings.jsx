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
  EnvironmentOutlined,
  SettingOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  FormOutlined,
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
    { key: "orgChart", label: "Org Chart" },
    { key: "baselineData", label: "Baseline Data" },
  ]},
];

// Helper: normalize a permission value (handles old boolean format and new object format)
function normPerm(val) {
  if (val === undefined || val === null) return { view: true, edit: true, delete: true };
  if (typeof val === "boolean") return { view: val, edit: val, delete: val };
  return { view: val.view !== false, edit: val.edit !== false, delete: val.delete !== false };
}

export default function AccountSettings({ isDark }) {
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

  const handleApprove = async (userId) => {
    try {
      await api.patch(`/users/${userId}/approve`);
      setUsers((prev) =>
        prev.map((u) => (u._id === userId ? { ...u, isApproved: true } : u))
      );
      Swal.fire({ icon: "success", title: "Account Approved", text: "The user has been notified via email.", timer: 2000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not approve user", "error");
    }
  };

  const handleReject = async (userId) => {
    const { value: reason, isConfirmed } = await Swal.fire({
      title: "Reject Account",
      input: "textarea",
      inputLabel: "Reason for rejection (optional)",
      inputPlaceholder: "Enter reason...",
      showCancelButton: true,
      confirmButtonText: "Reject",
      confirmButtonColor: "#ff4d4f",
      cancelButtonText: "Cancel",
    });
    if (!isConfirmed) return;
    try {
      await api.patch(`/users/${userId}/reject`, { reason: reason || "" });
      setUsers((prev) =>
        prev.map((u) => (u._id === userId ? { ...u, isApproved: false } : u))
      );
      Swal.fire({ icon: "success", title: "Account Rejected", text: "The user has been notified via email.", timer: 2000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not reject user", "error");
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
    // Normalize permissions to new format
    const raw = record.permissions || {};
    const normalized = {};
    PERMISSION_GROUPS.forEach((g) =>
      g.items.forEach((i) => {
        normalized[i.key] = normPerm(raw[i.key]);
      })
    );
    setPermEdits(normalized);
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

  const togglePerm = (key, level) => {
    setPermEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], [level]: !prev[key]?.[level] },
    }));
  };

  const setAllPerms = (val) => {
    const updated = {};
    PERMISSION_GROUPS.forEach((g) =>
      g.items.forEach((i) => {
        updated[i.key] = { view: val, edit: val, delete: val };
      })
    );
    setPermEdits(updated);
  };

  const setGroupPerms = (group, val) => {
    const updated = { ...permEdits };
    group.items.forEach((i) => {
      updated[i.key] = { view: val, edit: val, delete: val };
    });
    setPermEdits(updated);
  };

  const setViewOnly = () => {
    const updated = {};
    PERMISSION_GROUPS.forEach((g) =>
      g.items.forEach((i) => {
        updated[i.key] = { view: true, edit: false, delete: false };
      })
    );
    setPermEdits(updated);
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
      title: "Approval",
      key: "approval",
      render: (_, r) => {
        if (r.role === "developer") return <Tag icon={<CheckCircleOutlined />} color="purple">Developer</Tag>;
        if (r.isApproved) return (
          <Space size={4}>
            <Tag icon={<CheckCircleOutlined />} color="green">Approved</Tag>
            {isDeveloper && (
              <Tooltip title="Revoke / Reject">
                <Button size="small" danger type="text" icon={<CloseCircleOutlined />} onClick={() => handleReject(r._id)} />
              </Tooltip>
            )}
          </Space>
        );
        return (
          <Space size={4}>
            <Tag icon={<ClockCircleOutlined />} color="orange">Pending</Tag>
            {isDeveloper && (
              <>
                <Tooltip title="Approve Account">
                  <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => handleApprove(r._id)} style={{ fontSize: 11 }}>Approve</Button>
                </Tooltip>
                <Tooltip title="Reject">
                  <Button size="small" danger icon={<CloseCircleOutlined />} onClick={() => handleReject(r._id)} />
                </Tooltip>
              </>
            )}
          </Space>
        );
      },
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
                Approved: u.isApproved ? "Yes" : "No",
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
        width={720}
      >
        {accessModal && (
          <>
            <div style={{ textAlign: "center", marginBottom: 16, padding: "12px 0", background: isDark ? "linear-gradient(135deg, #1f1f1f 0%, #2a2a2a 100%)" : "linear-gradient(135deg, #f6f8fc 0%, #eef2f7 100%)", borderRadius: 8 }}>
              <Avatar size={48} style={{ backgroundColor: accessModal.role === "admin" ? "#faad14" : "#1a3353" }} icon={<UserOutlined />} />
              <div style={{ marginTop: 8 }}>
                <Text strong>{accessModal.firstName} {accessModal.lastName}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>{accessModal.email}</Text>
                <br />
                <Tag color={accessModal.role === "admin" ? "gold" : "blue"} style={{ marginTop: 4 }}>{accessModal.role}</Tag>
              </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <Text strong>Module Permissions</Text>
              <Space size={4} wrap>
                <Button size="small" type="link" onClick={() => setAllPerms(true)}>Full Access</Button>
                <Button size="small" type="link" onClick={setViewOnly} style={{ color: "#faad14" }}>
                  <EyeOutlined /> View Only
                </Button>
                <Button size="small" type="link" danger onClick={() => setAllPerms(false)}>Disable All</Button>
              </Space>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 11, color: "#888" }}>
              <span><EyeOutlined style={{ color: "#1890ff" }} /> View — Can see the module</span>
              <span><FormOutlined style={{ color: "#52c41a" }} /> Edit — Can add/edit data</span>
              <span><DeleteOutlined style={{ color: "#ff4d4f" }} /> Delete — Can remove data</span>
            </div>

            <Collapse
              defaultActiveKey={PERMISSION_GROUPS.map(g => g.group)}
              bordered={false}
              size="small"
              items={PERMISSION_GROUPS.map(g => {
                const totalView = g.items.filter(i => permEdits[i.key]?.view !== false).length;
                const totalEdit = g.items.filter(i => permEdits[i.key]?.edit !== false).length;
                const totalDel = g.items.filter(i => permEdits[i.key]?.delete !== false).length;
                const allFull = totalView === g.items.length && totalEdit === g.items.length && totalDel === g.items.length;

                return {
                  key: g.group,
                  label: (
                    <Space>
                      <span style={{ color: g.color }}>{g.icon}</span>
                      <Text strong style={{ fontSize: 13 }}>{g.group}</Text>
                      <Badge
                        count={allFull ? "Full" : `${totalView}V/${totalEdit}E/${totalDel}D`}
                        style={{ backgroundColor: allFull ? "#52c41a" : "#faad14", fontSize: 10 }}
                      />
                    </Space>
                  ),
                  extra: (
                    <Switch
                      size="small"
                      checked={allFull}
                      onClick={(_, e) => e.stopPropagation()}
                      onChange={(checked) => setGroupPerms(g, checked)}
                    />
                  ),
                  children: (
                    <div>
                      {/* Header row */}
                      <Row style={{ padding: "4px 8px", marginBottom: 4 }}>
                        <Col flex="auto"><Text type="secondary" style={{ fontSize: 11 }}>Module</Text></Col>
                        <Col style={{ width: 60, textAlign: "center" }}><Text type="secondary" style={{ fontSize: 11 }}>View</Text></Col>
                        <Col style={{ width: 60, textAlign: "center" }}><Text type="secondary" style={{ fontSize: 11 }}>Edit</Text></Col>
                        <Col style={{ width: 60, textAlign: "center" }}><Text type="secondary" style={{ fontSize: 11 }}>Delete</Text></Col>
                      </Row>
                      {g.items.map(i => {
                        const p = permEdits[i.key] || { view: true, edit: true, delete: true };
                        return (
                          <Row key={i.key} align="middle" style={{
                            padding: "6px 8px",
                            borderRadius: 6,
                            marginBottom: 2,
                            background: p.view || p.edit || p.delete ? "rgba(82,196,26,0.04)" : "rgba(0,0,0,0.02)",
                          }}>
                            <Col flex="auto"><Text style={{ fontSize: 12 }}>{i.label}</Text></Col>
                            <Col style={{ width: 60, textAlign: "center" }}>
                              <Switch size="small" checked={p.view !== false} onChange={() => togglePerm(i.key, "view")} />
                            </Col>
                            <Col style={{ width: 60, textAlign: "center" }}>
                              <Switch size="small" checked={p.edit !== false} onChange={() => togglePerm(i.key, "edit")} />
                            </Col>
                            <Col style={{ width: 60, textAlign: "center" }}>
                              <Switch size="small" checked={p.delete !== false} onChange={() => togglePerm(i.key, "delete")} />
                            </Col>
                          </Row>
                        );
                      })}
                    </div>
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
