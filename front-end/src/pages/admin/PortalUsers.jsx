import { useState, useEffect } from "react";
import {
  Table,
  Tag,
  Button,
  Space,
  Modal,
  Select,
  Typography,
  Input,
  Spin,
  Empty,
  Tooltip,
  Badge,
  Card,
  Descriptions,
  Avatar,
  Divider,
  Row,
  Col,
  Timeline,
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ReloadOutlined,
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  BankOutlined,
  CalendarOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";

const { Text, Title } = Typography;
const { Option } = Select;

export default function PortalUsers({ isDark }) {
  const [users, setUsers] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approveModal, setApproveModal] = useState({
    open: false,
    user: null,
  });
  const [selectedSlf, setSelectedSlf] = useState([]);
  const [detailModal, setDetailModal] = useState({ open: false, user: null });
  const [approving, setApproving] = useState(false);
  const [editSlfModal, setEditSlfModal] = useState({ open: false, user: null });
  const [editSlfValue, setEditSlfValue] = useState([]);
  const [editingSlfLoading, setEditingSlfLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, genRes] = await Promise.all([
        api.get("/portal-users"),
        api.get("/slf-facilities"),
      ]);
      setUsers(usersRes.data);
      setGenerators(genRes.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedSlf || selectedSlf.length === 0) {
      Swal.fire("Warning", "Please select at least one SLF to assign.", "warning");
      return;
    }
    setApproving(true);
    try {
      await api.patch(`/portal-users/${approveModal.user._id}/approve`, {
        assignedSlf: selectedSlf,
      });
      Swal.fire({
        icon: "success",
        title: "Approved",
        text: `${approveModal.user.firstName} ${approveModal.user.lastName} has been approved.`,
        confirmButtonColor: "#1a3353",
      });
      setApproveModal({ open: false, user: null });
      setSelectedSlf([]);
      fetchData();
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to approve",
        "error"
      );
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async (record) => {
    const { value: reason, isConfirmed } = await Swal.fire({
      title: "Reject Registration",
      input: "textarea",
      inputLabel: "Reason (optional)",
      inputPlaceholder: "Enter reason for rejection...",
      showCancelButton: true,
      confirmButtonText: "Reject",
      confirmButtonColor: "#ff4d4f",
    });
    if (!isConfirmed) return;
    try {
      await api.patch(`/portal-users/${record._id}/reject`, { reason });
      Swal.fire({
        icon: "info",
        title: "Rejected",
        text: `${record.firstName} ${record.lastName} has been rejected.`,
        confirmButtonColor: "#1a3353",
      });
      fetchData();
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to reject",
        "error"
      );
    }
  };

  const handleDelete = async (record) => {
    const result = await Swal.fire({
      title: "Delete Portal User?",
      text: `This will permanently remove ${record.firstName} ${record.lastName}.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ff4d4f",
      confirmButtonText: "Delete",
    });
    if (!result.isConfirmed) return;
    try {
      await api.delete(`/portal-users/${record._id}`);
      Swal.fire({
        icon: "success",
        title: "Deleted",
        confirmButtonColor: "#1a3353",
      });
      fetchData();
    } catch {
      Swal.fire("Error", "Failed to delete user", "error");
    }
  };

  const handleEditSlf = async () => {
    if (!editSlfValue || editSlfValue.length === 0) {
      Swal.fire("Warning", "Please select at least one SLF to assign.", "warning");
      return;
    }
    setEditingSlfLoading(true);
    try {
      await api.patch(`/portal-users/${editSlfModal.user._id}/update-slf`, {
        assignedSlf: editSlfValue,
      });
      Swal.fire({
        icon: "success",
        title: "Updated",
        text: "Assigned SLF has been updated.",
        confirmButtonColor: "#1a3353",
      });
      setEditSlfModal({ open: false, user: null });
      setEditSlfValue([]);
      fetchData();
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to update SLF",
        "error"
      );
    } finally {
      setEditingSlfLoading(false);
    }
  };

  const statusColor = {
    pending: "orange",
    approved: "green",
    rejected: "red",
  };

  const columns = [
    {
      title: "#",
      key: "index",
      width: 50,
      render: (_, __, i) => i + 1,
    },
    {
      title: "Name",
      key: "name",
      render: (_, r) => `${r.firstName} ${r.lastName}`,
      sorter: (a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`
        ),
    },
    {
      title: "Email",
      dataIndex: "email",
      key: "email",
    },
    {
      title: "Company/LGU",
      dataIndex: "companyName",
      key: "companyName",
      render: (v) => v || "—",
    },
    {
      title: "Assigned SLF",
      dataIndex: "assignedSlfName",
      key: "assignedSlfName",
      render: (v) => {
        const names = Array.isArray(v) ? v : v ? [v] : [];
        return names.length > 0
          ? names.map((n, i) => <Tag key={i} color="blue" style={{ marginBottom: 2 }}>{n}</Tag>)
          : <Text type="secondary">Not assigned</Text>;
      },
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      filters: [
        { text: "Pending", value: "pending" },
        { text: "Approved", value: "approved" },
        { text: "Rejected", value: "rejected" },
      ],
      onFilter: (value, record) => record.status === value,
      render: (v) => (
        <Tag color={statusColor[v]}>{v?.toUpperCase()}</Tag>
      ),
    },
    {
      title: "Registered",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v) => dayjs(v).format("MMM D, YYYY"),
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    },
    {
      title: "Actions",
      key: "actions",
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Tooltip title="View Details">
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() =>
                setDetailModal({ open: true, user: record })
              }
            />
          </Tooltip>
          {record.status === "pending" && (
            <>
              <Tooltip title="Approve">
                <Button
                  size="small"
                  type="primary"
                  style={{ background: "#52c41a", borderColor: "#52c41a" }}
                  icon={<CheckCircleOutlined />}
                  onClick={() => {
                    setSelectedSlf([]);
                    setApproveModal({ open: true, user: record });
                  }}
                />
              </Tooltip>
              <Tooltip title="Reject">
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleReject(record)}
                />
              </Tooltip>
            </>
          )}
          {record.status === "approved" && (
            <Tooltip title="Edit Assigned SLF">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  const existing = Array.isArray(record.assignedSlf) ? record.assignedSlf : record.assignedSlf ? [record.assignedSlf] : [];
                  setEditSlfValue(existing);
                  setEditSlfModal({ open: true, user: record });
                }}
              />
            </Tooltip>
          )}
          <Tooltip title="Delete">
            <Button
              size="small"
              danger
              type="text"
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const pendingCount = users.filter((u) => u.status === "pending").length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Space>
          <Title level={5} style={{ margin: 0, color: isDark ? "#7eb8da" : "#1a3353" }}>
            <UserOutlined /> SLF Portal Users
          </Title>
          {pendingCount > 0 && (
            <Badge count={pendingCount} style={{ backgroundColor: "#fa8c16" }}>
              <Tag color="orange">Pending Approval</Tag>
            </Badge>
          )}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>
          Refresh
        </Button>
      </div>

      <Table
        dataSource={users}
        columns={columns}
        rowKey="_id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 15 }}
        scroll={{ x: 900 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No portal users"
            />
          ),
        }}
      />

      {/* Approve Modal */}
      <Modal
        title="Approve Portal User"
        open={approveModal.open}
        onCancel={() => {
          setApproveModal({ open: false, user: null });
          setSelectedSlf([]);
        }}
        onOk={handleApprove}
        confirmLoading={approving}
        okText="Approve & Assign SLF"
        okButtonProps={{ style: { background: "#52c41a", borderColor: "#52c41a" } }}
      >
        {approveModal.user && (
          <div>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Name">
                {approveModal.user.firstName} {approveModal.user.lastName}
              </Descriptions.Item>
              <Descriptions.Item label="Email">
                {approveModal.user.email}
              </Descriptions.Item>
              <Descriptions.Item label="Company/LGU">
                {approveModal.user.companyName || "—"}
              </Descriptions.Item>
            </Descriptions>

            <Text strong style={{ display: "block", marginBottom: 8 }}>
              Assign Sanitary Landfill Facility (SLF):
            </Text>
            <Select
              mode="multiple"
              placeholder="Select SLF(s) to assign"
              style={{ width: "100%" }}
              value={selectedSlf}
              onChange={setSelectedSlf}
              showSearch
              optionFilterProp="label"
              options={generators
                .map((g) => ({
                  label: `${g.lgu}${g.ownership ? " (" + g.ownership + ")" : ""}`,
                  value: g._id,
                }))
                .filter((opt, idx, arr) => arr.findIndex((o) => o.label === opt.label) === idx)}
              notFoundContent={<Empty description="No SLF available" />}
            />
          </div>
        )}
      </Modal>

      {/* Edit Assigned SLF Modal */}
      <Modal
        title="Edit Assigned SLF"
        open={editSlfModal.open}
        onCancel={() => {
          setEditSlfModal({ open: false, user: null });
          setEditSlfValue([]);
        }}
        onOk={handleEditSlf}
        confirmLoading={editingSlfLoading}
        okText="Update SLF"
        okButtonProps={{ style: { background: "#1a3353", borderColor: "#1a3353" } }}
      >
        {editSlfModal.user && (
          <div>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Name">
                {editSlfModal.user.firstName} {editSlfModal.user.lastName}
              </Descriptions.Item>
              <Descriptions.Item label="Email">
                {editSlfModal.user.email}
              </Descriptions.Item>
              <Descriptions.Item label="Current SLF">
                {(() => {
                  const names = Array.isArray(editSlfModal.user.assignedSlfName)
                    ? editSlfModal.user.assignedSlfName
                    : editSlfModal.user.assignedSlfName ? [editSlfModal.user.assignedSlfName] : [];
                  return names.length > 0 ? names.join(", ") : "Not assigned";
                })()}
              </Descriptions.Item>
            </Descriptions>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              Assign SLF(s):
            </Text>
            <Select
              mode="multiple"
              placeholder="Select SLF(s) to assign"
              style={{ width: "100%" }}
              value={editSlfValue}
              onChange={setEditSlfValue}
              showSearch
              optionFilterProp="label"
              options={generators.map((g) => ({
                label: `${g.lgu}${g.ownership ? " (" + g.ownership + ")" : ""}`,
                value: g._id,
              })).filter((opt, idx, arr) => arr.findIndex((o) => o.label === opt.label) === idx)}
              notFoundContent={<Empty description="No SLF available" />}
            />
          </div>
        )}
      </Modal>

      {/* Detail Modal */}
      <Modal
        title={null}
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, user: null })}
        footer={<Button onClick={() => setDetailModal({ open: false, user: null })}>Close</Button>}
        width={560}
      >
        {detailModal.user && (() => {
          const u = detailModal.user;
          const statusConfig = { pending: { color: "#fa8c16", bg: "#fff7e6", text: "Pending Approval" }, approved: { color: "#52c41a", bg: "#f6ffed", text: "Approved" }, rejected: { color: "#ff4d4f", bg: isDark ? "rgba(255,77,79,0.1)" : "#fff2f0", text: "Rejected" } };
          const sc = statusConfig[u.status] || statusConfig.pending;
          return (
            <>
              {/* Header Card */}
              <div style={{ textAlign: "center", padding: "24px 16px 16px", background: isDark ? "linear-gradient(135deg, rgba(47,84,235,0.08) 0%, rgba(22,119,255,0.08) 100%)" : "linear-gradient(135deg, #f0f5ff 0%, #e6f7ff 100%)", borderRadius: 12, marginBottom: 16 }}>
                <Avatar size={72} style={{ backgroundColor: "#1a3353", fontSize: 28 }} icon={<UserOutlined />} />
                <div style={{ marginTop: 12 }}>
                  <Text strong style={{ fontSize: 18 }}>{u.firstName} {u.lastName}</Text>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Tag color={statusColor[u.status]} style={{ fontSize: 12, padding: "2px 12px", borderRadius: 12 }}>{sc.text}</Tag>
                </div>
              </div>

              {/* Contact Info */}
              <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
                <Col span={24}>
                  <Card size="small" style={{ borderRadius: 8 }}>
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <MailOutlined style={{ color: "#1890ff", fontSize: 16 }} />
                        <div><Text type="secondary" style={{ fontSize: 11 }}>Email</Text><br /><Text>{u.email}</Text></div>
                      </div>
                      <Divider style={{ margin: "4px 0" }} />
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <PhoneOutlined style={{ color: "#52c41a", fontSize: 16 }} />
                        <div><Text type="secondary" style={{ fontSize: 11 }}>Contact Number</Text><br /><Text>{u.contactNumber || "—"}</Text></div>
                      </div>
                      <Divider style={{ margin: "4px 0" }} />
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <BankOutlined style={{ color: "#722ed1", fontSize: 16 }} />
                        <div><Text type="secondary" style={{ fontSize: 11 }}>Company / LGU</Text><br /><Text>{u.companyName || "—"}</Text></div>
                      </div>
                    </Space>
                  </Card>
                </Col>
              </Row>

              {/* Assignment & Details */}
              <Row gutter={[16, 12]}>
                <Col xs={24} sm={12}>
                  <Card size="small" style={{ borderRadius: 8, height: "100%" }}>
                    <Text type="secondary" style={{ fontSize: 11 }}><EnvironmentOutlined /> Assigned SLF</Text>
                    <div style={{ marginTop: 4 }}>
                      {(() => {
                        const names = Array.isArray(u.assignedSlfName) ? u.assignedSlfName : u.assignedSlfName ? [u.assignedSlfName] : [];
                        return names.length > 0
                          ? names.map((n, i) => <Tag key={i} color="blue" style={{ marginBottom: 2 }}>{n}</Tag>)
                          : <Text strong style={{ fontSize: 13 }}>Not assigned</Text>;
                      })()}
                    </div>
                  </Card>
                </Col>
                <Col xs={24} sm={12}>
                  <Card size="small" style={{ borderRadius: 8, height: "100%" }}>
                    <Text type="secondary" style={{ fontSize: 11 }}><CalendarOutlined /> Registered</Text>
                    <div style={{ marginTop: 4 }}>
                      <Text strong style={{ fontSize: 13 }}>{dayjs(u.createdAt).format("MMM D, YYYY")}</Text>
                      <br /><Text type="secondary" style={{ fontSize: 11 }}>{dayjs(u.createdAt).format("h:mm A")}</Text>
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* Activity Timeline */}
              {(u.approvedAt || u.rejectedReason) && (
                <Card size="small" style={{ borderRadius: 8, marginTop: 12 }} title={<Text strong style={{ fontSize: 13 }}><ClockCircleOutlined /> Activity</Text>}>
                  <Timeline items={[
                    { color: "blue", children: <><Text style={{ fontSize: 12 }}>Registered</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{dayjs(u.createdAt).format("MMM D, YYYY h:mm A")}</Text></> },
                    ...(u.approvedAt ? [{ color: "green", children: <><Text style={{ fontSize: 12 }}>Approved</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{dayjs(u.approvedAt).format("MMM D, YYYY h:mm A")}</Text></> }] : []),
                    ...(u.rejectedReason ? [{ color: "red", children: <><Text style={{ fontSize: 12 }}>Rejected</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{u.rejectedReason}</Text></> }] : []),
                  ]} />
                </Card>
              )}
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
