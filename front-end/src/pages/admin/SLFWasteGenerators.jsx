import { Tabs, Badge, Card, Typography, Space } from "antd";
import {
  InboxOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  PieChartOutlined,
} from "@ant-design/icons";
import SubmissionSettings from "./SubmissionSettings";
import SubmissionSummary from "./SubmissionSummary";
import Reports from "./Reports";
import BaselineData from "./BaselineData";
import HaulerRequests from "./HaulerRequests";
import CellWastePlacement from "./CellWastePlacement";
import { useState, useEffect } from "react";
import api from "../../api";

const { Title, Text } = Typography;

export default function SLFWasteGenerators({
  isDark,
  canEdit = true,
  canDelete = true,
  canViewSubmissions = true,
  canViewReports = true,
  canEditReports = true,
  canDeleteReports = true,
  canViewBaseline = true,
  canEditBaseline = true,
  canDeleteBaseline = true,
  canOverrideBaselineUnlock = false,
  canViewCellPlacement = true,
  canEditCellPlacement = true,
  canRepairIds = false,
}) {
  const [pendingHaulerReqs, setPendingHaulerReqs] = useState(0);

  useEffect(() => {
    api
      .get("/hauler-delete-requests", {
        params: { status: "pending", limit: 1 },
      })
      .then(({ data }) => setPendingHaulerReqs(data.total || 0))
      .catch(() => {});
    const interval = setInterval(() => {
      api
        .get("/hauler-delete-requests", {
          params: { status: "pending", limit: 1 },
        })
        .then(({ data }) => setPendingHaulerReqs(data.total || 0))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const tabItems = [
    {
      key: "summary",
      label: (
        <>
          <PieChartOutlined /> Summary
        </>
      ),
      children: <SubmissionSummary isDark={isDark} />,
      hidden: !canViewReports,
    },
    {
      key: "submissions",
      label: (
        <>
          <InboxOutlined /> Submissions
        </>
      ),
      children: (
        <SubmissionSettings
          isDark={isDark}
          canEdit={canEdit}
          canDelete={canDelete}
          canRepairIds={canRepairIds}
        />
      ),
      hidden: !canViewSubmissions,
    },
    {
      key: "reports",
      label: (
        <>
          <BarChartOutlined /> Reports
        </>
      ),
      children: (
        <Reports
          isDark={isDark}
          canEdit={canEditReports}
          canDelete={canDeleteReports}
        />
      ),
      hidden: !canViewReports,
    },
    {
      key: "baseline",
      label: (
        <>
          <DatabaseOutlined /> Baseline Data
        </>
      ),
      children: (
        <BaselineData
          isDark={isDark}
          canEdit={canEditBaseline}
          canDelete={canDeleteBaseline}
          canOverrideUnlock={canOverrideBaselineUnlock}
        />
      ),
      hidden: !canViewBaseline,
    },
    {
      key: "hauler-requests",
      label: (
        <span>
          <DeleteOutlined /> Hauler Requests
          {pendingHaulerReqs > 0 && (
            <Badge
              count={pendingHaulerReqs}
              size="small"
              style={{ marginLeft: 6, backgroundColor: "#faad14" }}
            />
          )}
        </span>
      ),
      children: <HaulerRequests isDark={isDark} canEdit={canEdit} />,
      hidden: !canViewSubmissions,
    },
     {
      key: "cell-placement",
      label: (
        <>
          <DatabaseOutlined /> Cell Waste Placement
        </>
      ),
      children: <CellWastePlacement canEdit={canEditCellPlacement} />,
      hidden: !canViewCellPlacement,
    },
  ].filter((item) => !item.hidden);

  return (
    <div style={{ padding: 0 }}>
      <div style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={2}>
          <Title level={4} style={{ margin: 0 }}>
            <InboxOutlined style={{ color: "#1a3353", marginRight: 8 }} />
            Portal Submissions
          </Title>
          <Text type="secondary">
            Review SLF submissions, summaries, reports, baseline data, and
            hauler deletion requests.
          </Text>
        </Space>
      </div>
      <Card
        style={{ borderRadius: 8 }}
        bodyStyle={{ padding: "8px 16px 16px" }}
      >
        <Tabs
          defaultActiveKey={tabItems[0]?.key}
          items={tabItems}
          destroyOnHidden={false}
        />
      </Card>
    </div>
  );
}
