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
  UndoOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  QuestionCircleOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { isResubmissionRecord } from "../../utils/resubmission";
import GaugeMeter, { computeGaugePercent } from "../../components/GaugeMeter";
// FullCalendar is heavy; load it only when the disposal calendar modal opens.
const SummaryDisposalCalendar = lazy(() => import("./SummaryDisposalCalendar"));
const SlfSubmissionReport = lazy(() => import("./SlfSubmissionReport"));
import api from "../../api";
import { fetchAllSubmissions } from "./shared/submissionRecords";
import CellInfraOverview from "./CellInfraOverview";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import excludeDummy from "../../utils/excludeDummy";
import { convertVolume, resolveCellUnit } from "../../utils/volumeUnits";
import { cellPercent } from "../../utils/cellCapacity";
import { wasteTypeTagColor } from "../../utils/wasteCategories";
import WeighedVolumeNote from "../../components/WeighedVolumeNote";
import {
  buildSubmissionWasteEntries,
  formatWasteEntryTotals,
} from "../../utils/submissionEntries";

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

// Sum a set of submissions' transported volume, per declared unit.
//
// The volume lives on the VEHICLE whenever a truck carries them — the portal
// form records wasteType/actualVolume per vehicle and leaves the truck level at
// 0 — and only falls back to the truck for single-entry rows. Reading the truck
// level alone reported 0 for every multi-vehicle submission, so a busy SLF's
// day totals and Selected Volume tile stayed flat no matter how much waste was
// submitted. Same rule as hasTruckVolume/computeCellOccupancy on the server and
// buildSubmissionWasteEntries in utils/submissionEntries.js.
function getTruckTotals(records) {
  return records.reduce((acc, record) => {
    (record.trucks || []).forEach((truck) => {
      const vehicles = (truck.vehicles || []).filter((v) => Number(v.actualVolume || 0) > 0);
      const rows = vehicles.length ? vehicles : [truck];
      rows.forEach((row) => {
        const unit = normalizeUnit(
          row.actualVolumeUnit || truck.actualVolumeUnit || record.baselineUnit || "m³",
        );
        if (unit === "tons") acc.tons += Number(row.actualVolume || 0);
        else acc.m3 += Number(row.actualVolume || 0);
      });
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

/**
 * The per-cell fill rows shown beside the disposal calendar.
 *
 * ── Why this reads a rollup instead of computing one ─────────────────────────
 * This used to derive the figures here, in the browser, and it was a FOURTH
 * implementation of a calculation that already exists once on the server
 * (utils/cellOccupancy.js → GET /data-slf/cell-occupancy). It disagreed with all
 * three of the others, and not by a rounding error:
 *
 *   • it added the facility's ENTIRE cumulative truck total to EVERY active
 *     cell, so an SLF with three open cells reported the same waste three times
 *     and each cell read the whole facility's volume;
 *   • it never looked at `cellIndex`, so where the waste was actually placed —
 *     the thing Organize Cell Placement exists to record — changed nothing;
 *   • it summed only truck-level `actualVolume`, so every multi-vehicle
 *     submission contributed ZERO and the cells stayed flat as approvals landed
 *     (the "Waste in Cell is not increasing" report);
 *   • it applied no status filter at all, so rejected and reverted submissions
 *     counted toward the fill;
 *   • `Math.max(encodedFill, derived)` meant an admin-declared figure only
 *     showed when it happened to be the LARGER number — a correction downward
 *     was silently discarded.
 *
 * The server rollup is the authoritative calculation: it applies the
 * pre-baseline rule and the active-status rule, honours explicit placements
 * including per-vehicle ones, counts each submission exactly once, and applies
 * the admin override. Reading it is what makes this table agree with the SLF
 * Data Table, Cell Infrastructure and the portal's own tiles.
 *
 * The fallback is the PERSISTED output of that same calculation
 * (`cellFillValues` and its provenance split, written by
 * refreshFacilityCellOccupancy) — never a re-derivation. A stale number from the
 * right calculation is recoverable; a fresh number from a different one is the
 * bug this replaced.
 */
function buildCellStatusRows(summary, occupancy = null) {
  const facility = summary.facility;
  const rollupCells = occupancy?.cells || [];
  const cellCount = Math.max(
    Number(facility?.numberOfCell || facility?.numberOfCells || 0),
    facility?.cellCapacities?.length || 0,
    facility?.cellStatuses?.length || 0,
    rollupCells.length,
    1,
  );
  const rollupByIndex = new Map(rollupCells.map((cell) => [cell.index, cell]));
  const statuses = facility?.cellStatuses || [];
  const capacities = facility?.cellCapacities || [];
  const fillValues = facility?.cellFillValues || [];
  const baselineFills = facility?.cellFillBaselineValues || [];
  const submittedFills = facility?.cellFillSubmittedValues || [];
  const cellNames = facility?.cellNames || [];

  return Array.from({ length: cellCount }).map((_, index) => {
    const rollup = rollupByIndex.get(index);
    const status = rollup?.status || statuses[index] || (index === 0 ? "Active" : "Available");
    // Fill and capacity carry independent declared units; converting the fill
    // into the capacity's unit before comparing them is what stops a facility
    // that declares tons from reporting a utilisation out by the conversion
    // factor.
    //
    // THE cell rule (utils/cellCapacity.js): the cell's capacity unit, the fill
    // converted into it, the same whole-number % the portal shows. The capacity
    // used to come from the facility record OR the rollup (which is in the
    // rollup's unit) without converting the latter.
    const unit = resolveCellUnit(facility, index, "capacity");
    const toUnit = (value, from) => {
      const converted = convertVolume(Number(value || 0), from || unit, unit);
      return Number.isFinite(converted) ? converted : 0;
    };
    const capacity = Number(capacities[index] || 0) || toUnit(rollup?.capacity, rollup?.unit);
    const used = rollup
      ? toUnit(rollup.used, rollup.unit)
      : toUnit(fillValues[index], resolveCellUnit(facility, index, "fill"));
    const pct = cellPercent(used, capacity);
    return {
      key: index,
      cell: rollup?.label || String(cellNames[index] || "").trim() || `Cell ${index + 1}`,
      status,
      used,
      // The provenance behind `used`, so the table can say where a cell's volume
      // came from instead of presenting one opaque number.
      baselineUsed: rollup
        ? toUnit(rollup.baselineUsed, rollup.unit)
        : toUnit(baselineFills[index], resolveCellUnit(facility, index, "fill")),
      submittedUsed: rollup
        ? toUnit(rollup.submittedUsed, rollup.unit)
        : toUnit(submittedFills[index], resolveCellUnit(facility, index, "fill")),
      // An admin-declared cell: `used` is their base plus everything recorded
      // since, and `derivedTotal` is what the submissions alone would say.
      overridden: rollup ? !!rollup.overridden : facility?.cellFillOverridden?.[index] === true,
      overrideBase: rollup?.overrideBase != null ? toUnit(rollup.overrideBase, rollup.unit) : null,
      postOverrideSubmitted:
        rollup?.postOverrideSubmitted != null ? toUnit(rollup.postOverrideSubmitted, rollup.unit) : null,
      derivedTotal: rollup?.derivedTotal != null ? toUnit(rollup.derivedTotal, rollup.unit) : null,
      capacity,
      remaining: capacity > 0 ? Math.max(0, capacity - used) : null,
      unit,
      pct,
      isActive: isActiveCellStatus(status),
      fromRollup: !!rollup,
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
    /* Summary Overview tiles are STATIC.
       Removing only the icon pulse left three other moving parts, which is why
       the card still read as animated:
         - summaryTileIn: every tile slid up and faded in on each render, and
           because the memo re-runs on filter/refresh it replayed on data changes,
           not just on first paint;
         - transform: translateY(-4px) on hover, with a 0.25s transition, so the
           tile jumped under the pointer;
         - will-change: transform, which only exists to prep that animation.
       All three are gone. The hover box-shadow stays: it is a flat state change
       with no transition, so the tile reacts to the pointer without moving.
       NOTE: this is a template literal — no backticks in these comments. */
    .summary-tile {
      border-radius: 12px;
      overflow: hidden;
      position: relative;
      min-height: 132px;
    }
    .summary-tile .ant-card-head {
      min-height: 42px;
      padding: 0 16px;
    }
    .summary-tile .ant-card-body {
      min-height: 88px;
      display: flex;
      align-items: center;
    }
    .summary-tile:hover {
      box-shadow: 0 10px 24px rgba(0,0,0,0.12);
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
    }
    /* Compact variant — Summary Overview now fits every submission status AND
       the waste breakdown on one line, which only works if each tile gives up
       some of its padding. */
    .summary-tile-icon.is-compact {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      font-size: 15px;
    }
    /* The separator between the submission counts and the waste figures. It
       stretches to the row rather than sitting at a fixed height, and turns
       HORIZONTAL once the row wraps — a vertical rule between two stacked
       groups points the wrong way. */
    .summary-group-divider {
      align-self: stretch;
      width: 1px;
      background: rgba(140, 140, 140, 0.28);
      margin: 0 2px;
      flex: 0 0 1px;
    }
    @media (max-width: 991px) {
      .summary-group-divider {
        width: 100%;
        height: 1px;
        flex-basis: 100%;
        margin: 2px 0;
      }
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

// Renders an integer. Static by design.
//
// This used to ride a requestAnimationFrame loop counting 0 → target over 900ms.
// It re-ran on every change of `target`, and the tiles it feeds are driven by
// `totals`, which recomputes on each filter keystroke, status change, refresh and
// socket update — so the figures were rolling constantly, not just on first
// paint. It was also the loudest of the animations left in the Summary Overview
// card after the icon pulse was removed.
//
// Kept as a component (rather than inlining `.toLocaleString()` at five call
// sites) so the tiles keep their existing markup and the `style` prop still
// applies. The `duration` prop is accepted and ignored so no caller breaks.
function CountUp({ value = 0, style }) {
  return <span style={style}>{(Number(value) || 0).toLocaleString()}</span>;
}

// Compact metric used inside grouped summary cards (no card chrome of its own,
// so several sit cleanly within one grouped Card).
/**
 * Every submission status, and how it is shown in Summary Overview.
 *
 * WHY A LIST RATHER THAN HARDCODED TILES. The card used to render Acknowledged
 * and Pending only, while `totals.statuses` had been accumulating `reverted`,
 * `rejected` and `revert_requested` all along. The counts were computed, correct,
 * and invisible — so the card read "732 total, 705 acknowledged, 1 pending" and
 * simply did not add up, with nothing to say where the other 26 had gone (they
 * were reverted).
 *
 * Deriving the tiles from this list means a status can never be silently dropped
 * again: anything here gets a tile, and anything NOT here is caught by the
 * unaccounted check below rather than disappearing.
 */
const SUBMISSION_STATUS_TILES = [
  {
    key: "acknowledged",
    label: "Acknowledged",
    subtitle: "Reviewed & accepted",
    color: "#389e0d",
    icon: <CheckCircleOutlined />,
  },
  {
    key: "pending",
    label: "Pending",
    subtitle: "Awaiting admin action",
    color: "#d48806",
    icon: <ClockCircleOutlined />,
  },
  {
    key: "reverted",
    label: "Reverted",
    subtitle: "Sent back for correction",
    color: "#cf1322",
    icon: <UndoOutlined />,
  },
  {
    key: "rejected",
    label: "Rejected",
    subtitle: "Not accepted",
    color: "#8c8c8c",
    icon: <CloseCircleOutlined />,
  },
  {
    // A portal user has ASKED for a revert and no admin has acted yet. A distinct
    // status server-side, so it needs its own tile or it lands in the
    // unaccounted bucket. Hidden when zero — it is the rarest of the five and an
    // always-zero tile is noise.
    key: "revert_requested",
    label: "Revert Requested",
    subtitle: "Portal user awaiting approval",
    color: "#722ed1",
    icon: <ExclamationCircleOutlined />,
    hideWhenZero: true,
  },
];

/**
 * `compact` shrinks the icon, the value and the label so a tile fits a shared
 * row. The SUBTITLE is dropped rather than shrunk: at this size it is the first
 * thing that becomes unreadable, and it is explanatory rather than load-bearing —
 * so it moves to the tile's tooltip, where it is still reachable.
 */
function MiniStat({ icon, color, label, children, subtitle, compact = false }) {
  const body = (
    <div style={{ display: "flex", gap: compact ? 8 : 10, alignItems: "flex-start" }}>
      <span
        className={`summary-tile-icon${compact ? " is-compact" : ""}`}
        style={{ background: `${color}1f`, color, flexShrink: 0 }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <Text
          type="secondary"
          style={{
            fontSize: compact ? 11 : 12,
            display: "block",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </Text>
        <div
          style={{
            fontSize: compact ? 17 : 20,
            fontWeight: 700,
            color,
            lineHeight: 1.25,
            marginTop: 2,
            wordBreak: "break-word",
          }}
        >
          {children}
        </div>
        {subtitle && !compact && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {subtitle}
          </Text>
        )}
      </div>
    </div>
  );
  return compact && subtitle ? <Tooltip title={subtitle}>{body}</Tooltip> : body;
}

/**
 * The record's free-text remark, as a STRING that is always safe to render.
 *
 * `remarks` carries two different things in this app: the record's own free-text
 * remark (what this panel wants), and — on admin submissions-TABLE rows — a
 * derived array of `{ text, level }` review flags. Rendering the array as a React
 * child throws "Objects are not valid as a React child" and takes the whole page
 * down with it, which is what happened here when a list response started carrying
 * the derived shape.
 *
 * The server no longer sends the array on this read, but a display path should not
 * be able to crash a page over the shape of one optional field, so both are
 * handled: an array is flattened to its text, anything non-string is ignored.
 */
const remarkText = (record = {}) => {
  const { remarks } = record;
  if (Array.isArray(remarks)) {
    const joined = remarks
      .map((entry) => (typeof entry === "string" ? entry : entry?.text))
      .filter(Boolean)
      .join(" · ");
    if (joined) return joined;
  } else if (typeof remarks === "string" && remarks.trim()) {
    return remarks;
  }
  const fallback = record.resubmitComment || record.revertReason;
  return typeof fallback === "string" && fallback.trim() ? fallback : "";
};

export default function SubmissionSummary({ isDark }) {
  const [tiles, setTiles] = useState(null);
  const [slfRows, setSlfRows] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refLoading, setRefLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarRecord, setCalendarRecord] = useState(null);
  // facilityId → the server's canonical per-cell rollup (GET
  // /data-slf/cell-occupancy = utils/cellOccupancy.js, the SAME function that
  // writes SlfFacility.cellFillValues). This page reads it rather than deriving
  // its own figures, so the cell table here cannot disagree with the SLF Data
  // Table, Cell Infrastructure or the portal. See buildCellStatusRows.
  const [cellOccupancy, setCellOccupancy] = useState({});
  // Drives the Waste Cell Breakdown's own loading state — the rollup arrives on a
  // different request from the summary rows, so it needs its own flag.
  const [occupancyLoading, setOccupancyLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarDate, setCalendarDate] = useState(dayjs());
  // Item #2: Daily Submission Details modal (opens when a calendar date is clicked).
  const [dailyOpen, setDailyOpen] = useState(false);
  // #4: disposal-calendar export — a custom date range, or "Export All" from the
  // first recorded submission.
  const [exportRange, setExportRange] = useState(null);
  const [portalUsers, setPortalUsers] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);
  const reportOpenRef = useRef(false);
  useEffect(() => {
    reportOpenRef.current = reportOpen;
  }, [reportOpen]);
  // The PDF report must never render from this page's cached page-state: the
  // summary/reference fetches sit behind a 10-minute TTL, so opening the report
  // straight from state could publish figures that are up to a TTL old. The
  // report button force-refreshes both fetchers and pulls the two datasets the
  // page itself never loads (announcements + recent changes) before opening.
  const [reportLoading, setReportLoading] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [recentChanges, setRecentChanges] = useState([]);

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
      setCellOccupancy({});
      setTiles(null);
    };
  }, []);

  const fetchRecords = useCallback(async ({ force = false, silent = false } = {}) => {
    await fetchWithCache(
      SUMMARY_CACHE_KEY,
      async () => {
        const summaryRes = await api.get("/data-slf/summary-dashboard");
        return {
          tiles: summaryRes.data?.tiles || null,
          rows: Array.isArray(summaryRes.data?.rows) ? summaryRes.data.rows : [],
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

  // Facility/baseline reference data is only needed for the calendar modal —
  // load it separately so the tiles + table render immediately.
  //
  // `/settings/app` used to be fetched here for one flag,
  // `excludePreBaselineDisposalFromCellFill`, which the page applied to its own
  // cell-fill derivation. That derivation is gone: the server applies the rule
  // inside the one shared calculation before the rollup is sent, so re-reading
  // the flag here could only produce a second, disagreeing opinion.
  const fetchReferenceData = useCallback(async ({ force = false } = {}) => {
    await fetchWithCache(
      `${SUMMARY_CACHE_KEY}:ref`,
      async () => {
        const [facilitiesRes, baselinesRes, portalUsersRes] = await Promise.all([
          api.get("/slf-facilities"),
          api.get("/data-slf/baselines"),
          api.get("/portal-users").catch(() => ({ data: [] })),
        ]);
        // Defensive: keep dummy/test facilities and accounts out of the summary
        // (backend already excludes them from these endpoints by default).
        return {
          facilities: excludeDummy(Array.isArray(facilitiesRes.data) ? facilitiesRes.data : []),
          baselines: Array.isArray(baselinesRes.data) ? baselinesRes.data : [],
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

  // "Generate PDF Report" — reuses the page's own fetchers with { force: true } so
  // the report is built from a fresh read of the same endpoints the UI renders
  // from (no second aggregation, no divergent source of truth). Announcements and
  // recent changes are not part of page state, so they are fetched here; both are
  // best-effort — a failure degrades that one section rather than blocking the
  // report. Response shapes are normalised exactly as the Generate Reports tab
  // does, since these endpoints may answer with an array or a wrapped object.
  const openReport = useCallback(async () => {
    setReportLoading(true);
    try {
      // Every fetch is best-effort. fetchWithCache RETHROWS when `force` is set and
      // the request fails, so an unguarded Promise.all would reject and the report
      // would not open at all — worse than the stale-data behaviour this replaces.
      // On failure the existing page state (and each fetcher's own onError) stands
      // and the report still opens.
      const [, , annRes, txnRes] = await Promise.all([
        fetchRecords({ force: true, silent: true }).catch(() => null),
        fetchReferenceData({ force: true }).catch(() => null),
        api.get("/settings/app/portal-announcements").catch(() => ({ data: [] })),
        api.get("/transactions", { params: { limit: 25 } }).catch(() => ({ data: [] })),
      ]);
      if (!aliveRef.current) return;
      const annData = annRes.data;
      setAnnouncements(
        Array.isArray(annData)
          ? annData
          : annData?.items || annData?.data || (annData ? [annData] : []),
      );
      const txnData = txnRes.data;
      // GET /transactions answers { transactions, total, page, limit }. Reading
      // only `.data`/`.items` left the report's Recent Changes permanently empty.
      setRecentChanges(
        Array.isArray(txnData) ? txnData : txnData?.transactions || txnData?.data || txnData?.items || [],
      );
      setReportOpen(true);
    } finally {
      if (aliveRef.current) setReportLoading(false);
    }
  }, [fetchRecords, fetchReferenceData]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      // "facility" belongs here: it is what refreshFacilityCellOccupancy emits
      // after a placement is organized, moved or corrected, and what the SLF
      // facility editor emits after an admin declares a Waste in Cell. Listening
      // only for submissions/baselines left this page showing pre-move figures
      // until something else happened to refresh it.
      if (!target || ["submissions", "baselines", "facility"].includes(target)) {
        invalidateCache(SUMMARY_CACHE_KEY);
        fetchRecords({ force: true, silent: true });
        fetchReferenceData({ force: true });
        // An open PDF report reads "Recent Portal / Admin Changes" from a list
        // fetched once when it opened; re-read it so the report keeps up with
        // portal submissions while it is on screen.
        if (reportOpenRef.current) {
          api
            .get("/transactions", { params: { limit: 25 } })
            .then(({ data }) => {
              if (!aliveRef.current) return;
              setRecentChanges(Array.isArray(data) ? data : data?.transactions || data?.data || data?.items || []);
            })
            .catch(() => {});
        }
      }
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [fetchRecords, fetchReferenceData]);

  // The facility whose cells the open calendar is showing. Derived as a plain
  // STRING so the effect below can depend on it: `calendarRecord` is re-seated
  // with its submissions once they load, and depending on that OBJECT would fire
  // a second identical rollup request every time the modal opened.
  const calendarFacilityId = useMemo(
    () =>
      String(
        calendarRecord?.facility?._id ||
          calendarRecord?.slfGenerator?._id ||
          calendarRecord?.slfGenerator ||
          "",
      ),
    [calendarRecord],
  );

  // The canonical per-cell rollup. Loaded only while the disposal calendar is
  // open — it is the only thing on this page that reads per-cell figures — and
  // refreshed when a submission, baseline or facility write reports in.
  //
  // The `seq` guard is not the same thing as the unmount guard: a burst of
  // writes can leave two loads in flight, and TCP does not promise they come
  // back in order. Without it a slower EARLIER response can land last and
  // reinstate the figures the newer one just corrected — a stale table that no
  // amount of refetching fixes because the refetch itself caused it.
  // Loads on MOUNT, not on `calendarFacilityId`.
  //
  // This rollup used to be fetched only when an SLF's disposal calendar was
  // opened, because the calendar was its only consumer. The Waste Cell Breakdown
  // reads the same rollup, so gating it on a modal would have left that section
  // permanently empty until someone happened to open a calendar.
  //
  // One request covers every facility (GET /data-slf/cell-occupancy returns
  // `byFacility`, server-cached for 60s), so page-wide loading costs the same
  // single call the calendar already made.
  useEffect(() => {
    let cancelled = false;
    let seq = 0;
    let latest = 0;
    let timer = null;
    const load = () => {
      const mine = (seq += 1);
      setOccupancyLoading(true);
      api
        .get("/data-slf/cell-occupancy")
        .then(({ data }) => {
          if (cancelled || mine < latest) return;
          latest = mine;
          setCellOccupancy(data?.byFacility || {});
        })
        .catch(() => {
          // Non-fatal: buildCellStatusRows falls back to the persisted output of
          // the same server calculation.
        })
        .finally(() => {
          if (!cancelled && mine >= latest) setOccupancyLoading(false);
        });
    };
    load();
    const socket = getSocket();
    // TASK 5.6 — a portal submission emits `data-refresh` with target
    // "submissions", which lands here and refetches the rollup, so the breakdown
    // follows new submissions without a page reload and without a polling timer.
    const onRefresh = ({ target } = {}) => {
      if (target && !["submissions", "baselines", "facility"].includes(target)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 800); // collapse a burst of writes into one refetch
    };
    socket?.on("data-refresh", onRefresh);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      socket?.off("data-refresh", onRefresh);
    };
  }, []);

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
    // A TIE IS NOT AN m³ MAJORITY.
    //
    // `counts.tons > counts["m³"] ? "tons" : "m³"` sent every non-win to m³,
    // including an exact draw — so on a dead-even split the page silently
    // rendered everything in m³ despite no majority existing.
    //
    // This is a SAFETY NET, not the fix for the reported unit flipping. That was
    // caused by an unordered `$first` on the server picking each facility's
    // `baselineUnit` at random (see the $sort in /summary-dashboard); with the
    // ordering in place the vote is a real 9-7 majority and never reaches the
    // branch below. It stays because a genuine tie is still possible as
    // facilities are added, and defaulting that to m³ would be arbitrary in the
    // same way. Tons is the unit the facilities' own regulatory reporting uses,
    // and the two are kept in lockstep upstream, so it is the same measurement
    // either way. A real majority still wins on either side.
    if (counts.tons === counts["m³"]) return counts.tons > 0 ? "tons" : "m³";
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


  /**
   * TASK 5 — Waste Cell Breakdown: baseline vs submitted volume, per cell.
   *
   * ── Why this computes nothing ────────────────────────────────────────────────
   * Every figure here comes from `buildCellStatusRows`, which reads the server
   * rollup (GET /data-slf/cell-occupancy → utils/cellOccupancy.js). That is the
   * SAME function whose output writes SlfFacility.cellFillValues and feeds the
   * SLF Data Table, Cell Infrastructure, Waste in Cell and the portal's own
   * gauges. Deriving the split here would have made a FIFTH implementation of a
   * calculation that already exists once — the exact mistake the long comment on
   * buildCellStatusRows documents.
   *
   * So the business rules below are inherited, not re-stated:
   *   • BASELINE (5.2) is the newest entry that actually carries baseline
   *     figures, placed per `activeCellEntries[].cellName`. It is never derived
   *     from submissions, and the entry chosen as the baseline is excluded from
   *     the submission set by `_id`, so it cannot be counted twice (6.3).
   *   • SUBMISSIONS (5.3) counts only statuses pending / acknowledged /
   *     revert_requested — so rejected and reverted are excluded — and only
   *     volume the operator explicitly placed in a cell. Unplaced volume is
   *     reported separately rather than guessed into the first open cell.
   *   • TOTAL (5.4) is the rollup's own `used`, NOT baseline + submitted summed
   *     here. For an admin-overridden cell those are not the same number: `used`
   *     is the declared base plus what arrived after it, and `derivedTotal` is
   *     what the data alone would say. Re-adding the columns would have silently
   *     contradicted the override.
   */
  const wasteCellBreakdown = useMemo(() => {
    return summaryRows
      .map((row) => {
        // ── Join on slfGenerator FIRST ──────────────────────────────────────
        // `row.facility` is resolved by NAME (facilityMap keys on the facility's
        // lgu / province / slfName), and SlfFacility has no `slfName` field at
        // all — so that lookup is unreliable and can even land on a different
        // facility whose province happens to match this row's name. Keying on
        // the row's own `slfGenerator`, which /summary-dashboard carries through
        // its $group, matches exactly how the server keys `byFacility`. The
        // name-resolved facility stays as the fallback for legacy rows that have
        // no generator id.
        const genId =
          row?.slfGenerator && typeof row.slfGenerator === "object"
            ? row.slfGenerator._id
            : row?.slfGenerator;
        const facilityId = genId
          ? String(genId)
          : row.facility?._id
            ? String(row.facility._id)
            : null;
        const occupancy = facilityId ? cellOccupancy[facilityId] : null;
        // `buildCellStatusRows` needs a facility for its fallback path, so hand
        // it the resolved one — but when the rollup is present it supplies every
        // figure and the facility is only used for names/capacities.
        const source = row.facility
          ? row
          : { ...row, facility: facilityById.get(String(facilityId)) || null };
        // A cell is "applicable" when it has capacity declared or any volume
        // recorded; a placeholder cell with neither is noise.
        const cells = buildCellStatusRows(source, occupancy).filter(
          (cell) =>
            cell.capacity > 0 || cell.used > 0 || cell.baselineUsed > 0 || cell.submittedUsed > 0,
        );
        if (!cells.length) return null;
        const totals = cells.reduce(
          (acc, cell) => ({
            baseline: acc.baseline + Number(cell.baselineUsed || 0),
            submitted: acc.submitted + Number(cell.submittedUsed || 0),
            total: acc.total + Number(cell.used || 0),
          }),
          { baseline: 0, submitted: 0, total: 0 },
        );
        return {
          key: row.key,
          slfName: row.slfName,
          unit: occupancy?.unit || cells[0]?.unit || "m³",
          // Volume received but not yet organised into a cell. Surfaced so the
          // per-cell figures visibly reconcile with the facility total instead of
          // appearing to lose waste.
          unplaced: Number(occupancy?.totals?.unplaced || 0),
          cells,
          totals,
          // False when the rollup was unavailable and the rows fell back to the
          // persisted copy — worth saying rather than presenting stale figures as
          // live ones.
          fromRollup: !!occupancy,
        };
      })
      .filter(Boolean);
  }, [summaryRows, cellOccupancy, facilityById]);

  // Keyed for O(1) lookup from the table's expandable row renderer, which runs
  // per visible row on every render.
  const breakdownByKey = useMemo(
    () => new Map(wasteCellBreakdown.map((slf) => [slf.key, slf])),
    [wasteCellBreakdown],
  );

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
      const isResub = isResubmissionRecord(record);
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

      // Per-waste-entry breakdown for the modal — one row per truck/vehicle load,
      // each carrying its own hauler, waste type, volume + unit and cell.
      const wasteEntries = buildSubmissionWasteEntries(record, {
        slfName: calendarRecord?.slfName || record.slfName,
        fallbackUnit: facUnit,
      });

      return {
        record, totalVol, tons, m3, unit, isResub, acknowledged, nonOperational, issues,
        wasteEntries,
        volumeSummary: formatWasteEntryTotals(wasteEntries, unit),
      };
    });

    const issueCount = rows.reduce((n, r) => n + r.issues.length, 0);
    return { rows, facility, facUnit, nonOperational, issueCount };
  }, [selectedDayRecords, calendarFacility, calendarRecord?.slfName]);

  const selectedCellRows = useMemo(() => {
    if (!calendarRecord) return [];
    return buildCellStatusRows(calendarRecord, cellOccupancy[calendarFacilityId] || null);
  }, [calendarRecord, calendarFacilityId, cellOccupancy]);

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
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    // One row per WASTE ENTRY, not one per submission. Every volume ships with its
    // own Unit of Measurement column plus a normalized column in the SLF's declared
    // unit, so no exported quantity is ambiguous. The SLF name comes from the
    // calendar row, which the server now resolves from the canonical facility
    // record — so a renamed/duplicated name can no longer produce two sets of rows
    // for the same facility.
    const header = [
      "SLF Name",
      "Submission Date",
      "Submission ID",
      "Generator",
      "Hauler",
      "Plate No.",
      "Waste Type",
      "Waste Volume",
      "Unit of Measurement",
      `Volume (${unit})`,
      "Cell",
      "Status",
    ];
    const seenEntryKeys = new Set();
    const rows = filtered
      .slice()
      .sort((a, b) => dayjs(a.dateOfDisposal).valueOf() - dayjs(b.dateOfDisposal).valueOf())
      .flatMap((record) =>
        buildSubmissionWasteEntries(record, {
          slfName: calendarRecord.slfName || record.slfName,
          fallbackUnit: unit,
        })
          // Guard against the same underlying entry being emitted twice if a
          // record were ever fetched under two identities.
          .filter((entry) => {
            if (seenEntryKeys.has(entry.key)) return false;
            seenEntryKeys.add(entry.key);
            return true;
          })
          .map((entry) => {
            const normalized = convertVolume(entry.volume, entry.unit, unit);
            return [
              entry.slfName,
              entry.date ? dayjs(entry.date).format("YYYY-MM-DD") : "",
              entry.submissionId,
              record.lguCompanyName || record.companyName || "",
              entry.hauler || "",
              entry.plateNumber || "",
              entry.wasteType || "",
              entry.volume == null ? "" : Number(entry.volume.toFixed(2)),
              // Never blank when a volume is present — an unlabelled quantity is
              // exactly what this column exists to prevent.
              entry.volume == null ? "" : entry.unit || "unit not recorded",
              normalized == null ? "" : Number(normalized.toFixed(2)),
              entry.cell || "Unplaced",
              entry.status || "pending",
            ]
              .map(esc)
              .join(",");
          }),
      );
    if (rows.length === 0) {
      Modal.info({ title: "Nothing to export", content: "No waste entries fall in the selected range." });
      return;
    }
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

  // The status tiles actually rendered, and whatever the itemised ones fail to
  // account for.
  //
  // `unaccountedSubmissions` is the safety net that makes this card honest: if
  // the server ever reports a status these tiles do not name, the difference
  // surfaces as "Other" instead of the total quietly exceeding the sum of its
  // parts — which is precisely how 26 reverted submissions went missing here.
  // Floored at zero: a per-facility filter can trim the rows the statuses come
  // from, and a negative "Other" would be nonsense rather than informative.
  const statusTiles = useMemo(
    () =>
      SUBMISSION_STATUS_TILES.map((tile) => ({
        ...tile,
        count: Number(totals.statuses?.[tile.key] || 0),
      })).filter((tile) => !tile.hideWhenZero || tile.count > 0),
    [totals.statuses],
  );

  const unaccountedSubmissions = useMemo(() => {
    const itemised = SUBMISSION_STATUS_TILES.reduce(
      (sum, tile) => sum + Number(totals.statuses?.[tile.key] || 0),
      0,
    );
    return Math.max(0, Number(totals.submissions || 0) - itemised);
  }, [totals.statuses, totals.submissions]);

  // Detail-heavy records (trucks, calendar) are loaded only when an SLF's
  // calendar is opened — not on initial page render.
  const openCalendar = useCallback(async (row) => {
    setCalendarRecord({ ...row, records: [] });
    setCalendarDate(row.lastDisposalDate || dayjs());
    setCalendarLoading(true);
    try {
      const genId = row.slfGenerator?._id || row.slfGenerator || undefined;
      // Paged: server-side scoping keeps this to one SLF, but a busy facility
      // still runs to hundreds of records with their trucks attached, which is
      // more than one response should carry.
      const records = await fetchAllSubmissions({
        includeTrucks: true,
        // Scope server-side by facility id when known (fast, exact); otherwise
        // fall back to a name search. This keeps the calendar from downloading
        // every SLF's records + trucks on open.
        ...(genId ? { slfGenerator: genId } : { search: row.slfName }),
      });
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
            // ONE row: submission counts, a separator, then the waste figures.
            // Everything sits DIRECTLY in the Summary Overview card — the two
            // inner cards that used to wrap these groups were titled boxes inside
            // an already-titled collapsible, costing a row of chrome each and
            // splitting a single overview across two panels. Flat and compact,
            // the whole summary reads on one line.
            //
            // Every status gets a tile (SUBMISSION_STATUS_TILES) plus an
            // unaccounted check, so the figures always add up to Total
            // Submissions. They previously did not: Acknowledged and Pending were
            // the only statuses shown, and the reverted ones simply went missing
            // from the arithmetic.
            children: (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "stretch",
          gap: 12,
          rowGap: 14,
        }}
      >
        <MiniStat
          compact
          icon={<InboxOutlined />}
          color="#13c2c2"
          label="Total Submissions"
          subtitle="All statuses combined"
        >
          <CountUp value={totals.submissions} />
        </MiniStat>
        {statusTiles.map((tile) => (
          <MiniStat
            compact
            key={tile.key}
            icon={tile.icon}
            color={tile.color}
            label={tile.label}
            subtitle={tile.subtitle}
          >
            <CountUp value={tile.count} />
          </MiniStat>
        ))}
        {/* Only ever appears when the parts do not sum to the whole — a status
            the server reports that this card does not know about yet. Without
            it, such a status would go missing silently, which is the exact
            defect this card had. */}
        {unaccountedSubmissions > 0 && (
          <MiniStat
            compact
            icon={<QuestionCircleOutlined />}
            color="#fa541c"
            label="Other"
            subtitle="Status not itemised above"
          >
            <CountUp value={unaccountedSubmissions} />
          </MiniStat>
        )}
        <MiniStat
          compact
          icon={<BankOutlined />}
          color="#2f54eb"
          label="Reporting SLFs"
          subtitle="Facilities with submissions"
        >
          <CountUp value={filteredRows.length} />
        </MiniStat>
        <MiniStat
          compact
          icon={<CarOutlined />}
          color="#fa8c16"
          label="Truck Entries"
          // Named for what it actually counts. "Total disposal trips" was
          // ambiguous against the per-vehicle rows inside each entry, which is a
          // different (smaller) number.
          subtitle="Transport entries in all submissions"
        >
          <CountUp value={totals.trucks} />
        </MiniStat>

        <span className="summary-group-divider" aria-hidden="true" />

        {/* Waste Breakdown. Counts of submissions on the left of the separator,
            VOLUMES on the right — the divider is what keeps two different units
            of measure from reading as one continuous series of figures.
            Hazardous uses the safe formatter so a valid-but-empty value reads
            "0" rather than "-". */}
        <MiniStat
          compact
          icon={<ExperimentOutlined />}
          color="#52c41a"
          label="Residual Waste"
          subtitle="Non-hazardous volume"
        >
          {formatVolumeSafe(totals.residualM3, totals.residualTons, displayUnit)}
        </MiniStat>
        <MiniStat
          compact
          icon={<WarningOutlined />}
          color="#cf1322"
          label="Hazardous Waste"
          subtitle="Treated hazardous volume"
        >
          {formatVolumeSafe(totals.hazardousM3, totals.hazardousTons, displayUnit)}
        </MiniStat>
      </div>
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
                <Button type="primary" icon={<FilePdfOutlined />} loading={reportLoading} onClick={openReport}>Generate PDF Report</Button>
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
            defaultPageSize: 20,
            showSizeChanger: true,
            pageSizeOptions: ["20", "30", "50", "100"],
            showTotal: (total) => `${total} SLF summary row(s)`,
          }}
          scroll={{ x: 1420 }}
          locale={{ emptyText: <Empty description="No submissions to summarize" /> }}
          // ── Waste Cell Breakdown, merged into THIS table ────────────────────
          // It was previously a separate Collapse under the table, which meant
          // finding an SLF's cells required locating the same facility a second
          // time in a second list. Expanding its own row keeps the per-cell split
          // attached to the SLF it belongs to.
          expandable={{
            // Stay expandable while the rollup is still in flight, so the row
            // offers a spinner rather than silently refusing to open.
            rowExpandable: (row) => !!breakdownByKey.get(row.key) || occupancyLoading,
            expandedRowRender: (row) => {
              const slf = breakdownByKey.get(row.key);
              if (!slf) {
                return occupancyLoading ? (
                  <div style={{ padding: "12px 0", textAlign: "center" }}>
                    <Spin size="small" />
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No cells with recorded capacity or volume for this SLF"
                    style={{ margin: "8px 0" }}
                  />
                );
              }
              return (
                <div style={{ padding: "4px 0 4px 8px" }}>
                  <Space wrap size={6} style={{ marginBottom: 8 }}>
                    <Text strong style={{ fontSize: 12, color: ACCENT }}>
                      Waste Cell Breakdown
                    </Text>
                    <Tag color="default" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                      {slf.cells.length} cell{slf.cells.length === 1 ? "" : "s"}
                    </Tag>
                    {slf.unplaced > 0 && (
                      <Tooltip title="Received but not yet organised into a cell, so it is not in any row below.">
                        <Tag color="warning" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                          {formatVolumeValue(slf.unplaced)} {slf.unit} unassigned
                        </Tag>
                      </Tooltip>
                    )}
                    {!slf.fromRollup && (
                      <Tooltip title="The live rollup could not be reached; these are the last persisted figures from the same calculation.">
                        <Tag color="default" style={{ fontSize: 11, marginInlineEnd: 0 }}>cached</Tag>
                      </Tooltip>
                    )}
                  </Space>
                  <Table
                    size="small"
                    rowKey="key"
                    dataSource={slf.cells}
                    pagination={false}
                    scroll={{ x: 420 }}
                    summary={(rows) => {
                      const sum = (pick) => rows.reduce((n, r) => n + Number(pick(r) || 0), 0);
                      return (
                        <Table.Summary.Row style={{ fontWeight: 600 }}>
                          <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right">
                            {formatVolumeValue(sum((r) => r.baselineUsed)) || "0"}
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="right">
                            {formatVolumeValue(sum((r) => r.submittedUsed)) || "0"}
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={3} align="right">
                            {formatVolumeValue(sum((r) => r.used)) || "0"}
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      );
                    }}
                    columns={[
                      {
                        title: "Cell",
                        dataIndex: "cell",
                        ellipsis: true,
                        render: (value, cell) => (
                          <Space size={4} wrap>
                            <Text style={{ fontSize: 12 }}>{value}</Text>
                            {cell.overridden && (
                              <Tooltip
                                title={`An admin declared this cell's figure, so Total is not Baseline + Submissions. Data alone would report ${
                                  formatVolumeValue(cell.derivedTotal) || "0"
                                } ${slf.unit}.`}
                              >
                                <Tag color="purple" style={{ fontSize: 10, marginInlineEnd: 0 }}>
                                  declared
                                </Tag>
                              </Tooltip>
                            )}
                          </Space>
                        ),
                      },
                      {
                        title: `Baseline (${slf.unit})`,
                        dataIndex: "baselineUsed",
                        width: 116,
                        align: "right",
                        render: (v) => <Text style={{ fontSize: 12 }}>{formatVolumeValue(v) || "0"}</Text>,
                      },
                      {
                        title: `Submissions (${slf.unit})`,
                        dataIndex: "submittedUsed",
                        width: 130,
                        align: "right",
                        render: (v) => <Text style={{ fontSize: 12 }}>{formatVolumeValue(v) || "0"}</Text>,
                      },
                      {
                        title: `Total (${slf.unit})`,
                        dataIndex: "used",
                        width: 116,
                        align: "right",
                        render: (v) => (
                          <Text strong style={{ fontSize: 12 }}>
                            {formatVolumeValue(v) || "0"}
                          </Text>
                        ),
                      },
                    ]}
                  />
                </div>
              );
            },
          }}
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
        // Vertical scroll only: the content is laid out to FIT the modal width
        // (the right-hand tables use .slf-detail-fit), so there is no sideways
        // scrollbar.
        styles={{ body: { maxHeight: "calc(100vh - 150px)", overflowY: "auto", overflowX: "hidden" } }}
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
                  /* FullCalendar's "+more" popover defaults to z-index 9999, which
                     paints ABOVE the antd Daily Details modal (z-index ~1000). Cap it
                     back INTO the antd scale so the modal always wins — no arbitrary
                     escalation of the modal's z-index. Sticky header stays below too. */
                  .submission-fc .fc-popover { z-index: 900 !important; }
                  .submission-fc .fc-scrollgrid-section-sticky > * { z-index: 1 !important; }
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
                  // Fits its half of the modal: fixed layout, percentage widths,
                  // long values wrap (.slf-detail-fit in index.css) — the global
                  // max-content table width made it push the modal sideways.
                  className="slf-detail-fit"
                  tableLayout="fixed"
                  columns={[
                    { title: "Cell", dataIndex: "cell", width: "18%", render: (value, row) => <Text strong={row.isActive}>{value}</Text> },
                    { title: "Status", dataIndex: "status", width: "20%", render: (value, row) => <Tag color={row.isActive ? "green" : "default"}>{value || "—"}</Tag> },
                    {
                      title: "Fill",
                      width: "32%",
                      // Where the figure came from, not just the figure. An
                      // admin-declared cell is labelled as such with its base and
                      // what has been recorded since, because the derived
                      // baseline/submitted split does not add up to a declared
                      // number and showing it as if it did would be misleading.
                      render: (_, row) => (
                        <Space direction="vertical" size={0}>
                          <Text>{row.used.toLocaleString(undefined, { maximumFractionDigits: 2 })} {row.unit}</Text>
                          {row.pct != null && <Text type="secondary" style={{ fontSize: 11 }}>{row.pct}% full</Text>}
                          {row.overridden ? (
                            <Space size={4} wrap>
                              <Tag color="purple" style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: "16px" }}>
                                Admin-set
                              </Tag>
                              {row.overrideBase != null && (
                                <Text type="secondary" style={{ fontSize: 10 }}>
                                  {row.overrideBase.toLocaleString(undefined, { maximumFractionDigits: 2 })} declared
                                  {row.postOverrideSubmitted > 0
                                    ? ` + ${row.postOverrideSubmitted.toLocaleString(undefined, { maximumFractionDigits: 2 })} since`
                                    : ""}
                                </Text>
                              )}
                            </Space>
                          ) : (
                            row.used > 0 && (
                              <Text type="secondary" style={{ fontSize: 10 }}>
                                {row.baselineUsed.toLocaleString(undefined, { maximumFractionDigits: 2 })} baseline ·{" "}
                                {row.submittedUsed.toLocaleString(undefined, { maximumFractionDigits: 2 })} submitted
                              </Text>
                            )
                          )}
                        </Space>
                      ),
                    },
                    {
                      title: "Remaining",
                      width: "30%",
                      // #4: compact gauge beside the remaining figure showing the
                      // active cell's utilization at a glance.
                      render: (_, row) => (
                        <Space size={8} align="center" wrap>
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
                  className="slf-detail-fit"
                  tableLayout="fixed"
                  columns={[
                    { title: "ID", dataIndex: "idNo", width: "24%", render: (value, record) => <Text strong>{value || record.submissionId || "No ID"}</Text> },
                    { title: "Generator", width: "28%", dataIndex: "lguCompanyName", render: (value, record) => value || record.companyName || record.generatorName || "Not encoded" },
                    { title: "Trucks", width: "12%", align: "center", render: (_, record) => record.trucks?.length || 0 },
                    {
                      title: "Volume",
                      width: "18%",
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
                    { title: "Status", dataIndex: "status", width: "18%", render: (value) => <Tag color={statusColor[value] || "default"}>{value?.replace("_", " ") || "pending"}</Tag> },
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
            announcements={announcements}
            recentChanges={recentChanges}
            cellOccupancy={cellOccupancy}
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
        // Wide enough for the Waste Breakdown table's eight columns to read
        // comfortably (it was squeezed into 860px and scrolled sideways).
        width="min(1280px, 96vw)"
        centered
        // Scroll long daily details inside the modal; title + Close stay visible.
        styles={{ body: { maxHeight: "70vh", overflowY: "auto", overflowX: "hidden" } }}
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
              {selectedDayDetail.rows.map(({ record, isResub, acknowledged, issues, wasteEntries, volumeSummary }) => (
                <Card key={record._id} size="small" style={{ borderRadius: 8, borderLeft: `3px solid ${issues.length ? "#fa8c16" : "#52c41a"}` }}>
                  <Row gutter={[12, 8]}>
                    <Col xs={12} md={8}><Text type="secondary">Submission ID:</Text><br /><Text strong>{record.idNo || record.submissionId || "—"}</Text></Col>
                    <Col xs={12} md={8}><Text type="secondary">Generator:</Text><br /><Text>{record.lguCompanyName || record.companyName || record.generatorName || "—"}</Text></Col>
                    {/* Every quantity is shown with the unit it was recorded in; a
                        submission mixing units reads as "A m³ + B tons", never as one
                        ambiguous number. */}
                    <Col xs={12} md={8}><Text type="secondary">Disposal Quantity:</Text><br /><Text strong>{volumeSummary}</Text></Col>
                    <Col xs={12} md={8}><Text type="secondary">Submitted:</Text><br /><Text>{record.createdAt ? dayjs(record.createdAt).format("MMM D, YYYY h:mm A") : "—"}</Text></Col>
                    <Col xs={12} md={8}><Text type="secondary">{isResub ? "Resubmitted:" : "Last Updated:"}</Text><br /><Text>{record.updatedAt ? dayjs(record.updatedAt).format("MMM D, YYYY h:mm A") : "—"}</Text></Col>
                    <Col xs={12} md={8}>
                      <Text type="secondary">Status:</Text><br />
                      <Tag color={acknowledged ? "green" : record.status === "rejected" ? "red" : /revert/.test(record.status || "") ? "orange" : "gold"}>
                        {acknowledged ? "Acknowledged" : (record.status || "pending")}
                      </Tag>
                      {isResub && <Tag color="orange">Resubmission</Tag>}
                    </Col>
                    {remarkText(record) && (
                      <Col xs={24}><Text type="secondary">Remarks:</Text><br /><Text>{remarkText(record)}</Text></Col>
                    )}
                    {record.submittedBy && (
                      <Col xs={24} md={12}><Text type="secondary">Submitted by:</Text> <Text>{record.submittedBy}</Text></Col>
                    )}
                  </Row>

                  {/* Waste breakdown — one row per waste entry in the submission,
                      instead of the single combined value shown previously. */}
                  <div style={{ marginTop: 10 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Waste Breakdown ({wasteEntries.length} entr{wasteEntries.length === 1 ? "y" : "ies"})
                    </Text>
                    <Table
                      size="small"
                      style={{ marginTop: 6 }}
                      rowKey="key"
                      dataSource={wasteEntries}
                      pagination={wasteEntries.length > 8 ? { pageSize: 8, size: "small" } : false}
                      // Fits the modal: fixed layout + percentage widths, long
                      // values wrap (.slf-detail-fit) — no sideways scroll.
                      className="slf-detail-fit"
                      tableLayout="fixed"
                      locale={{ emptyText: "No waste entries recorded for this submission" }}
                      columns={[
                        {
                          title: "Date",
                          dataIndex: "date",
                          width: "10%",
                          render: (value) => (value ? dayjs(value).format("MMM D, YYYY") : "—"),
                        },
                        { title: "Hauler", dataIndex: "hauler", width: "15%", render: (v) => v || "—" },
                        {
                          title: "Client",
                          dataIndex: "clients",
                          width: "20%",
                          render: (clients) => {
                            const list = Array.isArray(clients) ? clients : [];
                            if (!list.length) return <Text type="secondary">No client recorded</Text>;
                            return (
                              <Space direction="vertical" size={2}>
                                {list.map((client) => (
                                  <span key={client.name}>
                                    <Text>{client.name}</Text>
                                    {client.details && <Text type="secondary"> ({client.details})</Text>}
                                  </span>
                                ))}
                              </Space>
                            );
                          },
                        },
                        {
                          title: "Waste Type",
                          dataIndex: "wasteType",
                          width: "14%",
                          render: (v) =>
                            v ? (
                              <Tag color={wasteTypeTagColor(v, "blue")}>{v}</Tag>
                            ) : (
                              "—"
                            ),
                        },
                        {
                          title: "Volume",
                          dataIndex: "volume",
                          width: "10%",
                          align: "right",
                          // A load weighed in the other unit shows its weight as
                          // entered under the converted volume.
                          render: (v, e) =>
                            v == null ? "—" : (
                              <div>
                                {v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                <div><WeighedVolumeNote entry={e} /></div>
                              </div>
                            ),
                        },
                        // The unit is its OWN column so no exported/displayed volume
                        // can ever be read without knowing what it is measured in.
                        { title: "Unit", dataIndex: "unit", width: "7%", render: (v) => v || "—" },
                        { title: "Cell", dataIndex: "cell", width: "12%", render: (v) => v || "Unplaced" },
                        {
                          title: "Status",
                          dataIndex: "status",
                          width: "12%",
                          render: (v) => (
                            <Tag color={v === "acknowledged" ? "green" : v === "rejected" ? "red" : /revert/.test(v || "") ? "orange" : "gold"}>
                              {v || "pending"}
                            </Tag>
                          ),
                        },
                      ]}
                    />
                  </div>

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
