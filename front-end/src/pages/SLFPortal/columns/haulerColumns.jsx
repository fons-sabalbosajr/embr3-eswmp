import { DeleteOutlined, EditOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Space, Tag, Tooltip } from "antd";
import EmbVerifiedMark from "../EmbVerifiedMark";

// Everything decidable about the filters lives in haulerFilters.js so it can be
// tested — this file holds JSX and is unreachable from the `node --test` suite.
//
// That module also still exports the office-address and truck-band filters used
// by the two columns commented out below, and they are covered by the tests. They
// are not imported here because an unused import is a lint error; re-enabling
// either column means adding its name back to this list.
import {
  NONE,
  clientAddressOf,
  clientTypesOf,
  clientsOf,
  distinctFilters,
  filterByClientAddress,
  filterByClientName,
  filterByClientType,
  filterByHaulerName,
  filterByVehicleType,
  text,
  vehiclesOf,
} from "./haulerFilters.js";

// Column definitions for the Data Entry accredited-hauler table.
//
// Once the baseline is locked (`baselineSaved`) a hauler can no longer be
// removed outright — the row opens a deletion REQUEST instead, which is why the
// three hauler-delete setters are part of the signature.
//
// `haulers` is the loaded fleet, and it is here only to build the FILTER option
// lists — every filter offers the values this facility actually has, so a list of
// 141 haulers is narrowed by picking real names rather than by guessing at them.
// The caller memoizes this on `haulers` for the same reason: on the large
// facilities the option lists are O(haulers × clients) to derive, which must not
// be repeated on every render.
export function makeHaulerColumns({
  slfUnit,
  baselineSaved,
  haulers = [],
  openHaulerModal,
  removeHauler,
  setHaulerDeleteModal,
  setHaulerDeleteReason,
  setHaulerDeleteFile,
}) {
  return [
      { title: "#", key: "index", width: 40, render: (_, __, i) => i + 1 },
      {
        title: "Accredited Hauler",
        dataIndex: "haulerName",
        key: "haulerName",
        width: 200,
        // Searchable, because this is the one list as long as the table itself —
        // scrolling a 141-entry filter menu is no better than scrolling the table.
        filters: distinctFilters(haulers, (h) => [h.haulerName], "(unnamed)"),
        filterSearch: true,
        onFilter: filterByHaulerName,
        sorter: (a, b) => text(a.haulerName).localeCompare(text(b.haulerName)),
      },
      // {
      //   // The hauler's OWN address, which this table did not show at all. Office
      //   // Address is an optional column of the hauler bulk upload whose blank
      //   // cells mean "keep what is stored", so after a baseline update most
      //   // haulers still have none — and with no column here, nothing said so.
      //   // Missing is stated in words and is clickable, because the fix is one
      //   // field inside Edit Accredited Hauler.
      //   title: "Office Address",
      //   dataIndex: "officeAddress",
      //   key: "officeAddress",
      //   width: 200,
      //   // Encoded / not encoded rather than the addresses themselves: nobody
      //   // hunts for one hauler by its street, but "show me everything still
      //   // missing an address" is the whole reason this column exists.
      //   filters: [
      //     { text: "Not encoded", value: "missing" },
      //     { text: "Encoded", value: "encoded" },
      //   ],
      //   onFilter: filterByOfficeAddress,
      //   render: (value, h) =>
      //     text(value) ? (
      //       <span style={{ fontSize: 12, lineHeight: "18px" }}>{value}</span>
      //     ) : (
      //       <Tooltip title="EMB Region III asks for each accredited hauler's office address. Click to add it.">
      //         <Button
      //           type="link"
      //           size="small"
      //           style={{ padding: 0, height: "auto", fontSize: 12 }}
      //           onClick={() => openHaulerModal(h)}
      //         >
      //           Not encoded
      //         </Button>
      //       </Tooltip>
      //     ),
      // },
      {
        title: "Trucks",
        dataIndex: "numberOfTrucks",
        key: "numberOfTrucks",
        align: "center",
        width: 80,
        // Left plain deliberately. Filtering a count by band and sorting on it
        // both crowd an 80px header with a funnel and a caret for a column whose
        // whole content is one or two digits; the bands stay available in
        // haulerFilters (TRUCK_BUCKETS / truckCount / filterByTruckBucket) if the
        // column is ever widened enough to carry them.
        // filters: TRUCK_BUCKETS.map(({ text: label, value }) => ({ text: label, value })),
        // onFilter: filterByTruckBucket,
        // sorter: (a, b) => truckCount(a) - truckCount(b),
      },
      {
        title: "Vehicles",
        key: "vehicles",
        width: 250,
        // By vehicle TYPE, not by plate: a plate identifies one truck and is
        // already searchable in the hauler editor, whereas "which of my haulers
        // run compactors" is a question about the fleet.
        filters: distinctFilters(
          haulers,
          (h) => vehiclesOf(h).map((vehicle) => vehicle.vehicleType),
          "No vehicle encoded",
        ),
        filterSearch: true,
        onFilter: filterByVehicleType,
        render: (_, h) => {
          const veh = vehiclesOf(h);
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
        width: 160,
        // Answers "which hauler serves this LGU?" from the table itself. The
        // "No clients encoded" entry matters most: those haulers cannot have a
        // single disposal row imported, because every row resolves through
        // Hauler → Client.
        filters: distinctFilters(
          haulers,
          (h) => clientsOf(h).map((client) => client.clientName),
          "No clients encoded",
        ),
        filterSearch: true,
        onFilter: filterByClientName,
        render: (v) => {
          const arr = Array.isArray(v) ? v : v ? [v] : [];
          if (arr.length === 0) return "—";
          return arr.map((c, i) => {
            const name = typeof c === "string" ? c : c.clientName;
            // The per-client type tag used to be inlined here; the adjacent
            // Client Type column carries it now, so this cell is names only.
            return (
              <div key={i} style={{ fontSize: 12, lineHeight: "18px" }}>
                {name}
                <EmbVerifiedMark client={c} compact />
              </div>
            );
          });
        },
      },
      {
        title: "Client Type",
        key: "clientType",
        width: 120,
        filters: [
          { text: "LGU", value: "LGU" },
          { text: "Private", value: "Private" },
          { text: "Type not set", value: "Not set" },
          { text: "No clients encoded", value: NONE },
        ],
        onFilter: filterByClientType,
        render: (_, h) => {
          const types = clientTypesOf(h);
          return types.length
            ? types.map((type) => (
                <Tag key={type} color={type === "LGU" ? "blue" : type === "Private" ? "green" : "red"}>
                  {type}
                </Tag>
              ))
            : "—";
        },
      },
      {
        title: "Client Address",
        key: "clientAddress",
        width: 200,
        filters: [
          { text: "Some client has no address", value: "incomplete" },
          { text: "All clients have an address", value: "complete" },
          { text: "No clients encoded", value: NONE },
        ],
        onFilter: filterByClientAddress,
        render: (_, h) => {
          const arr = clientsOf(h);
          if (arr.length === 0) return "—";
          const entries = arr.map((client) => ({
            name: text(client.clientName),
            address: clientAddressOf(client),
          }));
          const missing = entries.filter((entry) => !entry.address).length;
          return (
            <>
              {entries
                .filter((entry) => entry.address)
                .map((entry, index) => (
                  <div key={`${entry.address}-${index}`} style={{ fontSize: 12, lineHeight: "18px" }}>
                    {entry.address}
                  </div>
                ))}
              {/* Named rather than silently omitted: a client with no address is
                  the record EMB has to chase, and an empty cell looked identical
                  to a hauler with no clients at all. */}
              {missing > 0 && (
                <Tooltip
                  title={`${missing} client${missing === 1 ? "" : "s"} of this hauler ${missing === 1 ? "has" : "have"} no address. Click to complete them.`}
                >
                  <Button
                    type="link"
                    size="small"
                    danger
                    style={{ padding: 0, height: "auto", fontSize: 12 }}
                    onClick={() => openHaulerModal(h, "clients")}
                  >
                    {missing} without an address
                  </Button>
                </Tooltip>
              )}
            </>
          );
        },
      },
      {
        title: "Actions",
        key: "actions",
        width: 110,
        align: "center",
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
