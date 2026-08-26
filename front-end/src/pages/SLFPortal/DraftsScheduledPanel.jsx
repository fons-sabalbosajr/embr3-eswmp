import { useState, useEffect, useCallback } from "react";
import {
  Card, Tabs, Table, Tag, Button, Space, Empty, Spin, Popconfirm, Tooltip,
  Modal, Descriptions, Typography, Alert, Badge,
} from "antd";
import {
  FileTextOutlined, ClockCircleOutlined, ReloadOutlined, SendOutlined,
  DeleteOutlined, StopOutlined, EyeOutlined, CheckCircleOutlined, DownloadOutlined,
  CloseCircleOutlined, ExclamationCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Swal from "sweetalert2";
import api from "../../api";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { exportToExcel } from "../../utils/exportExcel";

const QUEUE_CACHE_TTL = 3 * 60 * 1000;

const { Text } = Typography;

const DASH = "—";
const unitOf = (u, fallback) => String(u || fallback || "m³").replace("m3", "m³");
const orDash = (v) => (v === null || v === undefined || v === "" ? DASH : v);

// Cells wrap rather than overflow — a draft can hold long hauler/client names and
// several hazardous codes, and the table has to stay inside the modal.
const WRAP_CELL = { whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", fontSize: 12 };
const wrapCol = (column) => ({
  ...column,
  onCell: () => ({ style: WRAP_CELL }),
  onHeaderCell: () => ({ style: { ...WRAP_CELL, fontWeight: 600 } }),
});

// Flatten one payload truck into a display row. A truck reports its load either
// directly or through per-vehicle placements — both shapes exist in the model,
// so both are read (same rule the Review modal and the admin details use).
function transportRows(trucks = []) {
  return (Array.isArray(trucks) ? trucks : []).map((t, i) => {
    const vehicles = Array.isArray(t?.vehicles) ? t.vehicles : [];
    const many = vehicles.length > 1;
    const clients = [
      ...(Array.isArray(t?.selectedClients) ? t.selectedClients : []),
      ...vehicles.flatMap((v) => v?.selectedClients || []),
    ]
      .map((c) => (typeof c === "string" ? c : c?.clientName))
      .filter(Boolean);
    return {
      key: t?.key ?? i,
      no: i + 1,
      ticket: orDash(t?.disposalTicketNo),
      hauler: orDash(t?.hauler),
      clients: [...new Set(clients)],
      plate: many
        ? vehicles.map((v) => v.plateNumber).filter(Boolean).join(", ") || orDash(t?.plateNumber)
        : orDash(vehicles[0]?.plateNumber || t?.plateNumber),
      capacity: many
        ? vehicles.filter((v) => v.capacity != null)
            .map((v) => `${v.capacity} ${unitOf(v.capacityUnit)}`).join(", ") || DASH
        : (() => {
            const cap = vehicles[0]?.capacity ?? t?.truckCapacity;
            return cap != null ? `${cap} ${unitOf(vehicles[0]?.capacityUnit || t?.truckCapacityUnit)}` : DASH;
          })(),
      volume: t?.actualVolume != null ? `${t.actualVolume} ${unitOf(t?.actualVolumeUnit)}` : DASH,
      wasteType: orDash(t?.wasteType),
      cell: many
        ? [...new Set(vehicles.map((v) => v.cellName).filter(Boolean))].join(", ") || orDash(t?.cellName)
        : orDash(vehicles[0]?.cellName || t?.cellName),
      hazCodes: (Array.isArray(t?.hazWasteCode) ? t.hazWasteCode : t?.hazWasteCode ? [t.hazWasteCode] : []).filter(Boolean),
    };
  });
}

/**
 * Full detail view for one queued draft / scheduled submission — the same
 * breakdown the Submission Details modal gives an admin, read out of the stored
 * `payload` (which is exactly the entry POST /data-slf would receive).
 *
 * A DRAFT is allowed to be incomplete, so every field degrades to "—" and the
 * transport table shows an empty state rather than implying missing data is an
 * error.
 */
function QueueRecordDetails({ record }) {
  const payload = record.payload || {};
  const rows = transportRows(payload.trucks);
  const baseUnit = unitOf(payload.baselineUnit || payload.totalVolumeAcceptedUnit);
  const haulers = Array.isArray(payload.accreditedHaulers) ? payload.accreditedHaulers : [];
  const cellEntries = [
    ...(Array.isArray(payload.activeCellEntries) ? payload.activeCellEntries : []),
    ...(Array.isArray(payload.closedCellEntries) ? payload.closedCellEntries : []),
  ];

  return (
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      {record.failureReason && (
        <Alert type="error" showIcon message="Last attempt failed" description={record.failureReason} />
      )}
      {record.status === "draft" && rows.length === 0 && (
        <Alert
          type="info"
          showIcon
          message="This draft has no transport entries yet"
          description="Drafts can be saved incomplete. Open it in Data Entry to continue encoding before submitting."
        />
      )}

      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered title="Queue Record">
        <Descriptions.Item label="Facility">{orDash(record.slfName)}</Descriptions.Item>
        <Descriptions.Item label="Type">{STATUS_META[record.type]?.label || record.type}</Descriptions.Item>
        <Descriptions.Item label="Status">{statusTag(record.status)}</Descriptions.Item>
        <Descriptions.Item label="Saved">{safeDate(record.createdAt)}</Descriptions.Item>
        {record.scheduledAt && (
          <Descriptions.Item label="Scheduled For">{safeDate(record.scheduledAt)}</Descriptions.Item>
        )}
        {record.submittedAt && (
          <Descriptions.Item label="Submitted">{safeDate(record.submittedAt)}</Descriptions.Item>
        )}
        {record.resultSubmissionId && (
          <Descriptions.Item label="Submission ID">{record.resultSubmissionId}</Descriptions.Item>
        )}
      </Descriptions>

      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered title="General Information">
        <Descriptions.Item label="Company">{orDash(payload.lguCompanyName)}</Descriptions.Item>
        <Descriptions.Item label="Company Type">{orDash(payload.companyType)}</Descriptions.Item>
        <Descriptions.Item label="Date of Disposal">{orDash(payload.dateOfDisposal)}</Descriptions.Item>
        <Descriptions.Item label="Transport Entries">{rows.length}</Descriptions.Item>
        <Descriptions.Item label="Address" span={2}>{orDash(payload.address)}</Descriptions.Item>
      </Descriptions>

      <Descriptions size="small" column={{ xs: 1, sm: 2 }} bordered title="Baseline Snapshot">
        <Descriptions.Item label="Total Volume Accepted">
          {payload.totalVolumeAccepted != null ? `${payload.totalVolumeAccepted} ${baseUnit}` : DASH}
        </Descriptions.Item>
        <Descriptions.Item label="Declared Unit">{baseUnit}</Descriptions.Item>
        <Descriptions.Item label="Accepts Hazardous Waste">
          {payload.acceptsHazardousWaste ? "Yes" : "No"}
        </Descriptions.Item>
        <Descriptions.Item label="Accredited Haulers">{haulers.length}</Descriptions.Item>
        <Descriptions.Item label="Baseline Cell Entries" span={2}>
          {cellEntries.length
            ? cellEntries.map((e, i) => (
                <Tag key={i} color="blue" variant="filled" style={{ margin: "0 4px 4px 0", ...WRAP_CELL }}>
                  {[e.cellName, e.wasteType, e.volume != null ? `${e.volume} ${unitOf(e.unit, baseUnit)}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Tag>
              ))
            : DASH}
        </Descriptions.Item>
      </Descriptions>

      <div>
        <Text strong style={{ display: "block", marginBottom: 8 }}>
          Transport &amp; Disposal Entries ({rows.length})
        </Text>
        {rows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No transport entries encoded yet" />
        ) : (
          <Table
            size="small"
            rowKey="key"
            dataSource={rows}
            className="slf-slim-scroll"
            tableLayout="fixed"
            scroll={{ y: 320 }}
            pagination={rows.length > 10 ? { pageSize: 10, size: "small" } : false}
            columns={[
              { title: "#", dataIndex: "no", width: 36 },
              wrapCol({ title: "Ticket No.", dataIndex: "ticket", width: 100 }),
              wrapCol({ title: "Hauler", dataIndex: "hauler", width: 130 }),
              wrapCol({
                title: "Clients",
                dataIndex: "clients",
                width: 150,
                render: (list) =>
                  list.length ? (
                    <Space size={[2, 2]} wrap>
                      {list.map((c) => (
                        <Tag key={c} color="purple" variant="filled" style={{ margin: 0, ...WRAP_CELL }}>{c}</Tag>
                      ))}
                    </Space>
                  ) : (
                    <Text type="secondary">{DASH}</Text>
                  ),
              }),
              wrapCol({ title: "Plate No.", dataIndex: "plate", width: 105 }),
              { title: "Capacity", dataIndex: "capacity", width: 95 },
              { title: "Volume", dataIndex: "volume", width: 100 },
              wrapCol({
                title: "Waste Type",
                dataIndex: "wasteType",
                width: 105,
                render: (v) =>
                  v === DASH ? (
                    <Text type="secondary">{DASH}</Text>
                  ) : (
                    <Tag
                      color={/haz/i.test(v) ? "volcano" : "green"}
                      variant="filled"
                      style={{ margin: 0, display: "inline-block", maxWidth: "100%", ...WRAP_CELL }}
                    >
                      {v}
                    </Tag>
                  ),
              }),
              wrapCol({
                title: "Disposal Cell",
                dataIndex: "cell",
                width: 105,
                render: (v) =>
                  v === DASH ? (
                    <Text type="secondary">{DASH}</Text>
                  ) : (
                    <Tag color="cyan" variant="filled" style={{ margin: 0, ...WRAP_CELL }}>{v}</Tag>
                  ),
              }),
              wrapCol({
                title: "HW Code",
                dataIndex: "hazCodes",
                width: 105,
                render: (codes) =>
                  codes.length ? (
                    <Space size={[2, 2]} wrap>
                      {codes.map((c) => (
                        <Tag key={c} color="volcano" variant="filled" style={{ margin: 0, ...WRAP_CELL }}>{c}</Tag>
                      ))}
                    </Space>
                  ) : (
                    <Text type="secondary">{DASH}</Text>
                  ),
              }),
            ]}
          />
        )}
      </div>
    </Space>
  );
}

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

export default function DraftsScheduledPanel({
  portalUser,
  isMobile,
  onSubmitted,
  // Reports how many queued records need the operator's attention, so the sidebar
  // badge follows an action taken HERE without waiting for its own poll. The
  // parent also counts independently (this panel is unmounted on every other
  // menu, and a badge that only updates while you are looking at the thing is no
  // badge at all).
  onAttentionCountChange,
}) {
  const [drafts, setDrafts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);
  // When the rows below were read. See the overdue-badge note further down.
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

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
              setFetchedAt(Date.now());
              onAttentionCountChange?.(
                rows.filter((r) => r.status === "failed").length,
              );
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
    [email, cacheKey, onAttentionCountChange],
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
      // The reason a queued submission is refused is almost always something the
      // operator can act on — an unresolved revert, a client not yet accredited, a
      // cell that cannot accept waste. It used to be shown as a bare sentence with
      // no next step, on a row whose Submit button then disappeared. The button
      // stays now (a failed record is retryable), so the message names where the
      // fix lives instead of leaving them to guess.
      const reason =
        err.response?.data?.message ||
        "Could not submit. Please review the data and try again.";
      const nextStep = /reverted submission/i.test(reason)
        ? "Open <b>Submission History</b>, correct the reverted entry and resubmit it — then retry this one."
        : /client|hauler/i.test(reason)
          ? "Open <b>Data Entry → Baseline → Accredited Haulers</b> to add or correct the record it names, then retry."
          : "Fix what the message names, then use <b>Retry submission</b> on this row.";
      Swal.fire({
        icon: "error",
        title: "Submission Failed",
        html: `<div style="text-align:left;font-size:13px"><p style="margin:0 0 10px">${reason}</p><p style="margin:0;color:#555">${nextStep}</p></div>`,
        confirmButtonColor: "#1a3353",
      });
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
    // A FAILED record is still submittable, and hiding the button was a dead end.
    //
    // POST /portal-queue/:id/submit stamps `status = "failed"` when submission is
    // rejected — a rejection is routinely something the operator can fix (an
    // unresolved revert, a missing cell, a client not yet accredited). But the
    // button was gated on draft/scheduled only, so the FIRST failure removed the
    // one control that could retry it, and PUT /:id refused to edit it. The draft
    // became unreachable: view or delete, nothing else. Live example:
    // rtabella@piwsi.ph has a Prime Waste Solution draft stranded at
    // retryCount=1 since its revert blocked it.
    //
    // `submitted` and `cancelled` stay terminal — those are genuinely done.
    const retryable = ["draft", "scheduled", "failed"].includes(record.status);
    return (
      <Space size={2} wrap>
        <Tooltip title="View data">
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setViewRecord(record)} />
        </Tooltip>
        {retryable && (
          <Tooltip title={record.status === "failed" ? "Retry submission" : "Submit now"}>
            <Button
              size="small"
              type="text"
              icon={<SendOutlined />}
              style={{ color: record.status === "failed" ? "#fa8c16" : "#52c41a" }}
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

  // ── Export ──────────────────────────────────────────────────────────────────
  //
  // One row per QUEUED RECORD, flattened — a draft's payload is a whole submission
  // (trucks, vehicles, haulers, baseline), and a spreadsheet of nested objects is
  // unreadable. The columns are what the operator is actually chasing: what it is,
  // whether it went, when it is due, and WHY it did not go. `failureReason` is the
  // point of the export — it is the one field the table truncates and the one that
  // says what to fix.
  const exportRows = (rows, kind) =>
    rows.map((r) => {
      const payload = r.payload || {};
      const trucks = Array.isArray(payload.trucks) ? payload.trucks : [];
      const volume = trucks.reduce((sum, t) => {
        const vehicles = Array.isArray(t?.vehicles) ? t.vehicles : [];
        return (
          sum +
          (vehicles.length
            ? vehicles.reduce((s, v) => s + Number(v?.actualVolume || 0), 0)
            : Number(t?.actualVolume || 0))
        );
      }, 0);
      return {
        Type: kind,
        Facility: r.slfName || DASH,
        Status: STATUS_META[r.status]?.label || r.status || DASH,
        "Date of Disposal": payload.dateOfDisposal
          ? safeDate(payload.dateOfDisposal, "MMM D, YYYY")
          : DASH,
        "Transport Entries": trucks.length,
        "Total Volume": volume ? Number(volume.toFixed(2)) : 0,
        Unit: unitOf(payload.baselineUnit, "m³"),
        "Scheduled For": r.scheduledAt ? safeDate(r.scheduledAt) : DASH,
        "Submitted At": r.submittedAt ? safeDate(r.submittedAt) : DASH,
        "Submission ID": r.resultSubmissionId || DASH,
        Attempts: r.retryCount || 0,
        "Failure Reason": r.failureReason || DASH,
        Created: safeDate(r.createdAt),
        "Last Updated": safeDate(r.updatedAt),
      };
    });

  const handleExport = () => {
    const rows = [...exportRows(drafts, "Draft"), ...exportRows(scheduled, "Scheduled")];
    if (rows.length === 0) {
      Swal.fire({
        icon: "info",
        title: "Nothing to Export",
        text: "You have no drafts or scheduled submissions yet.",
        timer: 1600,
        showConfirmButton: false,
      });
      return;
    }
    exportToExcel(
      rows,
      `drafts-scheduled-${dayjs().format("YYYY-MM-DD")}`,
      "Drafts & Scheduled",
    );
  };

  const emptyState = (text) => (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} style={{ padding: 24 }} />
  );

  // ── Tab badges ──────────────────────────────────────────────────────────────
  //
  // The counts were plain "Drafts (3)" text, which reads as a total and says
  // nothing about whether anything NEEDS the operator. What actually needs them
  // is a record that failed to submit, and a scheduled run that is now due — both
  // were invisible until the tab was opened and the Status column read.
  //
  // So the count stays as text and a red badge carries the ATTENTION count only:
  // it appears when something is wrong and is absent when the queue is merely
  // non-empty. `failed` covers both tabs; a scheduled record whose time has
  // passed while it is still pending is the scheduler having missed it.
  // "Overdue" is measured against the moment the list was READ, not against the
  // clock at render time: the rows are only ever as fresh as the last fetch, and
  // reading the clock during render is impure (it would also need a ticker to
  // stay true). `fetchedAt` moves on every load and Refresh, which is exactly
  // when the answer can actually change.
  const failedDrafts = drafts.filter((r) => r.status === "failed").length;
  const failedScheduled = scheduled.filter((r) => r.status === "failed").length;
  const overdueScheduled = scheduled.filter(
    (r) => r.status === "scheduled" && r.scheduledAt && new Date(r.scheduledAt).getTime() < fetchedAt,
  ).length;
  const tabLabel = (icon, text, total, attention, attentionTitle) => (
    <span>
      {icon} {text} ({total})
      {attention > 0 && (
        <Tooltip title={attentionTitle}>
          <Badge count={attention} size="small" style={{ marginLeft: 6 }} />
        </Tooltip>
      )}
    </span>
  );

  return (
    <Card
      style={{ borderRadius: 12 }}
      title={<Space><FileTextOutlined style={{ color: "#722ed1" }} /><Text strong>Drafts & Scheduled Submissions</Text></Space>}
      extra={
        <Space size={8} wrap>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExport}
            disabled={loading || drafts.length + scheduled.length === 0}
          >
            Export
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchQueue(true)} loading={loading}>Refresh</Button>
        </Space>
      }
    >
      <Spin spinning={loading}>
        <Tabs
          size="small"
          items={[
            {
              key: "drafts",
              label: tabLabel(
                <FileTextOutlined />,
                "Drafts",
                drafts.length,
                failedDrafts,
                `${failedDrafts} draft(s) failed to submit — open to see why, then retry.`,
              ),
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
              label: tabLabel(
                <ClockCircleOutlined />,
                "Scheduled",
                scheduled.length,
                failedScheduled + overdueScheduled,
                [
                  failedScheduled ? `${failedScheduled} failed to submit` : "",
                  overdueScheduled ? `${overdueScheduled} past its scheduled time` : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
              ),
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
        title={
          <Space size={8} wrap>
            <FileTextOutlined style={{ color: "#722ed1" }} />
            <span>{viewRecord?.type === "scheduled" ? "Scheduled Submission" : "Draft Submission"}</span>
            {viewRecord && statusTag(viewRecord.status)}
          </Space>
        }
        open={!!viewRecord}
        onCancel={() => setViewRecord(null)}
        footer={<Button onClick={() => setViewRecord(null)}>Close</Button>}
        width={1200}
        style={{ maxWidth: "96vw", top: 24 }}
        classNames={{ body: "slf-slim-scroll" }}
        destroyOnHidden
      >
        {viewRecord && <QueueRecordDetails record={viewRecord} />}
      </Modal>
    </Card>
  );
}
