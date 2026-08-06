import { useCallback, useEffect, useMemo, useState } from "react";
import { Table, Tag, Card, Statistic, Space, Typography, Input, Alert, Skeleton, Empty, Tooltip, Select, Segmented, Collapse, Row, Col } from "antd";
import { TeamOutlined, InfoCircleOutlined, AppstoreOutlined, UnorderedListOutlined, EnvironmentOutlined, DatabaseOutlined, ApartmentOutlined } from "@ant-design/icons";
import SummaryTile from "./shared/SummaryTile";
import { loadRelationshipMap, peekRelationshipMap } from "../../utils/relationshipMapCache";

const { Text } = Typography;

/** "Angeles (12) · Mabalacat (8) +3 more" — a one-line hint for a stat tile. */
function summarizeCounts(counts, excludeKey, limit = 3) {
  const entries = [...counts.entries()]
    .filter(([key]) => key !== excludeKey)
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  const shown = entries.slice(0, limit).map(([key, count]) => `${key} (${count})`).join(" · ");
  return entries.length > limit ? `${shown} +${entries.length - limit} more` : shown;
}

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
  const [debouncedQ, setDebouncedQ] = useState("");
  const [fProvince, setFProvince] = useState(null);
  const [fMuni, setFMuni] = useState(null);
  const [fHauler, setFHauler] = useState(null);
  const [fSlf, setFSlf] = useState(null);
  const [viewMode, setViewMode] = useState("cards");

  const fetchData = useCallback(() => {
    // Shared loader: the Summary tab has usually already pulled this exact
    // payload, so switching tabs paints instantly instead of re-fetching.
    const cached = peekRelationshipMap(type);
    if (cached) {
      setRows(cached.rows);
      setSummary(cached.summary);
      setLoading(false);
      setError(false);
      return Promise.resolve();
    }
    setLoading(true);
    setError(false);
    return loadRelationshipMap(type)
      .then((data) => {
        setRows(data.rows);
        setSummary(data.summary);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [type]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtering runs over the full client list, so reacting to every keystroke
  // re-derived every group and froze the panel while typing. One pass per pause.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(timer);
  }, [q]);

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
    const needle = debouncedQ.trim().toLowerCase();
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
  }, [rows, debouncedQ, fProvince, fMuni, fHauler, fSlf]);

  // Per-SLF grouping for the card view. One card per assigned SLF; a client that
  // serves multiple SLFs appears under each. Everything is derived from the same
  // filtered rows, so the cards can never disagree with the table.
  const slfGroups = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const slfs = Array.isArray(r.slfs) && r.slfs.length ? r.slfs : ["Unassigned SLF"];
      slfs.forEach((slf) => {
        let g = map.get(slf);
        if (!g) { g = { slf, clients: [] }; map.set(slf, g); }
        g.clients.push(r);
      });
    });
    return [...map.values()]
      .map((g) => {
        const provinceCounts = new Map();
        const muniCounts = new Map();
        const servedMunis = new Set();
        g.clients.forEach((c) => {
          const prov = c.province || "Unspecified";
          provinceCounts.set(prov, (provinceCounts.get(prov) || 0) + 1);
          const muni = c.municipalityCity || c.name || "Unspecified";
          muniCounts.set(muni, (muniCounts.get(muni) || 0) + 1);
          if (c.serviceStatus === "Served" && (c.municipalityId || c.municipalityCity)) {
            servedMunis.add(c.municipalityId || c.municipalityCity);
          }
        });
        const provinces = [...provinceCounts.keys()].filter((p) => p !== "Unspecified");
        return {
          slf: g.slf,
          // Group the client table by Client Address (municipality) then name.
          clients: [...g.clients].sort(
            (a, b) =>
              String(a.municipalityCity || a.name).localeCompare(String(b.municipalityCity || b.name)) ||
              String(a.name).localeCompare(String(b.name)),
          ),
          totalClients: g.clients.length,
          totalLgusServed: servedMunis.size,
          provinceLabel:
            (provinces.slice(0, 2).join(", ") + (provinces.length > 2 ? ` +${provinces.length - 2}` : "")) || "—",
          provinceCount: provinces.length,
          muniCount: muniCounts.size,
          // Busiest few, as tile hints. The full per-municipality / per-province
          // detail is available in the client table below each group.
          topMunicipalities: summarizeCounts(muniCounts, "Unspecified"),
          topProvinces: summarizeCounts(provinceCounts, "Unspecified"),
        };
      })
      .sort((a, b) => b.totalClients - a.totalClients || a.slf.localeCompare(b.slf));
  }, [filtered]);

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

  const cardClientColumns = [
    { title: "Client Name", dataIndex: "name", ellipsis: true, render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: "Municipality", dataIndex: "municipalityCity", ellipsis: true, render: (v, r) => v || r.name || "—" },
    { title: "Province", dataIndex: "province", width: 130, ellipsis: true, render: (v) => v || "—" },
    { title: "Client Type", dataIndex: "clientType", width: 130, render: (v) => v || (isLgu ? "LGU" : "Private Sector") },
    { title: "Hauler", dataIndex: "haulers", width: 170, render: (v) => chipList(v, "No hauler", "blue") },
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

  // Skeleton keeps the layout stable while the (large) payload loads, instead of
  // collapsing to a spinner and then jumping.
  if (loading) {
    return (
      <div>
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          {[0, 1, 2, 3].map((index) => (
            <Card key={index} size="small" style={{ borderRadius: 8, flex: "1 1 0", minWidth: 150 }} styles={{ body: { padding: "10px 12px" } }}>
              <Skeleton active paragraph={{ rows: 1, width: "60%" }} title={{ width: "80%" }} />
            </Card>
          ))}
        </div>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }
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
        <Segmented
          value={viewMode}
          onChange={setViewMode}
          options={[
            { label: "By SLF", value: "cards", icon: <AppstoreOutlined /> },
            { label: "All Clients", value: "table", icon: <UnorderedListOutlined /> },
          ]}
        />
        <Input.Search allowClear placeholder="Search municipality, barangay, hauler or SLF" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        {isLgu && <Select allowClear showSearch placeholder="Province" value={fProvince} onChange={setFProvince} options={opts.provinces} style={{ minWidth: 150 }} optionFilterProp="label" />}
        <Select allowClear showSearch placeholder={isLgu ? "Municipality" : "Municipality / Address"} value={fMuni} onChange={setFMuni} options={opts.munis} style={{ minWidth: 160 }} optionFilterProp="label" />
        <Select allowClear showSearch placeholder="Hauler" value={fHauler} onChange={setFHauler} options={opts.haulers} style={{ minWidth: 150 }} optionFilterProp="label" />
        <Select allowClear showSearch placeholder="Assigned SLF" value={fSlf} onChange={setFSlf} options={opts.slfs} style={{ minWidth: 160 }} optionFilterProp="label" />
      </Space>

      {viewMode === "cards" ? (
        slfGroups.length === 0 ? (
          <Empty description={`No ${isLgu ? "LGU" : "private-sector"} clients recorded yet`} />
        ) : (
          <Collapse
            defaultActiveKey={slfGroups.slice(0, 1).map((g) => g.slf)}
            items={slfGroups.map((g) => ({
              key: g.slf,
              label: (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Space size={8} wrap>
                    <DatabaseOutlined style={{ color: "#722ed1" }} />
                    <Text strong style={{ fontSize: 13 }}>{g.slf}</Text>
                    {g.provinceLabel !== "—" && (
                      <Tag color="geekblue" bordered={false} style={{ whiteSpace: "normal" }}>
                        <EnvironmentOutlined /> {g.provinceLabel}
                      </Tag>
                    )}
                  </Space>
                  <Space size={6} wrap>
                    {isLgu && <Tag color="green">{g.totalLgusServed} LGUs Served</Tag>}
                    <Tag color="blue">{g.totalClients} Clients</Tag>
                    <Tag color="orange">{g.muniCount} Municipalities</Tag>
                    {!isLgu && <Tag color="purple">{g.provinceCount} Provinces</Tag>}
                  </Space>
                </div>
              ),
              children: (
                <>
                  {/* Coverage headline for this SLF. The question this section
                      answers is "how many LGUs and municipalities does this SLF
                      serve?", so those counts lead as tiles instead of being
                      buried in a run of "Per Municipality: …" tag text. */}
                  <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
                    <Col xs={12} sm={8} lg={6}>
                      <SummaryTile
                        accent="#fa8c16"
                        icon={<ApartmentOutlined />}
                        title="Municipalities"
                        titleTooltip="Distinct municipalities / cities this SLF's clients are located in."
                        value={g.muniCount}
                        hint={g.topMunicipalities}
                        height={96}
                      />
                    </Col>
                    <Col xs={12} sm={8} lg={6}>
                      <SummaryTile
                        accent="#52c41a"
                        icon={<TeamOutlined />}
                        title={isLgu ? "LGUs Served" : "Private Clients"}
                        titleTooltip={
                          isLgu
                            ? "Unique masterlist municipalities verified as served by this SLF."
                            : "Private-sector client records assigned to this SLF."
                        }
                        value={isLgu ? g.totalLgusServed : g.totalClients}
                        hint={isLgu ? `${g.totalClients} client record(s)` : `${g.muniCount} municipality/-ies`}
                        height={96}
                      />
                    </Col>
                    <Col xs={12} sm={8} lg={6}>
                      <SummaryTile
                        accent="#722ed1"
                        icon={<EnvironmentOutlined />}
                        title="Provinces"
                        titleTooltip="Distinct provinces this SLF's clients span."
                        value={g.provinceCount}
                        hint={g.topProvinces}
                        height={96}
                      />
                    </Col>
                    <Col xs={12} sm={8} lg={6}>
                      <SummaryTile
                        accent="#1677ff"
                        icon={<DatabaseOutlined />}
                        title="Total Clients"
                        value={g.totalClients}
                        hint="All client records assigned to this SLF"
                        height={96}
                      />
                    </Col>
                  </Row>
                  <Table
                    size="small"
                    rowKey={(r) => `${g.slf}-${r._id}`}
                    dataSource={g.clients}
                    columns={cardClientColumns}
                    scroll={{ x: 720 }}
                    pagination={g.clients.length > 5 ? { pageSize: 5, size: "small", showTotal: (t) => `${t} client(s)` } : false}
                  />
                </>
              ),
            }))}
          />
        )
      ) : (
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
      )}
      {isLgu && (
        <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 6 }}>
          <TeamOutlined /> Served = unique municipality (masterlist id). Barangays and duplicate client records never increase the count.
        </Text>
      )}
    </div>
  );
}
