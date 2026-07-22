import { useEffect, useMemo, useState, useCallback } from "react";
import { Table, Tag, Input, Space, Typography, Statistic, Row, Col, Card, Spin, Empty, Segmented, Select, Alert } from "antd";
import { SearchOutlined, TeamOutlined, BankOutlined, UserOutlined, SolutionOutlined } from "@ant-design/icons";
import api from "../../api";
import { getSocket } from "../../utils/socket";

const { Text } = Typography;

// Tag per canonical SlfClient type.
const typeTag = (type) => {
  if (type === "LGU") return <Tag color="blue">LGU</Tag>;
  if (type === "Private Sector") return <Tag color="purple">Private Sector</Tag>;
  return <Tag>Unclassified</Tag>;
};

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Deduped unique-client counts by normalized name — the SAME rule the
// /slf-clients/summary endpoint and the dashboard tiles use, so the modal totals
// always match the tiles.
function countUnique(clients) {
  const seen = new Set();
  const counts = { total: 0, lgu: 0, private: 0, unclassified: 0 };
  clients.forEach((c) => {
    const key = `${norm(c.name)}|${c.type}`;
    if (seen.has(key)) return;
    seen.add(key);
    counts.total += 1;
    if (c.type === "LGU") counts.lgu += 1;
    else if (c.type === "Private Sector") counts.private += 1;
    else counts.unclassified += 1;
  });
  return counts;
}

// Group active clients by their Portal User or Hauler. A client with no owner
// falls under "—". Deduped within a group by client identity.
function groupClients(clients, groupBy) {
  const groups = new Map();
  clients.forEach((c) => {
    const owner = (groupBy === "hauler" ? c.hauler : c.portalUserName) || "—";
    let g = groups.get(owner);
    if (!g) { g = { key: owner, owner, seen: new Set(), clients: [] }; groups.set(owner, g); }
    const id = `${norm(c.name)}|${c.type}`;
    if (!g.seen.has(id)) { g.seen.add(id); g.clients.push(c); }
  });
  return [...groups.values()]
    .map((g) => ({ key: g.key, owner: g.owner, clients: g.clients, ...countUnique(g.clients) }))
    .sort((a, b) => b.total - a.total || String(a.owner).localeCompare(String(b.owner)));
}

// Hauler Clients view — reads the persisted SlfClient collection (the SAME
// MongoDB source the dashboard tiles count), so the tile totals and this modal
// never disagree. Baseline-declared clients are synchronized into SlfClient via
// the Clients page "Sync from Baseline" action.
export default function HaulerClientsPanel() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("user"); // "user" | "hauler"
  const [typeFilter, setTypeFilter] = useState("all"); // all | LGU | Private Sector

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/slf-clients");
      // Active, non-dummy only — matches the dashboard tile counting rule.
      const rows = (Array.isArray(data) ? data : []).filter((c) => c.status === "Active" && !c.isDummy);
      setClients(rows);
      setError(false);
    } catch {
      setError(true);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  // Keep in sync with client CRUD / baseline sync elsewhere in the app.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onRefresh = ({ target } = {}) => { if (target === "slf-clients") fetchClients(); };
    socket.on("data-refresh", onRefresh);
    return () => socket.off("data-refresh", onRefresh);
  }, [fetchClients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (!q) return true;
      return (
        String(c.name || "").toLowerCase().includes(q) ||
        String(c.portalUserName || "").toLowerCase().includes(q) ||
        String(c.hauler || "").toLowerCase().includes(q)
      );
    });
  }, [clients, typeFilter, search]);

  const totals = useMemo(() => countUnique(clients), [clients]);
  const groups = useMemo(() => groupClients(filteredClients, groupBy), [filteredClients, groupBy]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <Spin />
        <div style={{ marginTop: 12 }}><Text type="secondary">Loading clients…</Text></div>
      </div>
    );
  }

  return (
    <>
      {error && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Could not load clients" description="Please retry from the Clients page." />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }} wrap>
        <Col flex="1 1 120px">
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Unique Clients" value={totals.total} valueStyle={{ color: "#722ed1" }} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col flex="1 1 120px">
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="LGU Clients" value={totals.lgu} valueStyle={{ color: "#1677ff" }} prefix={<BankOutlined />} />
          </Card>
        </Col>
        <Col flex="1 1 120px">
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic title="Private Sector" value={totals.private} valueStyle={{ color: "#722ed1" }} prefix={<BankOutlined />} />
          </Card>
        </Col>
        {totals.unclassified > 0 && (
          <Col flex="1 1 120px">
            <Card size="small" style={{ borderRadius: 8 }}>
              <Statistic title="Unclassified" value={totals.unclassified} valueStyle={{ color: "#8c8c8c" }} />
            </Card>
          </Col>
        )}
      </Row>

      <Space wrap size={8} style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Space wrap size={8}>
          <Segmented
            size="small"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { label: "By Portal User", value: "user" },
              { label: "By Hauler", value: "hauler" },
            ]}
          />
          <Select
            size="small"
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ minWidth: 150 }}
            options={[
              { label: "All types", value: "all" },
              { label: "LGU", value: "LGU" },
              { label: "Private Sector", value: "Private Sector" },
            ]}
          />
        </Space>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Search client, portal user or hauler"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </Space>

      {groups.length === 0 ? (
        <Empty description="No clients yet. Use the Clients page to add clients or Sync from Baseline." />
      ) : (
        <Table
          size="small"
          dataSource={groups}
          rowKey="key"
          scroll={{ x: "max-content", y: 380 }}
          sticky
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} ${groupBy === "hauler" ? "haulers" : "portal users"}` }}
          expandable={{
            expandedRowRender: (group) => (
              <Table
                size="small"
                dataSource={group.clients}
                rowKey="_id"
                pagination={group.clients.length > 8 ? { pageSize: 8, size: "small" } : false}
                columns={[
                  { title: "Client", dataIndex: "name", ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>, sorter: (a, b) => a.name.localeCompare(b.name) },
                  { title: "Type", dataIndex: "type", width: 140, render: (v) => typeTag(v) },
                  {
                    title: groupBy === "hauler" ? "Portal User" : "Hauler",
                    dataIndex: groupBy === "hauler" ? "portalUserName" : "hauler",
                    ellipsis: true,
                    render: (v) => <Text type="secondary" style={{ fontSize: 11 }}>{v || "—"}</Text>,
                  },
                  { title: "Source", dataIndex: "source", width: 120, render: (v) => <Tag bordered={false} color={v === "baseline" ? "geekblue" : "green"}>{v === "baseline" ? "Baseline" : "Admin"}</Tag> },
                ]}
              />
            ),
          }}
          columns={[
            {
              title: groupBy === "hauler" ? "Hauler" : "Portal User",
              dataIndex: "owner",
              ellipsis: true,
              render: (v) => (
                <Space size={6}>
                  {groupBy === "hauler" ? <SolutionOutlined /> : <UserOutlined />}
                  <Text strong style={{ fontSize: 12 }}>{v}</Text>
                </Space>
              ),
              sorter: (a, b) => String(a.owner).localeCompare(String(b.owner)),
            },
            { title: "Total", dataIndex: "total", width: 90, align: "center", defaultSortOrder: "descend", sorter: (a, b) => a.total - b.total, render: (v) => <Tag color="geekblue" style={{ fontWeight: 700 }}>{v}</Tag> },
            { title: "LGU", dataIndex: "lgu", width: 80, align: "center", sorter: (a, b) => a.lgu - b.lgu, render: (v) => (v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">0</Text>) },
            { title: "Private", dataIndex: "private", width: 90, align: "center", sorter: (a, b) => a.private - b.private, render: (v) => (v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">0</Text>) },
          ]}
        />
      )}
    </>
  );
}
