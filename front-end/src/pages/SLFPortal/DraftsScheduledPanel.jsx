import { useState, useEffect, useCallback } from "react";
import {
  Card, Tabs, Table, Tag, Button, Space, Empty, Spin, Popconfirm, Tooltip,
  Modal, Descriptions, Typography, Alert, Badge, Progress,
} from "antd";
import {
  FileTextOutlined, ClockCircleOutlined, ReloadOutlined, SendOutlined,
  DeleteOutlined, StopOutlined, EyeOutlined, CheckCircleOutlined, DownloadOutlined,
  CloseCircleOutlined, ExclamationCircleOutlined, RedoOutlined, EditOutlined,
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
        <Alert
          type={isTransientFailure(record.failureReason) ? "warning" : "error"}
          showIcon
          message={
            isTransientFailure(record.failureReason)
              ? "Last attempt did not reach the server"
              : "Last attempt failed"
          }
          description={
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <span>{readableFailure(record.failureReason)}</span>
              {Number(record.retryCount) > 0 && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Attempted {Number(record.retryCount) + 1} times so far.
                </Text>
              )}
            </Space>
          }
        />
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
        <Descriptions.Item label="Status">{statusTag(record.status, record.retryCount)}</Descriptions.Item>
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

/**
 * A stored failure reason, in words the operator can act on.
 *
 * `failureReason` is written by the server and shown verbatim. When a submission
 * died on the database connection that text was the driver's own —
 * "connection 8574 to 35.240.228.82:27017 timed out" — which names an
 * infrastructure address and implies the operator's data is at fault. It is
 * neither. The server no longer records a timeout as a failure at all, but rows
 * stamped before that change still carry the string, so it is translated on the
 * way to the screen. Every other reason is a real, actionable rejection and is
 * passed through untouched.
 */
const TRANSIENT_FAILURE_RE =
  /connection \d+ to [\d.]+:\d+|timed out|timeout|ECONNRESET|socket hang up|server selection|topology was destroyed|not connected/i;

const isTransientFailure = (reason) => TRANSIENT_FAILURE_RE.test(String(reason || ""));

const readableFailure = (reason) =>
  isTransientFailure(reason)
    ? "The connection to the server dropped while this was being submitted. Nothing was submitted and nothing was lost — use Retry submission."
    : reason;

const statusTag = (status, retryCount = 0) => {
  const meta = STATUS_META[status] || { color: "default", label: status || "—" };
  const attempts = Number(retryCount) || 0;
  return (
    <Space size={4} wrap>
      <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
        {meta.label}
      </Tag>
      {/* How many times this row has been sent. It is the difference between
          "it failed" and "it has failed four times", which is what tells an
          operator to stop retrying and raise a ticket. Only shown once there
          IS a retry to report. */}
      {attempts > 0 && (
        <Tooltip title={`This submission has been attempted ${attempts + 1} time${attempts ? "s" : ""} in total.`}>
          <Tag color={attempts >= 3 ? "volcano" : "orange"} style={{ marginInlineEnd: 0 }}>
            <RedoOutlined /> {attempts} {attempts === 1 ? "retry" : "retries"}
          </Tag>
        </Tooltip>
      )}
    </Space>
  );
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
  // Opens a reverted submission in Edit & Resubmit, by id. A draft cannot be
  // submitted while an old revert is unresolved, so the failure offers the fix
  // itself rather than sending the operator to look for it.
  onResolveRevert,
  // Loads a draft (full record) into Data Entry for correcting. Without it a
  // draft rejected for its own content could only be retried unchanged.
  onEditDraft,
}) {
  const [drafts, setDrafts] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  // What a running "Submit now" / "Retry submission" is doing, for the progress
  // modal. Null when nothing is in flight. See submitNow.
  const [submitProgress, setSubmitProgress] = useState(null);
  // When the rows below were read. See the overdue-badge note further down.
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());

  const email = portalUser?.email;
  const cacheKey = `portal-queue-${email || ""}`;

  // Cached + resilient loader so re-entering the tab is instant and large
  // queues (up to thousands of drafts/scheduled) don't re-fetch every time.
  // Pass force to bypass the cache after a mutating action.
  //
  // `summary: 1` leaves the payloads in the database. Each one is a whole
  // submission — trucks, their vehicles, and every client selected on each — and
  // the table below shows none of it: facility, status, dates, failure reason.
  // Downloading all of them to render those columns is what made this tab slow
  // to open and, for an operator with a real backlog, slow enough that the
  // database connection timed out before the list arrived. The full payload is
  // read one record at a time, when a row is actually opened (openRecord).
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
              .get("/portal-queue", { params: { email, summary: 1 } })
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

  // The payload-derived facts the panel shows outside the detail modal: the
  // export's four columns, and the "how many transport entries am I sending?"
  // line in the progress modal. They come from `payloadSummary`, which the
  // server computes while the payload is still in the database (see
  // summarizePayload in routes/portalQueue.js). A record fetched in full — one
  // the detail modal has opened — is summarised locally instead, so both paths
  // give the same answer.
  const summaryOf = (r) => {
    if (r.payloadSummary) return r.payloadSummary;
    const payload = r.payload || {};
    const trucks = Array.isArray(payload.trucks) ? payload.trucks : [];
    const totalVolume = trucks.reduce((sum, t) => {
      const vehicles = Array.isArray(t?.vehicles) ? t.vehicles : [];
      return (
        sum +
        (vehicles.length
          ? vehicles.reduce((s, v) => s + Number(v?.actualVolume || 0), 0)
          : Number(t?.actualVolume || 0))
      );
    }, 0);
    return {
      dateOfDisposal: payload.dateOfDisposal || null,
      baselineUnit: payload.baselineUnit || "",
      truckCount: trucks.length,
      totalVolume: totalVolume ? Number(totalVolume.toFixed(2)) : 0,
    };
  };

  // Open one record's detail. The list carries no payload, so the record is read
  // in full here — the modal opens on the summary immediately and fills in.
  const openRecord = async (record) => {
    setViewRecord(record);
    if (record.payload) return;
    setViewLoading(true);
    try {
      // The same `email` the list was fetched with. A developer inspecting an
      // account holds a developer token, and the server requires an explicit
      // portal context from one — without it this read is refused for exactly
      // the rows the list just returned.
      const { data } = await api.get(`/portal-queue/${record._id}`, { params: { email } });
      setViewRecord((current) => (current?._id === record._id ? data : current));
    } catch {
      Swal.fire("Error", "Could not load this record's data. Please try again.", "error");
    } finally {
      setViewLoading(false);
    }
  };

  const submitNow = async (record) => {
    setBusyId(record._id);
    // What is actually being sent, so the modal can say so rather than spin.
    const entries = summaryOf(record).truckCount || 0;
    setSubmitProgress({
      record,
      entries,
      phase: "uploading",
      percent: 0,
      startedAt: Date.now(),
    });
    try {
      await api.post(
        `/portal-queue/${record._id}/submit`,
        {},
        {
          // REAL progress, not a timer: axios reports bytes actually put on the
          // wire. The server phase that follows cannot be measured from here —
          // it is one request — so the bar stops where the measurement stops and
          // the label says which phase it is in. A bar that kept climbing on a
          // setInterval would be inventing a number.
          onUploadProgress: (event) => {
            if (!event.total) return;
            const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
            setSubmitProgress((current) =>
              current && current.record._id === record._id
                ? { ...current, percent, phase: percent >= 99 ? "processing" : "uploading" }
                : current,
            );
          },
        },
      );
      setSubmitProgress((current) =>
        current && current.record._id === record._id
          ? { ...current, phase: "done", percent: 100 }
          : current,
      );
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
      // A dropped connection or a server that ran out of time is NOT something
      // the operator can fix by correcting their data, so it must not be given
      // the "fix what the message names" instruction — that sent people looking
      // for a mistake that was not there.
      const transient =
        err.response?.data?.code === "DB_TIMEOUT" ||
        !err.response ||
        isTransientFailure(reason);
      // The draft is blocked by ONE named reverted entry. Pointing the operator
      // at Submission History was not enough — Prime Waste Solution retried its
      // drafts repeatedly against SLF-LGU-PA-0018 and never opened it — so the
      // modal now opens that entry in Edit & Resubmit directly.
      const blockingRevert =
        !transient && err.response?.data?.code === "UNRESOLVED_REVERT"
          ? err.response?.data?.ruleContext
          : null;
      if (blockingRevert?.id && onResolveRevert) {
        const label = blockingRevert.idNo ? ` ${blockingRevert.idNo}` : "";
        Swal.fire({
          icon: "warning",
          title: "Resubmit Your Reverted Entry First",
          html: `<div style="text-align:left;font-size:13px"><p style="margin:0 0 10px">${readableFailure(reason)}</p><p style="margin:0;color:#555">Your draft is safe. Correct and resubmit the reverted entry${label}, then come back and submit this draft.</p></div>`,
          showCancelButton: true,
          confirmButtonText: `Edit & Resubmit${label}`,
          cancelButtonText: "Later",
          confirmButtonColor: "#fa541c",
        }).then((r) => {
          if (r.isConfirmed) onResolveRevert(blockingRevert.id);
        });
        fetchQueue(true);
        return;
      }
      const nextStep = transient
        ? "Nothing was submitted and nothing was lost. Use <b>Retry submission</b> on this row in a moment."
        : /reverted submission/i.test(reason)
          ? "Open <b>Submission History</b>, correct the reverted entry and resubmit it — then retry this one."
          : /client|hauler/i.test(reason)
            ? "Open <b>Data Entry → Baseline → Accredited Haulers</b> to add or correct the record it names, then retry."
            : "Fix what the message names, then use <b>Retry submission</b> on this row.";
      Swal.fire({
        icon: transient ? "warning" : "error",
        title: transient ? "Submission Did Not Go Through" : "Submission Failed",
        html: `<div style="text-align:left;font-size:13px"><p style="margin:0 0 10px">${readableFailure(reason)}</p><p style="margin:0;color:#555">${nextStep}</p></div>`,
        confirmButtonColor: "#1a3353",
      });
      fetchQueue(true);
    } finally {
      setBusyId(null);
      setSubmitProgress(null);
    }
  };

  // The list carries no payload, so the full record is read before it is handed
  // to Data Entry — same read as openRecord.
  const editInDataEntry = async (record) => {
    if (!onEditDraft) return;
    setBusyId(record._id);
    try {
      const { data } = record.payload
        ? { data: record }
        : await api.get(`/portal-queue/${record._id}`, { params: { email } });
      onEditDraft(data);
    } catch {
      Swal.fire("Error", "Could not open this draft for editing. Please try again.", "error");
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
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => openRecord(record)} />
        </Tooltip>
        {/* Drafts only: a scheduled run carries its own time, edited elsewhere. */}
        {!isScheduled && retryable && onEditDraft && (
          <Tooltip title="Edit in Data Entry">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              style={{ color: "#1a3353" }}
              disabled={busyId === record._id}
              onClick={() => editInDataEntry(record)}
            />
          </Tooltip>
        )}
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
    { title: "Status", dataIndex: "status", key: "status", width: 170, render: (_, r) => statusTag(r.status, r.retryCount) },
    { title: "Created", dataIndex: "createdAt", key: "createdAt", width: 170, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{safeDate(v)}</Text> },
    { title: "Last Updated", dataIndex: "updatedAt", key: "updatedAt", width: 170, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{safeDate(v)}</Text> },
    { title: "Actions", key: "actions", width: 140, render: (_, r) => commonActions(r) },
  ];

  const scheduledColumns = [
    { title: "Facility", dataIndex: "slfName", key: "slfName", render: (v) => <Text strong>{v || "—"}</Text> },
    { title: "Status", dataIndex: "status", key: "status", width: 170, render: (_, r) => statusTag(r.status, r.retryCount) },
    { title: "Scheduled For", dataIndex: "scheduledAt", key: "scheduledAt", width: 180, render: (v) => <Tag color="blue">{safeDate(v)}</Tag> },
    { title: "Submitted", dataIndex: "submittedAt", key: "submittedAt", width: 170, render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{safeDate(v)}</Text> },
    {
      title: "Result",
      key: "result",
      width: 180,
      render: (_, r) => {
        if (r.status !== "failed") {
          return r.status === "submitted"
            ? <Text type="success" style={{ fontSize: 12 }}>Submitted to Admin</Text>
            : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        }
        // A dropped connection is not a rejection of the data, and colouring it
        // like one sent operators hunting for a mistake that was not there.
        const transient = isTransientFailure(r.failureReason);
        const text = readableFailure(r.failureReason) || "Failed";
        return (
          <Tooltip title={text}>
            <Text type={transient ? "warning" : "danger"} style={{ fontSize: 12 }}>
              <ExclamationCircleOutlined /> {transient ? "Connection dropped — retry" : text}
            </Text>
          </Tooltip>
        );
      },
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
      const summary = summaryOf(r);
      return {
        Type: kind,
        Facility: r.slfName || DASH,
        Status: STATUS_META[r.status]?.label || r.status || DASH,
        "Date of Disposal": summary.dateOfDisposal
          ? safeDate(summary.dateOfDisposal, "MMM D, YYYY")
          : DASH,
        "Transport Entries": summary.truckCount || 0,
        "Total Volume": summary.totalVolume || 0,
        Unit: unitOf(summary.baselineUnit, "m³"),
        "Scheduled For": r.scheduledAt ? safeDate(r.scheduledAt) : DASH,
        "Submitted At": r.submittedAt ? safeDate(r.submittedAt) : DASH,
        "Submission ID": r.resultSubmissionId || DASH,
        Attempts: r.retryCount || 0,
        "Failure Reason": readableFailure(r.failureReason) || DASH,
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

      {/* ── Submission progress ────────────────────────────────────────────────
          Not closable and with no footer: the request is already in flight, and
          a Cancel that cannot actually stop the server would be a lie. It clears
          itself when the request settles (the `finally` in submitNow). */}
      <Modal
        open={!!submitProgress}
        title={
          <Space size={8}>
            <SendOutlined style={{ color: "#52c41a" }} />
            <span>Submitting to EMB Region III</span>
          </Space>
        }
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={null}
        width={460}
        style={{ maxWidth: "94vw" }}
      >
        {submitProgress && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Progress
              percent={submitProgress.percent}
              status={submitProgress.phase === "done" ? "success" : "active"}
              strokeColor={{ from: "#1677ff", to: "#52c41a" }}
            />
            <Text style={{ fontSize: 13 }}>
              {submitProgress.phase === "uploading"
                ? "Sending your data to the server…"
                : submitProgress.phase === "processing"
                  ? "Received. The server is validating and saving it…"
                  : "Done."}
            </Text>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Facility">
                {submitProgress.record.slfName || DASH}
              </Descriptions.Item>
              <Descriptions.Item label="Transport entries">
                {submitProgress.entries || 0}
              </Descriptions.Item>
              <Descriptions.Item label="Attempt">
                {(Number(submitProgress.record.retryCount) || 0) + 1}
              </Descriptions.Item>
            </Descriptions>
            {/* Said once, plainly, so a slow submit does not look like a lost
                one and get clicked again. */}
            <Text type="secondary" style={{ fontSize: 12 }}>
              Please keep this page open. If the connection drops, nothing is
              submitted and nothing is lost — the row stays here to retry.
            </Text>
          </Space>
        )}
      </Modal>

      <Modal
        title={
          <Space size={8} wrap>
            <FileTextOutlined style={{ color: "#722ed1" }} />
            <span>{viewRecord?.type === "scheduled" ? "Scheduled Submission" : "Draft Submission"}</span>
            {viewRecord && statusTag(viewRecord.status, viewRecord.retryCount)}
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
        {/* The payload arrives a moment after the modal (see openRecord), so the
            spinner covers the fill-in rather than the modal being empty. */}
        <Spin spinning={viewLoading} tip="Loading submission data…">
          {viewRecord && <QueueRecordDetails record={viewRecord} />}
        </Spin>
      </Modal>
    </Card>
  );
}
