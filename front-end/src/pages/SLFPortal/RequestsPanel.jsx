import { Card, Space, Table, Tag, Tooltip, Button } from "antd";
import { AuditOutlined, DeleteOutlined } from "@ant-design/icons";
import { REQUEST_TYPE_MAP } from "./constants";

// ── My Requests & Amendments ──
// Presentational: renders the portal user's request/amendment list. All data
// and the hide action are owned by the container and passed in as props.
export default function RequestsPanel({
  myRequests,
  myRequestsLoading,
  onHideRequest,
}) {
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
          pagination={{
            defaultPageSize: 10,
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
              width: 180,
              sorter: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
              defaultSortOrder: "descend",
              render: (v) =>
                v
                  ? new Date(v).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "—",
            },
            {
              title: "Type",
              dataIndex: "type",
              key: "type",
              width: 200,
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
              ellipsis: true,
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
              width: 80,
              align: "center",
              render: (_, record) => (
                <Tooltip title="Remove from my list (admin keeps a record)">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => onHideRequest(record)}
                  />
                </Tooltip>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
