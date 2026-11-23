import { useCallback, useState, useEffect, useMemo, useRef, useDeferredValue } from "react";
import {
  Table,
  Tag,
  Typography,
  Space,
  Spin,
  Modal,
  Badge,
  Empty,
  Tooltip,
  Button,
  Form,
  InputNumber,
  Select,
  Input,
  Row,
  Col,
  Divider,
  Popconfirm,
  Collapse,
  Segmented,
  Timeline,
} from "antd";
import {
  DatabaseOutlined,
  EyeOutlined,
  EditOutlined,
  HistoryOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SaveOutlined,
  PlusOutlined,
  MinusOutlined,
  DeleteOutlined,
  LockOutlined,
  UnlockOutlined,
  ReloadOutlined,
  AppstoreOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import MessageUserButton from "../../components/MessageUserButton";
import MovAttachmentList from "../../components/MovAttachmentList";
import dayjs from "dayjs";
import { fetchWithCache, invalidateCache } from "../../utils/pageCache";
import { getSocket } from "../../utils/socket";
import { buildFilters, rowMatchesSearch, searchableSelectProps } from "./shared/tableFilters";

const { Text } = Typography;
const UNIT_OPTIONS = ["m³", "tons"];
const WASTE_TYPES = ["Residual", "Inert", "Hazardous"];
const WASTE_TAG_COLOR = { Residual: "blue", Inert: "green", Hazardous: "red" };
const PURPLE = "#722ed1";

// Presentation for the baseline-lifecycle transaction types. Mirrors
// BASELINE_TXN_TYPES in server/routes/transactions.js — these are exactly the
// events excluded from a submission's Transaction History and surfaced here.
const BASELINE_TXN_META = {
  baseline_update: { color: "#1677ff", label: "Baseline Saved" },
  baseline_update_request: { color: "#fa8c16", label: "Update Requested" },
  baseline_update_approved: { color: "#52c41a", label: "Update Approved" },
  baseline_update_rejected: { color: "#ff4d4f", label: "Update Rejected" },
  baseline_locked: { color: "#722ed1", label: "Baseline Locked" },
};
const GREEN = "#52c41a";
const ORANGE = "#fa8c16";
const BLUE = "#1677ff";
const BASELINE_CACHE_KEY = "baseline-data-cache";
const BASELINE_CACHE_TTL = 5 * 60 * 1000;
const WRAP_CELL_STYLE = {
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const normalizeUnit = (unit) => (unit || "m³").replace("m3", "m³");
const getBaselineUnit = (record) =>
  normalizeUnit(
    record?.baselineUnit || record?.totalVolumeAcceptedUnit || "m³",
  );

function StatCard({ label, value, color, bg, border }) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: "10px 14px",
        height: "100%",
      }}
    >
      <Text
        type="secondary"
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          display: "block",
          marginBottom: 3,
        }}
      >
        {label}
      </Text>
      <Text strong style={{ fontSize: 14, color }}>
        {value}
      </Text>
    </div>
  );
}

// The section's Means of Verification, uploaded by the operator from the
// section card on the portal's Baseline tab.
function SectionMovLine({ mov }) {
  if (!Array.isArray(mov) || !mov.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "0 0 8px", fontSize: 12 }}>
      <Text type="secondary" style={{ fontSize: 11, whiteSpace: "nowrap", paddingTop: 1 }}>
        MOV ({mov.length}):
      </Text>
      <div style={{ flex: 1, minWidth: 0 }}>
        <MovAttachmentList attachments={mov} />
      </div>
    </div>
  );
}

function CellEntriesTable({ entries, unit = "m³", mov }) {
  if (!entries?.length)
    return (
      <>
        <SectionMovLine mov={mov} />
        <Empty
          description="No cell entries"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ margin: "8px 0" }}
        />
      </>
    );
  // Optional columns appear only when the operator supplied the detail, so older
  // baselines keep their compact layout.
  const hasDateClosed = entries.some((e) => e?.dateClosed);
  const hasMov = entries.some((e) => e?.movAttachments?.length);
  return (
    <>
    <SectionMovLine mov={mov} />
    <Table
      dataSource={entries}
      rowKey={(_, i) => i}
      size="small"
      pagination={false}
      tableLayout="fixed"
      scroll={{ x: 520 + (hasDateClosed ? 120 : 0) + (hasMov ? 130 : 0) }}
      style={{ fontSize: 11 }}
      columns={[
        {
          title: "#",
          key: "i",
          width: 40,
          render: (_, __, i) => <Text type="secondary">{i + 1}</Text>,
        },
        {
          title: "Cell Name",
          dataIndex: "cellName",
          width: 190,
          onCell: () => ({ style: WRAP_CELL_STYLE }),
          render: (v) => <Text strong style={{ fontSize: 11, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>{v || "—"}</Text>,
        },
        {
          title: "Waste Type",
          dataIndex: "wasteType",
          width: 150,
          onCell: () => ({ style: WRAP_CELL_STYLE }),
          render: (v) =>
            v ? (
              <Tag color={WASTE_TAG_COLOR[v] || "default"} variant="filled">
                {v}
              </Tag>
            ) : (
              "—"
            ),
        },
        {
          title: "Volume",
          dataIndex: "volume",
          width: 130,
          align: "right",
          render: (v, row) =>
            v != null ? (
              <Text strong style={{ fontSize: 11 }}>
                {Number(v).toLocaleString()} {normalizeUnit(row.unit || unit)}
              </Text>
            ) : (
              "—"
            ),
        },
        hasDateClosed && {
          title: "Date Closed",
          dataIndex: "dateClosed",
          width: 120,
          render: (v) => (v ? dayjs(v).format("MMM D, YYYY") : "—"),
        },
        hasMov && {
          title: "MOV",
          key: "mov",
          width: 130,
          render: (_, row) => <MovAttachmentList attachments={row.movAttachments} compact />,
        },
      ].filter(Boolean)}
    />
    </>
  );
}

function CellEntriesEditor({ cells, onChange }) {
  const add = () =>
    onChange([
      ...cells,
      { key: `c_${Date.now()}`, cellName: "", wasteType: "", volume: 0, unit: "m³" },
    ]);
  const remove = (key) => onChange(cells.filter((c) => c.key !== key));
  const update = (key, field, value) =>
    onChange(cells.map((c) => (c.key === key ? { ...c, [field]: value } : c)));

  return (
    <div>
      {cells.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Row gutter={6} style={{ marginBottom: 4 }}>
            <Col span={9}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Cell Name
              </Text>
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Waste Type
              </Text>
            </Col>
            <Col span={3}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Volume
              </Text>
            </Col>
            <Col span={2}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Unit
              </Text>
            </Col>
            <Col span={2} />
          </Row>
          {cells.map((c) => (
            <Row
              key={c.key}
              gutter={6}
              align="middle"
              style={{ marginBottom: 6 }}
            >
              <Col span={9}>
                <Input
                  size="small"
                  placeholder="e.g. Cell 1"
                  value={c.cellName}
                  onChange={(e) => update(c.key, "cellName", e.target.value)}
                />
              </Col>
              <Col span={8}>
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  value={c.wasteType || undefined}
                  placeholder="Waste type"
                  onChange={(v) => update(c.key, "wasteType", v)}
                >
                  {WASTE_TYPES.map((t) => (
                    <Select.Option key={t} value={t}>
                      {t}
                    </Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={3}>
                <InputNumber
                  size="small"
                  min={0}
                  style={{ width: "100%" }}
                  value={c.volume}
                  onChange={(v) => update(c.key, "volume", v)}
                />
              </Col>
              <Col span={2}>
                <Select
                  size="small"
                  style={{ width: "100%" }}
                  value={normalizeUnit(c.unit || "m³")}
                  onChange={(v) => update(c.key, "unit", v)}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <Select.Option key={u} value={u}>
                      {u}
                    </Select.Option>
                  ))}
                </Select>
              </Col>
              <Col span={2} style={{ textAlign: "right" }}>
                <Popconfirm
                  title="Remove this entry?"
                  onConfirm={() => remove(c.key)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
              </Col>
            </Row>
          ))}
        </div>
      )}
      <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={add}>
        Add Cell Entry
      </Button>
    </div>
  );
}

export default function BaselineData({
  isDark,
  canEdit = false,
  canDelete = false,
  canOverrideUnlock = false,
}) {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [lockFilter, setLockFilter] = useState("all");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  // Baseline history — the counterpart to a submission's Transaction History.
  // Baseline events are scoped to the FACILITY (see GET /transactions/baseline/
  // :slfName), which is why they are keyed by SLF name rather than a record id.
  const [historyModal, setHistoryModal] = useState({ open: false, slfName: "" });
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const openBaselineHistory = useCallback(async (slfName) => {
    setHistoryModal({ open: true, slfName });
    setHistoryLoading(true);
    setHistoryData([]);
    try {
      const { data } = await api.get(
        `/transactions/baseline/${encodeURIComponent(slfName)}`,
      );
      setHistoryData(Array.isArray(data) ? data : []);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [haulers, setHaulers] = useState([]);
  const [activeCells, setActiveCells] = useState([]);
  const [closedCells, setClosedCells] = useState([]);
  // Actual vs dummy baseline view (dummy tab is developer-only).
  const [baselineTab, setBaselineTab] = useState("actual");

  const fetchBaselines = useCallback(async ({ force = false, silent = false } = {}) => {
    await fetchWithCache(
      BASELINE_CACHE_KEY,
      // Developer view fetches dummy baselines too so they can be shown in a
      // separate tab; the default production consumers still exclude dummy.
      () => api.get(`/data-slf/baselines${canOverrideUnlock ? "?includeDummy=true" : ""}`).then(({ data }) => data || []),
      {
        ttl: BASELINE_CACHE_TTL,
        force,
        onStart: () => !silent && setLoading(true),
        onEnd: () => !silent && setLoading(false),
        onData: (data) => {
          setBaselines(Array.isArray(data) ? data : []);
          setLoading(false);
        },
      },
    );
  }, [canOverrideUnlock]);

  useEffect(() => {
    fetchBaselines({ force: true });
  }, [fetchBaselines]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const handler = ({ target } = {}) => {
      if (!target || target === "baselines") {
        invalidateCache(BASELINE_CACHE_KEY);
        fetchBaselines({ force: true, silent: true });
      }
    };
    socket.on("data-refresh", handler);
    return () => socket.off("data-refresh", handler);
  }, [fetchBaselines]);

  const fmtVol = (val, unit) =>
    val != null
      ? `${Number(val).toLocaleString()} ${normalizeUnit(unit)}`
      : "—";

  const getLockState = useCallback((record) => {
    if (record?.baselineUpdateApproved) return "unlocked";
    if (record?.baselineUpdateRequested) return "requested";
    return "locked";
  }, []);

  // Filter against the DEFERRED search text, not the raw input value: the
  // keystroke updates the box immediately while the (row-scanning) re-filter is
  // deprioritised, so typing stays responsive on large baseline sets.
  const deferredSearch = useDeferredValue(search);

  const filteredBaselines = useMemo(() => {
    return baselines.filter((record) => {
      // ACTUAL vs DUMMY are mutually exclusive.
      //
      // This view fetches with ?includeDummy=true for developers so the Dummy
      // tab has data. The "actual" branch previously did not filter dummies back
      // OUT, so demo/SAMPLE baselines — including everything the demo portal
      // account saves — appeared inside the real portal-user baseline table and
      // counted towards its badge. The dummy tab already isolates them; the
      // actual tab must exclude them.
      const isDummyRecord = !!record.isDummy;
      if (baselineTab === "dummy" ? !isDummyRecord : isDummyRecord) return false;
      const matchesLock = lockFilter === "all" || getLockState(record) === lockFilter;
      if (!matchesLock) return false;
      return rowMatchesSearch(record, deferredSearch, [
        "slfName",
        "lguCompanyName",
        "submittedBy",
        "companyType",
        (item) => getLockState(item),
      ]);
    });
  }, [baselines, getLockState, lockFilter, deferredSearch, baselineTab]);

  const dummyBaselineCount = useMemo(
    () => baselines.filter((r) => r.isDummy).length,
    [baselines],
  );

  const slfFilters = useMemo(() => buildFilters(baselines, "slfName"), [baselines]);
  const submitterFilters = useMemo(() => buildFilters(baselines, "submittedBy"), [baselines]);

  const openEdit = (record) => {
    const baselineUnit = getBaselineUnit(record);
    setEditRecord(record);
    form.setFieldsValue({
      baselineUnit,
      totalVolumeAccepted: record.totalVolumeAccepted,
      totalVolumeAcceptedUnit: record.totalVolumeAcceptedUnit || baselineUnit,
      activeCellResidualVolume: record.activeCellResidualVolume,
      activeCellResidualUnit: record.activeCellResidualUnit || baselineUnit,
      activeCellInertVolume: record.activeCellInertVolume,
      activeCellInertUnit: record.activeCellInertUnit || baselineUnit,
      closedCellResidualVolume: record.closedCellResidualVolume,
      closedCellResidualUnit: record.closedCellResidualUnit || baselineUnit,
      closedCellInertVolume: record.closedCellInertVolume,
      closedCellInertUnit: record.closedCellInertUnit || baselineUnit,
    });
    setActiveCells(
      // Spread first so cellIndex / cellType / MOV attachments survive an admin
      // edit — the editor only exposes name, type, volume and unit.
      (record.activeCellEntries || []).map((c, i) => ({
        ...c,
        key: `ac_${i}`,
        cellName: c.cellName || "",
        wasteType: c.wasteType || "",
        volume: c.volume ?? 0,
        unit: normalizeUnit(c.unit || baselineUnit),
      })),
    );
    setClosedCells(
      (record.closedCellEntries || []).map((c, i) => ({
        ...c,
        key: `cc_${i}`,
        cellName: c.cellName || "",
        wasteType: c.wasteType || "",
        volume: c.volume ?? 0,
        unit: normalizeUnit(c.unit || baselineUnit),
      })),
    );
    setHaulers(
      (record.accreditedHaulers || []).map((h, i) => ({
        key: `h_${i}`,
        haulerName: h.haulerName || "",
        numberOfTrucks: h.numberOfTrucks ?? 0,
        officeAddress: h.officeAddress || "",
        vehicles: (h.vehicles || []).map((v, j) => ({
          key: `v_${i}_${j}`,
          plateNumber: v.plateNumber || "",
          vehicleType: v.vehicleType || "",
          capacity: v.capacity ?? 0,
          capacityUnit: v.capacityUnit || "m³",
        })),
      })),
    );
    setEditOpen(true);
  };

  const handleSave = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const vals = form.getFieldsValue();
      const baselineUnit = normalizeUnit(
        vals.totalVolumeAcceptedUnit || editRecord?.baselineUnit || "m³",
      );
      await api.put(`/data-slf/baselines/${editRecord._id}`, {
        ...vals,
        baselineUnit,
        totalVolumeAcceptedUnit: baselineUnit,
        activeCellResidualUnit: vals.activeCellResidualUnit || baselineUnit,
        activeCellInertUnit: vals.activeCellInertUnit || baselineUnit,
        closedCellResidualUnit: vals.closedCellResidualUnit || baselineUnit,
        closedCellInertUnit: vals.closedCellInertUnit || baselineUnit,
        activeCellEntries: activeCells.map(({ key, ...c }) => ({
          ...c,
          unit: normalizeUnit(c.unit || baselineUnit),
        })),
        closedCellEntries: closedCells.map(({ key, ...c }) => ({
          ...c,
          unit: normalizeUnit(c.unit || baselineUnit),
        })),
        accreditedHaulers: haulers.map(({ key, vehicles, ...rest }) => ({
          ...rest,
          vehicles: (vehicles || []).map(({ key: vk, ...vrest }) => vrest),
        })),
      });
      Swal.fire({
        icon: "success",
        title: "Baseline Updated",
        timer: 1200,
        showConfirmButton: false,
      });
      setEditOpen(false);
      fetchBaselines({ force: true });
    } catch {
      Swal.fire("Error", "Could not update baseline", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record) => {
    const result = await Swal.fire({
      title: "Delete baseline data?",
      icon: "warning",
      html: `
        <div style="text-align:left;font-size:13px;line-height:1.6">
          <p>This will clear the baseline data for <strong>${record.slfName || "this SLF"}</strong>.</p>
          <ul style="padding-left:18px;margin:8px 0">
            <li>Total accepted volume and cell baseline volumes will be removed.</li>
            <li>Active/closed cell entries and accredited haulers will be cleared.</li>
            <li>Any pending or approved baseline update request will be reset.</li>
            <li>The SLF will no longer appear in this Baseline Data tab until new baseline data is encoded from the portal side or by an admin.</li>
          </ul>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Yes, delete baseline",
      cancelButtonText: "Cancel",
      confirmButtonColor: "#ff4d4f",
    });
    if (!result.isConfirmed) return;
    try {
      await api.delete(`/data-slf/baselines/${record._id}`);
      Swal.fire({
        icon: "success",
        title: "Baseline Deleted",
        timer: 1200,
        showConfirmButton: false,
      });
      fetchBaselines({ force: true });
    } catch {
      Swal.fire("Error", "Could not delete baseline record", "error");
    }
  };

  // Which baseline row currently has an unlock/re-lock in flight, so its button can
  // show a spinner and refuse a second click. The ref is the actual guard (it is
  // set synchronously, before any await); the state exists only to drive the UI.
  const [baselineAction, setBaselineAction] = useState(null);
  const baselineActionRef = useRef({});
  const isBaselineActionBusy = (slfName) => baselineAction?.slfName === slfName;

  const handleApproveBaselineUpdate = async (slfName, { isOverride = false } = {}) => {
    const result = await Swal.fire({
      title: isOverride ? "Unlock Baseline?" : "Approve Baseline Update?",
      text: isOverride
        ? `This will unlock baseline data for "${slfName}" even without a portal request.`
        : `This will unlock baseline data for "${slfName}" so the portal user can make changes.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: isOverride ? "Unlock" : "Approve",
      confirmButtonColor: "#52c41a",
    });
    if (!result.isConfirmed) return;
    // Guard against a second click while the PATCH is in flight. The request fans
    // out to updateMany + notifications for every portal user on the SLF, so a
    // double-click fired the whole thing twice and raced two approval states.
    if (baselineActionRef.current[slfName]) return;
    baselineActionRef.current[slfName] = true;
    setBaselineAction({ slfName, type: isOverride ? "unlock" : "approve" });
    try {
      await api.patch(
        `/data-slf/baseline-update-approve/${encodeURIComponent(slfName)}`,
        {},
      );
      Swal.fire({
        icon: "success",
        title: "Update Approved",
        text: "The portal user can now edit their baseline data.",
        timer: 2000,
        showConfirmButton: false,
      });
      fetchBaselines({ force: true });
    } catch (err) {
      Swal.fire(
        "Error",
        err?.response?.data?.message || "Could not approve baseline update",
        "error",
      );
    } finally {
      delete baselineActionRef.current[slfName];
      setBaselineAction(null);
    }
  };

  const handleLockBaseline = async (slfName) => {
    const result = await Swal.fire({
      title: "Lock Baseline?",
      text: `This will re-lock baseline data for "${slfName}".`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Lock",
      confirmButtonColor: "#fa8c16",
    });
    if (!result.isConfirmed) return;
    if (baselineActionRef.current[slfName]) return;
    baselineActionRef.current[slfName] = true;
    setBaselineAction({ slfName, type: "lock" });
    try {
      await api.patch(
        `/data-slf/baseline-update-lock/${encodeURIComponent(slfName)}`,
        {},
      );
      Swal.fire({
        icon: "success",
        title: "Baseline Locked",
        timer: 1500,
        showConfirmButton: false,
      });
      fetchBaselines({ force: true });
    } catch (err) {
      Swal.fire(
        "Error",
        err?.response?.data?.message || "Could not lock baseline",
        "error",
      );
    } finally {
      delete baselineActionRef.current[slfName];
      setBaselineAction(null);
    }
  };

  const handleRejectBaselineUpdate = async (slfName) => {
    const { value: reason } = await Swal.fire({
      title: "Reject Baseline Update?",
      text: `This will deny the update request for "${slfName}".`,
      icon: "warning",
      input: "text",
      inputPlaceholder: "Reason for rejection (optional)",
      showCancelButton: true,
      confirmButtonText: "Reject",
      confirmButtonColor: "#ff4d4f",
    });
    if (reason === undefined) return; // cancelled
    try {
      await api.patch(
        `/data-slf/baseline-update-reject/${encodeURIComponent(slfName)}`,
        { reason },
      );
      Swal.fire({
        icon: "success",
        title: "Request Rejected",
        timer: 1500,
        showConfirmButton: false,
      });
      fetchBaselines({ force: true });
    } catch (err) {
      Swal.fire(
        "Error",
        err?.response?.data?.message || "Could not reject baseline update",
        "error",
      );
    }
  };

  const addHauler = () => {
    setHaulers((prev) => [
      ...prev,
      {
        key: `h_${Date.now()}`,
        haulerName: "",
        numberOfTrucks: 0,
        officeAddress: "",
        vehicles: [],
      },
    ]);
  };

  const removeHauler = (key) => {
    setHaulers((prev) => prev.filter((h) => h.key !== key));
  };

  const updateHauler = (key, field, value) => {
    setHaulers((prev) =>
      prev.map((h) => (h.key === key ? { ...h, [field]: value } : h)),
    );
  };

  const addVehicle = (haulerKey) => {
    setHaulers((prev) =>
      prev.map((h) =>
        h.key === haulerKey
          ? {
              ...h,
              vehicles: [
                ...(h.vehicles || []),
                {
                  key: `v_${Date.now()}`,
                  plateNumber: "",
                  vehicleType: "",
                  capacity: 0,
                  capacityUnit: "m³",
                },
              ],
            }
          : h,
      ),
    );
  };

  const removeVehicle = (haulerKey, vehicleKey) => {
    setHaulers((prev) =>
      prev.map((h) =>
        h.key === haulerKey
          ? {
              ...h,
              vehicles: (h.vehicles || []).filter((v) => v.key !== vehicleKey),
            }
          : h,
      ),
    );
  };

  const updateVehicle = (haulerKey, vehicleKey, field, value) => {
    setHaulers((prev) =>
      prev.map((h) =>
        h.key === haulerKey
          ? {
              ...h,
              vehicles: (h.vehicles || []).map((v) =>
                v.key === vehicleKey ? { ...v, [field]: value } : v,
              ),
            }
          : h,
      ),
    );
  };

  // ── Table columns ──
  const tableColumns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      key: "slfName",
      width: 220,
      filters: slfFilters,
      filterSearch: true,
      onFilter: (value, record) => String(record.slfName || "") === String(value || ""),
      render: (v, r) => (
        <div>
          <Space size={4} wrap>
            <Text
              strong
              style={{
                fontSize: 13,
                whiteSpace: "normal",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {v}
            </Text>
            {r.isDummy && (
              <Tooltip title="Sample / test baseline — visible to developers only, excluded from real reporting.">
                <Tag color="purple" style={{ margin: 0, fontSize: 10, lineHeight: "16px" }}>
                  SAMPLE
                </Tag>
              </Tooltip>
            )}
            {/* This facility's baseline records were written under more than one
                spelling of its name — `slfName` is a snapshot, so a rename leaves
                the old wording behind. The rows are one facility and are now shown
                as one; the older names are surfaced rather than hidden, so an
                admin looking for the spelling they remember can still find it. */}
            {(r.mergedFromNames || []).length > 0 && (
              <Tooltip
                title={
                  <span>
                    Also recorded under{" "}
                    {r.mergedFromNames.map((name) => `"${name}"`).join(", ")}. These
                    are the same facility — older name snapshots from before it was
                    renamed — and are shown here as one row.
                  </span>
                }
              >
                <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: "16px" }}>
                  +{r.mergedFromNames.length} older name
                  {r.mergedFromNames.length === 1 ? "" : "s"}
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Text type="secondary" style={{ fontSize: 11, display: "block" }}>
            {r.submittedBy ? `By ${r.submittedBy}` : "No submitter"}
          </Text>
        </div>
      ),
    },
    {
      title: "Last Updated",
      dataIndex: "lastUpdated",
      key: "lastUpdated",
      width: 150,
      sorter: (a, b) => new Date(a.lastUpdated || 0) - new Date(b.lastUpdated || 0),
      // Date AND time. A portal user often saves their baseline more than once in
      // a day, and a date-only stamp made those edits indistinguishable — which is
      // the one question this column exists to answer. The tooltip carries the
      // full timestamp for anyone who needs the seconds.
      render: (v) =>
        v ? (
          <Tooltip title={dayjs(v).format("dddd, MMMM D, YYYY h:mm:ss A")}>
            <Text style={{ fontSize: 12 }}>{dayjs(v).format("MM/DD/YYYY h:mm A")}</Text>
          </Tooltip>
        ) : (
          "—"
        ),
    },
    {
      title: "Total Volume",
      key: "volume",
      width: 130,
      sorter: (a, b) => Number(a.totalVolumeAccepted || 0) - Number(b.totalVolumeAccepted || 0),
      render: (_, r) => (
        <Text strong>
          {fmtVol(r.totalVolumeAccepted, r.totalVolumeAcceptedUnit)}
        </Text>
      ),
    },
    {
      title: "Cells",
      key: "cells",
      width: 150,
      render: (_, r) => {
        const activeHas = (r.activeCellEntries || []).length > 0;
        const closedHas = (r.closedCellEntries || []).length > 0;
        const activeText = activeHas
          ? `${r.activeCellEntries.length} cell(s)`
          : fmtVol(r.activeCellResidualVolume, r.activeCellResidualUnit);
        const closedText = closedHas
          ? `${r.closedCellEntries.length} cell(s)`
          : fmtVol(r.closedCellResidualVolume, r.closedCellResidualUnit);
        return (
          <Space direction="vertical" size={2}>
            <Tooltip title="Active Cells">
              <Tag color="green" style={{ margin: 0 }} icon={<CheckCircleOutlined />}>
                {activeText}
              </Tag>
            </Tooltip>
            <Tooltip title="Closed Cells">
              <Tag color="orange" style={{ margin: 0 }} icon={<CloseCircleOutlined />}>
                {closedText}
              </Tag>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: "Status",
      key: "status",
      width: 160,
      filters: [
        { text: "Locked", value: "locked" },
        { text: "Update Requested", value: "requested" },
        { text: "Edit Unlocked", value: "unlocked" },
      ],
      onFilter: (value, record) => getLockState(record) === value,
      render: (_, r) => (
        <Space size={4} wrap>
          {r.baselineUpdateRequested && (
            <Tag color="processing" style={{ fontSize: 11 }}>
              Update Requested
            </Tag>
          )}
          {r.baselineUpdateApproved && (
            <Tag color="success" style={{ fontSize: 11 }}>
              Edit Unlocked
            </Tag>
          )}
          {!r.baselineUpdateRequested && !r.baselineUpdateApproved && (
            <Tag color="default" style={{ fontSize: 11 }}>
              Locked
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 180,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View Details">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              style={{ color: BLUE }}
              onClick={() => {
                setSelectedRecord(r);
                setDetailOpen(true);
              }}
            />
          </Tooltip>
          {/* Item #5: same Message User flow as the Summary tab (shared component,
              same API/model/real-time delivery), targeting this SLF's portal user. */}
          <MessageUserButton
            slfGenerator={r.slfGenerator}
            slfName={r.slfName}
            size="small"
            type="text"
          />
          <Tooltip title="Baseline History">
            <Button
              size="small"
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => openBaselineHistory(r.slfName)}
            />
          </Tooltip>
          {r.baselineUpdateRequested && (
            <>
              <Tooltip title="Approve Update Request">
                <Button
                  size="small"
                  type="text"
                  icon={<CheckCircleOutlined />}
                  style={{ color: GREEN }}
                  loading={isBaselineActionBusy(r.slfName)}
                  disabled={isBaselineActionBusy(r.slfName)}
                  onClick={() => handleApproveBaselineUpdate(r.slfName)}
                />
              </Tooltip>
              <Tooltip title="Reject Update Request">
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<CloseCircleOutlined />}
                  disabled={isBaselineActionBusy(r.slfName)}
                  onClick={() => handleRejectBaselineUpdate(r.slfName)}
                />
              </Tooltip>
            </>
          )}
          {canOverrideUnlock && !r.baselineUpdateRequested && !r.baselineUpdateApproved && (
            <Tooltip title="Unlock Baseline">
              <Button
                size="small"
                type="text"
                icon={<UnlockOutlined />}
                style={{ color: GREEN }}
                loading={isBaselineActionBusy(r.slfName)}
                disabled={isBaselineActionBusy(r.slfName)}
                onClick={() =>
                  handleApproveBaselineUpdate(r.slfName, { isOverride: true })
                }
              />
            </Tooltip>
          )}
          {r.baselineUpdateApproved && (
            <Tooltip title="Re-lock Baseline">
              <Button
                size="small"
                type="text"
                icon={<LockOutlined />}
                style={{ color: ORANGE }}
                loading={isBaselineActionBusy(r.slfName)}
                disabled={isBaselineActionBusy(r.slfName)}
                onClick={() => handleLockBaseline(r.slfName)}
              />
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip title="Edit Baseline">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                style={{ color: PURPLE }}
                onClick={() => openEdit(r)}
              />
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip title="Delete Baseline">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(r)}
              />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const expandedRowRender = (r) => {
    const hasActiveCells = (r.activeCellEntries || []).length > 0;
    const hasClosedCells = (r.closedCellEntries || []).length > 0;
    return (
      <div style={{ padding: "8px 0" }}>
        <Row gutter={8} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={8} style={{ marginBottom: 8 }}>
            <StatCard
              label="Total Volume Accepted"
              value={fmtVol(r.totalVolumeAccepted, r.totalVolumeAcceptedUnit)}
              color={BLUE}
              bg={isDark ? "rgba(22,119,255,0.08)" : "#f0f5ff"}
              border={isDark ? "rgba(22,119,255,0.2)" : "#d6e4ff"}
            />
          </Col>
          <Col xs={24} sm={8} style={{ marginBottom: 8 }}>
            <StatCard
              label="Active Cell Entries"
              value={
                hasActiveCells
                  ? `${r.activeCellEntries.length} cell(s)`
                  : fmtVol(r.activeCellResidualVolume, r.activeCellResidualUnit)
              }
              color={GREEN}
              bg={isDark ? "rgba(82,196,26,0.08)" : "#f6ffed"}
              border={isDark ? "rgba(82,196,26,0.2)" : "#d9f7be"}
            />
          </Col>
          <Col xs={24} sm={8} style={{ marginBottom: 8 }}>
            <StatCard
              label="Closed Cell Entries"
              value={
                hasClosedCells
                  ? `${r.closedCellEntries.length} cell(s)`
                  : fmtVol(r.closedCellResidualVolume, r.closedCellResidualUnit)
              }
              color={ORANGE}
              bg={isDark ? "rgba(250,140,22,0.08)" : "#fff7e6"}
              border={isDark ? "rgba(250,140,22,0.2)" : "#ffe7ba"}
            />
          </Col>
        </Row>
        {hasActiveCells && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: 3,
                  height: 14,
                  background: GREEN,
                  borderRadius: 2,
                }}
              />
              <Text strong style={{ fontSize: 12, color: GREEN }}>
                Active Cell Entries ({r.activeCellEntries.length})
              </Text>
            </div>
            <CellEntriesTable
              entries={r.activeCellEntries}
              unit={getBaselineUnit(r)}
              mov={r.baselineMov?.activeCells}
            />
          </div>
        )}
        {hasClosedCells && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: 3,
                  height: 14,
                  background: ORANGE,
                  borderRadius: 2,
                }}
              />
              <Text strong style={{ fontSize: 12, color: ORANGE }}>
                Closed Cell Entries ({r.closedCellEntries.length})
              </Text>
            </div>
            <CellEntriesTable
              entries={r.closedCellEntries}
              unit={getBaselineUnit(r)}
              mov={r.baselineMov?.closedCells}
            />
          </div>
        )}
        {!hasActiveCells && !hasClosedCells && (
          <Row gutter={8} style={{ marginBottom: 14 }}>
            {[
              [
                "Active (Residual)",
                r.activeCellResidualVolume,
                r.activeCellResidualUnit,
                GREEN,
              ],
              [
                "Active (Inert)",
                r.activeCellInertVolume,
                r.activeCellInertUnit,
                "#13c2c2",
              ],
              [
                "Closed (Residual)",
                r.closedCellResidualVolume,
                r.closedCellResidualUnit,
                ORANGE,
              ],
              [
                "Closed (Inert)",
                r.closedCellInertVolume,
                r.closedCellInertUnit,
                PURPLE,
              ],
            ].map(([label, val, unit, color]) => (
              <Col key={label} xs={12} sm={6} style={{ marginBottom: 8 }}>
                <Text
                  type="secondary"
                  style={{ fontSize: 11, display: "block" }}
                >
                  {label}
                </Text>
                <Text strong style={{ color }}>
                  {fmtVol(val, unit)}
                </Text>
              </Col>
            ))}
          </Row>
        )}
        {(r.accreditedHaulers || []).length > 0 && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: 3,
                  height: 14,
                  background: PURPLE,
                  borderRadius: 2,
                }}
              />
              <Text strong style={{ fontSize: 12, color: PURPLE }}>
                Accredited Haulers ({r.accreditedHaulers.length})
              </Text>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {r.accreditedHaulers.map((h, i) => (
                <Tag key={i} color="purple" variant="filled">
                  {h.haulerName} ·{" "}
                  {(h.vehicles || []).length || h.numberOfTrucks || 0} trucks
                </Tag>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const VolumeRow = ({ label, nameVal, nameUnit }) => (
    <Row gutter={8} style={{ marginBottom: 0 }}>
      <Col span={16}>
        <Form.Item name={nameVal} label={label}>
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item name={nameUnit} label="Unit">
          <Select>
            {UNIT_OPTIONS.map((u) => (
              <Select.Option key={u} value={u}>
                {u}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Col>
    </Row>
  );

  return (
    <Spin spinning={loading}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Space align="center" wrap>
          <DatabaseOutlined style={{ color: PURPLE, fontSize: 16 }} />
          <Text strong style={{ fontSize: 15 }}>
            {baselineTab === "dummy" ? "Dummy Company Baseline Data" : "Company Baseline Data"}
          </Text>
          <Badge count={filteredBaselines.length} style={{ backgroundColor: PURPLE }} />
          {canOverrideUnlock && (
            <Segmented
              size="small"
              value={baselineTab}
              onChange={(val) => setBaselineTab(val)}
              options={[
                { label: "Actual", value: "actual" },
                { label: `Dummy${dummyBaselineCount ? ` (${dummyBaselineCount})` : ""}`, value: "dummy" },
              ]}
            />
          )}
        </Space>
        <Space wrap>
          <Input
            allowClear
            placeholder="Search SLF, submitter, or status"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 280 }}
          />
          <Select
            value={lockFilter}
            onChange={setLockFilter}
            style={{ width: 170 }}
            {...searchableSelectProps}
            options={[
              { label: "All States", value: "all" },
              { label: "Locked", value: "locked" },
              { label: "Update Requested", value: "requested" },
              { label: "Edit Unlocked", value: "unlocked" },
            ]}
          />
          <Button
            type="primary"
            
            icon={<ReloadOutlined spin={loading} />}
            onClick={() => fetchBaselines({ force: true })}
          >
            Refresh
          </Button>
        </Space>
      </div>

      {filteredBaselines.length === 0 && !loading ? (
        <Empty
          description="No baseline data available yet."
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Table
          dataSource={filteredBaselines}
          rowKey="_id"
          columns={tableColumns}
          size="small"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `${t} records`,
          }}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender,
            rowExpandable: () => true,
          }}
        />
      )}

      {/* ── View Details Modal ── */}
      <Modal
        title={null}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={<Button onClick={() => setDetailOpen(false)}>Close</Button>}
        width={1300}
        styles={{
          body: {
            padding: 0,
            fontSize: 12,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          },
        }}
        destroyOnHidden
      >
        {selectedRecord &&
          (() => {
            const r = selectedRecord;
            const hasAC = (r.activeCellEntries || []).length > 0;
            const hasCC = (r.closedCellEntries || []).length > 0;
            return (
              <div>
                <div
                  style={{
                    background: `linear-gradient(135deg, ${PURPLE} 0%, #531dab 100%)`,
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
                        Baseline Data
                      </Text>
                      <div style={{ marginTop: 2 }}>
                        <Text
                          style={{
                            color: "#fff",
                            fontSize: 20,
                            fontWeight: 700,
                          }}
                        >
                          {r.slfName}
                        </Text>
                      </div>
                      <Text
                        style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}
                      >
                        Submitted by: {r.submittedBy || "—"}
                      </Text>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {r.baselineUpdateRequested && (
                        <Tag
                          color="processing"
                          style={{ marginBottom: 4, display: "block" }}
                        >
                          Update Requested
                        </Tag>
                      )}
                      {r.baselineUpdateApproved && (
                        <Tag color="success" style={{ display: "block" }}>
                          Edit Unlocked
                        </Tag>
                      )}
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.5)",
                          fontSize: 11,
                          display: "block",
                          marginTop: 4,
                        }}
                      >
                        {r.lastUpdated
                          ? dayjs(r.lastUpdated).format("MM/DD/YYYY")
                          : "—"}
                      </Text>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "20px 24px" }}>
                  <Row gutter={8} style={{ marginBottom: 20 }}>
                    <Col xs={8}>
                      <StatCard
                        label="Total Vol. Accepted"
                        value={fmtVol(
                          r.totalVolumeAccepted,
                          r.totalVolumeAcceptedUnit,
                        )}
                        color={PURPLE}
                        bg={isDark ? "rgba(114,46,209,0.1)" : "#f9f0ff"}
                        border={isDark ? "rgba(114,46,209,0.25)" : "#d3adf7"}
                      />
                    </Col>
                    <Col xs={8}>
                      <StatCard
                        label="Active Cells"
                        value={
                          hasAC
                            ? `${r.activeCellEntries.length} entr${r.activeCellEntries.length === 1 ? "y" : "ies"}`
                            : fmtVol(
                                r.activeCellResidualVolume,
                                r.activeCellResidualUnit,
                              )
                        }
                        color={GREEN}
                        bg={isDark ? "rgba(82,196,26,0.1)" : "#f6ffed"}
                        border={isDark ? "rgba(82,196,26,0.25)" : "#d9f7be"}
                      />
                    </Col>
                    <Col xs={8}>
                      <StatCard
                        label="Closed Cells"
                        value={
                          hasCC
                            ? `${r.closedCellEntries.length} entr${r.closedCellEntries.length === 1 ? "y" : "ies"}`
                            : fmtVol(
                                r.closedCellResidualVolume,
                                r.closedCellResidualUnit,
                              )
                        }
                        color={ORANGE}
                        bg={isDark ? "rgba(250,140,22,0.1)" : "#fff7e6"}
                        border={isDark ? "rgba(250,140,22,0.25)" : "#ffe7ba"}
                      />
                    </Col>
                  </Row>
                  <Collapse
                    defaultActiveKey={["active", "closed", "haulers"]}
                    bordered={false}
                    size="small"
                    style={{ background: "transparent" }}
                    items={[
                      {
                        key: "active",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <AppstoreOutlined
                              style={{ color: GREEN, marginRight: 6 }}
                            />
                            Active Cell Entries (
                            {hasAC ? r.activeCellEntries.length : "legacy"})
                          </Text>
                        ),
                        children: hasAC ? (
                          <CellEntriesTable
                            entries={r.activeCellEntries}
                            unit={getBaselineUnit(r)}
              mov={r.baselineMov?.activeCells}
                          />
                        ) : (
                          <Row gutter={8}>
                            {[
                              [
                                "Residual",
                                r.activeCellResidualVolume,
                                r.activeCellResidualUnit,
                                "blue",
                              ],
                              [
                                "Inert",
                                r.activeCellInertVolume,
                                r.activeCellInertUnit,
                                "green",
                              ],
                              r.acceptsHazardousWaste && [
                                "Hazardous",
                                r.activeCellHazardousVolume,
                                r.activeCellHazardousUnit,
                                "red",
                              ],
                            ]
                              .filter(Boolean)
                              .map(([type, val, unit, color]) => (
                                <Col
                                  key={type}
                                  xs={12}
                                  sm={8}
                                  style={{ marginBottom: 8 }}
                                >
                                  <Tag
                                    color={color}
                                    variant="filled"
                                    style={{ marginBottom: 4 }}
                                  >
                                    {type}
                                  </Tag>
                                  <Text strong style={{ display: "block" }}>
                                    {fmtVol(val, unit)}
                                  </Text>
                                </Col>
                              ))}
                          </Row>
                        ),
                      },
                      {
                        key: "closed",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <AppstoreOutlined
                              style={{ color: ORANGE, marginRight: 6 }}
                            />
                            Closed Cell Entries (
                            {hasCC ? r.closedCellEntries.length : "legacy"})
                          </Text>
                        ),
                        children: hasCC ? (
                          <CellEntriesTable
                            entries={r.closedCellEntries}
                            unit={getBaselineUnit(r)}
              mov={r.baselineMov?.closedCells}
                          />
                        ) : (
                          <Row gutter={8}>
                            {[
                              [
                                "Residual",
                                r.closedCellResidualVolume,
                                r.closedCellResidualUnit,
                                "orange",
                              ],
                              [
                                "Inert",
                                r.closedCellInertVolume,
                                r.closedCellInertUnit,
                                "volcano",
                              ],
                              r.acceptsHazardousWaste && [
                                "Hazardous",
                                r.closedCellHazardousVolume,
                                r.closedCellHazardousUnit,
                                "red",
                              ],
                            ]
                              .filter(Boolean)
                              .map(([type, val, unit, color]) => (
                                <Col
                                  key={type}
                                  xs={12}
                                  sm={8}
                                  style={{ marginBottom: 8 }}
                                >
                                  <Tag
                                    color={color}
                                    variant="filled"
                                    style={{ marginBottom: 4 }}
                                  >
                                    {type}
                                  </Tag>
                                  <Text strong style={{ display: "block" }}>
                                    {fmtVol(val, unit)}
                                  </Text>
                                </Col>
                              ))}
                          </Row>
                        ),
                      },
                      {
                        key: "haulers",
                        label: (
                          <Text strong style={{ fontSize: 13 }}>
                            <TeamOutlined
                              style={{ color: PURPLE, marginRight: 6 }}
                            />
                            Accredited Haulers (
                            {(r.accreditedHaulers || []).length})
                          </Text>
                        ),
                        children:
                          (r.accreditedHaulers || []).length === 0 ? (
                            <>
                              <SectionMovLine mov={r.baselineMov?.haulers} />
                              <Empty
                                description="No accredited haulers"
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                              />
                            </>
                          ) : (
                            <>
                            <SectionMovLine mov={r.baselineMov?.haulers} />
                            <Table
                              dataSource={r.accreditedHaulers}
                              rowKey={(h, i) => `${h.haulerName}-${i}`}
                              size="small"
                              pagination={{ pageSize: 6, size: "small" }}
                              tableLayout="fixed"
                              scroll={{ x: 960 }}
                              expandable={{
                                expandedRowRender: (h) => {
                                  const vehicles =
                                    h.vehicles?.length > 0
                                      ? h.vehicles
                                      : h.plateNumber || h.vehicleType
                                        ? [
                                            {
                                              plateNumber: h.plateNumber,
                                              vehicleType: h.vehicleType,
                                              capacity: h.capacity,
                                              capacityUnit: h.capacityUnit,
                                            },
                                          ]
                                        : [];
                                  return vehicles.length > 0 ? (
                                    <Table
                                      dataSource={vehicles}
                                      rowKey={(_, vi) => vi}
                                      size="small"
                                      pagination={{ pageSize: 5, size: "small" }}
                                      tableLayout="fixed"
                                      scroll={{ x: 560 }}
                                      columns={[
                                        {
                                          title: "#",
                                          key: "i",
                                          width: 40,
                                          render: (_, __, vi) => vi + 1,
                                        },
                                        {
                                          title: "Plate No.",
                                          dataIndex: "plateNumber",
                                          width: 150,
                                          onCell: () => ({ style: WRAP_CELL_STYLE }),
                                          render: (v) => v || "—",
                                        },
                                        {
                                          title: "Vehicle Type",
                                          dataIndex: "vehicleType",
                                          width: 190,
                                          onCell: () => ({ style: WRAP_CELL_STYLE }),
                                          render: (v) => v || "—",
                                        },
                                        {
                                          title: "Capacity",
                                          key: "cap",
                                          width: 140,
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
                                  width: 200,
                                  onCell: () => ({ style: WRAP_CELL_STYLE }),
                                  render: (v) => <Text strong>{v || "—"}</Text>,
                                },
                                {
                                  title: "No. of Trucks",
                                  dataIndex: "numberOfTrucks",
                                  width: 110,
                                  align: "center",
                                  render: (v) => v ?? "—",
                                },
                                {
                                  title: "Office Address",
                                  dataIndex: "officeAddress",
                                  width: 260,
                                  onCell: () => ({ style: WRAP_CELL_STYLE }),
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Private Clients",
                                  key: "clients",
                                  width: 240,
                                  render: (_, h) => {
                                    const c = h.privateSectorClients || [];
                                    const text = c.length > 0
                                      ? c
                                        .map((x) =>
                                          typeof x === "string"
                                            ? x
                                            : x.clientName || "—",
                                        )
                                        .join(", ")
                                      : "—";
                                    return (
                                      <Text style={{ whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word", fontSize: 12 }}>
                                        {text}
                                      </Text>
                                    );
                                  },
                                },
                              ]}
                            />
                            </>
                          ),
                      },
                    ]}
                  />
                </div>
              </div>
            );
          })()}
      </Modal>

      {/* ── Edit Baseline Modal ── */}
      <Modal
        title={
          <Space>
            <EditOutlined style={{ color: PURPLE }} />
            <span>Edit Baseline — {editRecord?.slfName}</span>
          </Space>
        }
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
        okText="Save"
        okButtonProps={{ icon: <SaveOutlined />, loading: saving }}
        width={1100}
        forceRender
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          size="small"
          style={{ marginTop: 8 }}
        >
          <Collapse
            defaultActiveKey={["volume", "active", "closed", "haulers"]}
            bordered={false}
            size="small"
            style={{ background: "transparent" }}
            items={[
              {
                key: "volume",
                label: (
                  <Text strong>
                    <DatabaseOutlined
                      style={{ color: PURPLE, marginRight: 6 }}
                    />
                    Total Volume
                  </Text>
                ),
                children: (
                  <VolumeRow
                    label="Total Volume Accepted"
                    nameVal="totalVolumeAccepted"
                    nameUnit="totalVolumeAcceptedUnit"
                  />
                ),
              },
              {
                key: "active",
                label: (
                  <Text strong>
                    <span style={{ color: GREEN, marginRight: 6 }}>●</span>
                    Active Cell Entries ({activeCells.length})
                  </Text>
                ),
                children: (
                  <CellEntriesEditor
                    cells={activeCells}
                    onChange={setActiveCells}
                  />
                ),
              },
              {
                key: "closed",
                label: (
                  <Text strong>
                    <span style={{ color: ORANGE, marginRight: 6 }}>●</span>
                    Closed Cell Entries ({closedCells.length})
                  </Text>
                ),
                children: (
                  <CellEntriesEditor
                    cells={closedCells}
                    onChange={setClosedCells}
                  />
                ),
              },
              {
                key: "legacy",
                label: (
                  <Text
                    strong
                    style={{
                      fontSize: 12,
                      color: isDark ? "#8c8c8c" : "#595959",
                    }}
                  >
                    Legacy Volume Fields (optional fallback)
                  </Text>
                ),
                children: (
                  <div>
                    <Divider
                      plain
                      style={{ margin: "4px 0 8px", fontSize: 12 }}
                    >
                      Active Cell
                    </Divider>
                    <VolumeRow
                      label="Residual Volume"
                      nameVal="activeCellResidualVolume"
                      nameUnit="activeCellResidualUnit"
                    />
                    <VolumeRow
                      label="Inert Volume"
                      nameVal="activeCellInertVolume"
                      nameUnit="activeCellInertUnit"
                    />
                    <Divider
                      plain
                      style={{ margin: "4px 0 8px", fontSize: 12 }}
                    >
                      Closed Cell
                    </Divider>
                    <VolumeRow
                      label="Residual Volume"
                      nameVal="closedCellResidualVolume"
                      nameUnit="closedCellResidualUnit"
                    />
                    <VolumeRow
                      label="Inert Volume"
                      nameVal="closedCellInertVolume"
                      nameUnit="closedCellInertUnit"
                    />
                  </div>
                ),
              },
              {
                key: "haulers",
                label: (
                  <Text strong>
                    <TeamOutlined style={{ color: PURPLE, marginRight: 6 }} />
                    Accredited Haulers ({haulers.length})
                  </Text>
                ),
                children: (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginBottom: 8,
                      }}
                    >
                      <Button
                        size="small"
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={addHauler}
                      >
                        Add Hauler
                      </Button>
                    </div>
                    <Table
                      size="small"
                      rowKey="key"
                      dataSource={haulers}
                      pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100, 200],
                        showTotal: (total) =>
                          `${total} hauler${total === 1 ? "" : "s"}`,
                      }}
                      scroll={{ x: 760 }}
                      expandable={{
                        expandedRowRender: (h) => (
                          <div style={{ padding: "4px 8px" }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 6,
                              }}
                            >
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                Trucks / Vehicles ({(h.vehicles || []).length})
                              </Text>
                              <Tooltip title="Add Truck">
                                <Button
                                  size="small"
                                  type="text"
                                  icon={<PlusOutlined />}
                                  onClick={() => addVehicle(h.key)}
                                />
                              </Tooltip>
                            </div>
                            {(h.vehicles || []).length === 0 ? (
                              <Empty
                                description="No trucks"
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                style={{ margin: "8px 0" }}
                              />
                            ) : (
                              h.vehicles.map((v) => (
                                <Row
                                  key={v.key}
                                  gutter={6}
                                  align="middle"
                                  style={{ marginBottom: 6 }}
                                >
                                  <Col span={7}>
                                    <Input
                                      size="small"
                                      placeholder="Plate No."
                                      value={v.plateNumber}
                                      onChange={(e) =>
                                        updateVehicle(
                                          h.key,
                                          v.key,
                                          "plateNumber",
                                          e.target.value,
                                        )
                                      }
                                    />
                                  </Col>
                                  <Col span={6}>
                                    <Input
                                      size="small"
                                      placeholder="Vehicle type"
                                      value={v.vehicleType}
                                      onChange={(e) =>
                                        updateVehicle(
                                          h.key,
                                          v.key,
                                          "vehicleType",
                                          e.target.value,
                                        )
                                      }
                                    />
                                  </Col>
                                  <Col span={5}>
                                    <InputNumber
                                      size="small"
                                      min={0}
                                      placeholder="Capacity"
                                      value={v.capacity}
                                      onChange={(val) =>
                                        updateVehicle(
                                          h.key,
                                          v.key,
                                          "capacity",
                                          val,
                                        )
                                      }
                                      style={{ width: "100%" }}
                                    />
                                  </Col>
                                  <Col span={4}>
                                    <Select
                                      size="small"
                                      value={v.capacityUnit}
                                      onChange={(val) =>
                                        updateVehicle(
                                          h.key,
                                          v.key,
                                          "capacityUnit",
                                          val,
                                        )
                                      }
                                      style={{ width: "100%" }}
                                    >
                                      {UNIT_OPTIONS.map((u) => (
                                        <Select.Option key={u} value={u}>
                                          {u}
                                        </Select.Option>
                                      ))}
                                    </Select>
                                  </Col>
                                  <Col
                                    span={2}
                                    style={{ textAlign: "right" }}
                                  >
                                    <Popconfirm
                                      title="Remove truck?"
                                      onConfirm={() =>
                                        removeVehicle(h.key, v.key)
                                      }
                                    >
                                      <Button
                                        size="small"
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                      />
                                    </Popconfirm>
                                  </Col>
                                </Row>
                              ))
                            )}
                          </div>
                        ),
                      }}
                      columns={[
                        {
                          title: "#",
                          key: "idx",
                          width: 48,
                          render: (_, record) =>
                            haulers.findIndex((x) => x.key === record.key) +
                            1,
                        },
                        {
                          title: "Hauler Name",
                          dataIndex: "haulerName",
                          render: (val, record) => (
                            <Input
                              size="small"
                              placeholder="Hauler name"
                              value={val}
                              onChange={(e) =>
                                updateHauler(
                                  record.key,
                                  "haulerName",
                                  e.target.value,
                                )
                              }
                            />
                          ),
                        },
                        {
                          title: "Office Address",
                          dataIndex: "officeAddress",
                          render: (val, record) => (
                            <Input
                              size="small"
                              placeholder="Office address"
                              value={val}
                              onChange={(e) =>
                                updateHauler(
                                  record.key,
                                  "officeAddress",
                                  e.target.value,
                                )
                              }
                            />
                          ),
                        },
                        {
                          title: "Trucks",
                          dataIndex: "numberOfTrucks",
                          width: 140,
                          render: (val, record) => (
                            <Space.Compact>
                              <Button
                                size="small"
                                icon={<MinusOutlined />}
                                onClick={() =>
                                  updateHauler(
                                    record.key,
                                    "numberOfTrucks",
                                    Math.max(0, (val || 0) - 1),
                                  )
                                }
                              />
                              <InputNumber
                                size="small"
                                min={0}
                                controls={false}
                                value={val}
                                onChange={(v) =>
                                  updateHauler(
                                    record.key,
                                    "numberOfTrucks",
                                    v ?? 0,
                                  )
                                }
                                style={{ width: 56, textAlign: "center" }}
                              />
                              <Button
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={() =>
                                  updateHauler(
                                    record.key,
                                    "numberOfTrucks",
                                    (val || 0) + 1,
                                  )
                                }
                              />
                            </Space.Compact>
                          ),
                        },
                        {
                          title: "Vehicles",
                          key: "vehicleCount",
                          width: 90,
                          render: (_, record) => (
                            <Tag color={PURPLE}>
                              {(record.vehicles || []).length}
                            </Tag>
                          ),
                        },
                        {
                          title: "",
                          key: "actions",
                          width: 56,
                          render: (_, record) => (
                            <Popconfirm
                              title="Remove hauler?"
                              onConfirm={() => removeHauler(record.key)}
                            >
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                              />
                            </Popconfirm>
                          ),
                        },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* ── Baseline History ──
          The counterpart to a submission's Transaction History. Baseline events
          (saved / update requested / approved / rejected / locked) belong to the
          FACILITY, so they are listed here rather than inside any one
          submission's thread — see BASELINE_TXN_TYPES in routes/transactions.js. */}
      <Modal
        title={
          <Space>
            <HistoryOutlined style={{ color: PURPLE }} />
            <span>Baseline History — {historyModal.slfName}</span>
          </Space>
        }
        open={historyModal.open}
        onCancel={() => setHistoryModal({ open: false, slfName: "" })}
        footer={
          <Button onClick={() => setHistoryModal({ open: false, slfName: "" })}>
            Close
          </Button>
        }
        width={720}
        style={{ maxWidth: "95vw" }}
        classNames={{ body: "slf-slim-scroll" }}
        destroyOnHidden
      >
        {historyLoading ? (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <Spin />
          </div>
        ) : historyData.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No baseline activity recorded for this SLF yet"
          />
        ) : (
          <Timeline
            style={{ marginTop: 8 }}
            items={historyData.map((txn) => {
              const meta = BASELINE_TXN_META[txn.type] || {
                color: "#8c8c8c",
                label: txn.type || "Event",
              };
              return {
                color: meta.color,
                children: (
                  <div>
                    <Space size={6} wrap style={{ marginBottom: 2 }}>
                      <Tag color={meta.color} style={{ margin: 0 }}>
                        {meta.label}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {txn.createdAt
                          ? dayjs(txn.createdAt).format("MMM D, YYYY h:mm A")
                          : "—"}
                      </Text>
                    </Space>
                    <div style={{ fontSize: 12.5, wordBreak: "break-word" }}>
                      {txn.description || "—"}
                    </div>
                    {(txn.performedBy || txn.submittedBy) && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        by {txn.performedBy || txn.submittedBy}
                      </Text>
                    )}
                  </div>
                ),
              };
            })}
          />
        )}
      </Modal>
    </Spin>
  );
}
