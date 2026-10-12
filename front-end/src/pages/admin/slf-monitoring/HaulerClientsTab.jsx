// ── Haulers & Clients tab (SLF Facility Details modal) ──
// Read-only, optimized table of the SELECTED SLF's accredited haulers and the
// clients under each hauler (SLF → Haulers → Clients). Data comes from the
// facility's own baseline record (baselineData.accreditedHaulers), so it never
// mixes in haulers/clients from other SLFs.
//
// Features: search (hauler/client), client-type filter, sortable columns,
// pagination with a page-size changer, Excel export of the filtered rows, and
// row grouping — each hauler's cell (name, office address, trucks and its trips
// per month) is merged (rowSpan) across its client rows; client name and type
// share one cell. The total declared trips per month is shown in the header and
// in a summary row. Duplicate hauler-client pairs are collapsed.
import { useMemo, useState } from "react";
import { Button, Empty, Input, Select, Space, Table, Tag, Typography } from "antd";
import { CarOutlined, DownloadOutlined, EnvironmentOutlined, TeamOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { exportToExcel } from "../../../utils/exportExcel";

const { Text } = Typography;

const haulerAddress = (h) => {
  const parts = [h.officeBarangay, h.officeCity, h.officeProvince].filter(Boolean);
  return parts.length ? parts.join(", ") : h.officeAddress || "";
};

const clientAddress = (c) => {
  const parts = [
    c.barangayName || c.barangay,
    c.municipalityName || c.municipality,
    c.provinceName || c.province,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : c.address || "";
};

const clientContact = (c) =>
  c.contactPerson || c.contactNumber || c.contact || c.contactInfo || "";

// Flatten a hauler's clients from every place they can live (dedup by name+address).
const clientsOf = (h) => {
  const raw = [
    ...(Array.isArray(h.privateSectorClients) ? h.privateSectorClients : []),
    ...(Array.isArray(h.clients) ? h.clients : []),
    ...((Array.isArray(h.vehicles) ? h.vehicles : []).flatMap((v) =>
      Array.isArray(v.selectedClients) ? v.selectedClients : [],
    )),
  ].filter((c) => c && (typeof c === "object" ? c.clientName : c));
  const seen = new Set();
  const out = [];
  for (const c of raw) {
    const obj = typeof c === "string" ? { clientName: c } : c;
    const key = `${String(obj.clientName || "").trim().toLowerCase()}|${clientAddress(obj).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(obj);
  }
  return out;
};

export default function HaulerClientsTab({ baselineData, loading, savedAt }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pageSize, setPageSize] = useState(10);

  const haulers = useMemo(
    () => (Array.isArray(baselineData?.accreditedHaulers) ? baselineData.accreditedHaulers : []),
    [baselineData],
  );

  // One row per hauler-client pair; a hauler with no clients still shows one row.
  const rows = useMemo(() => {
    const list = [];
    haulers.forEach((h, hi) => {
      const hKey = `${h.haulerName || "hauler"}-${hi}`;
      const base = {
        _haulerKey: hKey,
        haulerName: h.haulerName || "—",
        haulerAddress: haulerAddress(h) || "—",
        haulerTrucks: h.numberOfTrucks ?? null,
      };
      const clients = clientsOf(h);
      if (!clients.length) {
        list.push({ ...base, key: `${hKey}-noclient`, clientName: "", clientType: "", clientAddr: "", clientContact: "", trips: null, status: "Active", dateAdded: savedAt });
        return;
      }
      clients.forEach((c, ci) => {
        list.push({
          ...base,
          key: `${hKey}-c${ci}`,
          clientName: c.clientName || "—",
          clientType: c.clientType || "",
          clientAddr: clientAddress(c) || "—",
          clientContact: clientContact(c) || "—",
          trips: c.noOfTripsPerMonth ?? null,
          status: c.status || "Active",
          dateAdded: savedAt,
        });
      });
    });
    return list;
  }, [haulers, savedAt]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.clientType !== typeFilter) return false;
      if (!q) return true;
      return (
        r.haulerName.toLowerCase().includes(q) ||
        String(r.clientName || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, typeFilter]);

  // Group by hauler: the first row of each hauler spans its client rows (rowSpan);
  // subsequent rows return 0 so the hauler cells visually merge into one block.
  //
  // Spans are counted per PAGE: a hauler whose clients cross a page boundary
  // would otherwise be given a rowSpan taller than the rows actually rendered.
  const [page, setPage] = useState(1);
  const spanByRowKey = useMemo(() => {
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
    const counts = new Map();
    pageRows.forEach((r) => counts.set(r._haulerKey, (counts.get(r._haulerKey) || 0) + 1));
    const seen = new Set();
    const map = new Map();
    pageRows.forEach((r) => {
      if (seen.has(r._haulerKey)) map.set(r.key, 0);
      else { seen.add(r._haulerKey); map.set(r.key, counts.get(r._haulerKey)); }
    });
    return map;
  }, [filtered, page, pageSize]);

  // antd calls onCell(record, rowIndex). This read the SECOND argument as the
  // row, so it was always handed the index, `row.key` was undefined, every span
  // fell back to 1 — and the hauler cells were never actually merged.
  const haulerCell = (record) => ({ rowSpan: spanByRowKey.get(record.key) ?? 1 });

  // Declared trips per month — the only trip figure a baseline carries — summed
  // per hauler and over the filtered rows, so the header, each hauler block and
  // the table's summary row always agree with what is on screen.
  const tripNum = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);
  const tripsByHauler = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => map.set(r._haulerKey, (map.get(r._haulerKey) || 0) + tripNum(r.trips)));
    return map;
  }, [filtered]);
  const totalTrips = useMemo(() => filtered.reduce((sum, r) => sum + tripNum(r.trips), 0), [filtered]);
  const clientCount = useMemo(() => filtered.filter((r) => r.clientName).length, [filtered]);

  const exportRows = () => {
    if (!filtered.length) return;
    const data = filtered.map((r) => ({
      "Hauler Name": r.haulerName,
      "Hauler Office Address": r.haulerAddress,
      "No. of Trucks": r.haulerTrucks ?? "",
      "Client Name": r.clientName || "No client recorded",
      "Client Type": r.clientType || "",
      "Client Address": r.clientAddr || "",
      "Client Contact": r.clientContact || "",
      "Trips / Month": r.trips ?? "",
      Status: r.status || "",
      "Date Added": r.dateAdded ? dayjs(r.dateAdded).format("YYYY-MM-DD") : "",
    }));
    exportToExcel(data, `SLF_Haulers_Clients_${dayjs().format("YYYY-MM-DD")}`);
  };

  // Hauler name + address (+ trucks, + its trips) share ONE merged cell, and
  // client name + type share another — ten columns at a forced 1,200px scroll
  // became seven that fit the Facility Details modal.
  const columns = [
    {
      title: "Hauler",
      dataIndex: "haulerName",
      onCell: haulerCell,
      width: 250,
      sorter: (a, b) => a.haulerName.localeCompare(b.haulerName),
      render: (v, r) => (
        <div style={{ lineHeight: 1.35 }}>
          <Text strong style={{ fontSize: 12 }}>{v}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              <EnvironmentOutlined style={{ marginRight: 4 }} />
              {r.haulerAddress && r.haulerAddress !== "—" ? r.haulerAddress : "No office address"}
            </Text>
          </div>
          <Space size={4} style={{ marginTop: 4 }} wrap>
            {r.haulerTrucks != null && (
              <Tag bordered={false} color="blue" style={{ margin: 0, fontSize: 10.5 }}>
                <CarOutlined /> {r.haulerTrucks} truck{Number(r.haulerTrucks) === 1 ? "" : "s"}
              </Tag>
            )}
            <Tag bordered={false} color="cyan" style={{ margin: 0, fontSize: 10.5 }}>
              {(tripsByHauler.get(r._haulerKey) || 0).toLocaleString()} trips/mo
            </Tag>
          </Space>
        </div>
      ),
    },
    {
      title: "Client",
      dataIndex: "clientName",
      width: 240,
      sorter: (a, b) => String(a.clientName || "").localeCompare(String(b.clientName || "")),
      render: (v, r) =>
        v ? (
          <div style={{ lineHeight: 1.35 }}>
            <Text style={{ fontSize: 12 }}>{v}</Text>
            {r.clientType && (
              <div>
                <Tag bordered={false} color={r.clientType === "LGU" ? "blue" : "purple"} style={{ margin: "3px 0 0", fontSize: 10.5 }}>
                  {r.clientType}
                </Tag>
              </div>
            )}
          </div>
        ) : (
          <Text type="secondary" italic style={{ fontSize: 12 }}>No client recorded</Text>
        ),
    },
    { title: "Client Address", dataIndex: "clientAddr", ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v || "—"}</Text> },
    { title: "Contact", dataIndex: "clientContact", width: 140, ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v || "—"}</Text> },
    { title: "Trips/Mo.", dataIndex: "trips", width: 104, align: "center", sorter: (a, b) => tripNum(a.trips) - tripNum(b.trips), render: (v) => v ?? "—" },
    { title: "Status", dataIndex: "status", width: 86, render: (v) => <Tag bordered={false} color={/active/i.test(v) ? "green" : "default"} style={{ margin: 0 }}>{v || "—"}</Tag> },
    { title: "Date Added", dataIndex: "dateAdded", width: 104, render: (v) => <Text style={{ fontSize: 12 }}>{v ? dayjs(v).format("MM/DD/YYYY") : "—"}</Text> },
  ];

  if (!loading && haulers.length === 0) {
    return <Empty description="No accredited haulers or clients recorded for this SLF." />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Space wrap>
          <Input.Search allowClear placeholder="Search hauler or client" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ width: 240 }} />
          <Select
            value={typeFilter}
            onChange={(value) => { setTypeFilter(value); setPage(1); }}
            style={{ width: 150 }}
            options={[
              { label: "All Client Types", value: "all" },
              { label: "LGU", value: "LGU" },
              { label: "Private", value: "Private" },
            ]}
          />
        </Space>
        <Space size={6} wrap>
          <Tag bordered={false} style={{ margin: 0 }}>
            <TeamOutlined /> {haulers.length} hauler{haulers.length === 1 ? "" : "s"}
          </Tag>
          <Tag bordered={false} style={{ margin: 0 }}>
            {clientCount.toLocaleString()} client{clientCount === 1 ? "" : "s"}
          </Tag>
          <Tag bordered={false} color="cyan" style={{ margin: 0, fontWeight: 600 }}>
            Total trips: {totalTrips.toLocaleString()} / month
          </Tag>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportRows} disabled={!filtered.length}>Export</Button>
        </Space>
      </div>
      <Table
        size="small"
        loading={loading}
        rowKey="key"
        dataSource={filtered}
        columns={columns}
        tableLayout="fixed"
        // Fits the 1,400px Facility Details modal as is; scrolls only on a
        // screen narrower than the columns' own minimum.
        scroll={{ x: 960 }}
        bordered
        summary={() =>
          filtered.length ? (
            <Table.Summary.Row style={{ background: "#fafafa" }}>
              <Table.Summary.Cell index={0} colSpan={4}>
                <Text strong style={{ fontSize: 12 }}>Total trips per month</Text>
                <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                  ({clientCount.toLocaleString()} client{clientCount === 1 ? "" : "s"} shown)
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="center">
                <Text strong>{totalTrips.toLocaleString()}</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} colSpan={2} />
            </Table.Summary.Row>
          ) : null
        }
        pagination={{
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          onChange: (nextPage, size) => {
            setPage(size !== pageSize ? 1 : nextPage);
            setPageSize(size);
          },
          showTotal: (total) => `${total} row(s)`,
          size: "small",
        }}
        locale={{ emptyText: <Empty description="No hauler-client records match your filters" /> }}
      />
    </div>
  );
}
