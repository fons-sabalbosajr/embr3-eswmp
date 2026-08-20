import { DeleteOutlined, EditOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Tooltip } from "antd";

// Column definitions for the Data Entry accredited-hauler table.
//
// Once the baseline is locked (`baselineSaved`) a hauler can no longer be
// removed outright — the row opens a deletion REQUEST instead, which is why the
// three hauler-delete setters are part of the signature.
export function makeHaulerColumns({
  slfUnit,
  baselineSaved,
  openHaulerModal,
  removeHauler,
  setHaulerDeleteModal,
  setHaulerDeleteReason,
  setHaulerDeleteFile,
}) {
  return [
      { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
      { title: "Accredited Hauler", dataIndex: "haulerName", key: "haulerName", width: 200 },
      {
        title: "Trucks",
        dataIndex: "numberOfTrucks",
        key: "numberOfTrucks",
        width: 70,
      },
      {
        title: "Vehicles",
        key: "vehicles",
        width: 250,
        render: (_, h) => {
          const veh =
            h.vehicles?.length > 0
              ? h.vehicles
              : h.plateNumber || h.vehicleType
                ? [
                    {
                      plateNumber: h.plateNumber,
                      vehicleType: h.vehicleType,
                      capacity: h.capacity,
                      capacityUnit: h.capacityUnit,
                    },
                  ]
                : [];
          if (veh.length === 0) return "—";
          return veh.map((v, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: "18px" }}>
              {v.vehicleType || "—"} · {v.plateNumber || "—"}
              {v.capacity != null
                ? ` · ${v.capacity} ${(v.capacityUnit || slfUnit).replace("m3", "m³")}`
                : ""}
            </div>
          ));
        },
      },
      {
        title: "Clients",
        dataIndex: "privateSectorClients",
        key: "privateSectorClients",
        width: 180,
        render: (v) => {
          const arr = Array.isArray(v) ? v : v ? [v] : [];
          if (arr.length === 0) return "—";
          return arr.map((c, i) => {
            const name = typeof c === "string" ? c : c.clientName;
            const type = typeof c === "string" ? null : c.clientType;
            return (
              <div key={i} style={{ fontSize: 12, lineHeight: "18px" }}>
                {name}
                {type ? (
                  <Tag
                    color={type === "LGU" ? "blue" : "green"}
                    style={{ marginLeft: 4, fontSize: 10 }}
                  >
                    {type}
                  </Tag>
                ) : null}
              </div>
            );
          });
        },
      },
      {
        title: "Client Type",
        key: "clientType",
        width: 130,
        render: (_, h) => {
          const arr = Array.isArray(h.privateSectorClients)
            ? h.privateSectorClients
            : h.privateSectorClients
              ? [h.privateSectorClients]
              : [];
          const types = [
            ...new Set(
              arr.map((c) => (typeof c === "string" ? "Private" : c.clientType || "Private")),
            ),
          ];
          return types.length
            ? types.map((type) => (
                <Tag key={type} color={type === "LGU" ? "blue" : "green"}>
                  {type}
                </Tag>
              ))
            : "—";
        },
      },
      {
        title: "Client Address",
        key: "clientAddress",
        width: 240,
        render: (_, h) => {
          const arr = Array.isArray(h.privateSectorClients)
            ? h.privateSectorClients
            : h.privateSectorClients
              ? [h.privateSectorClients]
              : [];
          const addresses = arr
            .map((c) =>
              typeof c === "string"
                ? ""
                : c.clientAddress ||
                  c.address ||
                  [c.municipalityName || c.municipality, c.provinceName || c.province, c.regionName || c.region]
                    .filter(Boolean)
                    .join(", "),
            )
            .filter(Boolean);
          return addresses.length
            ? addresses.map((address, index) => (
                <div key={`${address}-${index}`} style={{ fontSize: 12, lineHeight: "18px" }}>
                  {address}
                </div>
              ))
            : "—";
        },
      },
      {
        title: "Actions",
        key: "actions",
        width: 130,
        render: (_, h) => (
          <Space size="small">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openHaulerModal(h)}
              style={{ color: "#1a3353" }}
            />
            {/* Straight to this hauler's client list. Maintaining clients in
                bulk is a per-hauler job, so it gets its own way in rather than
                being buried behind Edit → expand Clients. */}
            <Tooltip title="Export or upload this hauler's client list">
              <Button
                type="text"
                size="small"
                icon={<TeamOutlined />}
                onClick={() => openHaulerModal(h, "clients")}
                style={{ color: "#614700" }}
              />
            </Tooltip>
            <Tooltip
              title={baselineSaved ? "Request hauler deletion" : "Remove hauler"}
            >
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => {
                  if (!baselineSaved) {
                    removeHauler(h.key);
                    return;
                  }
                  setHaulerDeleteReason("");
                  setHaulerDeleteFile(null);
                  setHaulerDeleteModal({ open: true, hauler: h });
                }}
              />
            </Tooltip>
          </Space>
        ),
      },
  ];
}
