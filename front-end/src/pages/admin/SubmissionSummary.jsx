import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
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
  Typography,
} from "antd";
import {
  CalendarOutlined,
  EyeOutlined,
  ReloadOutlined,
  SearchOutlined,
  FilePdfOutlined,
  BankOutlined,
  InboxOutlined,
  CarOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
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

function formatVolume(m3, tons) {
  const parts = [];
  const m = formatVolumeValue(m3);
  const t = formatVolumeValue(tons);
  if (m) parts.push(`${m} m³`);
  if (t) parts.push(`${t} tons`);
  return parts.length ? parts.join(" / ") : "—";
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

function SummaryTile({ icon, color, label, children, subtitle, isDark, delay = 0 }) {
  return (
    <Card
      size="small"
      className="summary-tile"
      style={{
        borderRadius: 12,
        animationDelay: `${delay}ms`,
        background: isDark ? "#1f1f1f" : "#fff",
      }}
      styles={{ body: { padding: "14px 16px" } }}
    >
      <div className="summary-tile-accent" style={{ background: color }} />
      <Space align="start" size={12} style={{ width: "100%" }}>
        <span
          className="summary-tile-icon"
          style={{ background: `${color}1f`, color }}
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
              fontSize: 24,
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
      </Space>
    </Card>
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
  const [submissionDetail, setSubmissionDetail] = useState(null);
  const [portalUsers, setPortalUsers] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);

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
      setSubmissionDetail(null);
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
      if (!map[key]) map[key] = { count: 0, m3: 0, tons: 0 };
      map[key].count += 1;
      (record.trucks || []).forEach((truck) => {
        const unit = normalizeUnit(truck.actualVolumeUnit || record.baselineUnit || "m³");
        if (unit === "tons") map[key].tons += Number(truck.actualVolume || 0);
        else map[key].m3 += Number(truck.actualVolume || 0);
      });
    });
    return map;
  }, [calendarRecord]);

  const calendarEvents = useMemo(() => Object.entries(dayMap).map(([date, item]) => ({
    id: date,
    start: date,
    allDay: true,
    title: formatVolume(item.m3 || 0, item.tons || 0),
    backgroundColor: ACCENT,
    borderColor: ACCENT,
    textColor: "#fff",
    extendedProps: item,
  })), [dayMap]);

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
      title: "SLF",
      dataIndex: "slfName",
      fixed: "left",
      width: 240,
      render: (value, row) => (
        <Space direction="vertical" size={2}>
          <Text strong>{value}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{row.generatorCount} generator(s) / {row.submitterCount} submitter(s)</Text>
        </Space>
      ),
    },
    { title: "Submissions", dataIndex: "submissions", width: 110, align: "center", sorter: (a, b) => a.submissions - b.submissions },
    { title: "Trucks", dataIndex: "trucks", width: 90, align: "center", sorter: (a, b) => a.trucks - b.trucks },
    {
      title: "Waste Volume",
      width: 190,
      render: (_, row) => <Text strong>{formatVolume(row.totalM3, row.totalTons)}</Text>,
    },
    { title: "Residual", width: 170, render: (_, row) => formatVolume(row.residualM3, row.residualTons) },
    { title: "Hazardous", width: 170, render: (_, row) => formatVolume(row.hazardousM3, row.hazardousTons) },
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
      title: "Calendar",
      width: 110,
      align: "center",
      render: (_, row) => (
        <Button
          size="small"
          icon={<CalendarOutlined />}
          onClick={() => openCalendar(row)}
        >
          View
        </Button>
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
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<BankOutlined />}
            color="#2f54eb"
            label="Reporting SLFs"
            subtitle="Active landfill facilities"
            isDark={isDark}
            delay={0}
          >
            <CountUp value={filteredRows.length} />
          </SummaryTile>
        </Col>
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<InboxOutlined />}
            color="#13c2c2"
            label="Submissions"
            subtitle={`${totals.statuses.pending || 0} pending review`}
            isDark={isDark}
            delay={60}
          >
            <CountUp value={totals.submissions} />
          </SummaryTile>
        </Col>
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<CarOutlined />}
            color="#fa8c16"
            label="Truck Entries"
            subtitle="Total disposal trips"
            isDark={isDark}
            delay={120}
          >
            <CountUp value={totals.trucks} />
          </SummaryTile>
        </Col>
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<DatabaseOutlined />}
            color="#722ed1"
            label="Total Waste Volume"
            subtitle={
              totals.tons > 0 && totals.m3 > 0
                ? `${formatVolumeValue(totals.tons)} tons combined`
                : "All accepted waste"
            }
            isDark={isDark}
            delay={180}
          >
            <span style={{ fontSize: 19, fontWeight: 700 }}>
              {formatVolume(totals.m3, totals.tons)}
            </span>
          </SummaryTile>
        </Col>
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<ExperimentOutlined />}
            color="#52c41a"
            label="Residual Waste"
            subtitle="Non-hazardous volume"
            isDark={isDark}
            delay={240}
          >
            <span style={{ fontSize: 17, fontWeight: 700 }}>
              {formatVolume(totals.residualM3, totals.residualTons)}
            </span>
          </SummaryTile>
        </Col>
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<WarningOutlined />}
            color="#cf1322"
            label="Hazardous Waste"
            subtitle="Treated hazardous volume"
            isDark={isDark}
            delay={300}
          >
            <span style={{ fontSize: 17, fontWeight: 700 }}>
              {formatVolume(totals.hazardousM3, totals.hazardousTons)}
            </span>
          </SummaryTile>
        </Col>
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<CheckCircleOutlined />}
            color="#389e0d"
            label="Acknowledged"
            subtitle="Reviewed & accepted"
            isDark={isDark}
            delay={360}
          >
            <CountUp value={totals.statuses.acknowledged || 0} />
          </SummaryTile>
        </Col>
        <Col xs={12} sm={12} md={8} lg={6}>
          <SummaryTile
            icon={<ClockCircleOutlined />}
            color="#d48806"
            label="Pending"
            subtitle="Awaiting admin action"
            isDark={isDark}
            delay={420}
          >
            <CountUp value={totals.statuses.pending || 0} />
          </SummaryTile>
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
        title={calendarRecord ? <Space><CalendarOutlined /> <span>{calendarRecord.slfName}</span><Text type="secondary" style={{ fontSize: 13 }}>Disposal Calendar</Text></Space> : "Disposal Calendar"}
        open={!!calendarRecord}
        onCancel={() => setCalendarRecord(null)}
        footer={<Button onClick={() => setCalendarRecord(null)}>Close</Button>}
        width={1600}
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
                  <Card size="small" style={{ borderRadius: 8 }}><Statistic title="Selected Volume" value={formatVolume(selectedDayTotals.m3, selectedDayTotals.tons)} valueStyle={{ fontSize: 16 }} /></Card>
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
                        onDateChange={setCalendarDate}
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
                  <Tag color="green">{formatVolume(selectedDayTotals.m3, selectedDayTotals.tons)}</Tag>
                  <Tag color="purple">Baseline + submissions: {formatVolume(selectedCumulativeTotals.m3, selectedCumulativeTotals.tons)}</Tag>
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
                      //width: 105,
                      render: (_, row) => row.remaining == null ? "—" : `${row.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.unit}`,
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
                        return formatVolume(dayTotal.m3, dayTotal.tons);
                      },
                    },
                    { title: "Status", dataIndex: "status", width: 90, render: (value) => <Tag color={statusColor[value] || "default"}>{value?.replace("_", " ") || "pending"}</Tag> },
                    { title: "", width: 54, render: (_, record) => <Button size="small" icon={<EyeOutlined />} onClick={() => setSubmissionDetail(record)} /> },
                  ]}
                />
              </Card>
              <Button
                icon={<EyeOutlined />}
                style={{ marginTop: 12 }}
                block
                disabled={selectedDayRecords.length === 0}
                onClick={() => selectedDayRecords[0] && setSubmissionDetail(selectedDayRecords[0])}
              >
                {selectedDayRecords.length} submission(s) on selected date
              </Button>
            </Col>
          </Row>
        )}
      </Modal>

      <Modal
        title={submissionDetail ? <Space><EyeOutlined /> <span>{submissionDetail.idNo || "Submission Details"}</span></Space> : "Submission Details"}
        open={!!submissionDetail}
        onCancel={() => setSubmissionDetail(null)}
        footer={<Button onClick={() => setSubmissionDetail(null)}>Close</Button>}
        width={1400}
        destroyOnHidden
      >
        {submissionDetail && (
          <Space direction="vertical" size={14} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              <Col xs={24} md={8}>
                <Card size="small" style={{ borderRadius: 8 }}>
                  <Statistic title="Generator" value={submissionDetail.lguCompanyName || submissionDetail.companyName || "Not encoded"} valueStyle={{ fontSize: 16 }} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" style={{ borderRadius: 8 }}>
                  <Statistic title="Disposal Date" value={submissionDetail.dateOfDisposal ? dayjs(submissionDetail.dateOfDisposal).format("MM/DD/YYYY") : "—"} valueStyle={{ fontSize: 16 }} />
                </Card>
              </Col>
              <Col xs={24} md={8}>
                <Card size="small" style={{ borderRadius: 8 }}>
                  <Statistic title="Status" value={submissionDetail.status?.replace("_", " ") || "pending"} valueStyle={{ fontSize: 16 }} />
                </Card>
              </Col>
            </Row>
            <Table
              size="small"
              pagination={true}
              className="portal-user-wrap-table"
              dataSource={submissionDetail.trucks || []}
              rowKey={(_, index) => index}
              scroll={{ x: "max-content" }}
              locale={{ emptyText: "No truck entries recorded" }}
              columns={[
                { title: "Truck", width: 60, render: (_, __, index) => index + 1 },
                { title: "Ticket", dataIndex: "disposalTicketNo", render: (value) => value || "Not encoded" },
                { title: "Plate No.", dataIndex: "plateNumber", render: (value, truck) => value || truck.plateNo || "Not encoded" },
                { title: "Hauler", dataIndex: "hauler", render: (value, truck) => value || truck.haulerName || "Not encoded" },
                { title: "Waste Type", dataIndex: "wasteType", render: (value) => value || "Residual" },
                {
                  title: "Cell(s)",
                  render: (_, truck) => {
                    const cells = (truck.vehicles || [])
                      .map((v) => v.cellName)
                      .filter(Boolean);
                    return cells.length
                      ? [...new Set(cells)].join(", ")
                      : truck.cellName || "—";
                  },
                },
                {
                  title: "Actual Volume",
                  align: "right",
                  render: (_, truck) => `${Number(truck.actualVolume || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${normalizeUnit(truck.actualVolumeUnit || submissionDetail.baselineUnit || "m³")}`,
                },
              ].map((col) => ({
                ...col,
                onHeaderCell: () => ({
                  style: { whiteSpace: "normal", wordBreak: "break-word", fontSize: 11 },
                }),
                onCell: () => ({
                  style: {
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    fontSize: 11,
                  },
                }),
              }))}
            />
          </Space>
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
    </div>
  );
}
