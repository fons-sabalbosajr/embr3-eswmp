import { Tabs, Badge, Card, Typography, Space } from "antd";
import {
  InboxOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  PieChartOutlined,
  CustomerServiceOutlined,
} from "@ant-design/icons";
import SubmissionSettings from "./SubmissionSettings";
import SubmissionSummary from "./SubmissionSummary";
import Reports from "./Reports";
import BaselineData from "./BaselineData";
import HaulerRequests from "./HaulerRequests";
import CellWastePlacement from "./CellWastePlacement";
import SupportTickets from "./SupportTickets";
import { useState, useEffect } from "react";
import api from "../../api";
import { NAVY } from "../../utils/palette";

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
  isDeveloper = false,
  initialTab = null,
  submissionsContext = null,
}) {
  const [pendingHaulerReqs, setPendingHaulerReqs] = useState(0);
  const [activeTab, setActiveTab] = useState(null);

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

  const [openTickets, setOpenTickets] = useState(0);

  useEffect(() => {
    const loadTickets = () =>
      api
        .get("/support-tickets", { params: { status: "open", limit: 1 } })
        .then(({ data }) => setOpenTickets(data.total || 0))
        .catch(() => {});
    loadTickets();
    const interval = setInterval(loadTickets, 30000);
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
          isDeveloper={isDeveloper}
          submissionsContext={submissionsContext}
        />
      ),
      hidden: !canViewSubmissions,
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
      key: "support-tickets",
      label: (
        <span>
          <CustomerServiceOutlined /> Support Tickets
          {openTickets > 0 && (
            <Badge
              count={openTickets}
              size="small"
              style={{ marginLeft: 6, backgroundColor: "#ff4d4f" }}
            />
          )}
        </span>
      ),
      children: <SupportTickets canEdit={canEdit} />,
      hidden: !canViewSubmissions,
    },
  ].filter((item) => !item.hidden);

  return (
    <div className="admin-page" style={{ padding: 0 }}>
      <div className="admin-page-head" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={2}>
          <Title level={4} style={{ margin: 0 }}>
            <InboxOutlined style={{ color: NAVY, marginRight: 8 }} />
            Portal Submissions
          </Title>
          <Text type="secondary">
            Review SLF submissions, summaries, reports, baseline data, and
            hauler deletion requests.
          </Text>
        </Space>
      </div>
      <Card
        className="admin-page-card"
        style={{ borderRadius: 8 }}
        bodyStyle={{ padding: "8px 16px 16px" }}
      >
        <Tabs
          activeKey={activeTab || initialTab || tabItems.find((t) => !t.hidden)?.key}
          onChange={setActiveTab}
          items={tabItems}
          destroyOnHidden={false}
          // Seven tabs, each an icon plus a label, never fit a phone. antd's
          // default is to hide the overflow behind a "more" dropdown, which
          // buries whole sections; swiping keeps them all discoverable.
          moreIcon={null}
        />
      </Card>
    </div>
  );
}
