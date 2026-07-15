import { Row, Col, Card, Statistic, Space, Typography, Empty } from "antd";
import { DashboardOutlined } from "@ant-design/icons";
import {
  PieChart,
  Pie,
  Cell as RCell,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const { Text } = Typography;

// ── Portal Overview dashboard ──
// Presentational: KPI cards, SLF facility grid, and waste-received breakdown
// charts. All figures are derived here from the container's fetched data,
// which is passed in as props (no state, no handlers of its own).
export default function OverviewPanel({
  submissions,
  activeCellEntries,
  closedCellEntries,
  slfInfo,
  wasteReceivedData,
  wasteReceivedLoading,
  loadingSubmissions,
  baselineLoading,
  slfInfoLoading,
  haulers,
  activeSlfName,
}) {
  const ownSubmissions = Array.isArray(submissions) ? submissions : [];
  // Read the DENORMALIZED metrics the model already maintains
  // (computeSlfMetrics keeps totalVolumeM3/Tons and truckCount in sync on save)
  // instead of re-summing every truck in the browser. The history list no longer
  // ships trucks[] at all, and this is the same number the admin totals use.
  const volumeTotals = ownSubmissions.reduce(
    (acc, item) => ({
      m3: acc.m3 + Number(item.totalVolumeM3 || 0),
      tons: acc.tons + Number(item.totalVolumeTons || 0),
    }),
    { m3: 0, tons: 0 },
  );
  const statusColors = ["#1677ff", "#52c41a", "#faad14", "#ff4d4f", "#722ed1", "#13c2c2"];
  const cellData = [
    { name: "Active Cells", value: activeCellEntries.length || Number(slfInfo?.activeCells || 0) || 0 },
    { name: "Closed Cells", value: closedCellEntries.length || Number(slfInfo?.closedCells || 0) || 0 },
  ].filter((item) => item.value > 0);
  const legacySubmissionRows = [
    ...(wasteReceivedData.lguR3 || []).map((row) => ({ ...row, clientType: "LGU", region: row.region })),
    ...(wasteReceivedData.lguOutside || []).map((row) => ({ ...row, clientType: "LGU", region: row.region })),
    ...(wasteReceivedData.privateIndustry || []).map((row) => ({ ...row, clientType: "Private", region: row.region })),
  ].filter((row) => Number(row.totalVolume || 0) > 0 || Number(row.entries || 0) > 0);
  const submissionBreakdownRows = (wasteReceivedData.clientBreakdown || wasteReceivedData.submissionClients || []).length
    ? (wasteReceivedData.clientBreakdown || wasteReceivedData.submissionClients || [])
    : legacySubmissionRows;
  const baselineBreakdownRows = (wasteReceivedData.baselineClients || []).length
    ? wasteReceivedData.baselineClients
    : wasteReceivedData.baselineCellBreakdown || [];
  const getBreakdownCategory = (row = {}) => {
    const type = row.clientType || row.companyType || "Private";
    const region = row.region || row.companyRegion || "";
    if (/baseline/i.test(type)) return "Baseline Utilization";
    if (/lgu/i.test(type)) return String(region).startsWith("03") ? "LGU - Region III" : "LGU - Outside Region III";
    return "Private Industry";
  };
  const toCategoryData = (rows) => Object.entries(rows.reduce((acc, row) => {
    const key = getBreakdownCategory(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([name, value]) => ({ name, value }));
  const baselineCategoryData = toCategoryData(baselineBreakdownRows);
  const submissionCategoryData = toCategoryData(submissionBreakdownRows);
  const categoryColors = {
    "LGU - Region III": "#1677ff",
    "LGU - Outside Region III": "#722ed1",
    "Private Industry": "#52c41a",
    "Baseline Utilization": "#fa8c16",
  };
  const wasteFilledM3 = Number(wasteReceivedData.baselineTotals?.m3 || 0) + Number(wasteReceivedData.totals?.m3 || 0);
  const wasteFilledTons = Number(wasteReceivedData.baselineTotals?.tons || 0) + Number(wasteReceivedData.totals?.tons || 0);
  const formatWasteTotal = () => {
    const parts = [];
    if (wasteFilledM3 > 0) parts.push(`${wasteFilledM3.toLocaleString()} m³`);
    if (wasteFilledTons > 0) parts.push(`${wasteFilledTons.toLocaleString()} tons`);
    return parts.join(" / ") || "0";
  };
  const renderBreakdownChart = (title, data, total) => (
    <Card
      size="small"
      title={<Text strong style={{ fontSize: 13 }}>{title}</Text>}
      loading={wasteReceivedLoading}
      style={{ borderRadius: 8, height: "100%" }}
      bodyStyle={{ height: 250 }}
    >
      {data.length ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3} isAnimationActive={false}>
              {data.map((entry, index) => (
                <RCell key={`${title}-${entry.name}`} fill={categoryColors[entry.name] || statusColors[index % statusColors.length]} />
              ))}
            </Pie>
            <RTooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={total ? "No categorized breakdown" : "No breakdown data yet"} />
      )}
    </Card>
  );

  // The KPI cards are computed from the submissions + baseline + facility fetches.
  // Until those land they would otherwise render a confident "0", which reads as
  // "you have no data" rather than "still loading" — the exact complaint. antd's
  // built-in Card `loading` renders a skeleton in place of the body.
  const kpisLoading = loadingSubmissions || baselineLoading || slfInfoLoading;
  return (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24} md={6}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="My Submissions" value={ownSubmissions.length} valueStyle={{ color: "#1677ff" }} /></Card></Col>
        <Col xs={24} md={6}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Truck Entries" value={ownSubmissions.reduce((sum, item) => sum + Number(item.truckCount || 0), 0)} /></Card></Col>
        <Col xs={24} md={6}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Accredited Haulers" value={haulers.length} /></Card></Col>
        <Col xs={24} md={6}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="My Recorded Volume" value={`${volumeTotals.m3 ? `${volumeTotals.m3.toLocaleString()} m³` : ""}${volumeTotals.m3 && volumeTotals.tons ? " / " : ""}${volumeTotals.tons ? `${volumeTotals.tons.toLocaleString()} tons` : ""}` || "0"} valueStyle={{ fontSize: 16, color: "#52c41a" }} /></Card></Col>
      </Row>
      <Row gutter={[12, 12]}>
        <Col xs={24}>
          <Card
            className="slf-section"
            size="small"
            title={<Space><DashboardOutlined /> <Text strong>SLF Overview</Text></Space>}
            // Facility details come from the SLF facility fetch — skeleton the
            // card rather than showing a grid of blank "—" placeholders.
            loading={slfInfoLoading}
            style={{ borderRadius: 8 }}
            bodyStyle={{ padding: 12, overflowX: "auto" }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(130px, 1fr))", gap: 8, minWidth: 1080 }}>
              {[["Facility", activeSlfName], ["Province", slfInfo?.province], ["Municipality", slfInfo?.municipality || slfInfo?.city], ["Classification", slfInfo?.category || slfInfo?.classification], ["Status", slfInfo?.operationalStatus || slfInfo?.status], ["Ownership", slfInfo?.ownership], ["ECC No.", slfInfo?.eccNo], ["Permit to Operate", slfInfo?.permitToOperate]].map(([label, value]) => (
                <div key={label} style={{ padding: "8px 10px", border: "1px solid #eef2f7", borderRadius: 8, minHeight: 58 }}>
                  <Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</Text>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3353", overflowWrap: "anywhere", lineHeight: 1.25 }}>{value || "Not encoded"}</div>
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card title={<Text strong style={{ fontSize: 14 }}>Landfill Cells</Text>} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ height: 250 }}>
            {cellData.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={cellData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} isAnimationActive={false}>{cellData.map((_, index) => <RCell key={index} fill={index === 0 ? "#52c41a" : "#8c8c8c"} />)}</Pie><RTooltip /><Legend /></PieChart></ResponsiveContainer> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cell data encoded" />}
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card title={<Text strong style={{ fontSize: 14 }}>Waste Received Totals</Text>} loading={wasteReceivedLoading} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ minHeight: 250, display: "flex", alignItems: "center" }}>
            <Row gutter={[12, 14]} style={{ width: "100%" }}>
              <Col xs={24}><Statistic title="Total Waste Filled" value={formatWasteTotal()} valueStyle={{ fontSize: 16, color: "#52c41a" }} /></Col>
              <Col xs={12}><Statistic title="Baseline Categories" value={baselineBreakdownRows.length} valueStyle={{ color: "#1a3353" }} /></Col>
              <Col xs={12}><Statistic title="Submission Groups" value={submissionBreakdownRows.length} valueStyle={{ color: "#fa8c16" }} /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          {renderBreakdownChart("Baseline Breakdown", baselineCategoryData, baselineBreakdownRows.length)}
        </Col>
        <Col xs={24} md={12} xl={6}>
          {renderBreakdownChart("Submission Breakdown", submissionCategoryData, submissionBreakdownRows.length)}
        </Col>
      </Row>
    </div>
  );
}
