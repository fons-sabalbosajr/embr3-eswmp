import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Button,
  Tag,
  Space,
  Typography,
  Card,
  Select,
  Input,
  Modal,
  Row,
  Col,
  Form,
  Tooltip,
  Empty,
  Avatar,
  Divider,
  Timeline,
  Statistic,
  Alert,
  Image,
} from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  EyeOutlined,
  DeleteOutlined,
  SendOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ToolOutlined,
  CustomerServiceOutlined,
  UserOutlined,
  MailOutlined,
  ExclamationCircleOutlined,
  BankOutlined,
  TagsOutlined,
  PaperClipOutlined,
  WarningOutlined,
  FilePdfOutlined,
  FileOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";
import secureStorage from "../../utils/secureStorage";
import { getAdminDisplayName } from "../../utils/adminIdentity";
import { getSocket } from "../../utils/socket";
import ResponsiveTable from "./shared/ResponsiveTable";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// Extract a Google Drive file ID from any of the common Drive URL shapes so an
// image can be rendered from a direct thumbnail endpoint (webViewLink pages do
// not load inside <img>).
function driveIdFromUrl(url) {
  if (!url) return null;
  const s = String(url);
  const m =
    s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Renders a single image attachment with graceful failure handling. If the
// underlying Drive file is missing, trashed, or permission-restricted the
// thumbnail request fails and a clear prompt is shown instead of a broken icon.
function AttachmentImage({ att, index }) {
  const [errored, setErrored] = useState(false);
  const driveId = att.fileId || driveIdFromUrl(att.url);
  const isDrive = !!driveId && att.storage !== "local";
  const thumbSrc = isDrive ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w400` : att.url;
  const fullSrc = isDrive ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w1600` : att.url;

  if (errored) {
    return (
      <div
        style={{
          width: 110,
          height: 110,
          borderRadius: 10,
          border: "1.5px dashed #ffbfbf",
          background: "#fff1f0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          padding: 6,
          textAlign: "center",
        }}
      >
        <WarningOutlined style={{ color: "#cf1322", fontSize: 18 }} />
        <span style={{ fontSize: 10, color: "#cf1322", lineHeight: 1.2 }}>
          File not accessible
        </span>
        <a href={att.url} target="_blank" rel="noreferrer" style={{ fontSize: 10 }}>
          Try open ↗
        </a>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <Image
        src={thumbSrc}
        alt={att.name || `screenshot-${index + 1}`}
        width={110}
        height={110}
        preview={{ src: fullSrc }}
        onError={() => setErrored(true)}
        style={{
          objectFit: "cover",
          borderRadius: 10,
          border: "1.5px solid #e0e0e0",
          cursor: "zoom-in",
          boxShadow: "0 1px 6px rgba(0,0,0,0.10)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 4,
          left: 4,
          right: 4,
          background: "rgba(0,0,0,0.45)",
          borderRadius: 6,
          padding: "1px 4px",
          fontSize: 10,
          color: "#fff",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {att.name || `Image ${index + 1}`}
      </div>
    </div>
  );
}

const STATUS_META = {
  open: { color: "red", label: "Open", icon: <ExclamationCircleOutlined /> },
  in_progress: { color: "gold", label: "In Progress", icon: <ClockCircleOutlined /> },
  resolved: { color: "green", label: "Resolved", icon: <CheckCircleOutlined /> },
  closed: { color: "default", label: "Closed", icon: <CloseCircleOutlined /> },
};

const PRIORITY_META = {
  Low: { color: "blue" },
  Medium: { color: "gold" },
  High: { color: "orange" },
  Urgent: { color: "red" },
};

// Category-aware guidance so admins know where to go to actually fix the issue.
const CATEGORY_GUIDE = {
  "Technical Issue": "Reproduce the issue and reply with steps or a fix. Check App Logs (Developer → System & Logs) if needed.",
  "Data Correction": "Open the Submissions tab to locate and correct the affected entry, then reply to confirm.",
  "Account Access": "Use App Settings → Portal Users Security to reset password, unblock, or clear holds.",
  "Account Issue": "Review the user in App Settings → Portal Users Security and adjust their account state.",
  "Requirements / Compliance": "Confirm compliance requirements and reply with the official guidance.",
  "Submission Concern": "Open the Submissions tab to review the related submission and respond.",
  "General Inquiry": "Reply with the requested information.",
  "Feature Request": "Acknowledge the request and log it for the development backlog.",
  Other: "Review the details and reply with the appropriate resolution.",
};

export default function SupportTickets({ canEdit = true }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [detail, setDetail] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const fetchingRef = useRef(false);

  const currentUser = secureStorage.getJSON("user") || {};
  const actorName = getAdminDisplayName(currentUser) || currentUser?.email || "admin";

  const fetchTickets = useCallback(async ({ silent = false } = {}) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get("/support-tickets", {
        params: { limit: 200 },
      });
      setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
    } catch {
      if (!silent) Swal.fire("Error", "Could not load support tickets", "error");
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTickets();
    const interval = setInterval(() => fetchTickets({ silent: true }), 60000);
    return () => clearInterval(interval);
  }, [fetchTickets]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      if (!target || target === "tickets") fetchTickets({ silent: true });
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [fetchTickets]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const summary = useMemo(() => {
    const acc = { open: 0, in_progress: 0, resolved: 0, closed: 0, urgent: 0 };
    tickets.forEach((t) => {
      acc[t.status] = (acc[t.status] || 0) + 1;
      if (t.priority === "Urgent" && (t.status === "open" || t.status === "in_progress"))
        acc.urgent += 1;
    });
    return acc;
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (!debouncedSearch) return true;
      return [
        t.ticketNo,
        t.subject,
        t.portalUserEmail,
        t.portalUserName,
        t.companyName,
        t.slfName,
        t.category,
      ].some((v) => String(v || "").toLowerCase().includes(debouncedSearch));
    });
  }, [tickets, statusFilter, priorityFilter, debouncedSearch]);

  const openDetail = useCallback(async (record) => {
    setReplyText("");
    setDetail(record);
    try {
      const { data } = await api.get(`/support-tickets/${record._id}`);
      if (data?._id) setDetail(data);
    } catch {
      /* keep the row data already shown */
    }
  }, []);

  const updateLocalTicket = useCallback((updated) => {
    if (!updated?._id) return;
    setTickets((prev) => prev.map((t) => (t._id === updated._id ? updated : t)));
    setDetail((prev) => (prev && prev._id === updated._id ? updated : prev));
  }, []);

  const handleReply = useCallback(
    async ({ resolve = false } = {}) => {
      if (!detail) return;
      const message = replyText.trim();
      if (!message) {
        Swal.fire("Reply required", "Please type a reply before sending.", "info");
        return;
      }
      setActionLoading(true);
      try {
        const { data } = await api.post(`/support-tickets/${detail._id}/reply`, {
          message,
          repliedBy: actorName,
          repliedByName: actorName,
          isAdmin: true,
        });
        let updated = data?.data || detail;
        if (resolve) {
          const { data: statusData } = await api.patch(
            `/support-tickets/${detail._id}/status`,
            { status: "resolved", updatedBy: actorName },
          );
          updated = statusData?.data || updated;
        }
        updateLocalTicket(updated);
        setReplyText("");
        Swal.fire({
          icon: "success",
          title: resolve ? "Replied & resolved" : "Reply sent",
          timer: 1200,
          showConfirmButton: false,
        });
      } catch (err) {
        Swal.fire("Error", err.response?.data?.message || "Could not send reply", "error");
      } finally {
        setActionLoading(false);
      }
    },
    [detail, replyText, actorName, updateLocalTicket],
  );

  const handleStatusChange = useCallback(
    async (record, status) => {
      setActionLoading(true);
      try {
        const { data } = await api.patch(`/support-tickets/${record._id}/status`, {
          status,
          updatedBy: actorName,
        });
        updateLocalTicket(data?.data || { ...record, status });
        Swal.fire({
          icon: "success",
          title: `Marked ${STATUS_META[status]?.label || status}`,
          timer: 1000,
          showConfirmButton: false,
        });
      } catch (err) {
        Swal.fire("Error", err.response?.data?.message || "Could not update status", "error");
      } finally {
        setActionLoading(false);
      }
    },
    [actorName, updateLocalTicket],
  );

  const handleDelete = useCallback(
    async (record) => {
      const confirm = await Swal.fire({
        title: `Delete ${record.ticketNo}?`,
        text: "This permanently removes the support ticket.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Delete",
        confirmButtonColor: "#ff4d4f",
      });
      if (!confirm.isConfirmed) return;
      try {
        await api.delete(`/support-tickets/${record._id}`);
        setTickets((prev) => prev.filter((t) => t._id !== record._id));
        if (detail?._id === record._id) setDetail(null);
        Swal.fire({ icon: "success", title: "Deleted", timer: 800, showConfirmButton: false });
      } catch (err) {
        Swal.fire("Error", err.response?.data?.message || "Could not delete ticket", "error");
      }
    },
    [detail],
  );

  const columns = [
    {
      title: "Ticket",
      dataIndex: "ticketNo",
      key: "ticketNo",
      width: 120,
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 12 }}>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {dayjs(r.createdAt).format("MMM DD, YYYY")}
          </Text>
        </Space>
      ),
    },
    {
      title: "Requester",
      key: "requester",
      width: 220,
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 12 }}>{r.portalUserName || "Portal User"}</Text>
          <Text type="secondary" style={{ fontSize: 11, wordBreak: "break-word" }}>{r.portalUserEmail}</Text>
          {(r.companyName || r.slfName) && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              <BankOutlined /> {r.companyName || r.slfName}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: "Subject",
      dataIndex: "subject",
      key: "subject",
      render: (v, r) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Text style={{ fontSize: 12 }}>{v}</Text>
            {Array.isArray(r.attachments) && r.attachments.length > 0 && (
              <Tooltip title={`${r.attachments.length} attachment(s)`}>
                <Tag icon={<PaperClipOutlined />} color="blue" style={{ fontSize: 10, marginInlineEnd: 0 }}>
                  {r.attachments.length} file{r.attachments.length > 1 ? "s" : ""}
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Tag style={{ fontSize: 10 }}>{r.category}</Tag>
        </Space>
      ),
    },
    {
      title: "Priority",
      dataIndex: "priority",
      key: "priority",
      width: 100,
      render: (v) => <Tag color={PRIORITY_META[v]?.color || "default"}>{v}</Tag>,
      sorter: (a, b) => {
        const order = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
        return (order[a.priority] || 0) - (order[b.priority] || 0);
      },
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 130,
      render: (v) => (
        <Tag color={STATUS_META[v]?.color || "default"} icon={STATUS_META[v]?.icon}>
          {STATUS_META[v]?.label || v}
        </Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_, r) => (
        <Space size={4} wrap>
          <Tooltip title="View & resolve">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              style={{ color: "#2f54eb" }}
              onClick={() => openDetail(r)}
            />
          </Tooltip>
          {canEdit && r.status !== "resolved" && r.status !== "closed" && (
            <Tooltip title="Mark resolved">
              <Button
                size="small"
                type="text"
                icon={<CheckCircleOutlined />}
                style={{ color: "#52c41a" }}
                onClick={() => handleStatusChange(r, "resolved")}
              />
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip title="Delete ticket">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(r)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const tiles = [
    { key: "open", label: "Open", value: summary.open, color: "#ff4d4f", icon: <ExclamationCircleOutlined /> },
    { key: "in_progress", label: "In Progress", value: summary.in_progress, color: "#faad14", icon: <ClockCircleOutlined /> },
    { key: "resolved", label: "Resolved", value: summary.resolved, color: "#52c41a", icon: <CheckCircleOutlined /> },
    { key: "urgent", label: "Urgent (active)", value: summary.urgent, color: "#cf1322", icon: <ToolOutlined /> },
  ];

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {tiles.map((tile) => (
          <Col xs={12} sm={12} md={6} key={tile.key}>
            <Card
              size="small"
              style={{ borderRadius: 10, borderLeft: `4px solid ${tile.color}` }}
              styles={{ body: { padding: "12px 16px" } }}
            >
              <Space align="center" size={12}>
                <Avatar
                  shape="square"
                  style={{ background: `${tile.color}1a`, color: tile.color }}
                  icon={tile.icon}
                />
                <Statistic
                  title={<Text style={{ fontSize: 12 }}>{tile.label}</Text>}
                  value={tile.value}
                  valueStyle={{ color: tile.color, fontSize: 22, fontWeight: 700 }}
                />
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        style={{ borderRadius: 10 }}
        styles={{ body: { padding: "12px 16px 16px" } }}
        title={
          <Space>
            <CustomerServiceOutlined style={{ color: "#2f54eb" }} />
            <Text strong>Support Tickets</Text>
            <Tag>{filteredTickets.length}</Tag>
          </Space>
        }
        extra={
          <Space wrap>
            <Input
              size="small"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search tickets"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              size="small"
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 130 }}
              options={[
                { label: "All Status", value: "all" },
                { label: "Open", value: "open" },
                { label: "In Progress", value: "in_progress" },
                { label: "Resolved", value: "resolved" },
                { label: "Closed", value: "closed" },
              ]}
            />
            <Select
              size="small"
              value={priorityFilter}
              onChange={setPriorityFilter}
              style={{ width: 120 }}
              options={[
                { label: "All Priority", value: "all" },
                { label: "Urgent", value: "Urgent" },
                { label: "High", value: "High" },
                { label: "Medium", value: "Medium" },
                { label: "Low", value: "Low" },
              ]}
            />
            <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchTickets()} loading={loading}>
              Refresh
            </Button>
          </Space>
        }
      >
        <ResponsiveTable
          dataSource={filteredTickets}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={{ pageSize: 15, size: "small" }}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty description="No support tickets" /> }}
        />
      </Card>

      <Modal
        open={!!detail}
        onCancel={() => setDetail(null)}
        width={760}
        destroyOnHidden
        title={
          detail ? (
            <Space>
              <CustomerServiceOutlined style={{ color: "#2f54eb" }} />
              <span>{detail.ticketNo} — {detail.subject}</span>
            </Space>
          ) : (
            "Support Ticket"
          )
        }
        footer={null}
      >
        {detail && (
          <div>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color={STATUS_META[detail.status]?.color} icon={STATUS_META[detail.status]?.icon}>
                {STATUS_META[detail.status]?.label || detail.status}
              </Tag>
              <Tag color={PRIORITY_META[detail.priority]?.color}>{detail.priority} priority</Tag>
              <Tag icon={<TagsOutlined />}>{detail.category}</Tag>
            </Space>

            <Card size="small" style={{ marginBottom: 12, borderRadius: 8, background: "#fafafa" }}>
              <Space direction="vertical" size={2} style={{ width: "100%" }}>
                <Text strong style={{ fontSize: 13 }}>
                  <UserOutlined /> {detail.portalUserName || "Portal User"}
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <MailOutlined /> {detail.portalUserEmail}
                </Text>
                {(detail.companyName || detail.slfName) && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <BankOutlined /> {detail.companyName || detail.slfName}
                  </Text>
                )}
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Raised {dayjs(detail.createdAt).format("MMM DD, YYYY h:mm A")}
                </Text>
              </Space>
            </Card>

            <Alert
              type="info"
              showIcon
              icon={<ToolOutlined />}
              style={{ marginBottom: 12, borderRadius: 8 }}
              message="How to fix this"
              description={CATEGORY_GUIDE[detail.category] || CATEGORY_GUIDE.Other}
            />

            <Text strong style={{ fontSize: 12 }}>Issue Details</Text>
            <Paragraph style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>
              {detail.message}
            </Paragraph>

            {Array.isArray(detail.attachments) && detail.attachments.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Text strong style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                  Attachments ({detail.attachments.length})
                </Text>
                {/* Image gallery preview group */}
                {detail.attachments.some((a) => (a.mimeType || "").startsWith("image/")) && (
                  <Image.PreviewGroup>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
                      {detail.attachments
                        .filter((a) => (a.mimeType || "").startsWith("image/"))
                        .map((att, i) => (
                          <AttachmentImage key={i} att={att} index={i} />
                        ))}
                    </div>
                  </Image.PreviewGroup>
                )}
                {/* Non-image files (PDF, DOC, etc.) */}
                {detail.attachments
                  .filter((a) => !(a.mimeType || "").startsWith("image/"))
                  .map((att, i) => {
                    const isPdf = (att.mimeType || "").includes("pdf");
                    return (
                      <div
                        key={i}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 12px",
                          background: "#f5f5f5",
                          borderRadius: 8,
                          border: "1px solid #e0e0e0",
                          marginRight: 8,
                          marginBottom: 6,
                        }}
                      >
                        <span style={{ fontSize: 20 }}>
                          {isPdf ? <FilePdfOutlined style={{ color: "#cf1322" }} /> : <FileOutlined style={{ color: "#8c8c8c" }} />}
                        </span>
                        <span style={{ fontSize: 12, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {att.name || `Attachment ${i + 1}`}
                        </span>
                        {att.url ? (
                          <Button
                            size="small"
                            type="link"
                            href={att.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ padding: 0, height: "auto", fontSize: 12 }}
                          >
                            Open / Download ↗
                          </Button>
                        ) : (
                          <Text type="danger" style={{ fontSize: 11 }}>
                            <WarningOutlined /> Link unavailable
                          </Text>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

            <Divider style={{ margin: "12px 0" }}>Conversation</Divider>
            {detail.replies?.length ? (
              <Timeline
                style={{ marginTop: 8 }}
                items={detail.replies.map((reply) => ({
                  color: reply.isAdmin ? "blue" : "green",
                  children: (
                    <div>
                      <Space size={6}>
                        <Text strong style={{ fontSize: 12 }}>
                          {reply.isAdmin ? "Admin" : "Portal User"}
                          {reply.repliedByName ? ` · ${reply.repliedByName}` : ""}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {dayjs(reply.createdAt).format("MMM DD, h:mm A")}
                        </Text>
                      </Space>
                      <Paragraph style={{ fontSize: 13, margin: "2px 0 4px", whiteSpace: "pre-wrap" }}>
                        {reply.message}
                      </Paragraph>
                      {Array.isArray(reply.attachments) && reply.attachments.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          {reply.attachments.some((a) => (a.mimeType || "").startsWith("image/")) && (
                            <Image.PreviewGroup>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
                                {reply.attachments
                                  .filter((a) => (a.mimeType || "").startsWith("image/"))
                                  .map((att, ai) => (
                                    <div key={ai} style={{ position: "relative" }}>
                                      <Image
                                        src={att.url}
                                        alt={att.name || `img-${ai + 1}`}
                                        width={72}
                                        height={72}
                                        style={{
                                          objectFit: "cover",
                                          borderRadius: 8,
                                          border: "1.5px solid #e0e0e0",
                                          cursor: "zoom-in",
                                        }}
                                      />
                                    </div>
                                  ))}
                              </div>
                            </Image.PreviewGroup>
                          )}
                          {reply.attachments
                            .filter((a) => !(a.mimeType || "").startsWith("image/"))
                            .map((att, ai) => (
                              <div
                                key={ai}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "3px 10px",
                                  background: "#f5f5f5",
                                  borderRadius: 6,
                                  border: "1px solid #e0e0e0",
                                  marginRight: 6,
                                  marginBottom: 4,
                                }}
                              >
                                <span style={{ fontSize: 16 }}>
                                  {(att.mimeType || "").includes("pdf") ? "📄" : "📎"}
                                </span>
                                <span style={{ fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {att.name || `file-${ai + 1}`}
                                </span>
                                <Button
                                  type="link"
                                  size="small"
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ padding: 0, height: "auto", fontSize: 11 }}
                                >
                                  Open ↗
                                </Button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>No replies yet.</Text>
            )}

            {canEdit && (
              <>
                <Divider style={{ margin: "12px 0" }} />
                <Form layout="vertical">
                  <Form.Item label="Reply / Resolution" style={{ marginBottom: 8 }}>
                    <TextArea
                      rows={3}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type the fix or response that will be sent to the portal user..."
                    />
                  </Form.Item>
                  <Space wrap>
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      loading={actionLoading}
                      onClick={() => handleReply()}
                    >
                      Send Reply
                    </Button>
                    <Button
                      icon={<CheckCircleOutlined />}
                      style={{ color: "#52c41a", borderColor: "#52c41a" }}
                      loading={actionLoading}
                      onClick={() => handleReply({ resolve: true })}
                    >
                      Reply & Resolve
                    </Button>
                    {detail.status !== "in_progress" && (
                      <Button
                        icon={<ClockCircleOutlined />}
                        loading={actionLoading}
                        onClick={() => handleStatusChange(detail, "in_progress")}
                      >
                        Mark In Progress
                      </Button>
                    )}
                    {detail.status !== "closed" && (
                      <Button
                        icon={<CloseCircleOutlined />}
                        loading={actionLoading}
                        onClick={() => handleStatusChange(detail, "closed")}
                      >
                        Close
                      </Button>
                    )}
                  </Space>
                </Form>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
