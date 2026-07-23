import { useCallback, useEffect, useMemo, useState } from "react";
import { Table, Tag, Card, Statistic, Space, Typography, Input, Alert, Spin, Empty, Tooltip, Select, Button } from "antd";
import { TeamOutlined, InfoCircleOutlined, LinkOutlined } from "@ant-design/icons";
import api from "../../api";
import LguReconciliationPanel from "./LguReconciliationPanel";

const { Text } = Typography;

// LGUs Served / Private Sectors relationship map. Served LGUs are counted by
// UNIQUE municipality (stable masterlist id, resolved server-side) — never by
// client name, barangay, hauler, SLF, or duplicate record. One row per canonical
// client (= one municipality for LGUs); multiple haulers/SLFs/barangays render as
// chips, never as repeated municipality rows. Private-sector clients are counted
// separately from LGUs. Backend: /slf-clients/relationship-map.
export default function ClientRelationshipView({ type = "LGU" }) {
  const isLgu = type === "LGU";
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [fProvince, setFProvince] = useState(null);
  const [fMuni, setFMuni] = useState(null);
  const [fHauler, setFHauler] = useState(null);
  const [fSlf, setFSlf] = useState(null);
  const [reconOpen, setReconOpen] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(false);
    return api
      .get("/slf-clients/relationship-map", { params: { type } })
      .then(({ data }) => {
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setSummary(data?.summary || null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [type]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Distinct filter options derived from the loaded rows.
  const opts = useMemo(() => {
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((v) => ({ label: v, value: v }));
    return {
      provinces: uniq(rows.map((r) => r.province)),
      munis: uniq(rows.map((r) => r.municipalityCity)),
      haulers: uniq(rows.flatMap((r) => r.haulers || [])),
      slfs: uniq(rows.flatMap((r) => r.slfs || [])),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fProvince && r.province !== fProvince) return false;
      if (fMuni && r.municipalityCity !== fMuni) return false;
      if (fHauler && !(r.haulers || []).includes(fHauler)) return false;
      if (fSlf && !(r.slfs || []).includes(fSlf)) return false;
      if (!needle) return true;
      return (
        String(r.name).toLowerCase().includes(needle) ||
        String(r.province).toLowerCase().includes(needle) ||
        String(r.municipalityCity).toLowerCase().includes(needle) ||
        String(r.barangay || "").toLowerCase().includes(needle) ||
        (r.haulers || []).some((h) => h.toLowerCase().includes(needle)) ||
        (r.slfs || []).some((s) => s.toLowerCase().includes(needle))
      );
    });
  }, [rows, q, fProvince, fMuni, fHauler, fSlf]);

  const chipList = (items, emptyLabel, color = "default") =>
    !items || items.length === 0 ? (
      <Tag color="error" bordered={false} style={{ fontSize: 11 }}>{emptyLabel}</Tag>
    ) : (
      <Space size={[4, 4]} wrap>
        {items.map((it) => (
          <Tag key={it} bordered={false} color={color} style={{ fontSize: 11, whiteSpace: "normal" }}>{it}</Tag>
        ))}
      </Space>
    );

  const REMARK_COLORS = {
    "Active": "green", "Multiple haulers": "orange", "Multiple SLFs": "orange",
    "Incomplete assignment": "gold", "Missing masterlist link": "red", "Private-sector record": "purple",
  };
  const remarksCell = (r) => {
    const list = r.remarksList && r.remarksList.length ? r.remarksList : (r.remarks ? [r.remarks] : []);
    if (!list.length) return <Text type="secondary">—</Text>;
    return (
      <Space size={[4, 4]} wrap>
        {list.map((t) => <Tag key={t} color={REMARK_COLORS[t] || "default"} style={{ fontSize: 10, whiteSpace: "normal" }}>{t}</Tag>)}
      </Space>
    );
  };

  const lguColumns = [
    { title: "Province", dataIndex: "province", width: 130, ellipsis: true, sorter: (a, b) => String(a.province).localeCompare(String(b.province)), render: (v) => v || <Text type="secondary">—</Text> },
    { title: "Municipality (LGU)", dataIndex: "municipalityCity", width: 190, sorter: (a, b) => String(a.municipalityCity).localeCompare(String(b.municipalityCity)), render: (v, r) => <span><Text strong style={{ fontSize: 12 }}>{v || r.name || "—"}</Text>{!r.municipalityId && <Tooltip title="Not linked to a masterlist municipality"><Tag color="red" style={{ marginLeft: 6, fontSize: 9 }}>unlinked</Tag></Tooltip>}</span> },
    { title: "Barangay", dataIndex: "barangay", width: 130, ellipsis: true, render: (v) => v ? <Tag color="cyan" bordered={false} style={{ whiteSpace: "normal" }}>{v}</Tag> : <Text type="secondary">—</Text> },
    { title: "Hauler", dataIndex: "haulers", width: 160, render: (v) => chipList(v, "No hauler", "blue") },
    { title: "Assigned SLF", dataIndex: "slfs", width: 200, render: (v) => chipList(v, "No SLF", "geekblue") },
    { title: "Remarks", key: "remarks", width: 180, render: (_, r) => remarksCell(r) },
  ];

  const privateColumns = [
    { title: "Client", dataIndex: "name", fixed: "left", width: 180, ellipsis: true, sorter: (a, b) => a.name.localeCompare(b.name), render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: "Client Type", dataIndex: "clientType", width: 130, ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> },
    { title: "Address / Municipality", dataIndex: "municipalityCity", width: 200, ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> },
    { title: "Hauler", dataIndex: "haulers", width: 160, render: (v) => chipList(v, "No hauler", "blue") },
    { title: "Assigned SLF", dataIndex: "slfs", width: 200, render: (v) => chipList(v, "No SLF", "geekblue") },
    { title: "Remarks", key: "remarks", width: 180, render: (_, r) => remarksCell(r) },
  ];

  // Equal-width tile that fills the row on desktop and keeps a readable min-width
  // (so the row scrolls horizontally on small screens instead of compressing).
  const tile = (title, value, color, tip) => (
    <div style={{ flex: "1 1 0", minWidth: 150 }}>
      <Card size="small" style={{ borderRadius: 8, height: "100%" }} styles={{ body: { padding: "10px 12px" } }}>
        <Statistic
          title={<Space size={4}><span style={{ whiteSpace: "nowrap" }}>{title}</span>{tip && <Tooltip title={tip}><InfoCircleOutlined style={{ color: "#8c8c8c", fontSize: 12 }} /></Tooltip>}</Space>}
          value={value ?? 0}
          valueStyle={color ? { color } : undefined}
        />
      </Card>
    </div>
  );

  if (loading) return <div style={{ textAlign: "center", padding: "48px 0" }}><Spin /></div>;
  if (error) return <Alert type="error" showIcon message="Could not load client relationship data" description="Please try again shortly." />;

  const totalMaster = summary?.totalMasterMunicipalities ?? summary?.totalMasterLgus ?? 0;
  const served = summary?.servedMunicipalities ?? summary?.servedCount ?? 0;
  const unserved = summary?.unservedMunicipalities ?? summary?.unservedCount ?? 0;
  const coverage = summary?.coveragePercent ?? 0;
  const unlinked = summary?.unlinkedClients ?? 0;

  return (
    <div>
      {/* All LGU summary tiles in ONE equal-width row on desktop; horizontal scroll
          (not compression) on small screens so values stay readable. */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
        {isLgu ? (
          <>
            {tile("Total LGUs in Masterlist", totalMaster, undefined, "Unique active Region III masterlist entries classified as Municipality or City (Provinces excluded).")}
            {tile("Verified Served LGUs", served, "#52c41a", "Unique municipalities (by masterlist id) correctly linked and served by a hauler. Duplicates, multiple haulers/SLFs, and barangays each count once.")}
            {tile("Unlinked LGU Records", unlinked, "#fa8c16", "Client records with a municipality value but NO valid masterlist relationship. This is a RECORD count (not unique municipalities) — reconcile them via the button below.")}
            {tile("Unserved LGUs", unserved, "#ff4d4f", "Total active masterlist municipalities minus verified unique served LGUs. Unlinked records are NOT treated as served.")}
            {tile("Coverage %", `${coverage}%`, "#1677ff", "Verified unique served LGUs ÷ total active masterlist municipality LGUs × 100 (0 when the masterlist is empty).")}
          </>
        ) : (
          <>
            {tile("Private-Sector Clients", rows.length, "#722ed1", "Active canonical private-sector client records.")}
            {tile("Multiple Haulers", summary?.multiHauler ?? 0, "#fa8c16")}
            {tile("Multiple SLFs", summary?.multiSlf ?? 0, "#fa8c16")}
            {tile("Incomplete", summary?.incomplete ?? 0, "#faad14", "Clients missing a hauler or an SLF assignment.")}
          </>
        )}
      </div>

      {/* Filters */}
      <Space size={[8, 8]} wrap style={{ marginBottom: 10 }}>
        <Input.Search allowClear placeholder="Search municipality, barangay, hauler or SLF" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        {isLgu && <Select allowClear showSearch placeholder="Province" value={fProvince} onChange={setFProvince} options={opts.provinces} style={{ minWidth: 150 }} optionFilterProp="label" />}
        <Select allowClear showSearch placeholder={isLgu ? "Municipality" : "Municipality / Address"} value={fMuni} onChange={setFMuni} options={opts.munis} style={{ minWidth: 160 }} optionFilterProp="label" />
        <Select allowClear showSearch placeholder="Hauler" value={fHauler} onChange={setFHauler} options={opts.haulers} style={{ minWidth: 150 }} optionFilterProp="label" />
        <Select allowClear showSearch placeholder="Assigned SLF" value={fSlf} onChange={setFSlf} options={opts.slfs} style={{ minWidth: 160 }} optionFilterProp="label" />
        {isLgu && (summary?.unlinkedClients ?? 0) > 0 && (
          <Button icon={<LinkOutlined />} danger onClick={() => setReconOpen(true)}>
            Reconcile unlinked ({summary.unlinkedClients})
          </Button>
        )}
      </Space>

      <Table
        size="small"
        rowKey="_id"
        dataSource={filtered}
        columns={isLgu ? lguColumns : privateColumns}
        scroll={{ x: 1000, y: 380 }}
        pagination={{ pageSize: 10, size: "small", showSizeChanger: true, showTotal: (t) => `${t} ${isLgu ? "municipality client" : "private client"}${t === 1 ? "" : "s"}` }}
        locale={{ emptyText: <Empty description={`No ${isLgu ? "LGU" : "private-sector"} clients recorded yet`} /> }}
        // Expandable detail for rows whose grouped info is large.
        expandable={{
          rowExpandable: (r) => (r.haulers?.length || 0) > 2 || (r.slfs?.length || 0) > 2,
          expandedRowRender: (r) => (
            <Space direction="vertical" size={6} style={{ padding: "4px 8px" }}>
              <div><Text strong style={{ fontSize: 11 }}>All haulers: </Text>{chipList(r.haulers, "None", "blue")}</div>
              <div><Text strong style={{ fontSize: 11 }}>All assigned SLFs: </Text>{chipList(r.slfs, "None", "geekblue")}</div>
              {isLgu && r.psgc && <div><Text type="secondary" style={{ fontSize: 11 }}>PSGC: {r.psgc}</Text></div>}
            </Space>
          ),
        }}
      />
      {isLgu && (
        <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 6 }}>
          <TeamOutlined /> Served = unique municipality (masterlist id). Barangays and duplicate client records never increase the count.
        </Text>
      )}
      {isLgu && (
        <LguReconciliationPanel open={reconOpen} onClose={() => setReconOpen(false)} onChanged={fetchData} />
      )}
    </div>
  );
}
