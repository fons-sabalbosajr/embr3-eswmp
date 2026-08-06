import { R3_PROVINCES } from "../../slf-monitoring/SlfDashboardTab";
import { BankOutlined, BarChartOutlined, EnvironmentOutlined, TableOutlined } from "@ant-design/icons";
import { Button, Card, Col, Empty, Modal, Row, Space, Statistic, Table, Tabs } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";

// Waste-received insight modal: per-facility totals derived from the loaded records.
export default function SlfWasteModal({
  slfWasteModal,
  setSlfWasteModal,
  records,
}) {
  return (
    <Modal
      open={slfWasteModal}
      onCancel={() => setSlfWasteModal(false)}
      title={
        <Space>
          <BarChartOutlined style={{ color: "#ff4d4f" }} />
          <Text strong>Waste Received — SLF Details</Text>
        </Space>
      }
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button onClick={() => setSlfWasteModal(false)}>Close</Button>
          <Button
            type="primary"
            icon={<TableOutlined />}
            onClick={() => setSlfWasteModal(false)}
          >
            See More Details in Table
          </Button>
        </div>
      }
      width={1100}
      destroyOnHidden
    >
      {(() => {
        const wasteData = records.filter(
          (r) => Number(r.actualResidualWasteReceived || 0) > 0,
        );
        const r3Lgus = wasteData.filter(
          (r) =>
            R3_PROVINCES.includes(r.province) &&
            !/private/i.test(r.ownership || ""),
        );
        const outLgus = wasteData.filter(
          (r) =>
            !R3_PROVINCES.includes(r.province) &&
            !/private/i.test(r.ownership || ""),
        );
        const privates = wasteData.filter((r) =>
          /private/i.test(r.ownership || ""),
        );
        const toBarData = (arr) =>
          arr
            .map((r) => ({
              name: r.lgu || r.province || "Unknown",
              waste: r.actualResidualWasteReceived || 0,
              province: r.province || "—",
              status: r.statusOfSLF || "—",
            }))
            .sort((a, b) => b.waste - a.waste);
        const WasteSection = ({ data, color, label }) => {
          const barData = toBarData(data);
          const total = barData.reduce((s, d) => s + d.waste, 0);
          if (barData.length === 0)
            return (
              <Empty
                description={`No ${label} waste data available`}
                style={{ padding: 24 }}
              />
            );
          return (
            <div style={{ marginBottom: 20 }}>
              <Row gutter={12} style={{ marginBottom: 10 }}>
                <Col span={8}>
                  <Card
                    size="small"
                    style={{
                      borderRadius: 8,
                      background: `${color}0d`,
                      border: `1px solid ${color}40`,
                    }}
                  >
                    <Statistic
                      title="SLF Facilities"
                      value={barData.length}
                      styles={{ content: { color, fontSize: 20 } }}
                    />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card
                    size="small"
                    style={{
                      borderRadius: 8,
                      background: `${color}0d`,
                      border: `1px solid ${color}40`,
                    }}
                  >
                    <Statistic
                      title="Total Waste Received"
                      value={total.toLocaleString()}
                      styles={{ content: { color, fontSize: 20 } }}
                    />
                  </Card>
                </Col>
                <Col span={8}>
                  <Card
                    size="small"
                    style={{
                      borderRadius: 8,
                      background: `${color}0d`,
                      border: `1px solid ${color}40`,
                    }}
                  >
                    <Statistic
                      title="Avg/Facility"
                      value={(total / barData.length).toLocaleString(
                        undefined,
                        { maximumFractionDigits: 0 },
                      )}
                      styles={{ content: { color, fontSize: 20 } }}
                    />
                  </Card>
                </Col>
              </Row>
              <ResponsiveContainer
                width="100%"
                height={Math.max(160, barData.length * 30)}
              >
                <BarChart
                  data={barData}
                  layout="vertical"
                  margin={{ top: 4, right: 40, bottom: 4, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v
                    }
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={130}
                    tick={{ fontSize: 11 }}
                  />
                  <RTooltip
                    formatter={(v) => [
                      `${Number(v).toLocaleString()} tons`,
                      "Waste Received",
                    ]}
                  />
                  <Bar
                    dataKey="waste"
                    fill={color}
                    radius={[0, 4, 4, 0]}
                    isAnimationActive={false}
                    label={{
                      position: "right",
                      fontSize: 10,
                      formatter: (v) =>
                        v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v,
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        };
        return (
          <Tabs
            defaultActiveKey="r3"
            items={[
              {
                key: "r3",
                label: (
                  <span>
                    <EnvironmentOutlined /> Region 3 LGUs ({r3Lgus.length})
                  </span>
                ),
                children: (
                  <WasteSection
                    data={r3Lgus}
                    color="#52c41a"
                    label="Region 3 LGU"
                  />
                ),
              },
              {
                key: "out",
                label: (
                  <span>
                    <EnvironmentOutlined /> Outside Region 3 ({outLgus.length}
                    )
                  </span>
                ),
                children: (
                  <WasteSection
                    data={outLgus}
                    color="#1890ff"
                    label="outside Region 3 LGU"
                  />
                ),
              },
              {
                key: "private",
                label: (
                  <span>
                    <BankOutlined /> Private Industries ({privates.length})
                  </span>
                ),
                children: (
                  <WasteSection
                    data={privates}
                    color="#722ed1"
                    label="private industry"
                  />
                ),
              },
            ]}
          />
        );
      })()}
    </Modal>
  );
}
