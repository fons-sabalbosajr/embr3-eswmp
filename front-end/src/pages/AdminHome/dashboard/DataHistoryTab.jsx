import { Row, Col, Card, Statistic, Table, Tag, Space } from "antd";
import { HistoryOutlined, BarChartOutlined } from "@ant-design/icons";

// Data History tab — a five-year, year-over-year comparison across every record
// category, with an expandable per-province breakdown and a status breakdown per
// category. Read-only: it derives everything from the fetched `historyData`
// archive plus the CURRENT year's live stats.
//
// `currentStats` bundles the nine live stat payloads (swmStats, mrfStats, …) that
// supply the current-year column, so the component takes three props instead of
// eleven.
export default function DataHistoryTab({ historyData, isDark, currentStats }) {
  const CURRENT_YEAR = new Date().getFullYear();

  const HIST_CATEGORIES = [
    { key: "tenYearPlan",          label: "10-Year SWM Plan", liveStats: currentStats.swmStats },
    { key: "fundedMrf",            label: "Funded MRF",       liveStats: currentStats.mrfStats },
    { key: "lguMrf",               label: "LGU-Initiated MRF", liveStats: currentStats.lguMrfStats },
    { key: "slf",                  label: "SLF Facilities",   liveStats: currentStats.slfFacStats },
    { key: "trashTraps",           label: "Trash Traps",      liveStats: currentStats.trapStats },
    { key: "swmEquipment",         label: "SWM Equipment",    liveStats: currentStats.equipStats },
    { key: "residualContainment",  label: "Residual Containment", liveStats: currentStats.rcaStats },
    { key: "transferStation",      label: "Transfer Stations", liveStats: currentStats.tsStats },
    { key: "openDumpsite",         label: "Open Dumpsites",   liveStats: currentStats.openDumpStats },
    { key: "fundedRehab",          label: "Funded Rehab",     liveStats: null },
  ];

  const HIST_YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 4 + i);

  const getCount = (catKey, yr) => {
    if (yr === CURRENT_YEAR) {
      const cat = HIST_CATEGORIES.find((c) => c.key === catKey);
      return cat?.liveStats?.totalRecords ?? "—";
    }
    const arr = historyData?.[catKey];
    if (!arr) return "—";
    const rec = arr.find((r) => r.year === yr);
    return rec?.totalRecords ?? 0;
  };

  const getChange = (catKey, yr) => {
    const cur = getCount(catKey, yr);
    const prev = getCount(catKey, yr - 1);
    if (typeof cur !== "number" || typeof prev !== "number" || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  };

  const histMax = Math.max(
    ...HIST_CATEGORIES.flatMap((c) =>
      HIST_YEARS.map((y) => {
        const v = getCount(c.key, y);
        return typeof v === "number" ? v : 0;
      })
    ),
    1
  );

  const histColumns = [
    {
      title: "Category",
      dataIndex: "label",
      key: "label",
      fixed: "left",
      width: 180,
      render: (text) => <strong>{text}</strong>,
    },
    ...HIST_YEARS.map((yr) => ({
      title: yr === CURRENT_YEAR ? <Tag color="blue">{yr} (Live)</Tag> : String(yr),
      dataIndex: `y${yr}`,
      key: `y${yr}`,
      width: 150,
      align: "center",
      render: (_, row) => {
        const val = getCount(row.key, yr);
        const pct = typeof val === "number" ? (val / histMax) * 100 : 0;
        const change = yr > 2022 ? getChange(row.key, yr) : null;
        return (
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{typeof val === "number" ? val.toLocaleString() : val}</div>
            {typeof val === "number" && (
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: isDark ? "rgba(255,255,255,0.08)" : "#f0f0f0",
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    width: `${pct}%`,
                    background: yr === CURRENT_YEAR ? "#1890ff" : "#52c41a",
                    transition: "width 0.4s",
                  }}
                />
              </div>
            )}
            {change !== null && (
              <span style={{ fontSize: 11, color: change >= 0 ? "#52c41a" : "#ff4d4f" }}>
                {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%
              </span>
            )}
          </div>
        );
      },
    })),
  ];

  const histTableData = HIST_CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
  }));

  // Build per-category province detail
  const expandedRowRender = (record) => {
    const arr = historyData?.[record.key];
    if (!arr || arr.length === 0) return <span style={{ color: "#999" }}>No historical province data available.</span>;

    // Gather all province names across years
    const provSet = new Set();
    arr.forEach((r) => r.byProvince?.forEach((p) => provSet.add(p.province)));
    const provinces = [...provSet].sort();

    if (provinces.length === 0) return <span style={{ color: "#999" }}>No province breakdown available.</span>;

    const provColumns = [
      { title: "Province", dataIndex: "province", key: "province", fixed: "left", width: 160 },
      ...arr.map((r) => ({
        title: String(r.year),
        dataIndex: `y${r.year}`,
        key: `y${r.year}`,
        width: 100,
        align: "center",
      })),
    ];

    const provData = provinces.map((prov) => {
      const row = { key: prov, province: prov };
      arr.forEach((r) => {
        const found = r.byProvince?.find((p) => p.province === prov);
        row[`y${r.year}`] = found?.count ?? 0;
      });
      return row;
    });

    return (
      <Table
        columns={provColumns}
        dataSource={provData}
        size="small"
        pagination={false}
        scroll={{ x: "max-content" }}
        style={{ margin: "8px 0" }}
      />
    );
  };

  return (
    <div style={{ padding: "0 4px" }}>
      {/* Summary Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {HIST_CATEGORIES.slice(0, 6).map((cat) => {
          const latest = getCount(cat.key, CURRENT_YEAR);
          const prev = getCount(cat.key, CURRENT_YEAR - 1);
          const change = typeof latest === "number" && typeof prev === "number" && prev > 0
            ? ((latest - prev) / prev) * 100 : null;
          return (
            <Col xs={24} sm={12} md={8} lg={4} key={cat.key}>
              <Card
                size="small"
                style={{
                  borderRadius: 10,
                  textAlign: "center",
                  background: isDark ? "#1f1f1f" : "#fafafa",
                }}
              >
                <Statistic
                  title={cat.label}
                  value={typeof latest === "number" ? latest : 0}
                  suffix={
                    change !== null ? (
                      <span style={{ fontSize: 12, color: change >= 0 ? "#52c41a" : "#ff4d4f" }}>
                        {change >= 0 ? "▲" : "▼"}{Math.abs(change).toFixed(1)}%
                      </span>
                    ) : null
                  }
                />
                <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>vs {CURRENT_YEAR - 1}</div>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* Year-over-year table */}
      <Card
        title={
          <Space>
            <HistoryOutlined />
            Year-over-Year Comparison ({CURRENT_YEAR - 4} – {CURRENT_YEAR})
          </Space>
        }
        style={{ borderRadius: 12, marginBottom: 20 }}
      >
        <Table
          columns={histColumns}
          dataSource={histTableData}
          pagination={false}
          scroll={{ x: 950 }}
          size="middle"
          expandable={{
            expandedRowRender,
            rowExpandable: (record) => {
              const arr = historyData?.[record.key];
              return arr && arr.some((r) => r.byProvince?.length > 0);
            },
          }}
        />
      </Card>

      {/* Status breakdown per category */}
      {historyData && (
        <Card
          title={
            <Space>
              <BarChartOutlined />
              Status Breakdown by Year
            </Space>
          }
          style={{ borderRadius: 12 }}
        >
          <Row gutter={[16, 16]}>
            {HIST_CATEGORIES.filter((c) => {
              const arr = historyData[c.key];
              return arr && arr.some((r) => r.byStatus?.length > 0);
            }).map((cat) => {
              const arr = historyData[cat.key];
              // Show the most recent year's status breakdown
              const latest = [...arr].sort((a, b) => b.year - a.year)[0];
              const statuses = latest?.byStatus || [];
              const total = statuses.reduce((s, v) => s + v.count, 0) || 1;
              const statusColors = {
                Operational: "#52c41a", Operating: "#52c41a", Active: "#52c41a",
                "Non-Operational": "#ff4d4f", Closed: "#ff4d4f", Inactive: "#ff4d4f",
                "Under Construction": "#faad14", Proposed: "#1890ff",
                "For Closure": "#ff7a45", Compliant: "#52c41a", "Not Compliant": "#ff4d4f",
                "For Compliance": "#faad14", Completed: "#52c41a", Ongoing: "#1890ff",
              };

              return (
                <Col xs={24} sm={12} md={8} key={cat.key}>
                  <Card size="small" title={cat.label} style={{ borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "#999", marginBottom: 8 }}>
                      Latest: {latest?.year}
                    </div>
                    {statuses.map((s) => (
                      <div key={s.status} style={{ marginBottom: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span>{s.status}</span>
                          <span>{s.count} ({((s.count / total) * 100).toFixed(0)}%)</span>
                        </div>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            background: isDark ? "rgba(255,255,255,0.08)" : "#f0f0f0",
                          }}
                        >
                          <div
                            style={{
                              height: 6,
                              borderRadius: 3,
                              width: `${(s.count / total) * 100}%`,
                              background: statusColors[s.status] || "#1890ff",
                              transition: "width 0.4s",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Card>
      )}
    </div>
  );
}

/** Append the Data History tab to `tabItems`, matching the original position. */
export function pushDataHistoryTab(tabItems, props) {
  tabItems.push({
    key: "data-history",
    label: (
      <span>
        <HistoryOutlined /> Data History
      </span>
    ),
    children: <DataHistoryTab {...props} />,
  });
}
