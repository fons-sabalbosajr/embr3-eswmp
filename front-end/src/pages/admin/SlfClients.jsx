import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Card, Table, Button, Modal, Form, Input, Select, Space, Tag, Row, Col,
  Typography, Tooltip, Statistic, Descriptions, Popconfirm, AutoComplete, Empty, Alert, Progress, Popover, Segmented,
} from "antd";
import {
  PlusOutlined, EditOutlined, DownloadOutlined, SearchOutlined, EyeOutlined,
  ReloadOutlined, TeamOutlined, BankOutlined, UserOutlined, FilterOutlined,
  ClearOutlined, DeleteOutlined, StopOutlined, CheckCircleOutlined, EnvironmentOutlined,
  PhoneOutlined, MailOutlined, SolutionOutlined, SyncOutlined, WarningOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import dayjs from "dayjs";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import { withSizeChanger } from "../../utils/tablePagination";
import { getSocket } from "../../utils/socket";
import { invalidateRelationshipMap } from "../../utils/relationshipMapCache";
import {
  NAVY,
  NAVY_MID,
  BLUE,
  GREEN,
  REGION_TILE,
} from "../../utils/palette";
import VeraFlameIcon from "../../components/VeraFlameIcon";

const { Title, Text } = Typography;

const TYPE_OPTIONS = [
  { label: "LGU", value: "LGU" },
  { label: "Private Sector", value: "Private Sector" },
];
const STATUS_OPTIONS = [
  { label: "Active", value: "Active" },
  { label: "Inactive", value: "Inactive" },
];

// Human labels for SlfDataIssue.flagType — EVERY type the model defines. Three
// were missing, so those rows showed the raw key ("region_unclassified").
const FLAG_LABELS = {
  missing_type: "Missing client type",
  missing_hauler: "Missing hauler",
  unknown_hauler: "Unknown hauler",
  duplicate_client: "Duplicate assignment",
  conflicting_portal_users: "Conflicting portal users",
  invalid_baseline: "Invalid baseline",
  unmigrated_baseline_client: "Not yet migrated",
  ambiguous_duplicate: "Listed under two types",
  region_unclassified: "No province (Region 3 unknown)",
  validation_mismatch: "Totals mismatch",
};
// Tag colour by how much a person is needed: red needs a decision, orange is
// missing data, blue is classification VERA can often repair.
const FLAG_COLORS = {
  conflicting_portal_users: "red",
  ambiguous_duplicate: "red",
  invalid_baseline: "red",
  validation_mismatch: "red",
  missing_hauler: "orange",
  missing_type: "orange",
  unknown_hauler: "orange",
  duplicate_client: "gold",
  unmigrated_baseline_client: "gold",
  region_unclassified: "blue",
};

const typeTag = (t) =>
  t === "LGU" ? <Tag color="blue">LGU</Tag>
  : t === "Private Sector" ? <Tag color="purple">Private Sector</Tag>
  : <Tag>—</Tag>;

const statusTag = (s) =>
  s === "Active"
    ? <Tag color="green" bordered={false}><CheckCircleOutlined /> Active</Tag>
    : <Tag color="default" bordered={false}><StopOutlined /> Inactive</Tag>;

// The Issues toolbar button and its built-in count.
const ISSUES_BTN_CSS = `
.slf-issues-btn { display: inline-flex; align-items: center; gap: 6px; }
.slf-issues-btn .slf-issues-btn__count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 20px; padding: 0 7px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;
  background: #f6ffed; color: #389e0d; border: 1px solid #b7eb8f;
}
.slf-issues-btn.has-issues { border-color: #ffd591; color: #ad4e00; }
.slf-issues-btn.has-issues:hover { border-color: #fa8c16 !important; color: #d46b08 !important; }
.slf-issues-btn.has-issues .slf-issues-btn__count { background: #fa8c16; color: #fff; border-color: #fa8c16; }

/* ── VERA buttons: ONE look everywhere on this page ──
   VERA's colour is the flame's teal. These used to be a robot icon in navy,
   navy-filled on some rows and plain on others, beside a blue Resolve and a red
   Ignore — four colour systems in one toolbar. */
.vera-btn.ant-btn {
  display: inline-flex; align-items: center; gap: 6px;
  color: #006d75; background: #e6fffb; border-color: #87e8de; font-weight: 500;
}
.vera-btn.ant-btn:not(:disabled):hover { color: #00474f !important; background: #b5f5ec !important; border-color: #36cfc9 !important; }
.vera-btn.ant-btn.vera-btn--primary {
  color: #fff; border-color: transparent;
  background: linear-gradient(135deg, #08979c 0%, #13a8a8 55%, #389e0d 140%);
  box-shadow: 0 2px 6px rgba(8, 151, 156, 0.28);
}
.vera-btn.ant-btn.vera-btn--primary:not(:disabled):hover {
  color: #fff !important; border-color: transparent !important;
  background: linear-gradient(135deg, #006d75 0%, #08979c 55%, #237804 140%) !important;
}
.vera-btn.ant-btn:disabled { color: rgba(0,0,0,0.3); background: #f5f5f5; border-color: #e5e5e5; box-shadow: none; }

/* ── Client Data Issues modal ── */
.slf-issues-head {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;
  margin-bottom: 10px;
}
.slf-issues-head__left { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.slf-issues-vera {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding: 8px 10px; margin-bottom: 12px;
  background: #f6fffe; border: 1px solid #b5f5ec; border-radius: 10px;
}
.slf-issues-vera__label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #006d75; margin-right: 4px; }
.slf-issues-vera__sep { width: 1px; height: 18px; background: #b5f5ec; }
.slf-issues-vera__hint { font-size: 11.5px; color: #5b7a7d; }
.slf-issue-actions .ant-btn { font-size: 12px; }
`;

const REGION_OPTIONS = [
  { label: "Within Region 3", value: "within-region-3" },
  { label: "Outside Region 3", value: "outside-region-3" },
  { label: "Unclassified", value: "unclassified" },
];
const regionTag = (rc) =>
  rc === "within-region-3" ? <Tag color="green" bordered={false}>Within R3</Tag>
  : rc === "outside-region-3" ? <Tag color="blue" bordered={false}>Outside R3</Tag>
  : <Tag color="orange" bordered={false}>Unclassified</Tag>;

// A client is served by an SLF, not by a person, so this section identifies the
// linked portal account by its ASSIGNED SLF NAME. The operator name is only a
// fallback for accounts that have no SLF assigned yet.
const portalUserLabel = (u) => {
  if (!u) return "";
  const slfNames = (Array.isArray(u.assignedSlfName) ? u.assignedSlfName : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  if (slfNames.length) return slfNames.join(", ");
  return `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.companyName || u.email || u.username || "";
};

// Format a timestamp in the official application timezone (Asia/Manila) as
// "July 21, 2026, 1:30 PM". Returns "Never Synced" when absent.
const MANILA_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
});
const formatManila = (v) => (v ? MANILA_FMT.format(new Date(v)) : "Never Synced");

// Distinct, alphabetically-sorted SLF names for a client's linked portal
// accounts (no duplicates). `byId` resolves to the account's assigned SLF name,
// which is what this section labels — the stored `portalUserName` is a person's
// name and is only used when the account has no SLF assigned.
const uniqueUserNames = (r, byId = {}) => {
  const seen = new Map();
  (r.portalUserRelationships || []).forEach((rel) => {
    const id = String(rel.portalUser || rel.portalUserEmail || "");
    if (!id || seen.has(id)) return;
    seen.set(id, byId[rel.portalUser] || rel.portalUserName || rel.portalUserEmail || "Unknown");
  });
  // Fall back to the legacy single-value field for admin-created clients.
  if (!seen.size && (byId[r.portalUser] || r.portalUserName)) {
    seen.set("legacy", byId[r.portalUser] || r.portalUserName);
  }
  // De-duplicated by NAME as well: two accounts assigned to the same SLF (PWS has
  // two) are one SLF, not "Prime Waste Solution +1".
  return [...new Set(seen.values())].sort((a, b) => a.localeCompare(b));
};

export default function SlfClients({ isDark, canView = true, canEdit = true, canDelete = true }) {
  const [records, setRecords] = useState([]);
  const [portalUsers, setPortalUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState(null);
  const [filterPortalUser, setFilterPortalUser] = useState(null);
  const [filterHauler, setFilterHauler] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterLocation, setFilterLocation] = useState(null);
  const [filterRegion, setFilterRegion] = useState(null); // within-region-3 | outside-region-3 | unclassified

  // Persisted Region 3 breakdown (source for the four region tiles).
  const [regionSummary, setRegionSummary] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // Baseline-sourced hauler names for the client hauler dropdown.
  const [baselineHaulers, setBaselineHaulers] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  // Live sync-job progress (socket-streamed, poll fallback).
  const [syncJob, setSyncJob] = useState(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const pollRef = useRef(null);
  // Timestamp of the last socket progress frame — drives the adaptive poll.
  const lastSocketAtRef = useRef(0);
  // Data-issue flags (baseline records that could not be synced safely).
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issues, setIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState("");
  // "open" by default — the actionable set. Everything else is history.
  const [issuesStatus, setIssuesStatus] = useState("open");
  const [issuesPaging, setIssuesPaging] = useState({ current: 1, pageSize: 10, total: 0 });
  const [issuesCounts, setIssuesCounts] = useState({});
  // VERA proposal for one issue. `suggestion` is what the server computed; the
  // admin approves it before anything is written.
  const [veraFix, setVeraFix] = useState({
    open: false, loadingId: null, applying: false, issue: null, suggestion: null, choice: null,
  });
  // issueId -> suggestion, for the rows currently on screen. Drives which
  // checkboxes are selectable.
  const [issueFixable, setIssueFixable] = useState({});
  const [selectedIssueKeys, setSelectedIssueKeys] = useState([]);
  const [bulkFixing, setBulkFixing] = useState(false);
  // How many issues in the CURRENT filter are marked VERA-resolvable, as counted by
  // the server over the whole result set (not the page).
  const [veraCount, setVeraCount] = useState(0);
  const [veraMarking, setVeraMarking] = useState(false);

  // Only HIGH-confidence proposals are bulk-selectable. An ambiguous match needs
  // a province chosen by a person, so it stays a one-at-a-time decision.
  const isBulkFixable = (id) => {
    const s = issueFixable[id];
    return !!s?.canFix && s.confidence === "high";
  };
  const fixableOnPage = issues.filter((i) => i.status === "open" && isBulkFixable(i._id));

  // Checkboxes are now open to any OPEN issue, because authorizing VERA is a
  // decision an admin may take on any of them. A bulk REPAIR is still restricted to
  // high-confidence proposals, so it narrows the same selection here rather than
  // relying on which boxes were enabled.
  const selectedFixableKeys = selectedIssueKeys.filter(isBulkFixable);

  /**
   * Mark (or unmark) issues as VERA-resolvable.
   *
   * `scope: "selected"` sends the ticked ids — which may span several pages.
   * `scope: "all"` sends no ids at all: the SERVER re-applies the current filter
   * and updates every matching document. That is what makes this a selection over
   * the whole dataset (28,000+ issues) instead of over the 10–100 rows rendered.
   */
  const markVeraResolvable = async (scope, veraResolvable) => {
    const count = scope === "all" ? issuesPaging.total : selectedIssueKeys.length;
    if (scope === "selected" && !count) return;
    const confirm = await Swal.fire({
      icon: "question",
      title: veraResolvable ? `Allow VERA to resolve ${count.toLocaleString()} issue(s)?` : `Remove VERA permission from ${count.toLocaleString()} issue(s)?`,
      text: veraResolvable
        ? "This records that VERA is allowed to resolve them. It does NOT resolve them now — they stay open until repaired."
        : "VERA will no longer be allowed to resolve them. Their status is unchanged.",
      showCancelButton: true,
      confirmButtonText: veraResolvable ? "Mark as VERA-resolvable" : "Remove permission",
      confirmButtonColor: "#1a3353",
    });
    if (!confirm.isConfirmed) return;
    setVeraMarking(true);
    try {
      const { data } = await api.patch("/slf-clients/issues/vera-resolvable", {
        veraResolvable,
        ...(scope === "all"
          ? { all: true, ...(issuesStatus ? { status: issuesStatus } : {}) }
          : { ids: selectedIssueKeys }),
      });
      setSelectedIssueKeys([]);
      // Re-read so the table shows the PERSISTED flag, never an optimistic guess.
      await loadIssues(issuesPaging.current, issuesPaging.pageSize, issuesStatus);
      Swal.fire({
        icon: "success",
        title: `${(data?.modified || 0).toLocaleString()} issue(s) updated`,
        text: veraResolvable
          ? "VERA is now allowed to resolve them. They remain open until repaired."
          : "VERA permission removed.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not update VERA permission.", "error");
    } finally {
      setVeraMarking(false);
    }
  };

  const runBulkVeraFix = async () => {
    // Only high-confidence proposals are repaired in bulk. The checkbox column is
    // shared with the VERA-resolvable marking, which may legitimately include rows
    // that need a person, so the eligible subset is taken here.
    if (!selectedFixableKeys.length) return;
    const confirm = await Swal.fire({
      icon: "question",
      title: `Repair ${selectedFixableKeys.length} issue(s)?`,
      text: "VERA will set the province and municipality on each client from the Region 3 masterlist, then resolve the issue. This is recorded against your account.",
      showCancelButton: true,
      confirmButtonText: "Approve & Repair",
      confirmButtonColor: "#1a3353",
    });
    if (!confirm.isConfirmed) return;
    setBulkFixing(true);
    try {
      const { data } = await api.post("/slf-clients/issues/apply-batch", { ids: selectedFixableKeys });
      setSelectedIssueKeys([]);
      await loadIssues(issuesPaging.current, issuesPaging.pageSize, issuesStatus);
      fetchOpenIssueCount();
      fetchRecords(false);
      Swal.fire({
        icon: data?.applied ? "success" : "info",
        title: `${data?.applied || 0} repaired`,
        text: data?.skipped
          ? `${data.skipped} were skipped — they need a province chosen by hand.`
          : "All selected issues were repaired.",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Bulk repair failed.", "error");
    } finally {
      setBulkFixing(false);
    }
  };

  const askVera = async (issue) => {
    setVeraFix((s) => ({ ...s, loadingId: issue._id }));
    try {
      const { data } = await api.get(`/slf-clients/issues/${issue._id}/suggestion`);
      setVeraFix({
        open: true, loadingId: null, applying: false, issue,
        suggestion: data,
        choice: data?.proposal || null,
      });
    } catch (err) {
      setVeraFix((s) => ({ ...s, loadingId: null }));
      Swal.fire("Error", err.response?.data?.message || "Could not get a suggestion.", "error");
    }
  };

  const applyVeraFix = async () => {
    const { issue, choice } = veraFix;
    if (!issue || !choice?.province) return;
    setVeraFix((s) => ({ ...s, applying: true }));
    try {
      await api.post(`/slf-clients/issues/${issue._id}/apply-suggestion`, {
        province: choice.province,
        municipalityCity: choice.municipalityCity,
      });
      setVeraFix({ open: false, loadingId: null, applying: false, issue: null, suggestion: null, choice: null });
      await loadIssues(issuesPaging.current, issuesPaging.pageSize, issuesStatus);
      fetchOpenIssueCount();
      fetchRecords(false);
      Swal.fire({ icon: "success", title: "Fix applied", text: "The client record was updated and the issue resolved.", timer: 1800, showConfirmButton: false });
    } catch (err) {
      setVeraFix((s) => ({ ...s, applying: false }));
      Swal.fire("Error", err.response?.data?.message || "Could not apply the fix.", "error");
    }
  };
  const [openIssueCount, setOpenIssueCount] = useState(0);
  const [veraAutofixing, setVeraAutofixing] = useState(false);

  // "Let VERA fix" — one server run over every open issue (services/
  // veraIssueAutofix.js). Only deterministic actions; the summary says exactly
  // what was closed, repaired and left for a person.
  const runVeraAutofix = async () => {
    const confirm = await Swal.fire({
      icon: "question",
      title: "Let VERA fix the client issues?",
      html:
        '<div style="text-align:left;font-size:14px;line-height:1.55">VERA will:<ul style="margin:8px 0 0 18px;padding:0">' +
        "<li>close duplicate copies of the same issue,</li>" +
        "<li>close issues the current data no longer supports,</li>" +
        "<li>set the province and municipality where the client matches ONE Region 3 masterlist entry.</li>" +
        "</ul><div style=\"margin-top:8px;color:#666\">Anything that needs a decision stays open. Every change is recorded and can be reopened.</div></div>",
      showCancelButton: true,
      confirmButtonText: "Let VERA fix",
      confirmButtonColor: "#1a3353",
    });
    if (!confirm.isConfirmed) return;
    setVeraAutofixing(true);
    try {
      const { data } = await api.post("/slf-clients/issues/vera-autofix");
      fetchOpenIssueCount();
      fetchRecords(false);
      if (issuesOpen) loadIssues(1, issuesPaging.pageSize, issuesStatus);
      const stale = data?.staleClosed || {};
      const left = Object.entries(data?.leftOpenByType || {})
        .map(([type, n]) => `<li>${(FLAG_LABELS[type] || type)}: <b>${n.toLocaleString()}</b></li>`)
        .join("");
      Swal.fire({
        icon: "success",
        title: `VERA resolved ${(data?.resolved || 0).toLocaleString()} issue(s)`,
        html:
          '<div style="text-align:left;font-size:14px;line-height:1.6">' +
          `<b>${(data?.duplicateCopies || 0).toLocaleString()}</b> duplicate copies closed<br/>` +
          `<b>${((stale.duplicate_client || 0) + (stale.region_unclassified || 0) + (stale.missing_hauler || 0)).toLocaleString()}</b> out-of-date issues closed<br/>` +
          `<b>${(data?.repaired || 0).toLocaleString()}</b> client locations repaired from the masterlist` +
          (data?.leftOpen
            ? `<div style="margin-top:10px"><b>${data.leftOpen.toLocaleString()}</b> left for review:<ul style="margin:4px 0 0 18px;padding:0">${left}</ul></div>`
            : '<div style="margin-top:10px">Nothing is left open.</div>') +
          "</div>",
        confirmButtonColor: "#1a3353",
      });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "VERA could not fix the issues.", "error");
    } finally {
      setVeraAutofixing(false);
    }
  };

  const fetchRecords = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [clientsRes, usersRes, haulerRes, summaryRes] = await Promise.all([
        api.get("/slf-clients"),
        api.get("/portal-users").catch(() => ({ data: [] })),
        api.get("/slf-clients/hauler-options").catch(() => ({ data: [] })),
        api.get("/slf-clients/summary").catch(() => ({ data: null })),
      ]);
      setRecords(Array.isArray(clientsRes.data) ? clientsRes.data : []);
      setPortalUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setBaselineHaulers(Array.isArray(haulerRes.data) ? haulerRes.data : []);
      setRegionSummary(summaryRes.data || null);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Authoritative open-issue count for the toolbar badge — one source of truth
  // (server countDocuments), not the length of a fetched list.
  const fetchOpenIssueCount = useCallback(async () => {
    try {
      const { data } = await api.get("/slf-clients/issues/count", { params: { status: "open" } });
      setOpenIssueCount(Number(data?.count) || 0);
    } catch { /* non-blocking */ }
  }, []);
  useEffect(() => { fetchOpenIssueCount(); }, [fetchOpenIssueCount]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // Real-time refresh when any admin changes a client record.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onRefresh = ({ target } = {}) => {
      if (target !== "slf-clients") return;
      // The served-clients relationship map is derived from these records, so its
      // shared cache must not outlive an edit.
      invalidateRelationshipMap();
      fetchRecords(false);
    };
    socket.on("data-refresh", onRefresh);
    return () => socket.off("data-refresh", onRefresh);
  }, [fetchRecords]);

  const portalUserById = useMemo(() => {
    const map = {};
    portalUsers.forEach((u) => { map[u._id] = portalUserLabel(u); });
    return map;
  }, [portalUsers]);

  const portalUserOptions = useMemo(
    () => portalUsers.map((u) => ({ label: portalUserLabel(u), value: u._id })),
    [portalUsers],
  );

  // Hauler dropdown = baseline accreditedHaulers ∪ haulers already on client
  // records, deduped case/space-insensitively so variants never double up.
  const haulerOptions = useMemo(() => {
    const byNorm = new Map();
    const add = (h) => {
      const display = String(h || "").trim();
      if (!display) return;
      const norm = display.toLowerCase().replace(/\s+/g, " ");
      if (!byNorm.has(norm)) byNorm.set(norm, display);
    };
    baselineHaulers.forEach(add);
    records.forEach((r) => add(r.hauler));
    return [...byNorm.values()].sort((a, b) => a.localeCompare(b)).map((h) => ({ label: h, value: h }));
  }, [baselineHaulers, records]);

  const locationOptions = useMemo(() => {
    const set = new Set(records.map((r) => (r.location || "").trim()).filter(Boolean));
    return [...set].sort().map((l) => ({ label: l, value: l }));
  }, [records]);

  // The SLF the linked account is assigned to — what this page calls "SLF Name".
  // `portalUserName` is stored by the sync as the operator's PERSONAL name
  // (517 of 525 links), so reading it first put "REYNALDO ARAGON JR" in the SLF
  // Name column of the export and the search. It is only a fallback now.
  const displayUser = (r) => uniqueUserNames(r, portalUserById).join(", ") || portalUserById[r.portalUser] || r.portalUserName || "";

  // Issue rows carry the declaring account's EMAIL; resolve it to that
  // account's SLF so the Issues table's "SLF Name" column says what it is named.
  const slfNameByEmail = useMemo(() => {
    const map = {};
    portalUsers.forEach((u) => {
      const email = String(u.email || "").trim().toLowerCase();
      if (email) map[email] = portalUserLabel(u);
    });
    return map;
  }, [portalUsers]);
  // Distinct portal users / haulers linked to a canonical client (relationship-based).
  const relCount = (r) => {
    const rels = Array.isArray(r.portalUserRelationships) ? r.portalUserRelationships : [];
    return new Set(rels.map((x) => String(x.portalUser || x.portalUserEmail || "")).filter(Boolean)).size;
  };
  const haulerCount = (r) => {
    const hs = Array.isArray(r.haulerRelationships) ? r.haulerRelationships : [];
    const set = new Set(hs.map((x) => x.normalizedHauler || (x.hauler || "").toLowerCase()).filter(Boolean));
    if (!set.size && r.hauler) return 1;
    return set.size;
  };
  const isMultiPortal = (r) => r.multiPortalStatus === "Multiple Portal Users" || relCount(r) > 1;

  const hasActiveFilters = filterType || filterPortalUser || filterHauler || filterStatus || filterLocation || filterRegion || search;
  const clearAllFilters = () => {
    setFilterType(null); setFilterPortalUser(null); setFilterHauler(null);
    setFilterStatus(null); setFilterLocation(null); setFilterRegion(null); setSearch("");
  };

  // Region tile → filter the table to that active type + region so the tile
  // count and the visible rows correspond.
  const applyRegionTile = (type, region) => {
    setFilterPortalUser(null); setFilterHauler(null); setFilterLocation(null); setSearch("");
    setFilterType(type); setFilterRegion(region); setFilterStatus("Active");
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (filterType && r.type !== filterType) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterRegion && (r.regionClass || "unclassified") !== filterRegion) return false;
      if (filterPortalUser) {
        const rels = r.portalUserRelationships || [];
        const match = String(r.portalUser) === String(filterPortalUser) || rels.some((x) => String(x.portalUser) === String(filterPortalUser));
        if (!match) return false;
      }
      if (filterHauler) {
        const hs = (r.haulerRelationships || []).map((x) => x.hauler);
        if ((r.hauler || "") !== filterHauler && !hs.includes(filterHauler)) return false;
      }
      if (filterLocation && (r.location || "") !== filterLocation) return false;
      if (!q) return true;
      return [r.name, r.hauler, r.location, r.address, r.contactPerson, r.contactNumber, r.contactEmail, displayUser(r)]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, search, filterType, filterStatus, filterRegion, filterPortalUser, filterHauler, filterLocation, portalUserById]);

  const summary = useMemo(() => {
    const s = { total: filtered.length, lgu: 0, private: 0, active: 0, inactive: 0 };
    filtered.forEach((r) => {
      if (r.type === "LGU") s.lgu += 1;
      else if (r.type === "Private Sector") s.private += 1;
      if (r.status === "Active") s.active += 1; else s.inactive += 1;
    });
    return s;
  }, [filtered]);

  // Populated via `initialValues` at mount, not by setFieldsValue before opening —
  // a Modal does not render its children until it first opens, so on the first Edit
  // after load there were no mounted Form.Items to receive the values and the form
  // came up blank. Same defect and same fix as HaulerClientsEditor.
  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (r) => { setEditing(r); setModalOpen(true); };

  const clientInitialValues = useMemo(() => {
    if (!editing) return { status: "Active" };
    const r = editing;
    return {
      name: r.name, type: r.type, portalUser: r.portalUser || undefined, hauler: r.hauler,
      location: r.location, province: r.province, municipalityCity: r.municipalityCity,
      address: r.address, contactPerson: r.contactPerson,
      contactNumber: r.contactNumber, contactEmail: r.contactEmail, status: r.status, notes: r.notes,
    };
  }, [editing]);

  const handleSave = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    const payload = {
      ...values,
      portalUserName: values.portalUser ? (portalUserById[values.portalUser] || "") : "",
    };
    try {
      if (editing) {
        await api.put(`/slf-clients/${editing._id}`, payload);
        Swal.fire({ icon: "success", title: "Client updated", timer: 1200, showConfirmButton: false });
      } else {
        await api.post("/slf-clients", payload);
        Swal.fire({ icon: "success", title: "Client added", timer: 1200, showConfirmButton: false });
      }
      setModalOpen(false);
      fetchRecords(false);
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Save failed", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (r) => {
    Swal.fire({
      title: "Delete this client?",
      text: `${r.name} (${r.type})`,
      icon: "warning", showCancelButton: true, confirmButtonColor: "#ff4d4f", confirmButtonText: "Delete",
    }).then(async (res) => {
      if (!res.isConfirmed) return;
      try {
        await api.delete(`/slf-clients/${r._id}`);
        setRecords((prev) => prev.filter((x) => x._id !== r._id));
        Swal.fire({ icon: "success", title: "Client deleted", timer: 1200, showConfirmButton: false });
      } catch (err) {
        Swal.fire("Error", err.response?.data?.message || "Delete failed", "error");
      }
    });
  };

  const handleToggleStatus = (r) => {
    const next = r.status === "Active" ? "Inactive" : "Active";
    Swal.fire({
      title: `${next === "Inactive" ? "Deactivate" : "Activate"} this client?`,
      text: `${r.name} (${r.type})`,
      icon: "question", showCancelButton: true, confirmButtonText: next === "Inactive" ? "Deactivate" : "Activate",
    }).then(async (res) => {
      if (!res.isConfirmed) return;
      try {
        const { data } = await api.patch(`/slf-clients/${r._id}/status`, { status: next });
        setRecords((prev) => prev.map((x) => (x._id === r._id ? data : x)));
        Swal.fire({ icon: "success", title: `Client ${next === "Inactive" ? "deactivated" : "activated"}`, timer: 1200, showConfirmButton: false });
      } catch (err) {
        Swal.fire("Error", err.response?.data?.message || "Update failed", "error");
      }
    });
  };

  const handleExport = () => {
    const rows = filtered.map((r) => ({
      "Client Name": r.name,
      Type: r.type,
      "SLF Name": displayUser(r),
      Hauler: r.hauler,
      Location: r.location,
      Address: r.address,
      "Contact Person": r.contactPerson,
      "Contact Number": r.contactNumber,
      "Contact Email": r.contactEmail,
      Status: r.status,
      Notes: r.notes,
      "Created": r.createdAt ? dayjs(r.createdAt).format("MM/DD/YYYY") : "",
      "Updated": r.updatedAt ? dayjs(r.updatedAt).format("MM/DD/YYYY") : "",
    }));
    exportToExcel(rows, "SLF_Clients");
  };

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const finishJob = useCallback(() => {
    stopPolling();
    setSyncing(false);
    fetchRecords(false);
    fetchOpenIssueCount();
  }, [stopPolling, fetchRecords, fetchOpenIssueCount]);

  const isTerminal = (s) => ["completed", "completed_with_issues", "failed"].includes(s);

  /**
   * How long a socket frame vouches for the connection.
   *
   * Must exceed the longest normal gap between progress frames — the worker
   * reports every 25 records but a slow stage can be quieter than that — or the
   * poll would fire during a perfectly healthy sync and defeat the point. Six
   * seconds is three poll ticks, so a genuinely dead socket is picked up within
   * about two seconds of the window lapsing.
   */
  const SOCKET_ALIVE_MS = 6000;

  // Poll the job status as a socket-independent fallback (socket is the primary
  // channel; polling guarantees progress even if the socket drops).
  //
  // ADAPTIVE: the tick is skipped while the socket is demonstrably alive. A long
  // sync previously issued a status request every 2s for its whole duration —
  // each one a DB read plus a full setSyncJob() re-render — on top of the socket
  // stream already delivering the same payload. The interval keeps running, so
  // the moment the socket goes quiet for longer than the grace window the poll
  // takes over on the very next tick and the fallback guarantee is unchanged.
  const startPolling = useCallback((jobId) => {
    stopPolling();
    // Clear any liveness left over from a previous run, so if the socket never
    // connects at all the very first tick polls instead of trusting a stale mark.
    lastSocketAtRef.current = 0;
    pollRef.current = setInterval(async () => {
      const sinceSocket = Date.now() - (lastSocketAtRef.current || 0);
      if (sinceSocket < SOCKET_ALIVE_MS) return;
      try {
        const { data } = await api.get(`/slf-clients/sync/${jobId}`);
        setSyncJob((prev) => ({
          ...prev, jobId, status: data.status, percent: data.percent, stage: data.stage,
          stageLabel: data.stageLabel, processed: data.processedRecords, total: data.totalRecords,
          counts: { created: data.created, updated: data.updated, skipped: data.skipped, duplicates: data.duplicates, merged: data.merged, removed: data.removed, flagged: data.flagged },
          summary: data.summary, error: data.errorMessage,
        }));
        if (isTerminal(data.status)) finishJob();
      } catch { /* keep trying */ }
    }, 2000);
  }, [stopPolling, finishJob]);

  // Socket-streamed progress (preferred real-time mechanism).
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onProgress = (payload) => {
      // Liveness marker read by the adaptive poll above.
      lastSocketAtRef.current = Date.now();
      setSyncJob((prev) => {
        if (!prev?.jobId || String(payload.jobId) !== String(prev.jobId)) return prev;
        return { ...prev, ...payload };
      });
      if (isTerminal(payload.status)) finishJob();
    };
    socket.on("slf-sync-progress", onProgress);
    return () => socket.off("slf-sync-progress", onProgress);
  }, [finishJob]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Idempotent baseline → SlfClient sync, started as a tracked job with live
  // progress. Re-running never duplicates; un-syncable rows become flagged issues.
  const handleSync = async () => {
    const confirm = await Swal.fire({
      title: "Sync clients from baseline?",
      text: "Reads portal baseline haulers & clients and safely upserts client records. Existing admin-managed clients are preserved.",
      icon: "question", showCancelButton: true, confirmButtonText: "Run sync",
    });
    if (!confirm.isConfirmed) return;
    setSyncing(true);
    setSyncJob({ status: "running", percent: 0, stageLabel: "Starting…" });
    setSyncModalOpen(true);
    try {
      const { data } = await api.post("/slf-clients/sync");
      setSyncJob((prev) => ({ ...prev, jobId: data.jobId, status: "running" }));
      startPolling(data.jobId);
    } catch (err) {
      if (err.response?.status === 409 && err.response.data?.jobId) {
        // Another job is already running — attach to it.
        const jobId = err.response.data.jobId;
        setSyncJob({ jobId, status: "running", percent: 0, stageLabel: "A sync is already running…" });
        startPolling(jobId);
      } else {
        setSyncing(false);
        setSyncJob({ status: "failed", error: err.response?.data?.message || "Sync failed to start" });
      }
    }
  };

  const handleCleanup = async () => {
    const confirm = await Swal.fire({
      title: "Merge duplicate clients?",
      text: "Collapses exact-duplicate client rows into one canonical profile. Idempotent and non-destructive (duplicates are archived, not deleted).",
      icon: "question", showCancelButton: true, confirmButtonText: "Run cleanup",
    });
    if (!confirm.isConfirmed) return;
    setCleaning(true);
    try {
      const { data } = await api.post("/slf-clients/cleanup-duplicates");
      await fetchRecords(false);
      fetchOpenIssueCount();
      Swal.fire({ icon: "success", title: "Cleanup complete", html: `<div style="text-align:left"><b>${data.duplicatesRemoved}</b> duplicate rows archived<br/><b>${data.canonicalsAffected}</b> canonical profiles updated<br/><b>${data.flaggedAmbiguous}</b> ambiguous flagged</div>` });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Cleanup failed", "error");
    } finally {
      setCleaning(false);
    }
  };

  // Server-side paging. There are tens of thousands of flagged records; asking
  // for all of them never returned, and the failure surfaced as an empty table.
  const loadIssues = useCallback(async (page = 1, pageSize = 10, status = issuesStatus) => {
    setIssuesLoading(true);
    setIssuesError("");
    try {
      const { data } = await api.get("/slf-clients/issues", {
        params: { page, limit: pageSize, ...(status ? { status } : {}) },
      });
      // Tolerates the previous array-shaped response.
      const rows = Array.isArray(data) ? data : data?.data || [];
      setIssues(rows);
      // Ask VERA which of THIS page's rows it can actually repair, in one call,
      // so the checkboxes can be limited to those. Non-blocking: the table shows
      // immediately and the boxes enable when the answer lands.
      setIssueFixable({});
      // NOTE: the staged selection is deliberately NOT cleared here. Paging used to
      // wipe it, so a selection could never span more than the rows on screen —
      // which is precisely what the VERA-resolvable marking has to be able to do.
      // Combined with `preserveSelectedRowKeys` on the table, ticks made on page 1
      // are still there after visiting page 3 and coming back.
      if (rows.length) {
        api
          .post("/slf-clients/issues/suggest-batch", { ids: rows.map((r) => r._id) })
          .then(({ data: res }) => setIssueFixable(res?.suggestions || {}))
          .catch(() => setIssueFixable({}));
      }
      setIssuesPaging({
        current: data?.page || page,
        pageSize: data?.limit || pageSize,
        total: Array.isArray(data) ? rows.length : data?.total || 0,
      });
      setIssuesCounts(data?.counts || {});
      // How many of the CURRENT filter are already authorized for VERA, counted in
      // the database over the whole result set — not over this page.
      setVeraCount(Number(data?.veraResolvableCount || 0));
    } catch (err) {
      setIssues([]);
      // Say so, rather than rendering "No data issues" over a failed request.
      setIssuesError(
        err.response?.data?.message || "Could not load data issues. Please try again.",
      );
    } finally {
      setIssuesLoading(false);
    }
  }, [issuesStatus]);

  const openIssues = async () => {
    setIssuesOpen(true);
    loadIssues(1, issuesPaging.pageSize, issuesStatus);
  };

  const resolveIssue = async (issue, status) => {
    try {
      await api.patch(`/slf-clients/issues/${issue._id}/resolve`, { status });
      // Reload the current page rather than patching the row in place: with a
      // status filter active the row has just left the result set, and the total
      // and per-status counts have both moved.
      await loadIssues(issuesPaging.current, issuesPaging.pageSize, issuesStatus);
      fetchOpenIssueCount();
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Could not update issue", "error");
    }
  };

  const columns = [
    {
      title: "Client", dataIndex: "name", key: "name", width: 200, fixed: "left",
      sorter: (a, b) => (a.name || "").localeCompare(b.name || ""),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <Text strong style={{ fontSize: 12 }}>{r.name}</Text><br />
          {typeTag(r.type)}
        </div>
      ),
    },
    {
      title: "SLF Name", key: "portalUser", width: 280,
      sorter: (a, b) => relCount(a) - relCount(b),
      render: (_, r) => {
        const users = uniqueUserNames(r, portalUserById);
        if (!users.length) return <Text type="secondary">—</Text>;
        const primary = users[0];
        const extra = users.length - 1;
        return (
          <Space size={6} wrap>
            <Tooltip title={users.length > 1 ? users.join(" · ") : undefined}>
              <Text style={{ fontSize: 12 }}>{primary}{extra > 0 ? <Text type="secondary" style={{ fontSize: 11 }}> +{extra}</Text> : null}</Text>
            </Tooltip>
            {isMultiPortal(r) && <Tag color="gold" bordered={false}>Multiple</Tag>}
            {/* On-demand source detail (relationships render lazily on open). */}
            <Popover
              trigger="click"
              destroyTooltipOnHide
              title={<span>Linked portal users &amp; sources</span>}
              content={
                <div style={{ maxWidth: 340, maxHeight: 280, overflowY: "auto" }}>
                  {(r.portalUserRelationships || []).length === 0
                    ? <Text type="secondary" style={{ fontSize: 12 }}>Manually added client (no baseline source).</Text>
                    : (r.portalUserRelationships || []).map((rel, i) => (
                      <div key={i} style={{ padding: "6px 0", borderTop: i ? "1px solid #f0f0f0" : "none" }}>
                        <Text strong style={{ fontSize: 12 }}>{rel.portalUserName || portalUserById[rel.portalUser] || rel.portalUserEmail || "Unknown"}</Text>
                        <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                          Hauler: {rel.hauler || "—"} · Status: <Tag color={rel.status === "active" ? "green" : "default"} style={{ marginInline: 2 }}>{rel.status || "active"}</Tag>
                        </div>
                        <div style={{ fontSize: 11, color: "#8c8c8c" }}>
                          Source: {rel.baselineRef ? <Tag color="geekblue" style={{ marginInline: 2 }}>Baseline {String(rel.baselineRef).slice(-6)}</Tag> : <Tag style={{ marginInline: 2 }}>Admin-managed</Tag>}
                          {rel.lastSyncedAt ? ` · Last synced ${formatManila(rel.lastSyncedAt)}` : ""}
                        </div>
                      </div>
                    ))}
                </div>
              }
            >
              <Button type="text" size="small" aria-label={`View ${users.length} linked portal user${users.length === 1 ? "" : "s"} and baseline sources`} icon={<TeamOutlined style={{ color: "#1a3353" }} />} />
            </Popover>
          </Space>
        );
      },
    },
    {
      title: "Haulers", key: "hauler", width: 180,
      sorter: (a, b) => haulerCount(a) - haulerCount(b),
      render: (_, r) => {
        const n = haulerCount(r);
        const primary = r.haulerRelationships?.[0]?.hauler || r.hauler || "";
        return primary
          ? <Space size={4}><SolutionOutlined style={{ color: "#1677ff" }} /><Text style={{ fontSize: 12 }}>{primary}</Text>{n > 1 && <Tag color="cyan">+{n - 1}</Tag>}</Space>
          : <Text type="secondary">—</Text>;
      },
    },
    {
      title: "Location / Address", key: "location", width: 180,
      render: (_, r) => (r.location || r.address)
        ? (
          <div style={{ lineHeight: 1.3 }}>
            {r.location && <Text style={{ fontSize: 12 }}><EnvironmentOutlined style={{ color: "#fa8c16", marginRight: 4 }} />{r.location}</Text>}
            {r.address && <><br /><Text type="secondary" style={{ fontSize: 11 }}>{r.address}</Text></>}
          </div>
        ) : <Text type="secondary">—</Text>,
    },
    {
      title: "Contact", key: "contact", width: 170,
      render: (_, r) => (r.contactPerson || r.contactNumber || r.contactEmail)
        ? (
          <div style={{ lineHeight: 1.3 }}>
            {r.contactPerson && <Text style={{ fontSize: 12 }}>{r.contactPerson}</Text>}
            {r.contactNumber && <><br /><Text type="secondary" style={{ fontSize: 11 }}><PhoneOutlined /> {r.contactNumber}</Text></>}
            {r.contactEmail && <><br /><Text type="secondary" style={{ fontSize: 11 }}><MailOutlined /> {r.contactEmail}</Text></>}
          </div>
        ) : <Text type="secondary">—</Text>,
    },
    {
      title: "Region", dataIndex: "regionClass", key: "regionClass", width: 120,
      sorter: (a, b) => (a.regionClass || "").localeCompare(b.regionClass || ""),
      render: (v) => regionTag(v),
    },
    {
      title: "Status", dataIndex: "status", key: "status", width: 110,
      sorter: (a, b) => (a.status || "").localeCompare(b.status || ""),
      render: (v) => statusTag(v),
    },
    {
      title: "Created", dataIndex: "createdAt", key: "createdAt", width: 110,
      sorter: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
      render: (v) => v ? <Text style={{ fontSize: 11 }}>{dayjs(v).format("MM/DD/YYYY")}</Text> : "—",
    },
    {
      title: "Last Synced", dataIndex: "lastSyncedAt", key: "lastSyncedAt", width: 180,
      sorter: (a, b) => new Date(a.lastSyncedAt || 0) - new Date(b.lastSyncedAt || 0),
      render: (v) => <Text type={v ? undefined : "secondary"} style={{ fontSize: 11 }}>{formatManila(v)}</Text>,
    },
    {
      title: "Actions", key: "actions", width: 130, fixed: "right",
      render: (_, r) => (
        <Space size={2}>
          <Tooltip title="View Details"><Button type="text" size="small" icon={<EyeOutlined style={{ color: "#1677ff" }} />} onClick={() => setDetail(r)} /></Tooltip>
          {canEdit && <Tooltip title="Edit"><Button type="text" size="small" icon={<EditOutlined style={{ color: "#52c41a" }} />} onClick={() => openEdit(r)} /></Tooltip>}
          {canDelete && (
            <Tooltip title={r.status === "Active" ? "Deactivate" : "Activate"}>
              <Button type="text" size="small" icon={r.status === "Active" ? <StopOutlined style={{ color: "#fa8c16" }} /> : <CheckCircleOutlined style={{ color: "#52c41a" }} />} onClick={() => handleToggleStatus(r)} />
            </Tooltip>
          )}
          {canDelete && (
            <Popconfirm title="Delete this client?" onConfirm={() => handleDelete(r)} okText="Delete" okButtonProps={{ danger: true }}>
              <Tooltip title="Delete"><Button type="text" size="small" danger icon={<DeleteOutlined />} /></Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!canView) {
    return <Empty description="You do not have permission to view clients." style={{ marginTop: 80 }} />;
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <Title level={4} style={{ margin: 0 }}><TeamOutlined /> Hauler Clients</Title>
        <Space wrap>
          <Input placeholder="Search clients..." prefix={<SearchOutlined />} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: "100%", maxWidth: 220 }} allowClear />
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Client</Button>}
          {canEdit && (
            <Tooltip title="Import & upsert clients from portal baseline haulers (idempotent)">
              <Button icon={<SyncOutlined />} onClick={handleSync} loading={syncing}>Sync from Baseline</Button>
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip title="Merge pre-existing duplicate client rows into canonical profiles (idempotent)">
              <Button icon={<TeamOutlined />} onClick={handleCleanup} loading={cleaning}>Clean Duplicates</Button>
            </Tooltip>
          )}
          {/* The count is PART of the button, in full — a floating "99+" dot
              said nothing about whether there were 100 issues or 28,000, and sat
              over the button's corner. */}
          <Button
            onClick={openIssues}
            className={`slf-issues-btn${openIssueCount ? " has-issues" : ""}`}
            aria-label={`Issues: ${openIssueCount.toLocaleString()} open`}
            icon={openIssueCount ? <WarningOutlined /> : <CheckCircleOutlined />}
          >
            Issues
            <span className="slf-issues-btn__count">{openIssueCount.toLocaleString()}</span>
          </Button>
          {canEdit && openIssueCount > 0 && (
            <Tooltip title="VERA closes duplicate and out-of-date issues and repairs locations it can match to the Region 3 masterlist. Anything that needs a decision stays open.">
              <Button
                className="vera-btn"
                icon={<VeraFlameIcon size={16} state={veraAutofixing ? "working" : "idle"} />}
                onClick={runVeraAutofix}
                loading={veraAutofixing}
              >
                Let VERA fix
              </Button>
            </Tooltip>
          )}
          <style>{ISSUES_BTN_CSS}</style>
          <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!filtered.length}>Export</Button>
          <Tooltip title="Refresh"><Button icon={<ReloadOutlined />} onClick={() => { fetchRecords(true); fetchOpenIssueCount(); }} loading={loading} /></Tooltip>
        </Space>
      </div>

      {error && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Failed to load clients"
          description="The client list could not be loaded. Please retry."
          action={<Button size="small" onClick={() => fetchRecords(true)}>Retry</Button>} />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {/* Total is the structural figure (navy); LGU and Private are the two
            categories it splits into (blue / mid navy — the same pairing the
            SLF Data Table tiles use); Active is the only status here, so it is
            the only card allowed a status colour. */}
        <Col xs={12} sm={8} md={6} lg={6} className="hauler-tile-col">
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: `3px solid ${NAVY}` }}>
            <Statistic title="Total Clients" value={summary.total} prefix={<TeamOutlined style={{ color: NAVY }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={6} className="hauler-tile-col">
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: `3px solid ${BLUE}` }}>
            <Statistic title="LGU Clients" value={summary.lgu} prefix={<BankOutlined style={{ color: BLUE }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={6} className="hauler-tile-col">
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: `3px solid ${NAVY_MID}` }}>
            <Statistic title="Private Sector" value={summary.private} prefix={<BankOutlined style={{ color: NAVY_MID }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={6} className="hauler-tile-col">
          <Card size="small" hoverable style={{ borderRadius: 10, borderLeft: `3px solid ${GREEN}` }}>
            <Statistic title="Active" value={summary.active} suffix={`/ ${summary.total}`} prefix={<CheckCircleOutlined style={{ color: GREEN }} />} />
          </Card>
        </Col>
      </Row>

      {/* Region 3 breakdown tiles — sourced from the persisted /summary counts.
          Clicking a tile filters the table to the matching active records. */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          // Four tiles encoding TWO dimensions, so the colours encode two as
          // well: hue carries the type (blue = LGU, navy = Private) and tint
          // carries the region (full = within R3, light = outside). Previously
          // these were four unrelated hues, which made the pairing invisible.
          { title: "LGUs Served — Within Region 3", value: regionSummary?.withinR3?.lgu || 0, color: REGION_TILE.lguWithin, type: "LGU", region: "within-region-3" },
          { title: "LGUs Served — Outside Region 3", value: regionSummary?.outsideR3?.lgu || 0, color: REGION_TILE.lguOutside, type: "LGU", region: "outside-region-3" },
          { title: "Private Sectors — Within Region 3", value: regionSummary?.withinR3?.private || 0, color: REGION_TILE.privateWithin, type: "Private Sector", region: "within-region-3" },
          { title: "Private Sectors — Outside Region 3", value: regionSummary?.outsideR3?.private || 0, color: REGION_TILE.privateOutside, type: "Private Sector", region: "outside-region-3" },
        ].map((t) => {
          const activeTile = filterType === t.type && filterRegion === t.region;
          return (
            <Col key={t.title} xs={12} sm={8} md={6} lg={6} className="hauler-tile-col">
              <Card
                size="small" hoverable
                onClick={() => applyRegionTile(t.type, t.region)}
                style={{ borderRadius: 10, borderLeft: `3px solid ${t.color}`, cursor: "pointer", outline: activeTile ? `2px solid ${t.color}` : "none" }}
              >
                <Statistic title={t.title} value={t.value} valueStyle={{ color: t.color }} prefix={<EnvironmentOutlined style={{ color: t.color }} />} />
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card size="small" style={{ borderRadius: 10, marginBottom: 12 }} bodyStyle={{ padding: "10px 16px" }}>
        <Row gutter={[10, 10]} align="middle">
          <Col><FilterOutlined style={{ color: "#1677ff", marginRight: 6 }} /><Text type="secondary" style={{ fontSize: 12 }}>Filters:</Text></Col>
          <Col flex="auto">
            <Space wrap size={8}>
              <Select placeholder="Type" value={filterType} onChange={setFilterType} allowClear size="small" style={{ minWidth: 140 }} options={TYPE_OPTIONS} />
              <Select placeholder="SLF Name" value={filterPortalUser} onChange={setFilterPortalUser} allowClear showSearch optionFilterProp="label" size="small" style={{ minWidth: 160 }} options={portalUserOptions} />
              <Select placeholder="Hauler" value={filterHauler} onChange={setFilterHauler} allowClear showSearch size="small" style={{ minWidth: 140 }} options={haulerOptions} />
              <Select placeholder="Status" value={filterStatus} onChange={setFilterStatus} allowClear size="small" style={{ minWidth: 120 }} options={STATUS_OPTIONS} />
              <Select placeholder="Region" value={filterRegion} onChange={setFilterRegion} allowClear size="small" style={{ minWidth: 150 }} options={REGION_OPTIONS} />
              <Select placeholder="Location" value={filterLocation} onChange={setFilterLocation} allowClear showSearch size="small" style={{ minWidth: 140 }} options={locationOptions} suffixIcon={<EnvironmentOutlined />} />
              {hasActiveFilters && <Button size="small" type="link" danger icon={<ClearOutlined />} onClick={clearAllFilters}>Clear</Button>}
            </Space>
          </Col>
          <Col><Tag bordered={false} color={hasActiveFilters ? "blue" : "default"}>{filtered.length} / {records.length}</Tag></Col>
        </Row>
      </Card>

      <Card style={{ borderRadius: 10 }} bodyStyle={{ padding: 0 }}>
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          size="small"
          loading={loading}
          scroll={{ x: 1200 }}
          locale={{ emptyText: <Empty description={hasActiveFilters ? "No clients match the filters." : "No clients yet. Click “Add Client” to create one."} /> }}
          pagination={withSizeChanger({ defaultPageSize: 10 })}
        />
      </Card>

      {/* Detail Modal */}
      <Modal
        title={<Space><EyeOutlined /> {detail?.name}</Space>}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>Close</Button>}
        width={640}
        style={{ maxWidth: "95vw" }}
      >
        {detail && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Client Name" span={2}><Text strong>{detail.name}</Text></Descriptions.Item>
              <Descriptions.Item label="Type">{typeTag(detail.type)}</Descriptions.Item>
              <Descriptions.Item label="Status">{statusTag(detail.status)}</Descriptions.Item>
              <Descriptions.Item label="Region">{regionTag(detail.regionClass)}</Descriptions.Item>
              <Descriptions.Item label="SLF Names">
                {isMultiPortal(detail) ? <Tag color="gold">Multiple ({relCount(detail)})</Tag> : <Tag>Single</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Province">{detail.province || "—"}</Descriptions.Item>
              <Descriptions.Item label="City / Municipality">{detail.municipalityCity || "—"}</Descriptions.Item>
              <Descriptions.Item label="Address" span={2}>{detail.address || detail.location || "—"}</Descriptions.Item>
              <Descriptions.Item label="Contact Person">{detail.contactPerson || "—"}</Descriptions.Item>
              <Descriptions.Item label="Contact Number">{detail.contactNumber || "—"}</Descriptions.Item>
              <Descriptions.Item label="Contact Email" span={2}>{detail.contactEmail || "—"}</Descriptions.Item>
              <Descriptions.Item label="Last Synced" span={2}>{formatManila(detail.lastSyncedAt)}</Descriptions.Item>
              <Descriptions.Item label="Notes" span={2}>{detail.notes || "—"}</Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 12 }}>
              <Text strong style={{ fontSize: 12 }}><UserOutlined /> Linked SLFs, Haulers & Baseline Sources</Text>
              <Table
                style={{ marginTop: 8 }}
                size="small"
                rowKey={(x, i) => i}
                dataSource={detail.portalUserRelationships || []}
                pagination={false}
                locale={{ emptyText: "No portal-user relationships (manually added client)." }}
                columns={[
                  { title: "SLF Name", dataIndex: "portalUserName", render: (v, x) => portalUserById[x.portalUser] || v || x.portalUserEmail || "—" },
                  { title: "Hauler", dataIndex: "hauler", render: (v) => v || "—" },
                  { title: "Baseline", dataIndex: "baselineRef", render: (v) => v ? <Tag color="geekblue">{String(v).slice(-6)}</Tag> : <Tag>Manual</Tag> },
                ]}
              />
            </div>
          </>
        )}
      </Modal>

      {/* Add / Edit Modal */}
      <Modal
        title={editing ? "Edit Client" : "Add Client"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={editing ? "Update" : "Create"}
        confirmLoading={saving}
        width={720}
        style={{ maxWidth: "95vw" }}
        // antd v6 name — `destroyOnClose` is no longer honoured, so the form was
        // never actually remounted between records.
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          size="small"
          preserve={false}
          initialValues={clientInitialValues}
        >
          <Row gutter={16}>
            <Col xs={24} sm={16}>
              <Form.Item name="name" label="Client Name" rules={[{ required: true, message: "Client name is required" }, { whitespace: true, message: "Client name is required" }]}>
                <Input placeholder="e.g. Municipality of San Jose / ABC Corp." />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="type" label="Client Type" rules={[{ required: true, message: "Select a client type" }]}>
                <Select options={TYPE_OPTIONS} placeholder="Select type" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="portalUser" label="Assigned SLF">
                <Select options={portalUserOptions} allowClear showSearch optionFilterProp="label" placeholder="Select portal user" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="hauler" label="Assigned Hauler">
                <AutoComplete options={haulerOptions} placeholder="Hauler name" filterOption={(input, opt) => (opt?.value || "").toLowerCase().includes(input.toLowerCase())} allowClear />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="province" label="Province" tooltip="Used to classify the client Within / Outside Region 3">
                <Input placeholder="e.g. Pampanga" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="municipalityCity" label="City / Municipality">
                <Input placeholder="e.g. San Fernando" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="address" label="Address">
                <Input placeholder="Full address (optional)" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="contactPerson" label="Contact Person">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="contactNumber" label="Contact Number">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="contactEmail" label="Contact Email" rules={[{ type: "email", message: "Enter a valid email" }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="notes" label="Notes">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Data Issues Modal — flagged baseline/client records that could not be
          synced safely. Resolvable (does not silently discard invalid records). */}
      <Modal
        title={<Space><WarningOutlined style={{ color: "#fa8c16" }} /> Client Data Issues</Space>}
        open={issuesOpen}
        onCancel={() => setIssuesOpen(false)}
        footer={<Button onClick={() => setIssuesOpen(false)}>Close</Button>}
        width={1300}
        style={{ maxWidth: "96vw" }}
      >
        {issuesError && (
          <Alert
            type="error"
            showIcon
            message="Could not load data issues"
            description={issuesError}
            action={<Button size="small" onClick={() => loadIssues(1, issuesPaging.pageSize, issuesStatus)}>Retry</Button>}
            style={{ marginBottom: 12 }}
          />
        )}
        {/* ── Header: which issues, how many, and VERA's one-click fix ── */}
        <div className="slf-issues-head">
          <div className="slf-issues-head__left">
            <Segmented
              size="small"
              value={issuesStatus}
              onChange={(value) => {
                setIssuesStatus(value);
                loadIssues(1, issuesPaging.pageSize, value);
              }}
              options={[
                { value: "open", label: `Open${issuesCounts.open != null ? ` · ${issuesCounts.open.toLocaleString()}` : ""}` },
                { value: "resolved", label: `Resolved${issuesCounts.resolved != null ? ` · ${issuesCounts.resolved.toLocaleString()}` : ""}` },
                { value: "ignored", label: `Ignored${issuesCounts.ignored != null ? ` · ${issuesCounts.ignored.toLocaleString()}` : ""}` },
                { value: "", label: "All" },
              ]}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {issuesPaging.total.toLocaleString()} record{issuesPaging.total === 1 ? "" : "s"}
            </Text>
          </div>
          {canEdit && issuesStatus === "open" && issuesPaging.total > 0 && (
            <Tooltip title="VERA closes duplicate and out-of-date issues and repairs locations it can match to ONE Region 3 masterlist entry. Anything that needs a decision stays open.">
              <Button
                className="vera-btn vera-btn--primary"
                icon={<VeraFlameIcon size={16} state={veraAutofixing ? "working" : "idle"} theme="dark" />}
                loading={veraAutofixing}
                onClick={runVeraAutofix}
              >
                Let VERA fix
              </Button>
            </Tooltip>
          )}
        </div>

        {/* ── VERA on the selection ──
            "Repair" changes data now (high-confidence rows only); "Allow" only
            records permission and never changes an issue's status. The selection
            is not page-bound — ticked rows persist across pages, and "Allow all
            matching" is applied by the server over the entire filtered set. */}
        {canEdit && issuesStatus === "open" && issuesPaging.total > 0 && (
          <div className="slf-issues-vera">
            <span className="slf-issues-vera__label">
              <VeraFlameIcon size={14} animated={false} /> VERA
              {selectedIssueKeys.length > 0 && (
                <Tag bordered={false} color="cyan" style={{ marginLeft: 4 }}>
                  {selectedIssueKeys.length} selected
                </Tag>
              )}
            </span>
            <Button
              size="small"
              className="vera-btn"
              loading={bulkFixing}
              disabled={selectedFixableKeys.length === 0}
              onClick={runBulkVeraFix}
            >
              Repair {selectedFixableKeys.length || ""} selected
            </Button>
            {fixableOnPage.length > 0 && (
              <Button
                size="small"
                type="text"
                onClick={() =>
                  setSelectedIssueKeys(
                    selectedIssueKeys.length === fixableOnPage.length ? [] : fixableOnPage.map((i) => i._id),
                  )
                }
              >
                {selectedIssueKeys.length === fixableOnPage.length ? "Clear" : `Select ${fixableOnPage.length} repairable`}
              </Button>
            )}
            <span className="slf-issues-vera__sep" />
            <Button
              size="small"
              className="vera-btn"
              loading={veraMarking}
              disabled={selectedIssueKeys.length === 0}
              onClick={() => markVeraResolvable("selected", true)}
            >
              Allow VERA on {selectedIssueKeys.length || ""} selected
            </Button>
            <Button size="small" className="vera-btn" loading={veraMarking} onClick={() => markVeraResolvable("all", true)}>
              Allow all {issuesPaging.total.toLocaleString()}
            </Button>
            {selectedIssueKeys.length > 0 && (
              <>
                <Button size="small" type="text" danger loading={veraMarking} onClick={() => markVeraResolvable("selected", false)}>
                  Remove permission
                </Button>
                <Button size="small" type="link" onClick={() => setSelectedIssueKeys([])}>
                  Clear selection
                </Button>
              </>
            )}
            <span style={{ flex: 1 }} />
            <span className="slf-issues-vera__hint">
              {fixableOnPage.length} of {issues.length} on this page repairable · {veraCount.toLocaleString()} allowed
            </span>
          </div>
        )}
        <Table
          dataSource={issues}
          rowKey="_id"
          size="small"
          loading={issuesLoading}
          scroll={{ x: 800 }}
          locale={{
            emptyText: issuesError ? (
              <Empty description="Could not load — see the error above." />
            ) : (
              <Empty description="No data issues. Run Sync from Baseline to check." />
            ),
          }}
          // Server-side: only the current page is ever fetched or rendered.
          // Selection is limited to rows VERA can actually repair — everything
          // else is disabled with the reason on hover, so a bulk run can never
          // include a record that needs human judgement.
          rowSelection={
            canEdit && issuesStatus === "open"
              ? {
                  selectedRowKeys: selectedIssueKeys,
                  onChange: setSelectedIssueKeys,
                  // Keeps ticks for rows that are no longer rendered, so a
                  // selection spans pages instead of resetting on every page
                  // change. Without it the keys for page 1 are dropped the moment
                  // page 2 renders.
                  preserveSelectedRowKeys: true,
                  // Any OPEN issue can be authorized for VERA; bulk REPAIR narrows
                  // this selection to high-confidence rows itself
                  // (selectedFixableKeys), so restricting the checkbox is no longer
                  // what protects it.
                  getCheckboxProps: (record) => ({ disabled: record.status !== "open" }),
                  columnWidth: 40,
                }
              : undefined
          }
          pagination={withSizeChanger({
            current: issuesPaging.current,
            pageSize: issuesPaging.pageSize,
            total: issuesPaging.total,
            showTotal: (total) => `${total.toLocaleString()} record(s)`,
          })}
          onChange={(p) => loadIssues(p.current, p.pageSize, issuesStatus)}
          columns={[
            { title: "Type", dataIndex: "flagType", width: 190, render: (v) => <Tag color={FLAG_COLORS[v] || "default"} bordered={false}>{FLAG_LABELS[v] || v}</Tag> },
            { title: "Description", dataIndex: "description", ellipsis: true, render: (v) => <Text style={{ fontSize: 12 }}>{v || "—"}</Text> },
            {
              // The issue stores the declaring account's email; show the SLF that
              // account is assigned to, with the email on hover.
              title: "SLF Name", dataIndex: "portalUserEmail", width: 200,
              render: (v) => {
                const email = String(v || "").trim().toLowerCase();
                if (!email) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
                return (
                  <Tooltip title={v}>
                    <Text style={{ fontSize: 11 }}>{slfNameByEmail[email] || v}</Text>
                  </Tooltip>
                );
              },
            },
            { title: "Hauler", dataIndex: "hauler", width: 160, render: (v) => <Text type="secondary" style={{ fontSize: 11 }}>{v || "—"}</Text> },
            { title: "Status", dataIndex: "status", width: 100, render: (v) => v === "open" ? <Tag color="red">Open</Tag> : v === "ignored" ? <Tag>Ignored</Tag> : <Tag color="green">Resolved</Tag> },
            {
              // Read straight from the persisted flag, so what is shown here is what
              // is in the database — this is what survives a page refresh.
              title: "VERA",
              dataIndex: "veraResolvable",
              width: 110,
              render: (v) =>
                v ? (
                  <Tooltip title="An administrator has allowed VERA to resolve this issue. It is still open until repaired.">
                    <Tag color="cyan" bordered={false} icon={<span style={{ marginRight: 4, verticalAlign: -2 }}><VeraFlameIcon size={12} animated={false} /></span>}>Allowed</Tag>
                  </Tooltip>
                ) : (
                  <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
                ),
            },
            {
              title: "Action", key: "action", width: 230, fixed: "right",
              render: (_, issue) => canEdit ? (
                issue.status === "open" ? (
                  <Space size={4} className="slf-issue-actions">
                    {/* VERA proposes; the admin approves. The button only asks
                        for a suggestion — it never writes. */}
                    <Tooltip
                      title={
                        issueFixable[issue._id]
                          ? issueFixable[issue._id].canFix
                            ? issueFixable[issue._id].rationale
                            : issueFixable[issue._id].reason
                          : "Ask VERA to propose a fix"
                      }
                    >
                      <Button
                        size="small"
                        icon={<VeraFlameIcon size={14} animated={false} theme={isBulkFixable(issue._id) ? "dark" : "light"} />}
                        loading={veraFix.loadingId === issue._id}
                        // Filled when VERA has a confident proposal for this row,
                        // so the repairable ones stand out — same teal either way.
                        className={`vera-btn${isBulkFixable(issue._id) ? " vera-btn--primary" : ""}`}
                        onClick={() => askVera(issue)}
                      >
                        {isBulkFixable(issue._id) ? "Fix" : "VERA"}
                      </Button>
                    </Tooltip>
                    <Button size="small" icon={<CheckCircleOutlined style={{ color: "#52c41a" }} />} onClick={() => resolveIssue(issue, "resolved")}>Resolve</Button>
                    <Button size="small" type="text" onClick={() => resolveIssue(issue, "ignored")}>Ignore</Button>
                  </Space>
                ) : (
                  <Button size="small" type="link" onClick={() => resolveIssue(issue, "open")}>Reopen</Button>
                )
              ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
            },
          ]}
        />
      </Modal>

      {/* ── VERA fix proposal ──
          Read-only until the admin presses Apply. The exact field changes are
          shown verbatim, and the proposal is resolved against the Region 3
          masterlist — never generated text — so a province can't be invented on
          a compliance record. */}
      <Modal
        title={<Space><VeraFlameIcon size={22} /> VERA — Suggested Fix</Space>}
        open={veraFix.open}
        onCancel={() => setVeraFix((s) => ({ ...s, open: false }))}
        width={620}
        style={{ maxWidth: "95vw" }}
        footer={[
          <Button key="cancel" onClick={() => setVeraFix((s) => ({ ...s, open: false }))}>Cancel</Button>,
          veraFix.suggestion?.canFix && (
            <Button
              key="apply"
              className="vera-btn vera-btn--primary"
              loading={veraFix.applying}
              disabled={!veraFix.choice?.province}
              onClick={applyVeraFix}
            >
              Approve &amp; Apply
            </Button>
          ),
        ].filter(Boolean)}
      >
        {!veraFix.suggestion ? null : !veraFix.suggestion.canFix ? (
          <Alert
            type="info"
            showIcon
            message="VERA cannot fix this one automatically"
            description={veraFix.suggestion.reason}
          />
        ) : (
          <>
            <Alert
              type={veraFix.suggestion.confidence === "high" ? "success" : "warning"}
              showIcon
              message={veraFix.suggestion.confidence === "high" ? "High confidence" : "Needs your confirmation"}
              description={veraFix.suggestion.rationale}
              style={{ marginBottom: 14 }}
            />
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Client">{veraFix.suggestion.client?.name}</Descriptions.Item>
              <Descriptions.Item label="Province">
                <Text strong style={{ color: "#52c41a" }}>{veraFix.choice?.province || "—"}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Municipality / City">
                {veraFix.choice?.municipalityCity || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Region">within-region-3</Descriptions.Item>
            </Descriptions>
            {(veraFix.suggestion.alternatives || []).length > 1 && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Other masterlist matches — pick the correct one:
                </Text>
                <Select
                  style={{ width: "100%", marginTop: 6 }}
                  value={`${veraFix.choice?.province}|${veraFix.choice?.municipalityCity}`}
                  onChange={(val) => {
                    const [province, municipalityCity] = val.split("|");
                    setVeraFix((s) => ({ ...s, choice: { ...s.choice, province, municipalityCity } }));
                  }}
                  options={veraFix.suggestion.alternatives.map((a) => ({
                    value: `${a.province}|${a.municipalityCity}`,
                    label: `${a.municipalityCity} — ${a.province}`,
                  }))}
                />
              </div>
            )}
            <Text type="secondary" style={{ fontSize: 11, display: "block", marginTop: 12 }}>
              Applying writes only these fields to the client record and marks the
              issue resolved, recorded against your account.
            </Text>
          </>
        )}
      </Modal>

      {/* Synchronization Progress Modal — real percentage from processed records /
          completed stages (never a timer). */}
      <Modal
        title={<Space><SyncOutlined spin={syncing} /> Baseline Synchronization</Space>}
        open={syncModalOpen}
        onCancel={() => setSyncModalOpen(false)}
        maskClosable={false}
        footer={(() => {
          const s = syncJob?.status;
          const terminal = ["completed", "completed_with_issues", "failed"].includes(s);
          return (
            <Space>
              {s === "failed" && <Button type="primary" icon={<SyncOutlined />} onClick={() => { setSyncModalOpen(false); handleSync(); }}>Retry</Button>}
              <Button onClick={() => setSyncModalOpen(false)} disabled={!terminal && !syncJob?.jobId}>{terminal ? "Close" : "Hide"}</Button>
            </Space>
          );
        })()}
        width={560}
        style={{ maxWidth: "95vw" }}
      >
        {(() => {
          const sj = syncJob || {};
          const sum = sj.summary || {};
          const c = sj.counts || {};
          const failed = sj.status === "failed";
          const done = ["completed", "completed_with_issues"].includes(sj.status);
          const pct = Math.max(0, Math.min(100, Math.round(sj.percent || 0)));
          const stat = failed ? "exception" : done ? "success" : "active";
          const val = (a, b) => (a != null ? a : b) || 0;
          const stats = [
            { label: "Successful", value: val(sum.created, c.created), color: "#52c41a" },
            { label: "Updated", value: val(sum.updated, c.updated), color: "#1677ff" },
            { label: "Skipped", value: val(sum.skippedAdminManaged, c.skipped), color: "#8c8c8c" },
            { label: "Duplicates", value: val(sum.duplicatesDetected, c.duplicates), color: "#fa8c16" },
            { label: "Merged", value: val(sum.duplicatesMerged, c.merged), color: "#1a3353" },
            { label: "Removed", value: val(sum.duplicatesRemoved, c.removed), color: "#ff4d4f" },
            { label: "Flagged", value: val(sum.flagged, c.flagged), color: "#cf1322" },
          ];
          return (
            <>
              <Progress percent={pct} status={stat} />
              <div style={{ margin: "8px 0 12px" }}>
                <Text strong>{sj.stageLabel || (failed ? "Failed" : done ? "Complete" : "Starting…")}</Text>
                {sj.total ? <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>{val(sj.processed)} / {sj.total} records</Text> : null}
              </div>
              {failed && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Synchronization failed" description={sj.error || "An error occurred."} />}
              <Row gutter={[8, 8]}>
                {stats.map((st) => (
                  <Col xs={12} sm={8} key={st.label}>
                    <Card size="small" style={{ borderRadius: 8 }} bodyStyle={{ padding: "6px 10px" }}>
                      <Statistic title={st.label} value={st.value} valueStyle={{ color: st.color, fontSize: 18 }} />
                    </Card>
                  </Col>
                ))}
              </Row>
              {done && sum.validation && (
                <Alert
                  style={{ marginTop: 12 }}
                  type={sum.validation.ok ? "success" : "warning"}
                  showIcon
                  message={sum.validation.ok ? "Dashboard validation passed" : "Dashboard validation mismatch"}
                  description={sum.validation.ok
                    ? `Persisted totals: ${sum.counts?.total ?? 0} unique clients (${sum.counts?.lgu ?? 0} LGU · ${sum.counts?.private ?? 0} Private).`
                    : (sum.validation.mismatches || []).join("; ")}
                />
              )}
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
