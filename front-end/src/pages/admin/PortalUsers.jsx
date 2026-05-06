import { useState, useEffect, useMemo } from "react";
import {
  Table, Tag, Button, Space, Modal, Select, Typography,
  Empty, Tooltip, Badge, Card, Descriptions, Avatar,
  Divider, Row, Col, Timeline, Alert, Dropdown, Form,
  Input, List, Spin,
} from "antd";
import {
  CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined,
  EditOutlined, EyeOutlined, ReloadOutlined, UserOutlined,
  MailOutlined, PhoneOutlined, BankOutlined, CalendarOutlined,
  EnvironmentOutlined, ClockCircleOutlined, LockOutlined,
  UnlockOutlined, BellOutlined, FileDoneOutlined, LinkOutlined,
  FileTextOutlined, FileImageOutlined, SafetyCertificateOutlined,
  MessageOutlined, MoreOutlined, SendOutlined,
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
  const [holdLoading, setHoldLoading] = useState(false);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [messageModal, setMessageModal] = useState({ open: false, user: null });
  const [messageThreads, setMessageThreads] = useState([]);
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageSending, setMessageSending] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [messageForm] = Form.useForm();

  useEffect(() => {
    fetchData();
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

  const handleHold = async (record) => {
    const result = await Swal.fire({
      title: "Put Account On Hold?",
      html: `This will require <strong>${record.firstName} ${record.lastName}</strong> to re-upload their verification documents the next time they log in.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#fa8c16",
      confirmButtonText: "Yes, Hold Account",
    });
    if (!result.isConfirmed) return;
    setHoldLoading(true);
    try {
      await api.patch(`/portal-users/${record._id}/hold`);
      Swal.fire({ icon: "success", title: "Account On Hold", text: "The user will be prompted to verify on next login.", confirmButtonColor: "#1a3353" });
      fetchData();
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
      await api.patch(`/portal-users/${record._id}/unhold`);
      Swal.fire({ icon: "success", title: "Hold Removed", confirmButtonColor: "#1a3353" });
      fetchData();
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to remove hold", "error");
    }
  };

  const handleSendHoldFollowUp = async (record) => {
    const result = await Swal.fire({
      title: "Send Hold Account Follow-Up?",
      html: `A follow-up email with document requirements will be sent to <strong>${record.email}</strong>.`,
      icon: "info",
      showCancelButton: true,
      confirmButtonColor: "#1a3353",
      confirmButtonText: "Send Email",
    });
    if (!result.isConfirmed) return;
    setReminderLoading(true);
    try {
      await api.post(`/portal-users/${record._id}/send-hold-followup`);
      Swal.fire({ icon: "success", title: "Follow-Up Email Sent", text: `Email sent to ${record.email}.`, confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to send follow-up email", "error");
    } finally {
      setReminderLoading(false);
    }
  };

  const handleSendReminder = async (record) => {
    const result = await Swal.fire({
      title: "Send Verification Reminder?",
      html: `An email reminder will be sent to <strong>${record.email}</strong> asking them to update their verification information.`,
      icon: "info",
      showCancelButton: true,
      confirmButtonColor: "#1a3353",
      confirmButtonText: "Send Email",
    });
    if (!result.isConfirmed) return;
    setReminderLoading(true);
    try {
      await api.post(`/portal-users/${record._id}/send-reminder`);
      Swal.fire({ icon: "success", title: "Reminder Sent", text: `Email sent to ${record.email}.`, confirmButtonColor: "#1a3353" });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to send reminder", "error");
    } finally {
      setReminderLoading(false);
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
      await api.patch(`/portal-users/${record._id}/review-verification`);
      Swal.fire({ icon: "success", title: "Verification Reviewed", confirmButtonColor: "#1a3353" });
      fetchData();
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
      render: (v, record) => (
        <Space size={4} wrap>
          <Tag color={statusColor[v]}>{v?.toUpperCase()}</Tag>
          {record.verificationRequired && !record.verificationSubmitted && (
            <Tag color="orange" icon={<LockOutlined />}>HELD</Tag>
          )}
          {record.verificationSubmitted && (
            <Tag color="blue" icon={<FileDoneOutlined />}>DOCS SUBMITTED</Tag>
          )}
        </Space>
      ),
    },
    {
      title: "Attachments",
      key: "attachments",
      width: 150,
      render: (_, record) => record.verificationFileUrl ? (
        <a href={record.verificationFileUrl} target="_blank" rel="noopener noreferrer">
          <Button
            size="small"
            type="link"
            icon={record.verificationFileType === "image" ? <FileImageOutlined /> : <FileTextOutlined />}
            style={{ paddingInline: 0 }}
          >
            {record.verificationFileType === "image" ? "Image" : "Document"}
          </Button>
        </a>
      ) : <Text type="secondary">No file</Text>,
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
          { type: "divider" },
          record.status === "pending" && { key: "approve", icon: <CheckCircleOutlined />, label: "Approve" },
          record.status === "pending" && { key: "reject", icon: <CloseCircleOutlined />, label: "Reject", danger: true },
          record.status === "approved" && { key: "edit-slf", icon: <EditOutlined />, label: "Edit Assigned SLF" },
          record.status === "approved" && {
            key: record.verificationRequired ? "unhold" : "hold",
            icon: record.verificationRequired ? <UnlockOutlined /> : <LockOutlined />,
            label: record.verificationRequired ? "Remove Hold" : "Hold Account",
          },
          record.status === "approved" && { key: "reminder", icon: <BellOutlined />, label: "Send Reminder Email" },
          record.verificationRequired && !record.verificationSubmitted && { key: "hold-followup", icon: <MailOutlined />, label: "Send Hold Follow-Up" },
          record.verificationSubmitted && { key: "review", icon: <FileDoneOutlined />, label: "Mark Verification Reviewed" },
          { type: "divider" },
          { key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true },
        ].filter(Boolean);

        return (
          <Dropdown
            trigger={["click"]}
            menu={{
              items: actionItems,
              onClick: ({ key }) => {
                if (key === "view") setDetailModal({ open: true, user: record });
                if (key === "message") openMessageManager(record);
                if (key === "approve") { setSelectedSlf([]); setApproveModal({ open: true, user: record }); }
                if (key === "reject") handleReject(record);
                if (key === "edit-slf") openEditSlfAssignment(record);
                if (key === "hold") handleHold(record);
                if (key === "unhold") handleUnhold(record);
                if (key === "reminder") handleSendReminder(record);
                if (key === "hold-followup") handleSendHoldFollowUp(record);
                if (key === "review") handleReviewVerification(record);
                if (key === "delete") handleDelete(record);
              },
            }}
          >
            <Button size="small" icon={<MoreOutlined />}>
              Actions
            </Button>
          </Dropdown>
        );
      },
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
        scroll={{ x: 1050 }}
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

      {/* ─────────────────────────────────────────────────
           Detail Modal — redesigned
          ───────────────────────────────────────────────── */}
      <Modal
        title={null}
        open={detailModal.open}
        onCancel={() => setDetailModal({ open: false, user: null })}
        footer={
          <Button block onClick={() => setDetailModal({ open: false, user: null })}>
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
                          <Tag key={i} color="blue" style={{ margin: 0, fontSize: 12, padding: "2px 10px" }}>{n}</Tag>
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
                            src={u.verificationFileUrl}
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
                          href={u.verificationFileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button size="small" icon={<LinkOutlined />} type="primary" ghost>
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
                  <Card size="small" style={{ borderRadius: 8, marginTop: 6 }} bodyStyle={{ padding: "12px 14px 4px" }}>
                    <Timeline
                      size="small"
                      items={[
                        {
                          color: "blue",
                          children: (
                            <>
                              <Text style={{ fontSize: 12, fontWeight: 500 }}>Registered</Text>
                              <div><Text type="secondary" style={{ fontSize: 11 }}>{dayjs(u.createdAt).format("MMM D, YYYY h:mm A")}</Text></div>
                            </>
                          ),
                        },
                        ...(u.approvedAt ? [{
                          color: "green",
                          children: (
                            <>
                              <Text style={{ fontSize: 12, fontWeight: 500 }}>Approved</Text>
                              <div><Text type="secondary" style={{ fontSize: 11 }}>{dayjs(u.approvedAt).format("MMM D, YYYY h:mm A")}</Text></div>
                            </>
                          ),
                        }] : []),
                        ...(u.rejectedReason ? [{
                          color: "red",
                          children: (
                            <>
                              <Text style={{ fontSize: 12, fontWeight: 500 }}>Rejected</Text>
                              <div><Text type="secondary" style={{ fontSize: 11 }}>{u.rejectedReason}</Text></div>
                            </>
                          ),
                        }] : []),
                        ...(u.verificationRequired ? [{
                          color: "orange",
                          children: (
                            <>
                              <Text style={{ fontSize: 12, fontWeight: 500 }}>Put On Hold</Text>
                              <div><Text type="secondary" style={{ fontSize: 11 }}>Admin required re-verification</Text></div>
                            </>
                          ),
                        }] : []),
                        ...(u.verificationSubmitted ? [{
                          color: "cyan",
                          children: (
                            <>
                              <Text style={{ fontSize: 12, fontWeight: 500 }}>Docs Submitted</Text>
                              <div><Text type="secondary" style={{ fontSize: 11 }}>Awaiting admin review</Text></div>
                            </>
                          ),
                        }] : []),
                      ]}
                    />
                  </Card>
                </div>

              </div>{/* /body */}
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
