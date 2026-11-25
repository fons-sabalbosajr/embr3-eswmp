import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Space } from "antd";

// Column definitions for the Data Entry truck table.
//
// A factory rather than a constant: the cell renderers call back into the
// container (open the edit modal, remove a row) and read the facility unit, so
// those are passed in explicitly instead of being closed over.
export function makeTruckColumns({
  slfUnit,
  openTruckModal,
  removeTruck,
  // A backlog's entries each carry their own disposal date — show it. An
  // ordinary entry's trucks all share the form's Date of Disposal.
  showDisposalDate = false,
}) {
  return [
      { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
      ...(showDisposalDate
        ? [
            {
              title: "Disposal Date",
              dataIndex: "disposalDate",
              key: "disposalDate",
              width: 120,
              sorter: (a, b) => String(a.disposalDate || "").localeCompare(String(b.disposalDate || "")),
              render: (v) =>
                v ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Form date",
            },
          ]
        : []),
      {
        title: "Ticket No.",
        dataIndex: "disposalTicketNo",
        key: "disposalTicketNo",
        render: (v) => v || "—",
      },
      { title: "Hauler", dataIndex: "hauler", key: "hauler" },
      {
        title: "Plate No.",
        key: "plateNumber",
        render: (_, t) => {
          const vehs = t.vehicles || [];
          if (vehs.length > 1)
            return (
              vehs
                .map((v) => v.plateNumber)
                .filter(Boolean)
                .join(", ") ||
              t.plateNumber ||
              "—"
            );
          return vehs[0]?.plateNumber || t.plateNumber || "—";
        },
      },
      {
        title: "Capacity",
        key: "cap",
        render: (_, t) => {
          const vehs = t.vehicles || [];
          if (vehs.length > 1)
            return (
              vehs
                .filter((v) => v.capacity != null)
                .map(
                  (v) =>
                    `${v.capacity} ${(v.capacityUnit || slfUnit).replace("m3", "m³")}`,
                )
                .join(", ") || "—"
            );
          const cap = vehs[0]?.capacity ?? t.truckCapacity;
          const unit = vehs[0]?.capacityUnit || t.truckCapacityUnit || slfUnit;
          return cap != null ? `${cap} ${unit.replace("m3", "m³")}` : "—";
        },
      },
      {
        title: "Actual Volume",
        key: "vol",
        render: (_, t) =>
          t.actualVolume != null
            ? `${t.actualVolume} ${t.actualVolumeUnit || slfUnit}`
            : "—",
      },
      {
        title: "Cell(s)",
        key: "cells",
        render: (_, t) => {
          const vehs = t.vehicles || [];
          const cells = vehs.map((v) => v.cellName).filter(Boolean);
          if (cells.length) {
            const unique = [...new Set(cells)];
            return unique.join(", ");
          }
          return t.cellName || "—";
        },
      },
      {
        title: "Waste Type",
        dataIndex: "wasteType",
        key: "wasteType",
        render: (v) => v || "—",
      },
      {
        title: "Haz. Code",
        dataIndex: "hazWasteCode",
        key: "hazWasteCode",
        render: (v) => (Array.isArray(v) ? v.join(", ") : v) || "—",
      },
      {
        title: "Actions",
        key: "actions",
        width: 100,
        render: (_, t) => (
          <Space size="small">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openTruckModal(t)}
              style={{ color: "#1a3353" }}
            />
            <Button
              type="text"
              danger
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => removeTruck(t.key)}
            />
          </Space>
        ),
      },
  ];
}
