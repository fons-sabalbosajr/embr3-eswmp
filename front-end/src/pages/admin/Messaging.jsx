import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message as antdMessage,
} from "antd";
import {
  DeleteOutlined,
  FileAddOutlined,
  InboxOutlined,
  LinkOutlined,
  MailOutlined,
  PaperClipOutlined,
  PlusOutlined,
  RedoOutlined,
  SaveOutlined,
  SendOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import api from "../../api";
import { connectSocket, getSocket } from "../../utils/socket";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const folders = [
  { key: "inbox", label: "Inbox", icon: <InboxOutlined /> },
  { key: "sent", label: "Sent Items", icon: <SendOutlined /> },
  { key: "drafts", label: "Drafts", icon: <SaveOutlined /> },
  { key: "deleted", label: "Deleted Messages", icon: <DeleteOutlined /> },
];

const appModules = [
  "SLF Monitoring",
  "Portal Submissions",
  "Ten-Year SWM Plan",
  "Funded MRF",
  "Open Dump Sites",
  "Transfer Stations",
  "Technical Assistance",
  "Data References",
  "Support Tickets",
];

function userIdOf(user) {
  return String(user?.id || user?._id || "");
}

function userName(user) {
  if (!user) return "Unknown User";
  const fullName = `${user.firstName || ""} ${user.lastName || ""}`.trim();
  return fullName || user.username || user.email || "Unknown User";
}

function initials(user) {
  const name = userName(user);
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function senderId(message) {
  return String(message?.sender?._id || message?.sender || "");
}

function lastPreview(thread) {
  if (thread.draft) return thread.draft.body || "Draft message";
  if (thread.lastMessage?.body) return thread.lastMessage.body;
  if (thread.lastMessage?.attachments?.length) return "Attachment sent";
  if (thread.lastMessage?.appLinks?.length) return "App data attached";
  return "No messages yet";
}

export default function Messaging({ isDark, currentUser }) {
  const [folder, setFolder] = useState("inbox");
  const [threads, setThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [replyAppLinks, setReplyAppLinks] = useState([]);
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [composeAppLinks, setComposeAppLinks] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [composeForm] = Form.useForm();
  const [appLinkForm] = Form.useForm();
  const [replyLinkForm] = Form.useForm();

  const currentUserId = userIdOf(currentUser);
  const selectedFolder = folders.find((item) => item.key === folder) || folders[0];

  const userOptions = useMemo(
    () => users
      .filter((user) => String(user._id) !== currentUserId)
      .map((user) => ({
        value: user._id,
        label: `${userName(user)} (${user.email})`,
      })),
    [users, currentUserId]
  );

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await api.get("/messages/users");
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Unable to load users");
    }
  }, []);

  const fetchThreads = useCallback(async (nextFolder = folder) => {
    try {
      setLoading(true);
      const { data } = await api.get(`/messages/conversations?folder=${nextFolder}`);
      setThreads(Array.isArray(data) ? data : []);
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Unable to load messages");
    } finally {
      setLoading(false);
    }
  }, [folder]);

  const openThread = useCallback(async (threadId) => {
    try {
      setDetailLoading(true);
      const { data } = await api.get(`/messages/conversations/${threadId}`);
      setSelectedThread(data);
      if (data.unreadCount > 0) {
        await api.patch(`/messages/conversations/${threadId}/read`);
        fetchThreads();
      }
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Unable to open conversation");
    } finally {
      setDetailLoading(false);
    }
  }, [fetchThreads]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchThreads(folder);
    setSelectedThread(null);
  }, [folder, fetchThreads]);

  useEffect(() => {
    const socket = getSocket() || connectSocket("admin", {
      email: currentUser?.email,
      userId: currentUserId,
    });

    const refreshMessages = (payload = {}) => {
      fetchThreads();
      if (selectedThread?._id && (!payload.threadId || String(payload.threadId) === String(selectedThread._id))) {
        openThread(selectedThread._id);
      }
    };

    const handleInternalMessage = (payload) => {
      if (payload?.title) antdMessage.info(payload.title);
      refreshMessages(payload);
    };

    socket.on("internal-message", handleInternalMessage);
    socket.on("message-refresh", refreshMessages);
    return () => {
      socket.off("internal-message", handleInternalMessage);
      socket.off("message-refresh", refreshMessages);
    };
  }, [currentUser?.email, currentUserId, fetchThreads, openThread, selectedThread?._id]);

  const uploadFile = async (file, target) => {
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const attachment = {
        name: data.name || file.name,
        url: data.url,
        fileId: data.fileId,
        mimeType: data.mimeType || file.type,
        source: "local",
      };
      if (target === "reply") setReplyAttachments((prev) => [...prev, attachment]);
      else setComposeAttachments((prev) => [...prev, attachment]);
      antdMessage.success("Attachment uploaded");
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
    return false;
  };

  const addAppLink = async (target) => {
    const form = target === "reply" ? replyLinkForm : appLinkForm;
    const values = await form.validateFields();
    const link = {
      module: values.module,
      label: values.label,
      recordId: values.recordId || "",
      url: values.url || "",
    };
    if (target === "reply") setReplyAppLinks((prev) => [...prev, link]);
    else setComposeAppLinks((prev) => [...prev, link]);
    form.resetFields();
  };

  const removeAttachment = (target, index) => {
    if (target === "reply") setReplyAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    else setComposeAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const removeAppLink = (target, index) => {
    if (target === "reply") setReplyAppLinks((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    else setComposeAppLinks((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const resetCompose = () => {
    composeForm.resetFields();
    appLinkForm.resetFields();
    setComposeAttachments([]);
    setComposeAppLinks([]);
  };

  const submitCompose = async (asDraft = false) => {
    try {
      const values = await composeForm.validateFields();
      await api.post("/messages/conversations", {
        subject: values.subject,
        participantIds: values.participantIds,
        body: values.body || "",
        attachments: composeAttachments,
        appLinks: composeAppLinks,
        draft: asDraft,
      });
      antdMessage.success(asDraft ? "Draft saved" : "Message sent");
      setComposeOpen(false);
      resetCompose();
      setFolder(asDraft ? "drafts" : "sent");
      fetchThreads(asDraft ? "drafts" : "sent");
    } catch (error) {
      if (error.errorFields) return;
      antdMessage.error(error.response?.data?.message || "Unable to send message");
    }
  };

  const sendReply = async () => {
    if (!selectedThread) return;
    if (!replyBody.trim() && replyAttachments.length === 0 && replyAppLinks.length === 0) {
      antdMessage.warning("Add a message, attachment, or app data before sending");
      return;
    }
    try {
      await api.post(`/messages/conversations/${selectedThread._id}/messages`, {
        body: replyBody,
        attachments: replyAttachments,
        appLinks: replyAppLinks,
      });
      setReplyBody("");
      setReplyAttachments([]);
      setReplyAppLinks([]);
      replyLinkForm.resetFields();
      antdMessage.success("Message sent");
      openThread(selectedThread._id);
      fetchThreads();
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Unable to send reply");
    }
  };

  const sendDraft = async (thread) => {
    try {
      await api.post(`/messages/conversations/${thread._id}/send-draft`);
      antdMessage.success("Draft sent");
      setFolder("sent");
      fetchThreads("sent");
      setSelectedThread(null);
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Unable to send draft");
    }
  };

  const deleteThread = async (thread) => {
    Modal.confirm({
      title: "Move conversation to Deleted Messages?",
      content: "This only removes the conversation from your folders. Other participants keep their copy.",
      okText: "Move to Deleted",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.patch(`/messages/conversations/${thread._id}/delete`);
        antdMessage.success("Conversation moved to deleted messages");
        setSelectedThread(null);
        fetchThreads();
      },
    });
  };

  const restoreThread = async (thread) => {
    try {
      await api.patch(`/messages/conversations/${thread._id}/restore`);
      antdMessage.success("Conversation restored");
      setSelectedThread(null);
      fetchThreads();
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Unable to restore message");
    }
  };

  const discardDraft = async (thread) => {
    try {
      await api.delete(`/messages/conversations/${thread._id}/draft`);
      antdMessage.success("Draft discarded");
      setSelectedThread(null);
      fetchThreads();
    } catch (error) {
      antdMessage.error(error.response?.data?.message || "Unable to discard draft");
    }
  };

  const folderCounts = useMemo(() => ({
    inbox: threads.reduce((total, thread) => total + (thread.unreadCount || 0), 0),
  }), [threads]);

  const filteredThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => {
      const participants = (thread.participants || []).map(userName).join(" ");
      return [thread.subject, participants, lastPreview(thread)].some((value) => (value || "").toLowerCase().includes(query));
    });
  }, [threads, threadSearch]);

  const selectedParticipants = useMemo(
    () => (selectedThread?.participants || []).filter((participant) => String(participant._id) !== currentUserId),
    [selectedThread?.participants, currentUserId]
  );

  const columns = [
    {
      title: "Conversation",
      dataIndex: "subject",
      render: (_, thread) => {
        const recipients = (thread.participants || []).filter((participant) => String(participant._id) !== currentUserId);
        return (
          <div style={{ minWidth: 0 }}>
            <Space size={8} wrap>
              <Text strong={thread.unreadCount > 0}>{thread.subject}</Text>
              <Tag color={thread.type === "group" ? "geekblue" : "green"}>{thread.type === "group" ? "Group" : "Individual"}</Tag>
              {thread.unreadCount > 0 && <Badge count={thread.unreadCount} />}
            </Space>
            <Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }} ellipsis>
              {recipients.map(userName).join(", ") || "Only you"}
            </Text>
            <Paragraph type="secondary" ellipsis={{ rows: 1 }} style={{ margin: "4px 0 0", fontSize: 12 }}>
              {lastPreview(thread)}
            </Paragraph>
          </div>
        );
      },
    },
    {
      title: "Updated",
      dataIndex: "lastMessageAt",
      width: 150,
      responsive: ["md"],
      render: (value, thread) => dayjs(thread.draft?.updatedAt || value || thread.updatedAt).format("MMM D, h:mm A"),
    },
    {
      title: "Actions",
      width: 150,
      render: (_, thread) => (
        <Space size={4}>
          {folder === "drafts" && <Tooltip title="Send draft"><Button size="small" icon={<SendOutlined />} onClick={(event) => { event.stopPropagation(); sendDraft(thread); }} /></Tooltip>}
          {folder === "drafts" && <Tooltip title="Discard draft"><Button size="small" danger icon={<DeleteOutlined />} onClick={(event) => { event.stopPropagation(); discardDraft(thread); }} /></Tooltip>}
          {folder === "deleted" ? (
            <Tooltip title="Restore"><Button size="small" icon={<RedoOutlined />} onClick={(event) => { event.stopPropagation(); restoreThread(thread); }} /></Tooltip>
          ) : (
            <Tooltip title="Delete"><Button size="small" danger icon={<DeleteOutlined />} onClick={(event) => { event.stopPropagation(); deleteThread(thread); }} /></Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const renderAttachmentTags = (items, target) => (
    <Space size={[6, 6]} wrap style={{ marginTop: items.length ? 8 : 0 }}>
      {items.map((item, index) => (
        <Tag key={`${item.url}-${index}`} closable onClose={() => removeAttachment(target, index)} icon={<PaperClipOutlined />}>
          {item.name || "Attachment"}
        </Tag>
      ))}
    </Space>
  );

  const renderAppLinkTags = (items, target) => (
    <Space size={[6, 6]} wrap style={{ marginTop: items.length ? 8 : 0 }}>
      {items.map((item, index) => (
        <Tag key={`${item.label}-${index}`} closable onClose={() => removeAppLink(target, index)} icon={<LinkOutlined />} color="blue">
          {item.module}: {item.label}
        </Tag>
      ))}
    </Space>
  );

  const appDataForm = (target) => (
    <Form form={target === "reply" ? replyLinkForm : appLinkForm} layout="vertical" size="small" style={{ marginTop: 8 }}>
      <Row gutter={8}>
        <Col xs={24} md={8}>
          <Form.Item name="module" rules={[{ required: true, message: "Select module" }]} style={{ marginBottom: 8 }}>
            <Select placeholder="App module" options={appModules.map((module) => ({ value: module, label: module }))} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item name="label" rules={[{ required: true, message: "Enter label" }]} style={{ marginBottom: 8 }}>
            <Input placeholder="Record or file label" />
          </Form.Item>
        </Col>
        <Col xs={24} md={5}>
          <Form.Item name="recordId" style={{ marginBottom: 8 }}>
            <Input placeholder="Record ID" />
          </Form.Item>
        </Col>
        <Col xs={24} md={3}>
          <Button block icon={<FileAddOutlined />} onClick={() => addAppLink(target)}>Add</Button>
        </Col>
      </Row>
      <Form.Item name="url" style={{ marginBottom: 0 }}>
        <Input placeholder="Optional app file or record URL" />
      </Form.Item>
    </Form>
  );

  return (
    <div style={{ padding: 24, minHeight: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>Messaging</Title>
          <Text type="secondary">Secure internal conversations for EMBR3 ESWMP app users</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setComposeOpen(true)}>Compose</Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8} xl={7}>
          <div style={{ background: isDark ? "#141414" : "#fff", border: isDark ? "1px solid #303030" : "1px solid #e6edf5", borderRadius: 8, minHeight: 650, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 14, borderBottom: isDark ? "1px solid #303030" : "1px solid #eef2f7" }}>
              <Space.Compact block style={{ marginBottom: 12 }}>
                {folders.map((item) => (
                  <Tooltip title={item.label} key={item.key}>
                    <Button
                      type={folder === item.key ? "primary" : "default"}
                      icon={item.icon}
                      onClick={() => setFolder(item.key)}
                      style={{ flex: 1 }}
                    >
                      {item.key === "inbox" && folderCounts.inbox > 0 ? <Badge count={folderCounts.inbox} size="small" /> : null}
                    </Button>
                  </Tooltip>
                ))}
              </Space.Compact>
              <Input.Search
                allowClear
                value={threadSearch}
                onChange={(event) => setThreadSearch(event.target.value)}
                placeholder="Search conversations"
              />
            </div>

            <div style={{ padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Space>{selectedFolder.icon}<Text strong>{selectedFolder.label}</Text></Space>
              <Button size="small" onClick={() => fetchThreads()} icon={<RedoOutlined />} loading={loading} />
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
              {loading && filteredThreads.length === 0 ? (
                <div style={{ padding: 12 }}><Spin /></div>
              ) : filteredThreads.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No conversations" style={{ padding: "48px 0" }} />
              ) : (
                <List
                  dataSource={filteredThreads}
                  renderItem={(thread) => {
                    const active = selectedThread?._id === thread._id;
                    const recipients = (thread.participants || []).filter((participant) => String(participant._id) !== currentUserId);
                    const unread = thread.unreadCount > 0;
                    return (
                      <div
                        key={thread._id}
                        onClick={() => openThread(thread._id)}
                        style={{
                          display: "flex",
                          gap: 10,
                          padding: "10px 10px",
                          borderRadius: 8,
                          cursor: "pointer",
                          background: active ? (isDark ? "#10213a" : "#e6f4ff") : unread ? (isDark ? "rgba(47,84,235,0.08)" : "#f0f5ff") : "transparent",
                          marginBottom: 4,
                        }}
                      >
                        <Badge dot={unread} offset={[-2, 4]}>
                          <Avatar size={44} style={{ background: thread.type === "group" ? "#2f54eb" : "#13c2c2" }} icon={thread.type === "group" ? <TeamOutlined /> : <UserOutlined />}>
                            {recipients[0] ? initials(recipients[0]) : null}
                          </Avatar>
                        </Badge>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <Text strong={unread || active} ellipsis style={{ fontSize: 13 }}>{thread.subject}</Text>
                            <Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{dayjs(thread.draft?.updatedAt || thread.lastMessageAt || thread.updatedAt).format("MMM D")}</Text>
                          </div>
                          <Text type="secondary" ellipsis style={{ display: "block", fontSize: 12 }}>{recipients.map(userName).join(", ") || "Only you"}</Text>
                          <Text type="secondary" ellipsis style={{ display: "block", fontSize: 12 }}>{lastPreview(thread)}</Text>
                          <Space size={4} style={{ marginTop: 4 }}>
                            <Tag color={thread.type === "group" ? "geekblue" : "green"} style={{ margin: 0, fontSize: 10 }}>{thread.type === "group" ? "Group" : "Direct"}</Tag>
                            {unread && <Badge count={thread.unreadCount} size="small" />}
                            {folder === "drafts" && <Tag color="gold" style={{ margin: 0, fontSize: 10 }}>Draft</Tag>}
                          </Space>
                        </div>
                      </div>
                    );
                  }}
                />
              )}
            </div>
          </div>
        </Col>

        <Col xs={24} lg={16} xl={17}>
          <div style={{ background: isDark ? "#141414" : "#fff", border: isDark ? "1px solid #303030" : "1px solid #e6edf5", borderRadius: 8, minHeight: 650, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {!selectedThread ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: isDark ? "#111" : "#f7f9fc" }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose a conversation to start chatting" />
              </div>
            ) : detailLoading ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}><Spin /></div>
            ) : (
              <>
                <div style={{ padding: "14px 18px", borderBottom: isDark ? "1px solid #303030" : "1px solid #eef2f7", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <Space size={12} style={{ minWidth: 0 }}>
                    <Avatar size={44} style={{ background: selectedThread.type === "group" ? "#2f54eb" : "#13c2c2" }} icon={selectedThread.type === "group" ? <TeamOutlined /> : <UserOutlined />} />
                    <div style={{ minWidth: 0 }}>
                      <Text strong style={{ fontSize: 16 }} ellipsis>{selectedThread.subject}</Text>
                      <Text type="secondary" style={{ display: "block", fontSize: 12 }} ellipsis>
                        {selectedParticipants.length ? selectedParticipants.map(userName).join(", ") : "Only you"}
                      </Text>
                    </div>
                  </Space>
                  <Space>
                    {folder === "drafts" && <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => sendDraft(selectedThread)}>Send Draft</Button>}
                    {folder === "drafts" && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => discardDraft(selectedThread)}>Discard</Button>}
                    {folder === "deleted" ? (
                      <Button size="small" icon={<RedoOutlined />} onClick={() => restoreThread(selectedThread)}>Restore</Button>
                    ) : (
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteThread(selectedThread)}>Delete</Button>
                    )}
                  </Space>
                </div>

                <div style={{ flex: 1, padding: 18, overflowY: "auto", maxHeight: 470, background: isDark ? "#101418" : "#f7f9fc" }}>
                  {selectedThread.draft && folder === "drafts" && (
                    <div style={{ padding: 12, border: "1px dashed #faad14", borderRadius: 8, marginBottom: 16, background: isDark ? "rgba(250,173,20,0.08)" : "#fffbe6" }}>
                      <Text strong>Draft</Text>
                      <Paragraph style={{ margin: "8px 0" }}>{selectedThread.draft.body || "No draft text"}</Paragraph>
                    </div>
                  )}

                  <List
                    dataSource={selectedThread.messages || []}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No sent messages yet" /> }}
                    renderItem={(item) => {
                      const mine = senderId(item) === currentUserId;
                      return (
                        <List.Item style={{ border: 0, justifyContent: mine ? "flex-end" : "flex-start", padding: "7px 0" }}>
                          <div style={{ display: "flex", flexDirection: mine ? "row-reverse" : "row", gap: 10, maxWidth: "78%" }}>
                            <Avatar size={34} style={{ background: mine ? "#1a3353" : "#1677ff", flexShrink: 0 }}>{initials(item.sender)}</Avatar>
                            <div>
                              <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 3 }}>
                                <Text type="secondary" style={{ fontSize: 11 }}>{mine ? "You" : userName(item.sender)} • {dayjs(item.createdAt).format("MMM D, h:mm A")}</Text>
                              </div>
                              <div style={{ background: mine ? "#1677ff" : (isDark ? "#1f1f1f" : "#fff"), color: mine ? "#fff" : undefined, border: mine ? "1px solid #1677ff" : (isDark ? "1px solid #303030" : "1px solid #e6edf5"), borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px", padding: "10px 14px", minWidth: 140, boxShadow: isDark ? "none" : "0 1px 2px rgba(15, 23, 42, 0.05)" }}>
                                {item.body && <Paragraph style={{ marginBottom: 8, whiteSpace: "pre-wrap", color: mine ? "#fff" : undefined }}>{item.body}</Paragraph>}
                                {(item.attachments || []).length > 0 && (
                                  <Space size={[6, 6]} wrap>
                                    {item.attachments.map((attachment, index) => (
                                      <Button key={`${attachment.url}-${index}`} size="small" icon={<PaperClipOutlined />} href={attachment.url} target="_blank">
                                        {attachment.name || "Attachment"}
                                      </Button>
                                    ))}
                                  </Space>
                                )}
                                {(item.appLinks || []).length > 0 && (
                                  <Space size={[6, 6]} wrap style={{ marginTop: 6 }}>
                                    {item.appLinks.map((link, index) => (
                                      <Button key={`${link.label}-${index}`} size="small" icon={<LinkOutlined />} href={link.url || undefined} target={link.url ? "_blank" : undefined}>
                                        {link.module}: {link.label}
                                      </Button>
                                    ))}
                                  </Space>
                                )}
                              </div>
                            </div>
                          </div>
                        </List.Item>
                      );
                    }}
                  />
                </div>

                {folder !== "deleted" && (
                  <div style={{ padding: 16, borderTop: isDark ? "1px solid #303030" : "1px solid #eef2f7", background: isDark ? "#141414" : "#fff" }}>
                    <TextArea rows={3} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="Write a message" style={{ borderRadius: 8 }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      <Space wrap>
                        <Upload beforeUpload={(file) => uploadFile(file, "reply")} showUploadList={false} disabled={uploading}>
                          <Button icon={<PaperClipOutlined />} loading={uploading}>Upload File</Button>
                        </Upload>
                      </Space>
                      <Button icon={<SendOutlined />} type="primary" onClick={sendReply}>Send</Button>
                    </div>
                    {renderAttachmentTags(replyAttachments, "reply")}
                    {renderAppLinkTags(replyAppLinks, "reply")}
                    <Divider style={{ margin: "12px 0 8px" }} />
                    {appDataForm("reply")}
                  </div>
                )}
              </>
            )}
          </div>
        </Col>
      </Row>

      <Drawer
        title={<Space><MailOutlined /> Compose Message</Space>}
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        width={620}
        destroyOnClose={false}
        extra={
          <Space>
            <Button icon={<SaveOutlined />} onClick={() => submitCompose(true)}>Save Draft</Button>
            <Button type="primary" icon={<SendOutlined />} onClick={() => submitCompose(false)}>Send</Button>
          </Space>
        }
      >
        <Form form={composeForm} layout="vertical">
          <Form.Item name="participantIds" label="Recipients" rules={[{ required: true, message: "Select at least one recipient" }]}>
            <Select mode="multiple" showSearch placeholder="Select app users" options={userOptions} optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="subject" label="Subject" rules={[{ required: true, message: "Subject is required" }]}>
            <Input placeholder="Conversation subject" />
          </Form.Item>
          <Form.Item name="body" label="Message">
            <TextArea rows={6} placeholder="Write your message" />
          </Form.Item>
        </Form>

        <Space wrap>
          <Upload beforeUpload={(file) => uploadFile(file, "compose")} showUploadList={false} disabled={uploading}>
            <Button icon={<PaperClipOutlined />} loading={uploading}>Upload Local File</Button>
          </Upload>
        </Space>
        {renderAttachmentTags(composeAttachments, "compose")}

        <Divider orientation="left" style={{ marginTop: 20 }}>App Data Attachment</Divider>
        {appDataForm("compose")}
        {renderAppLinkTags(composeAppLinks, "compose")}
      </Drawer>
    </div>
  );
}
