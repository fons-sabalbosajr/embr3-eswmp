import { InsightStat } from "../../slf-monitoring/SlfDashboardTab";
import { ACCENT } from "../../slf-monitoring/helpers.jsx";
import { EnvironmentOutlined, EyeOutlined } from "@ant-design/icons";
import { Button, Card, Col, Divider, Empty, Modal, Row, Space, Tag, Typography } from "antd";

const { Text } = Typography;

// Drill-down for a clicked summary tile (cells / capacity / waste / …).
export default function SlfInsightModal({
  slfInsightModal,
  setSlfInsightModal,
  setDetailModal,
  config,
  provinceGroups,
  totalCells,
  cellsWithData,
  opCount,
}) {
  return (
    <Modal
      open={!!slfInsightModal}
      onCancel={() => setSlfInsightModal(null)}
      title={
        <Space>
          {config.icon}
          <Text strong>Cell Infrastructure - All Facilities</Text>
          <Tag color="cyan">{provinceGroups.length} province(s)</Tag>
        </Space>
      }
      footer={<Button onClick={() => setSlfInsightModal(null)}>Close</Button>}
      width={1280}
      destroyOnHidden
      styles={{ body: { maxHeight: "74vh", overflowY: "auto" } }}
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={6}>
          <InsightStat title="Total Cells" value={totalCells} color={config.color} />
        </Col>
        <Col xs={24} md={6}>
          <InsightStat title="Facilities with Cells" value={cellsWithData} color={config.color} />
        </Col>
        <Col xs={24} md={6}>
          <InsightStat title="Operational SLFs" value={opCount} color={config.color} />
        </Col>
        <Col xs={24} md={6}>
          <InsightStat title="Avg Cells / SLF" value={cellsWithData ? (totalCells / cellsWithData).toFixed(1) : 0} color={config.color} />
        </Col>
      </Row>
      {provinceGroups.length === 0 ? (
        <Empty description="No SLF cell infrastructure is encoded in the current table view." />
      ) : (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {provinceGroups.map(({ province, facilities }) => (
            <Card
              key={province}
              size="small"
              title={
                <Space wrap>
                  <EnvironmentOutlined style={{ color: config.color }} />
                  <Text strong>{province}</Text>
                  <Tag color="blue">{facilities.length} SLF(s)</Tag>
                </Space>
              }
              style={{ borderRadius: 10 }}
            >
              <Row gutter={[12, 12]}>
                {facilities.map(({ record, summary }) => (
                  <Col xs={24} md={12} xl={8} key={record._id}>
                    <Card
                      size="small"
                      hoverable
                      onClick={() => {
                        setSlfInsightModal(null);
                        setDetailModal(record);
                      }}
                      style={{ borderRadius: 10, height: "100%", borderLeft: `4px solid ${config.color}` }}
                    >
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        <div>
                          <Text strong style={{ fontSize: 14, color: ACCENT }}>
                            {`${record.province || province} LGU ${record.lgu || "Unnamed SLF"} Sanitary Landfill Facility`}
                          </Text>
                          <div><Text type="secondary">{record.province || province}</Text></div>
                        </div>
                        <Tag color="geekblue" style={{ width: "fit-content" }}>
                          {summary.total} Cell{summary.total === 1 ? "" : "s"}
                        </Tag>
                        <Row gutter={[8, 8]}>
                          <Col span={12}><Tag color="blue">{summary.residual} Residual</Tag></Col>
                          <Col span={12}><Tag color="red">{summary.hazardous} Hazardous</Tag></Col>
                        </Row>
                        <Divider plain style={{ margin: "4px 0" }}>Status Summary</Divider>
                        <Space size={[4, 4]} wrap>
                          {["Active", "Reserved", "In Use", "Used / Completed"].map((label) => (
                            <Tag key={label} color={label === "Active" ? "green" : label === "Reserved" ? "gold" : label === "In Use" ? "blue" : "default"}>
                              {label}: {summary.statuses[label] || 0}
                            </Tag>
                          ))}
                        </Space>
                        <Button type="link" size="small" icon={<EyeOutlined />} style={{ padding: 0, alignSelf: "flex-start" }}>
                          Click to View Cells
                        </Button>
                      </Space>
                    </Card>
                  </Col>
                ))}
              </Row>
            </Card>
          ))}
        </Space>
      )}
    </Modal>
  );
}
