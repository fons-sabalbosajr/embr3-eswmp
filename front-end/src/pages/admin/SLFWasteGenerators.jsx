import { Tabs } from "antd";
import { InboxOutlined, BarChartOutlined, DatabaseOutlined } from "@ant-design/icons";
import SubmissionSettings from "./SubmissionSettings";
import Reports from "./Reports";
import BaselineData from "./BaselineData";

export default function SLFWasteGenerators({ isDark, canEdit = true, canDelete = true }) {
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
      ]}
    />
  );
}
