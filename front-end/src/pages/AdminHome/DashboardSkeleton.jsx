import { Row, Col, Card, Skeleton } from "antd";

export default function DashboardSkeleton({ isDark }) {
  const panelBg = isDark ? "#141414" : "#fff";
  const border = isDark ? "1px solid #303030" : "1px solid #f0f0f0";

  return (
    <div style={{ padding: "4px 0 16px" }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, overflow: "hidden" }}>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton.Button key={index} active size="small" style={{ width: index === 0 ? 180 : 150, height: 34, borderRadius: 8 }} />
        ))}
      </div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Col xs={12} md={6} key={index}>
            <Card style={{ borderRadius: 10, height: 110, background: panelBg, border }} bodyStyle={{ padding: 16 }}>
              <Skeleton active paragraph={{ rows: 1, width: ["70%"] }} title={{ width: "45%" }} />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Row gutter={[16, 16]}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Col xs={24} sm={12} key={index}>
                <Card style={{ borderRadius: 10, height: 280, background: panelBg, border }} bodyStyle={{ padding: 18 }}>
                  <Skeleton active paragraph={{ rows: 6 }} title={{ width: "52%" }} />
                </Card>
              </Col>
            ))}
          </Row>
        </Col>
        <Col xs={24} lg={10}>
          <Card style={{ borderRadius: 10, minHeight: 872, background: panelBg, border }} bodyStyle={{ padding: 18 }}>
            <Skeleton active paragraph={{ rows: 12 }} title={{ width: "46%" }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
