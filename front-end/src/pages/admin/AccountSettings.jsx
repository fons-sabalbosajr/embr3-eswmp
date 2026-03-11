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
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";

const { Title, Text } = Typography;
const { Option } = Select;

const PERMISSION_LABELS = {
  dashboard: "Dashboard",
  submissions: "Submissions",
  slfMonitoring: "SLF Monitoring",
  reports: "Reports",
  accountSettings: "Accounts & Roles",
  portalFields: "Portal Fields",
};

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
    setEditValues({ position: record.position || "", designation: record.designation || "" });
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
      u.email?.toLowerCase().includes(search.toLowerCase())
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
        <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <Input
            placeholder="Search users..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 360 }}
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
      >
        {accessModal && (
          <>
            <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Email">{accessModal.email}</Descriptions.Item>
              <Descriptions.Item label="Role">
                <Tag color={accessModal.role === "admin" ? "gold" : "blue"}>{accessModal.role}</Tag>
              </Descriptions.Item>
            </Descriptions>
            <Title level={5} style={{ marginBottom: 12 }}>Module Access</Title>
            {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                <Text>{label}</Text>
                <Switch
                  checked={permEdits[key] !== false}
                  onChange={(checked) => setPermEdits((p) => ({ ...p, [key]: checked }))}
                />
              </div>
            ))}
          </>
        )}
      </Modal>
    </div>
  );
}
