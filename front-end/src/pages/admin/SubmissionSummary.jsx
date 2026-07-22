import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CalendarOutlined,
  ReloadOutlined,
  SearchOutlined,
  FilePdfOutlined,
  BankOutlined,
  InboxOutlined,
  CarOutlined,
  DownloadOutlined,
  ExperimentOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import GaugeMeter, { computeGaugePercent } from "../../components/GaugeMeter";
// FullCalendar is heavy; load it only when the disposal calendar modal opens.
const SummaryDisposalCalendar = lazy(() => import("./SummaryDisposalCalendar"));
const SlfSubmissionReport = lazy(() => import("./SlfSubmissionReport"));
import api from "../../api";
import CellInfraOverview from "./CellInfraOverview";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import excludeDummy from "../../utils/excludeDummy";
import { convertVolume } from "../../utils/volumeUnits";

const { Text } = Typography;
const ACCENT = "#2f54eb";
// Stable empty array — a fresh [] would give every dependent memo a new identity.
const EMPTY_ROWS = [];

const SUMMARY_CACHE_KEY = "submission-summary-cache";
const SUMMARY_CACHE_TTL = 10 * 60 * 1000;

const normalizeUnit = (unit) => (unit || "m³").replace("m3", "m³");
const normalizeKey = (value) => String(value || "")
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
const isActiveCellStatus = (status) => /active|operational|open|current/i.test(String(status || "Active"));


const statusColor = {
  pending: "gold",
  acknowledged: "green",
  rejected: "red",
  reverted: "volcano",
  revert_requested: "orange",
};

// Format a numeric volume to a maximum of 2 decimal places. Safely handles
// null/undefined/strings/NaN — returns null so the caller can skip it.
function formatVolumeValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Display a volume in the SINGLE declared baseline unit (#7: one unit everywhere,
// never "m³ / tons" side-by-side). The m³ and tons figures are kept in lockstep
// upstream (the 0.2 factor), so we simply pick the one matching the baseline unit.
function formatVolume(m3, tons, unit = "m³") {
  const u = normalizeUnit(unit);
  const value = u === "tons" ? tons : m3;
  const v = formatVolumeValue(value);
  return v ? `${v} ${u}` : "—";
}

// Safe volume formatter for summary metrics: shows a real "0" when the value is
// a valid number that happens to be empty, and "N/A" only when the metric is
// genuinely unavailable (null / undefined / NaN). Never does arithmetic on the
// raw input — it only coerces once and checks finiteness.
function formatVolumeSafe(m3, tons, unit = "m³") {
  const u = normalizeUnit(unit);
  const value = u === "tons" ? tons : m3;
  if (value == null) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${u}`;
}

function addNameVariant(map, name, value) {
  const key = normalizeKey(name);
  if (key && !map.has(key)) map.set(key, value);
  const firstCommaPart = String(name || "").split(",")[0]?.trim();
  const shortKey = normalizeKey(firstCommaPart);
  if (shortKey && !map.has(shortKey)) map.set(shortKey, value);
}

function getTruckTotals(records) {
  return records.reduce((acc, record) => {
    (record.trucks || []).forEach((truck) => {
      const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
      if (unit === "tons") acc.tons += Number(truck.actualVolume || 0);
      else acc.m3 += Number(truck.actualVolume || 0);
    });
    return acc;
  }, { m3: 0, tons: 0 });
}

function buildBaselineTotals(baseline) {
  const totals = { m3: 0, tons: 0 };
  if (!baseline) return totals;
  const add = (value, unit) => {
    const normalized = normalizeUnit(unit || baseline.baselineUnit || "m³");
    if (normalized === "tons") totals.tons += Number(value || 0);
    else totals.m3 += Number(value || 0);
  };
  (baseline.activeCellEntries || []).forEach((entry) => add(entry.volume, entry.unit));
  if (!(baseline.activeCellEntries || []).length) {
    add(baseline.activeCellResidualVolume, baseline.activeCellResidualUnit);
    add(baseline.activeCellInertVolume, baseline.activeCellInertUnit);
    add(baseline.activeCellHazardousVolume, baseline.activeCellHazardousUnit);
  }
  return totals;
}

function buildCellStatusRows(summary, throughDate, settings = {}) {
  const facility = summary.facility;
  const baseline = summary.baseline;
  const cellCount = Math.max(
    facility?.numberOfCells || 0,
    facility?.cellCapacities?.length || 0,
    baseline?.activeCellEntries?.length || 0,
    1,
  );
  const statuses = facility?.cellStatuses || [];
  const capacities = facility?.cellCapacities || [];
  const capacityUnits = facility?.cellCapacityUnits || [];
  const fillValues = facility?.cellFillValues || [];
  const fillUnits = facility?.cellFillUnits || [];
  const cellNames = facility?.cellNames || [];
  const baselineDate = baseline?.lastUpdated || baseline?.createdAt;
  const cumulativeRecords = summary.records.filter((record) => {
    if (!record.dateOfDisposal) return false;
    const withinDate = dayjs(record.dateOfDisposal).startOf("day").valueOf() <= dayjs(throughDate).startOf("day").valueOf();
    if (!withinDate) return false;
    if (!settings.excludePreBaselineDisposalFromCellFill || !baselineDate) return true;
    const disposalBeforeBaseline = dayjs(record.dateOfDisposal).startOf("day").isBefore(dayjs(baselineDate).startOf("day"));
    const submittedAfterBaseline = record.createdAt && dayjs(record.createdAt).isAfter(dayjs(baselineDate));
    return !disposalBeforeBaseline || submittedAfterBaseline;
  });
  const cumulative = getTruckTotals(cumulativeRecords);

  return Array.from({ length: cellCount }).map((_, index) => {
    const status = statuses[index] || (index === 0 ? "Active" : "Available");
    const capacity = Number(capacities[index] || 0);
    const unit = normalizeUnit(capacityUnits[index] || fillUnits[index] || baseline?.baselineUnit || "m³");
    const baselineEntries = baseline?.activeCellEntries || [];
    const baselineForCell = baselineEntries[index]
      ? convertVolume(baselineEntries[index].volume, baselineEntries[index].unit, unit)
      : index === 0
        ? convertVolume(buildBaselineTotals(baseline).m3, "m³", unit) + convertVolume(buildBaselineTotals(baseline).tons, "tons", unit)
        : 0;
    const submissionForCell = isActiveCellStatus(status)
      ? convertVolume(cumulative.m3, "m³", unit) + convertVolume(cumulative.tons, "tons", unit)
      : 0;
    const encodedFill = convertVolume(fillValues[index] || 0, fillUnits[index] || unit, unit);
    const used = Math.max(encodedFill, baselineForCell + submissionForCell);
    const pct = capacity > 0 ? Math.min(Math.round((used / capacity) * 100), 100) : null;
    return {
      key: index,
      cell: String(cellNames[index] || "").trim() || `Cell ${index + 1}`,
      status,
      used,
      capacity,
      remaining: capacity > 0 ? Math.max(0, capacity - used) : null,
      unit,
      pct,
      isActive: isActiveCellStatus(status),
    };
  });
}

// Inject keyframes/animations once for the redesigned summary tiles.
const SUMMARY_TILE_STYLE_ID = "submission-summary-tile-styles";
function ensureSummaryTileStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(SUMMARY_TILE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SUMMARY_TILE_STYLE_ID;
  style.innerHTML = `
    @keyframes summaryTileIn {
      from { opacity: 0; transform: translateY(10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes summaryIconPulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.12); }
    }
    .summary-tile {
      border-radius: 12px;
      overflow: hidden;
      position: relative;
      animation: summaryTileIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
      transition: transform 0.25s ease, box-shadow 0.25s ease;
      will-change: transform;
    }
    .summary-tile:hover {
      transform: translateY(-4px);
      box-shadow: 0 10px 24px rgba(0,0,0,0.12);
    }
    .summary-tile:hover .summary-tile-icon {
      animation: summaryIconPulse 0.9s ease-in-out infinite;
    }
    .summary-tile-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      font-size: 20px;
      flex-shrink: 0;
      transition: transform 0.25s ease;
    }
    .summary-tile-accent {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
    }
  `;
  document.head.appendChild(style);
}

// Smoothly animates an integer value from 0 → target on mount/update.
function CountUp({ value = 0, duration = 900, style }) {
  const [display, setDisplay] = useState(0);
  const target = Number(value) || 0;
  useEffect(() => {
    let raf;
    const start = performance.now();
    const from = 0;
    const animate = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return <span style={style}>{display.toLocaleString()}</span>;
}

// Compact metric used inside grouped summary cards (no card chrome of its own,
// so several sit cleanly within one grouped Card).
function MiniStat({ icon, color, label, children, subtitle }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span
        className="summary-tile-icon"
        style={{ background: `${color}1f`, color, flexShrink: 0 }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <Text
          type="secondary"
          style={{ fontSize: 12, display: "block", lineHeight: 1.2 }}
        >
          {label}
        </Text>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color,
            lineHeight: 1.25,
            marginTop: 2,
            wordBreak: "break-word",
          }}
        >
          {children}
        </div>
        {subtitle && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {subtitle}
          </Text>
        )}
      </div>
    </div>
  );
}

export default function SubmissionSummary({ isDark }) {
  const [tiles, setTiles] = useState(null);
  const [slfRows, setSlfRows] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [baselines, setBaselines] = useState([]);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [refLoading, setRefLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarRecord, setCalendarRecord] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarDate, setCalendarDate] = useState(dayjs());
  // Item #2: Daily Submission Details modal (opens when a calendar date is clicked).
  const [dailyOpen, setDailyOpen] = useState(false);
  // #4: disposal-calendar export — a custom date range, or "Export All" from the
  // first recorded submission.
  const [exportRange, setExportRange] = useState(null);
  const [portalUsers, setPortalUsers] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);

  // Item #4: admin → portal-user direct message (from the SLF Submissions
  // Breakdown "Message User" action).
  const [msgModal, setMsgModal] = useState({ open: false, row: null });
  const [msgText, setMsgText] = useState("");
  const [msgSending, setMsgSending] = useState(false);

  const openMessageUser = (row) => {
    setMsgText("");
    setMsgModal({ open: true, row });
  };

  const sendPortalMessage = async () => {
    const text = msgText.trim();
    if (!text) {
      Modal.error({ title: "Message required", content: "Please enter a message before sending." });
      return;
    }
    const row = msgModal.row || {};
    const slfGenerator =
      row.slfGenerator && typeof row.slfGenerator === "object" ? row.slfGenerator._id : row.slfGenerator;
    setMsgSending(true);
    try {
      const { data } = await api.post("/portal-messages", {
        slfGenerator: slfGenerator || undefined,
        slfName: row.slfName || undefined,
        message: text,
      });
      setMsgModal({ open: false, row: null });
      setMsgText("");
      Modal.success({
        title: "Message Sent",
        content: `Your message was delivered to ${data?.count || 1} portal user${(data?.count || 1) === 1 ? "" : "s"} assigned to ${row.slfName || "this SLF"}.`,
      });
    } catch (err) {
      Modal.error({
        title: "Could Not Send Message",
        content: err.response?.data?.message || "Something went wrong while sending the message.",
      });
    } finally {
      setMsgSending(false);
    }
  };

  useEffect(() => {
    ensureSummaryTileStyles();
  }, []);

  // Page-exit cleanup. Both fetches below are background SWR chains that can still
  // be in flight when the admin navigates away — `aliveRef` stops them re-seating a
  // large payload (the baselines response alone is ~440 KB) into an unmounted
  // component, and the state is dropped here so it is released immediately rather
  // than staying reachable from the pending closures.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      setSlfRows(EMPTY_ROWS);
      setFacilities(EMPTY_ROWS);
      setBaselines(EMPTY_ROWS);
      setPortalUsers(EMPTY_ROWS);
      setCalendarRecord(null);
      setTiles(null);
    };
  }, []);

  const fetchRecords = useCallback(async ({ force = false, silent = false } = {}) => {
    await fetchWithCache(
      SUMMARY_CACHE_KEY,
      async () => {
        const [tilesRes, rowsRes] = await Promise.all([
          api.get("/data-slf/summary-tiles"),
          api.get("/data-slf/summary-by-slf"),
        ]);
        return {
          tiles: tilesRes.data || null,
          rows: Array.isArray(rowsRes.data) ? rowsRes.data : [],
        };
      },
      {
        ttl: SUMMARY_CACHE_TTL,
        force,
        onStart: () => !silent && setLoading(true),
        onEnd: () => !silent && setLoading(false),
        onData: (payload = {}) => {
          if (!aliveRef.current) return; // navigated away — don't re-seat data
          setTiles(payload.tiles || null);
          setSlfRows(payload.rows || []);
          setLoading(false);
        },
        onError: () => {
          if (!silent && aliveRef.current) {
            setTiles(null);
            setSlfRows([]);
          }
        },
      },
    );
  }, []);

  // Facility/baseline/settings reference data is only needed for the calendar
  // modal — load it separately so the tiles + table render immediately.
  const fetchReferenceData = useCallback(async ({ force = false } = {}) => {
    await fetchWithCache(
      `${SUMMARY_CACHE_KEY}:ref`,
      async () => {
        const [facilitiesRes, baselinesRes, settingsRes, portalUsersRes] = await Promise.all([
          api.get("/slf-facilities"),
          api.get("/data-slf/baselines"),
          api.get("/settings/app"),
          api.get("/portal-users").catch(() => ({ data: [] })),
        ]);
        // Defensive: keep dummy/test facilities and accounts out of the summary
        // (backend already excludes them from these endpoints by default).
        return {
          facilities: excludeDummy(Array.isArray(facilitiesRes.data) ? facilitiesRes.data : []),
          baselines: Array.isArray(baselinesRes.data) ? baselinesRes.data : [],
          settings: settingsRes.data || {},
          portalUsers: excludeDummy(Array.isArray(portalUsersRes.data) ? portalUsersRes.data : []),
        };
      },
      {
        ttl: SUMMARY_CACHE_TTL,
        force,
        // Cell Infra Overview renders from this reference data, so it needs to
        // know when the facilities are still in flight (it shows skeletons).
        onStart: () => setRefLoading(true),
        onEnd: () => setRefLoading(false),
        onData: (payload = {}) => {
          if (!aliveRef.current) return; // navigated away — don't re-seat data
          setFacilities(payload.facilities || []);
          setBaselines(payload.baselines || []);
          setSettings(payload.settings || {});
          setPortalUsers(payload.portalUsers || []);
          setRefLoading(false);
        },
        onError: () => setRefLoading(false),
      },
    );
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchReferenceData();
  }, [fetchRecords, fetchReferenceData]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      if (!target || ["submissions", "baselines"].includes(target)) {
        invalidateCache(SUMMARY_CACHE_KEY);
        fetchRecords({ force: true, silent: true });
        fetchReferenceData({ force: true });
      }
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [fetchRecords, fetchReferenceData]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return slfRows.filter((row) => {
      const statusMatch =
        statusFilter === "all" || (row.statuses?.[statusFilter] || 0) > 0;
      if (!statusMatch) return false;
      if (!needle) return true;
      return String(row.slfName || "").toLowerCase().includes(needle);
    });
  }, [slfRows, search, statusFilter]);

  // The single unit this summary displays in (#7). Facilities declare their own
  // baseline unit; for the aggregate table/totals we surface the most common one
  // among the loaded rows (m³ when none is declared). Per-facility rows still show
  // their OWN unit where available; this only governs the shared aggregate figures.
  // Declared here (before dayMap/calendarEvents) so those memos can read it without
  // hitting a temporal-dead-zone error.
  const displayUnit = useMemo(() => {
    const counts = { "m³": 0, tons: 0 };
    (filteredRows || []).forEach((r) => {
      const u = normalizeUnit(r.baselineUnit || "");
      if (u === "tons") counts.tons += 1;
      else if (u === "m³") counts["m³"] += 1;
    });
    return counts.tons > counts["m³"] ? "tons" : "m³";
  }, [filteredRows]);

  const facilityMap = useMemo(() => {
    const map = new Map();
    facilities.forEach((facility) => {
      addNameVariant(map, facility.lgu, facility);
      addNameVariant(map, facility.province, facility);
      addNameVariant(map, facility.slfName, facility);
    });
    return map;
  }, [facilities]);

  // Index facilities by id so a summary row's SLF name reflects the CURRENT
  // facility name (fixes stale names after an SLF/LGU rename).
  const facilityById = useMemo(() => {
    const map = new Map();
    facilities.forEach((facility) => {
      if (facility?._id) map.set(String(facility._id), facility);
    });
    return map;
  }, [facilities]);

  const baselineMap = useMemo(() => {
    const map = new Map();
    baselines.forEach((baseline) => {
      addNameVariant(map, baseline.slfName, baseline);
      addNameVariant(map, baseline.lguCompanyName, baseline);
    });
    return map;
  }, [baselines]);

  const summaryRows = useMemo(() => {
    return filteredRows.map((row) => {
      const genId =
        row?.slfGenerator && typeof row.slfGenerator === "object"
          ? row.slfGenerator._id
          : row?.slfGenerator;
      const facility = facilityMap.get(normalizeKey(row.slfName)) || (genId ? facilityById.get(String(genId)) : null);
      const baseline = baselineMap.get(normalizeKey(row.slfName));
      const baselineTotals = buildBaselineTotals(baseline);
      const statuses = row.statuses || {};
      return {
        ...row,
        residualM3: row.residualM3 || 0,
        residualTons: row.residualTons || 0,
        hazardousM3: row.hazardousM3 || 0,
        hazardousTons: row.hazardousTons || 0,
        totalM3: row.totalM3 || 0,
        totalTons: row.totalTons || 0,
        statuses: Object.fromEntries(Object.entries(statuses).filter(([, count]) => count > 0)),
        lastDisposalDate: row.lastDisposalDate ? dayjs(row.lastDisposalDate) : null,
        facility,
        baseline,
        baselineTotals,
        records: [],
      };
    });
  }, [filteredRows, facilityMap, facilityById, baselineMap]);


  const selectedDayRecords = useMemo(() => {
    if (!calendarRecord) return [];
    return calendarRecord.records.filter((record) =>
      record.dateOfDisposal && dayjs(record.dateOfDisposal).isSame(calendarDate, "day")
    );
  }, [calendarRecord, calendarDate]);

  const selectedDayTotals = useMemo(() => selectedDayRecords.reduce((acc, record) => {
    acc.submissions += 1;
    acc.trucks += record.trucks?.length || 0;
    (record.trucks || []).forEach((truck) => {
      const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
      if (unit === "tons") acc.tons += Number(truck.actualVolume || 0);
      else acc.m3 += Number(truck.actualVolume || 0);
    });
    return acc;
  }, { submissions: 0, trucks: 0, m3: 0, tons: 0 }), [selectedDayRecords]);

  // Item #2: facility behind the open calendar — source of operational status +
  // the declared unit for unit-mismatch detection.
  const calendarFacility = useMemo(() => {
    if (!calendarRecord) return null;
    const genId = calendarRecord.slfGenerator?._id || calendarRecord.slfGenerator;
    return (
      (genId && facilityById.get(String(genId))) ||
      facilityMap.get(normalizeKey(calendarRecord.slfName)) ||
      null
    );
  }, [calendarRecord, facilityById, facilityMap]);

  // Item #2: per-record enrichment + issue detection for the selected day, using
  // the app's existing business rules. Each record carries its OWN stored unit so
  // historical records stay accurate even if the SLF unit changes later.
  const selectedDayDetail = useMemo(() => {
    const facility = calendarFacility;
    const facUnit = normalizeUnit(
      facility?.wasteReceivedUnit || facility?.volumeCapacityUnit || "",
    );
    const nonOperational = /non/i.test(String(facility?.statusOfSLF || ""));
    // Duplicate detection: same generator + same disposal date appearing more than once.
    const byGenerator = {};
    selectedDayRecords.forEach((r) => {
      const g = String(r.lguCompanyName || r.companyName || r.generatorName || "").trim().toLowerCase();
      if (g) byGenerator[g] = (byGenerator[g] || 0) + 1;
    });

    const rows = selectedDayRecords.map((record) => {
      const trucks = Array.isArray(record.trucks) ? record.trucks : [];
      let tons = 0;
      let m3 = 0;
      const units = new Set();
      trucks.forEach((truck) => {
        const rows2 = (truck.vehicles || []).filter((v) => Number(v.actualVolume || 0) > 0);
        const list = rows2.length ? rows2 : [truck];
        list.forEach((row) => {
          const u = normalizeUnit(row.actualVolumeUnit || truck.actualVolumeUnit || record.baselineUnit || facUnit || "tons");
          const v = Number(row.actualVolume || 0);
          if (u) units.add(u);
          if (u === "tons") tons += v; else m3 += v;
        });
      });
      const totalVol = tons + m3;
      const unit = units.size === 1 ? [...units][0] : normalizeUnit(record.baselineUnit || facUnit || "tons");
      const isResub = Array.isArray(record.previousIdNos) && record.previousIdNos.length > 0;
      const acknowledged = String(record.status || "") === "acknowledged";

      const issues = [];
      if (!record.dateOfDisposal) issues.push("Missing disposal date");
      if (trucks.length === 0) issues.push("No transport entries recorded");
      if (!(totalVol > 0)) issues.push("Zero or invalid disposal quantity");
      if (units.size > 1) issues.push("Mixed units within one submission");
      else if (facUnit && [...units][0] && [...units][0] !== facUnit) issues.push(`Unit mismatch — recorded in ${[...units][0]}, SLF declares ${facUnit}`);
      if (nonOperational) issues.push("Submitted while SLF is tagged non-operational");
      if (isResub && !acknowledged) issues.push("Pending resubmission");
      if (!acknowledged && record.status === "pending" && !isResub) issues.push("Unacknowledged submission");
      if (["reverted", "revert_requested"].includes(record.status)) issues.push("Reverted for correction");
      if (record.status === "rejected") issues.push("Rejected submission");
      const gKey = String(record.lguCompanyName || record.companyName || record.generatorName || "").trim().toLowerCase();
      if (gKey && byGenerator[gKey] > 1) issues.push("Possible duplicate submission for this date");
      if (record.dateOfDisposal && record.createdAt) {
        const late = dayjs(record.createdAt).startOf("day").diff(dayjs(record.dateOfDisposal).startOf("day"), "day");
        if (late > 1) issues.push(`Late submission — encoded ${late} days after the disposal date`);
      }

      return { record, totalVol, tons, m3, unit, isResub, acknowledged, nonOperational, issues };
    });

    const issueCount = rows.reduce((n, r) => n + r.issues.length, 0);
    return { rows, facility, facUnit, nonOperational, issueCount };
  }, [selectedDayRecords, calendarFacility]);

  const selectedCellRows = useMemo(() => {
    if (!calendarRecord) return [];
    return buildCellStatusRows(calendarRecord, calendarDate, settings);
  }, [calendarRecord, calendarDate, settings]);

  const selectedCumulativeTotals = useMemo(() => {
    if (!calendarRecord) return { m3: 0, tons: 0 };
    const throughDateRecords = calendarRecord.records.filter((record) =>
      record.dateOfDisposal && dayjs(record.dateOfDisposal).startOf("day").valueOf() <= calendarDate.startOf("day").valueOf(),
    );
    const submissions = getTruckTotals(throughDateRecords);
    return {
      m3: (calendarRecord.baselineTotals?.m3 || 0) + submissions.m3,
      tons: (calendarRecord.baselineTotals?.tons || 0) + submissions.tons,
    };
  }, [calendarRecord, calendarDate]);

  const dayMap = useMemo(() => {
    const map = {};
    if (!calendarRecord) return map;
    calendarRecord.records.forEach((record) => {
      if (!record.dateOfDisposal) return;
      const key = dayjs(record.dateOfDisposal).format("YYYY-MM-DD");
      if (!map[key]) map[key] = { count: 0, m3: 0, tons: 0, issues: new Set() };
      map[key].count += 1;
      // #4: flag submissions that have issues so the calendar can recolor the day.
      const st = String(record.status || "").toLowerCase();
      if (["rejected", "reverted", "revert_requested"].includes(st)) {
        map[key].issues.add("error:Validation / revert issue");
      }
      (record.trucks || []).forEach((truck) => {
        const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
        if (unit === "tons") map[key].tons += Number(truck.actualVolume || 0);
        else map[key].m3 += Number(truck.actualVolume || 0);
        const vol = Number(truck.actualVolume || 0);
        const cap = Number(truck.truckCapacity || 0);
        if (cap > 0 && vol > cap) map[key].issues.add("error:Exceeded truck capacity");
        const vehicles = Array.isArray(truck.vehicles) ? truck.vehicles : [];
        const hasVolume = vol > 0 || vehicles.some((v) => Number(v.actualVolume || 0) > 0);
        const hasCell =
          !!truck.cellName ||
          (truck.cellIndex != null && truck.cellIndex !== "") ||
          vehicles.some((v) => v.cellName || (v.cellIndex != null && v.cellIndex !== ""));
        if (hasVolume && !hasCell) map[key].issues.add("warning:Missing cell placement");
        vehicles.forEach((v) => {
          const vcap = Number(v.capacity ?? truck.truckCapacity ?? 0);
          const vvol = Number(v.actualVolume || 0);
          if (vcap > 0 && vvol > vcap) map[key].issues.add("error:Exceeded vehicle capacity");
        });
      });
    });
    // Freeze the issue sets into { level, reasons } for the calendar.
    Object.values(map).forEach((d) => {
      const reasons = [...d.issues];
      d.issueReasons = reasons.map((r) => r.split(":")[1]);
      d.issueLevel = reasons.some((r) => r.startsWith("error:"))
        ? "error"
        : reasons.some((r) => r.startsWith("warning:"))
          ? "warning"
          : null;
    });
    return map;
  }, [calendarRecord]);

  // #4: submission tag colors change when a day has issues — red for exceeded
  // capacity / rejected-reverted, amber for missing required data (unplaced cell).
  const ISSUE_COLORS = { error: "#ff4d4f", warning: "#fa8c16" };
  const calendarEvents = useMemo(() => Object.entries(dayMap).map(([date, item]) => {
    const color = ISSUE_COLORS[item.issueLevel] || ACCENT;
    return {
      id: date,
      start: date,
      allDay: true,
      title: formatVolume(item.m3 || 0, item.tons || 0, calendarRecord?.baselineUnit || displayUnit),
      backgroundColor: color,
      borderColor: color,
      textColor: "#fff",
      extendedProps: item,
    };
  }), [dayMap, calendarRecord?.baselineUnit, displayUnit]);

  // #4: export the open SLF's disposal submissions as CSV — either a custom date
  // range or "all" (from the first recorded submission). Volumes are written in the
  // facility's single baseline unit, consistent with everything else on screen.
  const handleExportCalendar = (mode) => {
    if (!calendarRecord) return;
    const recs = (calendarRecord.records || []).filter((r) => r.dateOfDisposal);
    let filtered = recs;
    if (mode === "range") {
      if (!exportRange || !exportRange[0] || !exportRange[1]) {
        Modal.warning({ title: "Select a date range", content: "Choose a start and end date, or use Export All." });
        return;
      }
      const [start, end] = exportRange;
      filtered = recs.filter((r) => {
        const d = dayjs(r.dateOfDisposal);
        return (d.isSame(start, "day") || d.isAfter(start)) && (d.isSame(end, "day") || d.isBefore(end));
      });
    }
    if (filtered.length === 0) {
      Modal.info({ title: "Nothing to export", content: "No submissions fall in the selected range." });
      return;
    }
    const unit = normalizeUnit(calendarRecord.baselineUnit || displayUnit);
    const volumeOf = (record) => {
      const trucks = record.trucks || [];
      if (trucks.length === 0) {
        return unit === "tons" ? Number(record.totalVolumeTons || 0) : Number(record.totalVolumeM3 || 0);
      }
      return trucks.reduce((sum, t) => {
        const v = convertVolume(Number(t.actualVolume || 0), t.actualVolumeUnit || record.baselineUnit || unit, unit);
        return sum + (v || 0);
      }, 0);
    };
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Date", "SLF", "Submission ID", "Generator", "Trucks", `Volume (${unit})`, "Status"];
    const rows = filtered
      .slice()
      .sort((a, b) => dayjs(a.dateOfDisposal).valueOf() - dayjs(b.dateOfDisposal).valueOf())
      .map((r) =>
        [
          dayjs(r.dateOfDisposal).format("YYYY-MM-DD"),
          calendarRecord.slfName || r.slfName || "",
          r.idNo || r.submissionId || "",
          r.lguCompanyName || r.companyName || "",
          r.truckCount ?? (r.trucks?.length ?? 0),
          Number(volumeOf(r).toFixed(2)),
          r.status || "pending",
        ]
          .map(esc)
          .join(","),
      );
    const csv = [header.map(esc).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const label =
      mode === "range"
        ? `${exportRange[0].format("YYYYMMDD")}-${exportRange[1].format("YYYYMMDD")}`
        : "all";
    a.href = url;
    a.download = `disposal-calendar-${String(calendarRecord.slfName || "slf")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()}-${label}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Tiles are derived from the loaded per-SLF submission rows so they always
  // reflect the actual submissions (and respond live to the search/status
  // filter). Falls back to the server summary-tiles only before rows load.
  const totals = useMemo(() => {
    if (!filteredRows.length) {
      return {
        submissions: tiles?.submissions || 0,
        trucks: tiles?.trucks || 0,
        m3: tiles?.totalM3 || 0,
        tons: tiles?.totalTons || 0,
        residualM3: tiles?.residualM3 || 0,
        residualTons: tiles?.residualTons || 0,
        hazardousM3: tiles?.hazardousM3 || 0,
        hazardousTons: tiles?.hazardousTons || 0,
        statuses: tiles?.statuses || {},
      };
    }
    const acc = {
      submissions: 0,
      trucks: 0,
      m3: 0,
      tons: 0,
      residualM3: 0,
      residualTons: 0,
      hazardousM3: 0,
      hazardousTons: 0,
      statuses: {
        pending: 0,
        acknowledged: 0,
        rejected: 0,
        reverted: 0,
        revert_requested: 0,
      },
    };
    filteredRows.forEach((row) => {
      acc.submissions += Number(row.submissions || 0);
      acc.trucks += Number(row.trucks || 0);
      acc.m3 += Number(row.totalM3 || 0);
      acc.tons += Number(row.totalTons || 0);
      acc.residualM3 += Number(row.residualM3 || 0);
      acc.residualTons += Number(row.residualTons || 0);
      acc.hazardousM3 += Number(row.hazardousM3 || 0);
      acc.hazardousTons += Number(row.hazardousTons || 0);
      const s = row.statuses || {};
      Object.keys(acc.statuses).forEach((k) => {
        acc.statuses[k] += Number(s[k] || 0);
      });
    });
    return acc;
  }, [filteredRows, tiles]);

  // Detail-heavy records (trucks, calendar) are loaded only when an SLF's
  // calendar is opened — not on initial page render.
  const openCalendar = useCallback(async (row) => {
    setCalendarRecord({ ...row, records: [] });
    setCalendarDate(row.lastDisposalDate || dayjs());
    setCalendarLoading(true);
    try {
      const genId = row.slfGenerator?._id || row.slfGenerator || undefined;
      const { data } = await api.get("/data-slf", {
        params: {
          mode: "list",
          includeTrucks: true,
          // Scope server-side by facility id when known (fast, exact); otherwise
          // fall back to a name search. This keeps the calendar from downloading
          // every SLF's records + trucks on open.
          ...(genId ? { slfGenerator: genId } : { search: row.slfName }),
        },
      });
      const records = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      // Scope the fetched records to this SLF robustly: match by facility id when
      // available, otherwise by normalized name (with a contains fallback so a
      // slightly different stored name format still resolves). This prevents the
      // day panel/calendar from coming up empty on a strict exact-match miss.
      const rowKey = normalizeKey(row.slfName);
      const rowGenId = String(row.slfGenerator?._id || row.slfGenerator || "");
      const matchesRow = (record) => {
        const recGenId = String(record.slfGenerator?._id || record.slfGenerator || "");
        if (rowGenId && recGenId && rowGenId === recGenId) return true;
        const recKey = normalizeKey(record.slfName || record.slfGenerator?.slfName);
        return (
          !!recKey &&
          !!rowKey &&
          (recKey === rowKey || recKey.includes(rowKey) || rowKey.includes(recKey))
        );
      };
      let ownRecords = records.filter(matchesRow);
      // Last-resort: the server already scoped by search=slfName, so if the
      // client filter still eliminated everything, keep the server-scoped set.
      if (ownRecords.length === 0 && records.length > 0) ownRecords = records;
      setCalendarRecord((prev) => (prev ? { ...prev, records: ownRecords } : prev));
      // Open the calendar on the month that actually holds disposal data. The
      // summary row's lastDisposalDate can be missing/stale, which would leave
      // the calendar sitting on an empty month with no visible submissions.
      const latestDate = ownRecords.reduce((latest, record) => {
        if (!record.dateOfDisposal) return latest;
        const current = dayjs(record.dateOfDisposal);
        return !latest || current.isAfter(latest) ? current : latest;
      }, null);
      if (latestDate) setCalendarDate(latestDate);
    } catch {
      setCalendarRecord((prev) => (prev ? { ...prev, records: [] } : prev));
    } finally {
      setCalendarLoading(false);
    }
  }, []);


  const columns = [
    {
      title: "Sanitary Landfill (SLF)",
      dataIndex: "slfName",
      fixed: "left",
      width: 300,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong style={{ fontSize: 12 }}>{value}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{row.generatorCount} generator(s) / {row.submitterCount} submitter(s)</Text>
        </Space>
      ),
    },
    { title: "No. of Submissions", dataIndex: "submissions", width: 110, align: "center", sorter: (a, b) => a.submissions - b.submissions },
    { title: "No. of Trucks", dataIndex: "trucks", width: 90, align: "center", sorter: (a, b) => a.trucks - b.trucks },
    {
      title: "Waste Volume",
      width: 190,
      align: "center",
      render: (_, row) => <Text strong style={{ fontSize: 12 }}>{formatVolume(row.totalM3, row.totalTons, row.baselineUnit || displayUnit)}</Text>,
    },
    { title: "Residual", width: 170, render: (_, row) => <Text style={{ fontSize: 12 }}>{formatVolume(row.residualM3, row.residualTons, row.baselineUnit || displayUnit)}</Text> },
    { title: "Hazardous", width: 170, render: (_, row) => <Text style={{ fontSize: 12 }}>{formatVolume(row.hazardousM3, row.hazardousTons, row.baselineUnit || displayUnit)}</Text> },
    {
      title: "Status Summary",
      width: 230,
      render: (_, row) => (
        <Space size={4} wrap>
          {Object.entries(row.statuses).map(([status, count]) => (
            <Tag key={status} color={statusColor[status] || "default"} style={{ margin: 0 }}>
              {status.replace("_", " ")}: {count}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "Last Disposal",
      dataIndex: "lastDisposalDate",
      width: 130,
      render: (value) => value ? value.format("MM/DD/YYYY") : "—",
      sorter: (a, b) => (a.lastDisposalDate?.valueOf() || 0) - (b.lastDisposalDate?.valueOf() || 0),
    },
    {
      title: "Action",
      width: 170,
      align: "center",
      render: (_, row) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            onClick={() => openCalendar(row)}
          >
            View
          </Button>
          <Button
            size="small"
            icon={<MessageOutlined />}
            onClick={() => openMessageUser(row)}
            ghost
            type="primary"
          >
            Message
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Collapse
        defaultActiveKey={["overview", "breakdown"]}
        expandIconPosition="end"
        style={{ marginBottom: 16, background: "transparent", borderRadius: 10 }}
        items={[
          {
            key: "overview",
            label: (
              <Text strong style={{ fontSize: 14, color: ACCENT }}>
                Summary Overview
              </Text>
            ),
            children: (
      <Row gutter={[12, 12]}>
        {/* Group 1 — Submissions & Facilities (Total Submissions, Acknowledged,
            Pending, Reporting SLFs grouped together, plus Truck Entries). */}
        <Col xs={24} lg={15}>
          <Card
            size="small"
            className="summary-tile"
            title={
              <Text strong style={{ fontSize: 13 }}>
                <InboxOutlined /> Submissions &amp; Facilities
              </Text>
            }
            style={{
              borderRadius: 12,
              height: "100%",
              background: isDark ? "#1f1f1f" : "#fff",
            }}
            styles={{ body: { padding: "14px 16px" } }}
          >
            {/* #2: single compact row on desktop — items flex-distribute evenly and
                wrap cleanly on smaller screens (no oversized cards or large gaps). */}
            <Row gutter={[10, 10]} wrap>
              <Col flex="1 1 120px" style={{ minWidth: 0 }}>
                <MiniStat
                  icon={<InboxOutlined />}
                  color="#13c2c2"
                  label="Total Submissions"
                  subtitle={`${totals.statuses.pending || 0} pending review`}
                >
                  <CountUp value={totals.submissions} />
                </MiniStat>
              </Col>
              <Col flex="1 1 120px" style={{ minWidth: 0 }}>
                <MiniStat
                  icon={<CheckCircleOutlined />}
                  color="#389e0d"
                  label="Acknowledged"
                  subtitle="Reviewed & accepted"
                >
                  <CountUp value={totals.statuses.acknowledged || 0} />
                </MiniStat>
              </Col>
              <Col flex="1 1 120px" style={{ minWidth: 0 }}>
                <MiniStat
                  icon={<ClockCircleOutlined />}
                  color="#d48806"
                  label="Pending"
                  subtitle="Awaiting admin action"
                >
                  <CountUp value={totals.statuses.pending || 0} />
                </MiniStat>
              </Col>
              <Col flex="1 1 120px" style={{ minWidth: 0 }}>
                <MiniStat
                  icon={<BankOutlined />}
                  color="#2f54eb"
                  label="Reporting SLFs"
                  subtitle="Active landfill facilities"
                >
                  <CountUp value={filteredRows.length} />
                </MiniStat>
              </Col>
              <Col flex="1 1 120px" style={{ minWidth: 0 }}>
                <MiniStat
                  icon={<CarOutlined />}
                  color="#fa8c16"
                  label="Truck Entries"
                  subtitle="Total disposal trips"
                >
                  <CountUp value={totals.trucks} />
                </MiniStat>
              </Col>
            </Row>
          </Card>
        </Col>
        {/* Group 2 — Waste Breakdown (Residual + Hazardous merged into one card).
            Hazardous uses the safe formatter so a valid-but-empty value reads "0"
            rather than "-". */}
        <Col xs={24} lg={9}>
          <Card
            size="small"
            className="summary-tile"
            title={
              <Text strong style={{ fontSize: 13 }}>
                <ExperimentOutlined /> Waste Breakdown
              </Text>
            }
            style={{
              borderRadius: 12,
              height: "100%",
              background: isDark ? "#1f1f1f" : "#fff",
            }}
            styles={{ body: { padding: "14px 16px" } }}
          >
            <Row gutter={[16, 16]}>
              <Col xs={12}>
                <MiniStat
                  icon={<ExperimentOutlined />}
                  color="#52c41a"
                  label="Residual Waste"
                  subtitle="Non-hazardous volume"
                >
                  <span style={{ fontSize: 17, fontWeight: 700 }}>
                    {formatVolumeSafe(totals.residualM3, totals.residualTons, displayUnit)}
                  </span>
                </MiniStat>
              </Col>
              <Col xs={12}>
                <MiniStat
                  icon={<WarningOutlined />}
                  color="#cf1322"
                  label="Hazardous Waste"
                  subtitle="Treated hazardous volume"
                >
                  <span style={{ fontSize: 17, fontWeight: 700 }}>
                    {formatVolumeSafe(totals.hazardousM3, totals.hazardousTons, displayUnit)}
                  </span>
                </MiniStat>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>
            ),
          },
        ]}
      />
      {/* Cell Infra Overview — its own collapsible card, above the SLF
          Submissions Breakdown (kept as a separate card, not merged). */}
      <CellInfraOverview
        rows={summaryRows}
        isDark={isDark}
        loading={loading || refLoading}
        portalUsers={portalUsers}
        onEdited={() => {
          fetchReferenceData({ force: true });
          fetchRecords({ force: true, silent: true });
        }}
      />
      <Collapse
        defaultActiveKey={["breakdown"]}
        expandIconPosition="end"
        style={{ marginBottom: 16, background: "transparent", borderRadius: 10 }}
        items={[
          {
            key: "breakdown",
            label: (
              <Text strong style={{ fontSize: 14, color: ACCENT }}>
                SLF Submissions Breakdown
              </Text>
            ),
            // Filters/buttons aligned on the right of the header text; the header
            // text stays on the left. stopPropagation keeps clicks from toggling
            // the Collapse panel.
            extra: (
              <Space
                size={8}
                style={{ flexWrap: "wrap" }}
                onClick={(event) => event.stopPropagation()}
              >
                <Input
                  placeholder="Search SLF, generator, ID, or email..."
                  prefix={<SearchOutlined />}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  allowClear
                  style={{ width: 260, maxWidth: "100%" }}
                />
                <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 170 }}>
                  <Select.Option value="all">All Statuses</Select.Option>
                  <Select.Option value="pending">Pending</Select.Option>
                  <Select.Option value="acknowledged">Acknowledged</Select.Option>
                  <Select.Option value="rejected">Rejected</Select.Option>
                  <Select.Option value="revert_requested">Revert Requested</Select.Option>
                  <Select.Option value="reverted">Reverted</Select.Option>
                </Select>
                <Button icon={<ReloadOutlined />} loading={loading} onClick={() => { fetchRecords({ force: true }); fetchReferenceData({ force: true }); }}>Refresh</Button>
                <Button type="primary" icon={<FilePdfOutlined />} onClick={() => setReportOpen(true)}>Generate PDF Report</Button>
              </Space>
            ),
            children: (
              <>
        <Table
          dataSource={summaryRows}
          columns={columns}
          loading={loading}
          rowKey="key"
          size="middle"
          pagination={{
            defaultPageSize: 12,
            showSizeChanger: true,
            pageSizeOptions: ["12", "25", "50", "100"],
            showTotal: (total) => `${total} SLF summary row(s)`,
          }}
          scroll={{ x: 1420 }}
          locale={{ emptyText: <Empty description="No submissions to summarize" /> }}
        />
              </>
            ),
          },
        ]}
      />

      <Modal
        // Header: title on the left, date-range + export controls on the right.
        // Responsive flex wraps the controls below the title on narrow screens; the
        // paddingRight keeps them clear of the modal close (X). (#1)
        title={
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              paddingRight: 28,
            }}
          >
            <Space>
              <CalendarOutlined />
              <span>{calendarRecord?.slfName || "Disposal Calendar"}</span>
              {calendarRecord && (
                <Text type="secondary" style={{ fontSize: 13 }}>Disposal Calendar</Text>
              )}
            </Space>
            <Space wrap size={6}>
              <DatePicker.RangePicker
                size="small"
                value={exportRange}
                onChange={(v) => setExportRange(v)}
                allowClear
              />
              <Button size="small" type="primary" ghost icon={<DownloadOutlined />} onClick={() => handleExportCalendar("range")}>
                Export Range
              </Button>
              <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={() => handleExportCalendar("all")}>
                Export All
              </Button>
            </Space>
          </div>
        }
        open={!!calendarRecord}
        onCancel={() => setCalendarRecord(null)}
        footer={<Button onClick={() => setCalendarRecord(null)}>Close</Button>}
        width={1600}
        // #1: sit the modal higher with less top gap while keeping the header/close
        // on-screen and the body internally scrollable on smaller viewports.
        style={{ top: 20 }}
        styles={{ body: { maxHeight: "calc(100vh - 150px)", overflowY: "auto" } }}
        destroyOnHidden
      >
        {calendarRecord && (
          <Row gutter={[16, 16]}>
            <Col span={24}>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Total Submissions" value={calendarRecord.submissions} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Truck Entries" value={calendarRecord.trucks} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Selected Date" value={selectedDayTotals.submissions} suffix="submission(s)" valueStyle={{ fontSize: 20, color: ACCENT }} /></Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Selected Volume" value={formatVolume(selectedDayTotals.m3, selectedDayTotals.tons, calendarRecord.baselineUnit || displayUnit)} valueStyle={{ fontSize: 16 }} /></Card>
                </Col>
              </Row>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: 12 }}>
                <style>{`
                  .submission-fc .fc { font-size: 12px; }
                  .submission-fc .fc-toolbar-title { font-size: 18px; font-weight: 700; color: ${isDark ? "#f0f0f0" : "#1a3353"}; }
                  .submission-fc .fc-button { border-radius: 6px; padding: 4px 10px; }
                  .submission-fc .fc-daygrid-day { cursor: pointer; }
                  .submission-fc .fc-daygrid-day-number { font-weight: 600; color: ${isDark ? "#d9d9d9" : "#1a3353"}; }
                  .submission-fc .fc-selected-day { background: ${isDark ? "rgba(47,84,235,0.18)" : "#f0f5ff"}; }
                  .submission-fc .fc-event { border-radius: 6px; padding: 2px 4px; border: 0; }
                `}</style>
                <div className="submission-fc">
                  <Spin
                    spinning={calendarLoading}
                    tip="Loading disposal data…"
                  >
                    <Suspense
                      fallback={
                        <div style={{ height: 620, display: "grid", placeItems: "center" }}>
                          <Spin tip="Loading calendar…" />
                        </div>
                      }
                    >
                      <SummaryDisposalCalendar
                        calendarDate={calendarDate}
                        calendarEvents={calendarEvents}
                        onDateChange={(d) => { setCalendarDate(d); setDailyOpen(true); }}
                      />
                    </Suspense>
                  </Spin>
                </div>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" style={{ borderRadius: 8 }} title={calendarDate.format("MMMM D, YYYY")}>
                <Space size={6} wrap style={{ marginBottom: 12 }}>
                  <Tag color="blue">{selectedDayTotals.submissions} submission(s)</Tag>
                  <Tag color="cyan">{selectedDayTotals.trucks} truck(s)</Tag>
                  <Tag color="green">{formatVolume(selectedDayTotals.m3, selectedDayTotals.tons, calendarRecord.baselineUnit || displayUnit)}</Tag>
                  <Tag color="purple">Baseline + submissions: {formatVolume(selectedCumulativeTotals.m3, selectedCumulativeTotals.tons, calendarRecord.baselineUnit || displayUnit)}</Tag>
                </Space>
                <Table
                  size="small"
                  pagination={false}
                  dataSource={selectedCellRows}
                  rowKey="key"
                  style={{ marginBottom: 12 }}
                  columns={[
                    { title: "Cell", dataIndex: "cell", width: 72, render: (value, row) => <Text strong={row.isActive}>{value}</Text> },
                    { title: "Status", dataIndex: "status", width: 95, render: (value, row) => <Tag color={row.isActive ? "green" : "default"}>{value || "—"}</Tag> },
                    {
                      title: "Fill",
                      render: (_, row) => (
                        <Space direction="vertical" size={0}>
                          <Text>{row.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.unit}</Text>
                          {row.pct != null && <Text type="secondary" style={{ fontSize: 11 }}>{row.pct}% full</Text>}
                        </Space>
                      ),
                    },
                    {
                      title: "Remaining",
                      width: 150,
                      // #4: compact gauge beside the remaining figure showing the
                      // active cell's utilization at a glance.
                      render: (_, row) => (
                        <Space size={8} align="center">
                          <span>
                            {row.remaining == null
                              ? "—"
                              : `${row.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.unit}`}
                          </span>
                          {row.pct != null && (
                            <Tooltip title={`${row.pct}% utilized`}>
                              <GaugeMeter
                                percent={row.pct}
                                size={34}
                                thickness={4}
                                percentFontSize={9}
                                color={row.pct >= 90 ? "#ff4d4f" : row.pct >= 75 ? "#fa8c16" : "#52c41a"}
                              />
                            </Tooltip>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
                <Table
                  size="small"
                  pagination={{ pageSize: 6, size: "small" }}
                  dataSource={selectedDayRecords}
                  loading={calendarLoading}
                  rowKey={(record) => record._id}
                  locale={{ emptyText: "No submissions on this date" }}
                  columns={[
                    { title: "ID", dataIndex: "idNo", width: 90, render: (value, record) => <Text strong>{value || record.submissionId || "No ID"}</Text> },
                    { title: "Generator",  width: 120, dataIndex: "lguCompanyName", ellipsis: true, render: (value, record) => value || record.companyName || record.generatorName || "Not encoded" },
                    { title: "Trucks", width: 70, align: "center", render: (_, record) => record.trucks?.length || 0 },
                    {
                      title: "Volume",
                      width: 80,
                      render: (_, record) => {
                        const dayTotal = (record.trucks || []).reduce((acc, truck) => {
                          const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
                          if (unit === "tons") acc.tons += Number(truck.actualVolume || 0);
                          else acc.m3 += Number(truck.actualVolume || 0);
                          return acc;
                        }, { m3: 0, tons: 0 });
                        return formatVolume(dayTotal.m3, dayTotal.tons, record.baselineUnit || calendarRecord.baselineUnit || displayUnit);
                      },
                    },
                    { title: "Status", dataIndex: "status", width: 90, render: (value) => <Tag color={statusColor[value] || "default"}>{value?.replace("_", " ") || "pending"}</Tag> },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        )}
      </Modal>
      {reportOpen && (
        <Suspense fallback={null}>
          <SlfSubmissionReport
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            tiles={tiles}
            slfRows={slfRows}
            portalUsers={portalUsers}
            facilities={facilities}
            baselines={baselines}
            totals={totals}
          />
        </Suspense>
      )}

      {/* Item #4: Message the SLF's assigned portal user(s) */}
      <Modal
        title={<span><MessageOutlined /> Message Portal User</span>}
        open={msgModal.open}
        onCancel={() => { setMsgModal({ open: false, row: null }); setMsgText(""); }}
        onOk={sendPortalMessage}
        okText="Send"
        confirmLoading={msgSending}
        okButtonProps={{ disabled: !msgText.trim() }}
        destroyOnClose
      >
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary">To (assigned portal user of):</Text>{" "}
          <Text strong>{msgModal.row?.slfName || "—"}</Text>
        </div>
        <Input.TextArea
          rows={5}
          maxLength={4000}
          showCount
          value={msgText}
          onChange={(e) => setMsgText(e.target.value)}
          placeholder="Write your message to the portal user…"
          onPressEnter={(e) => { if ((e.ctrlKey || e.metaKey)) sendPortalMessage(); }}
        />
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8 }}>
          The user will see this after logging in to the SLF Portal. Delivered in real time.
        </Text>
      </Modal>

      {/* Item #2: Daily Submission Details — opens when a calendar date is clicked */}
      <Modal
        title={
          <span>
            <CalendarOutlined /> Daily Submission Details
            {calendarRecord?.slfName ? ` — ${calendarRecord.slfName}` : ""}
          </span>
        }
        open={dailyOpen}
        onCancel={() => setDailyOpen(false)}
        footer={<Button onClick={() => setDailyOpen(false)}>Close</Button>}
        width={860}
      >
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 15 }}>{calendarDate.format("dddd, MMMM D, YYYY")}</Text>
          {calendarFacility?.statusOfSLF && (
            <Tag
              color={/non/i.test(calendarFacility.statusOfSLF) ? "red" : "green"}
              style={{ marginLeft: 8 }}
            >
              {calendarFacility.statusOfSLF}
            </Tag>
          )}
        </div>

        {calendarLoading ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}><Spin /></div>
        ) : selectedDayRecords.length === 0 ? (
          <Empty description="No submission recorded for this date" />
        ) : (
          <>
            {selectedDayDetail.issueCount > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={`${selectedDayDetail.issueCount} issue${selectedDayDetail.issueCount === 1 ? "" : "s"} detected on this date`}
                description={
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {selectedDayDetail.rows.flatMap((r, i) =>
                      r.issues.map((iss, j) => (
                        <li key={`${i}-${j}`}>
                          <Text type="secondary">{r.record.idNo || r.record.submissionId || "Record"}:</Text> {iss}
                        </li>
                      )),
                    )}
                  </ul>
                }
              />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {selectedDayDetail.rows.map(({ record, totalVol, unit, isResub, acknowledged, issues }) => (
                <Card key={record._id} size="small" style={{ borderRadius: 8, borderLeft: `3px solid ${issues.length ? "#fa8c16" : "#52c41a"}` }}>
                  <Row gutter={[12, 8]}>
                    <Col xs={12} md={8}><Text type="secondary">Submission ID:</Text><br /><Text strong>{record.idNo || record.submissionId || "—"}</Text></Col>
                    <Col xs={12} md={8}><Text type="secondary">Generator:</Text><br /><Text>{record.lguCompanyName || record.companyName || record.generatorName || "—"}</Text></Col>
                    <Col xs={12} md={8}><Text type="secondary">Disposal Quantity:</Text><br /><Text strong>{formatVolume(unit === "tons" ? 0 : totalVol, unit === "tons" ? totalVol : 0, unit)}</Text></Col>
                    <Col xs={12} md={8}><Text type="secondary">Submitted:</Text><br /><Text>{record.createdAt ? dayjs(record.createdAt).format("MMM D, YYYY h:mm A") : "—"}</Text></Col>
                    <Col xs={12} md={8}><Text type="secondary">{isResub ? "Resubmitted:" : "Last Updated:"}</Text><br /><Text>{record.updatedAt ? dayjs(record.updatedAt).format("MMM D, YYYY h:mm A") : "—"}</Text></Col>
                    <Col xs={12} md={8}>
                      <Text type="secondary">Status:</Text><br />
                      <Tag color={acknowledged ? "green" : record.status === "rejected" ? "red" : /revert/.test(record.status || "") ? "orange" : "gold"}>
                        {acknowledged ? "Acknowledged" : (record.status || "pending")}
                      </Tag>
                      {isResub && <Tag color="orange">Resubmission</Tag>}
                    </Col>
                    {(record.remarks || record.resubmitComment || record.revertReason) && (
                      <Col xs={24}><Text type="secondary">Remarks:</Text><br /><Text>{record.remarks || record.resubmitComment || record.revertReason}</Text></Col>
                    )}
                    {record.submittedBy && (
                      <Col xs={24} md={12}><Text type="secondary">Submitted by:</Text> <Text>{record.submittedBy}</Text></Col>
                    )}
                  </Row>
                  {issues.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {issues.map((iss, i) => (
                        <Tag key={i} color="warning" style={{ marginBottom: 4 }}>{iss}</Tag>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
