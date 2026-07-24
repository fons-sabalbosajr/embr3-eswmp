import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Modal, Space, Spin, Table, Tag, Typography } from "antd";
import { PrinterOutlined, FileWordOutlined, FilePdfOutlined, CloseCircleOutlined, UndoOutlined } from "@ant-design/icons";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import dayjs from "dayjs";
import api from "../../api";
import { convertVolume } from "../../utils/volumeUnits";

const { Title, Text, Paragraph } = Typography;

// Mirrors the SLF-name normalisation used across the Submission Summary page so
// operator ↔ submission name matching stays consistent.
const normalizeKey = (value) =>
  String(value || "")
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\blocal\s+governm\s*ent\s+unit\b/gi, " ")
    .replace(/\blgu\b/gi, " ")
    .replace(/\bmunicipality\s+of\b/gi, " ")
    .replace(/\bcity\s+of\b/gi, " ")
    .replace(/^province\s+of\s+/i, "")
    .replace(/[‒-―-]+/g, " ")
    .replace(/[,.;:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Sample/test portal accounts excluded from every report metric, table, and
// chart. Matched case-insensitively on trimmed email / display name / username
// / company. Report-only — no DB records or submissions are touched.
const EXCLUDED_SAMPLE_EMAILS = new Set(["fonssabalbosa.27@gmail.com"]);
const EXCLUDED_SAMPLE_NAMES = new Set(["eswm portal user"]);
const normLower = (v) => String(v || "").trim().toLowerCase();
const isSampleIdentity = (value) => {
  const s = normLower(value);
  return !!s && (EXCLUDED_SAMPLE_EMAILS.has(s) || EXCLUDED_SAMPLE_NAMES.has(s));
};
const isSamplePortalUser = (u) => {
  if (!u) return false;
  if (EXCLUDED_SAMPLE_EMAILS.has(normLower(u.email))) return true;
  const fullName = normLower(`${u.firstName || ""} ${u.lastName || ""}`);
  if (EXCLUDED_SAMPLE_NAMES.has(fullName)) return true;
  if (EXCLUDED_SAMPLE_NAMES.has(normLower(u.username))) return true;
  if (EXCLUDED_SAMPLE_NAMES.has(normLower(u.companyName))) return true;
  return false;
};

// Canonical grouping key for a portal user. Shared by the operators filter, the
// operator summary table, and the per-operator cell report so a "Remove from
// Report" action in any of them targets the same merged entity. Prefixes keep a
// company and an SLF with the same name from colliding.
const computeOperatorGroupKey = (u) => {
  const company = normLower(u?.companyName);
  if (company) return `co:${normalizeKey(u.companyName)}`;
  const slf = Array.isArray(u?.assignedSlfName) && u.assignedSlfName[0] ? u.assignedSlfName[0] : "";
  if (slf) return `slf:${normalizeKey(slf)}`;
  return `op:${normalizeKey(`${u?.firstName || ""} ${u?.lastName || ""}`)}`;
};

function formatVolume(m3, tons) {
  const parts = [];
  if (m3 > 0) parts.push(`${Math.round(m3).toLocaleString()} m³`);
  if (tons > 0) parts.push(`${Math.round(tons).toLocaleString()} t`);
  return parts.length ? parts.join(" / ") : "—";
}

const PIE_COLORS = ["#2f54eb", "#d9d9d9"];
const BAR_COLOR = "#13c2c2";
const LINE_COLOR = "#722ed1";

const MONTH_LABELS = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Recent app updates rendered in the report. There is no in-app changelog /
// commit-summary source yet, so this list is maintained here from the release
// notes. When a changelog API/AppSettings field is added, source it from there
// and pass it in as a prop instead of this constant. (Entries reflect real
// shipped changes — do not add speculative items.)
const RECENT_UPDATES = {
  updates: [
    "SLF operators can now save a submission as a draft and finish it later.",
    "Submissions can be scheduled to send automatically at a chosen date and time.",
    "The admin SLF monitoring dashboard loads faster with clearer per-operator breakdowns.",
    "Portal support tickets now receive an immediate VERA first response before administrator follow-up.",
    "The Portal Submissions tab now separates true submission-entry counts from grouped table rows.",
  ],
  features: [
    "New printable SLF Data & Portal Submissions report with summary cards, charts, and tables.",
    "Reports can be exported as PDF (print) or DOCX, now including charts and full data tables.",
    "The Group Entries view shows the assigned disposal cell and a quick summary per submission group.",
    "Generate Reports previews now surface report-specific related details such as cell placement, tons, receiving capacity, portal access, and hauler-client relationships.",
    "SLF Documents and Gallery are managed through table-based upload and metadata views.",
  ],
  fixes: [
    "Export layout: charts are scaled to the printable page width and tables reflow instead of clipping, so sections no longer overlap across pages.",
    "PDF pagination: the report is cloned into normal document flow before printing so every page is produced (not just page 1), and table rows are no longer truncated by UI pagination.",
    "DOCX chart rendering: charts are captured from the live SVG and embedded via MHTML (multipart/related) so pie/bar/line graphs display in Word instead of being dropped as data-URI images.",
    "Socket.IO/auth handling: the admin socket and protected message APIs now wait for the authenticated session, and the production Socket.IO path is proxied without stripping its prefix — removing WebSocket handshake failures and 401 errors.",
    "Data mapping: the submissions list API now returns assigned cell names so the Group Entries modal can show per-entry cell placement.",
    "Cell Infrastructure unit handling: tons no longer snaps back to m³ when cell rows are resized or reopened.",
    "Disposal-entry uploads now require and validate Client under the selected SLF → Hauler relationship.",
    "Filtered Excel export now includes all matched submission groups and expands them into waste-entry breakdown rows.",
  ],
};

// One-time injection of print styles. On print we clone the report into a
// normal-flow `.slf-print-root` body child (see doPrint) — absolutely
// positioned containers only print their first page, so the report must live
// in normal document flow to paginate across pages.
const PRINT_STYLE_ID = "slf-report-print-styles";
function ensurePrintStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.innerHTML = `
    .slf-print-root { display: none; }
    @media print {
      body.slf-printing > *:not(.slf-print-root) { display: none !important; }
      body.slf-printing .slf-print-root { display: block !important; }
      .slf-print-root {
        color: #000 !important; background: #fff !important;
        padding: 0 !important; font-size: 12px;
      }
      .slf-print-root * { box-shadow: none !important; }
      /* Scale fixed-width charts down to fit the printable page width so they
         never overflow/overlap adjacent content. */
      .slf-print-root .recharts-wrapper,
      .slf-print-root .recharts-surface,
      .slf-print-root svg { max-width: 100% !important; height: auto !important; }
      .slf-print-root .recharts-wrapper { break-inside: avoid; margin-bottom: 6px; }
      /* Let tables reflow instead of squeezing inside a scroll box. */
      .slf-print-root .ant-table { font-size: 10px !important; }
      .slf-print-root .ant-table-content,
      .slf-print-root .ant-table-body { overflow: visible !important; }
      .slf-print-root .ant-table table { width: 100% !important; table-layout: auto !important; }
      .slf-print-root .ant-table-cell { padding: 4px 6px !important; white-space: normal !important; }
      /* Repeat table headers on each printed page; keep rows from splitting. */
      .slf-print-root thead { display: table-header-group !important; }
      .slf-print-root tr { break-inside: avoid; }
      /* Section spacing + keep cards/sections intact across page breaks. */
      .slf-print-root .slf-report-card { break-inside: avoid; margin-bottom: 14px; }
      .slf-print-root h4, .slf-print-root h5 { margin: 0 0 6px !important; }
      .slf-print-root .slf-page-break { break-before: page; }
      .slf-report-noprint { display: none !important; }
      @page { size: A4; margin: 12mm; }
    }
  `;
  document.head.appendChild(style);
}

// Render a live Recharts <svg> to a PNG data URL (for DOCX embedding). The
// serialized SVG carries only inline styles/no external refs, so the canvas is
// never tainted. Returns null on any failure so export degrades gracefully.
async function svgToPng(svg) {
  try {
    const rect = svg.getBoundingClientRect();
    const width = Math.max(Math.round(rect.width) || 0, 1);
    const height = Math.max(Math.round(rect.height) || 0, 1);
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", width);
    clone.setAttribute("height", height);
    const data = new XMLSerializer().serializeToString(clone);
    const svgUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(data)));
    const img = new Image();
    img.width = width;
    img.height = height;
    img.src = svgUrl;
    await (img.decode ? img.decode() : new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    }));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { url: canvas.toDataURL("image/png"), width, height };
  } catch {
    return null;
  }
}

function StatCard({ label, value, sub, color = "#2f54eb" }) {
  return (
    <div
      className="slf-report-card"
      style={{
        border: "1px solid #eee",
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 150,
        flex: "1 1 150px",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 11, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub != null && <div style={{ fontSize: 10, color: "#999" }}>{sub}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="slf-report-card" style={{ marginTop: 20 }}>
      <Title level={5} style={{ margin: "0 0 8px", color: "#1a3353" }}>
        {title}
      </Title>
      {children}
    </div>
  );
}

/**
 * SLF Data & Portal Submissions — printable operational summary report.
 * Reuses data already loaded by the Submission Summary page (tiles, slfRows,
 * portalUsers) and pulls the monthly submission trend from /data-slf/stats.
 */
// Classify a raw cell status label into a coarse bucket. Active/Operational are
// prioritised; everything else keeps its real status label under "Other".
const isActiveCell = (status) => /active|operational|open|current/i.test(String(status || ""));

// Bucket a single cell into the report's status categories using only existing
// schema values. "full" is derived (fill ≥ capacity, or Closed/Used/Completed);
// "underDev" = Under Construction; "inactive" = Reserved / Not Existed.
const CELL_BUCKETS = [
  { key: "active", label: "Active", color: "#52c41a" },
  { key: "full", label: "Full/Closed", color: "#cf1322" },
  { key: "underDev", label: "Under Dev.", color: "#fa8c16" },
  { key: "inactive", label: "Inactive", color: "#8c8c8c" },
  { key: "other", label: "Other", color: "#bfbfbf" },
];
const cellStatusBucket = (status, capacity, fill) => {
  const s = String(status || "");
  if (capacity > 0 && fill >= capacity) return "full";
  if (/active|operational|open|current/i.test(s)) return "active";
  if (/closed|completed|used|full/i.test(s)) return "full";
  if (/construction|development/i.test(s)) return "underDev";
  if (/reserved|not\s*exist|inactive/i.test(s)) return "inactive";
  return "other";
};

export default function SlfSubmissionReport({
  open,
  onClose,
  tiles,
  slfRows = [],
  portalUsers = [],
  facilities = [],
  baselines = [],
  totals,
  // Live portal announcement(s) + recent portal/admin changes (transactions) so the
  // "Recent Updates" section reflects the CURRENT state, not a static release note.
  announcements = [],
  recentChanges = [],
}) {
  const [trend, setTrend] = useState([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Report-only removals (never touches the DB). Keys reset each time the modal
  // opens so every report session starts from the full dataset.
  const [removedOpKeys, setRemovedOpKeys] = useState(() => new Set());
  const [removedBaselineKeys, setRemovedBaselineKeys] = useState(() => new Set());
  const printRef = useRef(null);

  const removeOperator = (key) =>
    setRemovedOpKeys((prev) => new Set(prev).add(key));
  const removeBaseline = (key) =>
    setRemovedBaselineKeys((prev) => new Set(prev).add(key));
  const restoreRemoved = () => {
    setRemovedOpKeys(new Set());
    setRemovedBaselineKeys(new Set());
  };
  const removedCount = removedOpKeys.size + removedBaselineKeys.size;

  useEffect(() => {
    ensurePrintStyles();
  }, []);

  // Start each report session with nothing removed.
  useEffect(() => {
    if (open) {
      setRemovedOpKeys(new Set());
      setRemovedBaselineKeys(new Set());
    }
  }, [open]);

  // Monthly submission trend is fetched lazily — only when the report opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setTrendLoading(true);
    api
      .get("/data-slf/stats")
      .then(({ data }) => {
        if (!active) return;
        const monthly = Array.isArray(data?.monthlyData) ? data.monthlyData : [];
        setTrend(
          monthly.map((m) => ({
            label: `${MONTH_LABELS[m?._id?.month] || ""} ${String(m?._id?.year || "").slice(2)}`.trim(),
            submissions: m.count || 0,
          })),
        );
      })
      .catch(() => active && setTrend([]))
      .finally(() => active && setTrendLoading(false));
    return () => {
      active = false;
    };
  }, [open]);

  // Approved, non-dummy operators — sample/test accounts (see isSamplePortalUser)
  // are excluded here so every downstream metric, table, and chart omits them.
  const operators = useMemo(
    () =>
      portalUsers.filter(
        (u) =>
          u.status === "approved" &&
          !isSamplePortalUser(u) &&
          !removedOpKeys.has(computeOperatorGroupKey(u)),
      ),
    [portalUsers, removedOpKeys],
  );

  // Join each operator to its assigned SLF submission rows by normalised name.
  const operatorRows = useMemo(() => {
    const rowByKey = new Map();
    slfRows.forEach((r) => rowByKey.set(normalizeKey(r.slfName), r));
    return operators.map((u) => {
      const assigned = Array.isArray(u.assignedSlfName) ? u.assignedSlfName : [];
      const matched = assigned
        .map((name) => rowByKey.get(normalizeKey(name)))
        .filter(Boolean);
      const submissions = matched.reduce((s, r) => s + (r.submissions || 0), 0);
      const trucks = matched.reduce((s, r) => s + (r.trucks || 0), 0);
      const totalM3 = matched.reduce((s, r) => s + (r.totalM3 || 0), 0);
      const totalTons = matched.reduce((s, r) => s + (r.totalTons || 0), 0);
      const lastDate = matched.reduce((max, r) => {
        const d = r.lastDisposalDate ? dayjs(r.lastDisposalDate) : null;
        return d && (!max || d.isAfter(max)) ? d : max;
      }, null);
      return {
        key: u._id,
        _gkey: computeOperatorGroupKey(u),
        operator: `${u.firstName || ""} ${u.lastName || ""}`.trim() || "—",
        company: u.companyName || "—",
        slf: assigned.length ? assigned.join(", ") : "— (no SLF assigned)",
        noAssignment: assigned.length === 0,
        submissions,
        trucks,
        volume: formatVolume(totalM3, totalTons),
        _m3: totalM3,
        _tons: totalTons,
        lastDate,
        hasSubmission: submissions > 0,
      };
    });
  }, [operators, slfRows]);

  // Merge duplicate portal users that belong to the same LGU/company into a
  // single reporting entry (e.g. the two "LGU Masinloc" accounts). Grouping key
  // is normalized company name, else the first assigned SLF, else operator name.
  const operatorGroups = useMemo(() => {
    const map = new Map();
    operatorRows.forEach((r) => {
      const key = r._gkey;
      const label =
        r.company && r.company !== "—"
          ? r.company
          : !r.noAssignment && r.slf
            ? r.slf.split(",")[0].trim()
            : r.operator;
      const g = map.get(key) || {
        key,
        operator: label,
        company: r.company,
        slfSet: new Set(),
        submissions: 0,
        trucks: 0,
        _m3: 0,
        _tons: 0,
        lastDate: null,
        memberCount: 0,
        noAssignment: true,
      };
      if (!r.noAssignment && r.slf) r.slf.split(",").forEach((s) => s.trim() && g.slfSet.add(s.trim()));
      g.submissions += r.submissions;
      g.trucks += r.trucks;
      g._m3 += r._m3;
      g._tons += r._tons;
      if (!r.noAssignment) g.noAssignment = false;
      if (r.lastDate && (!g.lastDate || r.lastDate.isAfter(g.lastDate))) g.lastDate = r.lastDate;
      g.memberCount += 1;
      map.set(key, g);
    });
    return [...map.values()].map((g) => ({
      ...g,
      slf: g.slfSet.size ? [...g.slfSet].join(", ") : "— (no SLF assigned)",
      volume: formatVolume(g._m3, g._tons),
      hasSubmission: g.submissions > 0,
    }));
  }, [operatorRows]);

  const withSubs = operatorGroups.filter((r) => r.hasSubmission).length;
  const withoutSubs = operatorGroups.length - withSubs;
  const noAssignment = operatorGroups.filter((r) => r.noAssignment).length;

  // SLFs that received submissions but don't match any operator's assigned name.
  const orphanSlfs = useMemo(() => {
    const assignedKeys = new Set();
    operators.forEach((u) =>
      (u.assignedSlfName || []).forEach((n) => assignedKeys.add(normalizeKey(n))),
    );
    return slfRows.filter(
      (r) => (r.submissions || 0) > 0 && !assignedKeys.has(normalizeKey(r.slfName)),
    );
  }, [operators, slfRows]);

  // ── Cell infrastructure (SlfFacility) scoped to operators' assigned SLFs ──
  const cellFacilities = useMemo(() => {
    const ids = new Set();
    const names = new Set();
    operators.forEach((u) => {
      (u.assignedSlf || []).forEach((id) => ids.add(String(id?._id || id)));
      (u.assignedSlfName || []).forEach((n) => names.add(normalizeKey(n)));
    });
    const hasCells = (f) =>
      (f.numberOfCell || 0) > 0 ||
      (Array.isArray(f.cellStatuses) && f.cellStatuses.length) ||
      (Array.isArray(f.cellCapacities) && f.cellCapacities.length);
    let scoped = facilities.filter(
      (f) =>
        !f.isDummy &&
        hasCells(f) &&
        (ids.has(String(f._id)) ||
          names.has(normalizeKey(f.lgu)) ||
          names.has(normalizeKey(f.slfName))),
    );
    // Fallback: if operator↔facility names don't line up, use all facilities
    // that have cell data so the section is never silently empty.
    if (!scoped.length) scoped = facilities.filter((f) => !f.isDummy && hasCells(f));
    return scoped;
  }, [facilities, operators]);

  // Per-facility Active vs Other cell counts (Active prioritised in the chart).
  const cellChartData = useMemo(
    () =>
      cellFacilities
        .map((f) => {
          const count = Math.max(
            f.numberOfCell || 0,
            (f.cellStatuses || []).length,
            (f.cellCapacities || []).length,
          );
          const statuses = f.cellStatuses || [];
          let active = 0;
          let other = 0;
          for (let i = 0; i < count; i += 1) {
            if (isActiveCell(statuses[i] || (i === 0 ? "Active Cell" : ""))) active += 1;
            else other += 1;
          }
          return { name: String(f.lgu || f.slfName || "—").slice(0, 18), active, other, total: count };
        })
        .filter((r) => r.total > 0)
        .sort((a, b) => b.active - a.active)
        .slice(0, 12),
    [cellFacilities],
  );

  // Real status-label breakdown across scoped facilities (+ derived "Full").
  const cellStatusBreakdown = useMemo(() => {
    const counts = {};
    cellFacilities.forEach((f) => {
      const count = Math.max(
        f.numberOfCell || 0,
        (f.cellStatuses || []).length,
        (f.cellCapacities || []).length,
      );
      const statuses = f.cellStatuses || [];
      const caps = f.cellCapacities || [];
      const fills = f.cellFillValues || [];
      for (let i = 0; i < count; i += 1) {
        let label = statuses[i] || (i === 0 ? "Active Cell" : "Unspecified");
        // Derived "Full" — no explicit Full status field exists in the schema.
        const cap = Number(caps[i] || 0);
        const fill = Number(fills[i] || 0);
        if (cap > 0 && fill >= cap) label = "Full (derived)";
        counts[label] = (counts[label] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);
  }, [cellFacilities]);

  const totalCells = cellStatusBreakdown.reduce((s, r) => s + r.count, 0);
  const activeCells = cellChartData.reduce((s, r) => s + r.active, 0);

  // Per-operator (LGU-merged) cell infrastructure status. Facilities are matched
  // to each operator by assignedSlf id / assignedSlfName, then bucketed. Merged
  // LGU groups share the same normalized key so LGU Masinloc appears once.
  const operatorCellReport = useMemo(() => {
    const facById = new Map();
    const facByName = new Map();
    facilities.forEach((f) => {
      if (f?.isDummy) return;
      if (f?._id) facById.set(String(f._id), f);
      if (f?.lgu) facByName.set(normalizeKey(f.lgu), f);
      if (f?.slfName) facByName.set(normalizeKey(f.slfName), f);
    });
    const groups = new Map();
    operators.forEach((u) => {
      const company = u.companyName && u.companyName.trim() ? u.companyName.trim() : "";
      const assignedNames = Array.isArray(u.assignedSlfName) ? u.assignedSlfName : [];
      const label = company || assignedNames[0] || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "—";
      const key = computeOperatorGroupKey(u);
      const facs = new Map();
      (u.assignedSlf || []).forEach((id) => {
        const f = facById.get(String(id?._id || id));
        if (f) facs.set(String(f._id), f);
      });
      assignedNames.forEach((n) => {
        const f = facByName.get(normalizeKey(n));
        if (f) facs.set(String(f._id), f);
      });
      const g = groups.get(key) || {
        key, label, total: 0, active: 0, full: 0, underDev: 0, inactive: 0, other: 0, facSeen: new Set(),
      };
      facs.forEach((f, id) => {
        if (g.facSeen.has(id)) return; // de-dupe across merged users
        g.facSeen.add(id);
        const count = Math.max(f.numberOfCell || 0, (f.cellStatuses || []).length, (f.cellCapacities || []).length);
        const statuses = f.cellStatuses || [];
        const caps = f.cellCapacities || [];
        const fills = f.cellFillValues || [];
        for (let i = 0; i < count; i += 1) {
          g.total += 1;
          g[cellStatusBucket(statuses[i] || (i === 0 ? "Active Cell" : ""), Number(caps[i] || 0), Number(fills[i] || 0))] += 1;
        }
      });
      groups.set(key, g);
    });
    return [...groups.values()].filter((g) => g.total > 0).sort((a, b) => b.active - a.active);
  }, [operators, facilities]);

  // Chart data (top 12 by active) with a short label for the axis.
  const operatorCellChart = useMemo(
    () =>
      operatorCellReport.slice(0, 12).map((g) => ({
        name: String(g.label).split(",")[0].slice(0, 18),
        active: g.active,
        full: g.full,
        underDev: g.underDev,
        inactive: g.inactive,
        other: g.other,
      })),
    [operatorCellReport],
  );

  // ── Baseline table rows (from /data-slf/baselines) ──
  const baselineRows = useMemo(
    () =>
      (baselines || [])
        .filter(
          (b) => !b.isDummy && !isSampleIdentity(b.submittedBy) && !removedBaselineKeys.has(b._id),
        )
        .map((b) => {
          const unit = (b.baselineUnit || "m³").replace("m3", "m³");
          const activeTotal =
            Number(b.activeCellResidualVolume || 0) +
            Number(b.activeCellInertVolume || 0) +
            Number(b.activeCellHazardousVolume || 0);
          return {
            key: b._id,
            slfName: b.slfName || b.lguCompanyName || "—",
            unit,
            totalAccepted: Number(b.totalVolumeAccepted || 0),
            activeResidual: Number(b.activeCellResidualVolume || 0),
            activeInert: Number(b.activeCellInertVolume || 0),
            activeHazardous: Number(b.activeCellHazardousVolume || 0),
            activeTotal,
            acceptsHazardous: b.acceptsHazardousWaste ? "Yes" : "No",
            lastUpdated: b.lastUpdated ? dayjs(b.lastUpdated).format("MM/DD/YYYY") : "—",
          };
        })
        .sort((a, b) => a.slfName.localeCompare(b.slfName)),
    [baselines, removedBaselineKeys],
  );

  // Headline totals derived from the filtered operator dataset so removing rows
  // from the report recalculates the summary cards + export (single source).
  const reportTotals = useMemo(
    () =>
      operatorGroups.reduce(
        (acc, g) => {
          acc.submissions += g.submissions;
          acc.trucks += g.trucks;
          acc.m3 += g._m3;
          acc.tons += g._tons;
          return acc;
        },
        { submissions: 0, trucks: 0, m3: 0, tons: 0 },
      ),
    [operatorGroups],
  );

  const pieData = [
    { name: "With submissions", value: withSubs },
    { name: "No submissions", value: withoutSubs },
  ];

  const barData = useMemo(
    () =>
      [...slfRows]
        .filter((r) => (r.submissions || 0) > 0)
        .sort((a, b) => (b.submissions || 0) - (a.submissions || 0))
        .slice(0, 10)
        .map((r) => ({
          name: String(r.slfName || "—").split(",")[0].slice(0, 18),
          submissions: r.submissions || 0,
        })),
    [slfRows],
  );

  // Waste volume by Company (m³-equivalent), aggregated across that company's
  // operators. Falls back to assigned SLF name, then operator name, when the
  // company field is empty — never invents a label.
  const volumeBarData = useMemo(() => {
    const byCompany = new Map();
    operatorRows.forEach((r) => {
      const label =
        r.company && r.company !== "—"
          ? r.company
          : !r.noAssignment && r.slf
            ? r.slf.split(",")[0].trim()
            : r.operator;
      // tons → m³ via the shared factor, not a bare literal.
      const volume = (r._m3 || 0) + (convertVolume(r._tons || 0, "tons", "m³") || 0);
      byCompany.set(label, (byCompany.get(label) || 0) + volume);
    });
    return [...byCompany.entries()]
      .map(([name, volume]) => ({ name: String(name).slice(0, 22), volume: Math.round(volume) }))
      .filter((r) => r.volume > 0)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);
  }, [operatorRows]);

  const topSlf = barData[0];
  const pending = totals?.statuses?.pending || tiles?.statuses?.pending || 0;
  const generatedAt = dayjs().format("MMMM D, YYYY h:mm A");

  // Print by cloning the report into a normal-flow body child so every section
  // paginates across pages (absolute positioning would print page 1 only).
  const doPrint = () => {
    const source = printRef.current;
    if (!source) {
      window.print();
      return;
    }
    document.querySelectorAll(".slf-print-root").forEach((n) => n.remove());
    const root = document.createElement("div");
    root.className = "slf-print-root";
    const clone = source.cloneNode(true);
    clone.removeAttribute("id");
    root.appendChild(clone);
    document.body.appendChild(root);
    document.body.classList.add("slf-printing");
    const cleanup = () => {
      document.body.classList.remove("slf-printing");
      root.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  // DOCX export without a new dependency: browsers/Word open an HTML document
  // saved with a .doc extension. Charts are embedded via MHTML (multipart/
  // related) — Word renders those, unlike inline data: URIs which it drops.
  const exportDocx = async () => {
    setExporting(true);
    try {
      const esc = (v) =>
        String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      // Snapshot each on-screen chart (SVG → PNG). Each becomes a separate MHTML
      // image part referenced by name so Word renders it (data: URIs are dropped).
      const images = [];
      let chartsHtml = "";
      try {
        const chartEls = printRef.current
          ? [...printRef.current.querySelectorAll("[data-chart-title]")]
          : [];
        const parts = [];
        let i = 0;
        for (const el of chartEls) {
          const svg = el.querySelector("svg");
          if (!svg) continue;
          const png = await svgToPng(svg);
          if (!png) continue;
          const name = `image${String(i + 1).padStart(3, "0")}.png`;
          const base64 = String(png.url).split(",")[1] || "";
          if (!base64) continue;
          images.push({ name, base64 });
          const w = Math.min(png.width, 640);
          parts.push(
            `<div style="margin:10px 0"><h4 style="color:#1a3353;margin:0 0 4px;font-family:Calibri,Arial,sans-serif">${esc(
              el.getAttribute("data-chart-title"),
            )}</h4><img src="${name}" width="${w}"/></div>`,
          );
          i += 1;
        }
        if (parts.length) chartsHtml = `<h3 style="color:#2f54eb">Charts</h3>${parts.join("")}`;
      } catch {
        chartsHtml = "";
      }

      const th = (cells) =>
        `<tr>${cells.map((c) => `<th style="background:#2f54eb;color:#fff;border:1px solid #999;padding:4px;font-size:11px">${esc(c)}</th>`).join("")}</tr>`;
      const tr = (cells) =>
        `<tr>${cells.map((c) => `<td style="border:1px solid #ccc;padding:4px;font-size:11px">${esc(c)}</td>`).join("")}</tr>`;
      // <thead> makes Word repeat the header row on each page; full arrays are
      // used (never the paginated UI table) so every row is exported.
      const table = (headers, rows) =>
        `<table style="border-collapse:collapse;width:100%"><thead>${th(headers)}</thead><tbody>${rows.join("")}</tbody></table>`;

      const opTable = table(
        ["Operator / LGU", "Company", "Assigned SLF", "Submissions", "Trucks", "Volume", "Last Disposal", "Status"],
        [...operatorGroups]
          .sort((a, b) => b.submissions - a.submissions)
          .map((r) =>
            tr([
              r.memberCount > 1 ? `${r.operator} (${r.memberCount} accounts)` : r.operator,
              r.company, r.slf, r.submissions, r.trucks, r.volume,
              r.lastDate ? r.lastDate.format("MM/DD/YYYY") : "—",
              r.hasSubmission ? "Submitted" : "None",
            ]),
          ),
      );

      const cellTable = table(
        ["Cell Status", "Count"],
        cellStatusBreakdown.map((r) => tr([r.status, r.count])),
      );

      const operatorCellTable = table(
        ["SLF Operator / Company", "Total", "Active", "Inactive", "Full/Closed", "Under Dev.", "Other"],
        operatorCellReport.map((r) =>
          tr([r.label, r.total, r.active, r.inactive, r.full, r.underDev, r.other]),
        ),
      );

      const baseTable = table(
        ["SLF", "Unit", "Total Accepted", "Active Residual", "Active Inert", "Active Hazardous", "Accepts Haz.", "Last Updated"],
        baselineRows.map((r) =>
          tr([
            r.slfName, r.unit, Math.round(r.totalAccepted).toLocaleString(),
            Math.round(r.activeResidual).toLocaleString(), Math.round(r.activeInert).toLocaleString(),
            Math.round(r.activeHazardous).toLocaleString(), r.acceptsHazardous, r.lastUpdated,
          ]),
        ),
      );

      const updatesList = (items) =>
        `<ul style="font-size:12px;margin:4px 0 10px">${items.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>`;
      const updatesHtml = `<h3 style="color:#2f54eb">Recent Updates</h3>
        <h4 style="color:#2f54eb;margin:6px 0 2px">Updates</h4>${updatesList(RECENT_UPDATES.updates)}
        <h4 style="color:#52c41a;margin:6px 0 2px">New Features</h4>${updatesList(RECENT_UPDATES.features)}
        <h4 style="color:#cf1322;margin:6px 0 2px">Fixes</h4>${updatesList(RECENT_UPDATES.fixes)}`;

      const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif">
        <h2 style="color:#1a3353;margin:0">SLF Data &amp; Portal Submissions Summary</h2>
        <p style="color:#666;font-size:12px">EMB Region III — ESWMP · Generated ${esc(generatedAt)}</p>
        <h3 style="color:#2f54eb">Key Totals</h3>
        <ul style="font-size:12px">
          <li>Total SLF Operators: <b>${operatorGroups.length}</b></li>
          <li>Operators With Submissions: <b>${withSubs}</b></li>
          <li>Operators Without Submissions: <b>${withoutSubs}</b></li>
          <li>Reporting SLFs: <b>${slfRows.length}</b></li>
          <li>Total Submissions: <b>${reportTotals.submissions.toLocaleString()}</b> (${pending} pending)</li>
          <li>Total Waste Volume: <b>${esc(formatVolume(reportTotals.m3, reportTotals.tons))}</b></li>
        </ul>
        ${chartsHtml}
        <br style="page-break-before:always"/>
        <h3 style="color:#2f54eb">Submissions per SLF Operator</h3>${opTable}
        <br style="page-break-before:always"/>
        <h3 style="color:#2f54eb">Cell Infrastructure — Status Breakdown (${activeCells} active of ${totalCells} cells)</h3>${cellTable}
        <br style="page-break-before:always"/>
        <h3 style="color:#2f54eb">Cell Infrastructure Status Report (per SLF Operator)</h3>${operatorCellTable}
        <br style="page-break-before:always"/>
        <h3 style="color:#2f54eb">SLF Baseline Data</h3>${baseTable}
        <br style="page-break-before:always"/>
        ${updatesHtml}
        <p style="font-size:10px;color:#999;margin-top:16px">Generated by ESWMP Admin · ${esc(generatedAt)}</p>
      </body></html>`;

      // Assemble the MHTML envelope (CRLF-delimited). The HTML part references
      // images by relative name; each image is a base64 part whose Content-
      // Location resolves against the HTML base, which Word matches and renders.
      const CRLF = "\r\n";
      const boundary = "----=_NextPart_SLF_Report";
      const base = "file:///C:/slf-report.htm";
      const wrap76 = (b64) => b64.replace(/.{1,76}/g, (m) => m + CRLF);
      let mhtml = "";
      mhtml += `MIME-Version: 1.0${CRLF}`;
      mhtml += `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"${CRLF}${CRLF}`;
      mhtml += `--${boundary}${CRLF}`;
      mhtml += `Content-Type: text/html; charset="utf-8"${CRLF}`;
      mhtml += `Content-Location: ${base}${CRLF}${CRLF}`;
      mhtml += html + CRLF;
      for (const img of images) {
        mhtml += `--${boundary}${CRLF}`;
        mhtml += `Content-Type: image/png${CRLF}`;
        mhtml += `Content-Transfer-Encoding: base64${CRLF}`;
        mhtml += `Content-Location: file:///C:/${img.name}${CRLF}${CRLF}`;
        mhtml += wrap76(img.base64) + CRLF;
      }
      mhtml += `--${boundary}--${CRLF}`;

      const blob = new Blob([mhtml], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SLF-Submissions-Report-${dayjs().format("YYYYMMDD")}.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // "Remove from Report" column — hidden from the printed/exported output via
  // slf-report-noprint. onRemove receives the row and excludes it from the
  // centralized filtered dataset (no DB change).
  const removeColumn = (onRemove) => ({
    title: "Report",
    key: "__remove",
    width: 96,
    align: "center",
    className: "slf-report-noprint",
    onHeaderCell: () => ({ className: "slf-report-noprint" }),
    render: (_, r) => (
      <Button
        size="small"
        danger
        type="text"
        icon={<CloseCircleOutlined />}
        onClick={() => onRemove(r)}
      >
        Remove
      </Button>
    ),
  });

  return (
    <Modal
      title={
        <Space>
          <PrinterOutlined /> SLF Data & Portal Submissions — Reporting Summary
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1400}
      styles={{ body: { maxHeight: "72vh", overflow: "auto" } }}
      footer={
        <Space className="slf-report-noprint">
          <Button onClick={onClose}>Close</Button>
          <Button icon={<FileWordOutlined />} loading={exporting} onClick={exportDocx}>
            Export (.docx)
          </Button>
          <Button type="primary" icon={<PrinterOutlined />} onClick={doPrint}>
            Save as PDF
          </Button>
        </Space>
      }
    >
      {removedCount > 0 && (
        <Alert
          type="info"
          showIcon
          className="slf-report-noprint"
          style={{ marginBottom: 10 }}
          title={
            <Space>
              <span>
                {removedCount} item(s) removed from this report ({removedOpKeys.size} operator/cell,
                {" "}{removedBaselineKeys.size} baseline). Charts, totals, and exports exclude them.
              </span>
              <Button size="small" icon={<UndoOutlined />} onClick={restoreRemoved}>
                Restore Removed Items
              </Button>
            </Space>
          }
        />
      )}
      <div id="slf-report-printable" ref={printRef} style={{ background: "#fff", color: "#222", padding: 4 }}>
        {/* Header */}
        <div style={{ borderBottom: "2px solid #2f54eb", paddingBottom: 8, marginBottom: 4 }}>
          <Title level={4} style={{ margin: 0, color: "#1a3353" }}>
            Sanitary Landfill Data Submissions Summary
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            EMB Region III — Ecological Solid Waste Management Pipeline · Generated {generatedAt}
          </Text>
        </div>

        {/* Summary cards */}
        <Section title="Key Totals">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <StatCard label="Total SLF Operators" value={operatorGroups.length} color="#2f54eb" />
            <StatCard label="Operators With Submissions" value={withSubs} color="#52c41a" />
            <StatCard label="Operators Without Submissions" value={withoutSubs} color="#fa8c16" />
            <StatCard label="Reporting SLFs" value={slfRows.length} color="#13c2c2" />
            <StatCard
              label="Total Submissions"
              value={reportTotals.submissions.toLocaleString()}
              sub={`${pending} pending review`}
              color="#722ed1"
            />
            <StatCard
              label="Total Waste Volume"
              value={formatVolume(reportTotals.m3, reportTotals.tons)}
              color="#cf1322"
            />
          </div>
        </Section>

        {/* Charts */}
        <Section title="Operator Submission Coverage">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div data-chart-title="Operator Submission Coverage">
            <PieChart width={280} height={220}>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name, value, percent }) =>
                  `${name}: ${value} (${Math.round((percent || 0) * 100)}%)`
                }
                labelLine={false}
                isAnimationActive={false}
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Legend />
            </PieChart>
            </div>
            <div style={{ flex: 1, minWidth: 240, fontSize: 12, color: "#555" }}>
              <Paragraph style={{ marginBottom: 4 }}>
                <b>{withSubs}</b> of <b>{operatorGroups.length}</b> approved operators have at least one
                recorded portal submission ({operatorGroups.length ? Math.round((withSubs / operatorGroups.length) * 100) : 0}% coverage).
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                <b>{withoutSubs}</b> operator(s) have no submissions yet and may require follow-up.
              </Paragraph>
            </div>
          </div>
        </Section>

        <Section title="Submissions per SLF (Top 10)">
          {barData.length ? (
            <div data-chart-title="Submissions per SLF (Top 10)">
            <BarChart width={820} height={260} data={barData} margin={{ top: 8, right: 16, bottom: 60, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="submissions" fill={BAR_COLOR} isAnimationActive={false} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="submissions" position="top" fill="#555" fontSize={10} />
              </Bar>
            </BarChart>
            </div>
          ) : (
            <Text type="secondary">No submissions recorded yet.</Text>
          )}
        </Section>

        <Section title="Monthly Submission Trend">
          {trendLoading ? (
            <Spin />
          ) : trend.length ? (
            <div data-chart-title="Monthly Submission Trend">
            <LineChart width={820} height={240} data={trend} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="submissions" stroke={LINE_COLOR} strokeWidth={2} isAnimationActive={false}>
                <LabelList dataKey="submissions" position="top" fill="#555" fontSize={10} />
              </Line>
            </LineChart>
            </div>
          ) : (
            <Text type="secondary">No dated submissions available for a trend.</Text>
          )}
        </Section>

        <Section title="Waste Volume per Company (Top 10, m³-equivalent)">
          {volumeBarData.length ? (
            <div data-chart-title="Waste Volume per Company (Top 10, m³-equivalent)">
            <BarChart width={820} height={240} data={volumeBarData} margin={{ top: 8, right: 16, bottom: 60, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `${Number(v).toLocaleString()} m³`} />
              <Bar dataKey="volume" fill="#cf1322" isAnimationActive={false} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="volume" position="top" fill="#555" fontSize={9} formatter={(v) => Number(v).toLocaleString()} />
              </Bar>
            </BarChart>
            </div>
          ) : (
            <Text type="secondary">No submitted waste volume recorded yet.</Text>
          )}
        </Section>

        <div className="slf-page-break" />

        {/* Operator table */}
        <Section title="Submissions per SLF Operator">
          <Table
            size="small"
            pagination={false}
            dataSource={[...operatorGroups].sort((a, b) => b.submissions - a.submissions)}
            rowKey="key"
            columns={[
              {
                title: "Operator / LGU",
                dataIndex: "operator",
                ellipsis: true,
                render: (v, r) =>
                  r.memberCount > 1 ? (
                    <span>{v} <Tag color="blue" style={{ marginLeft: 4 }}>{r.memberCount} accounts</Tag></span>
                  ) : (
                    v
                  ),
              },
              { title: "Company", dataIndex: "company", ellipsis: true },
              { title: "Assigned SLF", dataIndex: "slf", ellipsis: true },
              { title: "Subs.", dataIndex: "submissions", align: "center", width: 60 },
              { title: "Trucks", dataIndex: "trucks", align: "center", width: 64 },
              { title: "Volume", dataIndex: "volume", width: 130 },
              {
                title: "Last Disposal",
                dataIndex: "lastDate",
                width: 110,
                render: (d) => (d ? d.format("MM/DD/YYYY") : "—"),
              },
              {
                title: "Status",
                key: "status",
                width: 90,
                render: (_, r) =>
                  r.hasSubmission ? (
                    <Tag color="green">Submitted</Tag>
                  ) : (
                    <Tag color="orange">None</Tag>
                  ),
              },
              removeColumn((r) => removeOperator(r.key)),
            ]}
          />
        </Section>

        <div className="slf-page-break" />

        {/* Cell infrastructure */}
        <Section title={`SLF Cell Infrastructure (${activeCells} active of ${totalCells} cells)`}>
          {cellChartData.length ? (
            <>
              <div data-chart-title="SLF Cell Infrastructure (Active vs Other cells)">
              <BarChart width={820} height={280} data={cellChartData} margin={{ top: 8, right: 16, bottom: 66, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={72} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="active" stackId="c" name="Active cells" fill="#52c41a" isAnimationActive={false}>
                  <LabelList dataKey="active" position="center" fill="#fff" fontSize={10} formatter={(v) => (v > 0 ? v : "")} />
                </Bar>
                <Bar dataKey="other" stackId="c" name="Other cells" fill="#bfbfbf" isAnimationActive={false} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="other" position="center" fill="#333" fontSize={10} formatter={(v) => (v > 0 ? v : "")} />
                </Bar>
              </BarChart>
              </div>
              <div style={{ marginTop: 10 }}>
                <Text strong style={{ fontSize: 12 }}>Cell status breakdown</Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                  {cellStatusBreakdown.map((s) => (
                    <Tag
                      key={s.status}
                      color={isActiveCell(s.status) ? "green" : /full/i.test(s.status) ? "red" : "default"}
                    >
                      {s.status}: {s.count}
                    </Tag>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <Text type="secondary">No cell infrastructure data recorded for the assigned SLFs.</Text>
          )}
        </Section>

        <div className="slf-page-break" />

        {/* Cell infrastructure status per operator */}
        <Section title="Cell Infrastructure Status Report (per SLF Operator)">
          {operatorCellReport.length ? (
            <>
              {operatorCellChart.length > 0 && (
                <div data-chart-title="Cell Infrastructure Status per Operator">
                  <BarChart width={820} height={300} data={operatorCellChart} margin={{ top: 8, right: 16, bottom: 78, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={84} tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    {CELL_BUCKETS.map((b, idx) => (
                      <Bar
                        key={b.key}
                        dataKey={b.key}
                        stackId="cells"
                        name={b.label}
                        fill={b.color}
                        isAnimationActive={false}
                        radius={idx === CELL_BUCKETS.length - 1 ? [4, 4, 0, 0] : undefined}
                      >
                        {b.key === "active" && (
                          <LabelList dataKey="active" position="center" fill="#fff" fontSize={10} formatter={(v) => (v > 0 ? v : "")} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </div>
              )}
              <Table
                size="small"
                pagination={false}
                dataSource={operatorCellReport}
                rowKey="key"
                style={{ marginTop: 8 }}
                columns={[
                  { title: "SLF Operator / Company", dataIndex: "label", ellipsis: true },
                  { title: "Total", dataIndex: "total", align: "center", width: 64 },
                  { title: "Active", dataIndex: "active", align: "center", width: 64, render: (v) => <Tag color="green" style={{ margin: 0 }}>{v}</Tag> },
                  { title: "Inactive", dataIndex: "inactive", align: "center", width: 72 },
                  { title: "Full/Closed", dataIndex: "full", align: "center", width: 84 },
                  { title: "Under Dev.", dataIndex: "underDev", align: "center", width: 84 },
                  { title: "Other", dataIndex: "other", align: "center", width: 64 },
                  removeColumn((r) => removeOperator(r.key)),
                ]}
              />
              <Text type="secondary" style={{ fontSize: 10, display: "block", marginTop: 4 }}>
                Buckets derived from facility cellStatuses: Active = Active/Operational; Full/Closed =
                Closed/Used/Completed or fill ≥ capacity; Under Dev. = Under Construction; Inactive =
                Reserved/Not Existed.
              </Text>
            </>
          ) : (
            <Text type="secondary">No cell infrastructure data linked to portal operators.</Text>
          )}
        </Section>

        <div className="slf-page-break" />

        {/* Baseline table */}
        <Section title="SLF Baseline Data">
          {baselineRows.length ? (
            <Table
              size="small"
              dataSource={baselineRows}
              rowKey="key"
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "SLF", dataIndex: "slfName", ellipsis: true },
                { title: "Unit", dataIndex: "unit", width: 56 },
                { title: "Total Accepted", dataIndex: "totalAccepted", align: "right", render: (v) => Math.round(v).toLocaleString() },
                { title: "Active Residual", dataIndex: "activeResidual", align: "right", render: (v) => Math.round(v).toLocaleString() },
                { title: "Active Inert", dataIndex: "activeInert", align: "right", render: (v) => Math.round(v).toLocaleString() },
                { title: "Active Hazardous", dataIndex: "activeHazardous", align: "right", render: (v) => Math.round(v).toLocaleString() },
                { title: "Accepts Haz.", dataIndex: "acceptsHazardous", width: 90, align: "center" },
                { title: "Last Updated", dataIndex: "lastUpdated", width: 110 },
                removeColumn((r) => removeBaseline(r.key)),
              ]}
            />
          ) : (
            <Text type="secondary">No baseline records available.</Text>
          )}
        </Section>

        <div className="slf-page-break" />

        {/* Key findings */}
        <Section title="Key Findings">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
            <li>
              Submission coverage: <b>{withSubs}</b> submitting vs <b>{withoutSubs}</b> non-submitting
              operator(s).
            </li>
            {topSlf && (
              <li>
                Most active SLF: <b>{topSlf.name}</b> with <b>{topSlf.submissions}</b> submission(s).
              </li>
            )}
            <li>
              Pending review backlog: <b>{pending}</b> submission(s) awaiting admin action.
            </li>
            {noAssignment > 0 && (
              <li>
                <b>{noAssignment}</b> approved operator(s) have no SLF assigned and cannot submit.
              </li>
            )}
          </ul>
        </Section>

        <div className="slf-page-break" />

        {/* Recent updates — LIVE announcements + portal/admin changes first, then
            the static release notes. Reflects the current portal/admin state. */}
        <Section title="Recent Announcements & Changes">
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <Text strong style={{ color: "#722ed1" }}>Current Announcements</Text>
            {(Array.isArray(announcements) ? announcements : []).filter((a) => a && (a.title || a.message)).length ? (
              <ul style={{ margin: "4px 0 10px", paddingLeft: 18 }}>
                {(Array.isArray(announcements) ? announcements : [])
                  .filter((a) => a && (a.title || a.message))
                  .slice(0, 6)
                  .map((a, i) => (
                    <li key={`a${i}`}>
                      <b>{a.title || "Announcement"}</b>
                      {a.message ? ` — ${a.message}` : ""}
                      {a.startAt || a.updatedAt ? (
                        <Text type="secondary"> ({dayjs(a.startAt || a.updatedAt).format("MM/DD/YYYY")})</Text>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <div style={{ margin: "4px 0 10px" }}><Text type="secondary">No active portal announcements.</Text></div>
            )}
            <Text strong style={{ color: "#1677ff" }}>Recent Portal / Admin Changes</Text>
            {(Array.isArray(recentChanges) ? recentChanges : []).length ? (
              <ul style={{ margin: "4px 0 10px", paddingLeft: 18 }}>
                {(Array.isArray(recentChanges) ? recentChanges : [])
                  .slice(0, 10)
                  .map((t, i) => (
                    <li key={`c${i}`}>
                      {t.type ? <b>{String(t.type).replace(/_/g, " ")}: </b> : null}
                      {t.description || t.message || t.companyName || "Change recorded"}
                      {t.createdAt ? (
                        <Text type="secondary"> ({dayjs(t.createdAt).format("MM/DD/YYYY")})</Text>
                      ) : null}
                    </li>
                  ))}
              </ul>
            ) : (
              <div style={{ margin: "4px 0 10px" }}><Text type="secondary">No recent changes recorded.</Text></div>
            )}
            <Text strong style={{ color: "#2f54eb" }}>Updates</Text>
            <ul style={{ margin: "4px 0 10px", paddingLeft: 18 }}>
              {RECENT_UPDATES.updates.map((u, i) => <li key={`u${i}`}>{u}</li>)}
            </ul>
            <Text strong style={{ color: "#52c41a" }}>New Features</Text>
            <ul style={{ margin: "4px 0 10px", paddingLeft: 18 }}>
              {RECENT_UPDATES.features.map((u, i) => <li key={`f${i}`}>{u}</li>)}
            </ul>
            <Text strong style={{ color: "#cf1322" }}>Fixes</Text>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {RECENT_UPDATES.fixes.map((u, i) => <li key={`x${i}`}>{u}</li>)}
            </ul>
          </div>
        </Section>

        {/* Data gaps — preview only; excluded from the exported/printed PDF. */}
        <div className="slf-report-noprint">
        <Section title="Data Gaps & Limitations">
          <Alert
            type="warning"
            showIcon
            className="slf-report-card"
            title="Read before interpreting"
            description={
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
                <li>
                  Operator ↔ submission linkage is matched by <b>assigned SLF name</b> (submissions
                  store a submitter email + SLF name, not a hard operator ID), so renamed SLFs may
                  under-count.
                </li>
                {orphanSlfs.length > 0 && (
                  <li>
                    <b>{orphanSlfs.length}</b> SLF(s) received submissions but match no approved
                    operator by name: {orphanSlfs.slice(0, 5).map((r) => r.slfName).join(", ")}
                    {orphanSlfs.length > 5 ? "…" : ""}.
                  </li>
                )}
                <li>
                  A strict <b>baseline-vs-submitted</b> comparison is not available: facilities store a
                  design/receiving <i>capacity</i>, not a per-period expected volume, so only cumulative
                  utilisation can be approximated — omitted here to avoid misleading figures.
                </li>
                <li>
                  Cell status uses the facility <b>cellStatuses</b> field. There is no dedicated
                  "Full" or "Inactive" status — "Full (derived)" is inferred from cell fill ≥
                  capacity; all non-active statuses are grouped under "Other cells" in the chart.
                </li>
                <li>Dummy/test operators and submissions are excluded from all figures above.</li>
              </ul>
            }
          />
        </Section>
        </div>

        <div style={{ marginTop: 16, fontSize: 10, color: "#999", textAlign: "center" }}>
          Generated by ESWMP Admin · {generatedAt}
        </div>
      </div>
    </Modal>
  );
}
