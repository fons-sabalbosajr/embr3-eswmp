import { useState } from "react";
import {
  Card,
  Row,
  Col,
  Space,
  Tag,
  Progress,
  Tooltip,
  Badge,
  Empty,
  Table,
  Typography,
  Statistic,
  Skeleton,
  Button,
} from "antd";
import {
  BarChartOutlined,
  CarOutlined,
  DatabaseOutlined,
  InboxOutlined,
  PieChartOutlined,
  TeamOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";
import {
  PieChart,
  Pie,
  Cell as RCell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import dayjs from "dayjs";
import {
  CHART_COLORS,
  ACTIVE_VOLUME_STATUSES,
  convertVolume,
  getWasteKind,
  isActiveCellStatus,
  isHazardousCellType,
  normalizeCellStatus,
  normalizeUnit,
} from "./helpers.jsx";
import ResponsiveTable from "../shared/ResponsiveTable";

const { Text } = Typography;

// A card whose body can be collapsed/expanded. Keeps the dashboard compact
// without permanently hiding data (Task 4C).
function CollapsibleCard({ title, extra, collapsed, onToggle, children, style }) {
  return (
    <Card
      size="small"
      title={
        <Space size={6} style={{ cursor: "pointer" }} onClick={onToggle}>
          {collapsed ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
          {title}
        </Space>
      }
      extra={extra}
      style={style}
      styles={{ body: collapsed ? { display: "none" } : undefined }}
    >
      {children}
    </Card>
  );
}

function SlfDashboardTab({ dashboard, isDark, loading = false }) {
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState({});
  const toggle = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  // Loading skeleton — shown while the parent is still assembling submission /
  // baseline data so the modal never renders undefined values (Task 4E).
  if (loading) {
    return (
      <div>
        <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Col xs={12} sm={8} md={8} lg={4} key={i}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Skeleton active paragraph={false} title={{ width: "80%" }} />
              </Card>
            </Col>
          ))}
        </Row>
        <Row gutter={[10, 10]}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Col xs={24} md={8} key={i}>
              <Card size="small" style={{ borderRadius: 10 }}>
                <Skeleton active paragraph={{ rows: 4 }} />
              </Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  if (!dashboard || dashboard.totalSubmissions === 0) {
    return (
      <Empty
        description="No portal submissions for this SLF yet"
        style={{ padding: 40 }}
      />
    );
  }
  const {
    unit,
    totalSubmissions,
    totalTrucks,
    totalVolume,
    residual,
    hazardous,
    generatorCount,
    companyTypeData = [],
    cellData = [],
    monthly = [],
    topGenerators = [],
    statusData = [],
    tableRows = [],
  } = dashboard;

  const fmt = (n) =>
    Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const tiles = [
    {
      label: "Submissions",
      value: totalSubmissions,
      color: "#2f54eb",
      icon: <InboxOutlined />,
    },
    {
      label: "Truck Trips",
      value: totalTrucks,
      color: "#fa8c16",
      icon: <CarOutlined />,
    },
    {
      label: `Total Volume (${unit})`,
      value: fmt(totalVolume),
      color: "#722ed1",
      icon: <DatabaseOutlined />,
    },
    {
      label: "Generators",
      value: generatorCount,
      color: "#13c2c2",
      icon: <TeamOutlined />,
    },
    {
      label: `Residual (${unit})`,
      value: fmt(residual),
      color: "#52c41a",
      icon: <BarChartOutlined />,
    },
    {
      label: `Hazardous (${unit})`,
      value: fmt(hazardous),
      color: "#cf1322",
      icon: <WarningOutlined />,
    },
  ];

  const wasteComposition = [
    { name: "Residual", value: Math.round(residual) },
    { name: "Hazardous", value: Math.round(hazardous) },
  ].filter((d) => d.value > 0);

  // Equal-height chart cards for a clean, aligned grid (Task 4A/4D).
  const CHART_H = 210;
  const cardStyle = { borderRadius: 10, height: "100%", display: "flex", flexDirection: "column" };
  const axisTick = { fontSize: 11, fill: isDark ? "#aaa" : "#555" };
  const axisLabelFill = isDark ? "#bbb" : "#666";

  // Section header with a collapse/expand toggle (Task 4C).
  const SectionHeader = ({ id, icon, title }) => (
    <div
      onClick={() => toggle(id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        margin: "4px 0 8px",
        padding: "4px 8px",
        borderRadius: 8,
        background: isDark ? "rgba(255,255,255,0.03)" : "#fafafa",
        userSelect: "none",
      }}
    >
      {collapsed[id] ? <RightOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />}
      {icon}
      <Text strong style={{ fontSize: 12 }}>{title}</Text>
    </div>
  );

  return (
    <div>
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        {tiles.map((t) => (
          <Col xs={12} sm={8} md={8} lg={4} key={t.label}>
            <Card
              size="small"
              style={{ borderRadius: 10, borderLeft: `4px solid ${t.color}` }}
              styles={{ body: { padding: "10px 12px" } }}
            >
              <Space align="center" size={8}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: `${t.color}1f`,
                    color: t.color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                  }}
                >
                  {t.icon}
                </span>
                <div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: t.color,
                      lineHeight: 1.1,
                    }}
                  >
                    {t.value}
                  </div>
                  <Text type="secondary" style={{ fontSize: 10 }}>
                    {t.label}
                  </Text>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <SectionHeader
        id="composition"
        icon={<PieChartOutlined style={{ color: "#722ed1" }} />}
        title="Waste & Generator Breakdown"
      />
      {!collapsed.composition && (
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={8}>
          <Card
            size="small"
            title={
              <Text style={{ fontSize: 12 }}>
                <PieChartOutlined /> Waste Composition ({unit})
              </Text>
            }
            style={cardStyle}
          >
            {wasteComposition.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={wasteComposition}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={75}
                    paddingAngle={3}
                    dataKey="value"
                    isAnimationActive={false}
                    label={({ name, value }) =>
                      `${name}: ${value.toLocaleString()}`
                    }
                    labelLine={false}
                  >
                    {wasteComposition.map((d, i) => (
                      <RCell
                        key={d.name}
                        fill={d.name === "Hazardous" ? "#cf1322" : "#52c41a"}
                      />
                    ))}
                  </Pie>
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No volume"
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card
            size="small"
            title={
              <Text style={{ fontSize: 12 }}>
                <PieChartOutlined /> Submissions by Source
              </Text>
            }
            style={cardStyle}
          >
            {companyTypeData.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={companyTypeData}
                    cx="50%"
                    cy="50%"
                    outerRadius={75}
                    dataKey="value"
                    isAnimationActive={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {companyTypeData.map((d, i) => (
                      <RCell
                        key={d.name}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No data"
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card
            size="small"
            title={
              <Text style={{ fontSize: 12 }}>
                <BarChartOutlined /> Top Generators ({unit})
              </Text>
            }
            style={cardStyle}
          >
            {topGenerators.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={topGenerators}
                  layout="vertical"
                  margin={{ left: 8, right: 28, bottom: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={axisTick}
                    label={{ value: `Volume (${unit})`, position: "insideBottom", offset: -8, fontSize: 10, fill: axisLabelFill }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 10, fill: isDark ? "#aaa" : "#555" }}
                  />
                  <RTooltip formatter={(v) => [`${fmt(v)} ${unit}`, "Volume"]} />
                  <Bar dataKey="value" name={`Volume (${unit})`} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {topGenerators.map((d, i) => (
                      <RCell
                        key={d.name}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                    <LabelList dataKey="value" position="right" formatter={(v) => fmt(v)} style={{ fontSize: 10, fill: axisLabelFill }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No data"
              />
            )}
          </Card>
        </Col>
      </Row>
      )}

      <SectionHeader
        id="trends"
        icon={<BarChartOutlined style={{ color: "#2f54eb" }} />}
        title="Disposal Trend & Status"
      />
      {!collapsed.trends && (
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={14}>
          <Card
            size="small"
            title={
              <Text style={{ fontSize: 12 }}>
                <BarChartOutlined /> Monthly Disposal Trend ({unit})
              </Text>
            }
            style={cardStyle}
          >
            {monthly.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart
                  data={monthly}
                  margin={{ left: 8, right: 12, top: 8, bottom: 18 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="month"
                    tick={axisTick}
                    label={{ value: "Month", position: "insideBottom", offset: -8, fontSize: 10, fill: axisLabelFill }}
                  />
                  <YAxis
                    tick={axisTick}
                    label={{ value: `Volume (${unit})`, angle: -90, position: "insideLeft", fontSize: 10, fill: axisLabelFill, style: { textAnchor: "middle" } }}
                  />
                  <RTooltip formatter={(v) => [`${fmt(v)} ${unit}`, "Volume"]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="volume"
                    name={`Volume (${unit})`}
                    stroke="#2f54eb"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No trend data"
              />
            )}
          </Card>
        </Col>
        <Col xs={24} md={10}>
          <Card
            size="small"
            title={
              <Text style={{ fontSize: 12 }}>
                <PieChartOutlined /> Submission Status
              </Text>
            }
            style={cardStyle}
          >
            {statusData.length ? (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={75}
                    paddingAngle={2}
                    dataKey="value"
                    isAnimationActive={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {statusData.map((d, i) => (
                      <RCell
                        key={d.name}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <RTooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No data"
              />
            )}
          </Card>
        </Col>
      </Row>
      )}

      <SectionHeader
        id="cells"
        icon={<DatabaseOutlined style={{ color: "#13c2c2" }} />}
        title="Cell Utilization"
      />
      {!collapsed.cells && (
      <Card
        size="small"
        title={
          <Text style={{ fontSize: 12 }}>
            <BarChartOutlined /> Cell Utilization ({unit})
          </Text>
        }
        style={{ borderRadius: 10, marginBottom: 12 }}
      >
        {cellData.length ? (
          <Row gutter={[10, 10]}>
            <Col xs={24} md={14}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={cellData}
                  margin={{ left: 8, right: 12, top: 8, bottom: 18 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    tick={axisTick}
                    label={{ value: "Cell", position: "insideBottom", offset: -8, fontSize: 10, fill: axisLabelFill }}
                  />
                  <YAxis
                    tick={axisTick}
                    label={{ value: `Volume (${unit})`, angle: -90, position: "insideLeft", fontSize: 10, fill: axisLabelFill, style: { textAnchor: "middle" } }}
                  />
                  <RTooltip formatter={(v, n) => [`${fmt(v)} ${unit}`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="capacity"
                    name={`Capacity (${unit})`}
                    fill="#d6e4ff"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="used"
                    name={`Used (${unit})`}
                    fill="#2f54eb"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </Col>
            <Col xs={24} md={10}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cellData.map((c) => (
                  <div key={c.name}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                      }}
                    >
                      <Text strong style={{ fontSize: 11 }}>
                        {c.name}{" "}
                        <Tag
                          color={
                            isHazardousCellType(c.type) ? "volcano" : "blue"
                          }
                          style={{ fontSize: 9, marginLeft: 2 }}
                        >
                          {c.type}
                        </Tag>
                      </Text>
                      <Text type="secondary" style={{ fontSize: 10 }}>
                        {fmt(c.used)} / {c.capacity ? fmt(c.capacity) : "—"}{" "}
                        {unit}
                      </Text>
                    </div>
                    <Progress
                      percent={c.pct == null ? 0 : Math.round(c.pct)}
                      size="small"
                      status={
                        c.pct >= 90
                          ? "exception"
                          : c.pct >= 75
                            ? "active"
                            : "normal"
                      }
                      strokeColor={
                        c.pct >= 90
                          ? "#ff4d4f"
                          : c.pct >= 75
                            ? "#faad14"
                            : "#52c41a"
                      }
                    />
                  </div>
                ))}
              </div>
            </Col>
          </Row>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No cell infrastructure configured"
          />
        )}
      </Card>
      )}

      <SectionHeader
        id="submissions"
        icon={<InboxOutlined style={{ color: "#fa8c16" }} />}
        title="Submissions"
      />
      {!collapsed.submissions && (
      <Card
        size="small"
        title={
          <Text style={{ fontSize: 12 }}>
            <InboxOutlined /> Submissions
          </Text>
        }
        style={{ borderRadius: 10 }}
      >
        <ResponsiveTable
          size="small"
          dataSource={tableRows}
          rowKey="_id"
          pagination={{
            current: page,
            pageSize: 8,
            onChange: setPage,
            size: "small",
            showSizeChanger: false,
          }}
          scroll={{ x: 720 }}
          columns={[
            {
              title: "ID No.",
              dataIndex: "idNo",
              key: "idNo",
              width: 140,
              render: (v) => <Text style={{ fontSize: 11 }}>{v || "—"}</Text>,
            },
            {
              title: "Date",
              dataIndex: "dateOfDisposal",
              key: "date",
              width: 110,
              render: (v) => (
                <Text style={{ fontSize: 11 }}>
                  {v ? dayjs(v).format("MM/DD/YYYY") : "—"}
                </Text>
              ),
            },
            {
              title: "Generator",
              dataIndex: "lguCompanyName",
              key: "gen",
              render: (v, r) => (
                <span style={{ fontSize: 11 }}>
                  {v || "—"}{" "}
                  <Tag
                    color={r.companyType === "Private" ? "green" : "blue"}
                    style={{ fontSize: 9 }}
                  >
                    {r.companyType || "—"}
                  </Tag>
                </span>
              ),
            },
            {
              title: "Trucks",
              dataIndex: "truckCount",
              key: "trucks",
              width: 70,
              align: "center",
              render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text>,
            },
            {
              title: `Volume (${unit})`,
              dataIndex: "volume",
              key: "vol",
              width: 110,
              align: "right",
              render: (v) => <Text style={{ fontSize: 11 }}>{fmt(v)}</Text>,
            },
            {
              title: "Status",
              dataIndex: "status",
              key: "status",
              width: 110,
              render: (v) => (
                <Tag
                  style={{ fontSize: 10 }}
                  color={
                    {
                      pending: "gold",
                      acknowledged: "green",
                      rejected: "red",
                      reverted: "volcano",
                    }[v] || "default"
                  }
                >
                  {String(v || "pending").replace("_", " ")}
                </Tag>
              ),
            },
          ]}
        />
      </Card>
      )}
    </div>
  );
}

const formatVolume = (value, unit = "tons") => {
  const number = Number(value || 0);
  return `${number.toLocaleString(undefined, { maximumFractionDigits: number >= 100 ? 0 : 2 })} ${normalizeUnit(unit)}`;
};

const CACHE_KEY = "slf-facility-cache-v6";
const CACHE_TTL = 5 * 60 * 1000;

const R3_PROVINCES = [
  "Bataan",
  "Bulacan",
  "Nueva Ecija",
  "Pampanga",
  "Tarlac",
  "Zambales",
  "Aurora",
];

const formatCompact = (value, digits = 1) => {
  const number = Number(value || 0);
  if (Math.abs(number) >= 1000000)
    return `${(number / 1000000).toFixed(digits)}M`;
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(digits)}k`;
  return number.toLocaleString();
};

const sumBy = (items, getter) =>
  items.reduce((sum, item) => sum + Number(getter(item) || 0), 0);

const getNameVariants = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const noParens = raw.replace(/\s*\(.*?\)\s*/g, " ").trim();
  const withoutPrefix = noParens
    .replace(/^province\s+of\s+/i, "")
    .replace(
      /^(local\s+governm\s*ent\s+unit|lgu|municipality\s+of|city\s+of)\s*[-:\u2012-\u2015]?\s*/i,
      "",
    )
    .trim();
  const firstCommaPart = withoutPrefix.split(",")[0]?.trim();
  return [
    ...new Set([raw, noParens, withoutPrefix, firstCommaPart].filter(Boolean)),
  ];
};

const normalizeSlfKey = (value) =>
  String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
    .replace(/\blgu\b/gi, " ")
    .replace(/\bmunicipality\s+of\b/gi, " ")
    .replace(/\bcity\s+of\b/gi, " ")
    .replace(/^province\s+of\s+/i, "")
    .replace(/[\u2012-\u2015-]+/g, " ")
    .replace(/[,.;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const expandSlfNames = (names = []) => [
  ...new Set(names.flatMap((name) => getNameVariants(name)).filter(Boolean)),
];

const getFacilitySlfNames = (record) =>
  [
    ...(record?.slfGenerator && typeof record.slfGenerator === "object"
      ? [record.slfGenerator.slfName]
      : []),
    record?.slfName,
    record?.lgu,
    record?.lgu && record?.province
      ? `${record.lgu}, ${record.province}`
      : null,
    record?.province,
  ].filter(Boolean);

const getBaselineSlfNames = (baseline) =>
  expandSlfNames([baseline?.slfName, baseline?.lguCompanyName]);

const getSubmissionSlfNames = (submission) =>
  expandSlfNames([
    submission?.slfName,
    submission?.slfGenerator && typeof submission.slfGenerator === "object"
      ? submission.slfGenerator.slfName
      : null,
  ]);

const getRecordIds = (record) =>
  [
    record?._id,
    record?.slfGenerator && typeof record.slfGenerator === "object"
      ? record.slfGenerator._id
      : record?.slfGenerator,
  ]
    .filter(Boolean)
    .map(String);

const getSubmissionSlfId = (submission) => {
  const value = submission?.slfGenerator;
  if (!value) return "";
  return String(typeof value === "object" ? value._id : value);
};

const getDataEntryId = (entry) => (entry?._id ? String(entry._id) : "");

// Pre-index submissions by SLF id + normalized name so each facility can fetch
// only its candidate submissions in O(1) instead of scanning every submission
// (avoids the O(facilities × submissions) bottleneck on the SLF Data Table).
const buildSubmissionFacilityIndex = (submissions = []) => {
  const byKey = new Map();
  (submissions || []).forEach((sub) => {
    const keys = new Set();
    const id = getSubmissionSlfId(sub);
    if (id) keys.add(`id:${id}`);
    getSubmissionSlfNames(sub).forEach((name) => {
      const k = normalizeSlfKey(name);
      if (k) keys.add(`name:${k}`);
    });
    keys.forEach((key) => {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(sub);
    });
  });
  return byKey;
};

const getFacilityCandidateSubmissions = (record, byKey) => {
  if (!byKey) return [];
  const result = new Set();
  getRecordIds(record).forEach((id) => {
    (byKey.get(`id:${id}`) || []).forEach((s) => result.add(s));
  });
  expandSlfNames(getFacilitySlfNames(record)).forEach((name) => {
    const k = normalizeSlfKey(name);
    if (k) (byKey.get(`name:${k}`) || []).forEach((s) => result.add(s));
  });
  return [...result];
};

const isSameDataEntry = (left, right) => {
  const leftId = getDataEntryId(left);
  const rightId = getDataEntryId(right);
  return !!leftId && !!rightId && leftId === rightId;
};

const hasTruckVolume = (submission) =>
  (submission?.trucks || []).some(
    (truck) => Number(truck?.actualVolume || 0) > 0,
  );

const getPortalVolumeUnit = (baseline, submissions = [], record) =>
  normalizeUnit(
    submissions
      .flatMap((submission) => submission.trucks || [])
      .find(
        (truck) =>
          Number(truck?.actualVolume || 0) > 0 && truck.actualVolumeUnit,
      )?.actualVolumeUnit ||
      (baseline?.activeCellEntries || []).find(
        (entry) => Number(entry?.volume || 0) > 0 && entry.unit,
      )?.unit ||
      baseline?.baselineUnit ||
      baseline?.activeCellResidualUnit ||
      baseline?.totalVolumeAcceptedUnit ||
      record?.wasteReceivedUnit ||
      record?.cellFillUnits?.find(Boolean) ||
      record?.cellCapacityUnits?.find(Boolean) ||
      record?.volumeCapacityUnit ||
      "m³",
  );

const parseCellIndex = (cellName) => {
  const match = String(cellName || "").match(/(?:cell\s*)?(\d+)/i);
  return match ? Number(match[1]) - 1 : null;
};

const getTruckCellIndex = (truck) => {
  if (Number.isInteger(truck?.cellIndex)) return truck.cellIndex;
  const numericIndex = Number(truck?.cellIndex);
  if (Number.isInteger(numericIndex) && numericIndex >= 0) return numericIndex;
  return parseCellIndex(
    truck?.cellName ||
      truck?.activeCell ||
      truck?.cellPlacement ||
      truck?.submissionCellPlacement,
  );
};

const buildBaselineMap = (baselines = []) => {
  const map = new Map();
  baselines.forEach((baseline) => {
    getBaselineSlfNames(baseline).forEach((name) => {
      const key = normalizeSlfKey(name);
      if (key && !map.has(key)) map.set(key, baseline);
    });
  });
  return map;
};

const findBaselineForFacility = (record, baselineMap) => {
  for (const name of expandSlfNames(getFacilitySlfNames(record))) {
    const baseline = baselineMap.get(normalizeSlfKey(name));
    if (baseline) return baseline;
  }
  return null;
};

const submissionMatchesFacility = (record, submission) => {
  const submissionId = getSubmissionSlfId(submission);
  if (submissionId && getRecordIds(record).includes(submissionId)) return true;

  const recordKeys = expandSlfNames(getFacilitySlfNames(record)).map((name) =>
    normalizeSlfKey(name),
  );
  const submissionKeys = getSubmissionSlfNames(submission).map((name) =>
    normalizeSlfKey(name),
  );
  return submissionKeys.some((key) => key && recordKeys.includes(key));
};

const findBestCellIndex = (rows, wasteType, preferredIndex = null) => {
  if (
    preferredIndex != null &&
    rows[preferredIndex] &&
    isActiveCellStatus(rows[preferredIndex].status)
  )
    return preferredIndex;
  const kind = getWasteKind(wasteType);
  const activeMatch = rows.findIndex(
    (row) =>
      isActiveCellStatus(row.status) &&
      (kind === "hazardous" ? row.isHazardous : !row.isHazardous),
  );
  if (activeMatch >= 0) return activeMatch;
  const operational = rows.findIndex((row) => isActiveCellStatus(row.status));
  return operational >= 0 ? operational : 0;
};

const addVolumeToCell = (row, volume, source, wasteType, unit) => {
  const converted = convertVolume(volume, unit, row.unit);
  if (converted <= 0) return;
  row[source] += converted;
  row.total += converted;
  const kind = getWasteKind(wasteType);
  row.byWasteType[kind] = (row.byWasteType[kind] || 0) + converted;
};

const buildFacilityCellUsage = (record, baseline, submissions = []) => {
  const cellCount = Math.max(
    Number(record?.numberOfCell || 0),
    Array.isArray(record?.cellCapacities) ? record.cellCapacities.length : 0,
    Array.isArray(baseline?.activeCellEntries)
      ? baseline.activeCellEntries.length
      : 0,
    1,
  );
  const matchingSubmissions = submissions.filter(
    (submission) =>
      ACTIVE_VOLUME_STATUSES.has(submission.status || "pending") &&
      submissionMatchesFacility(record, submission) &&
      !isSameDataEntry(submission, baseline) &&
      hasTruckVolume(submission),
  );
  const targetUnit = getPortalVolumeUnit(baseline, matchingSubmissions, record);

  const rows = Array.from({ length: cellCount }, (_, index) => {
    const status = normalizeCellStatus(record?.cellStatuses?.[index]);
    const type = record?.cellTypes?.[index] || "Residual";
    return {
      key: `cell-${index + 1}`,
      index,
      cellName: `Cell ${index + 1}`,
      status,
      type,
      isHazardous: isHazardousCellType(type),
      capacity: Number(record?.cellCapacities?.[index] || 0),
      capacityUnit: normalizeUnit(
        record?.cellCapacityUnits?.[index] ||
          record?.volumeCapacityUnit ||
          "m³",
      ),
      unit: targetUnit,
      baseline: 0,
      submissions: 0,
      total: 0,
      byWasteType: {},
    };
  });

  const activeEntries = Array.isArray(baseline?.activeCellEntries)
    ? baseline.activeCellEntries
    : [];
  activeEntries.forEach((entry, orderIndex) => {
    const parsedIndex = parseCellIndex(entry.cellName);
    const targetIndex = findBestCellIndex(
      rows,
      entry.wasteType,
      parsedIndex != null && parsedIndex >= 0 ? parsedIndex : orderIndex,
    );
    const row = rows[targetIndex] || rows[0];
    if (entry.cellName) row.cellName = entry.cellName;
    addVolumeToCell(
      row,
      Number(entry.volume || 0),
      "baseline",
      entry.wasteType,
      entry.unit || baseline?.baselineUnit || targetUnit,
    );
  });

  if (activeEntries.length === 0 && baseline) {
    [
      {
        volume: baseline.activeCellResidualVolume,
        unit: baseline.activeCellResidualUnit,
        wasteType: "Residual",
      },
      {
        volume: baseline.activeCellInertVolume,
        unit: baseline.activeCellInertUnit,
        wasteType: "Treated Hazardous Waste",
      },
      {
        volume: baseline.activeCellHazardousVolume,
        unit: baseline.activeCellHazardousUnit,
        wasteType: "Hazardous Waste",
      },
    ].forEach((entry) => {
      const targetIndex = findBestCellIndex(rows, entry.wasteType);
      addVolumeToCell(
        rows[targetIndex] || rows[0],
        Number(entry.volume || 0),
        "baseline",
        entry.wasteType,
        entry.unit || targetUnit,
      );
    });
  }

  matchingSubmissions.forEach((submission) => {
    (submission.trucks || []).forEach((truck) => {
      const explicitIndex = getTruckCellIndex(truck);
      const targetIndex = findBestCellIndex(
        rows,
        truck.wasteType,
        explicitIndex,
      );
      addVolumeToCell(
        rows[targetIndex] || rows[0],
        Number(truck.actualVolume || 0),
        "submissions",
        truck.wasteType,
        truck.actualVolumeUnit || "tons",
      );
    });
  });

  const totalBaseline = rows.reduce((sum, row) => sum + row.baseline, 0);
  const totalSubmissions = rows.reduce((sum, row) => sum + row.submissions, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  return {
    rows,
    totalBaseline,
    totalSubmissions,
    total,
    unit: targetUnit,
    submissionCount: matchingSubmissions.length,
  };
};

const enrichFacilityWithBaseline = (record, baseline, submissions = []) => {
  if (!record) return record;
  const cellCount = Number(record.numberOfCell || 0);
  const usage = buildFacilityCellUsage(record, baseline, submissions);
  if (usage.total <= 0) return record;

  const currentFillValues = Array.isArray(record.cellFillValues)
    ? record.cellFillValues
    : [];
  const currentFillUnits = Array.isArray(record.cellFillUnits)
    ? record.cellFillUnits
    : [];
  const hasStoredFillValues = currentFillValues.some(
    (value) => value !== null && value !== undefined && value !== "",
  );
  const storedTargetUnit = normalizeUnit(
    record.wasteReceivedUnit || usage.unit,
  );
  const storedFillTotal = currentFillValues.reduce(
    (sum, value, index) =>
      sum +
      convertVolume(
        value,
        currentFillUnits[index] || storedTargetUnit,
        storedTargetUnit,
      ),
    0,
  );
  const nextFillValues = Array.from(
    { length: Math.max(cellCount, usage.rows.length) },
    (_, index) =>
      currentFillValues[index] !== null &&
      currentFillValues[index] !== undefined &&
      currentFillValues[index] !== ""
        ? currentFillValues[index]
        : usage.rows[index]?.total > 0
          ? usage.rows[index].total
          : currentFillValues[index],
  );
  const nextFillUnits = nextFillValues.map(
    (_, index) =>
      currentFillUnits[index] || usage.rows[index]?.unit || usage.unit,
  );

  return {
    ...record,
    actualResidualWasteReceived: hasStoredFillValues
      ? Number(storedFillTotal.toFixed(3))
      : usage.total,
    wasteReceivedUnit: hasStoredFillValues ? storedTargetUnit : usage.unit,
    cellFillValues: nextFillValues,
    cellFillUnits: nextFillUnits,
    _baselineWasteReceived: usage.totalBaseline,
    _baselineWasteReceivedUnit: usage.unit,
    _submissionWasteReceived: usage.totalSubmissions,
    _submissionWasteReceivedUnit: usage.unit,
    _cellUsageRows: usage.rows,
    _cellUsageSubmissionCount: usage.submissionCount,
    _baselineActiveCellEntries: baseline?.activeCellEntries || [],
  };
};

function groupMetric(items, groupGetter, valueGetter) {
  const map = new Map();
  items.forEach((item) => {
    const name = groupGetter(item) || "Unspecified";
    map.set(name, (map.get(name) || 0) + Number(valueGetter(item) || 0));
  });
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function topMetric(items, valueGetter, label = "value") {
  return items
    .map((item) => ({
      name: item.lgu || item.facilityName || item.province || "Unspecified SLF",
      province: item.province || "-",
      status: item.statusOfSLF || "-",
      ownership: item.ownership || "-",
      value: Number(valueGetter(item) || 0),
      label,
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
}

function DashboardMetricCard({
  active,
  color,
  icon,
  title,
  value,
  suffix,
  formatter,
  summary,
  breakdowns = [],
  onClick,
}) {
  return (
    <Card
      size="small"
      hoverable
      onClick={onClick}
      style={{
        borderRadius: 8,
        border: active ? `1px solid ${color}` : "1px solid #f0f0f0",
        borderTop: `3px solid ${color}`,
        height: "100%",
        minHeight: 118,
        cursor: "pointer",
        boxShadow: active
          ? `0 0 0 1px ${color}33`
          : "0 1px 3px rgba(15, 23, 42, 0.06)",
      }}
      bodyStyle={{ padding: "10px 12px", height: "100%" }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          height: "100%",
        }}
      >
        <Statistic
          title={<span style={{ fontSize: 11 }}>{title}</span>}
          value={value}
          suffix={suffix}
          styles={{ content: { fontSize: 18, lineHeight: 1.1 } }}
          prefix={icon}
          formatter={formatter}
        />
        <div style={{ marginTop: "auto", minHeight: 34 }}>
          <Text strong style={{ display: "block", fontSize: 11, color }}>
            {summary}
          </Text>
          {breakdowns.slice(0, 2).map((item) => (
            <Text
              key={item}
              type="secondary"
              style={{ display: "block", fontSize: 10, lineHeight: 1.25 }}
            >
              {item}
            </Text>
          ))}
        </div>
      </div>
    </Card>
  );
}

function InsightStat({ title, value, suffix, color }) {
  return (
    <Card
      size="small"
      style={{
        borderRadius: 8,
        border: `1px solid ${color}33`,
        background: `${color}0d`,
        height: "100%",
      }}
    >
      <Statistic
        title={title}
        value={value}
        suffix={suffix}
        styles={{ content: { color, fontSize: 22 } }}
        formatter={(v) => Number(v || 0).toLocaleString()}
      />
    </Card>
  );
}

function networkDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const s = dayjs(startDate).startOf("day");
  const e = dayjs(endDate).startOf("day");
  if (!s.isValid() || !e.isValid()) return null;
  let count = 0,
    cur = s;
  const dir = e.isAfter(s) ? 1 : -1;
  while (dir > 0 ? !cur.isAfter(e) : !cur.isBefore(e)) {
    const dow = cur.day();
    if (dow !== 0 && dow !== 6) count++;
    cur = cur.add(dir, "day");
  }
  return Math.max(1, count > 1 ? count - 1 : count);
}

function computeFields(rec) {
  return {
    totalDaysReportPrepared: networkDays(
      rec.dateOfMonitoring,
      rec.dateReportPrepared,
    ),
    totalDaysReviewedStaff: networkDays(
      rec.dateReportPrepared,
      rec.dateReportReviewedStaff,
    ),
    totalDaysReviewedFocal: networkDays(
      rec.dateReportReviewedStaff || rec.dateReportPrepared,
      rec.dateReportReviewedFocal,
    ),
    totalDaysApproved: networkDays(
      rec.dateReportReviewedFocal,
      rec.dateReportApproved,
    ),
  };
}

function getStatusTag(v) {
  if (!v) return <Tag color="default">—</Tag>;
  if (/operational/i.test(v) && !/non/i.test(v))
    return (
      <Tag color="green" bordered={false}>
        <CheckCircleOutlined /> Operational
      </Tag>
    );
  if (/non/i.test(v))
    return (
      <Tag color="red" bordered={false}>
        <CloseCircleOutlined /> Non-Operational
      </Tag>
    );
  return <Tag variant="filled">{v}</Tag>;
}

// -- SLF Waste Baseline Info Sub-Tab --

export default SlfDashboardTab;
export {
  sumBy,
  groupMetric,
  topMetric,
  computeFields,
  formatCompact,
  DashboardMetricCard,
  InsightStat,
  getStatusTag,
  buildSubmissionFacilityIndex,
  getFacilityCandidateSubmissions,
  expandSlfNames,
  getFacilitySlfNames,
  getBaselineSlfNames,
  getSubmissionSlfNames,
  getRecordIds,
  getSubmissionSlfId,
  getDataEntryId,
  normalizeSlfKey,
  submissionMatchesFacility,
  parseCellIndex,
  getTruckCellIndex,
  hasTruckVolume,
  findBestCellIndex,
  // cache / baseline helpers consumed by SLFMonitoring.jsx
  CACHE_KEY,
  CACHE_TTL,
  buildBaselineMap,
  findBaselineForFacility,
  enrichFacilityWithBaseline,
  R3_PROVINCES,
};
