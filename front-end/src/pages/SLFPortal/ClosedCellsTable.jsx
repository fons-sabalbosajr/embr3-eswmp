import { Table, Tooltip, Tag, Space, Button } from "antd";
import { Text } from "./portalShared";
import { cellFor } from "./submissionCellUsage";
import { getCellStatusConfig } from "../../utils/cellVisuals";
import { normalizeUnit } from "./helpers";
import dayjs from "dayjs";
import { EditOutlined, DeleteOutlined } from "@ant-design/icons";

export default function ClosedCellsTable({
  baselineSaved, closedCellEntries, declaredCellUnit, facilityCells, openCellEntryForEdit,
  setClosedCellDraft, setClosedCellEntries, setClosedCellModalOpen, setEditingClosedCellKey,
}) {
  return (
    <Table
      dataSource={closedCellEntries}
      rowKey="key"
      size="small"
      pagination={false}
      style={{ marginBottom: 0 }}
      locale={{
        emptyText: (
          <Text
            type="secondary"
            style={{ fontSize: 12 }}
          >
            No entries yet.
            {!baselineSaved &&
              ' Click "Add Entry" above to add cell data.'}
          </Text>
        ),
      }}
      columns={[
        {
          title: "#",
          key: "idx",
          width: 42,
          render: (_, __, i) => (
            <Text
              style={{
                fontSize: 12,
                color: "#8c8c8c",
              }}
            >
              {i + 1}
            </Text>
          ),
        },
        {
          title: "Cell Name",
          dataIndex: "cellName",
          key: "cellName",
          // The operator's own name first when they
          // gave one, with the admin's cell under it.
          render: (v, r) =>
            r.cellLabel ? (
              <div style={{ lineHeight: 1.3 }}>
                <Text style={{ fontSize: 12.5 }}>{r.cellLabel}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    EMB cell: {v || "—"}
                  </Text>
                </div>
              </div>
            ) : (
              v || (
                <Text
                  type="secondary"
                  style={{ fontSize: 12 }}
                >
                  Unnamed Cell
                </Text>
              )
            ),
        },
        {
          // The cell's status as EMB set it on the
          // admin side (Active, Reserved, Under
          // Construction, …), in the shared palette.
          title: "Status",
          key: "cellStatus",
          width: 150,
          render: (_, r) => {
            const cell = cellFor(r, facilityCells);
            if (!cell) return <Text type="secondary" style={{ fontSize: 12 }}>Not in cell infra</Text>;
            const status = getCellStatusConfig(cell.status);
            return (
              <Tooltip title={status.description || undefined}>
                <Tag color={status.tag} style={{ fontSize: 11 }}>{status.label}</Tag>
              </Tooltip>
            );
          },
        },
        {
          title: "Waste Type",
          dataIndex: "wasteType",
          key: "wasteType",
          width: 160,
          render: (v) => {
            const isHaz = v
              ?.toLowerCase()
              .includes("hazardous");
            const isInert = v === "Inert";
            return (
              <Tag
                color={
                  isHaz
                    ? "red"
                    : isInert
                      ? "purple"
                      : "orange"
                }
                style={{ fontSize: 11 }}
              >
                {v}
              </Tag>
            );
          },
        },
        {
          title: "Volume",
          key: "vol",
          width: 140,
          render: (_, r) => (
            <Text
              strong
              style={{ color: "#722ed1" }}
            >
              {r.volume != null
                ? `${r.volume.toLocaleString()} ${normalizeUnit(r.unit || declaredCellUnit(r.cellIndex))}`
                : "—"}
            </Text>
          ),
        },
        {
          title: "Date Closed",
          dataIndex: "dateClosed",
          key: "dateClosed",
          width: 120,
          render: (v) =>
            v ? (
              dayjs(v).format("MMM D, YYYY")
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Not set
              </Text>
            ),
        },
        !baselineSaved && {
          title: "",
          key: "act",
          width: 72,
          render: (_, r) => (
            <Space size={0}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                style={{ color: "#1a3353" }}
                onClick={() => {
                  openCellEntryForEdit(r, {
                    setDraft: setClosedCellDraft,
                    setEditingKey: setEditingClosedCellKey,
                    setOpen: setClosedCellModalOpen,
                  });
                }}
              />
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() =>
                  setClosedCellEntries((prev) =>
                    prev.filter(
                      (e) => e.key !== r.key,
                    ),
                  )
                }
              />
            </Space>
          ),
        },
      ].filter(Boolean)}
    />
  );
}
