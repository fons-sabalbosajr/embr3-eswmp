import { InsightStat } from "../../slf-monitoring/SlfDashboardTab";
import { CHART_COLORS } from "../../slf-monitoring/helpers.jsx";
import { Alert, Button, Card, Col, Empty, Modal, Progress, Row, Space, Tag } from "antd";
import { Cell as RCell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from "recharts";

// Expanded breakdown behind a summary-tile drill-down.
export default function SlfInsightDetailModal({
  slfInsightModal,
  setSlfInsightModal,
}) {
  return (
    <Modal
      open={!!slfInsightModal}
      onCancel={() => setSlfInsightModal(null)}
      title={
        <Space>
          {config.icon}
          <Text strong>{config.title}</Text>
        </Space>
      }
      footer={<Button onClick={() => setSlfInsightModal(null)}>Close</Button>}
      width={1120}
      destroyOnHidden
    >
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={6}>
          <InsightStat
            title={config.primaryTitle}
            value={config.primary}
            suffix={config.primarySuffix}
            color={config.color}
          />
        </Col>
        {config.stats.map((stat) => (
          <Col xs={24} md={6} key={stat.title}>
            <InsightStat
              title={stat.title}
              value={stat.value}
              suffix={stat.suffix}
              color={config.color}
            />
          </Col>
        ))}
      </Row>

      <Alert
        type="info"
        showIcon
        message="Operational Narrative"
        description={config.narration}
        style={{ marginBottom: 16, borderRadius: 8 }}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card
            size="small"
            title="Facility Ranking"
            style={{ borderRadius: 8, height: "100%" }}
          >
            {config.chartData.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No encoded data for this metric"
              />
            ) : (
              <Space direction="vertical" size={10} style={{ width: "100%" }}>
                {config.chartData.map((item, index) => (
                  <div key={`${item.name}-${index}`}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        marginBottom: 4,
                      }}
                    >
                      <Text strong style={{ fontSize: 12 }}>
                        {index + 1}. {item.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: config.color }}>
                        {Number(item.value).toLocaleString()} {item.label}
                      </Text>
                    </div>
                    <Progress
                      percent={Math.round((item.value / maxBar) * 100)}
                      showInfo={false}
                      strokeColor={config.color}
                      trailColor="#f0f0f0"
                      size="small"
                    />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {item.province} - {item.ownership} - {item.status}
                    </Text>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card
            size="small"
            title="Breakdown"
            style={{ borderRadius: 8, height: "100%" }}
          >
            {config.pieData.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No breakdown data"
              />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={210}>
                  <PieChart>
                    <Pie
                      data={config.pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {config.pieData.map((_, index) => (
                        <RCell
                          key={`slice-${index}`}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <RTooltip
                      formatter={(value, name) => [
                        Number(value).toLocaleString(),
                        name,
                      ]}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={40}
                      wrapperStyle={{ fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <Space size={[6, 6]} wrap>
                  {config.pieData.slice(0, 8).map((item, index) => (
                    <Tag
                      key={item.name}
                      color={index % 2 === 0 ? "blue" : "geekblue"}
                    >
                      {item.name}: {Number(item.value).toLocaleString()}
                    </Tag>
                  ))}
                </Space>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </Modal>
  );
}
