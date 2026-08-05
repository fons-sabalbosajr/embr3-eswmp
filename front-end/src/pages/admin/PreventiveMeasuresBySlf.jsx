import { useMemo } from "react";
import { Row, Col, Card, Space, Tag, Typography, Empty, Collapse, Statistic, Tooltip } from "antd";
import { PieChart, Pie, Cell as RCell, Tooltip as RTooltip, Legend, ResponsiveContainer } from "recharts";
import { EnvironmentOutlined, FileTextOutlined, FireOutlined, WarningOutlined, SafetyCertificateOutlined } from "@ant-design/icons";

const { Text } = Typography;

// Per-SLF Preventive Measures view: one collapsible card per facility with
// category tiles, a category pie chart, and a THUMBNAIL grid (image files show a
// real thumbnail; PDFs/others show a typed thumbnail card) — clicking any tile
// opens the shared file viewer. Aggregates all three sources: Fire Prevention,
// Trash Slide, and flat Preventive Measure files.
const CATEGORY = {
  "Fire Prevention": { color: "#ff4d4f", icon: <FireOutlined /> },
  "Trash Slide": { color: "#fa8c16", icon: <WarningOutlined /> },
  "Preventive Files": { color: "#fa541c", icon: <SafetyCertificateOutlined /> },
};
const catColor = (c) => CATEGORY[c]?.color || "#1677ff";

const buildEntries = (f, getFileName, getKind) => {
  const out = [];
  const push = (url, category, description) => {
    if (!url) return;
    const fileName = getFileName(url, "document");
    out.push({ url, category, description: description || "", fileName, kind: getKind(fileName, url) });
  };
  (f.firePrevMeasures || []).forEach((m) => (m.attachments || []).forEach((url) => push(url, "Fire Prevention", m.description || m.measure)));
  (f.trashSlideMeasures || []).forEach((m) => (m.attachments || []).forEach((url) => push(url, "Trash Slide", m.description || m.measure)));
  const detailByUrl = new Map((f.preventiveMeasureFileDetails || []).filter((d) => d?.url).map((d) => [d.url, d]));
  (f.preventiveMeasureFiles || []).forEach((url) => push(url, "Preventive Files", (detailByUrl.get(url) || {}).description));
  return out;
};

function Thumb({ entry, resolveThumbUrl, onOpenFile }) {
  const isImage = entry.kind === "image";
  const isPdf = entry.kind === "pdf";
  return (
    <Tooltip title={`Open ${entry.fileName}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenFile(entry)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpenFile(entry); }}
        style={{ cursor: "pointer", border: "1px solid #f0f0f0", borderRadius: 8, overflow: "hidden", background: "#fff", height: "100%" }}
      >
        <div style={{ height: 96, background: "#fafafa", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
          {isImage && (
            <img
              src={resolveThumbUrl(entry.url)}
              alt={entry.fileName}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentNode.querySelector(".thumb-fallback").style.display = "flex"; }}
            />
          )}
          {isPdf && (
            <>
              {/* First page rendered as the thumbnail; non-interactive so the click opens the full viewer. */}
              <iframe
                title={entry.fileName}
                src={`${resolveThumbUrl(entry.url)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1`}
                loading="lazy"
                tabIndex={-1}
                style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none", background: "#fff" }}
              />
              <Tag color="red" style={{ position: "absolute", top: 4, right: 4, margin: 0, fontSize: 9 }}>PDF</Tag>
            </>
          )}
          <div
            className="thumb-fallback"
            style={{ display: (isImage || isPdf) ? "none" : "flex", flexDirection: "column", alignItems: "center", gap: 4, color: "#8c8c8c", position: (isImage || isPdf) ? "absolute" : "static", inset: 0, justifyContent: "center" }}
          >
            <FileTextOutlined style={{ fontSize: 34 }} />
            <Tag color="default" style={{ margin: 0, fontSize: 10 }}>{(entry.kind || "file").toUpperCase()}</Tag>
          </div>
        </div>
        <div style={{ padding: "6px 8px" }}>
          <Tag color={catColor(entry.category) === "#1677ff" ? "blue" : undefined} style={{ margin: 0, fontSize: 9, color: catColor(entry.category), borderColor: catColor(entry.category), background: "transparent" }}>{entry.category}</Tag>
          <Text ellipsis style={{ display: "block", fontSize: 11, marginTop: 4 }}>{entry.fileName}</Text>
        </div>
      </div>
    </Tooltip>
  );
}

export default function PreventiveMeasuresBySlf({ facilities = [], onOpenFile, getFileName, getKind, resolveThumbUrl }) {
  const groups = useMemo(() => {
    return (facilities || [])
      .map((f) => {
        const entries = buildEntries(f, getFileName, getKind);
        const catCounts = {};
        entries.forEach((e) => { catCounts[e.category] = (catCounts[e.category] || 0) + 1; });
        return {
          key: f._id || f.lgu,
          slfName: f.lgu || "Unnamed SLF",
          province: f.province || "—",
          entries,
          total: entries.length,
          fire: catCounts["Fire Prevention"] || 0,
          trash: catCounts["Trash Slide"] || 0,
          files: catCounts["Preventive Files"] || 0,
          pie: Object.entries(catCounts).map(([name, value]) => ({ name, value })),
        };
      })
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total || a.slfName.localeCompare(b.slfName));
  }, [facilities, getFileName, getKind]);

  if (!groups.length) return <Empty description="No preventive measure files uploaded yet." />;

  return (
    <Collapse
      defaultActiveKey={groups.slice(0, 1).map((g) => g.key)}
      items={groups.map((g) => ({
        key: g.key,
        label: (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Space size={8} wrap>
              <SafetyCertificateOutlined style={{ color: "#fa541c" }} />
              <Text strong style={{ fontSize: 13 }}>{g.slfName}</Text>
              <Tag color="geekblue" bordered={false} style={{ whiteSpace: "normal" }}><EnvironmentOutlined /> {g.province}</Tag>
            </Space>
            <Space size={6} wrap>
              <Tag color="volcano">{g.total} Docs</Tag>
              {g.fire > 0 && <Tag color="red">{g.fire} Fire</Tag>}
              {g.trash > 0 && <Tag color="orange">{g.trash} Trash Slide</Tag>}
              {g.files > 0 && <Tag color="gold">{g.files} Files</Tag>}
            </Space>
          </div>
        ),
        children: (
          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}>
              <Card size="small" style={{ borderRadius: 8, height: "100%" }} styles={{ body: { padding: 10 } }}>
                <Row gutter={8}>
                  <Col span={12}><Statistic title="Total Docs" value={g.total} valueStyle={{ fontSize: 18, color: "#fa541c" }} /></Col>
                  <Col span={12}><Statistic title="Fire Prevention" value={g.fire} valueStyle={{ fontSize: 18, color: "#ff4d4f" }} /></Col>
                  <Col span={12} style={{ marginTop: 8 }}><Statistic title="Trash Slide" value={g.trash} valueStyle={{ fontSize: 18, color: "#fa8c16" }} /></Col>
                  <Col span={12} style={{ marginTop: 8 }}><Statistic title="Files" value={g.files} valueStyle={{ fontSize: 18, color: "#faad14" }} /></Col>
                </Row>
              </Card>
            </Col>
            <Col xs={24} md={16}>
              <Card size="small" title={<Text strong style={{ fontSize: 12 }}>Document Categories</Text>} style={{ borderRadius: 8, height: "100%" }} styles={{ body: { height: 180 } }}>
                {g.pie.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={g.pie} dataKey="value" nameKey="name" innerRadius={34} outerRadius={62} paddingAngle={2} isAnimationActive={false}>
                        {g.pie.map((e) => <RCell key={e.name} fill={catColor(e.name)} />)}
                      </Pie>
                      <RTooltip formatter={(v, n) => [`${v} doc(s)`, n]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No category data" />}
              </Card>
            </Col>
            <Col xs={24}>
              <Text strong style={{ fontSize: 12, display: "block", marginBottom: 8 }}>Document Previews</Text>
              <Row gutter={[10, 10]}>
                {g.entries.map((entry, i) => (
                  <Col xs={12} sm={8} md={6} lg={4} key={`${g.key}-${i}`}>
                    <Thumb
                      entry={{ ...entry, slfName: g.slfName, province: g.province }}
                      resolveThumbUrl={resolveThumbUrl}
                      onOpenFile={onOpenFile}
                    />
                  </Col>
                ))}
              </Row>
            </Col>
          </Row>
        ),
      }))}
    />
  );
}
