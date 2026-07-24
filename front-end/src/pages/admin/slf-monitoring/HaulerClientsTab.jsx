// ── Haulers & Clients tab (SLF Facility Details modal) ──
// Read-only, optimized table of the SELECTED SLF's accredited haulers and the
// clients under each hauler (SLF → Haulers → Clients). Data comes from the
// facility's own baseline record (baselineData.accreditedHaulers), so it never
// mixes in haulers/clients from other SLFs.
//
// Features: search (hauler/client), client-type filter, sortable columns,
// pagination with a page-size changer, Excel export of the filtered rows, and
// row grouping — each hauler's cells are merged (rowSpan) across its client rows,
// with the office Address column included. Duplicate hauler-client pairs are
// collapsed.
import { useMemo, useState } from "react";
import { Button, Empty, Input, Select, Space, Table, Tag, Typography } from "antd";
import { DownloadOutlined, TeamOutlined } from "@ant-design/icons";
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
  const spanByRowKey = useMemo(() => {
    const counts = new Map();
    filtered.forEach((r) => counts.set(r._haulerKey, (counts.get(r._haulerKey) || 0) + 1));
    const seen = new Set();
    const map = new Map();
    filtered.forEach((r) => {
      if (seen.has(r._haulerKey)) map.set(r.key, 0);
      else { seen.add(r._haulerKey); map.set(r.key, counts.get(r._haulerKey)); }
    });
    return map;
  }, [filtered]);

  const haulerCell = (_, row) => ({ rowSpan: spanByRowKey.get(row.key) ?? 1 });

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

  const columns = [
    { title: "Hauler Name", dataIndex: "haulerName", onCell: haulerCell, width: 200, sorter: (a, b) => a.haulerName.localeCompare(b.haulerName), render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: "Hauler Address", dataIndex: "haulerAddress", onCell: haulerCell, width: 220, ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v || "—"}</Text> },
    { title: "Trucks", dataIndex: "haulerTrucks", onCell: haulerCell, width: 80, align: "center", render: (v) => (v != null ? <Tag color="blue">{v}</Tag> : "—") },
    { title: "Client Name", dataIndex: "clientName", width: 200, render: (v) => (v ? <Text style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary" italic style={{ fontSize: 12 }}>No client recorded</Text>) },
    { title: "Client Type", dataIndex: "clientType", width: 110, render: (v) => (v ? <Tag color={v === "LGU" ? "blue" : "purple"}>{v}</Tag> : "—") },
    { title: "Client Address", dataIndex: "clientAddr", width: 220, ellipsis: true, render: (v) => v || "—" },
    { title: "Contact", dataIndex: "clientContact", width: 150, ellipsis: true, render: (v) => v || "—" },
    { title: "Trips/Mo.", dataIndex: "trips", width: 90, align: "center", render: (v) => v ?? "—" },
    { title: "Status", dataIndex: "status", width: 100, render: (v) => <Tag color={/active/i.test(v) ? "green" : "default"}>{v || "—"}</Tag> },
    { title: "Date Added", dataIndex: "dateAdded", width: 120, render: (v) => (v ? dayjs(v).format("MM/DD/YYYY") : "—") },
  ];

  if (!loading && haulers.length === 0) {
    return <Empty description="No accredited haulers or clients recorded for this SLF." />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Space wrap>
          <Input.Search allowClear placeholder="Search hauler or client" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 150 }}
            options={[
              { label: "All Client Types", value: "all" },
              { label: "LGU", value: "LGU" },
              { label: "Private", value: "Private" },
            ]}
          />
        </Space>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <TeamOutlined /> {haulers.length} hauler(s)
          </Text>
          <Button size="small" icon={<DownloadOutlined />} onClick={exportRows} disabled={!filtered.length}>Export</Button>
        </Space>
      </div>
      <Table
        size="small"
        loading={loading}
        rowKey="key"
        dataSource={filtered}
        columns={columns}
        scroll={{ x: 1200 }}
        bordered
        pagination={{
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ["10", "20", "50", "100"],
          onShowSizeChange: (_, size) => setPageSize(size),
          showTotal: (total) => `${total} row(s)`,
          size: "small",
        }}
        locale={{ emptyText: <Empty description="No hauler-client records match your filters" /> }}
      />
    </div>
  );
}
