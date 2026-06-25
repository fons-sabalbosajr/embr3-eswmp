import { useState, useEffect, useMemo } from "react";
import {
  Table, Tag, Button, Space, Modal, Select, Typography,
  Empty, Tooltip, Badge, Card, Descriptions, Avatar,
  Divider, Row, Col, Timeline, Alert, Dropdown, Form,
  Input, List, Spin, Tabs, Collapse,
} from "antd";
import {
  CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined,
  EditOutlined, EyeOutlined, ReloadOutlined, UserOutlined,
  MailOutlined, PhoneOutlined, BankOutlined, CalendarOutlined,
  EnvironmentOutlined, ClockCircleOutlined, LockOutlined,
  UnlockOutlined, FileDoneOutlined, LinkOutlined,
  FileTextOutlined, FileImageOutlined, SafetyCertificateOutlined,
  MessageOutlined, MoreOutlined, SendOutlined, SearchOutlined,
  HistoryOutlined
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import api from "../../api";
import ResponsiveTable from "./shared/ResponsiveTable";
import { matchesFilter, rowMatchesSearch } from "./shared/tableFilters";

dayjs.extend(relativeTime);

const { Text, Title } = Typography;
const { Option } = Select;

const getPortalEmailTemplates = (user = {}) => ({
  reminder: {
    subject: "Reminder: Update Your SLF Portal Submission",
    message: `Dear ${user.firstName || "Portal User"},\n\nThis is a reminder to review your SLF Portal account and submit any pending or corrected data required by EMB R3.\n\nPlease log in to the SLF Portal and complete the needed updates.\n\nThank you.`,
  },
  followup: {
    subject: "Follow-Up: Pending SLF Portal Action Required",
    message: `Dear ${user.firstName || "Portal User"},\n\nWe are following up on your pending SLF Portal action. Please review the latest instructions, submit the required data or attachments, and reply through the portal if you need assistance.\n\nThank you.`,
  },
  holdFollowup: {
    subject: "Follow-Up: Account Verification Requirements",
    message: `Dear ${user.firstName || "Portal User"},\n\nThis is a follow-up regarding your SLF Portal account verification. Please log in to the portal and submit the required authorization or verification documents so your account can be reviewed.\n\nIf you already submitted the documents, please wait for admin review or reply through the portal if you need assistance.\n\nThank you.`,
  },
  newAttachment: {
    subject: "New Attachment Required for SLF Portal Account",
    message: `Dear ${user.firstName || "Portal User"},\n\nYour latest verification attachment needs to be updated. Please log in to the SLF Portal and upload a corrected authorization document or proof of affiliation.\n\nYour account access may remain limited until the corrected attachment is submitted and reviewed.\n\nThank you.`,
  },
  revalidation: {
    subject: "Account Revalidation Required",
    message: `Dear ${user.firstName || "Portal User"},\n\nEMB R3 is requesting revalidation of your SLF Portal account details. Please review your account information, office email, PCO email, and verification attachment in the portal.\n\nSubmit the updated details as soon as possible so your access and assigned SLF records remain valid.\n\nThank you.`,
  },
  approvalNotice: {
    subject: "SLF Portal Account Approved",
    message: `Dear ${user.firstName || "Portal User"},\n\nYour SLF Portal account has been approved. You may now log in and access your assigned SLF records and submission tools.\n\nPlease keep your account and contact information updated.\n\nThank you.`,
  },
  correctionRequest: {
    subject: "Correction Required for SLF Portal Information",
    message: `Dear ${user.firstName || "Portal User"},\n\nPlease review and correct the information in your SLF Portal account or recent submission. Some details require clarification before admin review can be completed.\n\nLog in to the portal, apply the needed corrections, and submit the updated information.\n\nThank you.`,
  },
  custom: {
    subject: "",
    message: "",
  },
});

const appBase = (import.meta.env.BASE_URL || "/eswm-pipeline/").replace(/\/+$/, "");
const appApiBase = `${appBase}/api`;

// A portal user is considered "online" if their last activity ping was within
// this window (presence is touched on portal login and /me activity).
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const isUserOnline = (user) =>
  !!user?.lastActiveAt &&
  Date.now() - new Date(user.lastActiveAt).getTime() <= ONLINE_WINDOW_MS;

function normalizeVerificationFileUrl(url) {
  if (!url) return "";
  let normalized = String(url).replace("/porta-auth/", "/portal-auth/");
  if (normalized.startsWith("/api/")) {
    normalized = `${appApiBase}${normalized.slice(4)}`;
  }
  return normalized;
}

export default function PortalUsers({ isDark, canEdit = true, canDelete = true, canEmail = true, canSeePortalData = true }) {
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
  const [holdLoading, setHoldLoading] = useState(false);
  const [messageModal, setMessageModal] = useState({ open: false, user: null });
  const [messageThreads, setMessageThreads] = useState([]);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageSending, setMessageSending] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [emailUserModal, setEmailUserModal] = useState({ open: false, user: null });
  const [emailSending, setEmailSending] = useState(false);
  const [historyModal, setHistoryModal] = useState({ open: false, user: null });
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState({ submissions: [], transactions: [], conversations: [], verificationHistory: [], activity: [] });
  const [detailActivity, setDetailActivity] = useState({ loading: false, items: [] });
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const [fileFilter, setFileFilter] = useState("all");
  const [slfFilter, setSlfFilter] = useState(null);
  const [messageForm] = Form.useForm();
  const [emailForm] = Form.useForm();

  const mergePortalUser = (updatedUser) => {
    if (!updatedUser?._id) return;
    setUsers((prev) =>
      prev.map((user) =>
        user._id === updatedUser._id ? { ...user, ...updatedUser } : user,
      ),
    );
    setDetailModal((prev) =>
      prev.user?._id === updatedUser._id
        ? { ...prev, user: { ...prev.user, ...updatedUser } }
        : prev,
    );
    setHistoryModal((prev) =>
      prev.user?._id === updatedUser._id
        ? { ...prev, user: { ...prev.user, ...updatedUser } }
        : prev,
    );
  };

  useEffect(() => {
    fetchData();
    // Refresh periodically so online/offline presence stays current.
    const interval = setInterval(() => fetchData({ silent: true }), 60000);
    return () => clearInterval(interval);
  }, []);

  // Deduplicated SLF options: one entry per unique lgu+ownership label,
  // keeping the record with the highest dataYear so IDs are always current.
  const slfOptions = useMemo(() => {
    const labelMap = new Map();
    for (const g of generators) {
      const label = `${g.lgu || ""}${g.ownership ? " (" + g.ownership + ")" : ""}`.trim();
      const prev = labelMap.get(label);
      if (!prev || (g.dataYear || 0) > (prev.dataYear || 0)) {
        labelMap.set(label, g);
      }
    }
    return Array.from(labelMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, g]) => ({ label, value: g._id }));
  }, [generators]);

  const fetchData = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedSlf || selectedSlf.length === 0) {
      Swal.fire("Warning", "Please select at least one SLF to assign.", "warning");
      return;
    }
    setApproving(true);
    try {
      const { data } = await api.patch(`/portal-users/${approveModal.user._id}/approve`, {
        assignedSlf: selectedSlf,
      });
      mergePortalUser(data.data);
      Swal.fire({
        icon: "success",
        title: "Approved",
        text: `${approveModal.user.firstName} ${approveModal.user.lastName} has been approved.`,
        confirmButtonColor: "#1a3353",
      });
      setApproveModal({ open: false, user: null });
      setSelectedSlf([]);
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
      const { data } = await api.patch(`/portal-users/${record._id}/reject`, { reason });
      mergePortalUser(data.data);
      Swal.fire({
        icon: "info",
        title: "Rejected",
        text: `${record.firstName} ${record.lastName} has been rejected.`,
        confirmButtonColor: "#1a3353",
      });
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
      setUsers((prev) => prev.filter((user) => user._id !== record._id));
      Swal.fire({
        icon: "success",
        title: "Deleted",
        confirmButtonColor: "#1a3353",
      });
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
      const { data } = await api.patch(`/portal-users/${editSlfModal.user._id}/update-slf`, {
        assignedSlf: editSlfValue,
      });
      mergePortalUser(data.data);
      Swal.fire({
        icon: "success",
        title: "Updated",
        text: "Assigned SLF has been updated.",
        confirmButtonColor: "#1a3353",
      });
      setEditSlfModal({ open: false, user: null });
      setEditSlfValue([]);
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

  const handleHold = async (record) => {
    const needsCorrectedAttachment = record.verificationRequired && record.verificationSubmitted;
    const result = await Swal.fire({
      title: needsCorrectedAttachment ? "Request New Attachment?" : "Put Account On Hold?",
      html: needsCorrectedAttachment
        ? `The current attachment from <strong>${record.firstName} ${record.lastName}</strong> will be moved to Submission History and the user must upload a corrected file.`
        : `This will require <strong>${record.firstName} ${record.lastName}</strong> to re-upload their verification documents the next time they log in. The current attachment will be moved to Submission History.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#fa8c16",
      confirmButtonText: needsCorrectedAttachment ? "Require New File" : "Yes, Hold Account",
    });
    if (!result.isConfirmed) return;
    setHoldLoading(true);
    try {
      const { data } = await api.patch(`/portal-users/${record._id}/hold`);
      mergePortalUser(data.data);
      Swal.fire({ icon: "success", title: needsCorrectedAttachment ? "New Attachment Required" : "Account On Hold", text: "The user will be prompted to verify before accessing the portal.", confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to hold account", "error");
    } finally {
      setHoldLoading(false);
    }
  };

  const handleUnhold = async (record) => {
    const result = await Swal.fire({
      title: "Remove Hold?",
      text: `${record.firstName} ${record.lastName} will no longer be prompted for re-verification.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#52c41a",
      confirmButtonText: "Yes, Remove Hold",
    });
    if (!result.isConfirmed) return;
    try {
      const { data } = await api.patch(`/portal-users/${record._id}/unhold`);
      mergePortalUser(data.data);
      Swal.fire({ icon: "success", title: "Hold Removed", confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to remove hold", "error");
    }
  };

  const handleReviewVerification = async (record) => {
    const result = await Swal.fire({
      title: "Mark Verification as Reviewed?",
      text: "This will clear the verification hold and the user can continue using the portal normally.",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#52c41a",
      confirmButtonText: "Mark Reviewed",
    });
    if (!result.isConfirmed) return;
    try {
      const { data } = await api.patch(`/portal-users/${record._id}/review-verification`);
      mergePortalUser(data.data);
      Swal.fire({ icon: "success", title: "Verification Reviewed", confirmButtonColor: "#1a3353" });
      setDetailModal({ open: false, user: null });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to review", "error");
    }
  };

  const fetchMessageThreads = async (record, nextSelectedId) => {
    if (!record?._id) return;
    setMessageLoading(true);
    try {
      const { data } = await api.get(`/portal-users/${record._id}/message-threads`);
      setMessageThreads(data || []);
      setSelectedThreadId(nextSelectedId || data?.[0]?._id || null);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to load message threads", "error");
    } finally {
      setMessageLoading(false);
    }
  };

  const openMessageManager = (record) => {
    setMessageModal({ open: true, user: record });
    setMessageThreads([]);
    setSelectedThreadId(null);
    setReplyText("");
    messageForm.setFieldsValue({
      category: "Requirements / Compliance",
      priority: "Medium",
      subject: "",
      message: "",
    });
    fetchMessageThreads(record);
  };

  const openEmailPortalUser = (record) => {
    const templates = getPortalEmailTemplates(record);
    setEmailUserModal({ open: true, user: record });
    emailForm.setFieldsValue({
      templateType: "reminder",
      subject: templates.reminder.subject,
      message: templates.reminder.message,
    });
  };

  const handlePortalEmailTemplateChange = (templateType) => {
    const templates = getPortalEmailTemplates(emailUserModal.user || {});
    emailForm.setFieldsValue({
      templateType,
      subject: templates[templateType]?.subject || "",
      message: templates[templateType]?.message || "",
    });
  };

  const handleSendPortalUserEmail = async (values) => {
    const user = emailUserModal.user;
    if (!user?._id) return;
    setEmailSending(true);
    try {
      const { data } = await api.post(`/portal-users/${user._id}/send-email`, values);
      Swal.fire({
        icon: "success",
        title: "Email Sent",
        text: data?.messageId
          ? `Email sent to ${user.email}. Message ID: ${data.messageId}`
          : `Email sent to ${user.email}.`,
        confirmButtonColor: "#1a3353",
      });
      setEmailUserModal({ open: false, user: null });
      emailForm.resetFields();
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to send email", "error");
    } finally {
      setEmailSending(false);
    }
  };

  const openSubmissionHistory = async (record) => {
    setHistoryModal({ open: true, user: record });
    setHistoryData({ submissions: [], transactions: [], conversations: [], verificationHistory: [], activity: [] });
    setHistoryLoading(true);
    try {
      const { data } = await api.get(`/portal-users/${record._id}/submission-history`);
      setHistoryData({
        submissions: data.submissions || [],
        transactions: data.transactions || [],
        conversations: data.conversations || [],
        verificationHistory: data.verificationHistory || [],
        activity: data.activity || [],
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to load submission history", "error");
    } finally {
      setHistoryLoading(false);
    }
  };

  const openDetails = async (record) => {
    setDetailModal({ open: true, user: record });
    setDetailActivity({ loading: true, items: [] });
    try {
      const { data } = await api.get(`/portal-users/${record._id}/submission-history`);
      setDetailActivity({ loading: false, items: data.activity || [] });
    } catch {
      setDetailActivity({ loading: false, items: [] });
    }
  };

  const renderAttachments = (attachments = []) => {
    const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
    if (list.length === 0) return null;
    return (
      <Space direction="vertical" size={4} style={{ marginTop: 6 }}>
        {list.map((attachment, index) => {
          const url = typeof attachment === "string" ? attachment : attachment.url || attachment.href;
          const name = typeof attachment === "string" ? `Attachment ${index + 1}` : attachment.name || attachment.fileName || attachment.title || `Attachment ${index + 1}`;
          return url ? (
            <a key={`${url}-${index}`} href={normalizeVerificationFileUrl(url)} target="_blank" rel="noopener noreferrer">
              <Button size="small" icon={<LinkOutlined />}>{name}</Button>
            </a>
          ) : (
            <Tag key={index} icon={<FileTextOutlined />}>{name}</Tag>
          );
        })}
      </Space>
    );
  };

  const historyCellStyle = {
    fontSize: 12,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    lineHeight: 1.35,
  };

  const cleanText = (value, fallback = "-") => {
    if (value == null || value === "") return fallback;
    return String(value)
      .replace(/m(?:\u00c3\u0192\u00e2\u20ac\u0161\u00c3\u201a\u00c2\u00b3|\u00c3\u201a\u00c2\u00b3|\u00c2\u00b3|\u00b3)/gi, "m3")
      .replace(/(?:\u00c3\u0192\u00c2\u00a2\u00c3\u00a2\u00e2\u20ac\u0161\u00c2\u00ac\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u009d|\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u009d|\u00e2\u20ac\u201d|\u2014)/g, "-")
      .replace(/(?:\u00c3\u201a\u00c2\u00b7|\u00c2\u00b7|\u00b7)/g, "-")
      .replace(/(?:\u00c3\u0192\u00c2\u00a2\u00c3\u00a2\u00e2\u20ac\u0161\u00c2\u00ac\u00c3\u00a2\u00e2\u20ac\u017e\u00c2\u00a2|\u00c3\u00a2\u00e2\u201a\u00ac\u00e2\u20ac\u017e\u00c2\u00a2|\u2019)/g, "'")
      .replace(/(?:\u00c3\u00a2\u00e2\u201a\u00ac\u00c5\u201c|\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u009d|\u201c|\u201d)/g, '"')
      .replace(/Treated\s+Haz(?:ardous)?\s+Waste/gi, "Treated Hazardous Waste")
      .trim() || fallback;
  };

  const wrapHistoryText = (value, strong = false) => (
    <Text strong={strong} style={historyCellStyle}>{cleanText(value)}</Text>
  );

  const unitText = (unit) => cleanText(unit || "m3").replace(/^m3$/i, "m3");
  const numText = (value, unit) => value != null && value !== "" ? `${Number(value).toLocaleString()} ${unitText(unit)}` : "-";

  const renderEncodedSubmission = (record) => {
    const trucks = record.trucks || [];
    const haulers = record.accreditedHaulers || [];
    const activeCells = record.activeCellEntries || [];
    const closedCells = record.closedCellEntries || [];
    return (
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Descriptions size="small" bordered column={{ xs: 1, md: 2 }} className="portal-user-wrap-table">
          <Descriptions.Item label="ID No.">{cleanText(record.idNo)}</Descriptions.Item>
          <Descriptions.Item label="Status">{cleanText(record.status || "pending")}</Descriptions.Item>
          <Descriptions.Item label="SLF">{cleanText(record.slfName || record.slfGenerator?.lgu)}</Descriptions.Item>
          <Descriptions.Item label="Date of Disposal">{record.dateOfDisposal ? dayjs(record.dateOfDisposal).format("MM/DD/YYYY") : "-"}</Descriptions.Item>
          <Descriptions.Item label="Company/LGU">{cleanText(record.lguCompanyName)}</Descriptions.Item>
          <Descriptions.Item label="Company Type">{cleanText(record.companyType)}</Descriptions.Item>
          <Descriptions.Item label="Address" span={2}>{cleanText(record.address)}</Descriptions.Item>
          <Descriptions.Item label="Submitted">{record.createdAt ? dayjs(record.createdAt).format("MM/DD/YYYY h:mm A") : "-"}</Descriptions.Item>
          <Descriptions.Item label="Submitted By">{cleanText(record.submittedBy)}</Descriptions.Item>
        </Descriptions>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={8}><Card size="small"><Text type="secondary">Total Accepted</Text><br /><Text strong>{numText(record.totalVolumeAccepted, record.totalVolumeAcceptedUnit || record.baselineUnit)}</Text></Card></Col>
          <Col xs={24} md={8}><Card size="small"><Text type="secondary">Active Residual</Text><br /><Text strong>{numText(record.activeCellResidualVolume, record.activeCellResidualUnit || record.baselineUnit)}</Text></Card></Col>
          <Col xs={24} md={8}><Card size="small"><Text type="secondary">Closed Residual</Text><br /><Text strong>{numText(record.closedCellResidualVolume, record.closedCellResidualUnit || record.baselineUnit)}</Text></Card></Col>
        </Row>
        <ResponsiveTable className="portal-user-wrap-table" dataSource={trucks} rowKey={(_, index) => index} size="small" pagination={false} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No encoded trucks" /> }} columns={[
          { title: "Ticket No.", dataIndex: "disposalTicketNo", width: 130, render: (value) => wrapHistoryText(value) },
          { title: "Hauler", dataIndex: "hauler", width: 170, render: (value) => wrapHistoryText(value) },
          { title: "Plate", dataIndex: "plateNumber", width: 130, render: (value) => wrapHistoryText(value) },
          { title: "Capacity", width: 130, render: (_, row) => wrapHistoryText(row.truckCapacity != null ? `${row.truckCapacity} ${unitText(row.truckCapacityUnit)}` : "") },
          { title: "Actual Volume", width: 140, render: (_, row) => wrapHistoryText(numText(row.actualVolume, row.actualVolumeUnit || "tons")) },
          { title: "Waste Type", dataIndex: "wasteType", width: 170, render: (value) => wrapHistoryText(value) },
        ]} />
        {(activeCells.length > 0 || closedCells.length > 0) && (
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}><ResponsiveTable className="portal-user-wrap-table" title={() => "Active Cell Entries"} dataSource={activeCells} rowKey={(_, index) => index} pagination={false} columns={[
              { title: "Cell", dataIndex: "cellName", render: (value) => wrapHistoryText(value) },
              { title: "Waste", dataIndex: "wasteType", render: (value) => wrapHistoryText(value) },
              { title: "Volume", render: (_, row) => wrapHistoryText(numText(row.volume, row.unit)) },
            ]} /></Col>
            <Col xs={24} md={12}><ResponsiveTable className="portal-user-wrap-table" title={() => "Closed Cell Entries"} dataSource={closedCells} rowKey={(_, index) => index} pagination={false} columns={[
              { title: "Cell", dataIndex: "cellName", render: (value) => wrapHistoryText(value) },
              { title: "Waste", dataIndex: "wasteType", render: (value) => wrapHistoryText(value) },
              { title: "Volume", render: (_, row) => wrapHistoryText(numText(row.volume, row.unit)) },
            ]} /></Col>
          </Row>
        )}
        <ResponsiveTable className="portal-user-wrap-table" dataSource={haulers} rowKey={(_, index) => index} size="small" pagination={false} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No accredited haulers encoded" /> }} columns={[
          { title: "Hauler", dataIndex: "haulerName", width: 180, render: (value) => wrapHistoryText(value, true) },
          { title: "Trucks", dataIndex: "numberOfTrucks", width: 90, render: (value) => wrapHistoryText(value ?? "") },
          { title: "Office Address", dataIndex: "officeAddress", width: 240, render: (value) => wrapHistoryText(value) },
          { title: "Clients", dataIndex: "privateSectorClients", width: 280, render: (value) => {
            const list = Array.isArray(value) ? value : value ? [value] : [];
            return wrapHistoryText(list.map((item) => typeof item === "string" ? item : item.clientName || "-").join(", "));
          } },
        ]} />
      </Space>
    );
  };

  const handleCreateMessageThread = async (values) => {
    const user = messageModal.user;
    if (!user?._id) return;
    setMessageSending(true);
    try {
      const { data } = await api.post(`/portal-users/${user._id}/message-threads`, values);
      messageForm.resetFields();
      messageForm.setFieldsValue({ category: "Requirements / Compliance", priority: "Medium" });
      await fetchMessageThreads(user, data?.data?._id);
      Swal.fire({ icon: "success", title: "Message Sent", timer: 1200, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to send message", "error");
    } finally {
      setMessageSending(false);
    }
  };

  const handleSendThreadReply = async () => {
    const user = messageModal.user;
    if (!user?._id || !selectedThreadId || !replyText.trim()) return;
    setMessageSending(true);
    try {
      await api.post(`/portal-users/${user._id}/message-threads/${selectedThreadId}/reply`, { message: replyText.trim() });
      setReplyText("");
      await fetchMessageThreads(user, selectedThreadId);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to send reply", "error");
    } finally {
      setMessageSending(false);
    }
  };

  const openEditSlfAssignment = (record) => {
    const raw = Array.isArray(record.assignedSlf)
      ? record.assignedSlf
      : record.assignedSlf ? [record.assignedSlf] : [];
    const idToLabel = new Map(
      generators.map((g) => [
        g._id,
        `${g.lgu || ""}${g.ownership ? " (" + g.ownership + ")" : ""}`.trim(),
      ])
    );
    const labelToId = new Map(slfOptions.map((o) => [o.label, o.value]));
    const normalized = raw.map((id) => {
      const lbl = idToLabel.get(id);
      return lbl && labelToId.has(lbl) ? labelToId.get(lbl) : id;
    });
    setEditSlfValue(normalized);
    setEditSlfModal({ open: true, user: record });
  };

  const selectedThread = messageThreads.find((thread) => thread._id === selectedThreadId);

  const assignedSlfNameOptions = useMemo(() => {
    const names = new Set();
    users.forEach((user) => {
      const assigned = Array.isArray(user.assignedSlfName)
        ? user.assignedSlfName
        : user.assignedSlfName ? [user.assignedSlfName] : [];
      assigned.forEach((name) => {
        if (name) names.add(name);
      });
    });
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ label: name, value: name }));
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const assignedNames = Array.isArray(user.assignedSlfName)
        ? user.assignedSlfName
        : user.assignedSlfName ? [user.assignedSlfName] : [];
      const hasAssignedSlf = assignedNames.length > 0;

      if (!rowMatchesSearch(user, searchText)) return false;
      if (statusFilter !== "all" && !matchesFilter(user.status, statusFilter)) return false;
      if (assignmentFilter === "assigned" && !hasAssignedSlf) return false;
      if (assignmentFilter === "unassigned" && hasAssignedSlf) return false;
      if (slfFilter && !assignedNames.some((name) => matchesFilter(name, slfFilter))) return false;
      if (fileFilter === "with-file" && !user.verificationFileUrl) return false;
      if (fileFilter === "no-file" && user.verificationFileUrl) return false;
      if (verificationFilter === "held" && !user.verificationRequired) return false;
      if (verificationFilter === "submitted" && !user.verificationSubmitted) return false;
      if (verificationFilter === "needs-docs" && !(user.verificationRequired && !user.verificationSubmitted)) return false;
      return true;
    });
  }, [assignmentFilter, fileFilter, searchText, slfFilter, statusFilter, users, verificationFilter]);

  const resetFilters = () => {
    setSearchText("");
    setStatusFilter("all");
    setAssignmentFilter("all");
    setVerificationFilter("all");
    setFileFilter("all");
    setSlfFilter(null);
  };

  const columns = [
    {
      title: "#",
      key: "index",
      width: 50,
      render: (_, __, i) => i + 1,
    },
    {
      title: "Portal User",
      key: "portalUser",
      width: 360,
      sorter: (a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(
          `${b.firstName} ${b.lastName}`
        ),
      render: (_, r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Text strong style={{ lineHeight: 1.4 }}>{r.firstName} {r.lastName}</Text>
          <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>{r.email}</Text>
          <Text style={{ fontSize: 12, color: "#555", lineHeight: 1.4 }}>{r.companyName || "—"}</Text>
        </div>
      ),
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
      width: 140,
    },
    {
      title: "Presence",
      key: "presence",
      width: 150,
      filters: [
        { text: "Online", value: "online" },
        { text: "Offline", value: "offline" },
      ],
      onFilter: (value, record) =>
        value === "online" ? isUserOnline(record) : !isUserOnline(record),
      render: (_, record) => {
        const online = isUserOnline(record);
        return (
          <Space direction="vertical" size={0}>
            <Tag
              color={online ? "green" : "default"}
              style={{ borderRadius: 10, fontSize: 11 }}
            >
              <Badge
                status={online ? "success" : "default"}
                style={{ marginRight: 4 }}
              />
              {online ? "Online" : "Offline"}
            </Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {record.lastActiveAt
                ? `Active ${dayjs(record.lastActiveAt).fromNow()}`
                : "No activity yet"}
            </Text>
          </Space>
        );
      },
    },
    {
      title: "Status & Files",
      key: "statusFiles",
      width: 240,
      filters: [
        { text: "Pending", value: "pending" },
        { text: "Approved", value: "approved" },
        { text: "Rejected", value: "rejected" },
      ],
      onFilter: (value, record) => matchesFilter(record.status, value),
      render: (_, record) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Space size={4} wrap>
            <Tag color={statusColor[record.status]}>{record.status?.toUpperCase()}</Tag>
            {record.verificationRequired && !record.verificationSubmitted && (
              <Tag color="orange" icon={<LockOutlined />}>HELD</Tag>
            )}
            {record.verificationSubmitted && (
              <Tag color="blue" icon={<FileDoneOutlined />}>DOCS SUBMITTED</Tag>
            )}
          </Space>
          {record.verificationFileUrl ? (
            <a href={normalizeVerificationFileUrl(record.verificationFileUrl)} target="_blank" rel="noopener noreferrer">
              <Button
                size="small"
                type="link"
                icon={record.verificationFileType === "image" ? <FileImageOutlined /> : <FileTextOutlined />}
                style={{ paddingInline: 0 }}
              >
                {record.verificationFileType === "image" ? "Image" : "Document"}
              </Button>
            </a>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>No file</Text>
          )}
        </div>
      ),
    },
    {
      title: "Registered",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v) => dayjs(v).format("MM/DD/YYYY"),
      sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    },
    {
      title: "Actions",
      key: "actions",
      width: 130,
      render: (_, record) => {
        const actionItems = [
          { key: "view", icon: <EyeOutlined />, label: "View Details" },
          { key: "message", icon: <MessageOutlined />, label: "Message User" },
          canEmail && { key: "email-user", icon: <MailOutlined />, label: "Email Portal User" },
          canSeePortalData && { key: "see-portal-data", icon: <HistoryOutlined />, label: "See Portal Data" },
          { type: "divider" },
          canEdit && record.status === "pending" && { key: "approve", icon: <CheckCircleOutlined />, label: "Approve" },
          canEdit && record.status === "pending" && { key: "reject", icon: <CloseCircleOutlined />, label: "Reject", danger: true },
          canEdit && record.status === "approved" && { key: "edit-slf", icon: <EditOutlined />, label: "Edit Assigned SLF" },
          canEdit && record.status === "approved" && (!record.verificationRequired || record.verificationSubmitted) && {
            key: "hold",
            icon: <LockOutlined />,
            label: record.verificationSubmitted ? "Request New Attachment" : "Hold Account",
          },
          canEdit && record.status === "approved" && record.verificationRequired && !record.verificationSubmitted && {
            key: "unhold",
            icon: <UnlockOutlined />,
            label: "Remove Hold",
          },
          canEdit && record.verificationSubmitted && { key: "review", icon: <FileDoneOutlined />, label: "Mark Verification Reviewed" },
          { type: "divider" },
          canDelete && { key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true },
        ].filter(Boolean);

        return (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: actionItems,
              onClick: ({ key }) => {
                if (key === "view") openDetails(record);
                if (key === "message") openMessageManager(record);
                if (key === "email-user") openEmailPortalUser(record);
                if (key === "see-portal-data") openSubmissionHistory(record);
                if (key === "approve") { setSelectedSlf([]); setApproveModal({ open: true, user: record }); }
                if (key === "reject") handleReject(record);
                if (key === "edit-slf") openEditSlfAssignment(record);
                if (key === "hold") handleHold(record);
                if (key === "unhold") handleUnhold(record);
                if (key === "review") handleReviewVerification(record);
                if (key === "delete") handleDelete(record);
              },
            }}
          >
            <Button size="small" icon={<MoreOutlined />} type="primary">
              Actions
            </Button>
          </Dropdown>
        );
      },
    },
  ];

  const pendingCount = users.filter((u) => u.status === "pending").length;

  const userSummary = useMemo(() => {
    const acc = {
      total: users.length,
      approved: 0,
      pending: 0,
      rejected: 0,
      online: 0,
      held: 0,
      sharingLocation: 0,
    };
    users.forEach((u) => {
      if (u.status === "approved") acc.approved += 1;
      else if (u.status === "pending") acc.pending += 1;
      else if (u.status === "rejected") acc.rejected += 1;
      if (isUserOnline(u)) acc.online += 1;
      if (u.verificationRequired) acc.held += 1;
      if (u.locationSharingEnabled) acc.sharingLocation += 1;
    });
    return acc;
  }, [users]);

  const summaryTiles = [
    { key: "total", label: "Total Users", value: userSummary.total, color: "#1a3353", icon: <UserOutlined /> },
    { key: "online", label: "Online Now", value: userSummary.online, color: "#52c41a", icon: <Badge status="success" /> },
    { key: "approved", label: "Approved", value: userSummary.approved, color: "#2f54eb", icon: <CheckCircleOutlined /> },
    { key: "pending", label: "Pending", value: userSummary.pending, color: "#faad14", icon: <ClockCircleOutlined /> },
    { key: "held", label: "On Hold", value: userSummary.held, color: "#fa541c", icon: <LockOutlined /> },
    { key: "sharing", label: "Sharing Location", value: userSummary.sharingLocation, color: "#13c2c2", icon: <EnvironmentOutlined /> },
  ];

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

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {summaryTiles.map((tile) => (
          <Col xs={12} sm={8} md={4} key={tile.key}>
            <Card
              size="small"
              style={{ borderRadius: 10, borderLeft: `4px solid ${tile.color}` }}
              styles={{ body: { padding: "10px 14px" } }}
            >
              <Space align="center" size={10}>
                <span
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: `${tile.color}1f`,
                    color: tile.color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                  }}
                >
                  {tile.icon}
                </span>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: tile.color, lineHeight: 1.1 }}>
                    {tile.value}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{tile.label}</Text>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={8} lg={7}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search name, email, company, SLF..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Select value={statusFilter} onChange={setStatusFilter} style={{ width: "100%" }}>
              <Option value="all">All Status</Option>
              <Option value="pending">Pending</Option>
              <Option value="approved">Approved</Option>
              <Option value="rejected">Rejected</Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Select value={assignmentFilter} onChange={setAssignmentFilter} style={{ width: "100%" }}>
              <Option value="all">All Assignments</Option>
              <Option value="assigned">Assigned</Option>
              <Option value="unassigned">Unassigned</Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Select value={verificationFilter} onChange={setVerificationFilter} style={{ width: "100%" }}>
              <Option value="all">All Verification</Option>
              <Option value="held">Held</Option>
              <Option value="submitted">Docs Submitted</Option>
              <Option value="needs-docs">Needs Docs</Option>
            </Select>
          </Col>
          <Col xs={24} sm={12} md={4}>
            <Select value={fileFilter} onChange={setFileFilter} style={{ width: "100%" }}>
              <Option value="all">All Files</Option>
              <Option value="with-file">With File</Option>
              <Option value="no-file">No File</Option>
            </Select>
          </Col>
          <Col xs={24} md={8} lg={7}>
            <Select
              allowClear
              showSearch
              placeholder="Filter by assigned SLF"
              optionFilterProp="label"
              value={slfFilter}
              onChange={setSlfFilter}
              options={assignedSlfNameOptions}
              style={{ width: "100%" }}
            />
          </Col>
          <Col xs={24} md={16} lg={17}>
            <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Showing <Text strong>{filteredUsers.length}</Text> of <Text strong>{users.length}</Text> portal users
              </Text>
              <Button size="small" onClick={resetFilters}>Reset Filters</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <ResponsiveTable
        className="portal-user-wrap-table"
        dataSource={filteredUsers}
        columns={columns}
        rowKey="_id"
        loading={loading}
        size="small"
        pagination={{
          defaultPageSize: 15,
          pageSizeOptions: ["10", "15", "25", "50"],
          showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} portal users`,
        }}
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
              options={slfOptions}
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
              options={slfOptions}
              notFoundContent={<Empty description="No SLF available" />}
            />
          </div>
        )}
      </Modal>

      {/* Portal User Message Threads */}
      <Modal
        title={
          <Space>
            <MessageOutlined style={{ color: "#1a3353" }} />
            <span>
              Message Portal User{messageModal.user ? ` — ${messageModal.user.firstName} ${messageModal.user.lastName}` : ""}
            </span>
          </Space>
        }
        open={messageModal.open}
        onCancel={() => {
          setMessageModal({ open: false, user: null });
          setMessageThreads([]);
          setSelectedThreadId(null);
          setReplyText("");
          messageForm.resetFields();
        }}
        footer={null}
        width={980}
        destroyOnHidden
      >
        {messageModal.user && (
          <Row gutter={[16, 16]}>
            <Col xs={24} md={9}>
              <Card size="small" title="Start Custom Message" style={{ borderRadius: 8, marginBottom: 12 }}>
                <Form
                  form={messageForm}
                  layout="vertical"
                  initialValues={{ category: "Requirements / Compliance", priority: "Medium" }}
                  onFinish={handleCreateMessageThread}
                >
                  <Form.Item name="category" label="Category" rules={[{ required: true, message: "Select a category" }]}>
                    <Select size="small" options={[
                      { label: "Requirements / Compliance", value: "Requirements / Compliance" },
                      { label: "Account Issue", value: "Account Issue" },
                      { label: "Data Correction", value: "Data Correction" },
                      { label: "General Inquiry", value: "General Inquiry" },
                      { label: "Other", value: "Other" },
                    ]} />
                  </Form.Item>
                  <Form.Item name="priority" label="Priority" rules={[{ required: true, message: "Select priority" }]}>
                    <Select size="small" options={[
                      { label: "Low", value: "Low" },
                      { label: "Medium", value: "Medium" },
                      { label: "High", value: "High" },
                      { label: "Urgent", value: "Urgent" },
                    ]} />
                  </Form.Item>
                  <Form.Item name="subject" label="Subject" rules={[{ required: true, message: "Enter a subject" }]}>
                    <Input size="small" placeholder="e.g. Missing compliance requirement" />
                  </Form.Item>
                  <Form.Item name="message" label="Message" rules={[{ required: true, message: "Enter a message" }]}>
                    <Input.TextArea rows={4} placeholder="Describe the requirement or compliance issue..." />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={messageSending} block>
                    Send Message
                  </Button>
                </Form>
              </Card>

              <Card size="small" title="Threads" style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
                {messageLoading ? (
                  <div style={{ textAlign: "center", padding: 28 }}><Spin /></div>
                ) : messageThreads.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No threads yet" style={{ padding: "18px 0" }} />
                ) : (
                  <List
                    dataSource={messageThreads}
                    renderItem={(thread) => (
                      <List.Item
                        onClick={() => setSelectedThreadId(thread._id)}
                        style={{
                          cursor: "pointer",
                          padding: "10px 12px",
                          background: selectedThreadId === thread._id ? (isDark ? "rgba(22,119,255,0.16)" : "#e6f4ff") : "transparent",
                        }}
                      >
                        <List.Item.Meta
                          title={<Text strong style={{ fontSize: 12 }}>{thread.subject}</Text>}
                          description={
                            <Space direction="vertical" size={2}>
                              <Text type="secondary" style={{ fontSize: 11 }}>{thread.ticketNo} · {dayjs(thread.updatedAt).format("MMM D, h:mm A")}</Text>
                              <Space size={4} wrap>
                                <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{thread.category}</Tag>
                                <Tag color={thread.status === "resolved" ? "green" : thread.status === "closed" ? "default" : "orange"} style={{ margin: 0, fontSize: 10 }}>
                                  {thread.status?.replace("_", " ").toUpperCase()}
                                </Tag>
                              </Space>
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </Col>

            <Col xs={24} md={15}>
              <Card
                size="small"
                title={selectedThread ? `${selectedThread.ticketNo} — ${selectedThread.subject}` : "Conversation"}
                extra={selectedThread ? <Tag color="blue">{selectedThread.priority}</Tag> : null}
                style={{ borderRadius: 8, minHeight: 560 }}
              >
                {!selectedThread ? (
                  <Empty description="Select a thread or send a new custom message" />
                ) : (
                  <>
                    <div style={{ maxHeight: 390, overflowY: "auto", paddingRight: 4 }}>
                      <div
                        style={{
                          background: isDark ? "rgba(22,119,255,0.12)" : "#e6f4ff",
                          borderLeft: "3px solid #1677ff",
                          borderRadius: 6,
                          padding: "10px 12px",
                          marginBottom: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <Text strong style={{ fontSize: 12 }}>Admin</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(selectedThread.createdAt).format("MMM D, h:mm A")}</Text>
                        </div>
                        <Text style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{selectedThread.message}</Text>
                      </div>

                      {(selectedThread.replies || []).map((reply) => (
                        <div
                          key={reply._id || `${reply.createdAt}-${reply.message}`}
                          style={{
                            background: reply.isAdmin ? (isDark ? "rgba(22,119,255,0.12)" : "#e6f4ff") : (isDark ? "rgba(82,196,26,0.12)" : "#f6ffed"),
                            borderLeft: `3px solid ${reply.isAdmin ? "#1677ff" : "#52c41a"}`,
                            borderRadius: 6,
                            padding: "10px 12px",
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <Text strong style={{ fontSize: 12 }}>{reply.isAdmin ? "Admin" : messageModal.user.firstName}</Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(reply.createdAt).format("MMM D, h:mm A")}</Text>
                          </div>
                          <Text style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{reply.message}</Text>
                        </div>
                      ))}
                    </div>

                    {selectedThread.status !== "closed" && selectedThread.status !== "resolved" && (
                      <div style={{ marginTop: 12 }}>
                        <Input.TextArea
                          rows={3}
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Write a reply to this portal user..."
                        />
                        <Button
                          type="primary"
                          icon={<SendOutlined />}
                          loading={messageSending}
                          disabled={!replyText.trim()}
                          onClick={handleSendThreadReply}
                          style={{ marginTop: 8 }}
                        >
                          Send Reply
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </Card>
            </Col>
          </Row>
        )}
      </Modal>

      {/* Portal User Email Menu */}
      <Modal
        title={<Space><MailOutlined style={{ color: "#1a3353" }} />Email Portal User</Space>}
        open={emailUserModal.open}
        onCancel={() => {
          setEmailUserModal({ open: false, user: null });
          emailForm.resetFields();
        }}
        onOk={() => emailForm.submit()}
        confirmLoading={emailSending}
        okText="Send Email"
        width={720}
        destroyOnHidden
      >
        {emailUserModal.user && (
          <Form form={emailForm} layout="vertical" onFinish={handleSendPortalUserEmail}>
            <Descriptions column={1} size="small" style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Recipient">{emailUserModal.user.email}</Descriptions.Item>
              <Descriptions.Item label="Name">{emailUserModal.user.firstName} {emailUserModal.user.lastName}</Descriptions.Item>
            </Descriptions>
            <Form.Item name="templateType" label="Email Template" rules={[{ required: true, message: "Select a template" }]}>
              <Select onChange={handlePortalEmailTemplateChange}>
                <Option value="reminder">Send Reminder Email</Option>
                <Option value="followup">Follow-Up Email</Option>
                <Option value="holdFollowup">Send Follow-Up Requirements</Option>
                <Option value="newAttachment">New Attachment Request</Option>
                <Option value="revalidation">Revalidation Account Email</Option>
                <Option value="approvalNotice">Account Approval Notice</Option>
                <Option value="correctionRequest">Correction Request</Option>
                <Option value="custom">Custom Email</Option>
              </Select>
            </Form.Item>
            <Form.Item name="subject" label="Subject" rules={[{ required: true, message: "Enter a subject" }]}>
              <Input placeholder="Email subject" />
            </Form.Item>
            <Form.Item name="message" label="Message" rules={[{ required: true, message: "Enter a message" }]}>
              <Input.TextArea rows={8} placeholder="Write the email body..." />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Submission History */}
      <Modal
        title={<Space><HistoryOutlined style={{ color: "#1a3353" }} />See Portal Data</Space>}
        open={historyModal.open}
        onCancel={() => setHistoryModal({ open: false, user: null })}
        footer={<Button type="primary" onClick={() => setHistoryModal({ open: false, user: null })}>Close</Button>}
        width={1100}
        destroyOnHidden
      >
        {historyModal.user && (
          <Spin spinning={historyLoading}>
            <Descriptions column={{ xs: 1, sm: 2 }} size="small" style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Portal User">{historyModal.user.firstName} {historyModal.user.lastName}</Descriptions.Item>
              <Descriptions.Item label="Email">{historyModal.user.email}</Descriptions.Item>
            </Descriptions>
            <Tabs
              items={[
                {
                  key: "activity",
                  label: "Portal Activity",
                  children: (
                    <Space direction="vertical" size={14} style={{ width: "100%" }}>
                      <Row gutter={[12, 12]}>
                        <Col xs={24} md={6}><Card size="small"><Text type="secondary">Submissions</Text><br /><Text strong style={{ fontSize: 20 }}>{historyData.submissions.length}</Text></Card></Col>
                        <Col xs={24} md={6}><Card size="small"><Text type="secondary">Transactions</Text><br /><Text strong style={{ fontSize: 20 }}>{historyData.transactions.length}</Text></Card></Col>
                        <Col xs={24} md={6}><Card size="small"><Text type="secondary">Conversations</Text><br /><Text strong style={{ fontSize: 20 }}>{historyData.conversations.length}</Text></Card></Col>
                        <Col xs={24} md={6}><Card size="small"><Text type="secondary">Verification Files</Text><br /><Text strong style={{ fontSize: 20 }}>{(historyData.verificationHistory || []).length}</Text></Card></Col>
                      </Row>

                      {historyData.submissions.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No encoded submission data yet" />
                      ) : (
                        <Collapse
                          accordion
                          items={historyData.submissions.map((record, index) => ({
                            key: record._id || index,
                            label: (
                              <Space wrap>
                                <Text strong>{record.idNo || `Submission ${index + 1}`}</Text>
                                <Tag color={record.status === "acknowledged" ? "green" : record.status === "rejected" ? "red" : record.status === "reverted" ? "volcano" : "orange"}>{record.status || "pending"}</Tag>
                                <Text type="secondary">{record.lguCompanyName || record.slfName || "Encoded SLF Data"}</Text>
                              </Space>
                            ),
                            children: renderEncodedSubmission(record),
                          }))}
                        />
                      )}

                      <Collapse
                        defaultActiveKey={["recent-actions"]}
                        items={[{
                          key: "recent-actions",
                          label: (
                            <Space>
                              <ClockCircleOutlined />
                              <Text strong>Recent Actions</Text>
                              <Badge count={Math.min(historyData.activity.length, 12)} style={{ backgroundColor: "#1677ff" }} />
                            </Space>
                          ),
                          children: historyData.activity.length === 0 ? (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No activity recorded" />
                          ) : (
                            <ResponsiveTable
                              className="portal-user-wrap-table"
                              dataSource={historyData.activity.slice(0, 12)}
                              rowKey={(row, index) => `${row.type}-${row.createdAt}-${index}`}
                              pagination={true}
                              columns={[
                                { title: "Date", dataIndex: "createdAt", width: 150, render: (value) => wrapHistoryText(value ? dayjs(value).format("MM/DD/YYYY h:mm A") : "") },
                                { title: "Action", dataIndex: "title", width: 230, render: (value) => wrapHistoryText(value, true) },
                                { title: "Details", dataIndex: "description", width: 360, render: (value, row) => (
                                  <Space direction="vertical" size={3}>
                                    {wrapHistoryText(value)}
                                    {row.attachment && renderAttachments([row.attachment])}
                                    {renderAttachments(row.attachments)}
                                  </Space>
                                ) },
                                { title: "Assigned User", dataIndex: "actor", width: 180, render: (value) => wrapHistoryText(value) },
                              ]}
                            />
                          ),
                        }]}
                      />
                    </Space>
                  ),
                },
                {
                  key: "tracker",
                  label: "Submission Tracker",
                  children: (
                    <Table
                      className="portal-user-wrap-table"
                      dataSource={historyData.submissions}
                      rowKey="_id"
                      size="small"
                      pagination={{ pageSize: 8 }}
                      scroll={{ x: "max-content" }}
                      columns={[
                        { title: "ID No.", dataIndex: "idNo", key: "idNo", width: 140, render: (value) => wrapHistoryText(value, true) },
                        { title: "Company/LGU", dataIndex: "lguCompanyName", key: "lguCompanyName", width: 220, render: (value) => wrapHistoryText(value) },
                        { title: "Status", dataIndex: "status", key: "status", render: (value) => <Tag color={value === "acknowledged" ? "green" : value === "reverted" ? "volcano" : value === "rejected" ? "red" : "orange"}>{value || "pending"}</Tag> },
                        { title: "Date of Disposal", dataIndex: "dateOfDisposal", key: "dateOfDisposal", render: (value) => value ? dayjs(value).format("MM/DD/YYYY") : "—" },
                        { title: "Submitted", dataIndex: "createdAt", key: "createdAt", render: (value) => value ? dayjs(value).format("MM/DD/YYYY h:mm A") : "—" },
                        { title: "Revert Reason", dataIndex: "revertReason", key: "revertReason", width: 260, render: (value) => wrapHistoryText(value) },
                      ]}
                      expandable={{
                        expandedRowRender: (record) => {
                          const xxAlias = record.idNo?.replace(/^(SLF-[^-]+-)[^-]+(-.+)$/i, "$1XX$2");
                          const keys = [record.submissionId, record.idNo, xxAlias, ...(record.previousIdNos || [])].filter(Boolean);
                          const transactions = historyData.transactions.filter((txn) =>
                            keys.includes(txn.submissionId) ||
                            keys.includes(txn.meta?.idNo) ||
                            (txn.meta?.ids || []).some((id) => keys.includes(id)) ||
                            (txn.meta?.previousIdNos || []).some((id) => keys.includes(id)) ||
                            String(txn.dataEntry || "") === String(record._id || ""),
                          );
                          return transactions.length ? (
                            <Timeline
                              items={transactions.map((txn) => ({
                                color: txn.type === "deleted" ? "red" : txn.type?.includes("revert") ? "orange" : "blue",
                                children: (
                                  <div>
                                    <Text strong>{txn.description || txn.type}</Text>
                                    <div><Text type="secondary" style={{ fontSize: 12 }}>{dayjs(txn.createdAt).format("MMM D, YYYY h:mm A")} · {txn.performedBy || "system"}</Text></div>
                                  </div>
                                ),
                              }))}
                            />
                          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No tracker activity" />;
                        },
                      }}
                    />
                  ),
                },
                {
                  key: "verification",
                  label: "Verification Attachments",
                  children: (
                    <Table
                      className="portal-user-wrap-table"
                      dataSource={historyData.verificationHistory || []}
                      rowKey={(row, index) => row._id || `${row.fileUrl}-${index}`}
                      size="small"
                      pagination={{ pageSize: 8 }}
                      scroll={{ x: 900 }}
                      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No verification attachment history" /> }}
                      columns={[
                        {
                          title: "Date",
                          dataIndex: "submittedAt",
                          key: "submittedAt",
                          width: 150,
                          render: (value) => value ? <Text style={historyCellStyle}>{dayjs(value).format("MM/DD/YYYY h:mm A")}</Text> : wrapHistoryText("—"),
                        },
                        {
                          title: "Action",
                          dataIndex: "action",
                          key: "action",
                          width: 110,
                          render: (value) => <Tag color={value === "archived" ? "orange" : "blue"}>{(value || "submitted").toUpperCase()}</Tag>,
                        },
                        {
                          title: "Attachment",
                          dataIndex: "fileUrl",
                          key: "fileUrl",
                          width: 220,
                          render: (value, row) => value ? (
                            <a href={normalizeVerificationFileUrl(value)} target="_blank" rel="noopener noreferrer" style={historyCellStyle}>
                              {row.fileType === "image" ? "Image" : "Document"}
                            </a>
                          ) : wrapHistoryText("—"),
                        },
                        { title: "Office Email", dataIndex: "officeEmail", key: "officeEmail", width: 190, render: (value) => wrapHistoryText(value) },
                        { title: "PCO Email", dataIndex: "pcoEmail", key: "pcoEmail", width: 190, render: (value) => wrapHistoryText(value) },
                        { title: "Note", dataIndex: "note", key: "note", width: 260, render: (value) => wrapHistoryText(value) },
                      ]}
                    />
                  ),
                },
                {
                  key: "conversation",
                  label: "Conversation & Attachments",
                  children: historyData.conversations.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No conversations yet" />
                  ) : (
                    <Collapse
                      accordion
                      items={historyData.conversations.map((thread, index) => ({
                        key: thread._id || `${thread.ticketNo}-${index}`,
                        label: (
                          <Space wrap>
                            <MessageOutlined style={{ color: "#1677ff" }} />
                            <Text strong>{cleanText(thread.ticketNo || `Thread ${index + 1}`)}</Text>
                            <Text>{cleanText(thread.subject || "Conversation")}</Text>
                            <Tag>{cleanText(thread.status || "open")}</Tag>
                            {!!(thread.attachments || []).length && <Tag icon={<FileTextOutlined />}>{thread.attachments.length}</Tag>}
                          </Space>
                        ),
                        children: (
                          <Space direction="vertical" size={10} style={{ width: "100%" }}>
                            <div
                              style={{
                                padding: "10px 12px",
                                borderRadius: 8,
                                border: isDark ? "1px solid rgba(255,255,255,0.12)" : "1px solid #f0f0f0",
                                background: isDark ? "rgba(255,255,255,0.04)" : "#fafafa",
                              }}
                            >
                              <Space size={6} wrap>
                                <UserOutlined />
                                <Text strong>{cleanText(thread.source === "admin_message" ? "Admin" : thread.portalUserName || historyModal.user.firstName)}</Text>
                                <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(thread.createdAt).format("MMM D, YYYY h:mm A")}</Text>
                              </Space>
                              <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 6 }}>{cleanText(thread.message)}</div>
                              {renderAttachments(thread.attachments)}
                            </div>
                            {(thread.replies || []).map((reply) => (
                              <div
                                key={reply._id || `${reply.createdAt}-${reply.message}`}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: 8,
                                  border: reply.isAdmin
                                    ? (isDark ? "1px solid rgba(22,119,255,0.35)" : "1px solid #91caff")
                                    : (isDark ? "1px solid rgba(82,196,26,0.35)" : "1px solid #b7eb8f"),
                                  background: reply.isAdmin
                                    ? (isDark ? "rgba(22,119,255,0.14)" : "#e6f4ff")
                                    : (isDark ? "rgba(82,196,26,0.14)" : "#f6ffed"),
                                }}
                              >
                                <Space size={6} wrap>
                                  {reply.isAdmin ? <SendOutlined /> : <MessageOutlined />}
                                  <Text strong>{cleanText(reply.isAdmin ? "Admin" : reply.repliedByName || historyModal.user.firstName)}</Text>
                                  <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(reply.createdAt).format("MMM D, YYYY h:mm A")}</Text>
                                </Space>
                                <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 6 }}>{cleanText(reply.message)}</div>
                                {renderAttachments(reply.attachments)}
                              </div>
                            ))}
                          </Space>
                        ),
                      }))}
                    />
                  ),
                },
              ]}
            />
          </Spin>
        )}
      </Modal>

      {/* ─────────────────────────────────────────────────
           Detail Modal — redesigned
          ───────────────────────────────────────────────── */}
      <Modal
        title={null}
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, user: null })}
        footer={
          <Button type="primary" block onClick={() => setDetailModal({ open: false, user: null })}>
            Close
          </Button>
        }
        width={660}
        styles={{ body: { padding: "0 0 8px" } }}
      >
        {detailModal.user && (() => {
          const u = detailModal.user;
          const statusMeta = {
            pending:  { color: "orange", label: "Pending Approval" },
            approved: { color: "green",  label: "Approved" },
            rejected: { color: "red",    label: "Rejected" },
          };
          const sm = statusMeta[u.status] || statusMeta.pending;

          const slfNames = Array.isArray(u.assignedSlfName)
            ? u.assignedSlfName
            : u.assignedSlfName ? [u.assignedSlfName] : [];

          const isImage = u.verificationFileType === "image";

          return (
            <>
              {/* ── Hero header ── */}
              <div style={{
                background: isDark
                  ? "linear-gradient(135deg,#1a2a4a 0%,#1e3a5f 100%)"
                  : "linear-gradient(135deg,#1a3353 0%,#2563a8 100%)",
                borderRadius: "8px 8px 0 0",
                padding: "28px 24px 20px",
                textAlign: "center",
              }}>
                <Avatar
                  size={68}
                  icon={<UserOutlined />}
                  style={{ background: "rgba(255,255,255,0.18)", fontSize: 28, border: "3px solid rgba(255,255,255,0.4)" }}
                />
                <div style={{ marginTop: 10 }}>
                  <Text style={{ fontSize: 20, fontWeight: 700, color: "#fff", display: "block" }}>
                    {u.firstName} {u.lastName}
                  </Text>
                  <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.72)" }}>
                    {u.companyName || "No company / LGU"}
                  </Text>
                </div>
                {/* Status tags row */}
                <div style={{ marginTop: 12, display: "flex", justifyContent: "center", flexWrap: "wrap", gap: 6 }}>
                  <Tag color={sm.color} style={{ borderRadius: 12, padding: "2px 12px", fontWeight: 600 }}>
                    {sm.label}
                  </Tag>
                  {u.verificationRequired && !u.verificationSubmitted && (
                    <Tag color="orange" icon={<LockOutlined />} style={{ borderRadius: 12, padding: "2px 10px" }}>
                      HELD
                    </Tag>
                  )}
                  {u.verificationSubmitted && (
                    <Tag color="cyan" icon={<FileDoneOutlined />} style={{ borderRadius: 12, padding: "2px 10px" }}>
                      DOCS SUBMITTED
                    </Tag>
                  )}
                </div>
              </div>

              {/* ── Body ── */}
              <div style={{ padding: "16px 20px 0" }}>

                {/* Verification hold alert */}
                {u.status === "approved" && u.verificationRequired && (
                  <Alert
                    style={{ marginBottom: 14, borderRadius: 8 }}
                    type={u.verificationSubmitted ? "info" : "warning"}
                    showIcon
                    message={
                      u.verificationSubmitted
                        ? "Documents submitted — pending admin review"
                        : "Account on hold — user must re-submit verification before they can access the portal"
                    }
                    action={
                      u.verificationSubmitted
                        ? <Button size="small" type="primary" style={{ background: "#52c41a", borderColor: "#52c41a" }} onClick={() => handleReviewVerification(u)}>
                            Mark Reviewed
                          </Button>
                        : null
                    }
                  />
                )}

                {/* Section: Contact & Emails */}
                <div style={{ marginBottom: 14 }}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase" }}>
                    Contact Information
                  </Text>
                  <Card size="small" style={{ borderRadius: 8, marginTop: 6 }} bodyStyle={{ padding: "10px 14px" }}>
                    <Row gutter={[12, 10]}>
                      <Col xs={24} sm={12}>
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <MailOutlined style={{ color: "#1677ff", marginTop: 2 }} />
                          <div>
                            <Text type="secondary" style={{ fontSize: 11 }}>Personal Email</Text>
                            <div><Text style={{ fontSize: 13 }}>{u.email}</Text></div>
                          </div>
                        </div>
                      </Col>
                      <Col xs={24} sm={12}>
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <PhoneOutlined style={{ color: "#52c41a", marginTop: 2 }} />
                          <div>
                            <Text type="secondary" style={{ fontSize: 11 }}>Contact Number</Text>
                            <div><Text style={{ fontSize: 13 }}>{u.contactNumber || "—"}</Text></div>
                          </div>
                        </div>
                      </Col>
                      {(u.officeEmail || u.pcoEmail) && (
                        <>
                          <Col span={24}><Divider style={{ margin: "2px 0 4px" }} /></Col>
                          {u.officeEmail && (
                            <Col xs={24} sm={12}>
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <MailOutlined style={{ color: "#13c2c2", marginTop: 2 }} />
                                <div>
                                  <Text type="secondary" style={{ fontSize: 11 }}>Office Email</Text>
                                  <div><Text style={{ fontSize: 13 }}>{u.officeEmail}</Text></div>
                                </div>
                              </div>
                            </Col>
                          )}
                          {u.pcoEmail && (
                            <Col xs={24} sm={12}>
                              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <MailOutlined style={{ color: "#722ed1", marginTop: 2 }} />
                                <div>
                                  <Text type="secondary" style={{ fontSize: 11 }}>PCO Email</Text>
                                  <div><Text style={{ fontSize: 13 }}>{u.pcoEmail}</Text></div>
                                </div>
                              </div>
                            </Col>
                          )}
                        </>
                      )}
                    </Row>
                  </Card>
                </div>

                {/* Section: Assigned SLF */}
                <div style={{ marginBottom: 14 }}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase" }}>
                    <EnvironmentOutlined style={{ marginRight: 4 }} />Assigned SLF Facilit{slfNames.length === 1 ? "y" : "ies"}
                  </Text>
                  <Card size="small" style={{ borderRadius: 8, marginTop: 6 }} bodyStyle={{ padding: "10px 14px" }}>
                    {slfNames.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {slfNames.map((n, i) => (
                          <Tag key={i} color="blue" style={{ margin: 0, fontSize: 12, padding: "2px 10px", whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.45 }}>{n}</Tag>
                        ))}
                      </div>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 13 }}>Not yet assigned</Text>
                    )}
                  </Card>
                </div>

                {/* Section: Verification Attachment */}
                <div style={{ marginBottom: 14 }}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase" }}>
                    <SafetyCertificateOutlined style={{ marginRight: 4 }} />Verification Attachment
                  </Text>
                  {u.verificationFileUrl ? (
                    <Card
                      size="small"
                      style={{ borderRadius: 8, marginTop: 6, border: "1px solid #d9d9d9", overflow: "hidden" }}
                      bodyStyle={{ padding: 0 }}
                    >
                      {/* Image preview */}
                      {isImage && (
                        <div style={{
                          background: "#000",
                          textAlign: "center",
                          maxHeight: 240,
                          overflow: "hidden",
                          borderRadius: "8px 8px 0 0",
                        }}>
                          <img
                            src={normalizeVerificationFileUrl(u.verificationFileUrl)}
                            alt="Verification attachment"
                            style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain", display: "block", margin: "0 auto" }}
                            onError={(e) => { e.target.style.display = "none"; }}
                          />
                        </div>
                      )}
                      {/* File info row */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        background: isDark ? "rgba(255,255,255,0.04)" : "#fafafa",
                        borderTop: isImage ? "1px solid #f0f0f0" : "none",
                        borderRadius: isImage ? 0 : 8,
                        gap: 10,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {isImage
                            ? <FileImageOutlined style={{ fontSize: 22, color: "#1677ff" }} />
                            : <FileTextOutlined style={{ fontSize: 22, color: "#52c41a" }} />
                          }
                          <div>
                            <Text style={{ fontSize: 13, fontWeight: 500 }}>
                              {isImage ? "Image File" : "Document File"}
                            </Text>
                            <div>
                              <Tag color={isImage ? "cyan" : "green"} style={{ fontSize: 11, margin: 0 }}>
                                {u.verificationFileType?.toUpperCase() || "FILE"}
                              </Tag>
                            </div>
                          </div>
                        </div>
                        <a
                          href={normalizeVerificationFileUrl(u.verificationFileUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button size="small" icon={<LinkOutlined />} type="primary">
                            Open in Drive
                          </Button>
                        </a>
                      </div>
                    </Card>
                  ) : (
                    <Card size="small" style={{ borderRadius: 8, marginTop: 6 }} bodyStyle={{ padding: "10px 14px" }}>
                      <Text type="secondary" style={{ fontSize: 13 }}>No attachment uploaded</Text>
                    </Card>
                  )}
                </div>

                {/* Section: Timeline */}
                <div style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: "uppercase" }}>
                    <ClockCircleOutlined style={{ marginRight: 4 }} />Activity
                  </Text>
                  <Collapse
                    style={{ marginTop: 6 }}
                    items={[{
                      key: "activity",
                      label: <Text strong style={{ fontSize: 12 }}>Account and portal activity</Text>,
                      children: detailActivity.loading ? (
                        <div style={{ textAlign: "center", padding: "16px 0" }}><Spin size="small" /></div>
                      ) : (
                        <Timeline
                          size="small"
                          items={(detailActivity.items.length ? detailActivity.items.slice(0, 8) : [
                            { type: "account_registered", title: "Registered", createdAt: u.createdAt },
                            ...(u.approvedAt ? [{ type: "account_approved", title: "Approved", createdAt: u.approvedAt }] : []),
                            ...(u.rejectedReason ? [{ type: "account_rejected", title: "Rejected", description: u.rejectedReason, createdAt: u.updatedAt }] : []),
                          ]).map((item, index) => ({
                            color: item.type?.includes("verification") ? "cyan" : item.type?.includes("conversation") ? "blue" : item.type?.includes("rejected") ? "red" : "green",
                            children: (
                              <div key={`${item.type}-${item.createdAt}-${index}`}>
                                <Text style={{ fontSize: 12, fontWeight: 500 }}>{cleanText(item.title)}</Text>
                                {item.description && (
                                  <div style={{ fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{cleanText(item.description)}</div>
                                )}
                                <div><Text type="secondary" style={{ fontSize: 11 }}>{item.createdAt ? dayjs(item.createdAt).format("MMM D, YYYY h:mm A") : ""}</Text></div>
                              </div>
                            ),
                          }))}
                        />
                      ),
                    }]}
                  />
                </div>

              </div>{/* /body */}
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
