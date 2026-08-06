import { useEffect, useMemo, useRef, useState } from "react";
import {
  Row,
  Col,
  Card,
  Space,
  Tag,
  Typography,
  Empty,
  Collapse,
  Tooltip,
  Input,
  Skeleton,
  Badge,
} from "antd";
import {
  EnvironmentOutlined,
  FileTextOutlined,
  FireOutlined,
  WarningOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import ResponsiveTable from "./shared/ResponsiveTable";
import SummaryTile from "./shared/SummaryTile";
import {
  getMediaFileName,
  getMediaKind,
  isDriveUrl,
  resolveMediaEmbedUrl,
  resolveMediaImageUrl,
} from "../../utils/mediaFiles";
import useMediaMeta from "../../utils/useMediaMeta";

const { Text } = Typography;

// Per-SLF Preventive Measures view.
//
// Structure: one collapsible section PER PROVINCE, each containing a sortable /
// searchable table of that province's facilities. Expanding a facility row
// reveals its document thumbnails. This replaced a flat list of per-facility
// cards, which gave no way to sort or search and buried the province a reader
// needs to group by.
//
// Aggregates all three document sources: Fire Prevention, Trash Slide, and flat
// Preventive Measure files.
const CATEGORY = {
  "Fire Prevention": { color: "#ff4d4f", icon: <FireOutlined /> },
  "Trash Slide": { color: "#fa8c16", icon: <WarningOutlined /> },
  "Preventive Files": { color: "#fa541c", icon: <SafetyCertificateOutlined /> },
};
const catColor = (c) => CATEGORY[c]?.color || "#1677ff";

const buildEntries = (facility) => {
  const out = [];
  const push = (url, category, description, knownName) => {
    if (!url) return;
    out.push({ url, category, description: description || "", knownName: knownName || "" });
  };

  (facility.firePrevMeasures || []).forEach((m) =>
    (m.attachments || []).forEach((url) => push(url, "Fire Prevention", m.description || m.measure)),
  );
  (facility.trashSlideMeasures || []).forEach((m) =>
    (m.attachments || []).forEach((url) => push(url, "Trash Slide", m.description || m.measure)),
  );

  // Flat preventive files carry their original name in a parallel details array.
  const detailByUrl = new Map(
    (facility.preventiveMeasureFileDetails || []).filter((d) => d?.url).map((d) => [d.url, d]),
  );
  (facility.preventiveMeasureFiles || []).forEach((url) => {
    const detail = detailByUrl.get(url) || {};
    push(url, "Preventive Files", detail.description, detail.fileName);
  });

  return out;
};

/**
 * Mounts its children only once the tile has scrolled near the viewport.
 *
 * A facility can hold dozens of documents and each restricted PDF preview is an
 * embedded document viewer. Rendering them all at once pinned the main thread
 * and made the panel unresponsive, so only what the user can see is built.
 */
function LazyMount({ children, placeholder, rootMargin = "300px" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} style={{ height: "100%" }}>
      {visible ? children : placeholder}
    </div>
  );
}

const KIND_COLOR = { pdf: "#fa541c", word: "#2f54eb", sheet: "#389e0d", slide: "#d4380d" };

function ThumbPreview({ entry, isDark }) {
  const surface = isDark ? "#1f1f1f" : "#fafafa";

  if (entry.kind === "image") {
    return (
      <img
        src={resolveMediaImageUrl(entry.url, { thumbnail: true })}
        alt={entry.fileName}
        loading="lazy"
        decoding="async"
        style={{ width: "100%", height: "100%", objectFit: "cover", background: surface }}
        onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
      />
    );
  }

  if (entry.kind === "pdf") {
    // Publicly-shared Drive PDFs have a server-rendered first-page raster, which
    // is far cheaper than an embedded viewer. Restricted (proxy) PDFs have no
    // such endpoint, so the document itself is embedded — but only once scrolled
    // to, and with the viewer chrome switched off.
    if (isDriveUrl(entry.url)) {
      return (
        <img
          src={resolveMediaImageUrl(entry.url, { thumbnail: true })}
          alt={entry.fileName}
          loading="lazy"
          decoding="async"
          style={{ width: "100%", height: "100%", objectFit: "cover", background: "#fff" }}
        />
      );
    }
    return (
      <iframe
        title={entry.fileName}
        src={`${resolveMediaEmbedUrl(entry.url).split("#")[0]}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&page=1`}
        loading="lazy"
        tabIndex={-1}
        style={{ width: "100%", height: "100%", border: "none", pointerEvents: "none", background: "#fff" }}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        height: "100%",
        color: KIND_COLOR[entry.kind] || "#8c8c8c",
        background: surface,
      }}
    >
      <FileTextOutlined style={{ fontSize: 32 }} />
      <Tag color="default" style={{ margin: 0, fontSize: 10 }}>{(entry.kind || "file").toUpperCase()}</Tag>
    </div>
  );
}

function Thumb({ entry, onOpenFile, isDark }) {
  return (
    <Tooltip title={entry.description ? `${entry.fileName} — ${entry.description}` : `Open ${entry.fileName}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenFile(entry)}
        onKeyDown={(e) => { if (e.key === "Enter") onOpenFile(entry); }}
        style={{
          cursor: "pointer",
          border: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
          borderRadius: 8,
          overflow: "hidden",
          background: isDark ? "#141414" : "#fff",
          height: "100%",
        }}
      >
        <div style={{ height: 96, background: isDark ? "#1f1f1f" : "#fafafa", position: "relative", overflow: "hidden" }}>
          <LazyMount placeholder={<Skeleton.Node active style={{ width: "100%", height: 96 }} />}>
            <ThumbPreview entry={entry} isDark={isDark} />
          </LazyMount>
          {entry.kind !== "image" && (
            <Tag color="red" style={{ position: "absolute", top: 4, right: 4, margin: 0, fontSize: 9 }}>
              {(entry.kind || "file").toUpperCase()}
            </Tag>
          )}
        </div>
        <div style={{ padding: "6px 8px" }}>
          <Tag
            style={{ margin: 0, fontSize: 9, color: catColor(entry.category), borderColor: catColor(entry.category), background: "transparent" }}
          >
            {entry.category}
          </Tag>
          <Text ellipsis style={{ display: "block", fontSize: 11, marginTop: 4 }}>{entry.fileName}</Text>
        </div>
      </div>
    </Tooltip>
  );
}

export default function PreventiveMeasuresBySlf({ facilities = [], onOpenFile, isDark = false }) {
  const [search, setSearch] = useState("");

  // Every document URL in one flat list, so the metadata for legacy restricted
  // uploads is resolved in ONE batched request for the whole panel rather than
  // per tile.
  const allUrls = useMemo(() => {
    const urls = [];
    (facilities || []).forEach((facility) => {
      buildEntries(facility).forEach((entry) => {
        if (!entry.knownName) urls.push(entry.url);
      });
    });
    return [...new Set(urls)];
  }, [facilities]);

  const mediaMeta = useMediaMeta(allUrls);

  const facilityRows = useMemo(() => {
    return (facilities || [])
      .map((facility) => {
        const entries = buildEntries(facility).map((entry) => {
          const meta = mediaMeta[entry.url] || {};
          const fileName = getMediaFileName(entry.url, entry.knownName || meta.fileName);
          return {
            ...entry,
            fileName,
            kind: getMediaKind(entry.url, fileName, meta.mimeType),
          };
        });

        const counts = { "Fire Prevention": 0, "Trash Slide": 0, "Preventive Files": 0 };
        entries.forEach((entry) => { counts[entry.category] += 1; });

        return {
          key: facility._id || facility.lgu,
          slfName: facility.lgu || "Unnamed SLF",
          province: facility.province || "Unassigned",
          entries,
          total: entries.length,
          fire: counts["Fire Prevention"],
          trash: counts["Trash Slide"],
          files: counts["Preventive Files"],
        };
      })
      .filter((row) => row.total > 0);
  }, [facilities, mediaMeta]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return facilityRows;
    return facilityRows
      .map((row) => {
        const nameHit = row.slfName.toLowerCase().includes(term) || row.province.toLowerCase().includes(term);
        if (nameHit) return row;
        // Also match on document names so a reader can find one specific file.
        const entries = row.entries.filter((entry) => entry.fileName.toLowerCase().includes(term));
        return entries.length ? { ...row, entries, total: entries.length } : null;
      })
      .filter(Boolean);
  }, [facilityRows, search]);

  // Group by province — the primary organising axis for this view.
  const provinceGroups = useMemo(() => {
    const byProvince = new Map();
    filteredRows.forEach((row) => {
      if (!byProvince.has(row.province)) byProvince.set(row.province, []);
      byProvince.get(row.province).push(row);
    });
    return [...byProvince.entries()]
      .map(([province, rows]) => ({
        province,
        rows: rows.slice().sort((a, b) => b.total - a.total || a.slfName.localeCompare(b.slfName)),
        facilities: rows.length,
        documents: rows.reduce((sum, row) => sum + row.total, 0),
      }))
      .sort((a, b) => a.province.localeCompare(b.province));
  }, [filteredRows]);

  const columns = useMemo(
    () => [
      {
        title: "SLF Name",
        dataIndex: "slfName",
        key: "slfName",
        sorter: (a, b) => a.slfName.localeCompare(b.slfName),
        defaultSortOrder: "ascend",
        render: (value) => (
          <Space size={6}>
            <SafetyCertificateOutlined style={{ color: "#fa541c" }} />
            <Text strong style={{ fontSize: 13 }}>{value}</Text>
          </Space>
        ),
      },
      {
        title: "Total Docs",
        dataIndex: "total",
        key: "total",
        align: "right",
        width: 110,
        sorter: (a, b) => a.total - b.total,
        render: (value) => <Tag color="volcano" style={{ margin: 0 }}>{value}</Tag>,
      },
      {
        title: "Fire Prevention",
        dataIndex: "fire",
        key: "fire",
        align: "right",
        width: 140,
        sorter: (a, b) => a.fire - b.fire,
        render: (value) => (value ? <Tag color="red" style={{ margin: 0 }}>{value}</Tag> : <Text type="secondary">—</Text>),
      },
      {
        title: "Trash Slide",
        dataIndex: "trash",
        key: "trash",
        align: "right",
        width: 130,
        sorter: (a, b) => a.trash - b.trash,
        render: (value) => (value ? <Tag color="orange" style={{ margin: 0 }}>{value}</Tag> : <Text type="secondary">—</Text>),
      },
      {
        title: "Other Files",
        dataIndex: "files",
        key: "files",
        align: "right",
        width: 130,
        sorter: (a, b) => a.files - b.files,
        render: (value) => (value ? <Tag color="gold" style={{ margin: 0 }}>{value}</Tag> : <Text type="secondary">—</Text>),
      },
    ],
    [],
  );

  if (!facilityRows.length) {
    return <Empty description="No preventive measure files uploaded yet." />;
  }

  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={8} lg={6}>
          <SummaryTile
            isDark={isDark}
            accent="#fa541c"
            icon={<SafetyCertificateOutlined />}
            title="Total Documents"
            value={facilityRows.reduce((sum, row) => sum + row.total, 0)}
            hint={`${facilityRows.length} facilities across ${provinceGroups.length} province(s)`}
          />
        </Col>
        <Col xs={24} sm={16} lg={18}>
          <Input
            allowClear
            size="large"
            prefix={<SearchOutlined />}
            placeholder="Search by SLF name, province or document file name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ marginTop: 4 }}
          />
        </Col>
      </Row>

      {provinceGroups.length === 0 ? (
        <Empty description={`No preventive measure documents match "${search}".`} />
      ) : (
        <Collapse
          // Open the first province by default; searching opens everything that
          // still matches so results are never hidden behind a closed panel.
          defaultActiveKey={provinceGroups.slice(0, 1).map((group) => group.province)}
          activeKey={search.trim() ? provinceGroups.map((group) => group.province) : undefined}
          items={provinceGroups.map((group) => ({
            key: group.province,
            label: (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Space size={8} wrap>
                  <EnvironmentOutlined style={{ color: "#2f54eb" }} />
                  <Text strong style={{ fontSize: 13 }}>{group.province}</Text>
                </Space>
                <Space size={6} wrap>
                  <Badge color="#2f54eb" text={<Text style={{ fontSize: 12 }}>{group.facilities} SLF</Text>} />
                  <Tag color="volcano" style={{ margin: 0 }}>{group.documents} Docs</Tag>
                </Space>
              </div>
            ),
            children: (
              <ResponsiveTable
                rowKey="key"
                columns={columns}
                dataSource={group.rows}
                pagination={group.rows.length > 10 ? { pageSize: 10, size: "small" } : false}
                expandable={{
                  // Thumbnails are built only for the facility the user opens,
                  // and each tile still lazy-mounts on scroll.
                  expandedRowRender: (row) => (
                    <Row gutter={[10, 10]}>
                      {row.entries.map((entry, index) => (
                        <Col xs={12} sm={8} md={6} lg={4} key={`${row.key}-${index}`}>
                          <Thumb
                            entry={{ ...entry, slfName: row.slfName, province: row.province }}
                            onOpenFile={onOpenFile}
                            isDark={isDark}
                          />
                        </Col>
                      ))}
                    </Row>
                  ),
                  rowExpandable: (row) => row.total > 0,
                }}
              />
            ),
          }))}
        />
      )}
    </>
  );
}
