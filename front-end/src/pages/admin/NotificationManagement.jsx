import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Tag,
  Typography,
  Space,
  Badge,
  Empty,
  Tooltip,
  Button,
  Input,
  Select,
  Row,
  Col,
  Statistic,
  Popconfirm,
  Modal,
  Descriptions,
} from "antd";
import {
  BellOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  EyeOutlined,
  SearchOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
  ClearOutlined,
  InboxOutlined,
  UserOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";

const { Text } = Typography;
const { Option } = Select;

const TYPE_CONFIG = {
  new_submission: { label: "New Submission", color: "blue" },
  resubmission: { label: "Resubmission", color: "cyan" },
  status_change: { label: "Status Change", color: "geekblue" },
  reverted: { label: "Reverted", color: "orange" },
  new_portal_user: { label: "New Portal User", color: "purple" },
  baseline_update_request: { label: "Baseline Update Request", color: "gold" },
  baseline_update_approved: { label: "Baseline Approved", color: "green" },
  support_ticket: { label: "Support Ticket", color: "magenta" },
  support_ticket_reply: { label: "Support Reply", color: "lime" },
  submission_edit_request: { label: "Edit Request", color: "volcano" },
  submission_edit_approved: { label: "Edit Approved", color: "green" },
  submission_edit_rejected: { label: "Edit Rejected", color: "red" },
};

export default function NotificationManagement({ isDark }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 30, total: 0 });
  const [typeFilter, setTypeFilter] = useState("all");
  const [recipientFilter, setRecipientFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [selectedRows, setSelectedRows] = useState([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedNotif, setSelectedNotif] = useState(null);
  const [globalUnread, setGlobalUnread] = useState(0);

  const fetchNotifications = useCallback(async (page = 1, pageSize = 30) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: pageSize });
      if (typeFilter !== "all") params.append("type", typeFilter);
      if (recipientFilter !== "all") params.append("recipient", recipientFilter);
      if (searchText.trim()) params.append("search", searchText.trim());
      const { data } = await api.get(`/notifications/all/manage?${params}`);
      setNotifications(data.notifications || []);
      setGlobalUnread(data.unreadCount || 0);
      setPagination((prev) => ({
        ...prev,
        current: data.page || page,
        total: data.total || 0,
      }));
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [typeFilter, recipientFilter, searchText]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      Swal.fire({ icon: "success", title: "Deleted", timer: 1000, showConfirmButton: false });
      fetchNotifications(pagination.current, pagination.pageSize);
    } catch {
      Swal.fire("Error", "Could not delete notification", "error");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedRows.length === 0) return;
    try {
      await api.post("/notifications/bulk-delete", { ids: selectedRows });
      Swal.fire({ icon: "success", title: `${selectedRows.length} Deleted`, timer: 1200, showConfirmButton: false });
      setSelectedRows([]);
      fetchNotifications(pagination.current, pagination.pageSize);
    } catch {
      Swal.fire("Error", "Could not delete notifications", "error");
    }
  };

  const handleMarkRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      fetchNotifications(pagination.current, pagination.pageSize);
    } catch { /* silent */ }
  };

  const handleClearAdminRead = async () => {
    try {
      const { data } = await api.delete("/notifications/admin/clear-read");
      Swal.fire({ icon: "success", title: `Cleared ${data.deleted || 0} read notifications`, timer: 1500, showConfirmButton: false });
      fetchNotifications(pagination.current, pagination.pageSize);
    } catch {
      Swal.fire("Error", "Could not clear notifications", "error");
    }
  };

  // Stats from current page
  const unreadCount = notifications.filter((n) => !n.read).length;
  const adminCount = notifications.filter((n) => n.recipient === "admin").length;
  const portalCount = notifications.filter((n) => n.recipient !== "admin").length;

  const columns = [
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      width: 180,
      render: (t) => {
        const cfg = TYPE_CONFIG[t] || { label: t, color: "default" };
        return <Tag color={cfg.color} style={{ borderRadius: 4 }}>{cfg.label}</Tag>;
      },
    },
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (v, r) => (
        <div>
          <Text strong={!r.read} style={{ fontSize: 13 }}>{v}</Text>
          {!r.read && <Badge dot style={{ marginLeft: 6 }} />}
        </div>
      ),
    },
    {
      title: "Message",
      dataIndex: "message",
      key: "message",
      ellipsis: true,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Text>,
    },
    {
      title: "Recipient",
      dataIndex: "recipient",
      key: "recipient",
      width: 180,
      render: (v) => (
        <Space size={4}>
          {v === "admin" ? <TeamOutlined style={{ color: "#1a3353" }} /> : <UserOutlined style={{ color: "#52c41a" }} />}
          <Text style={{ fontSize: 12 }}>{v === "admin" ? "Admin" : v}</Text>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "read",
      key: "read",
      width: 90,
      align: "center",
      render: (read) => read
        ? <Tag color="default" style={{ borderRadius: 4 }}>Read</Tag>
        : <Tag color="blue" style={{ borderRadius: 4 }}>Unread</Tag>,
    },
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 150,
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      defaultSortOrder: "descend",
      render: (v) => (
        <div>
          <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format("MMM D, YYYY") : "—"}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{v ? dayjs(v).format("h:mm A") : ""}</Text>
        </div>
      ),
    },
    {
      title: "Action",
      key: "action",
      width: 120,
      align: "center",
      fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View Detail">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined style={{ color: "#1677ff" }} />}
              onClick={() => {
                setSelectedNotif(r);
                setDetailOpen(true);
                if (!r.read) handleMarkRead(r._id);
              }}
            />
          </Tooltip>
          {!r.read && (
            <Tooltip title="Mark as Read">
              <Button
                type="text"
                size="small"
                icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />}
                onClick={() => handleMarkRead(r._id)}
              />
            </Tooltip>
          )}
          <Popconfirm title="Delete this notification?" onConfirm={() => handleDelete(r._id)} okText="Delete" okButtonProps={{ danger: true }}>
            <Tooltip title="Delete">
              <Button type="text" size="small" icon={<DeleteOutlined style={{ color: "#ff4d4f" }} />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {/* Summary Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #1677ff", borderRadius: 8 }}>
            <Statistic title="Total" value={pagination.total} valueStyle={{ fontSize: 22, color: "#1677ff" }} prefix={<BellOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #fa8c16", borderRadius: 8 }}>
            <Statistic title="Unread (All)" value={globalUnread} valueStyle={{ fontSize: 22, color: "#fa8c16" }} prefix={<ExclamationCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #1a3353", borderRadius: 8 }}>
            <Statistic title="Admin (This Page)" value={adminCount} valueStyle={{ fontSize: 22, color: "#1a3353" }} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #52c41a", borderRadius: 8 }}>
            <Statistic title="Portal (This Page)" value={portalCount} valueStyle={{ fontSize: 22, color: "#52c41a" }} prefix={<UserOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* Toolbar */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Input
                placeholder="Search notifications..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onPressEnter={() => fetchNotifications(1, pagination.pageSize)}
                style={{ width: 220 }}
                allowClear
              />
              <Select value={typeFilter} onChange={setTypeFilter} style={{ width: 200 }}>
                <Option value="all">All Types</Option>
                {Object.entries(TYPE_CONFIG).map(([k, v]) => (
                  <Option key={k} value={k}>{v.label}</Option>
                ))}
              </Select>
              <Select value={recipientFilter} onChange={setRecipientFilter} style={{ width: 150 }}>
                <Option value="all">All Recipients</Option>
                <Option value="admin">Admin</Option>
              </Select>
              <Button icon={<ReloadOutlined />} onClick={() => fetchNotifications(1, pagination.pageSize)}>
                Search
              </Button>
            </Space>
          </Col>
          <Col>
            <Space>
              {selectedRows.length > 0 && (
                <Popconfirm
                  title={`Delete ${selectedRows.length} selected notifications?`}
                  onConfirm={handleBulkDelete}
                  okText="Delete All"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger icon={<DeleteOutlined />} size="small">
                    Delete Selected ({selectedRows.length})
                  </Button>
                </Popconfirm>
              )}
              <Popconfirm title="Clear all read admin notifications?" onConfirm={handleClearAdminRead} okText="Clear">
                <Button icon={<ClearOutlined />} size="small">
                  Clear Read (Admin)
                </Button>
              </Popconfirm>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Table */}
      <Card style={{ borderRadius: 8 }}>
        <Table
          dataSource={notifications}
          columns={columns}
          rowKey="_id"
          loading={loading}
          size="small"
          scroll={{ x: 1100 }}
          rowSelection={{
            selectedRowKeys: selectedRows,
            onChange: setSelectedRows,
          }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            pageSizeOptions: ["15", "30", "50", "100"],
            showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`,
            onChange: (page, pageSize) => {
              setSelectedRows([]);
              fetchNotifications(page, pageSize);
            },
          }}
          locale={{ emptyText: <Empty description="No notifications found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>

      {/* Detail Modal */}
      <Modal
        title={
          <Space>
            <BellOutlined style={{ color: "#1a3353" }} />
            <span>Notification Detail</span>
          </Space>
        }
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setSelectedNotif(null); }}
        footer={[
          <Button key="close" onClick={() => { setDetailOpen(false); setSelectedNotif(null); }}>
            Close
          </Button>,
          selectedNotif && (
            <Popconfirm key="del" title="Delete this notification?" onConfirm={() => { handleDelete(selectedNotif._id); setDetailOpen(false); setSelectedNotif(null); }}>
              <Button danger icon={<DeleteOutlined />}>Delete</Button>
            </Popconfirm>
          ),
        ]}
        width={600}
        destroyOnClose
      >
        {selectedNotif && (
          <Descriptions bordered size="small" column={1} style={{ marginTop: 8 }}>
            <Descriptions.Item label="Type">
              {(() => {
                const cfg = TYPE_CONFIG[selectedNotif.type] || { label: selectedNotif.type, color: "default" };
                return <Tag color={cfg.color}>{cfg.label}</Tag>;
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="Title">
              <Text strong>{selectedNotif.title}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Message">
              {selectedNotif.message || "—"}
            </Descriptions.Item>
            <Descriptions.Item label="Recipient">
              <Space size={4}>
                {selectedNotif.recipient === "admin" ? <TeamOutlined /> : <UserOutlined />}
                {selectedNotif.recipient === "admin" ? "Admin" : selectedNotif.recipient}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              {selectedNotif.read
                ? <Tag color="default">Read</Tag>
                : <Tag color="blue">Unread</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Date">
              {dayjs(selectedNotif.createdAt).format("MMM D, YYYY h:mm:ss A")}
            </Descriptions.Item>
            {selectedNotif.meta && (
              <Descriptions.Item label="Meta Data">
                <pre style={{ fontSize: 11, margin: 0, maxHeight: 150, overflow: "auto", background: "#f5f5f5", padding: 8, borderRadius: 4 }}>
                  {JSON.stringify(selectedNotif.meta, null, 2)}
                </pre>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </>
  );
}
