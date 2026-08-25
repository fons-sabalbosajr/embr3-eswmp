import { useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  Row,
  Col,
  Statistic,
  Button,
  Space,
  Typography,
  Tag,
  Tooltip,
  Dropdown,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  Switch,
  Empty,
  Descriptions,
  Divider,
} from "antd";
import {
  NotificationOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  EyeOutlined,
  EditOutlined,
  MoreOutlined,
  CheckCircleOutlined,
  PauseCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  SendOutlined,
  StopOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  FileTextOutlined,
  ClearOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Swal from "sweetalert2";
import api from "../../api";
import ResponsiveTable from "./shared/ResponsiveTable";
// Lifecycle RULES (pure, testable) and PRESENTATION (antd tags + icons) live in
// two modules, so the rules can be imported by the test suite — which runs on
// plain Node and cannot load JSX.
import { resolveAnnouncementStatus } from "../../utils/announcementLifecycle";
import {
  statusMeta,
  typeMeta,
  priorityMeta,
  resolveAudience,
  ANNOUNCEMENT_TYPE_META,
  AUDIENCE_FILTER_OPTIONS,
} from "../../utils/announcementStatus";

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

const ACCENT = "#1a3353";
const fmtDate = (v) => (v ? dayjs(v).format("MMM D, YYYY h:mm A") : null);

// Build a full PUT/POST payload from a record + overrides (the API requires the
// complete field set; title + message are mandatory).
const toPayload = (rec = {}, overrides = {}) => ({
  type: rec.type || "info",
  priority: rec.priority || "normal",
  title: rec.title || "",
  summary: rec.summary || "",
  message: rec.message || "",
  startAt: rec.startAt || null,
  endAt: rec.endAt || null,
  showOnLogin: rec.showOnLogin !== false,
  showInPortal: rec.showInPortal !== false,
  dismissible: rec.dismissible !== false,
  emailSubject: rec.emailSubject || "",
  emailMessage: rec.emailMessage || "",
  enabled: !!rec.enabled,
  ...overrides,
});

// A summary tile.
function SummaryCard({ title, value, icon, color, active, onClick }) {
  return (
    <Card
      size="small"
      hoverable={!!onClick}
      onClick={onClick}
      style={{ borderRadius: 10, borderColor: active ? color : undefined, borderWidth: active ? 2 : 1 }}
      styles={{ body: { padding: "12px 16px" } }}
    >
      <Space align="center" size={12}>
        <span style={{ fontSize: 22, color }}>{icon}</span>
        <Statistic title={title} value={value} valueStyle={{ fontSize: 22, color }} />
      </Space>
    </Card>
  );
}

export default function AnnouncementManager({ onChanged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null); // row-level action in flight

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(null);
  const [audienceFilter, setAudienceFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [dateRange, setDateRange] = useState(null);
  const [statusCardFilter, setStatusCardFilter] = useState(null);

  // Modals
  const [editModal, setEditModal] = useState({ open: false, record: null });
  const [viewModal, setViewModal] = useState({ open: false, record: null });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const savingGuard = useRef(false);
  const [form] = Form.useForm();

  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/settings/app/portal-announcements");
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterMutation = async () => {
    await fetchItems();
    onChanged?.();
  };

  // ── Derived: status per row + summary counts ───────────────────────────────
  const withStatus = useMemo(
    () => items.map((a) => ({ ...a, _status: resolveAnnouncementStatus(a), _audience: resolveAudience(a) })),
    [items],
  );

  const counts = useMemo(() => {
    const c = { total: withStatus.length, active: 0, scheduled: 0, expired: 0, draft: 0, unpublished: 0 };
    withStatus.forEach((a) => { c[a._status] = (c[a._status] || 0) + 1; });
    return c;
  }, [withStatus]);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const effectiveStatus = statusCardFilter || statusFilter;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const [from, to] = dateRange || [];
    return withStatus.filter((a) => {
      if (effectiveStatus && a._status !== effectiveStatus) return false;
      if (typeFilter && (a.type || "info") !== typeFilter) return false;
      if (audienceFilter && a._audience.key !== audienceFilter) return false;
      if (from && to) {
        const d = a.startAt ? dayjs(a.startAt) : null;
        if (!d || d.isBefore(from, "day") || d.isAfter(to, "day")) return false;
      }
      if (q) {
        const hay = [a.title, a.summary, a.message, a.createdBy].map((v) => String(v || "").toLowerCase()).join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [withStatus, search, effectiveStatus, typeFilter, audienceFilter, dateRange]);

  const hasFilters = !!(search.trim() || statusFilter || audienceFilter || typeFilter || (dateRange && dateRange[0]) || statusCardFilter);
  const resetFilters = () => {
    setSearch(""); setStatusFilter(null); setAudienceFilter(null); setTypeFilter(null); setDateRange(null); setStatusCardFilter(null);
  };

  // ── Create / Edit ──────────────────────────────────────────────────────────
  const openEdit = (record = null) => {
    setDirty(false);
    setEditModal({ open: true, record });
    form.setFieldsValue({
      title: record?.title || "",
      summary: record?.summary || "",
      message: record?.message || "",
      type: record?.type || "info",
      priority: record?.priority || "normal",
      showOnLogin: record?.showOnLogin !== false,
      showInPortal: record?.showInPortal !== false,
      dismissible: record?.dismissible !== false,
      startAt: record?.startAt ? dayjs(record.startAt) : null,
      endAt: record?.endAt ? dayjs(record.endAt) : null,
      emailSubject: record?.emailSubject || "",
      emailMessage: record?.emailMessage || "",
    });
  };

  const closeEdit = () => {
    if (dirty) {
      Swal.fire({
        icon: "warning",
        title: "Discard unsaved changes?",
        text: "Your edits to this announcement will be lost.",
        showCancelButton: true,
        confirmButtonText: "Discard",
        confirmButtonColor: "#ff4d4f",
      }).then((r) => { if (r.isConfirmed) { setDirty(false); setEditModal({ open: false, record: null }); } });
      return;
    }
    setEditModal({ open: false, record: null });
  };

  // publish=true → enabled; a future startAt becomes "Scheduled" naturally.
  const submit = async (publish) => {
    if (savingGuard.current) return; // prevent duplicate submissions
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return; // validation errors are shown inline
    }
    savingGuard.current = true;
    setSaving(true);
    try {
      const payload = {
        ...values,
        startAt: values.startAt?.toISOString?.() || null,
        endAt: values.endAt?.toISOString?.() || null,
        enabled: publish,
      };
      const id = editModal.record?._id;
      if (id) await api.put(`/settings/app/portal-announcements/${id}`, payload);
      else await api.post("/settings/app/portal-announcements", payload);
      setDirty(false);
      setEditModal({ open: false, record: null });
      await afterMutation();
      Swal.fire({
        icon: "success",
        title: id ? "Announcement updated" : "Announcement created",
        text: publish ? "It is now published to the selected surfaces." : "Saved as a draft.",
        timer: 1400,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not save announcement", "error");
    } finally {
      savingGuard.current = false;
      setSaving(false);
    }
  };

  // ── Row actions ────────────────────────────────────────────────────────────
  const runAction = async (record, fn) => {
    setActionId(record._id);
    try { await fn(); await afterMutation(); }
    catch (err) { Swal.fire("Error", err.response?.data?.message || "Action failed", "error"); }
    finally { setActionId(null); }
  };

  const confirmThen = (opts, fn) =>
    Swal.fire({ showCancelButton: true, ...opts }).then((r) => { if (r.isConfirmed) return fn(); });

  const doPublish = (record) =>
    confirmThen(
      {
        icon: "question",
        title: "Publish this announcement?",
        html: "It will appear on the selected portal surfaces.<br/><b>Any other published announcement will be unpublished</b> (only one can be live at a time).",
        confirmButtonText: "Publish",
        confirmButtonColor: "#52c41a",
      },
      () => runAction(record, () => api.put(`/settings/app/portal-announcements/${record._id}`, toPayload(record, { enabled: true }))),
    );

  const doUnpublish = (record) =>
    confirmThen(
      { icon: "warning", title: "Unpublish this announcement?", text: "It will stop showing to portal users. Its content is kept.", confirmButtonText: "Unpublish", confirmButtonColor: "#faad14" },
      () => runAction(record, () => api.put(`/settings/app/portal-announcements/${record._id}`, toPayload(record, { enabled: false }))),
    );

  const doExpire = (record) =>
    confirmThen(
      { icon: "warning", title: "Expire this announcement now?", text: "The expiration date will be set to now, ending it immediately.", confirmButtonText: "Expire now", confirmButtonColor: "#faad14" },
      () => runAction(record, () => api.put(`/settings/app/portal-announcements/${record._id}`, toPayload(record, { endAt: new Date().toISOString(), enabled: false }))),
    );

  const doDuplicate = (record) =>
    runAction(record, () =>
      api.post("/settings/app/portal-announcements", toPayload(record, { enabled: false, title: `${record.title || "Untitled"} (Copy)`, startAt: null, endAt: null })),
    ).then(() => Swal.fire({ icon: "success", title: "Duplicated as draft", timer: 1200, showConfirmButton: false }));

  const doDelete = (record) =>
    confirmThen(
      { icon: "warning", title: "Delete this announcement?", html: `<b>${(record.title || "Untitled").replace(/</g, "&lt;")}</b> will be permanently removed. This cannot be undone.`, confirmButtonText: "Delete", confirmButtonColor: "#ff4d4f" },
      () => runAction(record, () => api.delete(`/settings/app/portal-announcements/${record._id}`)),
    );

  const doSendEmail = (record) =>
    confirmThen(
      { icon: "question", title: "Email this announcement?", text: "This emails all approved SLF portal users.", confirmButtonText: "Send email", confirmButtonColor: ACCENT },
      () =>
        runAction(record, async () => {
          const { data } = await api.post("/settings/app/portal-announcement/email", {
            announcementId: record._id,
            title: record.title,
            message: record.emailMessage || record.message,
            subject: record.emailSubject || record.title,
            emailMessage: record.emailMessage || record.message,
          });
          Swal.fire({ icon: data.failed ? "warning" : "success", title: "Announcement email sent", text: `${data.sent || 0} sent${data.failed ? `, ${data.failed} failed` : ""}.`, timer: 2200, showConfirmButton: false });
        }),
    );

  // Actions available per status (show-only-what's-allowed).
  const menuFor = (record) => {
    const s = record._status;
    const items = [
      { key: "view", icon: <EyeOutlined />, label: "View", onClick: () => setViewModal({ open: true, record }) },
      { key: "edit", icon: <EditOutlined />, label: "Edit", onClick: () => openEdit(record) },
    ];
    if (s === "expired") items.push({ key: "reschedule", icon: <ClockCircleOutlined />, label: "Reschedule", onClick: () => openEdit(record) });
    if (s === "draft" || s === "unpublished") items.push({ key: "publish", icon: <CheckCircleOutlined />, label: "Publish", onClick: () => doPublish(record) });
    if (s === "scheduled") items.push({ key: "publish", icon: <CheckCircleOutlined />, label: "Publish now", onClick: () => runAction(record, () => api.put(`/settings/app/portal-announcements/${record._id}`, toPayload(record, { enabled: true, startAt: null }))) });
    if (s === "active" || s === "scheduled") items.push({ key: "unpublish", icon: <PauseCircleOutlined />, label: "Unpublish", onClick: () => doUnpublish(record) });
    if (s === "active" || s === "scheduled") items.push({ key: "expire", icon: <StopOutlined />, label: "Expire now", onClick: () => doExpire(record) });
    items.push({ key: "email", icon: <SendOutlined />, label: "Send email", onClick: () => doSendEmail(record) });
    items.push({ key: "duplicate", icon: <CopyOutlined />, label: "Duplicate", onClick: () => doDuplicate(record) });
    items.push({ type: "divider" });
    items.push({ key: "delete", icon: <DeleteOutlined />, label: "Delete", danger: true, onClick: () => doDelete(record) });
    return items;
  };

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = [
    {
      title: "Announcement",
      key: "title",
      width: 300,
      sorter: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
      render: (_, r) => (
        <Space direction="vertical" size={0} style={{ maxWidth: 280 }}>
          <Tooltip title={r.title}>
            <Text strong ellipsis style={{ maxWidth: 280, display: "inline-block" }}>{r.title || "Untitled"}</Text>
          </Tooltip>
          {(r.summary || r.message) && (
            <Tooltip title={r.summary || r.message}>
              <Text type="secondary" ellipsis style={{ fontSize: 12, maxWidth: 280, display: "inline-block" }}>
                {r.summary || r.message}
              </Text>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: "Audience",
      key: "audience",
      width: 130,
      render: (_, r) => <Tag color="cyan">{r._audience.label}</Tag>,
    },
    {
      title: "Category",
      key: "type",
      width: 120,
      render: (_, r) => {
        const m = typeMeta(r.type);
        return <Tag icon={m.icon} color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: "Status",
      key: "status",
      width: 130,
      render: (_, r) => {
        const m = statusMeta(r._status);
        return <Tag icon={m.icon} color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: "Publish date",
      key: "startAt",
      width: 160,
      sorter: (a, b) => (new Date(a.startAt || 0)) - (new Date(b.startAt || 0)),
      render: (_, r) => <Text style={{ fontSize: 12 }}>{fmtDate(r.startAt) || <Text type="secondary">Immediate</Text>}</Text>,
    },
    {
      title: "Expiration",
      key: "endAt",
      width: 160,
      sorter: (a, b) => (new Date(a.endAt || 0)) - (new Date(b.endAt || 0)),
      render: (_, r) => <Text style={{ fontSize: 12 }}>{fmtDate(r.endAt) || <Text type="secondary">No end</Text>}</Text>,
    },
    {
      title: "Created by",
      key: "createdBy",
      width: 150,
      render: (_, r) => (
        <Tooltip title={r.createdBy}>
          <Text ellipsis style={{ fontSize: 12, maxWidth: 130, display: "inline-block" }}>{r.createdBy || "—"}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Last updated",
      key: "updatedAt",
      width: 150,
      sorter: (a, b) => (new Date(a.updatedAt || 0)) - (new Date(b.updatedAt || 0)),
      defaultSortOrder: "descend",
      render: (_, r) => <Text style={{ fontSize: 12 }}>{fmtDate(r.updatedAt) || "—"}</Text>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 140,
      fixed: "right",
      align: "center",
      render: (_, r) => (
        <Space size={2}>
          <Tooltip title="View">
            <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setViewModal({ open: true, record: r })} />
          </Tooltip>
          <Tooltip title="Edit">
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Dropdown menu={{ items: menuFor(r) }} trigger={["click"]} placement="bottomRight">
            <Button size="small" type="text" icon={<MoreOutlined />} loading={actionId === r._id} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  // Publish/Schedule label reflects the chosen start date.
  const editStart = Form.useWatch("startAt", form);
  const willSchedule = editStart && dayjs(editStart).isAfter(dayjs());
  const isEdit = !!editModal.record;

  const viewRec = viewModal.record;
  const viewStatus = viewRec ? resolveAnnouncementStatus(viewRec) : null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, color: ACCENT }}>
            <NotificationOutlined style={{ marginRight: 8, color: "#52c41a" }} />
            Announcement Manager
          </Title>
          <Text type="secondary">
            Create, schedule and publish announcements shown on the SLF Portal login page and dashboard. Only one announcement can be published at a time.
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchItems} loading={loading}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()} style={{ background: ACCENT }}>
            Create Announcement
          </Button>
        </Space>
      </div>

      {/* Summary cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={4}><SummaryCard title="Total" value={counts.total} icon={<FileTextOutlined />} color={ACCENT} active={!statusCardFilter} onClick={() => setStatusCardFilter(null)} /></Col>
        <Col xs={12} sm={8} lg={5}><SummaryCard title="Active" value={counts.active} icon={<CheckCircleOutlined />} color="#52c41a" active={statusCardFilter === "active"} onClick={() => setStatusCardFilter(statusCardFilter === "active" ? null : "active")} /></Col>
        <Col xs={12} sm={8} lg={5}><SummaryCard title="Scheduled" value={counts.scheduled} icon={<ClockCircleOutlined />} color="#1677ff" active={statusCardFilter === "scheduled"} onClick={() => setStatusCardFilter(statusCardFilter === "scheduled" ? null : "scheduled")} /></Col>
        <Col xs={12} sm={8} lg={5}><SummaryCard title="Expired" value={counts.expired} icon={<StopOutlined />} color="#8c8c8c" active={statusCardFilter === "expired"} onClick={() => setStatusCardFilter(statusCardFilter === "expired" ? null : "expired")} /></Col>
        <Col xs={12} sm={8} lg={5}><SummaryCard title="Drafts" value={counts.draft} icon={<EditOutlined />} color="#faad14" active={statusCardFilter === "draft"} onClick={() => setStatusCardFilter(statusCardFilter === "draft" ? null : "draft")} /></Col>
      </Row>

      <Card style={{ borderRadius: 10 }} styles={{ body: { padding: 16 } }}>
        {/* Filter bar */}
        <Space wrap size={8} style={{ marginBottom: 12, width: "100%" }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search title, summary, content…"
            style={{ width: 240 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select allowClear placeholder="Status" style={{ minWidth: 150 }} value={statusCardFilter || statusFilter}
            onChange={(v) => { setStatusFilter(v); setStatusCardFilter(null); }}
            options={[
              { value: "active", label: "Active" },
              { value: "scheduled", label: "Scheduled" },
              { value: "draft", label: "Draft" },
              { value: "unpublished", label: "Unpublished" },
              { value: "expired", label: "Expired" },
            ]}
          />
          <Select allowClear placeholder="Audience" style={{ minWidth: 150 }} value={audienceFilter} onChange={setAudienceFilter} options={AUDIENCE_FILTER_OPTIONS} />
          <Select allowClear placeholder="Category" style={{ minWidth: 150 }} value={typeFilter} onChange={setTypeFilter}
            options={Object.entries(ANNOUNCEMENT_TYPE_META).map(([value, m]) => ({ value, label: m.label }))}
          />
          <RangePicker placeholder={["Publish from", "Publish to"]} value={dateRange} onChange={setDateRange} />
          {hasFilters && <Button type="link" danger icon={<ClearOutlined />} onClick={resetFilters}>Reset</Button>}
        </Space>

        <ResponsiveTable
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 10, pageSizeOptions: ["10", "15", "30", "50"] }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={hasFilters ? "No announcements match the filters" : "No announcements yet"} /> }}
        />
      </Card>

      {/* ── Create / Edit modal ── */}
      <Modal
        title={isEdit ? "Edit Announcement" : "Create Announcement"}
        open={editModal.open}
        onCancel={closeEdit}
        maskClosable={false}
        width={860}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: "70vh", overflowY: "auto", paddingRight: 8 } }}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={closeEdit} disabled={saving}>Cancel</Button>
            <Button icon={<FileTextOutlined />} loading={saving} onClick={() => submit(false)}>Save Draft</Button>
            <Button type="primary" icon={<CheckCircleOutlined />} loading={saving} onClick={() => submit(true)} style={{ background: "#52c41a", borderColor: "#52c41a" }}>
              {willSchedule ? "Schedule" : "Publish"}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)} requiredMark>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: "Enter a title" }]}>
            <Input showCount maxLength={160} placeholder="Important SLF Portal notice" />
          </Form.Item>
          <Form.Item name="summary" label="Short summary" extra="Optional one-line summary shown in the manager list.">
            <Input showCount maxLength={240} placeholder="A brief one-liner…" />
          </Form.Item>
          <Form.Item name="message" label="Announcement content" rules={[{ required: true, message: "Enter the content" }]}>
            <TextArea showCount maxLength={4000} autoSize={{ minRows: 6, maxRows: 16 }} placeholder="Write the full announcement shown on the login page and portal dashboard…" />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item name="type" label="Category" rules={[{ required: true }]}>
                <Select options={Object.entries(ANNOUNCEMENT_TYPE_META).map(([value, m]) => ({ value, label: m.label }))} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="priority" label="Priority">
                <Select options={[
                  { value: "low", label: "Low" },
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "High" },
                  { value: "urgent", label: "Urgent" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="dismissible" label="Allow dismiss" valuePropName="checked">
                <Switch checkedChildren="Yes" unCheckedChildren="No" />
              </Form.Item>
            </Col>
            <Col xs={12} md={12}>
              <Form.Item name="showOnLogin" label="Show on Login page" valuePropName="checked">
                <Switch checkedChildren="Show" unCheckedChildren="Hide" />
              </Form.Item>
            </Col>
            <Col xs={12} md={12}>
              <Form.Item name="showInPortal" label="Show inside Portal" valuePropName="checked">
                <Switch checkedChildren="Show" unCheckedChildren="Hide" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="startAt" label={<span><CalendarOutlined /> Publish date &amp; time</span>} extra="Leave blank to publish immediately.">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="endAt" label={<span><StopOutlined /> Expiration date &amp; time</span>} extra="Leave blank for no expiration.">
                <DatePicker showTime style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Divider orientation="left" plain style={{ margin: "4px 0 16px" }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Email (optional — used by “Send email”)</Text>
          </Divider>
          <Form.Item name="emailSubject" label="Email subject" extra="Defaults to the title if left blank.">
            <Input showCount maxLength={200} placeholder="Email subject line" />
          </Form.Item>
          <Form.Item name="emailMessage" label="Email message" extra="Defaults to the announcement content if left blank.">
            <TextArea showCount maxLength={5000} autoSize={{ minRows: 3, maxRows: 10 }} placeholder="Email body…" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── View modal ── */}
      <Modal
        title={<Space><EyeOutlined /> Announcement</Space>}
        open={viewModal.open}
        onCancel={() => setViewModal({ open: false, record: null })}
        width={720}
        style={{ top: 24 }}
        styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
        footer={
          viewRec && (
            <Space>
              <Button onClick={() => setViewModal({ open: false, record: null })}>Close</Button>
              <Button icon={<EditOutlined />} onClick={() => { const r = viewRec; setViewModal({ open: false, record: null }); openEdit(r); }}>Edit</Button>
              {(viewStatus === "active" || viewStatus === "scheduled")
                ? <Button icon={<PauseCircleOutlined />} onClick={() => { const r = viewRec; setViewModal({ open: false, record: null }); doUnpublish(r); }}>Unpublish</Button>
                : <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => { const r = viewRec; setViewModal({ open: false, record: null }); doPublish(r); }} style={{ background: "#52c41a", borderColor: "#52c41a" }}>Publish</Button>}
            </Space>
          )
        }
        destroyOnHidden
      >
        {viewRec && (
          <>
            <Space wrap size={8} style={{ marginBottom: 12 }}>
              <Tag icon={statusMeta(viewStatus).icon} color={statusMeta(viewStatus).color}>{statusMeta(viewStatus).label}</Tag>
              <Tag icon={typeMeta(viewRec.type).icon} color={typeMeta(viewRec.type).color}>{typeMeta(viewRec.type).label}</Tag>
              <Tag color={priorityMeta(viewRec.priority).color}>{priorityMeta(viewRec.priority).label} priority</Tag>
              <Tag color="cyan">{resolveAudience(viewRec).label}</Tag>
            </Space>
            <Title level={4} style={{ marginTop: 0 }}>{viewRec.title || "Untitled"}</Title>
            {viewRec.summary && <Paragraph type="secondary" style={{ marginBottom: 12 }}>{viewRec.summary}</Paragraph>}
            <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Publish date">{fmtDate(viewRec.startAt) || "Immediate"}</Descriptions.Item>
              <Descriptions.Item label="Expiration">{fmtDate(viewRec.endAt) || "No end"}</Descriptions.Item>
              <Descriptions.Item label="Author">{viewRec.createdBy || "—"}</Descriptions.Item>
              <Descriptions.Item label="Last updated">{fmtDate(viewRec.updatedAt) || "—"}</Descriptions.Item>
            </Descriptions>
            <Text strong>Content</Text>
            <div style={{ marginTop: 8, padding: 16, borderRadius: 8, background: "rgba(0,0,0,0.02)", border: "1px solid #f0f0f0", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
              {viewRec.message || <Text type="secondary">No content</Text>}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
