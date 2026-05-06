import { Tabs, Badge, Card, Row, Col, Statistic, Space, Typography, Tag } from "antd";
import { InboxOutlined, BarChartOutlined, DatabaseOutlined, DeleteOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import SubmissionSettings from "./SubmissionSettings";
import Reports from "./Reports";
import BaselineData from "./BaselineData";
import HaulerRequests from "./HaulerRequests";
import { useState, useEffect } from "react";
import api from "../../api";

const { Title, Text } = Typography;

export default function SLFWasteGenerators({ isDark, canEdit = true, canDelete = true }) {
  const [pendingHaulerReqs, setPendingHaulerReqs] = useState(0);

  useEffect(() => {
    api.get("/hauler-delete-requests", { params: { status: "pending", limit: 1 } })
      .then(({ data }) => setPendingHaulerReqs(data.total || 0))
      .catch(() => {});
    const interval = setInterval(() => {
      api.get("/hauler-delete-requests", { params: { status: "pending", limit: 1 } })
        .then(({ data }) => setPendingHaulerReqs(data.total || 0))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const tabItems = [
        {
          key: "submissions",
          label: (
            <>
              <InboxOutlined /> Submissions
            </>
          ),
          children: <SubmissionSettings isDark={isDark} canEdit={canEdit} canDelete={canDelete} />,
        },
        {
          key: "reports",
          label: (
            <>
              <BarChartOutlined /> Reports
            </>
          ),
          children: <Reports isDark={isDark} />,
        },
        {
          key: "baseline",
          label: (
            <>
              <DatabaseOutlined /> Baseline Data
            </>
          ),
          children: <BaselineData isDark={isDark} canEdit={canEdit} canDelete={canDelete} />,
        },
        {
          key: "hauler-requests",
          label: (
            <span>
              <DeleteOutlined /> Hauler Requests
              {pendingHaulerReqs > 0 && (
                <Badge count={pendingHaulerReqs} size="small" style={{ marginLeft: 6, backgroundColor: "#faad14" }} />
              )}
            </span>
          ),
          children: <HaulerRequests isDark={isDark} canEdit={canEdit} />,
        },
      ];

  return (
    <div style={{ padding: 0 }}>
      <Card
        style={{ borderRadius: 8, marginBottom: 16 }}
        bodyStyle={{ padding: 18 }}
      >
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} lg={10}>
            <Space align="start" size={12}>
              <div style={{ width: 42, height: 42, borderRadius: 8, background: isDark ? "rgba(47,84,235,0.16)" : "#f0f5ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <SafetyCertificateOutlined style={{ color: "#2f54eb", fontSize: 22 }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Waste Generators Management</Title>
                <Text type="secondary">Portal submissions, baseline data, reports, and hauler deletion requests</Text>
              </div>
            </Space>
          </Col>
          <Col xs={12} sm={6} lg={3}>
            <Statistic title="Work Areas" value={4} valueStyle={{ fontSize: 22, color: "#2f54eb" }} />
          </Col>
          <Col xs={12} sm={6} lg={4}>
            <Statistic title="Pending Hauler Requests" value={pendingHaulerReqs} valueStyle={{ fontSize: 22, color: pendingHaulerReqs > 0 ? "#fa8c16" : "#52c41a" }} />
          </Col>
          <Col xs={12} sm={6} lg={3}>
            <Tag color={canEdit ? "green" : "default"} style={{ padding: "4px 10px", borderRadius: 8 }}>Edit {canEdit ? "Enabled" : "Limited"}</Tag>
          </Col>
          <Col xs={12} sm={6} lg={4}>
            <Tag color={canDelete ? "red" : "default"} style={{ padding: "4px 10px", borderRadius: 8 }}>Delete {canDelete ? "Enabled" : "Limited"}</Tag>
          </Col>
        </Row>
      </Card>

      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: "8px 16px 16px" }}>
        <Tabs defaultActiveKey="submissions" items={tabItems} destroyOnHidden />
      </Card>
    </div>
  );
}
