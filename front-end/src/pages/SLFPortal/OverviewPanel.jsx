import { memo } from "react";
import {
  Row,
  Col,
  Card,
  Statistic,
  Space,
  Typography,
  Empty,
  Button,
  Progress,
  Tag,
  Tooltip,
} from "antd";
import {
  DashboardOutlined,
  PlusOutlined,
  UnorderedListOutlined,
  ContainerOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  UndoOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { resolveFacilityUnit, normalizeUnit, convertVolume, resolveCellUnit } from "../../utils/volumeUnits";
import { useSensitiveMask, MASK_PLACEHOLDER } from "../../utils/sensitiveMask";
import {
  getCellStatusConfig,
  isNonExistentCell,
  isOperationalCellStatus,
  resolveCellName,
  getCellTypeConfig,
} from "../../utils/cellVisuals";
import {
  PieChart,
  Pie,
  Cell as RCell,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { isHazardousWasteType } from "../../utils/wasteCategories";
import { isPermitNotRequired } from "../admin/slf-monitoring/helpers.jsx";

const { Text } = Typography;

// ── Portal Overview dashboard ──
// Presentational: KPI cards, SLF facility grid, and waste-received breakdown
// charts. All figures are derived here from the container's fetched data,
// which is passed in as props (no state, no handlers of its own).
//
// Memoized: the 8k-line container re-renders on many unrelated state changes,
// but this panel only depends on stable fetched-data props, so it should not
// re-run its chart computations unless that data actually changes.
function OverviewPanel({
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
  // Optional quick-action callbacks — the dashboard hides a button when its
  // handler isn't supplied, so this stays backward-compatible.
  onCreateSubmission,
  onViewSubmissions,
  onOrganizeCells,
  onBulkOrganize,
}) {
  const ownSubmissions = Array.isArray(submissions) ? submissions : [];
  // Global SLF sensitive-value masking. When on, waste volume + cell
  // capacity/fill figures render as the placeholder (counts/statuses stay
  // visible — they are not sensitive). Aggregation is unaffected: masking is a
  // display concern applied only to the formatted output below.
  const { masked } = useSensitiveMask();

  // ── Submission status + organization rollups (from the lean list rows, which
  // already carry status + per-submission cell-placement summary fields) ──
  const isRevertStatus = (s) => /revert/i.test(String(s || ""));
  const statusCounts = ownSubmissions.reduce(
    (acc, r) => {
      if (r.deletedAt || r.hiddenFromPortal) return acc;
      const s = String(r.status || "").toLowerCase();
      if (s === "pending") acc.pending += 1;
      else if (s === "acknowledged") acc.approved += 1;
      else if (s === "approved") acc.approved += 1;
      else if (isRevertStatus(s)) acc.reverted += 1;
      else if (s === "rejected") acc.rejected += 1;
      return acc;
    },
    { pending: 0, approved: 0, reverted: 0, rejected: 0 },
  );
  // A submission is "unorganized" if it still has waste awaiting a cell or a
  // missing truck capacity (same rule the organizer uses).
  const unorganizedSubs = ownSubmissions.filter(
    (r) => Number(r.unplacedCount || 0) > 0 || Number(r.missingCapacityCount || 0) > 0,
  ).length;
  const organizedSubs = ownSubmissions.length - unorganizedSubs;
  const unplacedTransactions = ownSubmissions.reduce(
    (sum, r) => sum + Number(r.unplacedCount || 0),
    0,
  );

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
  // #7: show the recorded volume in the facility's single declared baseline unit,
  // never "m³ / tons" side-by-side. m³ and tons are kept in lockstep upstream.
  const baselineUnit = resolveFacilityUnit(slfInfo);
  const recordedVolume = normalizeUnit(baselineUnit) === "tons" ? volumeTotals.tons : volumeTotals.m3;
  const recordedVolumeLabel = masked
    ? MASK_PLACEHOLDER
    : recordedVolume
      ? `${recordedVolume.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${baselineUnit}`
      : `0 ${baselineUnit}`;
  const statusColors = ["#1677ff", "#52c41a", "#faad14", "#ff4d4f", "#722ed1", "#13c2c2"];
  const cellStatusCounts = (() => {
    const statuses = Array.isArray(slfInfo?.cellStatuses) ? slfInfo.cellStatuses : [];
    const declaredCount = Math.max(
      Number(slfInfo?.numberOfCell || 0),
      statuses.length,
      slfInfo?.cellCapacities?.length || 0,
      slfInfo?.cellNames?.length || 0,
    );
    const counts = { total: 0, active: 0, reserved: 0, completed: 0 };
    for (let index = 0; index < declaredCount; index += 1) {
      const status = statuses[index] || "Active Cell";
      if (isNonExistentCell(status)) continue;
      counts.total += 1;
      if (isOperationalCellStatus(status)) counts.active += 1;
      else if (/reserved/i.test(String(status || ""))) counts.reserved += 1;
      else if (/used|completed|closed/i.test(String(status || ""))) counts.completed += 1;
    }
    return counts;
  })();
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
  const clientIdentityKey = (row = {}) => [
    row.clientName || row.company || "",
    row.clientType || row.companyType || "Private",
    row.region || row.companyRegion || "",
    row.province || row.companyProvince || "",
    row.municipality || row.companyMunicipality || "",
  ].map((value) => String(value || "").trim().toLowerCase()).join("|");
  const combinedClientMap = new Map();
  [...baselineBreakdownRows, ...submissionBreakdownRows].forEach((row) => {
    if (!row || /baseline/i.test(String(row.clientType || row.companyType || ""))) return;
    const key = clientIdentityKey(row);
    if (key.replace(/\|/g, "")) combinedClientMap.set(key, row);
  });
  const combinedClients = Array.from(combinedClientMap.values());
  const haulerCount = new Set(
    (haulers || [])
      .map((hauler) => String(hauler?.haulerName || "").trim().toLowerCase())
      .filter(Boolean),
  ).size;
  const lguClientCount = combinedClients.filter((row) => /lgu/i.test(String(row.clientType || row.companyType || ""))).length;
  const privateClientCount = combinedClients.filter((row) => !/lgu/i.test(String(row.clientType || row.companyType || ""))).length;
  const wasteFilledM3 = Number(wasteReceivedData.baselineTotals?.m3 || 0) + Number(wasteReceivedData.totals?.m3 || 0);
  const wasteFilledTons = Number(wasteReceivedData.baselineTotals?.tons || 0) + Number(wasteReceivedData.totals?.tons || 0);
  // #5: show the total in the facility's SINGLE declared baseline unit (m³ and tons
  // are kept in lockstep upstream), with consistent formatting and the unit beside
  // the value — never "m³ / tons" side-by-side. The figures come from the backend
  // aggregation, which now excludes rejected/reverted records.
  const formatWasteTotal = () => {
    if (masked) return MASK_PLACEHOLDER;
    const unit = normalizeUnit(baselineUnit);
    const value = unit === "tons" ? wasteFilledTons : wasteFilledM3;
    return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
  };
  const rowVolumeForUnit = (row = {}) => {
    const unit = normalizeUnit(baselineUnit);
    return unit === "tons" ? Number(row.totalTons || 0) : Number(row.totalM3 || row.totalVolume || 0);
  };
  const sumByWasteCategory = (rows = []) => rows.reduce(
    (acc, row) => {
      const key = isHazardousWasteType(row.wasteType || row.type || row.clientType) ? "hazardous" : "residual";
      acc[key] += rowVolumeForUnit(row);
      return acc;
    },
    { residual: 0, hazardous: 0 },
  );
  const baselineVolumes = sumByWasteCategory(wasteReceivedData.baselineCellBreakdown || []);
  const submittedVolumes = sumByWasteCategory(submissionBreakdownRows);
  const groupedVolumeData = [
    { category: "Residual", baseline: baselineVolumes.residual, submitted: submittedVolumes.residual },
    { category: "Hazardous", baseline: baselineVolumes.hazardous, submitted: submittedVolumes.hazardous },
  ];
  const submissionStatusData = [
    { name: "Pending", value: statusCounts.pending, color: "#faad14" },
    { name: "Approved", value: statusCounts.approved, color: "#52c41a" },
    { name: "Reverted", value: statusCounts.reverted, color: "#ff4d4f" },
  ];
  const recordedSubmissionVolume = normalizeUnit(baselineUnit) === "tons" ? Number(wasteReceivedData.totals?.tons || 0) : Number(wasteReceivedData.totals?.m3 || 0);
  const netRecordedVolume = Math.max(0, (normalizeUnit(baselineUnit) === "tons" ? Number(wasteReceivedData.baselineTotals?.tons || 0) : Number(wasteReceivedData.baselineTotals?.m3 || 0)) - recordedSubmissionVolume);
  const formatUnitValue = (value) => masked ? MASK_PLACEHOLDER : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${normalizeUnit(baselineUnit)}`;
  const latestPermit = (items = [], numberField = "permitNo") => {
    const list = (Array.isArray(items) ? items : []).filter((item) => item?.[numberField] || item?.validity || item?.status);
    return list.sort((a, b) => new Date(b.validity || 0) - new Date(a.validity || 0))[0] || null;
  };
  const permitStatus = (validity, statusText) => {
    // A permit marked "Not Required" does not apply to this facility, so none of the
    // validity states below are meaningful for it. Previously it fell through to the
    // `!validity` branch and rendered whatever text was stored — or, once a stale
    // date existed, an alarming red "Expired" tag for a permit that was never needed.
    // Show a neutral, explicitly non-status indicator instead.
    if (isPermitNotRequired(statusText)) {
      return { label: "Not Required", color: "default", notRequired: true };
    }
    if (!validity) return { label: statusText || "New / Complied", color: "blue" };
    const expiry = new Date(validity);
    if (Number.isNaN(expiry.getTime())) return { label: statusText || "New / Complied", color: "blue" };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((expiry - today) / 86400000);
    if (days < 0) return { label: "Expired", color: "red" };
    if (days <= 30) return { label: "Expiring Within 30 Days", color: "orange" };
    if (/renew/i.test(String(statusText || ""))) return { label: "Renewed", color: "green" };
    return { label: "New / Complied", color: "blue" };
  };
  const ptoPermit = latestPermit(slfInfo?.permitToOperatePermits);
  const dpPermit = latestPermit(slfInfo?.dischargePermits);
  const ptoStatus = permitStatus(ptoPermit?.validity || slfInfo?.permitToOperateValidity, ptoPermit?.status || slfInfo?.permitToOperateStatus);
  const dpStatus = permitStatus(dpPermit?.validity || slfInfo?.dischargePermitValidity, dpPermit?.status || slfInfo?.dischargePermitStatus);
  // #4: on-slice label with count + percentage; tiny slices are left unlabeled to
  // avoid overlap (the tooltip still shows their full value).
  const renderPieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, value }) => {
    if (!percent || percent < 0.06) return null;
    const RAD = Math.PI / 180;
    const r = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + r * Math.cos(-midAngle * RAD);
    const y = cy + r * Math.sin(-midAngle * RAD);
    return (
      <text x={x} y={y} fill="#fff" fontSize={11} fontWeight={600} textAnchor="middle" dominantBaseline="central">
        {`${value} (${Math.round(percent * 100)}%)`}
      </text>
    );
  };
  const pieTooltipFormatter = (value, name) => [`${Number(value).toLocaleString()}`, name];
  const renderBreakdownChart = (title, data, total) => {
    // Hide zero-value segments so they never render an empty slice or label.
    const chartData = (data || []).filter((d) => Number(d.value || 0) > 0);
    return (
      <Card
        size="small"
        title={<Text strong style={{ fontSize: 13 }}>{title}</Text>}
        loading={wasteReceivedLoading}
        style={{ borderRadius: 8, height: "100%" }}
        bodyStyle={{ height: 250 }}
      >
        {chartData.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={48}
                outerRadius={78}
                paddingAngle={3}
                isAnimationActive={false}
                label={renderPieLabel}
                labelLine={false}
              >
                {chartData.map((entry, index) => (
                  <RCell key={`${title}-${entry.name}`} fill={categoryColors[entry.name] || statusColors[index % statusColors.length]} />
                ))}
              </Pie>
              <RTooltip formatter={pieTooltipFormatter} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={total ? "No categorized breakdown" : "No breakdown data yet"} />
        )}
      </Card>
    );
  };

  // ── Cell utilization overview (active submission-enabled baseline cells only) ──
  // Cells come straight from the logged-in portal user's assigned facility
  // baseline (slfInfo.cell* arrays, editable under Data Entry → Baseline Data),
  // so no cell names/counts are hardcoded and Baseline Data edits flow through
  // live. Only cells whose status is ACTIVE/operational and whose admin-side
  // submission toggle is enabled are shown — inactive, closed, completed,
  // reserved, under-construction, non-existent and submission-closed cells are
  // excluded (the same active-cell rule as the placement selectors).
  const cellCount = Math.max(
    Number(slfInfo?.numberOfCell || 0),
    slfInfo?.cellStatuses?.length || 0,
    slfInfo?.cellCapacities?.length || 0,
    slfInfo?.cellFillValues?.length || 0,
    slfInfo?.cellNames?.length || 0,
  );
  const cellUtilization = [];
  for (let idx = 0; idx < cellCount; idx += 1) {
    const stored = slfInfo?.cellStatuses?.[idx];
    if (isNonExistentCell(stored)) continue;
    // Active-only: drop any cell that is not currently operational or is closed
    // for portal submissions in Admin Cell Infrastructure.
    if (!isOperationalCellStatus(stored)) continue;
    if (slfInfo?.cellSubmissionAllowed?.[idx] === false) continue;
    const statusConfig = getCellStatusConfig(stored);
    const typeConfig = getCellTypeConfig(slfInfo?.cellTypes?.[idx]);
    const capUnit = resolveCellUnit(slfInfo, idx, "capacity");
    const fillUnit = resolveCellUnit(slfInfo, idx, "fill");
    const capacity = convertVolume(slfInfo?.cellCapacities?.[idx], capUnit, capUnit) ?? 0;
    const fill = convertVolume(slfInfo?.cellFillValues?.[idx], fillUnit, capUnit) ?? 0;
    const pct = capacity > 0 ? Math.min(100, Math.round((fill / capacity) * 100)) : null;
    const statusLabel = String(stored || statusConfig?.label || "").toLowerCase();
    const nonOperational = /used|complete|closed|inactive|out.?of.?service|decommission|reserved/i.test(statusLabel);
    let band = "available";
    if (nonOperational) band = statusLabel.includes("complete") || statusLabel.includes("used") ? "completed" : "outofservice";
    else if (pct != null && pct >= 100) band = "full";
    else if (pct != null && pct >= 85) band = "near";
    else if (pct != null && pct > 0) band = "inuse";
    cellUtilization.push({
      idx,
      name: resolveCellName(slfInfo, idx, slfInfo?.cellNames?.[idx]),
      type: slfInfo?.cellTypes?.[idx] || "Residual",
      typeColor: typeConfig?.color,
      statusColor: statusConfig?.color,
      statusText: statusConfig?.label || stored || "—",
      capacity,
      fill,
      unit: capUnit,
      pct,
      band,
    });
  }
  const cellBandCounts = cellUtilization.reduce(
    (acc, c) => {
      if (c.band === "full") acc.full += 1;
      else if (c.band === "near") acc.near += 1;
      else if (c.band === "completed" || c.band === "outofservice") acc.unavailable += 1;
      else acc.active += 1;
      return acc;
    },
    { active: 0, near: 0, full: 0, unavailable: 0 },
  );
  const BAND_META = {
    available: { color: "#52c41a", label: "Available" },
    inuse: { color: "#1677ff", label: "In Use" },
    near: { color: "#fa8c16", label: "Near Capacity" },
    full: { color: "#ff4d4f", label: "Full" },
    completed: { color: "#8c8c8c", label: "Completed" },
    outofservice: { color: "#8c8c8c", label: "Out of Service" },
  };

  // Quick actions — each rendered only when its handler is provided.
  const quickActions = [
    onCreateSubmission && { key: "create", icon: <PlusOutlined />, label: "Create Submission", onClick: onCreateSubmission, type: "primary" },
    onViewSubmissions && { key: "view", icon: <UnorderedListOutlined />, label: "View My Submissions", onClick: onViewSubmissions },
    onOrganizeCells && { key: "organize", icon: <ContainerOutlined />, label: "Organize Cells", onClick: onOrganizeCells },
    onBulkOrganize && { key: "bulk", icon: <ThunderboltOutlined />, label: "Bulk Organize", onClick: onBulkOrganize },
  ].filter(Boolean);

  // The KPI cards are computed from the submissions + baseline + facility fetches.
  // Until those land they would otherwise render a confident "0", which reads as
  // "you have no data" rather than "still loading" — the exact complaint. antd's
  // built-in Card `loading` renders a skeleton in place of the body.
  const kpisLoading = loadingSubmissions || baselineLoading || slfInfoLoading;
  return (
    <div style={{ maxWidth: 1680, margin: "0 auto" }}>
      {/* Quick actions — common portal tasks, one click away. */}
      {quickActions.length > 0 && (
        <Space wrap style={{ marginBottom: 12 }}>
          {quickActions.map((a) => (
            <Button key={a.key} type={a.type || "default"} icon={a.icon} onClick={a.onClick}>
              {a.label}
            </Button>
          ))}
        </Space>
      )}

      {/* Summary tiles — submissions, status mix, organization, volume. */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Total Submissions" value={ownSubmissions.length} valueStyle={{ color: "#1677ff", fontSize: 20 }} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Pending" value={statusCounts.pending} prefix={<ClockCircleOutlined />} valueStyle={{ color: "#faad14", fontSize: 20 }} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Approved" value={statusCounts.approved} prefix={<CheckCircleOutlined />} valueStyle={{ color: "#52c41a", fontSize: 20 }} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Reverted" value={statusCounts.reverted} prefix={<UndoOutlined />} valueStyle={{ color: "#ff4d4f", fontSize: 20 }} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Organized" value={organizedSubs} valueStyle={{ color: "#52c41a", fontSize: 20 }} /></Card></Col>
        <Col xs={12} md={6} xl={3}>
          <Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}>
            <Statistic
              title={<Tooltip title="Submissions with waste still awaiting a cell or a missing truck capacity">Unorganized</Tooltip>}
              value={unorganizedSubs}
              valueStyle={{ color: unorganizedSubs ? "#fa8c16" : "#8c8c8c", fontSize: 20 }}
              suffix={unplacedTransactions ? <Text type="secondary" style={{ fontSize: 11 }}>({unplacedTransactions} txns)</Text> : null}
            />
          </Card>
        </Col>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Truck Entries" value={ownSubmissions.reduce((sum, item) => sum + Number(item.truckCount || 0), 0)} valueStyle={{ fontSize: 20 }} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Submitted Vol." value={formatUnitValue(netRecordedVolume)} valueStyle={{ fontSize: 20, color: "#52c41a" }} /></Card></Col>
      </Row>

      {/* Cell utilization overview — capacity, band, and status per open cell. */}
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={24}>
          <Card
            size="small"
            className="slf-section"
            title={
              <Space wrap>
                <ContainerOutlined /> <Text strong>Cell Utilization</Text>
                <Tag color="green">{cellBandCounts.active} available</Tag>
                {cellBandCounts.near > 0 && <Tag color="orange">{cellBandCounts.near} near capacity</Tag>}
                {cellBandCounts.full > 0 && <Tag color="red">{cellBandCounts.full} full</Tag>}
                {cellBandCounts.unavailable > 0 && <Tag>{cellBandCounts.unavailable} unavailable</Tag>}
              </Space>
            }
            loading={slfInfoLoading}
            style={{ borderRadius: 8 }}
            styles={{ body: { padding: 12 } }}
          >
            {cellUtilization.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  cellCount > 0
                    ? "No active submission-enabled cells in Baseline Data. Set a cell's status to Active and allow submissions to see it here."
                    : "No cells encoded in Baseline Data yet."
                }
              />
            ) : (
              <Row gutter={[10, 10]}>
                {cellUtilization.map((c) => {
                  const meta = BAND_META[c.band] || BAND_META.available;
                  return (
                    <Col key={c.idx} xs={24} sm={12} md={8} xl={6}>
                      <div style={{ padding: "10px 12px", border: "1px solid #eef2f7", borderRadius: 8, height: "100%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <Text strong style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <Tooltip title={c.name}>{c.name}</Tooltip>
                          </Text>
                          <Tag color={meta.color === "#8c8c8c" ? "default" : undefined} style={meta.color === "#8c8c8c" ? {} : { color: "#fff", background: meta.color, border: "none" }}>
                            {meta.label}
                          </Tag>
                        </div>
                        <Space size={4} wrap style={{ marginBottom: 6 }}>
                          <Tag color={c.typeColor || "blue"} style={{ margin: 0, fontSize: 10 }}>{c.type}</Tag>
                          <Text type="secondary" style={{ fontSize: 10 }}>{c.statusText}</Text>
                        </Space>
                        <Progress
                          percent={c.pct == null ? 0 : c.pct}
                          size="small"
                          status={c.band === "full" ? "exception" : c.band === "near" ? "active" : "normal"}
                          strokeColor={meta.color}
                          format={() => (masked ? MASK_PLACEHOLDER : c.pct == null ? "—" : `${c.pct}%`)}
                        />
                        <Text type="secondary" style={{ fontSize: 10 }}>
                          {masked
                            ? MASK_PLACEHOLDER
                            : c.capacity > 0
                              ? `${Number(c.fill).toLocaleString(undefined, { maximumFractionDigits: 1 })} / ${Number(c.capacity).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${c.unit}`
                              : "Capacity not encoded"}
                        </Text>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24}>
          <Card
            className="slf-section"
            size="small"
            title={<Space><DashboardOutlined /> <Text strong>SLF Overview</Text></Space>}
            loading={slfInfoLoading}
            style={{ borderRadius: 8 }}
            bodyStyle={{ padding: 12, overflowX: "auto" }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(180px, 1fr))", gap: 8, minWidth: 900 }}>
              {[
                ["Facility", activeSlfName],
                ["Status", slfInfo?.statusOfSLF || slfInfo?.operationalStatus || slfInfo?.status],
                ["Municipality", slfInfo?.municipality || slfInfo?.city || slfInfo?.lgu],
                ["Province", slfInfo?.province],
                ["Region", slfInfo?.region || slfInfo?.regionName || "Region III"],
                ["ECC", slfInfo?.eccNo],
                ["Hazardous Waste Generator ID", slfInfo?.hazwasteGenerationId],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: "8px 10px", border: "1px solid #eef2f7", borderRadius: 8, minHeight: 58 }}>
                  <Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</Text>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3353", overflowWrap: "anywhere", lineHeight: 1.25 }}>{value || "Not encoded"}</div>
                </div>
              ))}
              {[
                ["Permit to Operate", ptoPermit?.permitNo || slfInfo?.permitToOperate, ptoStatus],
                ["Discharge Permit", dpPermit?.permitNo || slfInfo?.dischargePermit, dpStatus],
              ].map(([label, value, meta]) => (
                <div key={label} style={{ padding: "8px 10px", border: "1px solid #eef2f7", borderRadius: 8, minHeight: 58 }}>
                  <Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</Text>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3353", overflowWrap: "anywhere", lineHeight: 1.25 }}>{value || "Not encoded"}</div>
                  <Tag color={meta.color} style={{ marginTop: 4, marginInlineEnd: 0 }}>{meta.label}</Tag>
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card title={<Text strong style={{ fontSize: 14 }}>Landfill Cells Status</Text>} loading={slfInfoLoading} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ minHeight: 250 }}>
            <Row gutter={[12, 16]}>
              <Col span={12}><Statistic title="Total Cells" value={cellStatusCounts.total} valueStyle={{ color: "#1a3353" }} /></Col>
              <Col span={12}><Statistic title="Active" value={cellStatusCounts.active} valueStyle={{ color: "#52c41a" }} /></Col>
              <Col span={12}><Statistic title="Reserved" value={cellStatusCounts.reserved} valueStyle={{ color: "#fa8c16" }} /></Col>
              <Col span={12}><Statistic title="Used / Completed" value={cellStatusCounts.completed} valueStyle={{ color: "#8c8c8c" }} /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card title={<Text strong style={{ fontSize: 14 }}>Haulers and Clients</Text>} loading={wasteReceivedLoading} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ minHeight: 250, display: "flex", alignItems: "center" }}>
            <Row gutter={[12, 14]} style={{ width: "100%" }}>
              <Col xs={24}><Statistic title="Total Accredited Haulers" value={haulerCount} valueStyle={{ fontSize: 18, color: "#1a3353" }} /></Col>
              <Col xs={12}><Statistic title="LGU Clients" value={lguClientCount} valueStyle={{ color: "#1677ff" }} /></Col>
              <Col xs={12}><Statistic title="Private Clients" value={privateClientCount} valueStyle={{ color: "#52c41a" }} /></Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card title={<Text strong style={{ fontSize: 14 }}>Baseline Breakdown</Text>} loading={wasteReceivedLoading} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={groupedVolumeData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RTooltip formatter={(value, name) => [formatUnitValue(value), name === "baseline" ? "Baseline Volume" : "Submitted Volume"]} />
                <Legend />
                <Bar dataKey="baseline" name="Baseline Volume" fill="#1677ff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="submitted" name="Submitted Volume" fill="#52c41a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card title={<Text strong style={{ fontSize: 14 }}>Submission Breakdown</Text>} loading={loadingSubmissions} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={submissionStatusData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <RTooltip formatter={(value) => [`${Number(value).toLocaleString()} submission(s)`, "Status"]} />
                <Bar dataKey="value" name="Submissions" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {submissionStatusData.map((entry) => <RCell key={entry.name} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default memo(OverviewPanel);
