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
  Alert,
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
  CloseCircleOutlined,
  DownOutlined,
  RightOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  MinusOutlined,
  RiseOutlined,
} from "@ant-design/icons";
import {
  PieChart,
  Pie,
  Cell as RCell,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
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
import { formatCompact as formatCompactShared } from "../../../utils/formatNumber";

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

// Every collapsible SLF Dashboard section starts COLLAPSED. Each section is
// conditionally rendered (`{!collapsed.x && …}`), so a collapsed section also
// keeps its Recharts charts unmounted until the user opens it.
//
// This is `useState` INITIAL state, so an API refresh or an ordinary rerender
// cannot re-expand a section the user closed — only the user's own toggle moves it.
const DEFAULT_COLLAPSED_SECTIONS = {
  trends: true,
  breakdown: true,
  cells: true,
  submissions: true,
};

function SlfDashboardTab({ dashboard, isDark, loading = false, error = null, progress = null }) {
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState(DEFAULT_COLLAPSED_SECTIONS);
  const toggle = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  // Loading skeleton — shown while the parent is still assembling submission /
  // baseline data so the modal never renders undefined values (Task 4E).
  if (loading) {
    // Progress is only shown when the parent reports a REAL measured count
    // (records processed / records total). No fabricated percentage — if there is
    // nothing measurable yet we show the stage name alone.
    const measurable = progress && progress.total > 0;
    const pct = measurable
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;
    return (
      <div>
        {progress?.stage && (
          <div style={{ marginBottom: 10 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {progress.stage}
              {measurable ? ` — ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} records` : "…"}
            </Text>
            <Progress
              percent={pct ?? 0}
              status="active"
              showInfo={measurable}
              size="small"
              // Indeterminate stages get a striped bar instead of a fake number.
              strokeColor={measurable ? undefined : { from: "#2f54eb", to: "#91caff" }}
            />
          </div>
        )}
        <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
          <Col xs={24} lg={9}>
            <Card style={{ borderRadius: 12 }}>
              <Skeleton active paragraph={{ rows: 3 }} title={{ width: "60%" }} />
            </Card>
          </Col>
          <Col xs={24} lg={15}>
            <Row gutter={[10, 10]}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Col xs={24} sm={8} key={i}>
                  <Card size="small" style={{ borderRadius: 10 }}>
                    <Skeleton active paragraph={false} title={{ width: "80%" }} />
                  </Card>
                </Col>
              ))}
              <Col xs={24}>
                <Card size="small" style={{ borderRadius: 10 }}>
                  <Skeleton active paragraph={false} title={{ width: "50%" }} />
                </Card>
              </Col>
            </Row>
          </Col>
        </Row>
        <Card size="small" style={{ borderRadius: 10, marginBottom: 12 }}>
          <Skeleton active paragraph={{ rows: 4 }} />
        </Card>
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

  // Surface a real fetch error instead of silently showing an empty dashboard,
  // so a failed load is distinguishable from a facility with no submissions.
  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Couldn't load dashboard data"
        description={error}
        style={{ margin: 8 }}
      />
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

  // Unified semantic palette. One accent (brand blue) carries emphasis;
  // green/red encode residual vs hazardous; the rest stay categorical.
  const PALETTE = {
    brand: "#2f54eb",
    residual: "#52c41a",
    hazardous: "#cf1322",
    trucks: "#fa8c16",
    generators: "#13c2c2",
    submissions: "#722ed1",
    warning: "#faad14",
  };

  // Month-over-month delta derived from the monthly trend. No prior-period
  // field exists on the data contract, so it's computed from the series.
  const lastMonth = monthly.length ? monthly[monthly.length - 1] : null;
  const prevMonth = monthly.length > 1 ? monthly[monthly.length - 2] : null;
  const momDelta =
    prevMonth && prevMonth.volume > 0
      ? ((lastMonth.volume - prevMonth.volume) / prevMonth.volume) * 100
      : null;

  // Residual / hazardous split for the inline composition bar on the hero.
  const wasteTotal = residual + hazardous;
  const residualPct = wasteTotal > 0 ? (residual / wasteTotal) * 100 : 0;
  const hazardPct = wasteTotal > 0 ? (hazardous / wasteTotal) * 100 : 0;

  // Cells nearing / at capacity — surfaced as an operational alert.
  const cellsAtRisk = cellData.filter((c) => c.pct != null && c.pct >= 90);
  const cellsWarning = cellData.filter(
    (c) => c.pct != null && c.pct >= 75 && c.pct < 90,
  );

  const secondaryTiles = [
    {
      label: "Submissions",
      value: fmt(totalSubmissions),
      color: PALETTE.submissions,
      icon: <InboxOutlined />,
    },
    {
      label: "Truck Trips",
      value: fmt(totalTrucks),
      color: PALETTE.trucks,
      icon: <CarOutlined />,
    },
    {
      label: "Generators",
      value: fmt(generatorCount),
      color: PALETTE.generators,
      icon: <TeamOutlined />,
    },
  ];

  const cardStyle = { borderRadius: 10, height: "100%", display: "flex", flexDirection: "column" };
  const axisTick = { fontSize: 11, fill: isDark ? "#aaa" : "#555" };
  const axisLabelFill = isDark ? "#bbb" : "#666";
  const gridStroke = isDark ? "rgba(255,255,255,0.08)" : "#eee";

  // Month-over-month delta pill shown on the hero card.
  const DeltaBadge = () => {
    if (momDelta == null)
      return (
        <Text type="secondary" style={{ fontSize: 11 }}>
          No prior month to compare
        </Text>
      );
    const flat = Math.abs(momDelta) < 0.05;
    const up = momDelta >= 0;
    const color = flat ? "#8c8c8c" : up ? PALETTE.residual : PALETTE.hazardous;
    const Icon = flat ? MinusOutlined : up ? ArrowUpOutlined : ArrowDownOutlined;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
          fontWeight: 600,
          color,
          background: `${color}1f`,
          padding: "1px 8px",
          borderRadius: 20,
        }}
      >
        <Icon style={{ fontSize: 10 }} />
        {Math.abs(momDelta).toFixed(1)}% vs last month
      </span>
    );
  };

  // Compact secondary KPI tile.
  const StatTile = ({ label, value, color, icon }) => (
    <Card
      size="small"
      style={{ borderRadius: 10, height: "100%" }}
      styles={{ body: { padding: "12px 14px" } }}
    >
      <Space align="center" size={10}>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: `${color}1f`,
            color,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
          }}
        >
          {icon}
        </span>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
            {value}
          </div>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {label}
          </Text>
        </div>
      </Space>
    </Card>
  );

  // Reusable donut with a center total and a compact custom legend.
  const DonutCard = ({ title, icon, data, height = 190 }) => {
    const total = data.reduce((s, d) => s + Number(d.value || 0), 0);
    return (
      <Card
        size="small"
        title={<Text style={{ fontSize: 12 }}>{icon} {title}</Text>}
        style={cardStyle}
      >
        {data.length ? (
          <>
            <div style={{ position: "relative" }}>
              <ResponsiveContainer width="100%" height={height}>
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={data.length > 1 ? 2 : 0}
                    dataKey="value"
                    isAnimationActive={false}
                    stroke="none"
                  >
                    {data.map((d, i) => (
                      <RCell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip formatter={(v, n) => [fmt(v), n]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  height,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: isDark ? "#fff" : "#1f1f1f", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(total)}
                </span>
                <Text type="secondary" style={{ fontSize: 10 }}>Total</Text>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8, justifyContent: "center" }}>
              {data.map((d, i) => (
                <span key={d.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <Text style={{ fontSize: 11 }}>{d.name}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{fmt(d.value)}</Text>
                </span>
              ))}
            </div>
          </>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />
        )}
      </Card>
    );
  };

  // Section header with a collapse/expand toggle.
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
      {/* Hero row: Total Volume leads, with a sparkline, MoM delta, and an
          inline residual/hazardous split; secondary KPIs and a capacity
          alert sit alongside. */}
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col xs={24} lg={9}>
          <Card
            style={{
              borderRadius: 12,
              height: "100%",
              border: `1px solid ${isDark ? "rgba(47,84,235,0.32)" : "rgba(47,84,235,0.16)"}`,
              background: isDark
                ? "linear-gradient(135deg, rgba(47,84,235,0.16), rgba(47,84,235,0.02))"
                : "linear-gradient(135deg, rgba(47,84,235,0.07), rgba(47,84,235,0))",
            }}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: `${PALETTE.brand}1f`,
                  color: PALETTE.brand,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                }}
              >
                <DatabaseOutlined />
              </span>
              <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Total Volume Disposed
              </Text>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: isDark ? "#fff" : "#1f1f1f", fontVariantNumeric: "tabular-nums" }}>
                {fmt(totalVolume)}
              </span>
              <span style={{ fontSize: 15, fontWeight: 600, color: PALETTE.brand }}>{unit}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <DeltaBadge />
            </div>

            {monthly.length > 0 && (
              <div style={{ margin: "12px -4px 0" }}>
                <ResponsiveContainer width="100%" height={56}>
                  <AreaChart data={monthly} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="heroSpark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={PALETTE.brand} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={PALETTE.brand} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="volume" stroke={PALETTE.brand} strokeWidth={2} fill="url(#heroSpark)" isAnimationActive={false} />
                    <RTooltip formatter={(v) => [`${fmt(v)} ${unit}`, "Volume"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {wasteTotal > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: "flex", height: 8, borderRadius: 5, overflow: "hidden", background: isDark ? "rgba(255,255,255,0.08)" : "#f0f0f0" }}>
                  <div style={{ width: `${residualPct}%`, background: PALETTE.residual }} />
                  <div style={{ width: `${hazardPct}%`, background: PALETTE.hazardous }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
                  <span style={{ color: PALETTE.residual, fontWeight: 600 }}>
                    Residual {fmt(residual)} {unit} ({Math.round(residualPct)}%)
                  </span>
                  <span style={{ color: PALETTE.hazardous, fontWeight: 600 }}>
                    Hazardous {fmt(hazardous)} ({Math.round(hazardPct)}%)
                  </span>
                </div>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Row gutter={[10, 10]}>
            {secondaryTiles.map((t) => (
              <Col xs={24} sm={8} key={t.label}>
                <StatTile {...t} />
              </Col>
            ))}
            <Col xs={24}>
              {cellsAtRisk.length > 0 ? (
                <Card
                  size="small"
                  style={{
                    borderRadius: 10,
                    borderLeft: `4px solid ${PALETTE.hazardous}`,
                    background: isDark ? "rgba(207,19,34,0.08)" : "#fff1f0",
                  }}
                  styles={{ body: { padding: "10px 14px" } }}
                >
                  <Space align="start" size={10}>
                    <WarningOutlined style={{ color: PALETTE.hazardous, fontSize: 18, marginTop: 2 }} />
                    <div>
                      <Text strong style={{ fontSize: 12, color: PALETTE.hazardous }}>
                        {cellsAtRisk.length} cell{cellsAtRisk.length > 1 ? "s" : ""} at/near capacity (≥90%)
                      </Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {cellsAtRisk.map((c) => `${c.name} ${Math.round(c.pct)}%`).join(" · ")}
                          {cellsWarning.length > 0 ? ` · ${cellsWarning.length} more ≥75%` : ""}
                        </Text>
                      </div>
                    </div>
                  </Space>
                </Card>
              ) : (
                <Card
                  size="small"
                  style={{
                    borderRadius: 10,
                    borderLeft: `4px solid ${PALETTE.residual}`,
                    background: isDark ? "rgba(82,196,26,0.08)" : "#f6ffed",
                  }}
                  styles={{ body: { padding: "10px 14px" } }}
                >
                  <Space align="center" size={10}>
                    <CheckCircleOutlined style={{ color: PALETTE.residual, fontSize: 18 }} />
                    <div>
                      <Text strong style={{ fontSize: 12, color: PALETTE.residual }}>
                        All cells within safe capacity
                      </Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {cellsWarning.length > 0
                            ? `${cellsWarning.length} cell${cellsWarning.length > 1 ? "s" : ""} above 75% — monitor closely`
                            : cellData.length
                              ? "No cells above 75% utilization"
                              : "No cell infrastructure configured"}
                        </Text>
                      </div>
                    </div>
                  </Space>
                </Card>
              )}
            </Col>
          </Row>
        </Col>
      </Row>

      <SectionHeader
        id="trends"
        icon={<RiseOutlined style={{ color: PALETTE.brand }} />}
        title="Monthly Disposal Trend"
      />
      {!collapsed.trends && (
      <Card
        size="small"
        title={
          <Text style={{ fontSize: 12 }}>
            <RiseOutlined /> Monthly Disposal Trend ({unit})
          </Text>
        }
        style={{ borderRadius: 10, marginBottom: 12 }}
      >
        {monthly.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={monthly} margin={{ left: 8, right: 12, top: 8, bottom: 18 }}>
              <defs>
                <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PALETTE.brand} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={PALETTE.brand} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="month"
                tick={axisTick}
                label={{ value: "Month", position: "insideBottom", offset: -8, fontSize: 10, fill: axisLabelFill }}
              />
              <YAxis
                tick={axisTick}
                width={48}
                label={{ value: `Volume (${unit})`, angle: -90, position: "insideLeft", fontSize: 10, fill: axisLabelFill, style: { textAnchor: "middle" } }}
              />
              <RTooltip formatter={(v) => [`${fmt(v)} ${unit}`, "Volume"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Area
                type="monotone"
                dataKey="volume"
                name={`Volume (${unit})`}
                stroke={PALETTE.brand}
                strokeWidth={2.5}
                fill="url(#trendFill)"
                dot={{ r: 2.5 }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No trend data yet" style={{ padding: 24 }} />
        )}
      </Card>
      )}

      <SectionHeader
        id="breakdown"
        icon={<PieChartOutlined style={{ color: PALETTE.submissions }} />}
        title="Generators & Submission Breakdown"
      />
      {!collapsed.breakdown && (
      <Row gutter={[10, 10]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={9}>
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
              <ResponsiveContainer width="100%" height={230}>
                <BarChart
                  data={topGenerators}
                  layout="vertical"
                  margin={{ left: 8, right: 30, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridStroke} />
                  <XAxis type="number" tick={axisTick} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={92}
                    tick={{ fontSize: 10, fill: isDark ? "#aaa" : "#555" }}
                  />
                  <RTooltip formatter={(v) => [`${fmt(v)} ${unit}`, "Volume"]} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  <Bar dataKey="value" name={`Volume (${unit})`} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {topGenerators.map((d, i) => (
                      <RCell key={d.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                    <LabelList dataKey="value" position="right" formatter={(v) => fmt(v)} style={{ fontSize: 10, fill: axisLabelFill }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data" />
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <DonutCard
            title="Submissions by Source"
            icon={<PieChartOutlined />}
            data={companyTypeData}
          />
        </Col>
        <Col xs={24} md={7}>
          <DonutCard
            title="Submission Status"
            icon={<CheckCircleOutlined />}
            data={statusData}
          />
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

// Item #1: delegate to THE single shared compact formatter (K/M, max 2 decimals,
// trailing zeros stripped, uppercase K). Kept as a thin wrapper so every existing
// consumer of this export (SLF Monitoring, Portal Generators, …) gets the correct
// format without changing their call sites. `invalid: "0"` preserves the previous
// behaviour of showing 0 (not "—") for missing metric values on these cards.
const formatCompact = (value, digits = 2) => formatCompactShared(value, { decimals: digits, invalid: "0" });

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
  const n = Number(volume);
  if (!Number.isFinite(n) || n <= 0) return;
  const u = normalizeUnit(unit);
  // Item #3: record every DISTINCT source unit this cell received so mixed-unit
  // data can be flagged instead of silently combined. Conversion uses the app's
  // one approved factor; an UNCONVERTIBLE record (unknown unit) is flagged, never
  // dropped without a trace or added as NaN.
  if (u) row.unitsSeen.add(u);
  const converted = convertVolume(n, u || row.unit, row.unit);
  if (converted === null) { row.hasUnconvertible = true; return; }
  if (converted <= 0) return;
  row[source] += converted;
  row.total += converted;
  const kind = getWasteKind(wasteType);
  row.byWasteType[kind] = (row.byWasteType[kind] || 0) + converted;
};

export const buildFacilityCellUsage = (record, baseline, submissions = []) => {
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
      // Item #3: mixed-unit detection per cell.
      unitsSeen: new Set(),
      hasUnconvertible: false,
      mixedUnits: false,
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

  // Item #3: finalize mixed-unit detection. A cell mixing tons + m³ is flagged so
  // the UI can WARN admins rather than presenting a silently-combined total. The
  // Set is replaced by a plain boolean so the row stays serializable/renderable.
  rows.forEach((row) => {
    row.mixedUnits = row.unitsSeen.size > 1;
    row.unitsSeen = [...row.unitsSeen];
  });
  const anyMixedUnits = rows.some((row) => row.mixedUnits);
  const anyUnconvertible = rows.some((row) => row.hasUnconvertible);

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
    anyMixedUnits,
    anyUnconvertible,
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
