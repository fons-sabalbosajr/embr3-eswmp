import { memo, useMemo } from "react";
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
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import { isHazardousWasteType } from "../../utils/wasteCategories";
import { isPermitNotRequired } from "../admin/slf-monitoring/helpers.jsx";
import { VOLUME_METRICS, submittedVolumeOf } from "../../utils/volumeMetrics";

/**
 * One label style for every bar chart on this dashboard, so the on-bar figures
 * read as a set rather than four slightly different treatments. Kept small and
 * mid-grey: dark enough for contrast on a white card, light enough that it does
 * not compete with the axis labels.
 */
const CHART_LABEL_STYLE = { fontSize: 10, fill: "#595959", fontWeight: 600 };

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
  // Held stable: a fresh `[]` on every render would defeat the memo below.
  const ownSubmissions = useMemo(
    () => (Array.isArray(submissions) ? submissions : []),
    [submissions],
  );
  // Global SLF sensitive-value masking. When on, waste volume + cell
  // capacity/fill figures render as the placeholder (counts/statuses stay
  // visible — they are not sensitive). Aggregation is unaffected: masking is a
  // display concern applied only to the formatted output below.
  const { masked } = useSensitiveMask();

  // ── Submission status + organization rollups (from the lean list rows, which
  // already carry status + per-submission cell-placement summary fields) ──
  const isRevertStatus = (s) => /revert/i.test(String(s || ""));
  // ONE pass over the submission list, memoized on the list itself.
  //
  // These rollups used to be five independent traversals running on every
  // render — and this panel re-renders on every socket event, filter change and
  // parent state update, none of which change the submissions. On a facility
  // with a few hundred submissions that is the portal's main stall. The
  // arithmetic is identical; only the number of times it happens changed.
  //
  // Volume reads the DENORMALIZED metrics the model already maintains
  // (computeSlfMetrics keeps totalVolumeM3/Tons and truckCount in sync on save)
  // rather than re-summing every truck in the browser. The history list no
  // longer ships trucks[] at all, and this is the number the admin totals use.
  const {
    statusCounts,
    unorganizedSubs,
    organizedSubs,
    unplacedTransactions,
    volumeTotals,
    truckEntries,
  } = useMemo(() => {
    const counts = { pending: 0, approved: 0, reverted: 0, rejected: 0 };
    let unorganized = 0;
    let unplaced = 0;
    let m3 = 0;
    let tons = 0;
    let trucks = 0;
    for (const r of ownSubmissions) {
      // Deleted / hidden rows are excluded from the STATUS mix only, exactly as
      // before — the volume and organization totals never filtered them out.
      if (!r.deletedAt && !r.hiddenFromPortal) {
        const s = String(r.status || "").toLowerCase();
        if (s === "pending") counts.pending += 1;
        else if (s === "acknowledged" || s === "approved") counts.approved += 1;
        else if (isRevertStatus(s)) counts.reverted += 1;
        else if (s === "rejected") counts.rejected += 1;
      }
      // A submission is "unorganized" if it still has waste awaiting a cell or a
      // missing truck capacity (same rule the organizer uses).
      const rowUnplaced = Number(r.unplacedCount || 0);
      if (rowUnplaced > 0 || Number(r.missingCapacityCount || 0) > 0) unorganized += 1;
      unplaced += rowUnplaced;
      m3 += Number(r.totalVolumeM3 || 0);
      tons += Number(r.totalVolumeTons || 0);
      trucks += Number(r.truckCount || 0);
    }
    return {
      statusCounts: counts,
      unorganizedSubs: unorganized,
      organizedSubs: ownSubmissions.length - unorganized,
      unplacedTransactions: unplaced,
      volumeTotals: { m3, tons },
      truckEntries: trucks,
    };
  }, [ownSubmissions]);
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
  const cellStatusCounts = useMemo(() => {
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
  }, [slfInfo]);

  // ── Chart series for the cards below the KPI row ──
  //
  // ONE memo for the whole derivation, keyed on the three inputs it actually
  // reads. Everything below used to run on EVERY render of this panel: the
  // client identity Map is rebuilt over every baseline + submission client row,
  // the hauler ranking is re-sorted, and both breakdowns are re-bucketed. On
  // Prime Waste Solution (141 accredited haulers) and Floridablanca (80) that is
  // thousands of string builds per render, for data that had not moved.
  //
  // Same reasoning as the submission rollups above — those were already memoized;
  // this block was left behind. The arithmetic is unchanged.
  const {
    submissionBreakdownRows,
    baselineBreakdownRows,
    baselineCategoryData,
    submissionCategoryData,
    haulerCount,
    lguClientCount,
    privateClientCount,
    haulerChartData,
    clientChartData,
    wasteFilledM3,
    wasteFilledTons,
    groupedVolumeData,
    submittedVolume,
  } = useMemo(() => {
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

  // ── Dashboard chart series ──
  // Ranked hauler fleet sizes; a long tail is folded into one "Others" bar so
  // the chart stays readable no matter how many haulers are accredited.
  const haulerChartData = (() => {
    const byName = new Map();
    (haulers || []).forEach((hauler) => {
      const name = String(hauler?.haulerName || "").trim();
      if (!name) return;
      const vehicles = Array.isArray(hauler.vehicles) ? hauler.vehicles.length : 0;
      const declared = Number(hauler.numberOfTrucks || 0);
      byName.set(name, Math.max(byName.get(name) || 0, vehicles, declared, 1));
    });
    const rows = [...byName.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (rows.length <= 8) return rows;
    const others = rows.slice(7).reduce((sum, row) => sum + row.value, 0);
    return [...rows.slice(0, 7), { name: `Others (${rows.length - 7})`, value: others }];
  })();

  const clientChartData = [
    { name: "LGU", value: lguClientCount, color: "#1677ff" },
    { name: "Private", value: privateClientCount, color: "#52c41a" },
  ].filter((row) => row.value > 0);

  const wasteFilledM3 = Number(wasteReceivedData.baselineTotals?.m3 || 0) + Number(wasteReceivedData.totals?.m3 || 0);
  const wasteFilledTons = Number(wasteReceivedData.baselineTotals?.tons || 0) + Number(wasteReceivedData.totals?.tons || 0);
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
  // "Submitted Volume" has ONE meaning in this app: volume recorded through Portal
  // truck submissions (VOLUME_METRICS.submitted). That is exactly what the API's
  // `totals` is — the sum over submissionClients, which are built from each
  // record's trucks[]. `baselineTotals` is the separate declared opening volume.
  //
  // The tile used to show max(0, baselineTotals − submitted), which is neither
  // metric: it is leftover baseline headroom, and it collapses to 0 the moment
  // submissions reach the declared baseline — which is why the tile read as
  // "missing data". It also contradicted the Baseline vs Submitted chart directly
  // below it, which has always plotted the real submitted volume.
  const submittedVolume = submittedVolumeOf(wasteReceivedData, baselineUnit);

  return {
    submissionBreakdownRows,
    baselineBreakdownRows,
    baselineCategoryData,
    submissionCategoryData,
    haulerCount,
    lguClientCount,
    privateClientCount,
    haulerChartData,
    clientChartData,
    wasteFilledM3,
    wasteFilledTons,
    groupedVolumeData,
    submittedVolume,
  };
  }, [wasteReceivedData, haulers, baselineUnit]);

  const categoryColors = {
    "LGU - Region III": "#1677ff",
    "LGU - Outside Region III": "#722ed1",
    "Private Industry": "#52c41a",
    "Baseline Utilization": "#fa8c16",
  };
  // Keyed on the cell counts alone — it is the facility's shape, not the waste
  // aggregation, that moves this donut.
  const cellStatusPieData = useMemo(() => [
    { name: "Active", value: cellStatusCounts.active, color: "#52c41a" },
    { name: "Reserved", value: cellStatusCounts.reserved, color: "#fa8c16" },
    { name: "Used / Completed", value: cellStatusCounts.completed, color: "#8c8c8c" },
    {
      // Whatever the three named buckets did not claim (under construction,
      // unknown legacy statuses) — so the donut always totals the cell count.
      name: "Other",
      value: Math.max(
        0,
        cellStatusCounts.total - cellStatusCounts.active - cellStatusCounts.reserved - cellStatusCounts.completed,
      ),
      color: "#bfbfbf",
    },
  ].filter((row) => row.value > 0), [cellStatusCounts]);

  // #5: show the total in the facility's SINGLE declared baseline unit (m³ and tons
  // are kept in lockstep upstream), with consistent formatting and the unit beside
  // the value — never "m³ / tons" side-by-side. The figures come from the backend
  // aggregation, which now excludes rejected/reverted records.
  //
  // Outside the memo above: these read `masked`, which is a display concern that
  // must re-evaluate when the privacy toggle flips, not when the data changes.
  const formatWasteTotal = () => {
    if (masked) return MASK_PLACEHOLDER;
    const unit = normalizeUnit(baselineUnit);
    const value = unit === "tons" ? wasteFilledTons : wasteFilledM3;
    return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
  };
  const formatUnitValue = (value) => masked ? MASK_PLACEHOLDER : `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${normalizeUnit(baselineUnit)}`;
  const submissionStatusData = [
    { name: "Pending", value: statusCounts.pending, color: "#faad14" },
    { name: "Approved", value: statusCounts.approved, color: "#52c41a" },
    { name: "Reverted", value: statusCounts.reverted, color: "#ff4d4f" },
  ];
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
  /**
   * "Not Required" describes the PERMIT TYPE for this facility, not one
   * reference row. `latestPermit` returns whichever entry has the newest
   * validity, so a facility carrying both a dated legacy row and a
   * "Not Required" marking previously resolved to the dated row and still
   * rendered a New/Complied badge. Checking the flat field AND every array
   * entry is what makes the marking authoritative wherever it was recorded.
   */
  const permitNotRequired = (list, legacyStatus) =>
    isPermitNotRequired(legacyStatus) ||
    (Array.isArray(list) && list.some((item) => isPermitNotRequired(item?.status)));

  /**
   * `hideStatus` blanks the badge area entirely. Two cases need it:
   *
   *   1. the permit is marked "Not Required" — it does not apply here
   *   2. NOTHING is encoded for the permit (no reference number, no validity,
   *      no status). This was the visible bug: with everything empty,
   *      permitStatus() fell through to `statusText || "New / Complied"` and
   *      stamped a confident blue "New / Complied" on a permit that had never
   *      been recorded at all.
   *
   * The surrounding cell still renders, so the grid stays aligned.
   */
  const resolvePermitStatus = (list, permit, legacyValidity, legacyStatus, references) => {
    if (permitNotRequired(list, legacyStatus)) {
      return { label: "Not Required", color: "default", hideStatus: true };
    }
    const hasAnyData =
      (Array.isArray(references) && references.length > 0) ||
      Boolean(legacyValidity) ||
      String(legacyStatus || "").trim() !== "";
    if (!hasAnyData) return { label: "", color: "default", hideStatus: true };

    return permitStatus(
      permit?.validity || legacyValidity,
      permit?.status || legacyStatus,
    );
  };

  /**
   * The city/municipality of the FACILITY ADDRESS.
   *
   * There is no `municipality` or `city` field on SlfFacility, and `lgu` holds
   * the facility's full name ("Aurora - LGU Baler Sanitary Landfill Facility"),
   * which is why this card previously showed the SLF name. The municipality is
   * actually the tail of `barangay`, which is stored "Barangay, Municipality"
   * ("Pingit, Baler" → Baler).
   *
   * Order: a real field if one ever exists → the barangay tail → `lgu` with the
   * province prefix and facility suffix stripped, as a last resort.
   */
  const facilityMunicipality = (() => {
    const explicit = slfInfo?.municipality || slfInfo?.city;
    if (explicit) return explicit;

    const barangay = String(slfInfo?.barangay || "").trim();
    if (barangay.includes(",")) {
      const tail = barangay.split(",").pop().trim();
      if (tail) return tail;
    }

    const lgu = String(slfInfo?.lgu || "").trim();
    if (!lgu) return "";
    return (
      lgu
        // "Aurora - LGU Baler Sanitary Landfill Facility" → "Baler"
        .replace(new RegExp(`^${String(slfInfo?.province || "").trim()}\\s*-\\s*`, "i"), "")
        .replace(/^LGU\s+/i, "")
        .replace(/\s*(sanitary\s+landfill\s+facility|slf)\s*$/i, "")
        .trim() || lgu
    );
  })();

  const formatValidity = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  /**
   * All reference numbers recorded for a permit, each paired with its own
   * validity date. A facility can hold several (renewals, multiple lines), and
   * the flat legacy fields are folded in so nothing recorded before the array
   * existed is dropped.
   */
  const permitReferences = (list, legacyNo, legacyValidity) => {
    const rows = (Array.isArray(list) ? list : [])
      .filter((item) => item?.permitNo || item?.validity)
      .map((item) => ({ permitNo: item.permitNo || "", validity: item.validity || "" }));
    if (!rows.length && (legacyNo || legacyValidity)) {
      rows.push({ permitNo: legacyNo || "", validity: legacyValidity || "" });
    }
    // Newest validity first so the current reference reads first.
    return rows.sort((a, b) => new Date(b.validity || 0) - new Date(a.validity || 0));
  };

  // References are resolved BEFORE the status so `resolvePermitStatus` can see
  // whether anything is encoded at all — that is what distinguishes "no data"
  // (blank badge) from a genuinely current permit.
  const ptoReferences = permitReferences(
    slfInfo?.permitToOperatePermits,
    slfInfo?.permitToOperate,
    slfInfo?.permitToOperateValidity,
  );
  const dpReferences = permitReferences(
    slfInfo?.dischargePermits,
    slfInfo?.dischargePermit,
    slfInfo?.dischargePermitValidity,
  );

  const permitCards = [
    {
      label: "Permit to Operate",
      status: resolvePermitStatus(
        slfInfo?.permitToOperatePermits,
        latestPermit(slfInfo?.permitToOperatePermits),
        slfInfo?.permitToOperateValidity,
        slfInfo?.permitToOperateStatus,
        ptoReferences,
      ),
      references: ptoReferences,
    },
    {
      label: "Discharge Permit",
      status: resolvePermitStatus(
        slfInfo?.dischargePermits,
        latestPermit(slfInfo?.dischargePermits),
        slfInfo?.dischargePermitValidity,
        slfInfo?.dischargePermitStatus,
        dpReferences,
      ),
      references: dpReferences,
    },
  ];
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

  // ── Cell utilization overview (mirrors the ADMIN cell configuration) ──
  // Cells come straight from the logged-in portal user's assigned facility
  // (slfInfo.cell* arrays, configured by the admin in Cell Infrastructure), so no
  // cell names/counts are hardcoded and admin edits flow through live.
  //
  // EVERY declared cell is listed — only cells the admin marked as not existing
  // are skipped. Previously non-operational and submission-closed cells were
  // filtered out entirely, so the Portal showed a different set of cells than the
  // Admin had configured and an operator could not see their Used/Completed or
  // Reserved cells at all. Each cell instead carries its own status band and
  // colour, and cells that cannot receive waste are labelled as such.
  //
  // NB: this is the read-only utilization overview. The placement selectors keep
  // their stricter active-only rule — what you may dispose into is unchanged.
  const cellCount = Math.max(
    Number(slfInfo?.numberOfCell || 0),
    slfInfo?.cellStatuses?.length || 0,
    slfInfo?.cellCapacities?.length || 0,
    slfInfo?.cellFillValues?.length || 0,
    slfInfo?.cellNames?.length || 0,
  );
  // Memoized on the facility record: this walks every encoded cell and does unit
  // conversion per cell, and a site with many cells paid that on every render.
  const cellUtilization = useMemo(() => {
  const rows = [];
  for (let idx = 0; idx < cellCount; idx += 1) {
    const stored = slfInfo?.cellStatuses?.[idx];
    if (isNonExistentCell(stored)) continue;
    // A Used/Completed cell is closed and full — it can never receive waste
    // again, so its utilization bar carries no operational meaning and only
    // crowds out the cells the operator can still dispose into. This panel
    // answers "where can I still put waste", not "what does the whole site look
    // like"; the full inventory lives in Baseline Data / Organize Cells.
    // Reserved / under-construction cells are excluded for the same reason: they
    // exist on paper but cannot take waste today, so they only pad the grid.
    if (/used|completed|closed|reserved|construction/i.test(String(stored || ""))) continue;
    const operational = isOperationalCellStatus(stored);
    const submissionClosed = slfInfo?.cellSubmissionAllowed?.[idx] === false;
    const statusConfig = getCellStatusConfig(stored);
    const typeConfig = getCellTypeConfig(slfInfo?.cellTypes?.[idx]);
    const capUnit = resolveCellUnit(slfInfo, idx, "capacity");
    const fillUnit = resolveCellUnit(slfInfo, idx, "fill");
    const capacity = convertVolume(slfInfo?.cellCapacities?.[idx], capUnit, capUnit) ?? 0;
    const fill = convertVolume(slfInfo?.cellFillValues?.[idx], fillUnit, capUnit) ?? 0;
    const pct = capacity > 0 ? Math.min(100, Math.round((fill / capacity) * 100)) : null;
    const statusLabel = String(stored || statusConfig?.label || "").toLowerCase();
    // Band precedence: what the admin declared about the cell first, then how
    // full it actually is. Each band owns a distinct colour (see BAND_META), so
    // an "Active Cell" and an "In Use" cell never read the same.
    let band;
    if (!operational) {
      if (/complete|used/.test(statusLabel)) band = "completed";
      else if (/reserved|construction/.test(statusLabel)) band = "reserved";
      else band = "outofservice";
    } else if (submissionClosed) {
      band = "closed";
    } else if (pct != null && pct >= 100) {
      band = "full";
    } else if (pct != null && pct >= 85) {
      band = "near";
    } else if (pct != null && pct > 0) {
      band = "inuse";
    } else {
      band = "available";
    }
    rows.push({
      idx,
      name: resolveCellName(slfInfo, idx, slfInfo?.cellNames?.[idx]),
      type: slfInfo?.cellTypes?.[idx] || "Residual",
      typeColor: typeConfig?.color,
      statusColor: statusConfig?.color,
      statusText: statusConfig?.label || stored || "—",
      operational,
      submissionClosed,
      capacity,
      fill,
      unit: capUnit,
      pct,
      band,
    });
  }
  return rows;
  }, [slfInfo, cellCount]);
  const cellBandCounts = useMemo(() => cellUtilization.reduce(
    (acc, c) => {
      if (c.band === "full") acc.full += 1;
      else if (c.band === "near") acc.near += 1;
      else if (c.band === "inuse") acc.inuse += 1;
      else if (c.band === "available") acc.active += 1;
      else acc.unavailable += 1;
      return acc;
    },
    { active: 0, inuse: 0, near: 0, full: 0, unavailable: 0 },
  ), [cellUtilization]);
  // One colour per band — an Active Cell (accepting, still empty) and an In Use
  // cell (accepting, partially filled) are visually distinct, as are the cells
  // that cannot receive waste at all.
  const BAND_META = {
    available: { color: "#52c41a", label: "Active Cell" },
    inuse: { color: "#1677ff", label: "In Use Cell" },
    near: { color: "#fa8c16", label: "Near Capacity" },
    full: { color: "#ff4d4f", label: "Full" },
    closed: { color: "#722ed1", label: "Closed for Submission" },
    reserved: { color: "#faad14", label: "Reserved" },
    completed: { color: "#8c8c8c", label: "Used / Completed" },
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
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Truck Entries" value={truckEntries} valueStyle={{ fontSize: 20 }} /></Card></Col>
        <Col xs={12} md={6} xl={3}><Card size="small" loading={kpisLoading} style={{ borderRadius: 8 }}><Statistic title="Submitted Vol." value={formatUnitValue(submittedVolume)} valueStyle={{ fontSize: 20, color: VOLUME_METRICS.submitted.color }} /></Card></Col>
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
                <Tag color="green">{cellBandCounts.active} active</Tag>
                {cellBandCounts.inuse > 0 && <Tag color="blue">{cellBandCounts.inuse} in use</Tag>}
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
            bodyStyle={{ padding: 12 }}
          >
            {/* Five across on desktop, degrading to 4/3/2 — see .eswmp-grid-5.
                Dropping the old 900px min-width removes the horizontal scroll
                and lets the cards use the full width available. */}
            <div className="eswmp-grid-5">
              {[
                ["Facility", activeSlfName],
                ["Status", slfInfo?.statusOfSLF || slfInfo?.operationalStatus || slfInfo?.status],
                ["Municipality", facilityMunicipality],
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
              {permitCards.map(({ label, status, references }) => (
                <div key={label} style={{ padding: "8px 10px", border: "1px solid #eef2f7", borderRadius: 8, minHeight: 58 }}>
                  <Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</Text>
                  {references.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#1a3353", lineHeight: 1.25 }}>Not encoded</div>
                  ) : (
                    // Each reference number sits beside its OWN validity date, so
                    // multiple permits (renewals, additional lines) stay readable
                    // instead of collapsing to a single number with a detached date.
                    references.map((reference, index) => (
                      <div
                        key={`${reference.permitNo}-${reference.validity}-${index}`}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 8,
                          marginTop: index === 0 ? 1 : 3,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#1a3353", overflowWrap: "anywhere", lineHeight: 1.25 }}>
                          {reference.permitNo || "—"}
                        </span>
                        {reference.validity && (
                          <Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                            valid to {formatValidity(reference.validity)}
                          </Text>
                        )}
                      </div>
                    ))
                  )}
                  {/* A permit marked "Not Required" does not apply to this
                      facility, so no status is shown for it at all — only the
                      recorded information. */}
                  {!status.hideStatus && (
                    <Tag color={status.color} style={{ marginTop: 4, marginInlineEnd: 0 }}>{status.label}</Tag>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6} className="eswmp-col-5">
          {/* Landfill cell status as a donut — proportion is the question here
              ("how much of my capacity is still active?"), which four separate
              numbers could not answer at a glance. */}
          <Card
            title={
              <Space size={6}>
                <Text strong style={{ fontSize: 14 }}>Landfill Cells Infra</Text>
                <Tag color="blue" style={{ margin: 0 }}>{cellStatusCounts.total} cells</Tag>
              </Space>
            }
            loading={slfInfoLoading}
            style={{ borderRadius: 8, height: "100%" }}
            bodyStyle={{ height: 250 }}
          >
            {cellStatusPieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={cellStatusPieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={3}
                    isAnimationActive={false}
                    label={renderPieLabel}
                    labelLine={false}
                  >
                    {cellStatusPieData.map((entry) => (
                      <RCell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <RTooltip formatter={(value, name) => [`${value} cell(s)`, name]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cells configured yet" />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6} className="eswmp-col-5">
          {/* Haulers by fleet size — a ranked bar answers "who moves the most
              waste for us?", which a single total could not. */}
          <Card
            title={
              <Space size={6}>
                <Text strong style={{ fontSize: 14 }}>Accredited Haulers</Text>
                <Tag color="geekblue" style={{ margin: 0 }}>{haulerCount}</Tag>
              </Space>
            }
            // Gated on the BASELINE fetch, which is where `haulers` comes from —
            // not on the waste-received aggregation, which this card never reads.
            // It used to sit in a skeleton behind the slowest request on the page
            // and, if that request failed, fall through to "No accredited haulers
            // recorded" for a fleet that was already loaded.
            loading={baselineLoading}
            style={{ borderRadius: 8, height: "100%" }}
            bodyStyle={{ height: 250 }}
          >
            {haulerChartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={haulerChartData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <RTooltip formatter={(value) => [`${value} vehicle(s)`, "Fleet"]} />
                  {/* Palette blue rather than a loose hex, so the fleet bars match
                      Baseline Volume wherever the two appear together. */}
                  <Bar dataKey="value" name="Vehicles" fill={VOLUME_METRICS.baseline.color} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    <LabelList dataKey="value" position="right" style={CHART_LABEL_STYLE} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No accredited haulers recorded" />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6} className="eswmp-col-5">
          {/* Client mix — LGU vs private, the split operators are asked to report. */}
          <Card
            title={
              <Space size={6}>
                <Text strong style={{ fontSize: 14 }}>Clients Served</Text>
                <Tag color="green" style={{ margin: 0 }}>{lguClientCount + privateClientCount}</Tag>
              </Space>
            }
            loading={wasteReceivedLoading}
            style={{ borderRadius: 8, height: "100%" }}
            bodyStyle={{ height: 250 }}
          >
            {clientChartData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clientChartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <RTooltip formatter={(value) => [`${value} client(s)`, "Clients"]} />
                  <Bar dataKey="value" name="Clients" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {clientChartData.map((entry) => (
                      <RCell key={entry.name} fill={entry.color} />
                    ))}
                    <LabelList dataKey="value" position="top" style={CHART_LABEL_STYLE} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No clients recorded yet" />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6} className="eswmp-col-5">
          <Card title={<Text strong style={{ fontSize: 14 }}>Baseline Breakdown</Text>} loading={wasteReceivedLoading} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={groupedVolumeData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <RTooltip formatter={(value, name) => [formatUnitValue(value), name === "baseline" ? "Baseline Volume" : "Submitted Volume"]} />
                <Legend />
                {/* Volumes are masked for demo sessions, so the label reuses the
                    same formatter as the tooltip instead of printing the raw
                    number — otherwise a masked chart would still leak its value. */}
                <Bar dataKey="baseline" name="Baseline Volume" fill={VOLUME_METRICS.baseline.color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="baseline" position="top" formatter={formatUnitValue} style={CHART_LABEL_STYLE} />
                </Bar>
                <Bar dataKey="submitted" name="Submitted Volume" fill={VOLUME_METRICS.submitted.color} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="submitted" position="top" formatter={formatUnitValue} style={CHART_LABEL_STYLE} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6} className="eswmp-col-5">
          <Card title={<Text strong style={{ fontSize: 14 }}>Submission Breakdown</Text>} loading={loadingSubmissions} style={{ borderRadius: 8, height: "100%" }} bodyStyle={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={submissionStatusData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <RTooltip formatter={(value) => [`${Number(value).toLocaleString()} submission(s)`, "Status"]} />
                <Bar dataKey="value" name="Submissions" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {submissionStatusData.map((entry) => <RCell key={entry.name} fill={entry.color} />)}
                  <LabelList dataKey="value" position="top" style={CHART_LABEL_STYLE} />
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
