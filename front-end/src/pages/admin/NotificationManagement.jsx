import { useState, useEffect, useCallback, useRef } from "react";
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
  DatePicker,
  Divider,
  Grid,
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
  UserOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";
import { getSocket } from "../../utils/socket";
import { fetchWithCache } from "../../utils/pageCache";

const { Text, Title, Paragraph } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;
const NOTIFICATION_CACHE_KEY = "notification-management-cache";
const NOTIFICATION_CACHE_TTL = 45 * 1000;

const wrapCellStyle = {
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  lineHeight: 1.35,
};

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
  cell_capacity_alert: { label: "Cell Capacity Alert", color: "red" },
  portal_user_email: { label: "Portal User Email", color: "geekblue" },
  submission_revert_followup: { label: "Revert Follow-Up", color: "volcano" },
  submission_temp_deleted: { label: "Temp Deleted", color: "red" },
};

export default function NotificationManagement({ isDark }) {
  const screens = Grid.useBreakpoint();
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
  const [dateRange, setDateRange] = useState(null);

  const fetchNotifications = useCallback(async (page = 1, pageSize = 30, { force = false, silent = false } = {}) => {
    try {
      const params = new URLSearchParams({ page, limit: pageSize });
      if (typeFilter !== "all") params.append("type", typeFilter);
      if (recipientFilter !== "all") params.append("recipient", recipientFilter);
      if (searchText.trim()) params.append("search", searchText.trim());
      if (dateRange?.[0]) params.append("dateFrom", dateRange[0].startOf("day").toISOString());
      if (dateRange?.[1]) params.append("dateTo", dateRange[1].endOf("day").toISOString());
      await fetchWithCache(
        `${NOTIFICATION_CACHE_KEY}-${params.toString()}`,
        () => api.get(`/notifications/all/manage?${params}`).then(({ data }) => data),
        {
          ttl: NOTIFICATION_CACHE_TTL,
          force,
          onStart: () => !silent && setLoading(true),
          onEnd: () => !silent && setLoading(false),
          onData: (data = {}) => {
            setNotifications(data.notifications || []);
            setGlobalUnread(data.unreadCount || 0);
            setPagination((prev) => ({
              ...prev,
              current: data.page || page,
              total: data.total || 0,
            }));
            setLoading(false);
          },
        },
      );
    } catch {
      /* silent */
    }
  }, [typeFilter, recipientFilter, searchText, dateRange]);

  // Initial fetch on mount / filter changes
  useEffect(() => {
    const timer = setTimeout(() => fetchNotifications(), 250);
    return () => clearTimeout(timer);
  }, [fetchNotifications]);

  // Real-time: listen on the existing admin socket connection
  const currentPageRef = useRef(pagination.current);
  const currentPageSizeRef = useRef(pagination.pageSize);
  useEffect(() => {
    currentPageRef.current = pagination.current;
    currentPageSizeRef.current = pagination.pageSize;

    
  }, [pagination.current, pagination.pageSize]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handleLive = () => {
      fetchNotifications(currentPageRef.current, currentPageSizeRef.current, { force: true, silent: true });
    };
    socket.on("notification", handleLive);
    socket.on("data-refresh", handleLive);
    return () => {
      socket.off("notification", handleLive);
      socket.off("data-refresh", handleLive);
    };
  }, [fetchNotifications]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/notifications/${id}`);
      Swal.fire({ icon: "success", title: "Deleted", timer: 1000, showConfirmButton: false });
      fetchNotifications(pagination.current, pagination.pageSize, { force: true });
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
      fetchNotifications(pagination.current, pagination.pageSize, { force: true });
    } catch {
      Swal.fire("Error", "Could not delete notifications", "error");
    }
  };

  const handleMarkRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      fetchNotifications(pagination.current, pagination.pageSize, { force: true });
    } catch { /* silent */ }
  };

  const handleMarkSelectedRead = async () => {
    const ids = selectedRows.length
      ? selectedRows
      : notifications.filter((n) => !n.read).map((n) => n._id);
    if (!ids.length) {
      Swal.fire({ icon: "info", title: "No unread notifications", timer: 1200, showConfirmButton: false });
      return;
    }
    try {
      await api.patch("/notifications/bulk-read", { ids });
      Swal.fire({ icon: "success", title: `${ids.length} notification${ids.length === 1 ? "" : "s"} marked read`, timer: 1500, showConfirmButton: false });
      setSelectedRows([]);
      fetchNotifications(pagination.current, pagination.pageSize, { force: true });
    } catch {
      Swal.fire("Error", "Could not mark notifications as read", "error");
    }
  };

  // Stats from current page
  const unreadCount = notifications.filter((n) => !n.read).length;
  const readCount = notifications.filter((n) => n.read).length;
  const adminCount = notifications.filter((n) => n.recipient === "admin").length;
  const portalCount = notifications.filter((n) => n.recipient !== "admin").length;
  const isCompact = !screens.md;

  const columns = [
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      minWidth: isCompact ? 116 : 150,
      render: (t) => {
        const cfg = TYPE_CONFIG[t] || { label: t, color: "default" };
        return <Tag color={cfg.color} style={{ borderRadius: 4, fontSize: 11, ...wrapCellStyle }}>{cfg.label}</Tag>;
      },
    },
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
      render: (v, r) => (
        <Space direction="vertical" size={2} style={{ width: "100%", ...wrapCellStyle }}>
          <Text strong={!r.read} style={{ fontSize: isCompact ? 11 : 12, ...wrapCellStyle }}>{v}</Text>
          {!r.read && <Badge dot style={{ marginLeft: 6 }} />}
          {isCompact && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.recipient === "admin" ? "Admin" : r.recipient} · {r.read ? "Read" : "Unread"}
            </Text>
          )}
        </Space>
      ),
      width: isCompact ? 130 : 160,
      minWidth: isCompact ? 130 : 160,
      onCell: () => ({ style: { ...wrapCellStyle, maxWidth: isCompact ? 130 : 160 } }),
    },
    {
      title: "Message",
      dataIndex: "message",
      key: "message",
      width: isCompact ? 200 : 240,
      minWidth: isCompact ? 190 : 240,
      onCell: () => ({ style: { ...wrapCellStyle, maxWidth: isCompact ? 200 : 240 } }),
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || "—"}</Text>,
    },
    {
      title: "Recipient",
      dataIndex: "recipient",
      key: "recipient",
      responsive: ["lg"],
      minWidth: 170,
      render: (v) => (
        <Space size={4}>
          {v === "admin" ? <TeamOutlined style={{ color: "#1a3353" }} /> : <UserOutlined style={{ color: "#52c41a" }} />}
          <Text style={{ fontSize: 11, ...wrapCellStyle }}>{v === "admin" ? "Admin" : v}</Text>
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "read",
      key: "read",
      responsive: ["sm"],
      minWidth: 86,
      align: "center",
      render: (read) => read
        ? <Tag color="default" style={{ borderRadius: 4 }}>Read</Tag>
        : <Tag color="blue" style={{ borderRadius: 4 }}>Unread</Tag>,
    },
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      minWidth: isCompact ? 112 : 145,
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      defaultSortOrder: "descend",
      render: (v) => (
        <div>
          <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format("MM/DD/YYYY") : "—"}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{v ? dayjs(v).format("h:mm A") : ""}</Text>
        </div>
      ),
    },
    {
      title: "Action",
      key: "action",
      minWidth: 112,
      align: "center",
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
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ marginBottom: 4, color: isDark ? "#7eb8da" : "#1a3353" }}>
          Notification Management
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Review, filter, mark read, and audit system notifications across admin and portal activity.
        </Paragraph>
      </div>

      {/* Summary Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #1677ff", borderRadius: 8, minHeight: 82 }}>
            <Statistic title="Rows in Table" value={notifications.length} valueStyle={{ fontSize: 20, color: "#1677ff" }} prefix={<BellOutlined />} />
            <Text type="secondary" style={{ fontSize: 11 }}>{pagination.total} matching records</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #fa8c16", borderRadius: 8, minHeight: 82 }}>
            <Statistic title="Unread Rows" value={unreadCount} valueStyle={{ fontSize: 20, color: "#fa8c16" }} prefix={<ExclamationCircleOutlined />} />
            <Text type="secondary" style={{ fontSize: 11 }}>{globalUnread} unread admin alerts</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #52c41a", borderRadius: 8, minHeight: 82 }}>
            <Statistic title="Read Rows" value={readCount} valueStyle={{ fontSize: 20, color: "#52c41a" }} prefix={<CheckCircleOutlined />} />
            <Text type="secondary" style={{ fontSize: 11 }}>Visible read notifications</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #1a3353", borderRadius: 8, minHeight: 82 }}>
            <Statistic title="Recipients" value={`${adminCount}/${portalCount}`} valueStyle={{ fontSize: 20, color: "#1a3353" }} prefix={<TeamOutlined />} />
            <Text type="secondary" style={{ fontSize: 11 }}>Admin / Portal rows</Text>
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
                onPressEnter={() => fetchNotifications(1, pagination.pageSize, { force: true })}
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
              <RangePicker value={dateRange} onChange={setDateRange} allowClear style={{ width: 260 }} />
              <Button icon={<ReloadOutlined />} onClick={() => fetchNotifications(1, pagination.pageSize, { force: true })}>
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
              <Popconfirm
                title={selectedRows.length ? "Mark selected notifications as read?" : "Mark all visible unread notifications as read?"}
                onConfirm={handleMarkSelectedRead}
                okText="Mark Read"
              >
                <Button icon={<ClearOutlined />} size="small">
                  Mark Read {selectedRows.length ? `(${selectedRows.length})` : "(Visible)"}
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
          scroll={{ x: isCompact ? 620 : "max-content" }}
          rowSelection={{
            selectedRowKeys: selectedRows,
            onChange: setSelectedRows,
          }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            pageSizeOptions: ["10", "15", "30", "50", "100"],
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total}`,
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
        width={760}
        destroyOnClose
      >
        {selectedNotif && (
          <div>
            <Card
              size="small"
              style={{ borderRadius: 8, marginBottom: 12, background: isDark ? "#1f1f1f" : "#f7f9fc" }}
            >
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Space wrap>
                  {(() => {
                    const cfg = TYPE_CONFIG[selectedNotif.type] || { label: selectedNotif.type, color: "default" };
                    return <Tag color={cfg.color}>{cfg.label}</Tag>;
                  })()}
                  {selectedNotif.read ? <Tag>Read</Tag> : <Tag color="blue">Unread</Tag>}
                  <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(selectedNotif.createdAt).format("MMM D, YYYY h:mm A")}</Text>
                </Space>
                <Text strong style={{ fontSize: 16, lineHeight: 1.35 }}>{selectedNotif.title}</Text>
                <Text style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{selectedNotif.message || "—"}</Text>
              </Space>
            </Card>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }} style={{ marginTop: 8 }}>
              <Descriptions.Item label="Recipient">
                <Space size={4}>
                  {selectedNotif.recipient === "admin" ? <TeamOutlined /> : <UserOutlined />}
                  {selectedNotif.recipient === "admin" ? "Admin" : selectedNotif.recipient}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Notification ID">
                <Text copyable style={{ fontSize: 12 }}>{selectedNotif._id}</Text>
              </Descriptions.Item>
            </Descriptions>
            {selectedNotif.meta && (
              <>
                <Divider style={{ margin: "14px 0 8px" }}>Metadata</Divider>
                <pre style={{ fontSize: 11, margin: 0, maxHeight: 220, overflow: "auto", background: isDark ? "#141414" : "#f5f5f5", padding: 10, borderRadius: 6, whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(selectedNotif.meta, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
