import { isHazardousCellType, normalizeUnit } from "../../slf-monitoring/helpers.jsx";
import { DatabaseOutlined } from "@ant-design/icons";
import { Button, Modal, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";

const { Text } = Typography;

// Portal submissions recorded for one facility on one disposal date.
export default function DailySubmissionsModal({
  dailySubmissionsModal,
  setDailySubmissionsModal,
}) {
  return (
    <Modal
      title={
        <Space>
          <DatabaseOutlined />
          Daily Submissions - {dailySubmissionsModal.cell?.cellName || "Cell"}
        </Space>
      }
      open={dailySubmissionsModal.open}
      onCancel={() =>
        setDailySubmissionsModal({ open: false, cell: null, rows: [] })
      }
      footer={
        <Button
          onClick={() =>
            setDailySubmissionsModal({ open: false, cell: null, rows: [] })
          }
        >
          Close
        </Button>
      }
      width={980}
      destroyOnHidden
    >
      <Table
        className="portal-user-wrap-table"
        size="small"
        rowKey="key"
        dataSource={dailySubmissionsModal.rows}
        pagination={{ pageSize: 8, size: "small" }}
        scroll={{ x: 900 }}
        locale={{
          emptyText: "No daily portal submissions found for this cell",
        }}
        columns={[
          {
            title: "Date Submitted",
            width: 150,
            render: (_, row) =>
              row.submission?.createdAt
                ? dayjs(row.submission.createdAt).format("MM/DD/YYYY h:mm A")
                : "—",
          },
          {
            title: "Submission ID",
            width: 160,
            render: (_, row) => (
              <Text strong style={{ fontSize: 12 }}>
                {row.submission?.idNo || row.submission?.submissionId || "—"}
              </Text>
            ),
          },
          {
            title: "Waste Generator",
            width: 190,
            render: (_, row) => (
              <Text
                style={{
                  fontSize: 12,
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                }}
              >
                {row.submission?.lguCompanyName ||
                  row.submission?.companyName ||
                  "—"}
              </Text>
            ),
          },
          {
            title: "Truck / Ticket",
            width: 160,
            render: (_, row) => (
              <Space direction="vertical" size={0}>
                <Text style={{ fontSize: 12 }}>
                  {row.truck?.plateNumber || "No plate"}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {row.truck?.disposalTicketNo ||
                    row.truck?.ticketNo ||
                    "No ticket"}
                </Text>
              </Space>
            ),
          },
          {
            title: "Waste Type",
            width: 160,
            render: (_, row) => (
              <Tag
                color={
                  isHazardousCellType(row.truck?.wasteType) ? "red" : "blue"
                }
              >
                {row.truck?.wasteType || "Residual"}
              </Tag>
            ),
          },
          {
            title: "Volume",
            width: 130,
            align: "right",
            render: (_, row) =>
              `${Number(row.truck?.actualVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })} ${normalizeUnit(row.truck?.actualVolumeUnit || dailySubmissionsModal.cell?.unit || "tons")}`,
          },
          {
            title: "Status",
            width: 120,
            render: (_, row) => (
              <Tag>{row.submission?.status || "pending"}</Tag>
            ),
          },
        ]}
      />
    </Modal>
  );
}
