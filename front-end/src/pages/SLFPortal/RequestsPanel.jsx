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

// Stable key used to gather every record that belongs to the same conversation
// (the original request + its approval/rejection + admin replies).
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

  // Conversation thread: every record that shares this request's thread key,
  // oldest first. Reuses the already-loaded list — no extra API call.
  const thread = viewing
    ? (myRequests || [])
        .filter((r) => threadKey(r) === threadKey(viewing))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    : [];

  // Type-specific detail rows so a support ticket, a submission edit and a
  // baseline update never share one generic layout.
  const detailItems = (() => {
    if (!viewing) return [];
    const rows = [];
    if (category === "submission") {
      if (viewing.submissionId)
        rows.push({ label: "Submission ID", value: viewing.submissionId });
      if (meta.idNo) rows.push({ label: "Record ID No.", value: meta.idNo });
      if (meta.reason)
        rows.push({ label: "Reason for Edit", value: meta.reason });
    } else if (category === "baseline") {
      if (meta.slfName) rows.push({ label: "SLF", value: meta.slfName });
      if (meta.reason) rows.push({ label: "Reason", value: meta.reason });
    } else if (category === "support") {
      if (meta.ticketNo)
        rows.push({ label: "Ticket No.", value: meta.ticketNo });
      if (meta.subject) rows.push({ label: "Subject", value: meta.subject });
      if (meta.category)
        rows.push({ label: "Category", value: meta.category });
      if (meta.message) rows.push({ label: "Message", value: meta.message });
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
          scroll={{ x: 900 }}
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
              title: "Type",
              dataIndex: "type",
              key: "type",
              width: 190,
              filters: Object.entries(REQUEST_TYPE_MAP).map(
                ([val, { label }]) => ({
                  text: label,
                  value: val,
                }),
              ),
              onFilter: (value, record) => record.type === value,
              render: (t) => {
                const cfg = REQUEST_TYPE_MAP[t] || {
                  label: t,
                  color: "default",
                };
                return <Tag color={cfg.color}>{cfg.label}</Tag>;
              },
            },
            {
              title: "Description",
              dataIndex: "description",
              key: "description",
              width: 320,
              // Wrap long descriptions instead of letting them stretch the table.
              render: (text) => (
                <span
                  style={{
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    display: "inline-block",
                  }}
                >
                  {text || "—"}
                </span>
              ),
            },
            {
              title: "Status",
              dataIndex: "type",
              key: "status",
              width: 120,
              render: (type, record) => {
                const approved = type.includes("approved");
                const rejected =
                  type.includes("rejected") ||
                  record.meta?.action === "rejected";
                if (approved) return <Tag color="green">APPROVED</Tag>;
                if (rejected) return <Tag color="red">REJECTED</Tag>;
                // For request types, check if a resolution exists in the list
                if (type.includes("request")) {
                  const company = record.companyName || record.meta?.slfName;
                  const resolutionType = type.replace("_request", "");
                  const resolved = myRequests.find(
                    (t) =>
                      t._id !== record._id &&
                      new Date(t.createdAt) >= new Date(record.createdAt) &&
                      (t.companyName === company ||
                        t.meta?.slfName === company) &&
                      (t.type === `${resolutionType}_approved` ||
                        t.type === `${resolutionType}_rejected` ||
                        t.meta?.action === "rejected"),
                  );
                  if (resolved) {
                    if (resolved.type.includes("approved"))
                      return <Tag color="green">APPROVED</Tag>;
                    if (
                      resolved.type.includes("rejected") ||
                      resolved.meta?.action === "rejected"
                    )
                      return <Tag color="red">REJECTED</Tag>;
                  }
                  return <Tag color="orange">PENDING</Tag>;
                }
                return <Tag color="blue">INFO</Tag>;
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
                {(REQUEST_TYPE_MAP[viewing.type] || { label: viewing.type })
                  .label}
              </span>
            </Space>
          ) : (
            "Request Details"
          )
        }
        width={620}
        styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
      >
        {viewing && (
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Descriptions
              size="small"
              column={1}
              bordered
              className="portal-user-wrap-table"
            >
              <Descriptions.Item label="Type">
                <Tag
                  color={
                    (REQUEST_TYPE_MAP[viewing.type] || { color: "default" })
                      .color
                  }
                >
                  {(REQUEST_TYPE_MAP[viewing.type] || { label: viewing.type })
                    .label}
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
              <Text strong style={{ display: "block", marginBottom: 6 }}>
                Conversation &amp; History
              </Text>
              {thread.length ? (
                <Timeline
                  items={thread.map((entry) => {
                    const cfg = REQUEST_TYPE_MAP[entry.type] || {
                      label: entry.type,
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
                    return {
                      color,
                      children: (
                        <div>
                          <Space size={6} wrap>
                            <Tag color={cfg.color} style={{ margin: 0 }}>
                              {cfg.label}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {fmtDateTime(entry.createdAt)}
                            </Text>
                            {entry.performedBy && (
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                · {entry.performedBy}
                              </Text>
                            )}
                          </Space>
                          <Paragraph
                            style={{
                              margin: "4px 0 0",
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {entry.description || "—"}
                          </Paragraph>
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
