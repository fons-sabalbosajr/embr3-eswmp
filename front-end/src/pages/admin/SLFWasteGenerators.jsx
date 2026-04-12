import { Tabs } from "antd";
import { InboxOutlined, BarChartOutlined } from "@ant-design/icons";
import SubmissionSettings from "./SubmissionSettings";
import Reports from "./Reports";

export default function SLFWasteGenerators({ canEdit = true, canDelete = true }) {
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
          children: <SubmissionSettings canEdit={canEdit} canDelete={canDelete} />,
        },
        {
          key: "reports",
          label: (
            <>
              <BarChartOutlined /> Reports
            </>
          ),
          children: <Reports />,
        },
      ]}
    />
  );
}
