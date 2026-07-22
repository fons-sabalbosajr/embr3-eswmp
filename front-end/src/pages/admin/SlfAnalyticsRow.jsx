import { useEffect, useMemo, useState } from "react";
import { Card, Row, Col, Segmented, Empty, Spin, Typography, Space, Tag, Button, Modal, Statistic, Table } from "antd";
import { BarChartOutlined, LineChartOutlined, TeamOutlined, ExpandAltOutlined } from "@ant-design/icons";
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

const UNIT = "m³"; // all aggregation is normalized to m³ (totalVolumeM3)
const COLORS = ["#1677ff", "#52c41a", "#722ed1", "#fa8c16", "#13c2c2", "#eb2f96", "#2f54eb", "#a0d911"];

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

export default function SlfAnalyticsRow({ isDark, period = "monthly" }) {
  const [records, setRecords] = useState([]);
  const [userByEmail, setUserByEmail] = useState({});
  const [loading, setLoading] = useState(true);
  const [trendMode, setTrendMode] = useState(period); // daily | weekly | monthly
  // "See More" detail modal — null | "trends" | "users" | "slf". No extra fetch:
  // the modal reads the SAME already-loaded records/aggregations as the cards.
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [recRes, userRes] = await Promise.all([
          api.get("/data-slf", { params: { mode: "list" } }),
          api.get("/portal-users").catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        const data = recRes.data;
        const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        // Dedupe by _id so a repeated row can never inflate a chart.
        const seen = new Set();
        const deduped = rows.filter((r) => {
          const id = r?._id || `${r?.slfName}-${r?.dateOfDisposal}-${r?.submissionId}`;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        setRecords(deduped.filter((r) => isValidStatus(r.status)));
        const map = {};
        (userRes.data || []).forEach((u) => {
          const email = String(u.email || "").trim().toLowerCase();
          if (email) {
            map[email] =
              `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.username || u.email;
          }
        });
        setUserByEmail(map);
      } catch {
        if (!cancelled) setRecords([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Waste Submission Trends ── (full series; the card shows the last 18 buckets)
  const trendDataAll = useMemo(() => {
    const buckets = new Map();
    const keyOf = (d) => {
      const day = dayjs(d);
      if (!day.isValid()) return null;
      if (trendMode === "daily") return day.format("YYYY-MM-DD");
      if (trendMode === "weekly") return day.startOf("week").format("YYYY-MM-DD");
      return day.format("YYYY-MM");
    };
    records.forEach((r) => {
      const k = keyOf(r.dateOfDisposal);
      if (!k) return;
      const b = buckets.get(k) || { key: k, volume: 0, submissions: 0 };
      b.volume += num(r.totalVolumeM3);
      b.submissions += 1;
      buckets.set(k, b);
    });
    return [...buckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((b) => ({
        ...b,
        label:
          trendMode === "monthly"
            ? dayjs(b.key + "-01").format("MMM 'YY")
            : dayjs(b.key).format("MMM D"),
        volume: Math.round(b.volume * 100) / 100,
      }));
  }, [records, trendMode]);
  const trendData = useMemo(() => trendDataAll.slice(-18), [trendDataAll]);

  // ── Most Active Portal Users ── (full ranking; the card shows the top 8)
  const activeUsersAll = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      const email = String(r.submittedBy || "").trim().toLowerCase();
      const name = userByEmail[email] || r.submittedBy || r.lguCompanyName || "Unknown";
      const key = email || name;
      const b = map.get(key) || { name, submissions: 0, volume: 0 };
      b.submissions += 1;
      b.volume += num(r.totalVolumeM3);
      map.set(key, b);
    });
    return [...map.values()]
      .sort((a, b) => b.submissions - a.submissions)
      .map((u) => ({ ...u, volume: Math.round(u.volume * 100) / 100 }));
  }, [records, userByEmail]);
  const activeUsers = useMemo(() => activeUsersAll.slice(0, 8), [activeUsersAll]);

  // ── Waste Volume by SLF ── (full ranking; the card shows the top 8)
  const volumeBySlfAll = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      const name = r.slfName || r.lguCompanyName || "Unknown";
      const b = map.get(name) || { name, volume: 0 };
      b.volume += num(r.totalVolumeM3);
      map.set(name, b);
    });
    return [...map.values()]
      .filter((s) => s.volume > 0)
      .sort((a, b) => b.volume - a.volume)
      .map((s) => ({ ...s, volume: Math.round(s.volume * 100) / 100 }));
  }, [records]);
  const volumeBySlf = useMemo(() => volumeBySlfAll.slice(0, 8), [volumeBySlfAll]);

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

  const chartCard = (title, icon, extra, hasData, chart, moreKey) => (
    <Col {...grid}>
      <Card
        size="small"
        title={<span>{icon} {title}</span>}
        extra={
          <Space size={6}>
            {extra}
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
        <ResponsiveContainer width="100%" height={Math.max(DETAIL_H, data.length * 30)}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={isDark ? "#303030" : "#f0f0f0"} />
            <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={160} tick={<TruncatedYAxisTick />} interval={0} />
            <RTooltip
              formatter={(v, n) =>
                isUsers
                  ? [Number(v).toLocaleString(), n === "submissions" ? "Submissions" : "Volume"]
                  : [`${Number(v).toLocaleString()} ${UNIT}`, "Volume"]
              }
              labelFormatter={(l) => l}
            />
            <Legend />
            <Bar dataKey={isUsers ? "submissions" : "volume"} name={isUsers ? "Submissions" : "Volume"} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((_, i) => (
                <RCell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <Table
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
        />
      </>
    );
  };

  return (
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
        <ResponsiveContainer width="100%" height={CHART_H}>
          <BarChart data={activeUsers} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={isDark ? "#303030" : "#f0f0f0"} />
            <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={120} tick={<TruncatedYAxisTick />} />
            <RTooltip
              formatter={(v, n) => [Number(v).toLocaleString(), n === "submissions" ? "Submissions" : "Volume"]}
              labelFormatter={(l) => l}
            />
            <Bar dataKey="submissions" radius={[0, 4, 4, 0]} name="submissions" isAnimationActive={false}>
              {activeUsers.map((_, i) => (
                <RCell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>,
        "users",
      )}

      {chartCard(
        "Waste Volume by SLF",
        <BarChartOutlined style={{ color: "#52c41a" }} />,
        <Text type="secondary" style={{ fontSize: 11 }}>in {UNIT}</Text>,
        volumeBySlf.length > 0,
        <ResponsiveContainer width="100%" height={CHART_H}>
          <BarChart data={volumeBySlf} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={isDark ? "#303030" : "#f0f0f0"} />
            <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} />
            <YAxis type="category" dataKey="name" width={140} interval={0} tick={<TruncatedYAxisTick />} />
            <RTooltip labelFormatter={(name) => name} formatter={(v) => [`${Number(v).toLocaleString()} ${UNIT}`, "Volume"]} />
            <Bar dataKey="volume" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {volumeBySlf.map((_, i) => (
                <RCell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>,
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
  );
}
