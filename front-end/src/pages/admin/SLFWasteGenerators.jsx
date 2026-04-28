import { Tabs, Badge } from "antd";
import { InboxOutlined, BarChartOutlined, DatabaseOutlined, DeleteOutlined } from "@ant-design/icons";
import SubmissionSettings from "./SubmissionSettings";
import Reports from "./Reports";
import BaselineData from "./BaselineData";
import HaulerRequests from "./HaulerRequests";
import { useState, useEffect } from "react";
import api from "../../api";

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

  return (
    <Tabs
      defaultActiveKey="submissions"
      items={[
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
      ]}
    />
  );
}
