import { Card, Space, Typography, Button, Table, Empty } from "antd";
import { HistoryOutlined, ReloadOutlined } from "@ant-design/icons";

const { Text } = Typography;

// ── Submission History ──
// Presentational: renders grouped submission history. Grouping, columns, and
// the refresh action are owned by the container and passed in as props.
export default function HistoryPanel({
  groupedSubmissions,
  historyColumns,
  loadingSubmissions,
  onRefresh,
}) {
  return (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      <Card
        className="slf-section"
        title={
          <Space>
            <HistoryOutlined style={{ color: "#1a3353" }} />
            <Text strong style={{ fontSize: 16, color: "#1a3353" }}>
              Submission History
            </Text>
          </Space>
        }
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
            Refresh
          </Button>
        }
      >
        <Table
          // Submissions that belong to the same batch collapse into ONE parent row
          // that expands to its children. Ungrouped submissions render exactly as
          // before. See submissionGrouping.js for the canonical grouping rules.
          dataSource={groupedSubmissions}
          columns={historyColumns}
          rowKey={(r) => (r.isGroup ? r.key : r._id)}
          loading={loadingSubmissions}
          size="small"
          pagination={{ pageSize: 15 }}
          scroll={{ x: 1100 }}
          expandable={{
            // Only a real group expands; a standalone submission has no children.
            rowExpandable: (r) => !!r.isGroup,
            expandedRowRender: (r) => (
              <Table
                dataSource={r.children}
                columns={historyColumns}
                rowKey="_id"
                size="small"
                pagination={false}
                showHeader={false}
              />
            ),
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No submissions yet"
              />
            ),
          }}
        />
      </Card>
    </div>
  );
}
