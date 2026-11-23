import { useState } from "react";
import {
  Card,
  Space,
  Table,
  Tag,
  Tooltip,
  Button,
  Modal,
  Descriptions,
  Timeline,
  Typography,
  Empty,
} from "antd";
import {
  AuditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { REQUEST_TYPE_MAP } from "./constants";

const { Text, Paragraph } = Typography;

// Which family a request/amendment type belongs to. Drives the contextual detail
// layout AND how its conversation thread is linked together.
const requestCategory = (type = "") => {
  if (type.startsWith("baseline_update")) return "baseline";
  if (type.startsWith("submission_edit")) return "submission";
  if (type.startsWith("support_ticket")) return "support";
  return "other";
};

// Stable key used to gather the records that CAN belong to the same conversation
// (the original request + its approval/rejection + admin replies). For baseline
// requests this is the whole facility — see conversationFor, which then cuts it
// down to the one request being viewed.
const threadKey = (record = {}) => {
  const category = requestCategory(record.type);
  const meta = record.meta || {};
  if (category === "submission") {
    return `sub:${record.submissionId || meta.idNo || record._id}`;
  }
  if (category === "baseline") {
    return `base:${String(meta.slfName || record.companyName || record._id)
      .trim()
      .toLowerCase()}`;
  }
  if (category === "support") {
    return `tkt:${meta.ticketNo || meta.ticketId || record.submissionId || record._id}`;
  }
  return `id:${record._id}`;
};

// The type a row is SHOWN as (a baseline rejection is logged under the request
// type; the server marks it with displayType).
const rowType = (record = {}) => record.displayType || record.type || "";

// A row the OPERATOR raised. Uses the displayed type: an admin's baseline
// rejection is stored under the request type but displayed as a rejection.
const isRequestRow = (record = {}) => {
  if (record.meta?.action === "rejected") return false;
  const t = rowType(record);
  return /_request$/.test(t) || t === "support_ticket";
};

/**
 * The conversation for ONE request.
 *
 * Baseline requests share a facility-wide key, so the old modal showed every
 * baseline request and approval the facility ever had (hundreds of rows) as if
 * they were one conversation. Cut the facility's records into segments, each
 * starting at a request, and return the segment the viewed record sits in: the
 * request plus the answers that followed it, up to the next request.
 */
const conversationFor = (viewing, all = []) => {
  if (!viewing) return [];
  const related = all
    .filter((r) => threadKey(r) === threadKey(viewing))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (requestCategory(viewing.type) !== "baseline") return related;
  const segments = [];
  related.forEach((row) => {
    if (isRequestRow(row) || !segments.length) segments.push([row]);
    else segments[segments.length - 1].push(row);
  });
  return segments.find((seg) => seg.some((r) => r._id === viewing._id)) || [viewing];
};

/**
 * The operator's own reason / statement for a request, wherever it was stored:
 * the edit or baseline reason, a ticket's message or subject.
 */
const reasonOf = (record = {}) => {
  const meta = record.meta || {};
  if (meta.reason) return String(meta.reason);
  if (meta.message) return String(meta.message);
  if (meta.subject) return String(meta.subject);
  if (record.type === "support_ticket") {
    // "Support ticket TKT-00049 created: Needed to edit Baseline Data"
    const m = /created:\s*(.+)$/i.exec(record.description || "");
    if (m) return m[1];
  }
  return "";
};

/**
 * The description WITHOUT the reason repeated inside it. Edit requests are
 * logged as "Portal user requested edit for SLF-…: <reason>", which put the same
 * paragraph in the table twice once the reason got its own column.
 */
const summaryOf = (record = {}) => {
  const description = String(record.description || "").trim();
  const reason = reasonOf(record).trim();
  if (reason && description.includes(reason)) {
    const stripped = description.replace(reason, "").replace(/[:\s–-]+$/, "").trim();
    return stripped || description;
  }
  return description;
};

const fromRequester = (entry = {}) =>
  isRequestRow(entry) && !/approved|rejected|reply/.test(rowType(entry));

// The status of a row, as the admin side labels it. Resolved by the server from
// the admin's actual answer to this request (server/utils/requestStatus.js);
// the inference below is only the fallback for a server that predates it.
const statusOf = (record, all = []) => {
  if (record?.requestStatus?.label) return record.requestStatus;
  const type = record?.type || "";
  if (type.includes("approved")) return { label: "Approved", color: "green" };
  if (type.includes("rejected") || record?.meta?.action === "rejected") return { label: "Rejected", color: "red" };
  if (type.includes("request")) {
    const company = record.companyName || record.meta?.slfName;
    const base = type.replace("_request", "");
    const resolved = all.find(
      (t) =>
        t._id !== record._id &&
        new Date(t.createdAt) >= new Date(record.createdAt) &&
        (t.companyName === company || t.meta?.slfName === company) &&
        (t.type === `${base}_approved` || t.type === `${base}_rejected` || t.meta?.action === "rejected"),
    );
    if (resolved?.type?.includes("approved")) return { label: "Approved", color: "green" };
    if (resolved) return { label: "Rejected", color: "red" };
    return { label: "Pending", color: "orange" };
  }
  return { label: "Info", color: "blue" };
};

const fmtDateTime = (v) =>
  v
    ? new Date(v).toLocaleString("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

// ── My Requests & Amendments ──
// Presentational: renders the portal user's request/amendment list and a
// type-aware View Conversation modal. All data and the hide action are owned by
// the container and passed in as props.
export default function RequestsPanel({
  myRequests,
  myRequestsLoading,
  onHideRequest,
}) {
  const [viewing, setViewing] = useState(null);

  const category = viewing ? requestCategory(viewing.type) : "other";
  const meta = viewing?.meta || {};

  // Conversation for THIS request only, oldest first. Reuses the already-loaded
  // list — no extra API call.
  const thread = conversationFor(viewing, myRequests || []);
  const viewingReason = viewing ? reasonOf(viewing) : "";

  // Type-specific detail rows so a support ticket, a submission edit and a
  // baseline update never share one generic layout.
  const detailItems = (() => {
    if (!viewing) return [];
    const rows = [];
    // The reason itself is shown in its own block above, not repeated here.
    if (category === "submission") {
      if (meta.idNo) rows.push({ label: "Record ID No.", value: meta.idNo });
      if (viewing.submissionId)
        rows.push({ label: "Submission ID", value: viewing.submissionId });
    } else if (category === "baseline") {
      if (meta.slfName) rows.push({ label: "SLF", value: meta.slfName });
      if (Array.isArray(meta.fields) && meta.fields.length)
        rows.push({ label: "Sections to Update", value: meta.fields.join(", ") });
    } else if (category === "support") {
      if (meta.ticketNo)
        rows.push({ label: "Ticket No.", value: meta.ticketNo });
      if (meta.category)
        rows.push({ label: "Category", value: meta.category });
      if (meta.priority)
        rows.push({ label: "Priority", value: meta.priority });
    }
    if (viewing.companyName)
      rows.push({ label: "Company / SLF", value: viewing.companyName });
    return rows;
  })();

  return (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      <Card
        className="slf-section"
        title={
          <Space>
            <AuditOutlined style={{ color: "#1a3353" }} />
            <span>My Requests &amp; Amendments</span>
          </Space>
        }
      >
        <Table
          className="slf-compact-requests"
          size="small"
          dataSource={myRequests}
          rowKey={(r) => r._id}
          loading={myRequestsLoading}
          scroll={{ x: 980 }}
          pagination={{
            defaultPageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `${total} request(s)`,
          }}
          locale={{ emptyText: "No requests found" }}
          columns={[
            {
              title: "Date / Time",
              dataIndex: "createdAt",
              key: "date",
              width: 170,
              sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
              defaultSortOrder: "descend",
              render: (v) => (v ? fmtDateTime(v) : "—"),
            },
            {
              // Type and description in ONE column: the tag says what kind of
              // request it is, the line under it says what it was about.
              title: "Request",
              key: "request",
              width: 320,
              filters: Object.entries(REQUEST_TYPE_MAP).map(
                ([val, { label }]) => ({
                  text: label,
                  value: val,
                }),
              ),
              onFilter: (value, record) => rowType(record) === value,
              render: (_, record) => {
                const t = rowType(record);
                const cfg = REQUEST_TYPE_MAP[t] || {
                  label: t,
                  color: "default",
                };
                return (
                  <div style={{ whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    <Tag color={cfg.color} style={{ marginBottom: 4 }}>{cfg.label}</Tag>
                    <div style={{ fontSize: 12, color: "#434343" }}>{summaryOf(record) || "—"}</div>
                  </div>
                );
              },
            },
            {
              title: "Reason / Statement",
              key: "reason",
              width: 300,
              render: (_, record) => {
                const reason = reasonOf(record);
                if (!reason) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
                return (
                  <Paragraph
                    style={{ margin: 0, fontSize: 12, whiteSpace: "normal", overflowWrap: "anywhere" }}
                    ellipsis={{ rows: 3, tooltip: reason }}
                  >
                    {reason}
                  </Paragraph>
                );
              },
            },
            {
              title: "Status",
              key: "status",
              width: 150,
              // Options from the statuses actually present, so nothing unused is
              // offered.
              filters: [
                ...new Set((myRequests || []).map((r) => statusOf(r, myRequests).label)),
              ].map((label) => ({ text: label, value: label })),
              onFilter: (value, record) => statusOf(record, myRequests).label === value,
              render: (_, record) => {
                const status = statusOf(record, myRequests);
                return <Tag color={status.color}>{status.label}</Tag>;
              },
            },
            {
              title: "Actions",
              key: "actions",
              width: 110,
              align: "center",
              render: (_, record) => (
                <Space size={2}>
                  <Tooltip title="View conversation & details">
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setViewing(record)}
                    />
                  </Tooltip>
                  <Tooltip title="Remove from my list (admin keeps a record)">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => onHideRequest(record)}
                    />
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!viewing}
        onCancel={() => setViewing(null)}
        footer={
          <Button onClick={() => setViewing(null)}>Close</Button>
        }
        title={
          viewing ? (
            <Space>
              <AuditOutlined style={{ color: "#1a3353" }} />
              <span>
                {(REQUEST_TYPE_MAP[rowType(viewing)] || { label: rowType(viewing) })
                  .label}
              </span>
            </Space>
          ) : (
            "Request Details"
          )
        }
        width={680}
        styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }}
      >
        {viewing && (
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            {/* What the operator asked for, in their own words — the one thing
                the reviewer reads first. */}
            <div
              style={{
                background: "#f6f9ff",
                border: "1px solid #d6e4ff",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                {category === "support" ? "Subject / Message" : "Reason / Statement"}
              </Text>
              <Paragraph style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {viewingReason || <Text type="secondary">No reason was given.</Text>}
              </Paragraph>
              {summaryOf(viewing) && (
                <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 6 }}>
                  {summaryOf(viewing)}
                </Text>
              )}
            </div>
            <Descriptions
              size="small"
              column={1}
              bordered
              className="portal-user-wrap-table"
            >
              <Descriptions.Item label="Type">
                <Tag
                  color={
                    (REQUEST_TYPE_MAP[rowType(viewing)] || { color: "default" })
                      .color
                  }
                >
                  {(REQUEST_TYPE_MAP[rowType(viewing)] || { label: rowType(viewing) })
                    .label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <Tag color={statusOf(viewing, myRequests).color}>
                  {statusOf(viewing, myRequests).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Submitted">
                {fmtDateTime(viewing.createdAt)}
              </Descriptions.Item>
              {detailItems.map((row) => (
                <Descriptions.Item key={row.label} label={row.label}>
                  <span
                    style={{
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                      wordBreak: "break-word",
                    }}
                  >
                    {row.value}
                  </span>
                </Descriptions.Item>
              ))}
            </Descriptions>

            <div>
              <Text strong style={{ display: "block", marginBottom: 8 }}>
                Conversation &amp; History
                <Text type="secondary" style={{ fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
                  {thread.length} entr{thread.length === 1 ? "y" : "ies"} for this request
                </Text>
              </Text>
              {thread.length ? (
                // One entry per message, each in its own bubble: the operator's
                // side on the right, EMB's answers on the left — instead of one
                // undivided list.
                <Timeline
                  items={thread.map((entry) => {
                    const cfg = REQUEST_TYPE_MAP[rowType(entry)] || {
                      label: rowType(entry),
                      color: "blue",
                    };
                    const color = entry.type.includes("approved")
                      ? "green"
                      : entry.type.includes("rejected") ||
                          entry.meta?.action === "rejected"
                        ? "red"
                        : entry.type.includes("reply")
                          ? "blue"
                          : "gray";
                    const mine = fromRequester(entry);
                    const entryReason = reasonOf(entry);
                    const isViewed = entry._id === viewing._id;
                    return {
                      key: entry._id,
                      color,
                      children: (
                        <div
                          style={{
                            background: mine ? "#f0f7ff" : "#f6ffed",
                            border: `1px solid ${isViewed ? "#1a3353" : mine ? "#d6e4ff" : "#d9f7be"}`,
                            borderRadius: 8,
                            padding: "8px 10px",
                            marginBottom: 2,
                          }}
                        >
                          <Space size={6} wrap style={{ marginBottom: 2 }}>
                            <Tag color={cfg.color} style={{ margin: 0 }}>
                              {cfg.label}
                            </Tag>
                            <Text strong style={{ fontSize: 11 }}>
                              {mine ? "You" : "EMB Region III"}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {fmtDateTime(entry.createdAt)}
                            </Text>
                          </Space>
                          <Paragraph
                            style={{
                              margin: "2px 0 0",
                              fontSize: 12.5,
                              whiteSpace: "pre-wrap",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {summaryOf(entry) || "—"}
                          </Paragraph>
                          {entryReason && !isViewed && (
                            <Paragraph
                              type="secondary"
                              style={{ margin: "4px 0 0", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                            >
                              “{entryReason}”
                            </Paragraph>
                          )}
                        </div>
                      ),
                    };
                  })}
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No conversation history"
                />
              )}
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
}
