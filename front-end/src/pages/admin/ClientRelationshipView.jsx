import { useEffect, useMemo, useState } from "react";
import { Table, Tag, Card, Row, Col, Statistic, Space, Typography, Input, Alert, Spin, Empty, Collapse, Tooltip } from "antd";
import { TeamOutlined, WarningOutlined, ApartmentOutlined } from "@ant-design/icons";
import api from "../../api";

const { Text } = Typography;

// Item #2: LGUs Served / Private Sectors relationship map. Reads the deduped
// (by client _id) canonical clients + their distinct hauler/SLF relationships from
// /slf-clients/relationship-map, and — for LGUs — compares against the Region III
// master list to surface unserved LGUs. One primary row per unique client; multiple
// haulers/SLFs are shown as chips, never as repeated identical rows.
export default function ClientRelationshipView({ type = "LGU" }) {
  const isLgu = type === "LGU";
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [unserved, setUnserved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .get("/slf-clients/relationship-map", { params: { type } })
      .then(({ data }) => {
        if (cancelled) return;
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setSummary(data?.summary || null);
        setUnserved(Array.isArray(data?.unserved) ? data.unserved : []);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [type]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        String(r.name).toLowerCase().includes(needle) ||
        String(r.province).toLowerCase().includes(needle) ||
        String(r.municipalityCity).toLowerCase().includes(needle) ||
        r.haulers.some((h) => h.toLowerCase().includes(needle)) ||
        r.slfs.some((s) => s.toLowerCase().includes(needle)),
    );
  }, [rows, q]);

  const chipList = (items, emptyLabel) =>
    items.length === 0 ? (
      <Tag color="error" bordered={false}>{emptyLabel}</Tag>
    ) : (
      <Space size={[4, 4]} wrap>
        {items.map((it) => (
          <Tag key={it} bordered={false} color="default" style={{ fontSize: 11 }}>{it}</Tag>
        ))}
      </Space>
    );

  const columns = [
    { title: "Client", dataIndex: "name", fixed: "left", width: 180, ellipsis: true, sorter: (a, b) => a.name.localeCompare(b.name), render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    isLgu
      ? { title: "Province", dataIndex: "province", width: 120, ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> }
      : { title: "Client Type", dataIndex: "clientType", width: 120, ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> },
    { title: isLgu ? "City / Municipality" : "Address / Municipality", dataIndex: "municipalityCity", width: 200, ellipsis: true, render: (v) => v || <Text type="secondary">—</Text> },
    { title: "Assigned Hauler(s)", dataIndex: "haulers", width: 150, render: (v) => chipList(v, "Missing hauler") },
    { title: "Assigned SLF(s)", dataIndex: "slfs", width: 200, render: (v) => chipList(v, "Missing SLF") },
    { title: "Haulers", dataIndex: "haulerCount", width: 84, align: "center", sorter: (a, b) => a.haulerCount - b.haulerCount, render: (v, r) => <Tag color={r.multiHauler ? "orange" : v ? "blue" : "error"}>{v}{r.multiHauler ? " ⚠" : ""}</Tag> },
    { title: "SLFs", dataIndex: "slfCount", width: 84, align: "center", sorter: (a, b) => a.slfCount - b.slfCount, render: (v, r) => <Tag color={r.multiSlf ? "orange" : v ? "geekblue" : "error"}>{v}{r.multiSlf ? " ⚠" : ""}</Tag> },
    { title: "Service Status", dataIndex: "serviceStatus", width: 120, filters: [{ text: "Served", value: "Served" }, { text: "Incomplete", value: "Incomplete" }], onFilter: (val, r) => r.serviceStatus === val, render: (v) => <Tag color={v === "Served" ? "success" : "warning"}>{v}</Tag> },
    { title: "Remarks", dataIndex: "remarks", width: 160, ellipsis: true, render: (v) => v ? <Text type="secondary" style={{ fontSize: 11 }}>{v}</Text> : <Text type="secondary">—</Text> },
  ];

  if (loading) return <div style={{ textAlign: "center", padding: "48px 0" }}><Spin /></div>;
  if (error) return <Alert type="error" showIcon message="Could not load client relationship data" description="Please try again shortly." />;

  return (
    <div>
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        {isLgu && (
          <>
            <Col xs={12} sm={8} md={4}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="LGUs (App Settings)" value={summary?.totalMasterLgus ?? "—"} prefix={<TeamOutlined />} /></Card></Col>
            <Col xs={12} sm={8} md={4}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="Served" value={summary?.servedCount ?? 0} valueStyle={{ color: "#52c41a" }} /></Card></Col>
            <Col xs={12} sm={8} md={4}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="Unserved" value={summary?.unservedCount ?? 0} valueStyle={{ color: "#ff4d4f" }} /></Card></Col>
          </>
        )}
        <Col xs={12} sm={8} md={4}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="Multi-Hauler" value={summary?.multiHauler ?? 0} valueStyle={{ color: "#fa8c16" }} /></Card></Col>
        <Col xs={12} sm={8} md={4}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="Multi-SLF" value={summary?.multiSlf ?? 0} valueStyle={{ color: "#fa8c16" }} /></Card></Col>
        <Col xs={12} sm={8} md={4}><Card size="small" style={{ borderRadius: 8 }}><Statistic title="Incomplete" value={summary?.incomplete ?? 0} valueStyle={{ color: "#faad14" }} /></Card></Col>
      </Row>

      <Input.Search allowClear placeholder="Search client, province, municipality, hauler or SLF" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 380, marginBottom: 10 }} />

      <Table
        size="small"
        rowKey="_id"
        dataSource={filtered}
        columns={columns}
        scroll={{ x: 1100, y: 380 }}
        pagination={{ pageSize: 10, size: "small", showSizeChanger: true, showTotal: (t) => `${t} unique client${t === 1 ? "" : "s"}` }}
        locale={{ emptyText: <Empty description={`No ${isLgu ? "LGU" : "private-sector"} clients recorded yet`} /> }}
      />

      {isLgu && unserved.length > 0 && (
        <Collapse
          style={{ marginTop: 12 }}
          items={[{
            key: "unserved",
            label: <Space><WarningOutlined style={{ color: "#ff4d4f" }} /> Unserved LGUs ({unserved.length}) — in the master list but with no active client</Space>,
            children: (
              <Space size={[6, 6]} wrap>
                {unserved.map((m) => (
                  <Tooltip key={m._id} title={[m.municipalityCity, m.province].filter(Boolean).join(", ")}>
                    <Tag icon={<ApartmentOutlined />} color="red" bordered={false}>{m.name}</Tag>
                  </Tooltip>
                ))}
              </Space>
            ),
          }]}
        />
      )}
    </div>
  );
}
