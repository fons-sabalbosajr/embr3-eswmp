import { useState, useEffect } from "react";
import {
  Card,
  Table,
  Tag,
  Typography,
  Space,
  Modal,
  Badge,
  Empty,
  Tooltip,
  Button,
  Input,
  Select,
  Divider,
  Popconfirm,
  Row,
  Col,
  Statistic,
  Avatar,
  Timeline,
} from "antd";
import {
  EyeOutlined,
  DeleteOutlined,
  MessageOutlined,
  CustomerServiceOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  SyncOutlined,
  SendOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";

const { Text, Title } = Typography;
const { Option } = Select;

const STATUS_CONFIG = {
  open: { color: "blue", icon: <ExclamationCircleOutlined />, label: "Open" },
  in_progress: { color: "orange", icon: <SyncOutlined spin />, label: "In Progress" },
  resolved: { color: "green", icon: <CheckCircleOutlined />, label: "Resolved" },
  closed: { color: "default", icon: <ClockCircleOutlined />, label: "Closed" },
};

const PRIORITY_CONFIG = {
  Low: { color: "#8c8c8c", bg: "#fafafa" },
  Medium: { color: "#d4b106", bg: "#fffbe6" },
  High: { color: "#d46b08", bg: "#fff7e6" },
  Urgent: { color: "#cf1322", bg: "#fff1f0" },
};

export default function SupportTab({ isDark }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 15, total: 0 });
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async (page = 1, pageSize = 15) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: pageSize });
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (searchText.trim()) params.append("search", searchText.trim());
      const { data } = await api.get(`/support-tickets?${params}`);
      setTickets(data.tickets || data);
      setPagination((prev) => ({
        ...prev,
        current: data.page || page,
        total: data.total || (data.tickets || data).length,
      }));
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await api.patch(`/support-tickets/${id}/status`, { status });
      Swal.fire({ icon: "success", title: "Status Updated", timer: 1200, showConfirmButton: false });
      fetchTickets(pagination.current, pagination.pageSize);
      if (selectedTicket?._id === id) {
        setSelectedTicket((prev) => ({ ...prev, status }));
      }
    } catch {
      Swal.fire("Error", "Could not update ticket status", "error");
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    setReplying(true);
    try {
      const { data } = await api.post(`/support-tickets/${selectedTicket._id}/reply`, {
        message: replyText,
      });
      setSelectedTicket(data.data || data);
      setReplyText("");
      fetchTickets(pagination.current, pagination.pageSize);
      Swal.fire({ icon: "success", title: "Reply Sent", timer: 1000, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Could not send reply", "error");
    } finally {
      setReplying(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/support-tickets/${id}`);
      Swal.fire({ icon: "success", title: "Ticket Deleted", timer: 1200, showConfirmButton: false });
      if (selectedTicket?._id === id) {
        setDetailOpen(false);
        setSelectedTicket(null);
      }
      fetchTickets(pagination.current, pagination.pageSize);
    } catch {
      Swal.fire("Error", "Could not delete ticket", "error");
    }
  };

  // Stats
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter((t) => t.status === "in_progress").length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;
  const closedCount = tickets.filter((t) => t.status === "closed").length;

  const columns = [
    {
      title: "Ticket No.",
      dataIndex: "ticketNo",
      key: "ticketNo",
      width: 120,
      render: (v) => (
        <Text strong style={{ fontFamily: "monospace", fontSize: 12, color: "#1a3353" }}>{v}</Text>
      ),
    },
    {
      title: "Subject",
      dataIndex: "subject",
      key: "subject",
      ellipsis: true,
      render: (v, r) => (
        <div>
          <Text strong style={{ fontSize: 13 }}>{v}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{r.companyName || r.slfName || "—"}</Text>
        </div>
      ),
    },
    {
      title: "Category",
      dataIndex: "category",
      key: "category",
      width: 150,
      render: (v) => <Tag style={{ borderRadius: 4 }}>{v}</Tag>,
      filters: [
        { text: "Technical Issue", value: "Technical Issue" },
        { text: "Data Correction", value: "Data Correction" },
        { text: "Account Access", value: "Account Access" },
        { text: "Submission Concern", value: "Submission Concern" },
        { text: "General Inquiry", value: "General Inquiry" },
        { text: "Feature Request", value: "Feature Request" },
        { text: "Other", value: "Other" },
      ],
      onFilter: (value, record) => record.category === value,
    },
    {
      title: "Priority",
      dataIndex: "priority",
      key: "priority",
      width: 100,
      align: "center",
      render: (v) => {
        const cfg = PRIORITY_CONFIG[v] || PRIORITY_CONFIG.Low;
        return (
          <Tag style={{ borderRadius: 4, background: cfg.bg, color: cfg.color, borderColor: cfg.color }}>
            {v}
          </Tag>
        );
      },
      filters: [
        { text: "Low", value: "Low" },
        { text: "Medium", value: "Medium" },
        { text: "High", value: "High" },
        { text: "Urgent", value: "Urgent" },
      ],
      onFilter: (value, record) => record.priority === value,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      align: "center",
      render: (v) => {
        const cfg = STATUS_CONFIG[v] || STATUS_CONFIG.open;
        return (
          <Tag icon={cfg.icon} color={cfg.color} style={{ borderRadius: 4 }}>
            {cfg.label}
          </Tag>
        );
      },
    },
    {
      title: "Submitted By",
      dataIndex: "portalUserEmail",
      key: "submittedBy",
      width: 200,
      ellipsis: true,
      render: (v, r) => (
        <div>
          <Text style={{ fontSize: 12 }}>{r.portalUserName || "—"}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text>
        </div>
      ),
    },
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 140,
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
      title: "Replies",
      key: "replies",
      width: 70,
      align: "center",
      render: (_, r) =>
        (r.replies?.length || 0) > 0 ? (
          <Badge count={r.replies.length} style={{ backgroundColor: "#1a3353" }} />
        ) : (
          <Text type="secondary">0</Text>
        ),
    },
    {
      title: "Action",
      key: "action",
      width: 100,
      align: "center",
      fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View / Reply">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined style={{ color: "#1677ff" }} />}
              onClick={() => { setSelectedTicket(r); setDetailOpen(true); setReplyText(""); }}
            />
          </Tooltip>
          <Popconfirm title="Delete this ticket?" onConfirm={() => handleDelete(r._id)} okText="Delete" okButtonProps={{ danger: true }}>
            <Tooltip title="Delete">
              <Button type="text" size="small" icon={<DeleteOutlined style={{ color: "#ff4d4f" }} />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const ticket = selectedTicket;

  return (
    <>
      {/* Summary Stats */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #1677ff", borderRadius: 8 }}>
            <Statistic title="Open" value={openCount} valueStyle={{ color: "#1677ff", fontSize: 22 }} prefix={<ExclamationCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #fa8c16", borderRadius: 8 }}>
            <Statistic title="In Progress" value={inProgressCount} valueStyle={{ color: "#fa8c16", fontSize: 22 }} prefix={<SyncOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #52c41a", borderRadius: 8 }}>
            <Statistic title="Resolved" value={resolvedCount} valueStyle={{ color: "#52c41a", fontSize: 22 }} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderLeft: "3px solid #8c8c8c", borderRadius: 8 }}>
            <Statistic title="Closed" value={closedCount} valueStyle={{ color: "#8c8c8c", fontSize: 22 }} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* Toolbar */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="auto">
            <Space wrap>
              <Input
                placeholder="Search tickets..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onPressEnter={() => fetchTickets(1, pagination.pageSize)}
                style={{ width: 240 }}
                allowClear
              />
              <Select
                value={statusFilter}
                onChange={(v) => { setStatusFilter(v); }}
                style={{ width: 150 }}
              >
                <Option value="all">All Status</Option>
                <Option value="open">Open</Option>
                <Option value="in_progress">In Progress</Option>
                <Option value="resolved">Resolved</Option>
                <Option value="closed">Closed</Option>
              </Select>
              <Button icon={<ReloadOutlined />} onClick={() => fetchTickets(1, pagination.pageSize)}>
                Search
              </Button>
            </Space>
          </Col>
          <Col>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Total: <Text strong>{pagination.total}</Text> tickets
            </Text>
          </Col>
        </Row>
      </Card>

      {/* Table */}
      <Card style={{ borderRadius: 8 }}>
        <Table
          dataSource={tickets}
          columns={columns}
          rowKey="_id"
          loading={loading}
          size="small"
          scroll={{ x: 1200 }}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}–${range[1]} of ${total} tickets`,
            onChange: (page, pageSize) => fetchTickets(page, pageSize),
          }}
          locale={{ emptyText: <Empty description="No support tickets found" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>

      {/* ── Ticket Detail Modal ── */}
      <Modal
        title={null}
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setSelectedTicket(null); setReplyText(""); }}
        footer={null}
        width={780}
        styles={{ body: { padding: 0 } }}
        destroyOnClose
      >
        {ticket && (
          <div>
            {/* Header */}
            <div style={{
              background: "linear-gradient(135deg, #1a3353 0%, #2d5f8a 100%)",
              padding: "24px 28px 20px",
              borderRadius: "8px 8px 0 0",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "monospace" }}>
                    {ticket.ticketNo}
                  </Text>
                  <Title level={4} style={{ color: "#fff", margin: "4px 0 8px", fontWeight: 600 }}>
                    {ticket.subject}
                  </Title>
                  <Space size={8}>
                    {(() => {
                      const cfg = STATUS_CONFIG[ticket.status] || STATUS_CONFIG.open;
                      return <Tag icon={cfg.icon} color={cfg.color}>{cfg.label}</Tag>;
                    })()}
                    {(() => {
                      const cfg = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.Low;
                      return <Tag style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.color }}>{ticket.priority} Priority</Tag>;
                    })()}
                    <Tag>{ticket.category}</Tag>
                  </Space>
                </div>
                <Select
                  value={ticket.status}
                  onChange={(v) => handleStatusChange(ticket._id, v)}
                  size="small"
                  style={{ width: 140 }}
                  popupMatchSelectWidth={false}
                >
                  <Option value="open">Open</Option>
                  <Option value="in_progress">In Progress</Option>
                  <Option value="resolved">Resolved</Option>
                  <Option value="closed">Closed</Option>
                </Select>
              </div>
            </div>

            {/* Info Bar */}
            <div style={{ padding: "16px 28px", background: isDark ? "#1f1f1f" : "#fafafa", borderBottom: "1px solid #f0f0f0" }}>
              <Row gutter={24}>
                <Col>
                  <Text type="secondary" style={{ fontSize: 11, display: "block" }}>Submitted By</Text>
                  <Space size={6}>
                    <Avatar size={20} icon={<UserOutlined />} style={{ background: "#1a3353" }} />
                    <Text style={{ fontSize: 13 }}>{ticket.portalUserName || ticket.portalUserEmail}</Text>
                  </Space>
                </Col>
                <Col>
                  <Text type="secondary" style={{ fontSize: 11, display: "block" }}>Company / SLF</Text>
                  <Text style={{ fontSize: 13 }}>{ticket.companyName || ticket.slfName || "—"}</Text>
                </Col>
                <Col>
                  <Text type="secondary" style={{ fontSize: 11, display: "block" }}>Created</Text>
                  <Text style={{ fontSize: 13 }}>{dayjs(ticket.createdAt).format("MMM D, YYYY h:mm A")}</Text>
                </Col>
                {ticket.resolvedAt && (
                  <Col>
                    <Text type="secondary" style={{ fontSize: 11, display: "block" }}>Resolved</Text>
                    <Text style={{ fontSize: 13 }}>{dayjs(ticket.resolvedAt).format("MMM D, YYYY h:mm A")}</Text>
                  </Col>
                )}
              </Row>
            </div>

            {/* Content */}
            <div style={{ padding: "20px 28px", maxHeight: 420, overflowY: "auto" }}>
              {/* Original Message */}
              <div style={{
                background: isDark ? "#262626" : "#f8f9fa",
                padding: "16px 20px",
                borderRadius: 8,
                border: `1px solid ${isDark ? "#303030" : "#e8e8e8"}`,
                marginBottom: 20,
              }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                  <Avatar size={28} icon={<UserOutlined />} style={{ background: "#52c41a", marginRight: 10 }} />
                  <div>
                    <Text strong style={{ fontSize: 13, display: "block" }}>{ticket.portalUserName || "Portal User"}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(ticket.createdAt).format("MMM D, YYYY h:mm A")}</Text>
                  </div>
                </div>
                <Text style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{ticket.message}</Text>
              </div>

              {/* Conversation Thread */}
              {ticket.replies?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <Divider style={{ margin: "0 0 16px", fontSize: 12 }}>
                    <Space><MessageOutlined /> Conversation ({ticket.replies.length})</Space>
                  </Divider>
                  <Timeline
                    items={ticket.replies.map((r, i) => ({
                      key: i,
                      color: r.isAdmin ? "#1677ff" : "#52c41a",
                      dot: (
                        <Avatar
                          size={24}
                          icon={r.isAdmin ? <SafetyCertificateOutlined /> : <UserOutlined />}
                          style={{ background: r.isAdmin ? "#1677ff" : "#52c41a", fontSize: 12 }}
                        />
                      ),
                      children: (
                        <div style={{
                          background: isDark
                            ? (r.isAdmin ? "#111d2c" : "#162312")
                            : (r.isAdmin ? "#e6f4ff" : "#f6ffed"),
                          padding: "12px 16px",
                          borderRadius: 8,
                          border: `1px solid ${r.isAdmin ? "#91caff" : "#b7eb8f"}`,
                          marginBottom: 4,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <Text strong style={{ fontSize: 12, color: r.isAdmin ? "#1677ff" : "#52c41a" }}>
                              {r.isAdmin ? "Admin" : r.repliedByName || r.repliedBy || "Portal User"}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {dayjs(r.createdAt).format("MMM D, YYYY h:mm A")}
                            </Text>
                          </div>
                          <Text style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{r.message}</Text>
                        </div>
                      ),
                    }))}
                  />
                </div>
              )}
            </div>

            {/* Reply Box */}
            {ticket.status !== "closed" && (
              <div style={{
                padding: "16px 28px 24px",
                borderTop: `1px solid ${isDark ? "#303030" : "#f0f0f0"}`,
                background: isDark ? "#1f1f1f" : "#fafafa",
                borderRadius: "0 0 8px 8px",
              }}>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 8, color: "#1a3353" }}>
                  <MessageOutlined style={{ marginRight: 6 }} /> Admin Reply
                </Text>
                <Input.TextArea
                  rows={3}
                  placeholder="Type your reply to the portal user..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  style={{ borderRadius: 6, marginBottom: 10 }}
                  onPressEnter={(e) => { if (e.ctrlKey && replyText.trim()) handleReply(); }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Press Ctrl+Enter to send</Text>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    style={{ background: "#1a3353", borderColor: "#1a3353", borderRadius: 6 }}
                    loading={replying}
                    disabled={!replyText.trim()}
                    onClick={handleReply}
                  >
                    Send Reply
                  </Button>
                </div>
              </div>
            )}

            {ticket.status === "closed" && (
              <div style={{
                padding: "12px 28px 20px",
                borderTop: `1px solid ${isDark ? "#303030" : "#f0f0f0"}`,
                textAlign: "center",
              }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />
                  This ticket is closed. Change status to reopen the conversation.
                </Text>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
