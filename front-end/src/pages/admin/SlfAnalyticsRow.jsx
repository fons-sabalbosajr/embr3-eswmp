import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Row, Col, Segmented, Empty, Typography, Space, Tag, Button, Modal, Statistic, Table, Avatar, Tooltip } from "antd";
import { BarChartOutlined, LineChartOutlined, TeamOutlined, ExpandAltOutlined, ReloadOutlined } from "@ant-design/icons";
import { getSocket } from "../../utils/socket";
import { convertVolume, TONS, M3 } from "../../utils/volumeUnits";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  Cell as RCell,
} from "recharts";
import dayjs from "dayjs";
import api from "../../api";

const { Text } = Typography;

// Displayed unit is TONS. Records are aggregated in m³ (the denormalized
// totalVolumeM3), then converted ONCE to tons for display via the shared
// convertVolume (×0.2) — a real conversion, never a relabel. This keeps the unit
// centralized in utils/volumeUnits so kg/m³/tons can never be mixed silently.
const UNIT = TONS;
const toTons = (m3) => Math.round((convertVolume(m3, M3, TONS) ?? 0) * 100) / 100;
const COLORS = ["#1677ff", "#52c41a", "#722ed1", "#fa8c16", "#13c2c2", "#eb2f96", "#2f54eb", "#a0d911"];

// Initials for the default avatar when a portal user has no profile image.
const initialsOf = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
// Deterministic avatar colour from the name (stable per user, no PII).
const AVATAR_COLORS = ["#1677ff", "#52c41a", "#722ed1", "#fa8c16", "#13c2c2", "#eb2f96", "#2f54eb", "#a0d911"];
const avatarColor = (name) => {
  const s = String(name || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

// A submission counts once. "Valid" = not rejected/reverted/cancelled; the period
// filter narrows it further. Volume is read from the denormalized totalVolumeM3 so
// every record aggregates in the same unit (never string concatenation).
const isValidStatus = (s) => {
  const v = String(s || "").toLowerCase();
  return !/reject|revert|cancel|delet/.test(v);
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const EMPTY_ANALYTICS = {
  trends: { daily: [], weekly: [], monthly: [] },
  activeUsers: [],
  volumeBySlf: [],
};

export default function SlfAnalyticsRow({ isDark, period = "monthly" }) {
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [loading, setLoading] = useState(true);
  const [trendMode, setTrendMode] = useState(period); // daily | weekly | monthly
  // "See More" detail modal — null | "trends" | "users" | "slf". No extra fetch:
  // the modal reads the SAME already-loaded records/aggregations as the cards.
  const [detail, setDetail] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const cancelledRef = useRef(false);

  // `showSpinner` distinguishes the FIRST load (skeleton) from a live socket-driven
  // refresh (small spinner on the reload button), so incoming submissions never
  // blank the charts out from under whoever is reading them.
  const load = useCallback(async ({ showSpinner = false } = {}) => {
    if (showSpinner) setRefreshing(true);
    try {
      const { data } = await api.get("/data-slf/analytics-summary");
      if (cancelledRef.current) return;
      setAnalytics({
        trends: data?.trends || EMPTY_ANALYTICS.trends,
        activeUsers: Array.isArray(data?.activeUsers) ? data.activeUsers : [],
        volumeBySlf: Array.isArray(data?.volumeBySlf) ? data.volumeBySlf : [],
      });
      setUpdatedAt(data?.generatedAt ? new Date(data.generatedAt) : new Date());
    } catch {
      // Keep whatever is already on screen: a transient failure during a live
      // refresh must not wipe charts that were rendering correctly.
      if (!cancelledRef.current && !updatedAt) setAnalytics(EMPTY_ANALYTICS);
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // `updatedAt` is read only to decide whether a failure may clear state;
    // including it would rebuild this callback on every load and re-subscribe the
    // socket listener each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  // These three cards used to fetch ONCE on mount with an empty dependency array
  // and had no socket subscription, so a new or edited submission never showed up
  // until someone reloaded the whole page — the charts silently went stale. Every
  // submission mutation server-side emits refreshAdmin(req, "submissions"), which
  // is the same "data-refresh" event the rest of the admin pages already listen to.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      if (!target || target === "submissions" || target === "baselines" || target === "portal-users" || target === "facility") {
        load({ showSpinner: true });
      }
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [load]);

  // ── Waste Submission Trends ── (full series; the card shows the last 18 buckets)
  const trendDataAll = useMemo(() => {
    const rows = analytics.trends?.[trendMode] || [];
    return rows.map((b) => ({
      ...b,
      volume: toTons(b.volumeM3), // m³ → tons
    }));
  }, [analytics.trends, trendMode]);
  const trendData = useMemo(() => trendDataAll.slice(-18), [trendDataAll]);

  // ── Most Active Portal Users ── (full ranking; the card shows the top 8).
  // Enriched with the user's most-associated SLF / organization for the avatar
  // list. Only portal-account submissions are counted; no email/PII is surfaced.
  const activeUsersAll = useMemo(() => {
    return (analytics.activeUsers || []).map((u) => ({
      ...u,
      submissions: num(u.submissions),
      volume: toTons(u.volumeM3),
    }));
  }, [analytics.activeUsers]);
  const activeUsers = useMemo(() => activeUsersAll.slice(0, 8), [activeUsersAll]);

  // ── Waste Volume by SLF ── (full ranking; the card shows the top 8)
  const volumeBySlfAll = useMemo(() => {
    return (analytics.volumeBySlf || [])
      .filter((s) => num(s.volumeM3) > 0)
      .map((s) => ({ ...s, volume: toTons(s.volumeM3) })); // m³ → tons
  }, [analytics.volumeBySlf]);
  // The card now shows ALL SLFs (scrollable, dynamic height) — no silent top-N cut.
  const volumeBySlf = volumeBySlfAll;

  const cardStyle = { borderRadius: 10, height: "100%" };
  const grid = { xs: 24, md: 12, lg: 8 };
  const axisColor = isDark ? "#8c8c8c" : "#595959";
  // Consistent, taller chart height so all three cards line up and legends/axes
  // aren't cramped. Card body min-height tracks the chart + header padding.
  const CHART_H = 300;
  const CARD_BODY_MIN = CHART_H + 20;

  // Truncating Y-axis tick for category labels (portal user / SLF names). Long
  // values are cut with an ellipsis so they never overflow the axis gutter or
  // collide with the bars, while a native <title> exposes the FULL value on hover.
  // The underlying chart datum is untouched — only the rendered label is clipped.
  const MAX_LABEL_CHARS = 16;
  const TruncatedYAxisTick = ({ x, y, payload }) => {
    const full = String(payload?.value ?? "");
    const shown =
      full.length > MAX_LABEL_CHARS ? `${full.slice(0, MAX_LABEL_CHARS - 1)}…` : full;
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={4} textAnchor="end" fontSize={10} fill={axisColor}>
          {shown}
          <title>{full}</title>
        </text>
      </g>
    );
  };

  // Ranked portal-user avatar list (replaces the old bar chart). Rank #, initials
  // avatar (default when no profile image), name, associated SLF/org, and the
  // activity count. Scrolls within the card; no PII (email) is shown.
  const renderActiveUsers = (users, maxHeight = CHART_H) => (
    <div className="slf-analytics-scroll" style={{ maxHeight, overflowY: "auto", paddingRight: 4, scrollBehavior: "smooth" }}>
      {users.map((u, i) => (
        <div
          key={`${u.name}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 4px",
            borderBottom: `1px solid ${isDark ? "#1f1f1f" : "#f0f0f0"}`,
          }}
        >
          <span
            style={{
              flex: "0 0 auto", width: 22, textAlign: "center", fontWeight: 700,
              fontSize: 13, color: i < 3 ? "#722ed1" : axisColor,
            }}
          >
            {i + 1}
          </span>
          <Avatar size={32} style={{ flex: "0 0 auto", background: avatarColor(u.name) }}>
            {initialsOf(u.name)}
          </Avatar>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Tooltip title={u.name}>
              <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {u.name}
              </div>
            </Tooltip>
            {u.slf && (
              <Tooltip title={u.slf}>
                <div style={{ fontSize: 11, color: axisColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {u.slf}
                </div>
              </Tooltip>
            )}
          </div>
          <div style={{ flex: "0 0 auto", textAlign: "right" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#722ed1" }}>{Number(u.submissions).toLocaleString()}</div>
            <div style={{ fontSize: 10, color: axisColor }}>submission{u.submissions === 1 ? "" : "s"}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const chartCard = (title, icon, extra, hasData, chart, moreKey) => (
    <Col {...grid}>
      <Card
        size="small"
        title={<span>{icon} {title}</span>}
        extra={
          <Space size={6}>
            {extra}
            <Tooltip
              title={
                updatedAt
                  ? `Updated ${dayjs(updatedAt).format("HH:mm:ss")} — refreshes automatically when submissions change. Click to refresh now.`
                  : "Refresh now"
              }
            >
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={() => load({ showSpinner: true })}
                aria-label="Refresh analytics"
              />
            </Tooltip>
            {moreKey && (
              <Button
                size="small"
                type="primary"
                icon={<ExpandAltOutlined />}
                onClick={() => setDetail(moreKey)}
                disabled={!hasData}
              >
                See More
              </Button>
            )}
          </Space>
        }
        style={cardStyle}
        styles={{ body: { minHeight: CARD_BODY_MIN } }}
        loading={loading}
      >
        {!loading && !hasData ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data for the current filters." style={{ padding: "40px 0" }} />
        ) : (
          chart
        )}
      </Card>
    </Col>
  );

  // ── "See More" detail modal ── enlarged chart + full labels/legend/tooltips,
  // summary values, and a records table — all from the already-loaded data.
  const DETAIL_H = 420;
  const detailMeta = {
    trends: {
      title: "Waste Submission Trends",
      icon: <LineChartOutlined style={{ color: "#1677ff" }} />,
    },
    users: {
      title: "Most Active Portal Users",
      icon: <TeamOutlined style={{ color: "#722ed1" }} />,
    },
    slf: {
      title: "Waste Volume by SLF",
      icon: <BarChartOutlined style={{ color: "#52c41a" }} />,
    },
  };

  const renderDetailBody = () => {
    if (detail === "trends") {
      const totalVol = trendDataAll.reduce((s, b) => s + b.volume, 0);
      const totalSub = trendDataAll.reduce((s, b) => s + b.submissions, 0);
      const peak = trendDataAll.reduce((a, b) => (b.volume > (a?.volume || 0) ? b : a), null);
      return (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={12} md={8}><Card size="small"><Statistic title={`Total Volume (${UNIT})`} value={Math.round(totalVol)} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
            <Col xs={12} md={8}><Card size="small"><Statistic title="Total Submissions" value={totalSub} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
            <Col xs={24} md={8}><Card size="small"><Statistic title="Peak Period" value={peak ? peak.label : "—"} /></Card></Col>
          </Row>
          <ResponsiveContainer width="100%" height={DETAIL_H}>
            <AreaChart data={trendDataAll} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="slfTrendFillLg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1677ff" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#1677ff" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#303030" : "#f0f0f0"} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor }} />
              <YAxis tick={{ fontSize: 11, fill: axisColor }} width={56} />
              <RTooltip
                formatter={(v, n) => [
                  n === "volume" ? `${Number(v).toLocaleString()} ${UNIT}` : Number(v).toLocaleString(),
                  n === "volume" ? "Volume" : "Submissions",
                ]}
              />
              <Legend />
              <Area type="monotone" dataKey="volume" stroke="#1677ff" strokeWidth={2} fill="url(#slfTrendFillLg)" isAnimationActive={false} name="Volume" />
            </AreaChart>
          </ResponsiveContainer>
          <Table
            size="small"
            style={{ marginTop: 12 }}
            dataSource={trendDataAll.map((b, i) => ({ key: i, ...b }))}
            pagination={trendDataAll.length > 10 ? { pageSize: 10, size: "small", hideOnSinglePage: true } : false}
            scroll={{ x: 360 }}
            columns={[
              { title: "Period", dataIndex: "label" },
              { title: `Volume (${UNIT})`, dataIndex: "volume", align: "right", render: (v) => Number(v).toLocaleString() },
              { title: "Submissions", dataIndex: "submissions", align: "right" },
            ]}
          />
        </>
      );
    }
    const isUsers = detail === "users";
    const data = isUsers ? activeUsersAll : volumeBySlfAll;
    const totalVol = data.reduce((s, d) => s + d.volume, 0);
    return (
      <>
        <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
          <Col xs={12} md={8}><Card size="small"><Statistic title={isUsers ? "Portal Users" : "Facilities"} value={data.length} /></Card></Col>
          <Col xs={12} md={8}><Card size="small"><Statistic title={`Total Volume (${UNIT})`} value={Math.round(totalVol)} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
          {isUsers && (
            <Col xs={24} md={8}><Card size="small"><Statistic title="Total Submissions" value={data.reduce((s, d) => s + d.submissions, 0)} formatter={(v) => Number(v).toLocaleString()} /></Card></Col>
          )}
        </Row>
        {isUsers ? (
          renderActiveUsers(activeUsersAll, DETAIL_H)
        ) : (
          <div style={{ maxHeight: DETAIL_H, overflowY: "auto", overflowX: "hidden" }}>
            <ResponsiveContainer width="100%" height={Math.max(DETAIL_H, data.length * 28)}>
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={isDark ? "#303030" : "#f0f0f0"} />
                <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} />
                <YAxis type="category" dataKey="name" width={160} tick={<TruncatedYAxisTick />} interval={0} />
                <RTooltip formatter={(v) => [`${Number(v).toLocaleString()} ${UNIT}`, "Volume"]} labelFormatter={(l) => l} />
                <Legend />
                <Bar dataKey="volume" name="Volume" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {data.map((_, i) => (
                    <RCell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {/* <Table
          size="small"
          style={{ marginTop: 12 }}
          dataSource={data.map((d, i) => ({ key: i, rank: i + 1, ...d }))}
          pagination={data.length > 10 ? { pageSize: 10, size: "small", hideOnSinglePage: true } : false}
          scroll={{ x: 360 }}
          columns={[
            { title: "#", dataIndex: "rank", width: 50 },
            { title: isUsers ? "Portal User" : "SLF Facility", dataIndex: "name", ellipsis: true },
            { title: `Volume (${UNIT})`, dataIndex: "volume", align: "right", render: (v) => Number(v).toLocaleString() },
            ...(isUsers ? [{ title: "Submissions", dataIndex: "submissions", align: "right" }] : []),
          ]}
        /> */}
      </>
    );
  };

  return (
    <>
    <style>{`
      .slf-analytics-scroll {
        scrollbar-width: thin;
        scrollbar-color: ${isDark ? "#4b5563 #151b23" : "#b8c2cc transparent"};
      }
      .slf-analytics-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
      .slf-analytics-scroll::-webkit-scrollbar-track {
        background: ${isDark ? "#151b23" : "transparent"};
        border-radius: 999px;
      }
      .slf-analytics-scroll::-webkit-scrollbar-thumb {
        background: ${isDark ? "#4b5563" : "#b8c2cc"};
        border-radius: 999px;
        border: 2px solid ${isDark ? "#151b23" : "transparent"};
      }
      .slf-analytics-scroll::-webkit-scrollbar-thumb:hover {
        background: ${isDark ? "#64748b" : "#8fa1b3"};
      }
    `}</style>
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      {chartCard(
        "Waste Submission Trends",
        <LineChartOutlined style={{ color: "#1677ff" }} />,
        <Segmented
          size="small"
          value={trendMode}
          onChange={setTrendMode}
          options={[
            { label: "Daily", value: "daily" },
            { label: "Weekly", value: "weekly" },
            { label: "Monthly", value: "monthly" },
          ]}
        />,
        trendData.length > 0,
        <ResponsiveContainer width="100%" height={CHART_H}>
          <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="slfTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1677ff" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#1677ff" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#303030" : "#f0f0f0"} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor }} />
            <YAxis tick={{ fontSize: 11, fill: axisColor }} width={44} />
            <RTooltip
              formatter={(v, n) => [
                n === "volume" ? `${Number(v).toLocaleString()} ${UNIT}` : Number(v).toLocaleString(),
                n === "volume" ? "Volume" : "Submissions",
              ]}
            />
            <Area type="monotone" dataKey="volume" stroke="#1677ff" strokeWidth={2} fill="url(#slfTrendFill)" isAnimationActive={false} name="volume" />
          </AreaChart>
        </ResponsiveContainer>,
        "trends",
      )}

      {chartCard(
        "Most Active Portal Users",
        <TeamOutlined style={{ color: "#722ed1" }} />,
        <Tag color="purple" style={{ margin: 0 }}>Top {activeUsers.length}</Tag>,
        activeUsers.length > 0,
        renderActiveUsers(activeUsers),
        "users",
      )}

      {chartCard(
        "Waste Volume by SLF",
        <BarChartOutlined style={{ color: "#52c41a" }} />,
        <Text type="secondary" style={{ fontSize: 11 }}>tons · {volumeBySlf.length} SLFs</Text>,
        volumeBySlf.length > 0,
        // ALL registered SLFs — no silent top-N cut. Horizontal bars in a scroll
        // container; the chart's height grows with the SLF count (≥26px/bar) so
        // every label stays readable, truncated with a full-name tooltip.
        <div className="slf-analytics-scroll" style={{ maxHeight: CHART_H, overflowY: "auto", overflowX: "hidden", paddingRight: 4, scrollBehavior: "smooth" }}>
          <ResponsiveContainer width="100%" height={Math.max(CHART_H, volumeBySlf.length * 26)}>
            <BarChart data={volumeBySlf} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={isDark ? "#303030" : "#f0f0f0"} />
              <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} label={{ value: `Volume (${UNIT})`, position: "insideBottom", offset: -2, fontSize: 10, fill: axisColor }} />
              <YAxis type="category" dataKey="name" width={140} interval={0} tick={<TruncatedYAxisTick />} />
              <RTooltip labelFormatter={(name) => name} formatter={(v) => [`${Number(v).toLocaleString()} ${UNIT}`, "Volume"]} />
              <Bar dataKey="volume" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {volumeBySlf.map((_, i) => (
                  <RCell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>,
        "slf",
      )}

      <Modal
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width="min(1000px, 96vw)"
        style={{ top: 24 }}
        destroyOnHidden
        title={detail ? <Space>{detailMeta[detail].icon}<span>{detailMeta[detail].title}</span></Space> : null}
        styles={{ body: { maxHeight: "78vh", overflowY: "auto", overflowX: "hidden" } }}
      >
        {detail && renderDetailBody()}
      </Modal>
    </Row>
    </>
  );
}
