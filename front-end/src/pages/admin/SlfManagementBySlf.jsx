import { useMemo } from "react";
import { Row, Col, Card, Space, Tag, Typography, Table, Empty, Collapse, Statistic } from "antd";
import { PieChart, Pie, Cell as RCell, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts";
import { EnvironmentOutlined, PictureOutlined, AlertOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

const { Text } = Typography;

// Per-SLF Leachate / Gas management view: one collapsible card per facility with a
// gallery thumbnail, a status pie chart, a status summary, total/active tiles, and
// the facility's own grouped records table. One component serves BOTH modules
// (kind), so leachate and gas stay visually and behaviourally identical.
const STATUS_COLOR = {
  Active: "#52c41a", Operational: "#52c41a",
  "Under Maintenance": "#faad14",
  Inactive: "#8c8c8c", "Non-Operational": "#8c8c8c",
  Decommissioned: "#ff4d4f",
};
const statusColor = (s) => STATUS_COLOR[s] || "#1677ff";

const KIND = {
  leachate: {
    detailsField: "leachatePondDetails",
    countField: "noOfLeachatePond",
    noun: "Pond", nounPlural: "Ponds",
    accent: "#1890ff", totalTagColor: "blue",
    galleryMatch: /leachate/i,
    icon: <AlertOutlined style={{ color: "#1890ff" }} />,
    columns: [
      { title: "Pond No.", dataIndex: "num", width: 90, align: "center" },
      { title: "Description", dataIndex: "description", ellipsis: true, render: (v) => v || "—" },
      { title: "Status", dataIndex: "status", width: 160, render: (v) => (v && v !== "—" ? <Tag color={/active/i.test(v) ? "blue" : /mainten/i.test(v) ? "orange" : "default"}>{v}</Tag> : "—") },
      { title: "Attachments", dataIndex: "attachments", width: 110, align: "center", render: (v) => ((v || []).length ? <Tag color="geekblue">{v.length} file(s)</Tag> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>) },
    ],
  },
  gas: {
    detailsField: "gasVentDetails",
    countField: "numberOfGasVents",
    noun: "Vent", nounPlural: "Vents",
    accent: "#52c41a", totalTagColor: "green",
    galleryMatch: /gas/i,
    icon: <SafetyCertificateOutlined style={{ color: "#52c41a" }} />,
    columns: [
      { title: "Vent No.", dataIndex: "num", width: 90, align: "center" },
      { title: "Type", dataIndex: "ventType", width: 130, render: (v) => v || "—" },
      { title: "Description", dataIndex: "description", ellipsis: true, render: (v) => v || "—" },
      { title: "Status", dataIndex: "status", width: 160, render: (v) => (v && v !== "—" ? <Tag color={/active/i.test(v) ? "green" : /mainten/i.test(v) ? "orange" : "default"}>{v}</Tag> : "—") },
      { title: "Attachments", dataIndex: "attachments", width: 110, align: "center", render: (v) => ((v || []).length ? <Tag color="cyan">{v.length} file(s)</Tag> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>) },
    ],
  },
};

// One aerial/preview image for the facility — prefer a gallery item tagged for
// this module, else any gallery image, else a legacy photo. The stored URL is a
// signed /secure proxy URL that renders in <img> without an auth header.
const pickThumb = (facility, matchRe) => {
  const items = Array.isArray(facility.galleryItems) ? facility.galleryItems : [];
  const tagged = items.find((it) => it.url && matchRe.test(`${it.component || ""} ${it.caption || ""}`));
  if (tagged) return tagged.url;
  const any = items.find((it) => it.url);
  if (any) return any.url;
  const photos = Array.isArray(facility.galleryPhotos) ? facility.galleryPhotos : [];
  return photos.find(Boolean) || "";
};

export default function SlfManagementBySlf({ facilities = [], kind = "leachate" }) {
  const cfg = KIND[kind] || KIND.leachate;

  const groups = useMemo(() => {
    return (facilities || [])
      .map((f) => {
        const details = Array.isArray(f[cfg.detailsField]) ? f[cfg.detailsField] : [];
        const records = details.map((d, i) => ({
          key: `${f._id || f.lgu}-${i}`,
          num: d.pondNo ?? d.ventNo ?? i + 1,
          ventType: d.ventType,
          description: d.description,
          status: d.status || "—",
          attachments: d.attachments || [],
        }));
        const statusCounts = {};
        records.forEach((r) => { const s = r.status || "—"; statusCounts[s] = (statusCounts[s] || 0) + 1; });
        const total = records.length || Number(f[cfg.countField] || 0);
        const active = records.filter((r) => /active|operational/i.test(r.status)).length;
        return {
          key: f._id || f.lgu,
          slfName: f.lgu || "Unnamed SLF",
          province: f.province || "—",
          thumb: pickThumb(f, cfg.galleryMatch),
          records,
          total,
          active,
          withDocs: records.filter((r) => (r.attachments || []).length).length,
          pie: Object.entries(statusCounts).filter(([s, v]) => s !== "—" && v > 0).map(([name, value]) => ({ name, value })),
          statusCounts,
        };
      })
      .sort((a, b) => b.total - a.total || a.slfName.localeCompare(b.slfName));
  }, [facilities, cfg]);

  if (!groups.length) return <Empty description={`No ${cfg.nounPlural.toLowerCase()} recorded yet`} />;

  return (
    <Collapse
      defaultActiveKey={groups.slice(0, 1).map((g) => g.key)}
      items={groups.map((g) => ({
        key: g.key,
        label: (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Space size={8} wrap>
              {cfg.icon}
              <Text strong style={{ fontSize: 13 }}>{g.slfName}</Text>
              <Tag color="geekblue" bordered={false} style={{ whiteSpace: "normal" }}><EnvironmentOutlined /> {g.province}</Tag>
            </Space>
            <Space size={6} wrap>
              <Tag color={cfg.totalTagColor}>{g.total} {cfg.nounPlural}</Tag>
              <Tag color="green">{g.active} Active</Tag>
              {g.withDocs > 0 && <Tag color="purple">{g.withDocs} with docs</Tag>}
            </Space>
          </div>
        ),
        children: (
          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Card size="small" style={{ borderRadius: 8 }} styles={{ body: { padding: 10 } }}>
                {g.thumb ? (
                  <img
                    src={g.thumb}
                    alt={`${g.slfName} ${cfg.noun} area`}
                    style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 6, display: "block" }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ) : (
                  <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", borderRadius: 6 }}>
                    <Space direction="vertical" align="center" size={4}>
                      <PictureOutlined style={{ fontSize: 28, color: "#bfbfbf" }} />
                      <Text type="secondary" style={{ fontSize: 11 }}>No gallery image</Text>
                    </Space>
                  </div>
                )}
                <Row gutter={8} style={{ marginTop: 10 }}>
                  <Col span={12}><Statistic title={`Total ${cfg.nounPlural}`} value={g.total} valueStyle={{ fontSize: 18, color: cfg.accent }} /></Col>
                  <Col span={12}><Statistic title="Active" value={g.active} valueStyle={{ fontSize: 18, color: "#52c41a" }} /></Col>
                </Row>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title={<Text strong style={{ fontSize: 12 }}>{cfg.noun} Distribution</Text>} style={{ borderRadius: 8, height: "100%" }} styles={{ body: { height: 200 } }}>
                {g.pie.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={g.pie} dataKey="value" nameKey="name" innerRadius={36} outerRadius={64} paddingAngle={2} isAnimationActive={false}>
                        {g.pie.map((e) => <RCell key={e.name} fill={statusColor(e.name)} />)}
                      </Pie>
                      <RTooltip formatter={(v, n) => [`${v} ${cfg.noun.toLowerCase()}(s)`, n]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No status data" />}
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small" title={<Text strong style={{ fontSize: 12 }}>Status Summary</Text>} style={{ borderRadius: 8, height: "100%" }}>
                {Object.keys(g.statusCounts).filter((s) => s !== "—").length ? (
                  <Space direction="vertical" size={6} style={{ width: "100%" }}>
                    {Object.entries(g.statusCounts).filter(([s]) => s !== "—").sort((a, b) => b[1] - a[1]).map(([s, c]) => (
                      <div key={s} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: statusColor(s), marginRight: 6 }} />{s}</span>
                        <Text strong>{c}</Text>
                      </div>
                    ))}
                  </Space>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No status recorded" />}
              </Card>
            </Col>
            <Col xs={24}>
              <Table
                size="small"
                rowKey="key"
                dataSource={g.records}
                columns={cfg.columns}
                pagination={g.records.length > 8 ? { pageSize: 8, size: "small", showTotal: (t) => `${t} ${cfg.noun.toLowerCase()}(s)` } : false}
                scroll={{ x: 640 }}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${cfg.noun.toLowerCase()} details entered`} /> }}
              />
            </Col>
          </Row>
        ),
      }))}
    />
  );
}
