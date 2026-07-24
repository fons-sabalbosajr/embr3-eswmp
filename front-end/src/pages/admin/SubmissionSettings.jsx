import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Card,
  Select,
  Input,
  Modal,
  Popconfirm,
  Divider,
  InputNumber,
  DatePicker,
  Row,
  Col,
  Form,
  Collapse,
  Tooltip,
  Spin,
  Empty,
  Alert,
  Progress,
  Pagination,
  message,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  DeleteOutlined,
  SearchOutlined,
  DownloadOutlined,
  EditOutlined,
  CarOutlined,
  EnvironmentOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  TeamOutlined,
  IdcardOutlined,
  MergeCellsOutlined,
  InboxOutlined,
  BankOutlined,
  ReloadOutlined,
  HistoryOutlined,
  UndoOutlined,
  ExclamationCircleOutlined,
  PieChartOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { exportToExcel } from "../../utils/exportExcel";
import { buildSubmissionWasteEntries } from "../../utils/submissionEntries";
import Swal from "sweetalert2";
import api from "../../api";
import secureStorage from "../../utils/secureStorage";
import { getAdminDisplayName } from "../../utils/adminIdentity";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import { withSizeChanger } from "../../utils/tablePagination";
import dayjs from "dayjs";
import ResponsiveTable from "./shared/ResponsiveTable";
import MergeSlfModal from "./MergeSlfModal";
import {
  getTruckCapacityText,
  getTruckPlateText,
  getSubmissionVolumeSummary,
  normalizeSubmissionRecord,
} from "./shared/submissionRecords";
import { rowMatchesSearch } from "./shared/tableFilters";
import { volumeCapacityStatus } from "../../utils/volumeUnits";

// Normalize a hauler-clients value from any of the shapes the backend may return
// (string, string[], client-object[], privateSectorClients, haulerClients, nested
// hauler) into a clean array of readable names — never "[object Object]".
const normalizeClientList = (value) => {
  const pick = (c) => {
    if (c == null) return "";
    if (typeof c === "string") return c.trim();
    if (typeof c === "object")
      return String(c.clientName || c.name || c.company || c.companyName || c.client || "").trim();
    return String(c).trim();
  };
  const arr = Array.isArray(value) ? value : value != null && value !== "" ? [value] : [];
  return arr.map(pick).filter(Boolean);
};

// Resolve a truck's hauler clients from the truck itself or the matching accredited
// hauler on the parent submission — covering every likely relationship shape.
const resolveTruckClients = (truck, accreditedHaulers = []) => {
  const direct = normalizeClientList(
    truck?.privateSectorClients ??
      truck?.haulerClients ??
      truck?.clients ??
      truck?.selectedClients ??
      truck?.hauler?.privateSectorClients ??
      truck?.hauler?.clients,
  );
  if (direct.length) return direct;
  const name = String(truck?.hauler || "").trim().toLowerCase();
  if (!name) return [];
  const match = (accreditedHaulers || []).find(
    (h) => String(h?.haulerName || "").trim().toLowerCase() === name,
  );
  return normalizeClientList(match?.privateSectorClients ?? match?.clients);
};

const { Title, Text } = Typography;
const { Option } = Select;
const ACCENT = "#2f54eb";
const CACHE_KEY = "submissions-cache";
const CACHE_TTL = 10 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 15;
const SUBMISSION_MODAL_WIDTH = 1220;
const TRANSACTION_HISTORY_MODAL_WIDTH = 1400;
const WRAP_CELL_STYLE = {
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
  fontSize: 12,
};
const wrapColumn = (column) => ({
  ...column,
  ellipsis: false,
  onCell: (...args) => ({
    style: WRAP_CELL_STYLE,
    ...(typeof column.onCell === "function" ? column.onCell(...args) : {}),
  }),
  onHeaderCell: (...args) => ({
    style: { ...WRAP_CELL_STYLE, fontSize: 12 },
    ...(typeof column.onHeaderCell === "function"
      ? column.onHeaderCell(...args)
      : {}),
  }),
});

export default function SubmissionSettings({
  canEdit = true,
  canDelete = true,
  canRepairIds = false,
  isDeveloper = false,
  isDark,
  submissionsContext = null,
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  // Set of in-flight action keys so multiple rows can submit simultaneously
  const [actionKeys, setActionKeys] = useState(() => new Set());
  const addActionKey = useCallback(
    (k) => setActionKeys((prev) => new Set(prev).add(k)),
    [],
  );
  const removeActionKey = useCallback(
    (k) =>
      setActionKeys((prev) => {
        const next = new Set(prev);
        next.delete(k);
        return next;
      }),
    [],
  );
  const isActing = useCallback((k) => actionKeys.has(k), [actionKeys]);
  // rowKey -> { done, total } for per-row acknowledge progress bar
  const [rowProgress, setRowProgress] = useState({});
  const [bulkAcknowledgeLoading, setBulkAcknowledgeLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const fetchingRef = useRef(null);
  const pendingRefreshRef = useRef(false);
  const latestRequestKeyRef = useRef("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cellPlacementFilter, setCellPlacementFilter] = useState("all");
  // Apply an incoming Portal Submissions shortcut context (from the Disposal
  // Activity modal): pre-filter by SLF name + status. Validates params, tolerates
  // missing optional fields, and only re-applies when the context actually changes.
  const appliedCtxRef = useRef(null);
  useEffect(() => {
    if (!submissionsContext) return;
    const sig = JSON.stringify(submissionsContext);
    if (appliedCtxRef.current === sig) return;
    appliedCtxRef.current = sig;
    const { slfName, status } = submissionsContext;
    if (slfName) setSearch(String(slfName));
    const valid = ["pending", "acknowledged", "rejected", "reverted", "editApproved"];
    if (status && valid.includes(status)) setStatusFilter(status);
    setSelectedRowKeys([]);
    setPagination((prev) => ({ ...prev, current: 1 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionsContext]);
  const [mergeSlfOpen, setMergeSlfOpen] = useState(false);
  // ID-fix preview modal (dry-run before applying Fix XX / Fix PVT-LGU).
  const [idFixPreview, setIdFixPreview] = useState({
    open: false,
    type: null,
    loading: false,
    applying: false,
    changes: [],
    message: "",
    error: "",
    total: 0,
    truncated: false,
  });
  // Guards against duplicate/concurrent preview fetches (double-click, re-open).
  const idFixLoadingRef = useRef(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
  });
  // True total number of submission ENTRIES across all matched groups (the server
  // returns this alongside `total`, which counts collapsed grouped rows). Shown so
  // the admin sees the real submission count, not just the number of grouped rows.
  const [entryTotal, setEntryTotal] = useState(0);
  const [viewRecord, setViewRecord] = useState(null);
  const [groupedEntriesRecord, setGroupedEntriesRecord] = useState(null);
  // Compact summary for the Group Entries modal — derived only from fields the
  // list API already returns (cellNames, totalVolumeM3/Tons, status).
  const groupedSummary = useMemo(() => {
    const entries = groupedEntriesRecord?.groupedEntries || [];
    const cellSet = new Set();
    let m3 = 0;
    let tons = 0;
    const statusCounts = {};
    const unitCounts = { "m³": 0, tons: 0 };
    entries.forEach((e) => {
      (e.cellNames || []).forEach((c) => c && cellSet.add(c));
      m3 += Number(e.totalVolumeM3 || 0);
      tons += Number(e.totalVolumeTons || 0);
      const u = String(e.baselineUnit || "").trim().replace("m3", "m³");
      if (u === "tons") unitCounts.tons += 1;
      else if (u === "m³") unitCounts["m³"] += 1;
      const s = e.status || "pending";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    // #7: display in the single declared baseline unit (most common among the
    // grouped entries), never "m³ / t" side-by-side. m³/tons are kept in lockstep.
    const unit = unitCounts.tons > unitCounts["m³"] ? "tons" : "m³";
    return { totalEntries: entries.length, cells: [...cellSet], m3, tons, unit, statusCounts };
  }, [groupedEntriesRecord]);
  const [editRecord, setEditRecord] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [editForm] = Form.useForm();
  const [txnHistoryModal, setTxnHistoryModal] = useState({
    open: false,
    submissionId: null,
  });
  const [txnHistoryData, setTxnHistoryData] = useState([]);
  const [txnHistoryLoading, setTxnHistoryLoading] = useState(false);
  const [revertModal, setRevertModal] = useState({ open: false, record: null });
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [repairingXX, setRepairingXX] = useState(false);
  const [repairingType, setRepairingType] = useState(false);
  const currentUser = secureStorage.getJSON("user") || {};
  const currentActorName =
    getAdminDisplayName(currentUser) ||
    currentUser.username ||
    currentUser.email ||
    "admin";
  const currentCacheKey = useMemo(
    () =>
      [
        CACHE_KEY,
        statusFilter,
        cellPlacementFilter,
        debouncedSearch,
        pagination.current,
        pagination.pageSize,
        isDeveloper ? "dev" : "std",
      ].join(":"),
    [statusFilter, cellPlacementFilter, debouncedSearch, pagination.current, pagination.pageSize, isDeveloper],
  );
  const bumpSubmissionsCache = useCallback(() => {
    // Clear cached lists so the next manual/interval refresh re-fetches fresh data,
    // but do NOT change the cache key/version — that would trigger an immediate,
    // blocking full re-fetch and a slow spinner even though local state is already
    // merged. The in-place merge keeps the table correct without a network round-trip.
    secureStorage.remove(CACHE_KEY);
    invalidateCache(currentCacheKey);
  }, [currentCacheKey]);

  const handleRepairXX = async () => {
    setRepairingXX(true);
    try {
      const { data } = await api.post("/data-slf/repair-xx-ids");
      Swal.fire({
        icon: "success",
        title: "XX IDs Repaired",
        html: `<div style="text-align:left;font-size:13px">
          <p>${data.message}</p>
          ${data.errors?.length ? `<p style="color:#ff4d4f">${data.errors.length} error(s) encountered.</p>` : ""}
        </div>`,
        confirmButtonColor: "#2f54eb",
      });
      fetchData({ force: true });
    } catch {
      Swal.fire("Error", "Could not repair XX IDs.", "error");
    } finally {
      setRepairingXX(false);
    }
  };

  const handleRepairTypeIds = async () => {
    setRepairingType(true);
    try {
      const { data } = await api.post("/data-slf/repair-type-ids");
      Swal.fire({
        icon: "success",
        title: "PVT/LGU IDs Repaired",
        html: `<div style="text-align:left;font-size:13px">
          <p>${data.message}</p>
          ${data.errors?.length ? `<p style="color:#ff4d4f">${data.errors.length} error(s) encountered.</p>` : ""}
        </div>`,
        confirmButtonColor: "#2f54eb",
      });
      fetchData({ force: true, silent: true });
    } catch {
      Swal.fire("Error", "Could not repair PVT/LGU IDs.", "error");
    } finally {
      setRepairingType(false);
    }
  };

  // Load a dry-run preview of the affected ID No. rows before applying a fix.
  // Keeps the modal open on error (shows an inline error + Retry) and guards
  // against duplicate/concurrent fetches so the preview always reflects the
  // latest source data without freezing on a stuck request.
  const openIdFixPreview = async (type) => {
    if (idFixLoadingRef.current) return; // prevent duplicate/concurrent fetch
    idFixLoadingRef.current = true;
    setIdFixPreview({
      open: true, type, loading: true, applying: false,
      changes: [], message: "", error: "", total: 0, truncated: false,
    });
    try {
      const endpoint = type === "xx" ? "/data-slf/repair-xx-ids" : "/data-slf/repair-type-ids";
      const { data } = await api.post(endpoint, { preview: true });
      const changes = Array.isArray(data.changes) ? data.changes : [];
      setIdFixPreview((prev) => ({
        ...prev,
        loading: false,
        changes,
        message: data.message || "",
        error: "",
        total: Number.isFinite(data.total) ? data.total : changes.length,
        truncated: Boolean(data.truncated),
      }));
    } catch (err) {
      setIdFixPreview((prev) => ({
        ...prev,
        loading: false,
        error:
          err.response?.data?.message ||
          "Could not load the ID fix preview. Please retry.",
      }));
    } finally {
      idFixLoadingRef.current = false;
    }
  };
  const retryIdFixPreview = () => {
    if (idFixPreview.type) openIdFixPreview(idFixPreview.type);
  };

  // Apply the fix only after the admin confirms the preview.
  const confirmIdFix = async () => {
    const { type } = idFixPreview;
    setIdFixPreview((prev) => ({ ...prev, applying: true }));
    try {
      if (type === "xx") await handleRepairXX();
      else await handleRepairTypeIds();
    } finally {
      setIdFixPreview({ open: false, type: null, loading: false, applying: false, changes: [], message: "" });
    }
  };

  // Address cascading dropdowns for admin edit
  const [addrRegions, setAddrRegions] = useState([]);
  const [addrProvinces, setAddrProvinces] = useState([]);
  const [addrMunicipalities, setAddrMunicipalities] = useState([]);
  const [addrBarangays, setAddrBarangays] = useState([]);
  // Resolved address names for view details
  const [resolvedAddr, setResolvedAddr] = useState({});

  const fetchData = useCallback(
    async ({ force = false, silent = false } = {}) => {
      const requestKey = currentCacheKey;
      if (fetchingRef.current === requestKey) {
        if (force) pendingRefreshRef.current = true;
        return;
      }
      latestRequestKeyRef.current = requestKey;
      fetchingRef.current = requestKey;
      try {
        await fetchWithCache(
          requestKey,
          () =>
            api
              .get("/data-slf", {
                params: {
                  mode: "list",
                  // Server-side grouped pagination: the backend groups submissions
                  // into batches and returns only the current page's groups' rows.
                  grouped: "true",
                  page: pagination.current,
                  limit: pagination.pageSize,
                  // Developers additionally see SAMPLE (dummy) submissions inline,
                  // flagged as SAMPLE. The server only honors this for developers.
                  ...(isDeveloper ? { includeDummy: "true" } : {}),
                  ...(statusFilter && statusFilter !== "all" ? { status: statusFilter } : {}),
                  ...(cellPlacementFilter && cellPlacementFilter !== "all"
                    ? { cellPlacement: cellPlacementFilter }
                    : {}),
                  ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
                },
              })
              .then(({ data: resp }) => {
                // API returns { data, total, page, limit } when paginated, or an array otherwise
                const rows = Array.isArray(resp)
                  ? resp
                  : Array.isArray(resp?.data)
                    ? resp.data
                    : [];
                const total = typeof resp?.total === "number" ? resp.total : rows.length;
                const totalEntries = typeof resp?.totalEntries === "number" ? resp.totalEntries : total;
                return { rows: rows.map(normalizeSubmissionRecord), total, totalEntries };
              }),
          {
            ttl: CACHE_TTL,
            force,
            onData: (payload) => {
              if (latestRequestKeyRef.current !== requestKey) return;
              const rows = Array.isArray(payload?.rows)
                ? payload.rows
                : Array.isArray(payload)
                  ? payload
                  : [];
              setData(rows);
              if (payload && typeof payload.total === "number") {
                setPagination((prev) => ({ ...prev, total: payload.total }));
              }
              if (payload && typeof payload.totalEntries === "number") {
                setEntryTotal(payload.totalEntries);
              }
              setLoading(false);
            },
            onError: () => {
              if (!silent)
                Swal.fire("Error", "Could not load submissions", "error");
            },
            onStart: () => {
              if (!silent) setLoading(true);
            },
            onEnd: () => {
              if (!silent) setLoading(false);
            },
          },
        );
      } finally {
        if (fetchingRef.current === requestKey) fetchingRef.current = null;
        if (pendingRefreshRef.current) {
          pendingRefreshRef.current = false;
          window.setTimeout(() => fetchData({ force: true, silent: true }), 0);
        }
      }
    },
    [currentCacheKey, statusFilter, cellPlacementFilter, debouncedSearch, pagination.current, pagination.pageSize, isDeveloper],
  );

  // Reset to the first page whenever a server-side filter changes so we never
  // request a page beyond the new result set.
  useEffect(() => {
    setPagination((prev) => (prev.current === 1 ? prev : { ...prev, current: 1 }));
  }, [statusFilter, cellPlacementFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelectedRowKeys([]);
      setPagination((prev) => ({ ...prev, current: 1 }));
      setDebouncedSearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(
      () => fetchData({ force: true, silent: true }),
      60000,
    );
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handleRefresh = ({ target } = {}) => {
      if (!target || target === "submissions") {
        invalidateCache(currentCacheKey);
        fetchData({ force: true, silent: true });
      }
    };
    socket.on("data-refresh", handleRefresh);
    return () => socket.off("data-refresh", handleRefresh);
  }, [currentCacheKey, fetchData]);

  // Resolve PSGC codes to names when viewing a record
  useEffect(() => {
    if (
      viewRecord &&
      (viewRecord.companyRegion || viewRecord.companyProvince)
    ) {
      resolveAddressNames(viewRecord);
    } else {
      setResolvedAddr({});
    }
  }, [viewRecord]);

  const getPortalSubmissionGroupKey = useCallback((record) => {
    const submittedBy = String(record?.submittedBy || "")
      .trim()
      .toLowerCase();
    const company = String(record?.lguCompanyName || "")
      .trim()
      .toLowerCase();
    const status = String(record?.status || "")
      .trim()
      .toLowerCase();
    if (
      !submittedBy ||
      !company ||
      !submittedBy.includes("@") ||
      status === "reverted"
    )
      return null;
    return `${submittedBy}::${company}::${status}`;
  }, []);

  const getGroupedStatus = useCallback((entries) => {
    const statuses = [
      ...new Set(entries.map((entry) => entry?.status).filter(Boolean)),
    ];
    if (statuses.length <= 1) return statuses[0] || "pending";
    if (statuses.includes("pending")) return "pending";
    if (statuses.includes("reverted")) return "reverted";
    if (statuses.includes("rejected")) return "rejected";
    if (statuses.includes("editApproved")) return "editApproved";
    return statuses[0] || "pending";
  }, []);

  const buildGroupedRow = useCallback(
    (groupKey, entries) => {
      const primary = entries[0];
      const submissionIds = [
        ...new Set(entries.map((entry) => entry.submissionId).filter(Boolean)),
      ];
      return {
        ...primary,
        _id: `group:${groupKey}`,
        primaryId: primary._id,
        entryIds: entries.map((entry) => entry._id),
        groupedEntries: entries,
        isGroupedSubmission: true,
        entryCount: entries.length,
        groupedSubmissionCount: submissionIds.length,
        submissionIds,
        truckCount: entries.reduce(
          (sum, entry) => sum + (entry.truckCount ?? entry.trucks?.length ?? 0),
          0,
        ),
        trucks: entries.flatMap((entry) => entry.trucks || []),
        status: getGroupedStatus(entries),
        editRequested: entries.some((entry) => entry.editRequested),
        revertRequested: entries.some((entry) => entry.revertRequested),
        createdAt: primary.createdAt,
        updatedAt: entries.reduce(
          (latest, entry) => {
            const current = new Date(
              entry.updatedAt || entry.createdAt || 0,
            ).getTime();
            return current > latest ? current : latest;
          },
          new Date(primary.updatedAt || primary.createdAt || 0).getTime(),
        ),
      };
    },
    [getGroupedStatus],
  );

  const tableRows = useMemo(() => {
    const groups = new Map();
    data.forEach((entry) => {
      const key = getPortalSubmissionGroupKey(entry);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const seen = new Set();
    return data
      .map((entry) => {
        const key = getPortalSubmissionGroupKey(entry);
        const groupedEntries = key ? groups.get(key) || [] : [];
        if (key && groupedEntries.length > 1) {
          if (seen.has(key)) return null;
          seen.add(key);
          return buildGroupedRow(key, groupedEntries);
        }
        return {
          ...entry,
          primaryId: entry._id,
          entryIds: [entry._id],
          isGroupedSubmission: false,
          entryCount: 1,
        };
      })
      .filter(Boolean);
  }, [buildGroupedRow, data, getPortalSubmissionGroupKey]);

  // Derive a single cell-placement status for a row (aggregated across grouped
  // entries) — mirrors the Cell Placement column and drives the filter dropdown.
  const getRowCellPlacementStatus = useCallback((row) => {
    const sources =
      Array.isArray(row.groupedEntries) && row.groupedEntries.length
        ? row.groupedEntries
        : [row];
    let placed = 0;
    let total = 0;
    let known = false;
    sources.forEach((e) => {
      const cp = e?.cellPlacement;
      if (cp?.known) {
        known = true;
        placed += cp.placed || 0;
        total += cp.total || 0;
      } else if (cp) {
        total += cp.total || 0;
      }
    });
    if (!known && total === 0) return "nowaste";
    if (!known) return "unknown";
    if (placed === 0) return "none";
    if (placed >= total) return "assigned";
    return "partial";
  }, []);

  // Status, search, and cell-placement filtering are all applied server-side
  // (grouped pagination), and `data` already holds only the current page's
  // groups, so the table renders the grouped rows as-is. `pagination.total`
  // (group count) comes from the server — do not derive it from row length.
  const filteredTableRows = tableRows;

  // ── SLF submission export ──
  // Exports one row per WASTE ENTRY, not one per submission, so hauler, waste type,
  // cell and — critically — the unit of measurement for every volume are present.
  // The table's own rows carry no `trucks` (the list endpoint strips them to keep
  // the page light), so the current page is re-fetched with includeTrucks before
  // expanding. `slfName` comes from the record's populated facility whenever one
  // exists, so a stale name snapshot can't split one SLF across two labels.
  const [exportingSubmissions, setExportingSubmissions] = useState(false);
  const handleExportSubmissions = useCallback(async () => {
    setExportingSubmissions(true);
    try {
      const { data: resp } = await api.get("/data-slf", {
        params: {
          mode: "list",
          grouped: "true",
          includeTrucks: "true",
          page: 1,
          limit: 1,
          // Export the ENTIRE filtered result set (every group + all its entries),
          // not just the current page — the server returns all groups when all=true.
          all: "true",
          ...(isDeveloper ? { includeDummy: "true" } : {}),
          ...(statusFilter && statusFilter !== "all" ? { status: statusFilter } : {}),
          ...(cellPlacementFilter && cellPlacementFilter !== "all"
            ? { cellPlacement: cellPlacementFilter }
            : {}),
          ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
        },
      });
      const records = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : [];

      const seen = new Set();
      const rows = [];
      records.forEach((record) => {
        const facility = record.slfGenerator;
        const canonicalName =
          (facility && typeof facility === "object"
            ? `${facility.lgu || ""}${facility.ownership ? ` (${facility.ownership})` : ""}`.trim()
            : "") ||
          record.slfName ||
          "";
        buildSubmissionWasteEntries(record, {
          slfName: canonicalName,
          fallbackUnit: record.baselineUnit,
        }).forEach((entry) => {
          // The same submission can be reachable under more than one identity;
          // de-duplicate on the entry key so no row is written twice.
          if (seen.has(entry.key)) return;
          seen.add(entry.key);
          rows.push({
            "Submission Reference": entry.submissionId,
            "Submission Date": entry.date ? dayjs(entry.date).format("YYYY-MM-DD") : "",
            "SLF Name": entry.slfName,
            "Facility Category": facility?.category || record.category || "",
            "LGU/Company": record.lguCompanyName || "",
            "Hauler Name": entry.hauler || "",
            "Hauler Details": [entry.plateNumber ? `Plate ${entry.plateNumber}` : "", entry.ticketNo ? `Ticket ${entry.ticketNo}` : ""].filter(Boolean).join("; "),
            "Client Name": (entry.clients || []).map((client) => client.name).join(", ") || "No client recorded",
            "Client Details": (entry.clients || []).map((client) => client.details).filter(Boolean).join("; "),
            "Plate No.": entry.plateNumber || "",
            "Waste Type": entry.wasteType || "",
            "Waste Volume": entry.volume == null ? "" : Number(entry.volume.toFixed(2)),
            // Always populated alongside a volume — an unlabelled quantity is
            // exactly what this column exists to prevent.
            "Unit of Measurement":
              entry.volume == null ? "" : entry.unit || "unit not recorded",
            "Cell or Disposal Area": entry.cell || "Unplaced",
            "Submission Status": entry.status || "pending",
            "Submitted By": record.submittedBy || "",
            "Created Date": record.createdAt
              ? dayjs(record.createdAt).format("YYYY-MM-DD HH:mm")
              : "",
            "Last Updated Date": record.updatedAt
              ? dayjs(record.updatedAt).format("YYYY-MM-DD HH:mm")
              : "",
          });
        });
      });

      if (!rows.length) {
        message.info("No waste entries to export for the current filters.");
        return;
      }
      exportToExcel(rows, `SLF_Submissions_Filtered_${dayjs().format("YYYY-MM-DD")}`);
    } catch (err) {
      message.error(
        err?.response?.data?.message || "Could not build the submission export.",
      );
    } finally {
      setExportingSubmissions(false);
    }
  }, [
    pagination.pageSize,
    pagination.total,
    isDeveloper,
    statusFilter,
    cellPlacementFilter,
    debouncedSearch,
  ]);

  const selectedEntryIds = useMemo(() => {
    const ids = new Set();
    selectedRowKeys.forEach((rowKey) => {
      const row =
        filteredTableRows.find((item) => item._id === rowKey) ||
        tableRows.find((item) => item._id === rowKey);
      (row?.entryIds || []).forEach((id) => ids.add(id));
    });
    return [...ids];
  }, [filteredTableRows, selectedRowKeys, tableRows]);

  const runAcknowledgeFlow = useCallback(
    async ({ ids, rowKey, clearSelection = false }) => {
      const pendingIds = ids.filter((id) => {
        const entry = data.find((item) => item._id === id);
        return entry?.status === "pending";
      });
      if (pendingIds.length === 0) {
        Swal.fire("Info", "No pending entries selected.", "info");
        return false;
      }

      const entryLabel = pendingIds.length === 1 ? "entry" : "entries";
      const ackKey = `${rowKey}:acknowledged`;
      // Per-row tracking — does NOT block other rows from acknowledging in parallel
      addActionKey(ackKey);
      setRowProgress((prev) => ({
        ...prev,
        [rowKey]: { done: 0, total: pendingIds.length },
      }));

      try {
        // Process in batches so the progress bar reflects how many of the
        // grouped submissions have completed. Single entries finish in one tick;
        // multiple entries advance one at a time so the percentage is visible.
        const BATCH = pendingIds.length > 1 ? 1 : 5;
        const allUpdated = [];
        for (let i = 0; i < pendingIds.length; i += BATCH) {
          const chunk = pendingIds.slice(i, i + BATCH);
          const { data: ackResult } = await api.patch("/data-slf/bulk-status", {
            ids: chunk,
            status: "acknowledged",
          });
          if (Array.isArray(ackResult?.data)) {
            allUpdated.push(...ackResult.data.map(normalizeSubmissionRecord));
          }
          const done = Math.min(i + BATCH, pendingIds.length);
          setRowProgress((prev) => ({
            ...prev,
            [rowKey]: { done, total: pendingIds.length },
          }));
        }

        // Merge updated entries into local state instead of re-fetching everything
        if (allUpdated.length > 0) {
          const updatedById = new Map(allUpdated.map((e) => [e._id, e]));
          setData((prev) =>
            prev.map((entry) => updatedById.get(entry._id) || entry),
          );
        }
        bumpSubmissionsCache();
        secureStorage.invalidateDashboard();
        if (clearSelection) setSelectedRowKeys([]);
        if (selectedRowKeys.includes(rowKey)) {
          setSelectedRowKeys((prev) => prev.filter((key) => key !== rowKey));
        }
        Swal.fire({
          icon: "success",
          title: "Submission acknowledged",
          text: `${pendingIds.length} ${entryLabel} acknowledged successfully.`,
          timer: 1000,
          showConfirmButton: false,
        });
        return true;
      } catch {
        Swal.fire("Error", "Could not acknowledge submissions", "error");
        return false;
      } finally {
        removeActionKey(ackKey);
        setRowProgress((prev) => {
          const next = { ...prev };
          delete next[rowKey];
          return next;
        });
        if (clearSelection) setBulkAcknowledgeLoading(false);
      }
    },
    [addActionKey, removeActionKey, bumpSubmissionsCache, data, selectedRowKeys],
  );

  const updateStatus = async (recordOrId, status) => {
    const record =
      typeof recordOrId === "object"
        ? recordOrId
        : tableRows.find(
            (row) => row._id === recordOrId || row.primaryId === recordOrId,
          ) || {
            _id: recordOrId,
            primaryId: recordOrId,
            entryIds: [recordOrId],
          };
    const rowKey = record?._id || record?.primaryId || String(recordOrId || "");
    const targetIds =
      Array.isArray(record?.entryIds) && record.entryIds.length > 0
        ? record.entryIds
        : [record?.primaryId || record?._id || recordOrId].filter(Boolean);
    if (targetIds.length === 0) return;
    if (status === "acknowledged") {
      await runAcknowledgeFlow({ ids: targetIds, rowKey });
      return;
    }
    try {
      const actKey = `${rowKey}:${status}`;
      addActionKey(actKey);
      const { data: statusResult } = await api.patch("/data-slf/bulk-status", {
        ids: targetIds,
        status,
      });
      const updatedEntries = Array.isArray(statusResult?.data)
        ? statusResult.data.map(normalizeSubmissionRecord)
        : [];
      if (updatedEntries.length > 0) {
        const updatedById = new Map(updatedEntries.map((e) => [e._id, e]));
        setData((prev) =>
          prev.map((entry) => updatedById.get(entry._id) || entry),
        );
      }
      bumpSubmissionsCache();
      secureStorage.invalidateDashboard();
      if (selectedRowKeys.includes(rowKey))
        setSelectedRowKeys((prev) => prev.filter((key) => key !== rowKey));
      Swal.fire({
        icon: "success",
        title: `Submission ${status}`,
        timer: 1000,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not update status", "error");
    } finally {
      removeActionKey(`${rowKey}:${status}`);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/data-slf/${id}`);
      setData((prev) => prev.filter((d) => d._id !== id));
      bumpSubmissionsCache();
      secureStorage.invalidateDashboard();
      Swal.fire({
        icon: "success",
        title: "Deleted",
        timer: 800,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not delete submission", "error");
    }
  };

  const handleBulkAcknowledge = async () => {
    const pendingIds = selectedEntryIds.filter((id) => {
      const entry = data.find((d) => d._id === id);
      return entry?.status === "pending";
    });
    if (pendingIds.length === 0) {
      Swal.fire("Info", "No pending entries selected.", "info");
      return;
    }
    const confirmed = await Swal.fire({
      title: `Acknowledge ${pendingIds.length} entry(ies)?`,
      text: "This will send an acknowledgement email to the submitters.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Acknowledge All",
      confirmButtonColor: "#52c41a",
    });
    if (!confirmed.isConfirmed) return;
    setBulkAcknowledgeLoading(true);
    await runAcknowledgeFlow({
      ids: pendingIds,
      rowKey: "bulk-selection",
      clearSelection: true,
    });
  };

  const handleBulkDelete = async () => {
    if (selectedEntryIds.length === 0) return;
    const confirmed = await Swal.fire({
      title: `Delete ${selectedEntryIds.length} selected entry(ies)?`,
      text: "Selected entries will be moved to Deleted Submissions.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete Selected",
      confirmButtonColor: "#ff4d4f",
    });
    if (!confirmed.isConfirmed) return;
    try {
      const { data: result } = await api.post("/data-slf/bulk-delete", {
        ids: selectedEntryIds,
        performedBy: currentActorName,
      });
      setData((prev) =>
        prev.filter(
          (entry) => !result.data.some((deleted) => deleted._id === entry._id),
        ),
      );
      bumpSubmissionsCache();
      secureStorage.invalidateDashboard();
      setSelectedRowKeys([]);
      Swal.fire({
        icon: "success",
        title: result.message || "Selected entries deleted",
        timer: 1500,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Could not delete selected entries",
        "error",
      );
    }
  };

  const handleBulkRevert = async () => {
    if (selectedEntryIds.length === 0) return;
    const { value: reason, isConfirmed } = await Swal.fire({
      title: `Revert ${selectedEntryIds.length} selected entry(ies)?`,
      input: "textarea",
      inputLabel: "Reason for revert",
      inputPlaceholder: "Enter one reason that applies to all selected rows...",
      inputValidator: (value) =>
        !value?.trim() ? "Please enter a reason" : undefined,
      showCancelButton: true,
      confirmButtonText: "Revert Selected",
      confirmButtonColor: "#fa541c",
    });
    if (!isConfirmed) return;
    try {
      const { data: result } = await api.patch("/data-slf/bulk-revert", {
        ids: selectedEntryIds,
        reason: reason.trim(),
        performedBy: currentActorName,
      });
      setData((prev) =>
        prev.map(
          (entry) =>
            result.data.find((updated) => updated._id === entry._id) || entry,
        ),
      );
      bumpSubmissionsCache();
      secureStorage.invalidateDashboard();
      setSelectedRowKeys([]);
      Swal.fire({
        icon: "success",
        title: result.message || "Selected entries reverted",
        timer: 1800,
        showConfirmButton: false,
      });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Could not revert selected entries",
        "error",
      );
    }
  };

  // ── Address cascading helpers ──
  const fetchAddrRegions = async () => {
    try {
      const { data } = await api.get("/settings/address/regions");
      setAddrRegions(data);
      return data;
    } catch {
      return [];
    }
  };
  const fetchAddrProvinces = async (regionCode) => {
    if (!regionCode) {
      setAddrProvinces([]);
      setAddrMunicipalities([]);
      setAddrBarangays([]);
      return [];
    }
    try {
      const { data } = await api.get(
        `/settings/address/provinces/${regionCode}`,
      );
      setAddrProvinces(data);
      setAddrMunicipalities([]);
      setAddrBarangays([]);
      return data;
    } catch {
      return [];
    }
  };
  const fetchAddrMunicipalities = async (provinceCode) => {
    if (!provinceCode) {
      setAddrMunicipalities([]);
      setAddrBarangays([]);
      return [];
    }
    try {
      const { data } = await api.get(
        `/settings/address/municipalities/${provinceCode}`,
      );
      setAddrMunicipalities(data);
      setAddrBarangays([]);
      return data;
    } catch {
      return [];
    }
  };
  const fetchAddrBarangays = async (municipalityCode) => {
    if (!municipalityCode) {
      setAddrBarangays([]);
      return [];
    }
    try {
      const { data } = await api.get(
        `/settings/address/barangays/${municipalityCode}`,
      );
      setAddrBarangays(data);
      return data;
    } catch {
      return [];
    }
  };

  const resolveAddressNames = async (record) => {
    const result = {};
    if (record.companyRegion) {
      const regs = await fetchAddrRegions();
      const reg = regs.find((r) => r.code === record.companyRegion);
      result.region = reg?.name || record.companyRegion;
      if (record.companyProvince) {
        const provs = await fetchAddrProvinces(record.companyRegion);
        const prov = provs.find((p) => p.code === record.companyProvince);
        result.province = prov?.name || record.companyProvince;
        if (record.companyMunicipality) {
          const muns = await fetchAddrMunicipalities(record.companyProvince);
          const mun = muns.find((m) => m.code === record.companyMunicipality);
          result.municipality = mun?.name || record.companyMunicipality;
          if (record.companyBarangay) {
            const brgys = await fetchAddrBarangays(record.companyMunicipality);
            const brgy = brgys.find((b) => b.code === record.companyBarangay);
            result.barangay = brgy?.name || record.companyBarangay;
          }
        }
      }
    }
    setResolvedAddr(result);
  };

  const loadSubmissionDetail = async (record) => {
    const detailId = record?.primaryId || record?._id;
    if (!detailId || String(detailId).startsWith("group:")) return record;
    try {
      const { data } = await api.get(`/data-slf/detail/${detailId}`);
      const detailed = normalizeSubmissionRecord(data);
      setData((prev) =>
        prev.map((item) =>
          item._id === detailed._id ? { ...item, ...detailed } : item,
        ),
      );
      return record?.isGroupedSubmission
        ? { ...record, ...detailed, _id: record._id, primaryId: detailId }
        : detailed;
    } catch {
      return record;
    }
  };

  const openView = async (record) => {
    setViewRecord(record);
    const detailed = await loadSubmissionDetail(record);
    setViewRecord(detailed);
  };

  const syncGroupedViewAfterStatusChange = useCallback(
    (groupRecord, entryId) => {
      if (!groupRecord?.isGroupedSubmission) return;
      const nextEntries = (groupRecord.groupedEntries || []).filter(
        (entry) => entry._id !== entryId,
      );
      const buildNextGroupRecord = () => {
        if (nextEntries.length === 0) return null;
        const nextPrimary = nextEntries[0];
        return {
          ...groupRecord,
          ...nextPrimary,
          groupedEntries: nextEntries,
          entryIds: nextEntries.map((entry) => entry._id),
          entryCount: nextEntries.length,
          groupedSubmissionCount: [
            ...new Set(
              nextEntries.map((entry) => entry.submissionId).filter(Boolean),
            ),
          ].length,
          truckCount: nextEntries.reduce(
            (sum, entry) =>
              sum + (entry.truckCount ?? entry.trucks?.length ?? 0),
            0,
          ),
          trucks: nextEntries.flatMap((entry) => entry.trucks || []),
          primaryId: nextPrimary._id,
        };
      };
      if (nextEntries.length === 0) {
        if (viewRecord?._id === groupRecord._id) setViewRecord(null);
        if (groupedEntriesRecord?._id === groupRecord._id)
          setGroupedEntriesRecord(null);
        return;
      }
      const nextGroupRecord = buildNextGroupRecord();
      if (viewRecord?._id === groupRecord._id) setViewRecord(nextGroupRecord);
      if (groupedEntriesRecord?._id === groupRecord._id)
        setGroupedEntriesRecord(nextGroupRecord);
    },
    [groupedEntriesRecord, viewRecord],
  );

  const handleGroupedEntryStatus = useCallback(
    async (groupRecord, entry, status) => {
      await updateStatus(entry, status);
      if (status === "acknowledged" || status === "rejected") {
        syncGroupedViewAfterStatusChange(groupRecord, entry._id);
      }
    },
    [syncGroupedViewAfterStatusChange, updateStatus],
  );

  const openEdit = async (record) => {
    record = await loadSubmissionDetail(record);
    setEditRecord(record);
    // Pre-load address cascading dropdowns
    (async () => {
      await fetchAddrRegions();
      if (record.companyRegion) await fetchAddrProvinces(record.companyRegion);
      if (record.companyProvince)
        await fetchAddrMunicipalities(record.companyProvince);
      if (record.companyMunicipality)
        await fetchAddrBarangays(record.companyMunicipality);
    })();
    editForm.setFieldsValue({
      dateOfDisposal: record.dateOfDisposal
        ? dayjs(record.dateOfDisposal)
        : null,
      lguCompanyName: record.lguCompanyName,
      companyType: record.companyType,
      address: record.address,
      companyRegion: record.companyRegion,
      companyProvince: record.companyProvince,
      companyMunicipality: record.companyMunicipality,
      companyBarangay: record.companyBarangay,
      // Cell Operations — initialize from the stored record so the modal shows the
      // saved values instead of always defaulting to m³ / Active (which also made a
      // "no-op" save silently reset them).
      currentCellVolume: record.currentCellVolume,
      currentCellVolumeUnit: (record.currentCellVolumeUnit || "m³").replace("m3", "m³"),
      cellStatus: record.cellStatus || "Active",
      baselineUnit:
        record.baselineUnit || record.totalVolumeAcceptedUnit || "m³",
      totalVolumeAccepted: record.totalVolumeAccepted,
      totalVolumeAcceptedUnit: record.totalVolumeAcceptedUnit || "m³",
      activeCellResidualVolume: record.activeCellResidualVolume,
      activeCellResidualUnit: record.activeCellResidualUnit || "m³",
      activeCellInertVolume: record.activeCellInertVolume,
      activeCellInertUnit: record.activeCellInertUnit || "m³",
      closedCellResidualVolume: record.closedCellResidualVolume,
      closedCellResidualUnit: record.closedCellResidualUnit || "m³",
      closedCellInertVolume: record.closedCellInertVolume,
      closedCellInertUnit: record.closedCellInertUnit || "m³",
      activeCellEntries: record.activeCellEntries || [],
      closedCellEntries: record.closedCellEntries || [],
      accreditedHaulers: record.accreditedHaulers || [],
      trucks: record.trucks || [],
    });
  };

  const handleEditSave = async () => {
    try {
      const values = await editForm.validateFields();
      setEditLoading(true);
      // Resolve address names from PSGC codes for the combined address field
      const regName =
        addrRegions.find((r) => r.code === values.companyRegion)?.name || "";
      const provName =
        addrProvinces.find((p) => p.code === values.companyProvince)?.name ||
        "";
      const munName =
        addrMunicipalities.find((m) => m.code === values.companyMunicipality)
          ?.name || "";
      const brgyName =
        addrBarangays.find((b) => b.code === values.companyBarangay)?.name ||
        "";
      const addressParts = [brgyName, munName, provName, regName].filter(
        Boolean,
      );
      const payload = {
        ...values,
        activeCellEntries: (values.activeCellEntries || []).map((entry) => ({
          ...entry,
          unit: (
            entry.unit ||
            values.baselineUnit ||
            values.totalVolumeAcceptedUnit ||
            "m³"
          ).replace("m3", "m³"),
        })),
        closedCellEntries: (values.closedCellEntries || []).map((entry) => ({
          ...entry,
          unit: (
            entry.unit ||
            values.baselineUnit ||
            values.totalVolumeAcceptedUnit ||
            "m³"
          ).replace("m3", "m³"),
        })),
        updatedBy: currentActorName,
        dateOfDisposal: values.dateOfDisposal?.toISOString(),
        address:
          addressParts.length > 0 ? addressParts.join(", ") : values.address,
      };
      const { data: updated } = await api.patch(
        `/data-slf/${editRecord._id}/admin-edit`,
        payload,
      );
      setData((prev) =>
        prev.map((d) => (d._id === editRecord._id ? updated : d)),
      );
      bumpSubmissionsCache();
      secureStorage.invalidateDashboard();
      setEditRecord(null);
      Swal.fire({
        icon: "success",
        title: "Updated",
        text: "Submission updated successfully",
        timer: 1200,
        showConfirmButton: false,
      });
    } catch (err) {
      if (err.response)
        Swal.fire(
          "Error",
          err.response.data?.message || "Update failed",
          "error",
        );
    } finally {
      setEditLoading(false);
    }
  };

  const openTxnHistory = async (submissionId) => {
    setTxnHistoryModal({ open: true, submissionId });
    setTxnHistoryLoading(true);
    try {
      const { data } = await api.get(`/transactions/thread/${submissionId}`);
      setTxnHistoryData(data);
    } catch {
      setTxnHistoryData([]);
    } finally {
      setTxnHistoryLoading(false);
    }
  };

  const getTxnHistoryKey = (record) =>
    record?.idNo || record?._id || record?.submissionId || null;

  const handleAdminRevert = async () => {
    if (!revertReason.trim()) {
      Swal.fire("Warning", "Please provide a reason for reverting.", "warning");
      return;
    }
    const confirm = await Swal.fire({
      icon: "warning",
      title: "Are you sure you want to revert this submission?",
      html: `<div style="text-align:left;font-size:13px;line-height:1.7;">
        <p>Reverting this submission will:</p>
        <ul style="margin:8px 0;padding-left:20px;">
          <li>Change the status to <strong>Reverted</strong></li>
          <li>Notify the portal user (<strong>${revertModal.record?.submittedBy || "N/A"}</strong>) via email</li>
          <li>Allow the portal user to edit and resubmit the entry</li>
          <li>Record this action in the transaction history</li>
        </ul>
        <p style="margin-top:8px;"><strong>Reason:</strong> ${revertReason}</p>
      </div>`,
      showCancelButton: true,
      confirmButtonText: "Yes, Revert",
      confirmButtonColor: "#fa541c",
      cancelButtonText: "Cancel",
    });
    if (!confirm.isConfirmed) return;
    setRevertLoading(true);
    try {
      if (revertModal.record?.isGroupedSubmission) {
        await api.patch("/data-slf/bulk-revert", {
          ids: revertModal.record.entryIds || [],
          reason: revertReason,
          performedBy: currentActorName,
        });
      } else {
        await api.patch(`/data-slf/${revertModal.record._id}/admin-revert`, {
          reason: revertReason,
          performedBy: currentActorName,
        });
      }
      Swal.fire({
        icon: "success",
        title: "Reverted",
        text: revertModal.record?.isGroupedSubmission
          ? "Grouped submissions reverted and the portal user has been notified via email."
          : "Submission reverted and the portal user has been notified via email.",
        confirmButtonColor: ACCENT,
        timer: 2500,
      });
      setRevertModal({ open: false, record: null });
      setRevertReason("");
      fetchData({ force: true, silent: true });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to revert",
        "error",
      );
    } finally {
      setRevertLoading(false);
    }
  };

  const handleApproveEdit = async (id) => {
    const result = await Swal.fire({
      title: "Approve Edit Request?",
      text: "The portal user will be able to edit and resubmit this entry.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Approve",
      confirmButtonColor: "#52c41a",
    });
    if (!result.isConfirmed) return;
    try {
      await api.patch(`/data-slf/${id}/approve-edit`);
      Swal.fire({
        icon: "success",
        title: "Edit Approved",
        timer: 1500,
        showConfirmButton: false,
      });
      fetchData({ force: true, silent: true });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to approve edit",
        "error",
      );
    }
  };

  const handleRejectEdit = async (id) => {
    const { value: reason } = await Swal.fire({
      title: "Reject Edit Request",
      input: "textarea",
      inputPlaceholder: "Reason for rejection (optional)...",
      showCancelButton: true,
      confirmButtonText: "Reject",
      confirmButtonColor: "#ff4d4f",
    });
    if (reason === undefined) return; // cancelled
    try {
      await api.patch(`/data-slf/${id}/reject-edit`, { reason: reason || "" });
      Swal.fire({
        icon: "success",
        title: "Edit Rejected",
        timer: 1500,
        showConfirmButton: false,
      });
      fetchData({ force: true, silent: true });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to reject edit",
        "error",
      );
    }
  };

  const statusColors = {
    pending: "orange",
    acknowledged: "green",
    rejected: "red",
    reverted: "volcano",
    editApproved: "cyan",
  };
  // Hex equivalents for Progress bars (Ant tag color names aren't all valid CSS).
  const statusHex = {
    pending: "#fa8c16",
    acknowledged: "#52c41a",
    rejected: "#ff4d4f",
    reverted: "#fa541c",
    editApproved: "#13c2c2",
  };

  const openGroupedEntriesModal = useCallback((record) => {
    setGroupedEntriesRecord(record);
  }, []);

  const openGroupedEntryDetail = useCallback(
    (entry) => {
      setGroupedEntriesRecord(null);
      openView(entry);
    },
    [openView],
  );

  const columns = [
    {
      title: (
        <span>
          <IdcardOutlined /> ID No.
        </span>
      ),
      dataIndex: "idNo",
      key: "idNo",
      width: 120,
      render: (text, record) => (
        <Space direction="vertical" size={0}>
          <Space size={4} wrap>
            <Text strong style={{ fontSize: 12, ...WRAP_CELL_STYLE }}>
              {record.isGroupedSubmission
                ? record.groupedSubmissionCount > 1
                  ? `Multiple (${record.groupedSubmissionCount})`
                  : record.submissionId || text
                : text}
            </Text>
            {record.isDummy && (
              <Tooltip title="Sample / test submission — visible to developers only, excluded from real reporting.">
                <Tag color="purple" style={{ margin: 0, fontSize: 10, lineHeight: "16px" }}>
                  SAMPLE
                </Tag>
              </Tooltip>
            )}
          </Space>
          {record.isGroupedSubmission && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {record.entryCount} grouped entr
              {record.entryCount === 1 ? "y" : "ies"}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: (
        <span>
          <BankOutlined /> LGU/Company
        </span>
      ),
      dataIndex: "lguCompanyName",
      key: "lguCompanyName",
      width: 220,
      render: (text, r) => (
        <Space direction="vertical" size={2}>
          <Text style={WRAP_CELL_STYLE}>{text || "—"}</Text>
          {r.companyType && (
            <Tag
              color={r.companyType === "LGU" ? "blue" : "purple"}
              bordered={false}
              style={{ margin: 0, fontSize: 10 }}
            >
              {r.companyType}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: (
        <span>
          <CalendarOutlined /> Disposal / Submitted
        </span>
      ),
      key: "disposalSubmitted",
      width: 180,
      sorter: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
      render: (_, r) => (
        <Space direction="vertical" size={2}>
          <Tooltip title="Disposal Date">
            <span style={{ fontSize: 12 }}>
              <CalendarOutlined style={{ color: "#1677ff", marginRight: 4 }} />
              {r.dateOfDisposal ? dayjs(r.dateOfDisposal).format("MM/DD/YYYY") : "—"}
            </span>
          </Tooltip>
          <Tooltip title="Date &amp; Time Submitted">
            <span style={{ fontSize: 11, color: "#888" }}>
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              {r.createdAt ? dayjs(r.createdAt).format("MM/DD/YYYY hh:mm A") : "—"}
            </span>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: (
        <span>
          <CarOutlined /> Trucks
        </span>
      ),
      key: "trucks",
      width: 70,
      render: (_, r) => r.truckCount ?? r.trucks?.length ?? 0,
    },
    {
      title: "Cell Placement",
      key: "cellPlacement",
      width: 120,
      render: (_, r) => {
        // Aggregate placement across grouped entries when present, else use the
        // per-row cellPlacement summary returned by the list API.
        let placed = 0;
        let total = 0;
        let known = false;
        const sources = Array.isArray(r.groupedEntries) && r.groupedEntries.length
          ? r.groupedEntries
          : [r];
        sources.forEach((e) => {
          const cp = e?.cellPlacement;
          if (cp && cp.known) {
            known = true;
            placed += cp.placed || 0;
            total += cp.total || 0;
          } else if (cp) {
            total += cp.total || 0;
          }
        });
        if (!known && total === 0) {
          return <Tag color="default" style={{ fontSize: 10 }}>No Waste Data</Tag>;
        }
        if (!known) {
          return <Tag color="default" style={{ fontSize: 10 }}>—</Tag>;
        }
        if (placed === 0) {
          return <Tag color="orange" style={{ fontSize: 10 }}>No Cells Assigned</Tag>;
        }
        if (placed >= total) {
          return <Tag color="green" style={{ fontSize: 10 }}>Cells Assigned</Tag>;
        }
        return <Tag color="gold" style={{ fontSize: 10 }}>{`Partial (${placed}/${total})`}</Tag>;
      },
    },
    {
      title: "Remarks",
      key: "remarks",
      width: 150,
      render: (_, r) => {
        // Computed server-side (not stored) and aggregated across grouped entries.
        const sources =
          Array.isArray(r.groupedEntries) && r.groupedEntries.length
            ? r.groupedEntries
            : [r];
        const severity = { error: 3, warning: 2, info: 1 };
        const merged = new Map();
        sources.forEach((e) => {
          (e?.remarks || []).forEach((rm) => {
            if (!rm?.text) return;
            const prev = merged.get(rm.text);
            if (!prev || (severity[rm.level] || 0) > (severity[prev] || 0)) {
              merged.set(rm.text, rm.level || "info");
            }
          });
        });
        const items = [...merged.entries()];
        if (!items.length)
          return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        const color = { error: "red", warning: "orange", info: "blue" };
        return (
          <Space size={[2, 2]} wrap>
            {items.map(([text, level]) => (
              <Tag key={text} color={color[level] || "default"} style={{ fontSize: 10, margin: 0 }}>
                {text}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 104,
      render: (val, r) => (
        <Space direction="vertical" size={2}>
          <Tag color={statusColors[val] || "default"}>
            {val?.charAt(0).toUpperCase() + val?.slice(1)}
          </Tag>
          {r.isGroupedSubmission && (
            <Tag color="geekblue" style={{ fontSize: 10 }}>
              Grouped Submission
            </Tag>
          )}
          {r.editRequested && val !== "editApproved" && val !== "reverted" && (
            <Tag color="processing" style={{ fontSize: 10 }}>
              Edit Requested
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: "Progress",
      key: "ackProgress",
      width: 120,
      render: (_, r) => {
        const prog = rowProgress[r._id];
        const acking = isActing(`${r._id}:acknowledged`);
        const rejecting = isActing(`${r._id}:rejected`);
        if (acking && prog) {
          const pct = prog.total
            ? Math.round((prog.done / prog.total) * 100)
            : 0;
          return (
            <div style={{ minWidth: 120 }}>
              <Progress
                percent={pct}
                size="small"
                status="active"
                strokeColor="#52c41a"
              />
              <Text type="secondary" style={{ fontSize: 10 }}>
                {prog.done}/{prog.total} submission{prog.total === 1 ? "" : "s"}
              </Text>
            </div>
          );
        }
        if (acking) return <Tag color="processing">Submitting…</Tag>;
        if (rejecting) return <Tag color="warning">Rejecting…</Tag>;
        if (r.status === "pending")
          return <Tag color="default">Ready</Tag>;
        if (r.status === "acknowledged")
          return <Tag color="success">Acknowledged</Tag>;
        if (r.status === "rejected")
          return <Tag color="error">Rejected</Tag>;
        return <Tag>{r.status}</Tag>;
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 128,
      render: (_, r) => {
        return (
          <Space size={4} wrap>
            {r.isGroupedSubmission ? (
              <Tooltip title="View Group Entries">
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  style={{ borderColor: ACCENT, color: ACCENT }}
                  onClick={() => openGroupedEntriesModal(r)}
                />
              </Tooltip>
            ) : (
              <Tooltip title="View Details">
                <Button
                  size="small"
                  icon={<EyeOutlined />}
                  style={{ borderColor: ACCENT, color: ACCENT }}
                  onClick={() => openView(r)}
                />
              </Tooltip>
            )}
            {getTxnHistoryKey(r) && (
              <Tooltip title="Transaction History">
                <Button
                  size="small"
                  icon={<HistoryOutlined />}
                  style={{ borderColor: "#722ed1", color: "#722ed1" }}
                  onClick={() => openTxnHistory(getTxnHistoryKey(r))}
                />
              </Tooltip>
            )}
            {r.status === "pending" && canEdit && (
              <>
                {!r.isGroupedSubmission && (
                  <Tooltip title="Edit">
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      style={{ borderColor: ACCENT, color: ACCENT }}
                      onClick={() => openEdit(r)}
                    />
                  </Tooltip>
                )}
                <Tooltip title={r.isGroupedSubmission ? "Acknowledge all entries" : "Acknowledge"}>
                  <Button
                    size="small"
                    icon={<CheckOutlined />}
                    style={{ borderColor: "#52c41a", color: "#52c41a" }}
                    loading={isActing(`${r._id}:acknowledged`)}
                    onClick={() => updateStatus(r, "acknowledged")}
                  />
                </Tooltip>
                <Tooltip title="Reject">
                  <Button
                    size="small"
                    danger
                    icon={<CloseOutlined />}
                    loading={isActing(`${r._id}:rejected`)}
                    onClick={() => updateStatus(r, "rejected")}
                  />
                </Tooltip>
              </>
            )}
            {r.status !== "reverted" && r.status !== "pending" && canEdit && (
              <Tooltip title="Revert Submission">
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  style={{ borderColor: "#fa541c", color: "#fa541c" }}
                  onClick={() => {
                    setRevertModal({ open: true, record: r });
                    setRevertReason("");
                  }}
                />
              </Tooltip>
            )}
            {r.editRequested &&
              r.status !== "editApproved" &&
              r.status !== "reverted" &&
              canEdit && (
                <>
                  <Tooltip title="Approve Edit Request">
                    <Button
                      size="small"
                      icon={<CheckOutlined />}
                      style={{ borderColor: "#52c41a", color: "#52c41a" }}
                      onClick={() => handleApproveEdit(r._id)}
                    />
                  </Tooltip>
                  <Tooltip title="Reject Edit Request">
                    <Button
                      size="small"
                      danger
                      icon={<CloseOutlined />}
                      onClick={() => handleRejectEdit(r._id)}
                    />
                  </Tooltip>
                </>
              )}
            {canDelete && (
              <Popconfirm
                title="Delete this submission?"
                description="This action cannot be undone."
                onConfirm={() => handleDelete(r._id)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Tooltip title="Delete">
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ].map(wrapColumn);

  return (
    <div>
      <Card style={{ marginTop: 0, borderRadius: 10 }}>
        <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <Input
            placeholder="Search by ID, company, or email..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 400 }}
            allowClear
          />
          <Select
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setSelectedRowKeys([]);
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
            style={{ width: "100%", maxWidth: 160 }}
          >
            <Option value="all">All Statuses</Option>
            <Option value="pending">Pending</Option>
            <Option value="acknowledged">Acknowledged</Option>
            <Option value="rejected">Rejected</Option>
            <Option value="reverted">Reverted</Option>
            <Option value="editApproved">Edit Approved</Option>
          </Select>
          <Select
            value={cellPlacementFilter}
            onChange={(value) => {
              setCellPlacementFilter(value);
              setSelectedRowKeys([]);
              setPagination((prev) => ({ ...prev, current: 1 }));
            }}
            style={{ width: "100%", maxWidth: 190 }}
          >
            <Option value="all">All Cell Placement</Option>
            <Option value="assigned">Cells Assigned</Option>
            <Option value="partial">Partial</Option>
            <Option value="none">No Cells Assigned</Option>
            <Option value="nowaste">No Waste Data</Option>
          </Select>
          <Tag color="geekblue" style={{ padding: "4px 8px", fontSize: 12 }}>
            {entryTotal.toLocaleString()} submissions · {pagination.total.toLocaleString()} grouped rows
          </Tag>
          {canRepairIds && (
            <Button
              icon={<ToolOutlined />}
              loading={repairingXX || (idFixPreview.open && idFixPreview.type === "xx")}
              danger
              onClick={() => openIdFixPreview("xx")}
            >
              Fix XX IDs
            </Button>
          )}
          {canRepairIds && (
            <Button
              icon={<IdcardOutlined />}
              loading={repairingType || (idFixPreview.open && idFixPreview.type === "type")}
              onClick={() => openIdFixPreview("type")}
            >
              Fix PVT/LGU IDs
            </Button>
          )}
          {isDeveloper && (
            <Button
              icon={<MergeCellsOutlined />}
              onClick={() => setMergeSlfOpen(true)}
              type="primary"
            >
              Merge SLF
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchData({ force: true })}
            loading={loading}
            type="primary"
          />
          <Button
            icon={<DownloadOutlined />}
            type="primary"
            loading={exportingSubmissions}
            onClick={handleExportSubmissions}
          >
            Export All Filtered Excel
          </Button>
          {selectedRowKeys.length > 0 && (
            <>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                style={{ background: "#52c41a", borderColor: "#52c41a" }}
                loading={bulkAcknowledgeLoading}
                onClick={handleBulkAcknowledge}
              >
                Acknowledge ({selectedEntryIds.length})
              </Button>
              {canEdit && (
                <Button
                  icon={<UndoOutlined />}
                  onClick={handleBulkRevert}
                  type="primary"
                  danger
                >
                  Revert
                </Button>
              )}
              {canDelete && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleBulkDelete}
                  type="primary"
                >
                  Delete
                </Button>
              )}
            </>
          )}
        </Space>

        <ResponsiveTable
          dataSource={filteredTableRows}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 1180, y: 640 }}
          virtual
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            columnWidth: 42,
          }}
        />
        {/* Server-side pagination: `data` holds only the current page's groups,
            so pagination is driven here (not by the Table's client slicing).
            Mirrors the Cell Waste Placement tab's pattern. */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <Pagination
            current={pagination.current}
            pageSize={pagination.pageSize}
            total={pagination.total}
            showSizeChanger
            pageSizeOptions={["15", "25", "50", "100"]}
            showTotal={(total, range) =>
              `${range[0]}-${range[1]} of ${total.toLocaleString()} grouped row${total === 1 ? "" : "s"} · ${entryTotal.toLocaleString()} submission${entryTotal === 1 ? "" : "s"}`
            }
            onChange={(nextPage, nextPageSize) => {
              setSelectedRowKeys([]);
              setPagination((prev) => ({
                ...prev,
                // Reset to page 1 when page size changes so we never land past the end.
                current: nextPageSize !== prev.pageSize ? 1 : nextPage,
                pageSize: nextPageSize || prev.pageSize,
              }));
            }}
          />
        </div>
      </Card>

      <Modal
        title={
          groupedEntriesRecord ? (
            <Space>
              <EyeOutlined style={{ color: ACCENT }} />
              <span>Grouped Entries</span>
              <Tag color="geekblue" style={{ margin: 0 }}>
                {groupedEntriesRecord.groupedEntries?.length || 0} item(s)
              </Tag>
            </Space>
          ) : (
            "Grouped Entries"
          )
        }
        open={!!groupedEntriesRecord}
        onCancel={() => setGroupedEntriesRecord(null)}
        footer={
          <Button type="primary" onClick={() => setGroupedEntriesRecord(null)}>
            Close
          </Button>
        }
        width="min(960px, 96vw)"
        centered
        // Scroll long content INSIDE the modal so it never overflows the viewport;
        // the title and footer (Close) stay fixed and accessible.
        styles={{ body: { maxHeight: "72vh", overflowY: "auto", overflowX: "hidden" } }}
        destroyOnHidden
      >
        {groupedEntriesRecord && (
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <div
              style={{
                background: isDark ? "rgba(24,144,255,0.08)" : "#f0f5ff",
                border: isDark
                  ? "1px solid rgba(24,144,255,0.25)"
                  : "1px solid #adc6ff",
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <Text strong style={{ fontSize: 13, display: "block" }}>
                {groupedEntriesRecord.lguCompanyName || "Grouped submissions"}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Review each individual submission entry and use the available
                actions below.
              </Text>
            </div>

            {/* Summary tiles — uniform equal-height cards in a responsive grid.
                CSS grid with align-items:stretch keeps every tile the same height
                regardless of content length; each tile shares one radius/padding
                and a fixed-height header label so values line up. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 10,
              }}
            >
              {(() => {
                const wasteValue = groupedSummary.unit === "tons" ? groupedSummary.tons : groupedSummary.m3;
                const tileBody = { padding: "10px 12px", height: "100%", display: "flex", flexDirection: "column" };
                const tileStyle = { borderRadius: 10, height: "100%" };
                const label = (t) => <Text type="secondary" style={{ fontSize: 11, display: "block", minHeight: 16 }}>{t}</Text>;
                return (
                  <>
                    <Card size="small" style={tileStyle} styles={{ body: tileBody }}>
                      {label("Total Entries")}
                      <div style={{ fontSize: 20, fontWeight: 700, color: ACCENT, wordBreak: "break-word" }}>
                        {groupedSummary.totalEntries}
                      </div>
                    </Card>
                    <Card size="small" style={tileStyle} styles={{ body: tileBody }}>
                      {label("Assigned Cell(s)")}
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#13c2c2" }}>
                        {groupedSummary.cells.length || "—"}
                      </div>
                      {groupedSummary.cells.length > 0 && (
                        <div style={{ marginTop: 2 }}>
                          {groupedSummary.cells.slice(0, 4).map((c) => (
                            <Tag key={c} color="cyan" style={{ margin: "2px 2px 0 0", fontSize: 10, maxWidth: "100%", whiteSpace: "normal", wordBreak: "break-word" }}>{c}</Tag>
                          ))}
                          {groupedSummary.cells.length > 4 && (
                            <Tag style={{ fontSize: 10 }}>+{groupedSummary.cells.length - 4}</Tag>
                          )}
                        </div>
                      )}
                    </Card>
                    <Card size="small" style={tileStyle} styles={{ body: tileBody }}>
                      {label("Total Waste Volume")}
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#722ed1", wordBreak: "break-word" }}>
                        {wasteValue > 0 ? `${Math.round(wasteValue).toLocaleString()} ${groupedSummary.unit}` : "—"}
                      </div>
                    </Card>
                    <Card size="small" style={tileStyle} styles={{ body: tileBody }}>
                      {label("Status Summary")}
                      <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 2 }}>
                        {Object.entries(groupedSummary.statusCounts).map(([s, n]) => (
                          <Tag key={s} color={statusColors[s] || "default"} style={{ margin: 0, whiteSpace: "normal", wordBreak: "break-word" }}>
                            {s}: {n}
                          </Tag>
                        ))}
                      </div>
                    </Card>
                  </>
                );
              })()}
            </div>

            {/* Simple status distribution visual */}
            {groupedSummary.totalEntries > 0 && (
              <div>
                {Object.entries(groupedSummary.statusCounts).map(([s, n]) => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <Text style={{ fontSize: 11, width: 96, textTransform: "capitalize" }}>{s}</Text>
                    <Progress
                      percent={Math.round((n / groupedSummary.totalEntries) * 100)}
                      size="small"
                      strokeColor={statusHex[s] || "#8c8c8c"}
                      style={{ flex: 1, margin: 0 }}
                    />
                  </div>
                ))}
              </div>
            )}

            <Table
              className="portal-user-wrap-table"
              size="small"
              rowKey="_id"
              dataSource={groupedEntriesRecord.groupedEntries || []}
              pagination={
                (groupedEntriesRecord.groupedEntries || []).length > 10
                  ? withSizeChanger({ pageSize: 10, size: "small" })
                  : false
              }
              scroll={{ y: 360 }}
              columns={[
                {
                  title: "ID No.",
                  key: "idNo",
                  render: (_, entry, index) => {
                    // #6B: a resubmitted record (carries prior idNo in previousIdNos)
                    // is badged and shows its original reference for traceability.
                    const isResub =
                      entry.isResubmission ||
                      (Array.isArray(entry.previousIdNos) && entry.previousIdNos.length > 0);
                    const origRef = Array.isArray(entry.previousIdNos) && entry.previousIdNos.length
                      ? entry.previousIdNos[entry.previousIdNos.length - 1]
                      : null;
                    return (
                      <Space direction="vertical" size={0}>
                        <Space size={4} wrap>
                          <Text strong style={{ fontSize: 12 }}>
                            {entry.idNo || entry.submissionId || `Submission ${index + 1}`}
                          </Text>
                          {isResub && (
                            <Tooltip title={origRef ? `Resubmitted — was ${origRef}` : "Resubmitted after revert"}>
                              <Tag color="gold" style={{ fontSize: 9, margin: 0, lineHeight: "16px" }}>
                                <ReloadOutlined /> Resubmission
                              </Tag>
                            </Tooltip>
                          )}
                        </Space>
                        <Text type="secondary" style={{ fontSize: 10 }}>
                          {dayjs(entry.createdAt || entry.dateOfDisposal).format("MM/DD/YYYY hh:mm A")}
                        </Text>
                      </Space>
                    );
                  },
                },
                {
                  title: "Trucks",
                  key: "trucks",
                  width: 64,
                  align: "center",
                  render: (_, entry) => (
                    <Text style={{ fontSize: 12 }}>
                      {entry.truckCount ?? entry.trucks?.length ?? 0}
                    </Text>
                  ),
                },
                {
                  title: "Assigned Cell",
                  key: "cell",
                  width: 150,
                  render: (_, entry) => {
                    const cells = entry.cellNames && entry.cellNames.length
                      ? entry.cellNames
                      : [...new Set(
                          (entry.trucks || []).flatMap((t) => [
                            t.cellName,
                            ...(t.vehicles || []).map((v) => v.cellName),
                          ]).filter(Boolean),
                        )];
                    if (!cells.length) {
                      return <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>Unassigned</Tag>;
                    }
                    return (
                      <Space size={2} wrap>
                        {cells.map((c) => (
                          <Tag key={c} color="cyan" style={{ fontSize: 10, margin: 0 }}>{c}</Tag>
                        ))}
                      </Space>
                    );
                  },
                },
                {
                  title: "Status",
                  key: "status",
                  width: 110,
                  render: (_, entry) => (
                    <Tag color={statusColors[entry.status] || "default"} style={{ margin: 0 }}>
                      {entry.status}
                    </Tag>
                  ),
                },
                {
                  title: "Actions",
                  key: "actions",
                  width: 150,
                  render: (_, entry) => (
                    <Space size={4} wrap>
                      <Tooltip title="View">
                        <Button size="small" icon={<EyeOutlined />} onClick={() => openGroupedEntryDetail(entry)} />
                      </Tooltip>
                      {entry.status === "pending" && canEdit && (
                        <Tooltip title="Edit">
                          <Button
                            size="small"
                            icon={<EditOutlined />}
                            style={{ borderColor: ACCENT, color: ACCENT }}
                            onClick={() => {
                              setGroupedEntriesRecord(null);
                              openEdit(entry);
                            }}
                          />
                        </Tooltip>
                      )}
                      {entry.status === "pending" && (
                        <>
                          <Tooltip title="Acknowledge">
                            <Button
                              size="small"
                              type="primary"
                              icon={<CheckOutlined />}
                              style={{ background: "#52c41a", borderColor: "#52c41a" }}
                              loading={isActing(`${entry._id}:acknowledged`)}
                              onClick={() => handleGroupedEntryStatus(groupedEntriesRecord, entry, "acknowledged")}
                            />
                          </Tooltip>
                          <Tooltip title="Reject">
                            <Button
                              size="small"
                              danger
                              icon={<CloseOutlined />}
                              loading={isActing(`${entry._id}:rejected`)}
                              onClick={() => handleGroupedEntryStatus(groupedEntriesRecord, entry, "rejected")}
                            />
                          </Tooltip>
                        </>
                      )}
                      {entry.status !== "reverted" && entry.status !== "pending" && canEdit && (
                        <Tooltip title="Revert">
                          <Button
                            size="small"
                            icon={<UndoOutlined />}
                            style={{ borderColor: "#fa541c", color: "#fa541c" }}
                            onClick={() => {
                              setGroupedEntriesRecord(null);
                              setRevertModal({ open: true, record: entry });
                              setRevertReason("");
                            }}
                          />
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
          </Space>
        )}
      </Modal>

      {/* ── View Modal ── */}
      <Modal
        title={null}
        open={!!viewRecord}
        onCancel={() => setViewRecord(null)}
        footer={
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              {viewRecord?.status !== "reverted" &&
                viewRecord?.status !== "pending" && (
                  <Button
                    icon={<UndoOutlined />}
                    style={{ color: "#fa541c", borderColor: "#fa541c" }}
                    onClick={() => {
                      setViewRecord(null);
                      setRevertModal({ open: true, record: viewRecord });
                      setRevertReason("");
                    }}
                  >
                    Revert
                  </Button>
                )}
            </div>
            <Space>
              {viewRecord?.status === "pending" &&
                !viewRecord?.isGroupedSubmission && (
                  <>
                    <Button
                      icon={<EditOutlined />}
                      style={{ borderColor: ACCENT, color: ACCENT }}
                      onClick={() => {
                        setViewRecord(null);
                        openEdit(viewRecord);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      style={{ background: "#52c41a", borderColor: "#52c41a" }}
                      loading={
                        isActing(`${viewRecord._id}:acknowledged`)
                      }
                      onClick={() => {
                        updateStatus(viewRecord, "acknowledged");
                        setViewRecord(null);
                      }}
                    >
                      Acknowledge
                    </Button>
                    <Button
                      danger
                      icon={<CloseOutlined />}
                      loading={isActing(`${viewRecord._id}:rejected`)}
                      onClick={() => {
                        updateStatus(viewRecord, "rejected");
                        setViewRecord(null);
                      }}
                    >
                      Reject
                    </Button>
                  </>
                )}
              <Button type="primary" onClick={() => setViewRecord(null)}>
                Close
              </Button>
            </Space>
          </div>
        }
        width={SUBMISSION_MODAL_WIDTH}
        style={{ maxWidth: "95vw" }}
        styles={{ body: { padding: 0 } }}
      >
        {viewRecord &&
          (() => {
            const r = viewRecord;
            const totalVolumeSummary = getSubmissionVolumeSummary(r) || "0";
            return (
              <div>
                {/* Header Banner */}
                <div
                  style={{
                    background: `linear-gradient(135deg, ${ACCENT} 0%, #1d39c4 100%)`,
                    padding: "20px 24px 16px",
                    borderRadius: "8px 8px 0 0",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.6)",
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        Submission
                      </Text>
                      <div style={{ marginTop: 2 }}>
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 20,
                            fontWeight: 700,
                          }}
                        >
                          {r.isGroupedSubmission
                            ? `${r.entryCount} Grouped Submissions`
                            : r.idNo}
                        </Text>
                      </div>
                      <Text
                        style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}
                      >
                        {r.lguCompanyName} &middot;{" "}
                        {r.dateOfDisposal
                          ? dayjs(r.dateOfDisposal).format("MM/DD/YYYY")
                          : "No date"}
                      </Text>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <Tag
                        color={statusColors[r.status] || "default"}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "2px 10px",
                        }}
                      >
                        {r.status?.charAt(0).toUpperCase() + r.status?.slice(1)}
                      </Tag>
                      <div style={{ marginTop: 6 }}>
                        <Text
                          style={{
                            color: "rgba(255,255,255,0.5)",
                            fontSize: 11,
                          }}
                        >
                          {r.createdAt
                            ? dayjs(r.createdAt).format("MM/DD/YYYY hh:mm A")
                            : ""}
                        </Text>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ padding: "20px 24px" }}>
                  {/* Stats Row */}
                  <Row gutter={12} style={{ marginBottom: 20 }}>
                    <Col xs={8}>
                      <div
                        style={{
                          background: isDark
                            ? "rgba(47,84,235,0.1)"
                            : "#f0f5ff",
                          borderRadius: 8,
                          padding: "12px 14px",
                          border: isDark
                            ? "1px solid rgba(47,84,235,0.3)"
                            : "1px solid #d6e4ff",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            color: isDark
                              ? "rgba(255,255,255,0.65)"
                              : "rgba(0,0,0,0.45)",
                          }}
                        >
                          Company Type
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Tag
                            color={r.companyType === "LGU" ? "blue" : "purple"}
                            style={{ margin: 0, fontWeight: 600 }}
                          >
                            {r.companyType}
                          </Tag>
                        </div>
                      </div>
                    </Col>
                    <Col xs={8}>
                      <div
                        style={{
                          background: isDark
                            ? "rgba(82,196,26,0.1)"
                            : "#f6ffed",
                          borderRadius: 8,
                          padding: "12px 14px",
                          border: isDark
                            ? "1px solid rgba(82,196,26,0.3)"
                            : "1px solid #d9f7be",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            color: isDark
                              ? "rgba(255,255,255,0.65)"
                              : "rgba(0,0,0,0.45)",
                          }}
                        >
                          Truck Entries
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{
                              fontSize: 18,
                              color: isDark ? "#73d13d" : "#52c41a",
                            }}
                          >
                            {r.trucks?.length || 0}
                          </Text>
                        </div>
                      </div>
                    </Col>
                    <Col xs={8}>
                      <div
                        style={{
                          background: isDark
                            ? "rgba(250,173,20,0.1)"
                            : "#fff7e6",
                          borderRadius: 8,
                          padding: "12px 14px",
                          border: isDark
                            ? "1px solid rgba(250,173,20,0.3)"
                            : "1px solid #ffe7ba",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                            color: isDark
                              ? "rgba(255,255,255,0.65)"
                              : "rgba(0,0,0,0.45)",
                          }}
                        >
                          Total Volume
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{
                              fontSize: 14,
                              color: isDark ? "#ffc53d" : "#fa8c16",
                            }}
                          >
                            {totalVolumeSummary}
                          </Text>
                        </div>
                      </div>
                    </Col>
                  </Row>
                  <Collapse
                    defaultActiveKey={["submission", "trucks"]}
                    bordered={false}
                    size="small"
                    style={{ background: "transparent" }}
                    items={[
                      {
                        key: "submission",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <IdcardOutlined
                              style={{ color: ACCENT, marginRight: 6 }}
                            />
                            Submission Details
                          </Text>
                        ),
                        children: (
                          <Row gutter={16}>
                            <Col xs={12}>
                              <div style={{ marginBottom: 12 }}>
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 11,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                    display: "block",
                                    marginBottom: 2,
                                  }}
                                >
                                  SLF Facility
                                </Text>
                                <Text strong style={{ fontSize: 13 }}>
                                  {r.slfName || r.slfGenerator?.slfName || "—"}
                                </Text>
                              </div>
                            </Col>
                            <Col xs={12}>
                              <div style={{ marginBottom: 12 }}>
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 11,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                    display: "block",
                                    marginBottom: 2,
                                  }}
                                >
                                  Date of Disposal
                                </Text>
                                <Text strong style={{ fontSize: 13 }}>
                                  {r.dateOfDisposal
                                    ? dayjs(r.dateOfDisposal).format(
                                        "MMM DD, YYYY",
                                      )
                                    : "—"}
                                </Text>
                              </div>
                            </Col>
                            <Col xs={12}>
                              <div style={{ marginBottom: 12 }}>
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 11,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                    display: "block",
                                    marginBottom: 2,
                                  }}
                                >
                                  Submitted By
                                </Text>
                                <Text strong style={{ fontSize: 13 }}>
                                  {r.submittedBy || "—"}
                                </Text>
                              </div>
                            </Col>
                            <Col xs={12}>
                              <div style={{ marginBottom: 12 }}>
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 11,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                    display: "block",
                                    marginBottom: 2,
                                  }}
                                >
                                  Submitted At
                                </Text>
                                <Text strong style={{ fontSize: 13 }}>
                                  {r.createdAt
                                    ? dayjs(r.createdAt).format(
                                        "MMM DD, YYYY hh:mm A",
                                      )
                                    : "—"}
                                </Text>
                              </div>
                            </Col>
                            <Col xs={24}>
                              <div style={{ marginBottom: 12 }}>
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 11,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.4,
                                    display: "block",
                                    marginBottom: 2,
                                  }}
                                >
                                  Company & Address
                                </Text>
                                <Text strong style={{ fontSize: 13 }}>
                                  {r.lguCompanyName}
                                </Text>
                                {r.address && (
                                  <Text
                                    type="secondary"
                                    style={{ fontSize: 12, display: "block" }}
                                  >
                                    {r.address}
                                  </Text>
                                )}
                              </div>
                            </Col>
                            {(r.companyRegion ||
                              r.companyProvince ||
                              r.companyMunicipality ||
                              r.companyBarangay) && (
                              <>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      Region
                                    </Text>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {resolvedAddr.region ||
                                        r.companyRegion ||
                                        "—"}
                                    </Text>
                                  </div>
                                </Col>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      Province
                                    </Text>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {resolvedAddr.province ||
                                        r.companyProvince ||
                                        "—"}
                                    </Text>
                                  </div>
                                </Col>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      City / Municipality
                                    </Text>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {resolvedAddr.municipality ||
                                        r.companyMunicipality ||
                                        "—"}
                                    </Text>
                                  </div>
                                </Col>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      Barangay
                                    </Text>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {resolvedAddr.barangay ||
                                        r.companyBarangay ||
                                        "—"}
                                    </Text>
                                  </div>
                                </Col>
                              </>
                            )}
                          </Row>
                        ),
                      },
                      {
                        key: "baseline",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <DatabaseOutlined
                              style={{ color: "#722ed1", marginRight: 6 }}
                            />
                            Baseline Information
                          </Text>
                        ),
                        children: (() => {
                          const hasAC = (r.activeCellEntries || []).length > 0;
                          const hasCC = (r.closedCellEntries || []).length > 0;
                          const cellTableCols = [
                            {
                              title: "#",
                              key: "i",
                              width: 40,
                              render: (_, __, i) => (
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {i + 1}
                                </Text>
                              ),
                            },
                            {
                              title: "Cell Name",
                              dataIndex: "cellName",
                              render: (v) => (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    whiteSpace: "normal",
                                    overflowWrap: "anywhere",
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {v || "—"}
                                </Text>
                              ),
                            },
                            {
                              title: "Waste Type",
                              dataIndex: "wasteType",
                              width: 120,
                              render: (v) => (
                                <Tag
                                  color={
                                    v === "Residual"
                                      ? "blue"
                                      : v === "Inert"
                                        ? "green"
                                        : /hazardous/i.test(v || "")
                                          ? "red"
                                          : "default"
                                  }
                                  bordered={false}
                                  style={{ fontSize: 10, whiteSpace: "normal" }}
                                >
                                  {v || "—"}
                                </Tag>
                              ),
                            },
                            {
                              title: "Volume",
                              dataIndex: "volume",
                              width: 140,
                              render: (v, row) => (
                                <Text strong style={{ fontSize: 11 }}>
                                  {v != null
                                    ? `${Number(v).toLocaleString()} ${(row.unit || r.baselineUnit || "m³").replace("m3", "m³")}`
                                    : "—"}
                                </Text>
                              ),
                            },
                          ];
                          return (
                            <div>
                              {/* Total Volume */}
                              <Row gutter={16} style={{ marginBottom: 8 }}>
                                <Col xs={12}>
                                  <Text
                                    type="secondary"
                                    style={{
                                      fontSize: 11,
                                      textTransform: "uppercase",
                                      letterSpacing: 0.4,
                                      display: "block",
                                      marginBottom: 2,
                                    }}
                                  >
                                    Total Volume Accepted
                                  </Text>
                                  <Text strong style={{ fontSize: 13 }}>
                                    {r.totalVolumeAccepted != null
                                      ? `${r.totalVolumeAccepted.toLocaleString()} ${(r.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
                                      : "—"}
                                  </Text>
                                </Col>
                              </Row>

                              {/* #4: Active Cell + Closed Cell (Legacy) tables moved
                                  into collapsible panels, COLLAPSED by default. Data is
                                  already on `r` (no refetch on toggle); each panel keeps
                                  its own open/closed state independently. */}
                              {(() => {
                                const legacyBlock = (rows) => (
                                  <Row gutter={8}>
                                    {rows.map(([label, val, unit]) => (
                                      <Col key={label} xs={12}>
                                        <Text type="secondary" style={{ fontSize: 11, display: "block" }}>
                                          {label}
                                        </Text>
                                        <Text strong style={{ fontSize: 13 }}>
                                          {val != null
                                            ? `${val.toLocaleString()} ${(unit || "m³").replace("m3", "m³")}`
                                            : "—"}
                                        </Text>
                                      </Col>
                                    ))}
                                  </Row>
                                );
                                return (
                                  <Collapse
                                    size="small"
                                    bordered={false}
                                    defaultActiveKey={[]}
                                    style={{ marginBottom: 14, background: "transparent" }}
                                    items={[
                                      {
                                        key: "active-cell",
                                        label: (
                                          <Text strong style={{ fontSize: 12, color: "#52c41a" }}>
                                            Active Cell
                                            {hasAC ? ` Entries (${r.activeCellEntries.length})` : " — Legacy"}
                                          </Text>
                                        ),
                                        children: hasAC ? (
                                          <Table
                                            dataSource={r.activeCellEntries}
                                            rowKey={(e, i) => e?._id || `active-${i}`}
                                            size="small"
                                            pagination={false}
                                            columns={cellTableCols}
                                            scroll={{ x: "max-content" }}
                                            style={{ fontSize: 11 }}
                                          />
                                        ) : (
                                          legacyBlock([
                                            ["Residual", r.activeCellResidualVolume, r.activeCellResidualUnit],
                                            ["Inert", r.activeCellInertVolume, r.activeCellInertUnit],
                                            ["Hazardous", r.activeCellHazardousVolume, r.activeCellHazardousUnit],
                                          ])
                                        ),
                                      },
                                      {
                                        key: "closed-cell",
                                        label: (
                                          <Text strong style={{ fontSize: 12, color: "#fa8c16" }}>
                                            Closed Cell
                                            {hasCC ? ` Entries (${r.closedCellEntries.length})` : " — Legacy"}
                                          </Text>
                                        ),
                                        children: hasCC ? (
                                          <Table
                                            dataSource={r.closedCellEntries}
                                            rowKey={(e, i) => e?._id || `closed-${i}`}
                                            size="small"
                                            pagination={false}
                                            columns={cellTableCols}
                                            scroll={{ x: "max-content" }}
                                            style={{ fontSize: 11 }}
                                          />
                                        ) : (
                                          legacyBlock([
                                            ["Residual", r.closedCellResidualVolume, r.closedCellResidualUnit],
                                            ["Inert", r.closedCellInertVolume, r.closedCellInertUnit],
                                            ["Hazardous", r.closedCellHazardousVolume, r.closedCellHazardousUnit],
                                          ])
                                        ),
                                      },
                                    ]}
                                  />
                                );
                              })()}

                              {/* Haulers */}
                              {r.accreditedHaulers?.length > 0 && (
                                <>
                                  <Divider style={{ margin: "4px 0 12px" }} />
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      marginBottom: 10,
                                    }}
                                  >
                                    <TeamOutlined
                                      style={{ color: "#52c41a", fontSize: 14 }}
                                    />
                                    <Text
                                      strong
                                      style={{
                                        fontSize: 13,
                                        color: isDark ? "#e8e8e8" : "#262626",
                                      }}
                                    >
                                      Accredited Haulers (
                                      {r.accreditedHaulers.length})
                                    </Text>
                                  </div>
                                  <Table
                                    dataSource={r.accreditedHaulers}
                                    // #4: stable key from the hauler id where available.
                                    rowKey={(h, i) => h?._id || `${h?.haulerName || "hauler"}-${i}`}
                                    size="small"
                                    pagination={false}
                                    style={{ fontSize: 11 }}
                                    // #4: fixed widths + ellipsis keep the table (and its
                                    // nested vehicle table) inside the modal; horizontal
                                    // scroll only kicks in on very narrow widths.
                                    scroll={{ x: 720 }}
                                    expandable={{
                                      expandedRowRender: (h) => {
                                        const vehicles =
                                          h.vehicles?.length > 0
                                            ? h.vehicles
                                            : h.plateNumber ||
                                                h.vehicleType ||
                                                h.capacity != null
                                              ? [
                                                  {
                                                    plateNumber: h.plateNumber,
                                                    vehicleType: h.vehicleType,
                                                    capacity: h.capacity,
                                                    capacityUnit:
                                                      h.capacityUnit,
                                                  },
                                                ]
                                              : [];
                                        return vehicles.length > 0 ? (
                                          <Table
                                            dataSource={vehicles}
                                            rowKey={(v, vi) => v?._id || `${v?.plateNumber || "veh"}-${vi}`}
                                            size="small"
                                            pagination={false}
                                            style={{ fontSize: 11 }}
                                            scroll={{ x: 430 }}
                                            columns={[
                                              {
                                                title: "#",
                                                key: "idx",
                                                width: 40,
                                                render: (_, __, vi) => vi + 1,
                                              },
                                              {
                                                title: "Plate Number",
                                                dataIndex: "plateNumber",
                                                key: "plate",
                                                width: 130,
                                                ellipsis: true,
                                                render: (v) => v || "—",
                                              },
                                              {
                                                title: "Vehicle Type",
                                                dataIndex: "vehicleType",
                                                key: "type",
                                                width: 140,
                                                ellipsis: true,
                                                render: (v) => v || "—",
                                              },
                                              {
                                                title: "Capacity",
                                                key: "cap",
                                                width: 120,
                                                render: (_, v) =>
                                                  v.capacity != null
                                                    ? `${v.capacity} ${(v.capacityUnit || "m³").replace("m3", "m³")}`
                                                    : "—",
                                              },
                                            ]}
                                          />
                                        ) : (
                                          <Text type="secondary">
                                            No vehicle details
                                          </Text>
                                        );
                                      },
                                      rowExpandable: () => true,
                                    }}
                                    columns={[
                                      {
                                        title: "Hauler Name",
                                        dataIndex: "haulerName",
                                        key: "haulerName",
                                        width: 200,
                                        ellipsis: { showTitle: false },
                                        render: (v) => (
                                          <Tooltip title={v}>
                                            <Text strong>{v || "—"}</Text>
                                          </Tooltip>
                                        ),
                                      },
                                      {
                                        // #6: Hauler Clients immediately after Hauler Name.
                                        title: "Hauler Clients",
                                        dataIndex: "privateSectorClients",
                                        key: "privateSectorClients",
                                        width: 220,
                                        ellipsis: { showTitle: false },
                                        render: (v) => {
                                          const list = normalizeClientList(v);
                                          if (!list.length) return <Text type="secondary">—</Text>;
                                          const text = list.join(", ");
                                          return <Tooltip title={text}>{text}</Tooltip>;
                                        },
                                      },
                                      {
                                        title: "No. of Trucks",
                                        dataIndex: "numberOfTrucks",
                                        key: "numberOfTrucks",
                                        width: 110,
                                        align: "center",
                                        render: (v) => v ?? "—",
                                      },
                                      {
                                        title: "Office Address",
                                        dataIndex: "officeAddress",
                                        key: "officeAddress",
                                        ellipsis: { showTitle: false },
                                        render: (v) => (
                                          <Tooltip title={v}>{v || "—"}</Tooltip>
                                        ),
                                      },
                                    ]}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })(),
                      },
                      {
                        key: "operations",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <PieChartOutlined
                              style={{ color: "#13c2c2", marginRight: 6 }}
                            />
                            SLF Facility Operations
                          </Text>
                        ),
                        children: (() => {
                          const fac = r.slfGenerator || {};
                          const cellCount = fac.numberOfCell || 0;
                          const facilityCapacity = fac.volumeCapacity || 0;
                          const baselineVol = r.totalVolumeAccepted || 0;
                          const truckVol = (r.trucks || []).reduce(
                            (s, t) => s + (t.actualVolume || 0),
                            0,
                          );
                          const filledVol = baselineVol + truckVol;
                          const pct =
                            facilityCapacity > 0
                              ? Math.min(
                                  Math.round(
                                    (filledVol / facilityCapacity) * 100,
                                  ),
                                  100,
                                )
                              : 0;
                          return (
                            <div>
                              <Row gutter={16}>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      Current Cell Volume
                                    </Text>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {r.currentCellVolume != null
                                        ? `${r.currentCellVolume.toLocaleString()} ${(r.currentCellVolumeUnit || "m³").replace("m3", "m³")}`
                                        : "—"}
                                    </Text>
                                  </div>
                                </Col>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      Cell Status
                                    </Text>
                                    <Tag
                                      color={
                                        r.cellStatus === "Closed"
                                          ? "red"
                                          : "green"
                                      }
                                      bordered={false}
                                      style={{ margin: 0 }}
                                    >
                                      {r.cellStatus || "Active"}
                                    </Tag>
                                  </div>
                                </Col>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      Number of Cells
                                    </Text>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {cellCount || "—"}
                                    </Text>
                                  </div>
                                </Col>
                                <Col xs={12}>
                                  <div style={{ marginBottom: 12 }}>
                                    <Text
                                      type="secondary"
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                        display: "block",
                                        marginBottom: 2,
                                      }}
                                    >
                                      Facility Capacity
                                    </Text>
                                    <Text strong style={{ fontSize: 13 }}>
                                      {facilityCapacity > 0
                                        ? `${facilityCapacity.toLocaleString()} m³`
                                        : "—"}
                                    </Text>
                                  </div>
                                </Col>
                              </Row>
                              <Divider style={{ margin: "4px 0 16px" }} />
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 24,
                                }}
                              >
                                <Progress
                                  type="dashboard"
                                  percent={pct}
                                  size={120}
                                  strokeColor={
                                    pct >= 90
                                      ? "#ff4d4f"
                                      : pct >= 70
                                        ? "#faad14"
                                        : "#52c41a"
                                  }
                                  format={() => (
                                    <div
                                      style={{
                                        textAlign: "center",
                                        lineHeight: 1.3,
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontSize: 18,
                                          fontWeight: 700,
                                          color:
                                            pct >= 90
                                              ? "#ff4d4f"
                                              : pct >= 70
                                                ? "#faad14"
                                                : "#52c41a",
                                        }}
                                      >
                                        {pct}%
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 10,
                                          color: isDark ? "#a0a0a0" : "#8c8c8c",
                                        }}
                                      >
                                        filled
                                      </div>
                                    </div>
                                  )}
                                />
                                <div style={{ flex: 1 }}>
                                  <Text
                                    strong
                                    style={{
                                      fontSize: 13,
                                      display: "block",
                                      marginBottom: 8,
                                    }}
                                  >
                                    Cell Capacity Usage
                                  </Text>
                                  <Row gutter={8}>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Baseline Volume
                                      </Text>
                                      <div>
                                        <Text style={{ fontSize: 13 }}>
                                          {baselineVol > 0
                                            ? `${baselineVol.toLocaleString()} ${(r.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{ fontSize: 11 }}
                                      >
                                        Transport & Disposal
                                      </Text>
                                      <div>
                                        <Text style={{ fontSize: 13 }}>
                                          {truckVol > 0
                                            ? totalVolumeSummary
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{
                                          fontSize: 11,
                                          marginTop: 8,
                                          display: "block",
                                        }}
                                      >
                                        Total Filled
                                      </Text>
                                      <div>
                                        <Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            color: ACCENT,
                                          }}
                                        >
                                          {filledVol > 0
                                            ? filledVol.toLocaleString()
                                            : "0"}
                                        </Text>
                                      </div>
                                    </Col>
                                    <Col xs={12}>
                                      <Text
                                        type="secondary"
                                        style={{
                                          fontSize: 11,
                                          marginTop: 8,
                                          display: "block",
                                        }}
                                      >
                                        Remaining
                                      </Text>
                                      <div>
                                        <Text
                                          strong
                                          style={{
                                            fontSize: 14,
                                            color:
                                              facilityCapacity - filledVol <= 0
                                                ? "#ff4d4f"
                                                : "#52c41a",
                                          }}
                                        >
                                          {facilityCapacity > 0
                                            ? (
                                                facilityCapacity - filledVol
                                              ).toLocaleString()
                                            : "No capacity set"}
                                        </Text>
                                      </div>
                                    </Col>
                                  </Row>
                                </div>
                              </div>
                            </div>
                          );
                        })(),
                      },
                      {
                        key: "trucks",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <CarOutlined
                              style={{ color: "#fa8c16", marginRight: 6 }}
                            />
                            Trucks ({r.trucks?.length || 0})
                          </Text>
                        ),
                        children:
                          r.trucks?.length > 0 ? (
                            <Table
                              dataSource={r.trucks}
                              // #3: stable key from an existing id where available.
                              rowKey={(t, i) =>
                                t?._id ||
                                `${t?.disposalTicketNo || ""}-${t?.plateNumber || ""}-${i}`
                              }
                              size="small"
                              className="trucks-compact-table"
                              pagination={{
                                defaultPageSize: 5,
                                pageSizeOptions: ["5", "10", "20", "50"],
                                showSizeChanger: true,
                                size: "small",
                                showTotal: (total) => `${total} truck${total === 1 ? "" : "s"}`,
                              }}
                              scroll={{ x: 820, y: 320 }}
                              columns={[
                                {
                                  title: "#",
                                  key: "idx",
                                  width: 40,
                                  render: (_, __, i) => (
                                    <Text type="secondary">{i + 1}</Text>
                                  ),
                                },
                                {
                                  title: "Ticket No.",
                                  dataIndex: "disposalTicketNo",
                                  key: "ticket",
                                  width: 110,
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Hauler",
                                  dataIndex: "hauler",
                                  key: "hauler",
                                  width: 150,
                                  ellipsis: true,
                                  render: (v) => <Text strong>{v || "—"}</Text>,
                                },
                                {
                                  // #3: Clients immediately after Hauler.
                                  title: "Clients",
                                  key: "clients",
                                  width: 180,
                                  render: (_, t) => {
                                    const clients = resolveTruckClients(t, r.accreditedHaulers);
                                    if (!clients.length) return <Text type="secondary">—</Text>;
                                    const text = clients.join(", ");
                                    return (
                                      <Tooltip title={text}>
                                        <Space size={[2, 2]} wrap style={{ maxWidth: 170 }}>
                                          {clients.slice(0, 2).map((c, ci) => (
                                            <Tag key={ci} color="purple" bordered={false} style={{ margin: 0, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                                              {c}
                                            </Tag>
                                          ))}
                                          {clients.length > 2 && <Tag bordered={false} style={{ margin: 0 }}>+{clients.length - 2}</Tag>}
                                        </Space>
                                      </Tooltip>
                                    );
                                  },
                                },
                                {
                                  title: "Plate No.",
                                  dataIndex: "plateNumber",
                                  key: "plate",
                                  width: 110,
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Capacity",
                                  key: "cap",
                                  width: 110,
                                  render: (_, t) =>
                                    t.truckCapacity
                                      ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}`
                                      : "—",
                                },
                                {
                                  title: "Volume",
                                  key: "vol",
                                  width: 120,
                                  // #3: colour reflects actual volume vs capacity
                                  // (units normalized first via the shared utility).
                                  render: (_, t) => {
                                    if (t.actualVolume == null) return "—";
                                    const unit = (t.actualVolumeUnit || t.truckCapacityUnit || "m³").replace("m3", "m³");
                                    const status = volumeCapacityStatus({
                                      actualVolume: t.actualVolume,
                                      actualVolumeUnit: t.actualVolumeUnit || t.truckCapacityUnit,
                                      capacity: t.truckCapacity,
                                      capacityUnit: t.truckCapacityUnit || t.actualVolumeUnit,
                                    });
                                    const valueEl = (
                                      <Text strong style={{ color: status.color }}>
                                        {t.actualVolume} {unit}
                                      </Text>
                                    );
                                    if (!status.comparable) return valueEl;
                                    return (
                                      <Tooltip
                                        title={
                                          <span style={{ fontSize: 12 }}>
                                            Capacity: {t.truckCapacity} {(t.truckCapacityUnit || unit).replace("m3", "m³")}
                                            <br />
                                            Actual volume: {t.actualVolume} {unit}
                                            <br />
                                            Utilization: {status.percent.toFixed(1)}%
                                          </span>
                                        }
                                      >
                                        {valueEl}
                                      </Tooltip>
                                    );
                                  },
                                },
                                {
                                  title: "Waste Type",
                                  dataIndex: "wasteType",
                                  key: "waste",
                                  render: (v) =>
                                    v ? (
                                      <Tag
                                        color={
                                          v === "Residual" ? "blue" : "volcano"
                                        }
                                        bordered={false}
                                      >
                                        {v}
                                      </Tag>
                                    ) : (
                                      "—"
                                    ),
                                },
                                {
                                  title: "Cell Placed",
                                  key: "cell",
                                  width: 110,
                                  render: (_, t) => {
                                    // Collect unique cell names from per-vehicle entries first,
                                    // then fall back to the truck-level cellName.
                                    const vehicleCells = (t.vehicles || [])
                                      .map((v) => v.cellName)
                                      .filter(Boolean);
                                    const cells = vehicleCells.length
                                      ? [...new Set(vehicleCells)]
                                      : t.cellName
                                        ? [t.cellName]
                                        : [];
                                    if (!cells.length) return <Text type="secondary">—</Text>;
                                    return (
                                      <Space size={2} wrap>
                                        {cells.map((name) => (
                                          <Tag key={name} color="cyan" bordered={false} style={{ fontSize: 11, margin: 0 }}>
                                            {name}
                                          </Tag>
                                        ))}
                                      </Space>
                                    );
                                  },
                                },
                                {
                                  title: "HW Code",
                                  key: "hw",
                                  render: (_, t) => {
                                    const codes = Array.isArray(t.hazWasteCode)
                                      ? t.hazWasteCode
                                      : t.hazWasteCode
                                        ? [t.hazWasteCode]
                                        : [];
                                    return codes.length > 0
                                      ? codes.join(", ")
                                      : "—";
                                  },
                                },
                              ]}
                            />
                          ) : (
                            <div
                              style={{ textAlign: "center", padding: "12px 0" }}
                            >
                              <Text type="secondary">No trucks recorded</Text>
                            </div>
                          ),
                      },
                    ]}
                  />

                  {/* Transaction History Button */}
                  {getTxnHistoryKey(r) && (
                    <Button
                      block
                      icon={<HistoryOutlined />}
                      style={{
                        borderColor: "#722ed1",
                        color: "#fefefe",
                        marginTop: 8,
                        marginBottom: 8,
                      }}
                      type="primary"
                      onClick={() => openTxnHistory(getTxnHistoryKey(r))}
                    >
                      View Transaction History
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: ACCENT }} />
            <span>Edit Submission — {editRecord?.idNo || ""}</span>
          </Space>
        }
        open={!!editRecord}
        onCancel={() => setEditRecord(null)}
        onOk={handleEditSave}
        okText="Save Changes"
        okButtonProps={{
          loading: editLoading,
          style: { background: ACCENT, borderColor: ACCENT },
        }}
        width={SUBMISSION_MODAL_WIDTH}
        style={{ maxWidth: "95vw" }}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" size="small">
          <Collapse
            defaultActiveKey={[
              "disposal",
              "company",
              "operations",
              "baseline",
              "trucks",
            ]}
            bordered={false}
            size="small"
            items={[
              {
                key: "disposal",
                label: (
                  <Text strong>
                    <CalendarOutlined
                      style={{ color: ACCENT, marginRight: 6 }}
                    />
                    Disposal Information
                  </Text>
                ),
                children: (
                  <Row gutter={12}>
                    {(editRecord?.slfName ||
                      editRecord?.slfGenerator?.slfName) && (
                      <Col xs={24} style={{ marginBottom: 12 }}>
                        <div
                          style={{
                            background: isDark
                              ? "rgba(47,84,235,0.1)"
                              : "#f0f5ff",
                            borderRadius: 6,
                            padding: "8px 14px",
                            border: isDark
                              ? "1px solid rgba(47,84,235,0.3)"
                              : "1px solid #d6e4ff",
                          }}
                        >
                          <Text
                            type="secondary"
                            style={{
                              fontSize: 11,
                              textTransform: "uppercase",
                              letterSpacing: 0.4,
                            }}
                          >
                            SLF Facility
                          </Text>
                          <div>
                            <Text strong style={{ fontSize: 13 }}>
                              {editRecord.slfName ||
                                editRecord.slfGenerator?.slfName}
                            </Text>
                          </div>
                        </div>
                      </Col>
                    )}
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="dateOfDisposal"
                        label={
                          <>
                            <CalendarOutlined /> Date of Disposal
                          </>
                        }
                        rules={[{ required: true }]}
                      >
                        <DatePicker
                          format="MM/DD/YYYY"
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="lguCompanyName"
                        label={
                          <>
                            <BankOutlined /> LGU/Company Name
                          </>
                        }
                        rules={[{ required: true }]}
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="companyType"
                        label="Company Type"
                        rules={[{ required: true }]}
                      >
                        <Select placeholder="Select unit">
                          <Option value="LGU">LGU</Option>
                          <Option value="Private">Private</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="address"
                        label={
                          <>
                            <EnvironmentOutlined /> Address
                          </>
                        }
                      >
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "company",
                label: (
                  <Text strong>
                    <BankOutlined
                      style={{ color: "#13c2c2", marginRight: 6 }}
                    />
                    Company Address Details
                  </Text>
                ),
                children: (
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item name="companyRegion" label="Region">
                        <Select
                          showSearch
                          optionFilterProp="children"
                          placeholder="Select Region"
                          onChange={(val) => {
                            editForm.setFieldsValue({
                              companyProvince: undefined,
                              companyMunicipality: undefined,
                              companyBarangay: undefined,
                            });
                            fetchAddrProvinces(val);
                          }}
                        >
                          {addrRegions.map((r) => (
                            <Option key={r.code} value={r.code}>
                              {r.name}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="companyProvince" label="Province">
                        <Select
                          showSearch
                          optionFilterProp="children"
                          placeholder="Select Province"
                          onChange={(val) => {
                            editForm.setFieldsValue({
                              companyMunicipality: undefined,
                              companyBarangay: undefined,
                            });
                            fetchAddrMunicipalities(val);
                          }}
                        >
                          {addrProvinces.map((p) => (
                            <Option key={p.code} value={p.code}>
                              {p.name}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name="companyMunicipality"
                        label="City / Municipality"
                      >
                        <Select
                          showSearch
                          optionFilterProp="children"
                          placeholder="Select City/Municipality"
                          onChange={(val) => {
                            editForm.setFieldsValue({
                              companyBarangay: undefined,
                            });
                            fetchAddrBarangays(val);
                          }}
                        >
                          {addrMunicipalities.map((m) => (
                            <Option key={m.code} value={m.code}>
                              {m.name}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="companyBarangay" label="Barangay">
                        <Select
                          showSearch
                          optionFilterProp="children"
                          placeholder="Select Barangay"
                        >
                          {addrBarangays.map((b) => (
                            <Option key={b.code} value={b.code}>
                              {b.name}
                            </Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "operations",
                label: (
                  <Text strong>
                    <PieChartOutlined
                      style={{ color: "#13c2c2", marginRight: 6 }}
                    />
                    Cell Operations
                  </Text>
                ),
                children: (
                  <Row gutter={12}>
                    <Col xs={12} sm={8}>
                      <Form.Item
                        name="currentCellVolume"
                        label="Current Cell Volume"
                      >
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} sm={4}>
                      <Form.Item
                        name="currentCellVolumeUnit"
                        label="Unit"
                        initialValue="m³"
                      >
                        <Select placeholder="Select unit">
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={8}>
                      <Form.Item
                        name="cellStatus"
                        label="Cell Status"
                        initialValue="Active"
                      >
                        <Select>
                          <Option value="Active">Active</Option>
                          <Option value="Closed">Closed</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "baseline",
                label: (
                  <Text strong>
                    <DatabaseOutlined
                      style={{ color: "#722ed1", marginRight: 6 }}
                    />
                    Baseline Data
                  </Text>
                ),
                children: (
                  <Row gutter={12}>
                    <Col xs={12} sm={6}>
                      <Form.Item
                        name="baselineUnit"
                        label="Baseline Unit"
                        initialValue="m³"
                      >
                        <Select placeholder="Select baseline unit">
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={12}>
                      <Form.Item
                        name="totalVolumeAccepted"
                        label="Total Volume of Waste Accepted"
                      >
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} sm={6}>
                      <Form.Item
                        name="totalVolumeAcceptedUnit"
                        label="Unit"
                        initialValue="m³"
                      >
                        <Select placeholder="Select unit">
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={12}>
                      <Form.Item
                        name="activeCellResidualVolume"
                        label="Active Cell — Residual"
                      >
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} sm={6}>
                      <Form.Item
                        name="activeCellResidualUnit"
                        label="Unit"
                        initialValue="m³"
                      >
                        <Select placeholder="Select unit">
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={12}>
                      <Form.Item
                        name="activeCellInertVolume"
                        label="Active Cell — Inert"
                      >
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} sm={6}>
                      <Form.Item
                        name="activeCellInertUnit"
                        label="Unit"
                        initialValue="m³"
                      >
                        <Select placeholder="Select unit">
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={12}>
                      <Form.Item
                        name="closedCellResidualVolume"
                        label="Closed Cell — Residual"
                      >
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} sm={6}>
                      <Form.Item
                        name="closedCellResidualUnit"
                        label="Unit"
                        initialValue="m³"
                      >
                        <Select placeholder="Select unit">
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={12}>
                      <Form.Item
                        name="closedCellInertVolume"
                        label="Closed Cell — Inert"
                      >
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} sm={6}>
                      <Form.Item
                        name="closedCellInertUnit"
                        label="Unit"
                        initialValue="m³"
                      >
                        <Select placeholder="Select unit">
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Card
                        size="small"
                        title="Active Cell Entries"
                        style={{ borderRadius: 8, marginBottom: 8 }}
                      >
                        <Form.List name="activeCellEntries">
                          {(fields, { add, remove }) => (
                            <>
                              {fields.map(({ key, name, ...rest }) => (
                                <Row gutter={8} key={key} align="middle">
                                  <Col xs={24} sm={8}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "cellName"]}
                                      label="Cell Name"
                                    >
                                      <Input placeholder="Cell 1" />
                                    </Form.Item>
                                  </Col>
                                  <Col xs={24} sm={8}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "wasteType"]}
                                      label="Waste Type"
                                    >
                                      <Select
                                        placeholder="Select type"
                                        allowClear
                                      >
                                        <Option value="Residual">
                                          Residual
                                        </Option>
                                        <Option value="Inert">Inert</Option>
                                        <Option value="Hazardous Waste">
                                          Hazardous Waste
                                        </Option>
                                        <Option value="Treated Hazardous Waste">
                                          Treated Hazardous Waste
                                        </Option>
                                      </Select>
                                    </Form.Item>
                                  </Col>
                                  <Col xs={12} sm={4}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "volume"]}
                                      label="Volume"
                                    >
                                      <InputNumber
                                        min={0}
                                        style={{ width: "100%" }}
                                      />
                                    </Form.Item>
                                  </Col>
                                  <Col xs={8} sm={4}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "unit"]}
                                      label="Unit"
                                      initialValue="m³"
                                    >
                                      <Select>
                                        <Option value="m³">m³</Option>
                                        <Option value="tons">tons</Option>
                                      </Select>
                                    </Form.Item>
                                  </Col>
                                  <Col xs={4} sm={2} style={{ paddingTop: 22 }}>
                                    <Button
                                      type="text"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => remove(name)}
                                    />
                                  </Col>
                                </Row>
                              ))}
                              <Button
                                type="dashed"
                                block
                                onClick={() =>
                                  add({ wasteType: "Residual", unit: "m³" })
                                }
                              >
                                Add Active Cell Entry
                              </Button>
                            </>
                          )}
                        </Form.List>
                      </Card>
                    </Col>
                    <Col xs={24} md={12}>
                      <Card
                        size="small"
                        title="Closed Cell Entries"
                        style={{ borderRadius: 8, marginBottom: 8 }}
                      >
                        <Form.List name="closedCellEntries">
                          {(fields, { add, remove }) => (
                            <>
                              {fields.map(({ key, name, ...rest }) => (
                                <Row gutter={8} key={key} align="middle">
                                  <Col xs={24} sm={8}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "cellName"]}
                                      label="Cell Name"
                                    >
                                      <Input placeholder="Cell 1" />
                                    </Form.Item>
                                  </Col>
                                  <Col xs={24} sm={8}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "wasteType"]}
                                      label="Waste Type"
                                    >
                                      <Select
                                        placeholder="Select type"
                                        allowClear
                                      >
                                        <Option value="Residual">
                                          Residual
                                        </Option>
                                        <Option value="Inert">Inert</Option>
                                        <Option value="Hazardous Waste">
                                          Hazardous Waste
                                        </Option>
                                        <Option value="Treated Hazardous Waste">
                                          Treated Hazardous Waste
                                        </Option>
                                      </Select>
                                    </Form.Item>
                                  </Col>
                                  <Col xs={12} sm={4}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "volume"]}
                                      label="Volume"
                                    >
                                      <InputNumber
                                        min={0}
                                        style={{ width: "100%" }}
                                      />
                                    </Form.Item>
                                  </Col>
                                  <Col xs={8} sm={4}>
                                    <Form.Item
                                      {...rest}
                                      name={[name, "unit"]}
                                      label="Unit"
                                      initialValue="m³"
                                    >
                                      <Select>
                                        <Option value="m³">m³</Option>
                                        <Option value="tons">tons</Option>
                                      </Select>
                                    </Form.Item>
                                  </Col>
                                  <Col xs={4} sm={2} style={{ paddingTop: 22 }}>
                                    <Button
                                      type="text"
                                      danger
                                      icon={<DeleteOutlined />}
                                      onClick={() => remove(name)}
                                    />
                                  </Col>
                                </Row>
                              ))}
                              <Button
                                type="dashed"
                                block
                                onClick={() =>
                                  add({ wasteType: "Residual", unit: "m³" })
                                }
                              >
                                Add Closed Cell Entry
                              </Button>
                            </>
                          )}
                        </Form.List>
                      </Card>
                    </Col>
                  </Row>
                ),
              },
              {
                key: "haulers",
                label: (
                  <Text strong>
                    <TeamOutlined
                      style={{ color: "#52c41a", marginRight: 6 }}
                    />
                    Accredited Haulers
                  </Text>
                ),
                children: (
                  <Form.List name="accreditedHaulers">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...rest }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 8, borderRadius: 8 }}
                            title={
                              <Text style={{ fontSize: 12 }}>
                                <TeamOutlined /> Hauler #{name + 1}
                              </Text>
                            }
                            extra={
                              <Button
                                type="text"
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() => remove(name)}
                              >
                                Remove
                              </Button>
                            }
                          >
                            <Row gutter={8}>
                              <Col xs={24} sm={8}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "haulerName"]}
                                  label="Hauler Name"
                                >
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={4}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "numberOfTrucks"]}
                                  label="No. of Trucks"
                                >
                                  <InputNumber
                                    min={0}
                                    style={{ width: "100%" }}
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "officeAddress"]}
                                  label="Office Address"
                                >
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={24}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "privateSectorClients"]}
                                  label="Private Sector / LGU Clients"
                                >
                                  <Select
                                    mode="tags"
                                    placeholder="Type and press Enter"
                                    allowClear
                                  />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Divider
                              style={{ margin: "8px 0", fontSize: 12 }}
                              orientation="left"
                              plain
                            >
                              Vehicles
                            </Divider>
                            <Form.List name={[name, "vehicles"]}>
                              {(vFields, vOps) => (
                                <>
                                  {vFields.map(
                                    ({ key: vKey, name: vName, ...vRest }) => (
                                      <Row
                                        gutter={8}
                                        key={vKey}
                                        align="middle"
                                        style={{ marginBottom: 4 }}
                                      >
                                        <Col xs={8}>
                                          <Form.Item
                                            {...vRest}
                                            name={[vName, "plateNumber"]}
                                            label="Plate No."
                                            style={{ marginBottom: 4 }}
                                          >
                                            <Input size="small" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={6}>
                                          <Form.Item
                                            {...vRest}
                                            name={[vName, "vehicleType"]}
                                            label="Vehicle Type"
                                            style={{ marginBottom: 4 }}
                                          >
                                            <Input size="small" />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={5}>
                                          <Form.Item
                                            {...vRest}
                                            name={[vName, "capacity"]}
                                            label="Capacity"
                                            style={{ marginBottom: 4 }}
                                          >
                                            <InputNumber
                                              min={0}
                                              size="small"
                                              style={{ width: "100%" }}
                                            />
                                          </Form.Item>
                                        </Col>
                                        <Col xs={3}>
                                          <Form.Item
                                            {...vRest}
                                            name={[vName, "capacityUnit"]}
                                            label="Unit"
                                            style={{ marginBottom: 4 }}
                                          >
                                            <Select size="small">
                                              <Option value="m³">m³</Option>
                                              <Option value="tons">Tons</Option>
                                            </Select>
                                          </Form.Item>
                                        </Col>
                                        <Col
                                          xs={2}
                                          style={{ textAlign: "center" }}
                                        >
                                          <Button
                                            type="text"
                                            danger
                                            size="small"
                                            icon={<DeleteOutlined />}
                                            onClick={() => vOps.remove(vName)}
                                          />
                                        </Col>
                                      </Row>
                                    ),
                                  )}
                                  <Button
                                    type="dashed"
                                    size="small"
                                    onClick={() =>
                                      vOps.add({ capacityUnit: "m³" })
                                    }
                                    block
                                    style={{ marginTop: 4 }}
                                  >
                                    + Add Vehicle
                                  </Button>
                                </>
                              )}
                            </Form.List>
                          </Card>
                        ))}
                        <Button
                          type="dashed"
                          onClick={() => add()}
                          block
                          icon={<TeamOutlined />}
                        >
                          Add Hauler
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
              {
                key: "trucks",
                label: (
                  <Text strong>
                    <CarOutlined style={{ color: "#fa8c16", marginRight: 6 }} />
                    Trucks
                  </Text>
                ),
                children: (
                  <Form.List name="trucks">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name, ...rest }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 8, borderRadius: 8 }}
                            title={
                              <Text style={{ fontSize: 12 }}>
                                <CarOutlined /> Truck #{name + 1}
                              </Text>
                            }
                            extra={
                              <Button
                                type="text"
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() => remove(name)}
                              >
                                Remove
                              </Button>
                            }
                          >
                            <Row gutter={8}>
                              <Col xs={12} sm={8}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "disposalTicketNo"]}
                                  label="Ticket No."
                                >
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "hauler"]}
                                  label="Hauler"
                                >
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={8}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "plateNumber"]}
                                  label="Plate No."
                                >
                                  <Input />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "truckCapacity"]}
                                  label="Capacity"
                                >
                                  <InputNumber
                                    min={0}
                                    style={{ width: "100%" }}
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "truckCapacityUnit"]}
                                  label="Cap. Unit"
                                >
                                  <Select>
                                    <Option value="m³">m³</Option>
                                    <Option value="tons">Tons</Option>
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "actualVolume"]}
                                  label="Volume"
                                >
                                  <InputNumber
                                    min={0}
                                    style={{ width: "100%" }}
                                  />
                                </Form.Item>
                              </Col>
                              <Col xs={12} sm={6}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "actualVolumeUnit"]}
                                  label="Vol. Unit"
                                >
                                  <Select>
                                    <Option value="tons">Tons</Option>
                                    <Option value="m³">m³</Option>
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col xs={24} sm={8}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "wasteType"]}
                                  label="Waste Type"
                                >
                                  <Select allowClear>
                                    <Option value="Residual">Residual</Option>
                                    <Option value="Treated Hazardous Waste">
                                      Treated Hazardous Waste
                                    </Option>
                                  </Select>
                                </Form.Item>
                              </Col>
                              <Col xs={24} sm={16}>
                                <Form.Item
                                  {...rest}
                                  name={[name, "hazWasteCode"]}
                                  label="HW Code"
                                >
                                  <Select
                                    mode="tags"
                                    placeholder="Enter HW codes"
                                    allowClear
                                  />
                                </Form.Item>
                              </Col>
                            </Row>
                          </Card>
                        ))}
                        <Button
                          type="dashed"
                          onClick={() => add()}
                          block
                          icon={<CarOutlined />}
                        >
                          Add Truck
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* ── Transaction History Modal ── */}
      <Modal
        title={null}
        open={txnHistoryModal.open}
        onCancel={() => setTxnHistoryModal({ open: false, submissionId: null })}
        footer={
          <Button
            type="primary"
            block
            onClick={() =>
              setTxnHistoryModal({ open: false, submissionId: null })
            }
          >
            Close
          </Button>
        }
        width={TRANSACTION_HISTORY_MODAL_WIDTH}
        zIndex={1100}
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        {/* Gradient header */}
        <div
          style={{
            background: `linear-gradient(135deg, #2e6dd1 0%, #531dab 100%)`,
            padding: "18px 24px",
            borderRadius: "8px 8px 0 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "rgba(255,255,255,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <HistoryOutlined style={{ color: "#fff", fontSize: 18 }} />
            </div>
            <div>
              <Text
                style={{
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 700,
                  display: "block",
                }}
              >
                Transaction History
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: 12 }}>
                {txnHistoryModal.submissionId}
              </Text>
            </div>
            {txnHistoryData.length > 0 && (
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <Text
                  style={{
                    color: "rgba(255,255,255,0.55)",
                    fontSize: 11,
                    display: "block",
                  }}
                >
                  {txnHistoryData.length} event
                  {txnHistoryData.length !== 1 ? "s" : ""}
                </Text>
                {txnHistoryData[0]?.createdAt && (
                  <Text
                    style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  >
                    {dayjs(
                      txnHistoryData[txnHistoryData.length - 1]?.createdAt,
                    ).format("MMM D")}{" "}
                    → {dayjs(txnHistoryData[0]?.createdAt).format("MM/DD/YYYY")}
                  </Text>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 20px" }}>
          {txnHistoryLoading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <Spin />
            </div>
          ) : txnHistoryData.length === 0 ? (
            <Empty description="No transactions found" />
          ) : (
            (() => {
              const getTxnMeta = (type) => {
                const map = {
                  submission: {
                    color: "#1677ff",
                    bg: "#f0f5ff",
                    label: "Submission",
                  },
                  resubmission: {
                    color: "#13c2c2",
                    bg: "#e6fffb",
                    label: "Resubmission",
                  },
                  email_ack_sent: {
                    color: "#52c41a",
                    bg: "#f6ffed",
                    label: "Email Sent",
                  },
                  email_ack_failed: {
                    color: "#ff4d4f",
                    bg: "#fff1f0",
                    label: "Email Failed",
                  },
                  status_change: {
                    color: "#fa8c16",
                    bg: "#fff7e6",
                    label: "Status Change",
                  },
                  revert_approved: {
                    color: "#fa541c",
                    bg: "#fff2e8",
                    label: "Reverted",
                  },
                  baseline_update_request: {
                    color: "#faad14",
                    bg: "#fffbe6",
                    label: "Baseline Request",
                  },
                  baseline_update_approved: {
                    color: "#52c41a",
                    bg: "#f6ffed",
                    label: "Baseline Approved",
                  },
                  baseline_update: {
                    color: "#722ed1",
                    bg: "#f9f0ff",
                    label: "Baseline Update",
                  },
                  baseline_delete: {
                    color: "#ff4d4f",
                    bg: "#fff1f0",
                    label: "Baseline Cleared",
                  },
                  admin_edit: {
                    color: "#2f54eb",
                    bg: "#f0f5ff",
                    label: "Admin Edit",
                  },
                  submission_edit_request: {
                    color: "#faad14",
                    bg: "#fffbe6",
                    label: "Edit Request",
                  },
                  submission_edit_approved: {
                    color: "#52c41a",
                    bg: "#f6ffed",
                    label: "Edit Approved",
                  },
                  submission_edit_rejected: {
                    color: "#ff4d4f",
                    bg: "#fff1f0",
                    label: "Edit Rejected",
                  },
                  hauler_delete_request: {
                    color: "#fa8c16",
                    bg: "#fff7e6",
                    label: "Hauler Delete Req.",
                  },
                  hauler_delete_approved: {
                    color: "#52c41a",
                    bg: "#f6ffed",
                    label: "Hauler Deleted",
                  },
                  hauler_delete_rejected: {
                    color: "#ff4d4f",
                    bg: "#fff1f0",
                    label: "Hauler Delete Rej.",
                  },
                  deleted: {
                    color: "#ff4d4f",
                    bg: "#fff1f0",
                    label: "Deleted",
                  },
                };
                return (
                  map[type] || { color: "#8c8c8c", bg: "#f5f5f5", label: type }
                );
              };
              return (
                <Table
                  dataSource={[...txnHistoryData].reverse()}
                  rowKey={(t) => t._id}
                  size="small"
                  pagination={{
                    pageSize: 15,
                    size: "small",
                    showSizeChanger: true,
                    showTotal: (t) => `${t} event(s)`,
                  }}
                  scroll={{ y: 480 }}
                  columns={[
                    {
                      title: "#",
                      key: "idx",
                      width: 40,
                      render: (_, __, i) => (
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: isDark ? "#262626" : "#f5f5f5",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text
                            type="secondary"
                            style={{ fontSize: 11, lineHeight: 1 }}
                          >
                            {txnHistoryData.length - i}
                          </Text>
                        </div>
                      ),
                    },
                    {
                      title: "Event",
                      dataIndex: "type",
                      key: "type",
                      width: 170,
                      render: (v) => {
                        const meta = getTxnMeta(v);
                        return (
                          <div
                            style={{
                              background: meta.bg,
                              border: `1px solid ${meta.color}22`,
                              borderRadius: 6,
                              padding: "3px 8px",
                              display: "inline-block",
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 11,
                                color: meta.color,
                                fontWeight: 600,
                              }}
                            >
                              {meta.label}
                            </Text>
                          </div>
                        );
                      },
                    },
                    {
                      title: "Details",
                      key: "details",
                      width: 360,
                      onCell: () => ({
                        style: { maxWidth: 360, ...WRAP_CELL_STYLE },
                      }),
                      render: (_, t) => (
                        <div style={WRAP_CELL_STYLE}>
                          <Text
                            style={{
                              fontSize: 12,
                              display: "block",
                              ...WRAP_CELL_STYLE,
                            }}
                          >
                            {t.description}
                          </Text>
                          {(t.meta?.comment || t.meta?.reason) && (
                            <Text
                              type="secondary"
                              style={{
                                fontSize: 11,
                                fontStyle: "italic",
                                display: "block",
                                marginTop: 2,
                                ...WRAP_CELL_STYLE,
                              }}
                            >
                              &ldquo;{t.meta.comment || t.meta.reason}&rdquo;
                            </Text>
                          )}
                        </div>
                      ),
                    },
                    {
                      title: "By",
                      dataIndex: "performedBy",
                      key: "by",
                      width: 170,
                      onCell: () => ({
                        style: { maxWidth: 170, ...WRAP_CELL_STYLE },
                      }),
                      render: (v) => {
                        const displayName =
                          v === "admin" ? "EMBR3 ESWMP Admin" : v || "system";
                        return (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <div
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: isDark
                                  ? "rgba(47,84,235,0.15)"
                                  : "#f0f5ff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 10,
                                color: ACCENT,
                                fontWeight: 600,
                                flexShrink: 0,
                              }}
                            >
                              {displayName.charAt(0).toUpperCase()}
                            </div>
                            <Text
                              type="secondary"
                              style={{ fontSize: 12, ...WRAP_CELL_STYLE }}
                            >
                              {displayName}
                            </Text>
                          </div>
                        );
                      },
                    },
                    {
                      title: "Date / Time",
                      dataIndex: "createdAt",
                      key: "date",
                      width: 130,
                      render: (v) => (
                        <div>
                          <Text style={{ fontSize: 12, display: "block" }}>
                            {dayjs(v).format("MM/DD/YYYY")}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {dayjs(v).format("h:mm A")}
                          </Text>
                        </div>
                      ),
                    },
                  ]}
                />
              );
            })()
          )}
        </div>
      </Modal>

      {/* ── Admin Revert Modal ── */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: isDark ? "rgba(250,140,22,0.1)" : "#fff2e8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <UndoOutlined style={{ color: "#fa541c", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                Revert Submission
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Send back for correction
              </Text>
            </div>
          </div>
        }
        open={revertModal.open}
        onCancel={() => setRevertModal({ open: false, record: null })}
        onOk={handleAdminRevert}
        confirmLoading={revertLoading}
        okText="Revert Submission"
        okButtonProps={{ danger: true, icon: <UndoOutlined /> }}
        cancelText="Cancel"
        width={520}
      >
        {revertModal.record && (
          <div>
            <div
              style={{
                background: isDark ? "rgba(250,173,20,0.1)" : "#fff7e6",
                border: isDark
                  ? "1px solid rgba(250,173,20,0.3)"
                  : "1px solid #ffe7ba",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
              }}
            >
              <Space align="start">
                <ExclamationCircleOutlined
                  style={{ color: "#fa8c16", marginTop: 2 }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    color: isDark ? "#d4a94b" : "#8c6d1f",
                  }}
                >
                  This will revert the submission back to the portal user. They
                  will be notified via email and can update and resubmit the
                  entry.
                </Text>
              </Space>
            </div>
            <div
              style={{
                background: isDark ? "#1f1f1f" : "#fafafa",
                borderRadius: 8,
                padding: "14px 16px",
                marginBottom: 16,
                border: isDark ? "1px solid #303030" : "1px solid #f0f0f0",
              }}
            >
              <Row gutter={16}>
                <Col xs={12}>
                  <div style={{ marginBottom: 10 }}>
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        display: "block",
                        marginBottom: 2,
                      }}
                    >
                      ID No.
                    </Text>
                    <Text strong style={{ fontSize: 13 }}>
                      {revertModal.record.isGroupedSubmission
                        ? `${revertModal.record.entryCount || 0} grouped entries`
                        : revertModal.record.idNo || "—"}
                    </Text>
                  </div>
                </Col>
                <Col xs={12}>
                  <div style={{ marginBottom: 10 }}>
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        display: "block",
                        marginBottom: 2,
                      }}
                    >
                      Company
                    </Text>
                    <Text strong style={{ fontSize: 13 }}>
                      {revertModal.record.lguCompanyName || "—"}
                    </Text>
                  </div>
                </Col>
                <Col xs={12}>
                  <div style={{ marginBottom: 10 }}>
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        display: "block",
                        marginBottom: 2,
                      }}
                    >
                      Submitted By
                    </Text>
                    <Text strong style={{ fontSize: 13 }}>
                      {revertModal.record.submittedBy || "—"}
                    </Text>
                  </div>
                </Col>
                <Col xs={12}>
                  <div style={{ marginBottom: 10 }}>
                    <Text
                      type="secondary"
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        display: "block",
                        marginBottom: 2,
                      }}
                    >
                      Current Status
                    </Text>
                    <Tag
                      color={
                        statusColors[revertModal.record.status] || "default"
                      }
                      style={{ margin: 0 }}
                    >
                      {revertModal.record.status}
                    </Tag>
                  </div>
                </Col>
              </Row>
            </div>
            <Form layout="vertical" size="small">
              <Form.Item
                label={
                  <Text strong style={{ fontSize: 12 }}>
                    Reason for Revert
                  </Text>
                }
                required
                style={{ marginBottom: 0 }}
              >
                <Input.TextArea
                  rows={3}
                  placeholder="e.g. Incorrect data entries, missing truck information..."
                  value={revertReason}
                  onChange={(e) => setRevertReason(e.target.value)}
                />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>

      {isDeveloper && (
        <MergeSlfModal
          open={mergeSlfOpen}
          onClose={() => setMergeSlfOpen(false)}
          onMerged={() => fetchData({ force: true })}
        />
      )}

      <Modal
        open={idFixPreview.open}
        title={
          idFixPreview.type === "xx"
            ? "Preview — Fix XX Province Codes"
            : "Preview — Fix PVT/LGU ID Mismatches"
        }
        onCancel={() =>
          setIdFixPreview({ open: false, type: null, loading: false, applying: false, changes: [], message: "" })
        }
        onOk={confirmIdFix}
        okText={`Confirm & Fix${idFixPreview.changes.length ? ` (${idFixPreview.changes.length})` : ""}`}
        okButtonProps={{
          disabled: idFixPreview.loading || idFixPreview.changes.length === 0,
          loading: idFixPreview.applying,
          danger: idFixPreview.type === "xx",
        }}
        cancelText="Cancel"
        width={760}
        destroyOnHidden
      >
        {idFixPreview.error ? (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message="Could not load preview"
            description={idFixPreview.error}
            action={
              <Button size="small" onClick={retryIdFixPreview} loading={idFixPreview.loading}>
                Retry
              </Button>
            }
          />
        ) : idFixPreview.loading ? (
          <div style={{ textAlign: "center", padding: "40px 0 32px" }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600 }}>
              Scanning SLF records for{" "}
              {idFixPreview.type === "xx" ? "XX province-code" : "PVT/LGU ID"} mismatches…
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Matching each submission to its SLF record. No records are modified during the scan.
            </Text>
          </div>
        ) : (
          <Text type="secondary" style={{ display: "block", marginBottom: 10 }}>
            {idFixPreview.message ||
              "Review the proposed ID No. changes below. No records are modified until you confirm."}
          </Text>
        )}
        {idFixPreview.truncated && !idFixPreview.loading && !idFixPreview.error && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 10 }}
            message={`Showing the first ${idFixPreview.changes.length} of ${idFixPreview.total} affected records. Confirm & Fix applies to all of them.`}
          />
        )}
        {!idFixPreview.loading && !idFixPreview.error && (
        <Table
          size="small"
          dataSource={idFixPreview.changes}
          rowKey={(r) => String(r._id)}
          pagination={withSizeChanger({ pageSize: 8, showTotal: (t) => `${t} record(s) to fix` })}
          scroll={{ x: 680, y: 360 }}
          locale={{ emptyText: <Empty description="No records need fixing" /> }}
          columns={[
            {
              title: "Current ID No.",
              dataIndex: "currentIdNo",
              key: "currentIdNo",
              width: 150,
              render: (v) => <Text delete style={{ fontSize: 12 }}>{v}</Text>,
            },
            {
              title: "Proposed ID No.",
              dataIndex: "proposedIdNo",
              key: "proposedIdNo",
              width: 150,
              render: (v) => <Text strong style={{ fontSize: 12, color: "#52c41a" }}>{v}</Text>,
            },
            {
              title: "SLF / Company",
              key: "slf",
              render: (_, r) => (
                <Text style={{ fontSize: 12 }}>{r.slfName || r.lguCompanyName || "—"}</Text>
              ),
            },
            {
              title: "Type",
              dataIndex: "companyType",
              key: "companyType",
              width: 70,
              render: (v) => v || "—",
            },
            {
              title: "Disposal Date",
              dataIndex: "dateOfDisposal",
              key: "dateOfDisposal",
              width: 110,
              render: (v) => (v ? dayjs(v).format("MM/DD/YYYY") : "—"),
            },
          ]}
        />
        )}
      </Modal>
    </div>
  );
}
