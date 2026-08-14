import { useEffect, useMemo, useRef, useState } from "react";
import { Row, Col, Card, Statistic, Typography, Skeleton, Alert, Empty, Table, Tag, Space } from "antd";
import { TeamOutlined, BankOutlined, EnvironmentOutlined, ApartmentOutlined, DatabaseOutlined } from "@ant-design/icons";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell as RCell,
} from "recharts";
import {
  loadRelationshipMap,
  peekRelationshipMap,
  invalidateRelationshipMap,
} from "../../utils/relationshipMapCache";
import { getSocket } from "../../utils/socket";
import { compareProvinceNames, sortByProvince } from "../../utils/provinceSort";

const { Text } = Typography;

// Overview tab for "LGUs & Private Sectors Served". Reuses the SAME
// /slf-clients/relationship-map endpoint the LGU/Private tabs use (fetched once,
// concurrently), so totals here can never disagree with those tabs. No new
// backend and no duplicated aggregation — everything below is derived from the
// two payloads.
const PROVINCE_BAR = "#fa8c16";
const SLF_BAR = "#722ed1";

export default function ClientServedSummary() {
  const [lgu, setLgu] = useState(null);
  const [priv, setPriv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped when the server reports the canonical client list changed, forcing the
  // load effect to re-run against a freshly invalidated cache.
  const [reloadToken, setReloadToken] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    // Served through the shared loader so the LGU / Private tabs reuse these
    // exact payloads instead of re-fetching them (see relationshipMapCache).
    const cachedLgu = peekRelationshipMap("LGU");
    const cachedPriv = peekRelationshipMap("Private Sector");
    if (cachedLgu && cachedPriv) {
      setLgu(cachedLgu);
      setPriv(cachedPriv);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(false);

    Promise.all([loadRelationshipMap("LGU"), loadRelationshipMap("Private Sector")])
      .then(([lguData, privData]) => {
        if (!aliveRef.current) return;
        setLgu(lguData);
        setPriv(privData);
      })
      .catch((err) => {
        if (err?.code === "ERR_CANCELED" || err?.name === "CanceledError") return;
        if (aliveRef.current) setError(true);
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [reloadToken]);

  // An admin correcting a Hauler Client's address changes which masterlist
  // municipality that client resolves to — i.e. it moves the LGUs Served and
  // Private Sectors Served figures. The server re-syncs the canonical client
  // collection after such an edit and emits a "clients" refresh; without this
  // listener the cached relationship map kept serving the pre-edit coverage.
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return undefined;
    const onRefresh = (payload) => {
      if (payload?.target !== "clients") return;
      invalidateRelationshipMap();
      setReloadToken((n) => n + 1);
    };
    sock.on("data-refresh", onRefresh);
    return () => sock.off("data-refresh", onRefresh);
  }, []);

  const stats = useMemo(() => {
    const lguRows = Array.isArray(lgu?.rows) ? lgu.rows : [];
    const privRows = Array.isArray(priv?.rows) ? priv.rows : [];

    const overallLgusServed = lgu?.summary?.servedMunicipalities ?? 0;
    const overallPrivateClients = priv?.summary?.clients ?? privRows.length;
    const totalMunicipalities = lgu?.summary?.totalMasterMunicipalities ?? 0;
    const coveragePercent = lgu?.summary?.coveragePercent ?? 0;

    // Per-province rollup: unique served municipalities (LGU) + private clients + SLFs.
    const provinceMap = new Map();
    const ensureProv = (province) => {
      const key = province || "Unspecified";
      if (!provinceMap.has(key)) {
        provinceMap.set(key, { province: key, lguServed: new Set(), privateClients: 0, slfs: new Set() });
      }
      return provinceMap.get(key);
    };
    lguRows.forEach((r) => {
      const p = ensureProv(r.province);
      if (r.serviceStatus === "Served" && (r.municipalityId || r.municipalityCity)) {
        p.lguServed.add(r.municipalityId || r.municipalityCity);
      }
      (r.slfs || []).forEach((s) => s && p.slfs.add(s));
    });
    privRows.forEach((r) => {
      const p = ensureProv(r.province);
      p.privateClients += 1;
      (r.slfs || []).forEach((s) => s && p.slfs.add(s));
    });

    const provinceStats = [...provinceMap.values()].map((p) => ({
      province: p.province,
      lguServed: p.lguServed.size,
      privateClients: p.privateClients,
      slfs: p.slfs.size,
    }));
    // The province LIST reads alphabetically so a province can be found by name;
    // it used to be ranked by LGUs-served, which reordered itself as the figures
    // moved. The "Top Provinces" CHART below keeps its value ranking — that one is
    // a leaderboard, where the order is the information.
    const provinceRows = sortByProvince(provinceStats);
    const provincesByVolume = [...provinceStats].sort(
      (a, b) => b.lguServed - a.lguServed || compareProvinceNames(a.province, b.province),
    );

    // Clients referencing each SLF (LGU + private), for the "SLF totals" chart.
    const slfMap = new Map();
    [...lguRows, ...privRows].forEach((r) => {
      (r.slfs || []).forEach((s) => {
        if (!s) return;
        slfMap.set(s, (slfMap.get(s) || 0) + 1);
      });
    });
    const slfRows = [...slfMap.entries()]
      .map(([slf, clients]) => ({ slf, clients }))
      .sort((a, b) => b.clients - a.clients);

    return {
      overallLgusServed,
      overallPrivateClients,
      totalProvinces: provinceRows.filter((p) => p.province !== "Unspecified").length,
      totalMunicipalities,
      coveragePercent,
      totalSlfs: slfMap.size,
      provinceRows,
      topProvinceChart: provincesByVolume.slice(0, 10).map((p) => ({ name: p.province, value: p.lguServed })),
      topSlfChart: slfRows.slice(0, 8).map((s) => ({ name: s.slf.length > 22 ? `${s.slf.slice(0, 21)}…` : s.slf, value: s.clients })),
    };
  }, [lgu, priv]);

  // Skeletons rather than a bare spinner: the layout is stable while loading, so
  // the panel does not jump when the (large) payload lands.
  if (loading) {
    return (
      <div>
        <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
          {[0, 1, 2, 3, 4].map((index) => (
            <Col xs={12} md={8} xl={4} key={index} style={{ flex: "1 1 0", minWidth: 150 }}>
              <Card size="small" style={{ borderRadius: 8 }} styles={{ body: { padding: "10px 12px" } }}>
                <Skeleton active paragraph={{ rows: 1, width: "60%" }} title={{ width: "80%" }} />
              </Card>
            </Col>
          ))}
        </Row>
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={12}><Card size="small" style={{ borderRadius: 10 }} styles={{ body: { height: 300 } }}><Skeleton active paragraph={{ rows: 6 }} /></Card></Col>
          <Col xs={24} lg={12}><Card size="small" style={{ borderRadius: 10 }} styles={{ body: { height: 300 } }}><Skeleton active paragraph={{ rows: 6 }} /></Card></Col>
        </Row>
      </div>
    );
  }
  if (error) return <Alert type="error" showIcon message="Could not load served-client summary" description="Please try again shortly." />;

  const tile = (title, value, color, icon, suffix) => (
    <Col xs={12} md={8} xl={Math.floor(24 / 5) || 4} style={{ flex: "1 1 0", minWidth: 150 }}>
      <Card size="small" style={{ borderRadius: 8, height: "100%" }} styles={{ body: { padding: "10px 12px" } }}>
        <Statistic title={<Space size={4}>{icon}<span style={{ whiteSpace: "nowrap" }}>{title}</span></Space>} value={value ?? 0} suffix={suffix} valueStyle={color ? { color } : undefined} />
      </Card>
    </Col>
  );

  return (
    <div>
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        {tile("Overall LGUs Served", stats.overallLgusServed, "#52c41a", <TeamOutlined style={{ color: "#52c41a" }} />)}
        {tile("Overall Private Clients", stats.overallPrivateClients, "#722ed1", <BankOutlined style={{ color: "#722ed1" }} />)}
        {tile("Provinces", stats.totalProvinces, "#1677ff", <EnvironmentOutlined style={{ color: "#1677ff" }} />)}
        {tile("Municipalities", stats.totalMunicipalities, "#fa8c16", <ApartmentOutlined style={{ color: "#fa8c16" }} />)}
        {tile("SLFs", stats.totalSlfs, "#13c2c2", <DatabaseOutlined style={{ color: "#13c2c2" }} />)}
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title={<Space><EnvironmentOutlined style={{ color: PROVINCE_BAR }} /><Text strong>LGUs Served per Province</Text></Space>} style={{ borderRadius: 10, height: "100%" }} styles={{ body: { height: 300 } }}>
            {stats.topProvinceChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topProvinceChart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={64} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(v) => [`${v} LGU(s) served`, "Served"]} />
                  <Bar dataKey="value" name="LGUs Served" fill={PROVINCE_BAR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No province data" />}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title={<Space><DatabaseOutlined style={{ color: SLF_BAR }} /><Text strong>Top SLFs by Clients Served</Text></Space>} style={{ borderRadius: 10, height: "100%" }} styles={{ body: { height: 300 } }}>
            {stats.topSlfChart.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topSlfChart} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                  <RTooltip formatter={(v) => [`${v} client(s)`, "Clients"]} />
                  <Bar dataKey="value" name="Clients" fill={SLF_BAR} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {stats.topSlfChart.map((entry) => <RCell key={entry.name} fill={SLF_BAR} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No SLF data" />}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={<Space><ApartmentOutlined style={{ color: "#1677ff" }} /><Text strong>Province Totals</Text></Space>} style={{ borderRadius: 10 }} styles={{ body: { padding: 0 } }}>
        <Table
          size="small"
          rowKey="province"
          dataSource={stats.provinceRows}
          pagination={false}
          scroll={{ y: 260 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" /> }}
          columns={[
            { title: "Province", dataIndex: "province", render: (v) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
            { title: "LGUs Served", dataIndex: "lguServed", width: 130, align: "center", sorter: (a, b) => a.lguServed - b.lguServed, render: (v) => <Tag color="green" style={{ fontWeight: 700 }}>{v}</Tag> },
            { title: "Private Clients", dataIndex: "privateClients", width: 140, align: "center", sorter: (a, b) => a.privateClients - b.privateClients, render: (v) => <Tag color="purple" style={{ fontWeight: 700 }}>{v}</Tag> },
            { title: "SLFs", dataIndex: "slfs", width: 90, align: "center", sorter: (a, b) => a.slfs - b.slfs, render: (v) => <Tag color="cyan">{v}</Tag> },
          ]}
          summary={(pageData) => {
            const t = pageData.reduce((acc, r) => ({ lgu: acc.lgu + r.lguServed, priv: acc.priv + r.privateClients }), { lgu: 0, priv: 0 });
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><Text strong>Total</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center"><Text strong style={{ color: "#52c41a" }}>{t.lgu}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center"><Text strong style={{ color: "#722ed1" }}>{t.priv}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="center"><Text strong style={{ color: "#13c2c2" }}>{stats.totalSlfs}</Text></Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </Card>
    </div>
  );
}
