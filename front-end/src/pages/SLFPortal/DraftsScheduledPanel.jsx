import { useState, useEffect, useCallback } from "react";
import {
  Card, Tabs, Table, Tag, Button, Space, Empty, Spin, Popconfirm, Tooltip,
  Modal, Descriptions, Typography, Alert,
} from "antd";
import {
  FileTextOutlined, ClockCircleOutlined, ReloadOutlined, SendOutlined,
  DeleteOutlined, StopOutlined, EyeOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ExclamationCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Swal from "sweetalert2";
import api from "../../api";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";

const QUEUE_CACHE_TTL = 3 * 60 * 1000;

const { Text } = Typography;

const STATUS_META = {
  draft: { color: "default", label: "Draft", icon: <FileTextOutlined /> },
  scheduled: { color: "blue", label: "Scheduled", icon: <ClockCircleOutlined /> },
  submitted: { color: "green", label: "Submitted", icon: <CheckCircleOutlined /> },
  failed: { color: "red", label: "Failed", icon: <CloseCircleOutlined /> },
  cancelled: { color: "default", label: "Cancelled", icon: <StopOutlined /> },
};

const statusTag = (status) => {
  const meta = STATUS_META[status] || { color: "default", label: status || "—" };
  return <Tag color={meta.color} icon={meta.icon}>{meta.label}</Tag>;
};

const safeDate = (v, fmt = "MMM D, YYYY h:mm A") => (v ? dayjs(v).format(fmt) : "—");

export default function DraftsScheduledPanel({ portalUser, isMobile, onSubmitted }) {
  const [drafts, setDrafts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);

  const email = portalUser?.email;
  const cacheKey = `portal-queue-${email || ""}`;

  // Cached + resilient loader so re-entering the tab is instant and large
  // queues (up to thousands of drafts/scheduled) don't re-fetch every time.
  // Pass force to bypass the cache after a mutating action.
  const fetchQueue = useCallback(
    async (force = false) => {
      if (!email) return;
      if (force) invalidateCache(cacheKey);
      setLoading(true);
      try {
        await fetchWithCache(
          cacheKey,
          () =>
            api
              .get("/portal-queue", { params: { email } })
              .then(({ data }) => (Array.isArray(data) ? data : [])),
          {
            ttl: QUEUE_CACHE_TTL,
            force,
            onData: (list) => {
              const rows = Array.isArray(list) ? list : [];
              // Submitted drafts are deleted server-side (they move to Submission
              // History); filter defensively so they never linger here.
              setDrafts(
                rows.filter((r) => r.type === "draft" && r.status !== "submitted"),
              );
              setScheduled(rows.filter((r) => r.type === "scheduled"));
            },
          },
        );
      } catch {
        setDrafts([]);
        setScheduled([]);
      } finally {
        setLoading(false);
      }
    },
    [email, cacheKey],
  );

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const submitNow = async (record) => {
    setBusyId(record._id);
    try {
      await api.post(`/portal-queue/${record._id}/submit`);
      Swal.fire({
        icon: "success",
        title: "Submitted",
        text:
          record.type === "draft"
            ? "Your draft was submitted and moved to Submission History."
            : "Your submission was recorded and is now visible to EMB Region III.",
        timer: 1800,
        showConfirmButton: false,
      });
      fetchQueue(true);
      // Let the portal refresh Submission History so the entry appears there.
      onSubmitted?.();
    } catch (err) {
      Swal.fire({ icon: "error", title: "Submission Failed", text: err.response?.data?.message || "Could not submit. Please review the data and try again." });
      fetchQueue(true);
    } finally {
      setBusyId(null);
    }
  };

  const cancelScheduled = async (record) => {
    setBusyId(record._id);
    try {
      await api.patch(`/portal-queue/${record._id}/cancel`, { submittedBy: email });
      Swal.fire({ icon: "success", title: "Cancelled", text: "The scheduled submission was cancelled.", timer: 1500, showConfirmButton: false });
      fetchQueue(true);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not cancel", "error");
    } finally {
      setBusyId(null);
    }
  };

  const deleteRecord = async (record) => {
    setBusyId(record._id);
    try {
      await api.delete(`/portal-queue/${record._id}`);
      Swal.fire({ icon: "success", title: "Deleted", timer: 1200, showConfirmButton: false });
      fetchQueue(true);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not delete", "error");
    } finally {
      setBusyId(null);
    }
  };

  const commonActions = (record, { isScheduled } = {}) => {
    const editable = record.status === "draft" || record.status === "scheduled";
    return (
      <Space size={2} wrap>
        <Tooltip title="View data">
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setViewRecord(record)} />
        </Tooltip>
        {editable && (
          <Tooltip title="Submit now">
            <Button
              size="small"
              type="text"
              icon={<SendOutlined />}
              style={{ color: "#52c41a" }}
              loading={busyId === record._id}
              onClick={() => submitNow(record)}
            />
          </Tooltip>
        )}
        {isScheduled && record.status === "scheduled" && (
          <Popconfirm title="Cancel this scheduled submission?" onConfirm={() => cancelScheduled(record)} okText="Cancel Schedule">
            <Tooltip title="Cancel schedule">
              <Button size="small" type="text" icon={<StopOutlined />} style={{ color: "#faad14" }} />
            </Tooltip>
          </Popconfirm>
        )}
        <Popconfirm title="Delete this record permanently?" onConfirm={() => deleteRecord(record)} okText="Delete" okButtonProps={{ danger: true }}>
          <Tooltip title="Delete">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Tooltip>
        </Popconfirm>
      </Space>
    );
  };

  const draftColumns = [
    { title: "Facility", dataIndex: "slfName", key: "slfName", render: (v) => <Text strong>{v || "—"}</Text> },
    { title: "Status", dataIndex: "status", key: "status", width: 120, render: statusTag },
    { title: "Created", dataIndex: "createdAt", key: "createdAt", width: 170, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{safeDate(v)}</Text> },
    { title: "Last Updated", dataIndex: "updatedAt", key: "updatedAt", width: 170, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{safeDate(v)}</Text> },
    { title: "Actions", key: "actions", width: 140, render: (_, r) => commonActions(r) },
  ];

  const scheduledColumns = [
    { title: "Facility", dataIndex: "slfName", key: "slfName", render: (v) => <Text strong>{v || "—"}</Text> },
    { title: "Status", dataIndex: "status", key: "status", width: 120, render: statusTag },
    { title: "Scheduled For", dataIndex: "scheduledAt", key: "scheduledAt", width: 180, render: (v) => <Tag color="blue">{safeDate(v)}</Tag> },
    { title: "Submitted", dataIndex: "submittedAt", key: "submittedAt", width: 170, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{safeDate(v)}</Text> },
    {
      title: "Result",
      key: "result",
      width: 180,
      render: (_, r) => r.status === "failed"
        ? <Tooltip title={r.failureReason}><Text type="danger" style={{ fontSize: 12 }}><ExclamationCircleOutlined /> {r.failureReason || "Failed"}</Text></Tooltip>
        : r.status === "submitted" ? <Text type="success" style={{ fontSize: 12 }}>Submitted to Admin</Text>
        : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>,
    },
    { title: "Actions", key: "actions", width: 140, render: (_, r) => commonActions(r, { isScheduled: true }) },
  ];

  const emptyState = (text) => (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} style={{ padding: 24 }} />
  );

  return (
    <Card
      style={{ borderRadius: 12 }}
      title={<Space><FileTextOutlined style={{ color: "#722ed1" }} /><Text strong>Drafts & Scheduled Submissions</Text></Space>}
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => fetchQueue(true)} loading={loading}>Refresh</Button>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, borderRadius: 8 }}
        message="Save submissions as drafts so you never lose encoded data, or schedule them for automatic submission later."
        description="Scheduled submissions are submitted automatically at the chosen time and then appear in EMB Region III's Portal Submissions."
      />
      <Spin spinning={loading}>
        <Tabs
          size="small"
          items={[
            {
              key: "drafts",
              label: <span><FileTextOutlined /> Drafts ({drafts.length})</span>,
              children: drafts.length === 0
                ? emptyState("No saved drafts yet. Use \u201CSave as Draft\u201D on the review screen.")
                : (
                  <Table
                    dataSource={drafts}
                    columns={draftColumns}
                    rowKey="_id"
                    size="small"
                    pagination={{ pageSize: 10, size: "small", showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: (t) => `${t} record(s)` }}
                    scroll={{ x: isMobile ? 700 : undefined }}
                  />
                ),
            },
            {
              key: "scheduled",
              label: <span><ClockCircleOutlined /> Scheduled ({scheduled.length})</span>,
              children: scheduled.length === 0
                ? emptyState("No scheduled submissions. Use \u201CSchedule\u201D on the review screen.")
                : (
                  <Table
                    dataSource={scheduled}
                    columns={scheduledColumns}
                    rowKey="_id"
                    size="small"
                    pagination={{ pageSize: 10, size: "small", showSizeChanger: true, pageSizeOptions: [10, 25, 50, 100], showTotal: (t) => `${t} record(s)` }}
                    scroll={{ x: isMobile ? 820 : undefined }}
                  />
                ),
            },
          ]}
        />
      </Spin>

      <Modal
        title="Submission Data"
        open={!!viewRecord}
        onCancel={() => setViewRecord(null)}
        footer={<Button onClick={() => setViewRecord(null)}>Close</Button>}
        width={640}
        destroyOnHidden
      >
        {viewRecord && (
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Facility">{viewRecord.slfName || "—"}</Descriptions.Item>
            <Descriptions.Item label="Type">{STATUS_META[viewRecord.type]?.label || viewRecord.type}</Descriptions.Item>
            <Descriptions.Item label="Status">{statusTag(viewRecord.status)}</Descriptions.Item>
            <Descriptions.Item label="Company">{viewRecord.payload?.lguCompanyName || "—"}</Descriptions.Item>
            <Descriptions.Item label="Date of Disposal">{viewRecord.payload?.dateOfDisposal || "—"}</Descriptions.Item>
            <Descriptions.Item label="Truck Entries">{Array.isArray(viewRecord.payload?.trucks) ? viewRecord.payload.trucks.length : 0}</Descriptions.Item>
            {viewRecord.scheduledAt && (
              <Descriptions.Item label="Scheduled For">{safeDate(viewRecord.scheduledAt)}</Descriptions.Item>
            )}
            {viewRecord.failureReason && (
              <Descriptions.Item label="Failure Reason"><Text type="danger">{viewRecord.failureReason}</Text></Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </Card>
  );
}
