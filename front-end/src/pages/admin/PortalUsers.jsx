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
} from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";

const { Text, Title } = Typography;
const { Option } = Select;

export default function PortalUsers() {
  const [users, setUsers] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approveModal, setApproveModal] = useState({
    open: false,
    user: null,
  });
  const [selectedSlf, setSelectedSlf] = useState(null);
  const [detailModal, setDetailModal] = useState({ open: false, user: null });
  const [approving, setApproving] = useState(false);

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
    if (!selectedSlf) {
      Swal.fire("Warning", "Please select an SLF to assign.", "warning");
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
      setSelectedSlf(null);
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
      render: (v) => v || <Text type="secondary">Not assigned</Text>,
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
                    setSelectedSlf(null);
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
          <Title level={5} style={{ margin: 0, color: "#1a3353" }}>
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
          setSelectedSlf(null);
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
              placeholder="Select SLF to assign"
              style={{ width: "100%" }}
              value={selectedSlf}
              onChange={setSelectedSlf}
              showSearch
              optionFilterProp="label"
              options={generators
                .map((g) => ({
                  label: `${g.lgu}${g.ownership ? " (" + g.ownership + ")" : ""}`,
                  value: g._id,
                }))}
              notFoundContent={<Empty description="No SLF available" />}
            />
          </div>
        )}
      </Modal>

      {/* Detail Modal */}
      <Modal
        title="Portal User Details"
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, user: null })}
        footer={null}
        width={520}
      >
        {detailModal.user && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Name">
              {detailModal.user.firstName} {detailModal.user.lastName}
            </Descriptions.Item>
            <Descriptions.Item label="Email">
              {detailModal.user.email}
            </Descriptions.Item>
            <Descriptions.Item label="Contact">
              {detailModal.user.contactNumber || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Company/LGU">
              {detailModal.user.companyName || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={statusColor[detailModal.user.status]}>
                {detailModal.user.status?.toUpperCase()}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Assigned SLF">
              {detailModal.user.assignedSlfName || "Not assigned"}
            </Descriptions.Item>
            <Descriptions.Item label="Registered">
              {dayjs(detailModal.user.createdAt).format(
                "MMM D, YYYY h:mm A"
              )}
            </Descriptions.Item>
            {detailModal.user.approvedAt && (
              <Descriptions.Item label="Approved At">
                {dayjs(detailModal.user.approvedAt).format(
                  "MMM D, YYYY h:mm A"
                )}
              </Descriptions.Item>
            )}
            {detailModal.user.rejectedReason && (
              <Descriptions.Item label="Rejection Reason">
                {detailModal.user.rejectedReason}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
