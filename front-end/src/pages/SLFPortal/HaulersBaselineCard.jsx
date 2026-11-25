import { Button, Tooltip, Table } from "antd";
import { PlusOutlined, UploadOutlined, DownloadOutlined, BulbOutlined } from "@ant-design/icons";
import { Text } from "./portalShared";

export default function HaulersBaselineCard({
  baselineSaved, downloadHaulerTemplate, exportHaulerData, haulerColumns, haulerExportRef,
  haulerTableRef, haulerUploadRef, haulers, openFeatureTour, openHaulerModal, openUploadGuide,
}) {
  return (
    <div>
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Button
          type="primary"
          icon={<PlusOutlined />}
          className="slf-primary-btn"
          onClick={() => openHaulerModal(null)}
          disabled={baselineSaved}
        >
          Add Hauler
        </Button>
        <span ref={haulerUploadRef}>
          <Button
            icon={<UploadOutlined />}
            onClick={() =>
              openUploadGuide("hauler")
            }
            disabled={baselineSaved}
          >
            Upload Excel/CSV
          </Button>
        </span>
        <span ref={haulerExportRef}>
          <Button
            icon={<DownloadOutlined />}
            onClick={exportHaulerData}
            disabled={!haulers.length}
          >
            Export Hauler Data
          </Button>
        </span>
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={downloadHaulerTemplate}
        >
          Download Sample Template
        </Button>
        {/* Always available, not only while the
            release is new — a user who closed the
            tour early needs a way back in, and
            this is where its steps point. */}
        <Tooltip title="Replay the tour of what changed in bulk hauler and client updates">
          <Button
            type="link"
            icon={<BulbOutlined />}
            onClick={() => openFeatureTour()}
          >
            What&apos;s new
          </Button>
        </Tooltip>
      </div>
      <div ref={haulerTableRef}>
      <Table
        dataSource={haulers}
        columns={haulerColumns}
        rowKey="key"
        size="small"
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          showTotal: (total) => `${total} hauler(s)`,
        }}
        // Summed from the columns rather than
        // hardcoded, so the header and the body can
        // never disagree about where a column
        // starts. The literal 980 it replaced was
        // already short of the real total, and each
        // column added since made it shorter.
        scroll={{
          x: haulerColumns.reduce(
            (sum, col) => sum + (Number(col?.width) || 120),
            0,
          ),
        }}
        locale={{
          emptyText: (
            <Text
              type="secondary"
              style={{ fontSize: 13 }}
            >
              No haulers added.
            </Text>
          ),
        }}
      />
      </div>
    </div>
  );
}
