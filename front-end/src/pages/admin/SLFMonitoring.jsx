import { useState, useEffect, useCallback, useMemo, useRef, Suspense, lazy } from "react";
import {
  Card,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Divider,
  Row,
  Col,
  Typography,
  DatePicker,
  Tooltip,
  Tabs,
  Collapse,
  Statistic,
  Descriptions,
  Badge,
  Popconfirm,
  Switch,
  Spin,
  Empty,
  Progress,
  Skeleton,
  Alert,
  Upload,
  message,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SearchOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  ReloadOutlined,
  TeamOutlined,
  CalendarOutlined,
  BarChartOutlined,
  FilterOutlined,
  ClearOutlined,
  SafetyCertificateOutlined,
  BankOutlined,
  MinusCircleOutlined,
  LinkOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  AlertOutlined,
  UserOutlined,
  SolutionOutlined,
  UndoOutlined,
  BellOutlined,
  HistoryOutlined,
  MailOutlined,
  SendOutlined,
  WarningOutlined,
  UploadOutlined,
  PaperClipOutlined,
  TableOutlined,
  PieChartOutlined,
} from "@ant-design/icons";
import Swal from "sweetalert2";
import api from "../../api";
import { exportToExcel } from "../../utils/exportExcel";
import secureStorage from "../../utils/secureStorage";
import { useDataRef } from "../../utils/dataRef";
import dayjs from "dayjs";
import {
  PieChart,
  Pie,
  Cell as RCell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const { Title, Text } = Typography;
const ACCENT = "#2f54eb";
const CHART_COLORS = ["#2f54eb", "#52c41a", "#faad14", "#ff4d4f", "#13c2c2", "#722ed1", "#eb2f96"];

const CACHE_KEY = "slf-facility-cache";
const CACHE_TTL = 5 * 60 * 1000;

const R3_PROVINCES = ["Bataan", "Bulacan", "Nueva Ecija", "Pampanga", "Tarlac", "Zambales", "Aurora"];

function buildFilters(records, key) {
  const vals = [...new Set(records.map((r) => r[key]).filter(Boolean))].sort();
  return vals.map((v) => ({ text: v, value: v }));
}

function networkDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const s = dayjs(startDate).startOf("day");
  const e = dayjs(endDate).startOf("day");
  if (!s.isValid() || !e.isValid()) return null;
  let count = 0,
    cur = s;
  const dir = e.isAfter(s) ? 1 : -1;
  while (dir > 0 ? !cur.isAfter(e) : !cur.isBefore(e)) {
    const dow = cur.day();
    if (dow !== 0 && dow !== 6) count++;
    cur = cur.add(dir, "day");
  }
  return Math.max(1, count > 1 ? count - 1 : count);
}

function computeFields(rec) {
  return {
    totalDaysReportPrepared: networkDays(
      rec.dateOfMonitoring,
      rec.dateReportPrepared,
    ),
    totalDaysReviewedStaff: networkDays(
      rec.dateReportPrepared,
      rec.dateReportReviewedStaff,
    ),
    totalDaysReviewedFocal: networkDays(
      rec.dateReportReviewedStaff || rec.dateReportPrepared,
      rec.dateReportReviewedFocal,
    ),
    totalDaysApproved: networkDays(
      rec.dateReportReviewedFocal,
      rec.dateReportApproved,
    ),
  };
}

function getStatusTag(v) {
  if (!v) return <Tag color="default">—</Tag>;
  if (/operational/i.test(v) && !/non/i.test(v))
    return (
      <Tag color="green" bordered={false}>
        <CheckCircleOutlined /> Operational
      </Tag>
    );
  if (/non/i.test(v))
    return (
      <Tag color="red" bordered={false}>
        <CloseCircleOutlined /> Non-Operational
      </Tag>
    );
  return <Tag bordered={false}>{v}</Tag>;
}

// ── SLF Waste Baseline Info Sub-Tab ──
function WasteBaselineInfo() {
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedGen, setExpandedGen] = useState(null);

  useEffect(() => {
    setLoading(true);
    api
      .get("/data-slf/baselines")
      .then(({ data }) => setBaselines(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      key: "slfName",
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      width: 100,
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Total Volume Accepted",
      key: "totalVolumeAccepted",
      render: (_, r) =>
        r.totalVolumeAccepted != null
          ? `${r.totalVolumeAccepted.toLocaleString()} ${(r.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Active Cell (Residual)",
      key: "activeCellResidual",
      render: (_, r) =>
        r.activeCellResidualVolume != null
          ? `${r.activeCellResidualVolume.toLocaleString()} ${(r.activeCellResidualUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Active Cell (Inert)",
      key: "activeCellInert",
      render: (_, r) =>
        r.activeCellInertVolume != null
          ? `${r.activeCellInertVolume.toLocaleString()} ${(r.activeCellInertUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Closed Cell (Residual)",
      key: "closedCellResidual",
      render: (_, r) =>
        r.closedCellResidualVolume != null
          ? `${r.closedCellResidualVolume.toLocaleString()} ${(r.closedCellResidualUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Closed Cell (Inert)",
      key: "closedCellInert",
      render: (_, r) =>
        r.closedCellInertVolume != null
          ? `${r.closedCellInertVolume.toLocaleString()} ${(r.closedCellInertUnit || "m³").replace("m3", "m³")}`
          : "—",
    },
    {
      title: "Haulers",
      key: "haulers",
      width: 80,
      render: (_, r) => r.accreditedHaulers?.length || 0,
    },
    {
      title: "Submitted By",
      dataIndex: "submittedBy",
      key: "submittedBy",
      ellipsis: true,
      render: (v) => v || "—",
    },
    {
      title: "Last Updated",
      dataIndex: "lastUpdated",
      key: "lastUpdated",
      width: 140,
      render: (v) => (v ? dayjs(v).format("MMM DD, YYYY") : "—"),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary">
          Baseline waste volume information submitted by SLF portal users.
        </Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            setLoading(true);
            api
              .get("/data-slf/baselines")
              .then(({ data }) => setBaselines(data))
              .catch(() => {})
              .finally(() => setLoading(false));
          }}
        >
          Refresh
        </Button>
      </div>
      <Table
        dataSource={baselines}
        columns={columns}
        rowKey="_id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 1200 }}
        expandable={{
          expandedRowKeys: expandedGen ? [expandedGen] : [],
          onExpand: (expanded, record) =>
            setExpandedGen(expanded ? record._id : null),
          expandedRowRender: (record) =>
            record.accreditedHaulers?.length > 0 ? (
              <Table
                dataSource={record.accreditedHaulers}
                rowKey={(_, i) => i}
                size="small"
                pagination={false}
                columns={[
                  {
                    title: "Hauler Name",
                    dataIndex: "haulerName",
                    key: "haulerName",
                  },
                  {
                    title: "Number of Trucks",
                    dataIndex: "numberOfTrucks",
                    key: "numberOfTrucks",
                    render: (v) => v ?? "—",
                  },
                  {
                    title: "Private Sector Clients",
                    dataIndex: "privateSectorClients",
                    key: "privateSectorClients",
                    render: (v) => v || "—",
                  },
                ]}
              />
            ) : (
              <Text type="secondary">No accredited haulers</Text>
            ),
          rowExpandable: (record) => record.accreditedHaulers?.length > 0,
        }}
      />
    </>
  );
}

// ── Portal Generators Sub-Tab ──
function PortalGenerators({
  generators,
  loadingGen,
  fetchGenerators,
  slfRecords,
  canEdit = true,
  canDelete = true,
  isDark,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [portalStats, setPortalStats] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loadingSub, setLoadingSub] = useState(false);
  const [form] = Form.useForm();
  const [txnHistoryModal, setTxnHistoryModal] = useState({ open: false, submissionId: null });
  const [txnHistoryData, setTxnHistoryData] = useState([]);
  const [txnHistoryLoading, setTxnHistoryLoading] = useState(false);
  const [emailModal, setEmailModal] = useState({ open: false, record: null });
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [revertModal, setRevertModal] = useState({ open: false, record: null });
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);
  const unitOptions = [
    { label: "Tons", value: "tons" },
    { label: <span>m<sup>3</sup></span>, value: "m³" },
  ];

  const fetchSubmissions = useCallback(() => {
    setLoadingSub(true);
    api
      .get("/data-slf")
      .then(({ data }) => setSubmissions(data))
      .catch(() => {})
      .finally(() => setLoadingSub(false));
  }, []);

  useEffect(() => {
    api
      .get("/data-slf/generator-summary")
      .then(({ data }) => setPortalStats(data))
      .catch(() => {});
    fetchSubmissions();
  }, [fetchSubmissions]);

  // Real-time polling every 8 seconds
  useEffect(() => {
    const interval = setInterval(fetchSubmissions, 8000);
    return () => clearInterval(interval);
  }, [fetchSubmissions]);

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

  const openEmailModal = (record) => {
    setEmailModal({ open: true, record });
    setEmailSubject("");
    setEmailMessage("");
  };

  const handleSendEmail = async () => {
    if (!emailSubject.trim() || !emailMessage.trim()) {
      Swal.fire("Warning", "Please fill in both subject and message.", "warning");
      return;
    }
    setEmailSending(true);
    try {
      await api.post(`/data-slf/${emailModal.record._id}/send-email`, {
        subject: emailSubject,
        message: emailMessage,
      });
      Swal.fire({ icon: "success", title: "Email Sent", text: `Email sent to ${emailModal.record.submittedBy}`, confirmButtonColor: ACCENT, timer: 2500 });
      setEmailModal({ open: false, record: null });
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to send email", "error");
    } finally {
      setEmailSending(false);
    }
  };

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
      await api.patch(`/data-slf/${revertModal.record._id}/admin-revert`, {
        reason: revertReason,
        performedBy: "admin",
      });
      Swal.fire({ icon: "success", title: "Reverted", text: "Submission reverted and the portal user has been notified via email.", confirmButtonColor: ACCENT, timer: 2500 });
      setRevertModal({ open: false, record: null });
      setRevertReason("");
      fetchSubmissions();
    } catch (err) {
      Swal.fire("Error", err.response?.data?.message || "Failed to revert", "error");
    } finally {
      setRevertLoading(false);
    }
  };

  const statsMap = useMemo(() => {
    const m = {};
    portalStats.forEach((s) => (m[s._id] = s));
    return m;
  }, [portalStats]);

  const overallStats = useMemo(() => {
    return portalStats.reduce(
      (acc, s) => ({
        totalEntries: acc.totalEntries + s.totalEntries,
        pendingCount: acc.pendingCount + s.pendingCount,
        acknowledgedCount: acc.acknowledgedCount + s.acknowledgedCount,
        totalVolume: acc.totalVolume + s.totalVolume,
        totalTrucks: acc.totalTrucks + s.totalTrucks,
      }),
      {
        totalEntries: 0,
        pendingCount: 0,
        acknowledgedCount: 0,
        totalVolume: 0,
        totalTrucks: 0,
      },
    );
  }, [portalStats]);

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      const matchStatus = !submissionStatusFilter || s.status === submissionStatusFilter;
      const q = submissionSearch.toLowerCase();
      const matchSearch = !q ||
        (s.lguCompanyName || "").toLowerCase().includes(q) ||
        (s.idNo || "").toLowerCase().includes(q) ||
        (s.submittedBy || "").toLowerCase().includes(q) ||
        (s.slfGenerator?.slfName || "").toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [submissions, submissionSearch, submissionStatusFilter]);

  const submissionWasteStats = useMemo(() => {
    let residual = 0, haz = 0, other = 0;
    submissions.forEach((s) => {
      (s.trucks || []).forEach((t) => {
        const wt = (t.wasteType || "").toLowerCase();
        if (wt.includes("haz") || wt.includes("inert")) haz += (t.actualVolume || 0);
        else if (wt.includes("residual")) residual += (t.actualVolume || 0);
        else other += (t.actualVolume || 0);
      });
    });
    return { residual, haz, other };
  }, [submissions]);

  const revertRequestCount = useMemo(
    () => submissions.filter((s) => s.revertRequested).length,
    [submissions],
  );

  const openAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      existingBaselineUnit: "tons",
      totalVolumeSinceOperationUnit: "tons",
      totalVolumeActiveCellsUnit: "tons",
      totalVolumeClosedCellsUnit: "tons",
      isActive: true,
      accreditedHaulers: [],
    });
    setModalOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({ ...r, accreditedHaulers: r.accreditedHaulers || [] });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await api.put(`/slf-generators/${editing._id}`, values);
        Swal.fire("Updated", "Generator updated", "success");
      } else {
        await api.post("/slf-generators", values);
        Swal.fire("Created", "Generator added", "success");
      }
      setModalOpen(false);
      fetchGenerators();
    } catch (err) {
      if (err.response)
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/slf-generators/${id}`);
      Swal.fire("Deleted", "Generator removed", "success");
      fetchGenerators();
    } catch {
      Swal.fire("Error", "Delete failed", "error");
    }
  };

  const linkedFacilities = useMemo(() => {
    const map = {};
    slfRecords.forEach((r) => {
      if (r.slfGenerator) {
        const gid =
          typeof r.slfGenerator === "object"
            ? r.slfGenerator._id
            : r.slfGenerator;
        map[gid] = (map[gid] || 0) + 1;
      }
    });
    return map;
  }, [slfRecords]);

  const genColumns = [
    {
      title: "SLF Name",
      dataIndex: "slfName",
      sorter: (a, b) => (a.slfName || "").localeCompare(b.slfName || ""),
      render: (t, r) => (
        <div>
          <Text strong style={{ fontSize: 12 }}>{t}</Text>
          {!r.isActive && <Tag color="red" style={{ marginLeft: 6, fontSize: 9 }}>Inactive</Tag>}
        </div>
      ),
    },
    {
      title: "Linked Facility",
      width: 120,
      render: (_, r) => {
        const cnt = linkedFacilities[r._id] || 0;
        const fac = slfRecords.find((sr) => {
          const gid = typeof sr.slfGenerator === "object" ? sr.slfGenerator?._id : sr.slfGenerator;
          return gid === r._id;
        });
        return cnt > 0 ? (
          <div>
            <Tag color="geekblue" icon={<BankOutlined />} style={{ fontSize: 10 }}>{cnt} record{cnt > 1 ? "s" : ""}</Tag>
            {fac && <div style={{ fontSize: 10, color: "#8c8c8c", marginTop: 2 }}>{fac.lgu || "—"}, {fac.province || ""}</div>}
          </div>
        ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
      },
    },
    {
      title: "Baseline Volume",
      width: 130,
      render: (_, r) => {
        const v = r.existingBaselineVolume ?? 0;
        return v > 0 ? (
          <Text style={{ fontSize: 12 }}>{v.toLocaleString()} <Text type="secondary" style={{ fontSize: 10 }}>{(r.existingBaselineUnit || "tons").replace("m3", "m³")}</Text></Text>
        ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
      },
    },
    {
      title: "Total Since Operation",
      width: 140,
      render: (_, r) => {
        const v = r.totalVolumeSinceOperation ?? 0;
        return v > 0 ? (
          <Text style={{ fontSize: 12 }}>{v.toLocaleString()} <Text type="secondary" style={{ fontSize: 10 }}>{(r.totalVolumeSinceOperationUnit || "tons").replace("m3", "m³")}</Text></Text>
        ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
      },
    },
    {
      title: "Accredited Haulers",
      width: 110,
      align: "center",
      render: (_, r) => {
        const cnt = r.accreditedHaulers?.length || 0;
        return cnt > 0 ? <Tag color="blue">{cnt} hauler{cnt > 1 ? "s" : ""}</Tag> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
      },
    },
    {
      title: "Submissions",
      width: 100,
      align: "center",
      render: (_, r) => {
        const st = statsMap[r._id];
        if (!st) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        return (
          <div style={{ lineHeight: 1.3 }}>
            <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>{st.totalEntries}</Tag>
            {st.pendingCount > 0 && <Tag color="orange" style={{ margin: "2px 0 0", fontSize: 10, display: "block" }}>⏳ {st.pendingCount} pending</Tag>}
          </div>
        );
      },
    },
    {
      title: "Status",
      width: 80,
      align: "center",
      dataIndex: "isActive",
      render: (v) => v ? <Tag color="success">Active</Tag> : <Tag color="error">Inactive</Tag>,
    },
    {
      title: "Actions",
      width: 100,
      render: (_, r) => (
        <Space size={4}>
          {canEdit && (
            <Tooltip title="Edit Generator">
              <Button type="text" size="small" icon={<EditOutlined style={{ color: ACCENT }} />} onClick={() => openEdit(r)} />
            </Tooltip>
          )}
          {canDelete && (
            <Popconfirm title="Delete this generator?" onConfirm={() => handleDelete(r._id)} okButtonProps={{ danger: true }}>
              <Tooltip title="Delete">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const STATUS_OPTS = [
    { label: "All", value: null },
    { label: "Pending", value: "pending", color: "orange" },
    { label: "Acknowledged", value: "acknowledged", color: "green" },
    { label: "Rejected", value: "rejected", color: "red" },
    { label: "Reverted", value: "reverted", color: "volcano" },
  ];

  const subColumns = [
    {
      title: "ID No.",
      dataIndex: "idNo",
      width: 160,
      render: (t) => <Text strong style={{ fontSize: 11, fontFamily: "monospace" }}>{t}</Text>,
    },
    {
      title: "SLF / Generator",
      key: "slfName",
      width: 150,
      render: (_, r) => r.slfGenerator?.slfName ? (
        <Tag icon={<BankOutlined />} color="geekblue" style={{ fontSize: 10 }}>{r.slfGenerator.slfName}</Tag>
      ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
      filters: generators.map((g) => ({ text: g.slfName, value: g._id })),
      onFilter: (val, r) => (r.slfGenerator?._id || r.slfGenerator) === val,
    },
    {
      title: "Company",
      dataIndex: "lguCompanyName",
      ellipsis: true,
      render: (v, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <Text style={{ fontSize: 12 }}>{v || "—"}</Text>
          {r.companyType && <div><Tag style={{ fontSize: 9, marginTop: 2 }} color={r.companyType === "LGU" ? "blue" : "purple"}>{r.companyType}</Tag></div>}
        </div>
      ),
    },
    {
      title: "Date",
      dataIndex: "dateOfDisposal",
      width: 100,
      render: (v) => v ? <Text style={{ fontSize: 11 }}>{dayjs(v).format("MMM DD, YYYY")}</Text> : "—",
      sorter: (a, b) => new Date(a.dateOfDisposal || 0) - new Date(b.dateOfDisposal || 0),
    },
    {
      title: "Trucks",
      width: 65,
      align: "center",
      render: (_, r) => {
        const cnt = r.trucks?.length || 0;
        return cnt > 0 ? <Tag color="cyan">{cnt}</Tag> : <Text type="secondary">0</Text>;
      },
    },
    {
      title: "Volume",
      width: 110,
      render: (_, r) => {
        const vol = (r.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
        return vol > 0 ? <Text strong style={{ fontSize: 12, color: "#2f54eb" }}>{vol.toLocaleString()} <Text type="secondary" style={{ fontSize: 10 }}>tons</Text></Text> : "—";
      },
      sorter: (a, b) => {
        const va = (a.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
        const vb = (b.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
        return va - vb;
      },
    },
    {
      title: "Waste Types",
      width: 140,
      render: (_, r) => {
        const trucks = r.trucks || [];
        const residual = trucks.filter((t) => !(t.wasteType || "").toLowerCase().includes("haz") && !(t.wasteType || "").toLowerCase().includes("inert"));
        const haz = trucks.filter((t) => (t.wasteType || "").toLowerCase().includes("haz") || (t.wasteType || "").toLowerCase().includes("inert"));
        if (!trucks.length) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
        return (
          <Space size={4} wrap>
            {residual.length > 0 && <Tag color="green" style={{ fontSize: 10 }}><CheckCircleOutlined /> {residual.length} Residual</Tag>}
            {haz.length > 0 && <Tag color="red" style={{ fontSize: 10 }}>⚠ {haz.length} Haz/Inert</Tag>}
          </Space>
        );
      },
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 110,
      render: (v, r) => {
        const color = v === "acknowledged" ? "green" : v === "rejected" ? "red" : v === "reverted" ? "volcano" : v === "revert_requested" ? "gold" : "orange";
        return (
          <div>
            <Tag color={color} style={{ fontSize: 10 }}>{v}</Tag>
            {r.revertRequested && <Tag color="gold" style={{ fontSize: 9, marginTop: 2, display: "block" }}>Revert Req.</Tag>}
          </div>
        );
      },
      filters: [
        { text: "Pending", value: "pending" },
        { text: "Acknowledged", value: "acknowledged" },
        { text: "Rejected", value: "rejected" },
        { text: "Reverted", value: "reverted" },
      ],
      onFilter: (val, r) => r.status === val,
    },
    {
      title: "Submitted",
      dataIndex: "createdAt",
      width: 110,
      render: (v) => v ? <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(v).format("MMM DD, YYYY")}</Text> : "—",
      sorter: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
      defaultSortOrder: "descend",
    },
    {
      title: "Actions",
      key: "actions",
      width: 160,
      render: (_, r) => (
        <Space size={2}>
          {r.submissionId && (
            <Tooltip title="Transaction History">
              <Button type="text" size="small" icon={<HistoryOutlined style={{ color: "#722ed1" }} />} onClick={() => openTxnHistory(r.submissionId)} />
            </Tooltip>
          )}
          {r.submittedBy && (
            <Tooltip title="Send Email">
              <Button type="text" size="small" icon={<MailOutlined style={{ color: "#1677ff" }} />} onClick={() => openEmailModal(r)} />
            </Tooltip>
          )}
          {r.status !== "reverted" && (
            <Tooltip title="Revert Submission">
              <Button type="text" size="small" icon={<UndoOutlined style={{ color: "#fa541c" }} />} onClick={() => { setRevertModal({ open: true, record: r }); setRevertReason(""); }} />
            </Tooltip>
          )}
          {r.revertRequested && (
            <Tooltip title={`Revert requested: ${r.revertReason || "No reason"}`}>
              <Popconfirm
                title="Approve Revert?"
                description="This will set the submission back to Pending for the portal user to edit."
                onConfirm={async () => {
                  try {
                    await api.patch(`/data-slf/${r._id}/approve-revert`);
                    fetchSubmissions();
                    Swal.fire({ icon: "success", title: "Reverted", text: "Submission reverted to Pending.", confirmButtonColor: ACCENT, timer: 2000 });
                  } catch (err) {
                    Swal.fire({ icon: "error", title: "Error", text: err.response?.data?.message || "Failed to revert" });
                  }
                }}
                okText="Approve Revert"
                okButtonProps={{ style: { background: "#fa8c16", borderColor: "#fa8c16" } }}
              >
                <Button type="text" size="small" icon={<Badge dot><UndoOutlined style={{ color: "#fa8c16" }} /></Badge>} />
              </Popconfirm>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const VolumeRow = ({ label, nameVal, nameUnit }) => (
    <Row gutter={8}>
      <Col xs={16}>
        <Form.Item label={label} name={nameVal}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
      </Col>
      <Col xs={8}>
        <Form.Item label="Unit" name={nameUnit}>
          <Select options={unitOptions} />
        </Form.Item>
      </Col>
    </Row>
  );

  return (
    <>
      {/* ── Summary Stats ──────────────────────────────────────────── */}
      <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ borderRadius: 10, borderLeft: `3px solid ${ACCENT}` }} bodyStyle={{ padding: "10px 14px" }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Total Generators</span>} value={generators.length} valueStyle={{ fontSize: 20 }} prefix={<DatabaseOutlined style={{ color: ACCENT, fontSize: 13 }} />} />
            <Text type="secondary" style={{ fontSize: 10 }}>{generators.filter((g) => g.isActive).length} active</Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ borderRadius: 10, borderLeft: "3px solid #1677ff" }} bodyStyle={{ padding: "10px 14px" }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Total Submissions</span>} value={overallStats.totalEntries} valueStyle={{ fontSize: 20 }} prefix={<FileTextOutlined style={{ color: "#1677ff", fontSize: 13 }} />} />
            <Text type="secondary" style={{ fontSize: 10 }}>{submissions.length} entries loaded</Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ borderRadius: 10, borderLeft: "3px solid #faad14" }} bodyStyle={{ padding: "10px 14px" }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Pending Reviews</span>} value={overallStats.pendingCount} valueStyle={{ fontSize: 20, color: "#faad14" }} prefix={<AlertOutlined style={{ color: "#faad14", fontSize: 13 }} />} />
            <Text type="secondary" style={{ fontSize: 10 }}>Awaiting acknowledgement</Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ borderRadius: 10, borderLeft: "3px solid #52c41a" }} bodyStyle={{ padding: "10px 14px" }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Acknowledged</span>} value={overallStats.acknowledgedCount} valueStyle={{ fontSize: 20, color: "#52c41a" }} prefix={<CheckCircleOutlined style={{ color: "#52c41a", fontSize: 13 }} />} />
            <Text type="secondary" style={{ fontSize: 10 }}>Confirmed submissions</Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ borderRadius: 10, borderLeft: "3px solid #fa8c16" }} bodyStyle={{ padding: "10px 14px" }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Revert Requests</span>} value={revertRequestCount} valueStyle={{ fontSize: 20, color: revertRequestCount > 0 ? "#fa8c16" : undefined }} prefix={<UndoOutlined style={{ color: "#fa8c16", fontSize: 13 }} />} />
            <Text type="secondary" style={{ fontSize: 10 }}>Pending revert approval</Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ borderRadius: 10, borderLeft: "3px solid #722ed1" }} bodyStyle={{ padding: "10px 14px" }}>
            <Statistic title={<span style={{ fontSize: 11 }}>Total Volume</span>} value={overallStats.totalVolume} valueStyle={{ fontSize: 20, color: "#722ed1" }} prefix={<DatabaseOutlined style={{ color: "#722ed1", fontSize: 13 }} />} formatter={(v) => Number(v).toLocaleString()} />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <Tag color="green" style={{ fontSize: 9 }}>R: {submissionWasteStats.residual.toLocaleString()}</Tag>
              <Tag color="red" style={{ fontSize: 9 }}>H: {submissionWasteStats.haz.toLocaleString()}</Tag>
            </Text>
          </Card>
        </Col>
      </Row>

      {/* ── Generator Registry ───────────────────────────────────────── */}
      <Card
        size="small"
        style={{ borderRadius: 10, marginBottom: 16 }}
        bodyStyle={{ padding: 0 }}
        title={
          <Space>
            <DatabaseOutlined style={{ color: ACCENT }} />
            <Text strong>SLF Generator Registry</Text>
            <Tag bordered={false} color="blue">{generators.length} generators</Tag>
          </Space>
        }
        extra={
          canEdit && (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={openAdd}
              style={{ background: ACCENT, borderColor: ACCENT }}
            >
              Add Generator
            </Button>
          )
        }
      >
        <Table
          dataSource={generators}
          columns={genColumns}
          rowKey="_id"
          loading={loadingGen}
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `${t} generators` }}
          scroll={{ x: 800 }}
          expandable={{
            expandedRowRender: (g) => {
              const st = statsMap[g._id];
              const facList = slfRecords.filter((sr) => {
                const gid = typeof sr.slfGenerator === "object" ? sr.slfGenerator?._id : sr.slfGenerator;
                return gid === g._id;
              });
              return (
                <div style={{ padding: "10px 16px", background: isDark ? "rgba(47,84,235,0.04)" : "#f8faff", borderRadius: 8 }}>
                  <Row gutter={[16, 12]}>
                    {st && (
                      <Col xs={24} sm={12}>
                        <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Submission Stats</Text>
                        <Row gutter={8} style={{ marginTop: 6 }}>
                          {[
                            { label: "Total", value: st.totalEntries, color: "#1677ff" },
                            { label: "Pending", value: st.pendingCount, color: "#faad14" },
                            { label: "Acknowledged", value: st.acknowledgedCount, color: "#52c41a" },
                            { label: "Volume", value: `${(st.totalVolume || 0).toLocaleString()} t`, color: "#722ed1" },
                          ].map((item, idx) => (
                            <Col key={idx} xs={12} sm={6}>
                              <div style={{ background: `${item.color}10`, borderRadius: 6, padding: "6px 10px", border: `1px solid ${item.color}25` }}>
                                <div style={{ fontSize: 9, color: "#8c8c8c", textTransform: "uppercase" }}>{item.label}</div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
                              </div>
                            </Col>
                          ))}
                        </Row>
                      </Col>
                    )}
                    {facList.length > 0 && (
                      <Col xs={24} sm={12}>
                        <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Linked SLF Facilities</Text>
                        <div style={{ marginTop: 6 }}>
                          {facList.slice(0, 3).map((fac) => (
                            <div key={fac._id} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                              <BankOutlined style={{ color: ACCENT }} />
                              <Text style={{ fontSize: 11 }}>{fac.lgu}, {fac.province}</Text>
                              {fac.statusOfSLF && <Tag style={{ fontSize: 9 }} color={fac.statusOfSLF.toLowerCase().includes("non") ? "red" : "green"}>{fac.statusOfSLF}</Tag>}
                              {fac.numberOfCell > 0 && <Tag style={{ fontSize: 9 }} color="cyan">{fac.numberOfCell} cell{fac.numberOfCell > 1 ? "s" : ""}</Tag>}
                            </div>
                          ))}
                          {facList.length > 3 && <Text type="secondary" style={{ fontSize: 10 }}>+{facList.length - 3} more</Text>}
                        </div>
                      </Col>
                    )}
                    {(g.accreditedHaulers || []).length > 0 && (
                      <Col xs={24}>
                        <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>Accredited Haulers</Text>
                        <Space size={4} wrap style={{ marginTop: 6 }}>
                          {g.accreditedHaulers.map((h, i) => (
                            <Tag key={i} color="blue" style={{ fontSize: 10 }}>{h.haulerName} {h.numberOfTrucks ? `(${h.numberOfTrucks} trucks)` : ""}</Tag>
                          ))}
                        </Space>
                      </Col>
                    )}
                  </Row>
                </div>
              );
            },
            rowExpandable: (g) => !!(statsMap[g._id] || linkedFacilities[g._id] || (g.accreditedHaulers || []).length),
          }}
        />
      </Card>

      {/* ── Portal Submissions ────────────────────────────────────────── */}
      <Card
        size="small"
        style={{ borderRadius: 10 }}
        bodyStyle={{ padding: 0 }}
        title={
          <Space wrap>
            <FileTextOutlined style={{ color: ACCENT }} />
            <Text strong>Portal Submitted Data</Text>
            <Tag bordered={false} color="blue">{filteredSubmissions.length} / {submissions.length}</Tag>
            {revertRequestCount > 0 && (
              <Badge count={revertRequestCount} style={{ backgroundColor: "#fa8c16" }} title="Revert requests pending" />
            )}
          </Space>
        }
        extra={
          <Tooltip title="Refresh submissions">
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchSubmissions} loading={loadingSub} />
          </Tooltip>
        }
      >
        {/* Toolbar: search + status chips */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Input
            placeholder="Search by ID, company, SLF, email..."
            prefix={<SearchOutlined style={{ color: "#8c8c8c" }} />}
            value={submissionSearch}
            onChange={(e) => setSubmissionSearch(e.target.value)}
            allowClear
            size="small"
            style={{ width: 260 }}
          />
          <Space size={4} wrap>
            {STATUS_OPTS.map((opt) => (
              <Button
                key={String(opt.value)}
                size="small"
                type={submissionStatusFilter === opt.value ? "primary" : "default"}
                onClick={() => setSubmissionStatusFilter(opt.value)}
                style={submissionStatusFilter === opt.value ? { background: ACCENT, borderColor: ACCENT } : {}}
              >
                {opt.label}
                {opt.value && (
                  <Tag
                    bordered={false}
                    color={submissionStatusFilter === opt.value ? undefined : opt.color}
                    style={{ marginLeft: 4, fontSize: 10, padding: "0 4px" }}
                  >
                    {submissions.filter((s) => s.status === opt.value).length}
                  </Tag>
                )}
              </Button>
            ))}
          </Space>
        </div>
        <Table
          dataSource={filteredSubmissions}
          rowKey="_id"
          loading={loadingSub}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} entries`, pageSizeOptions: ["10", "20", "50"] }}
          scroll={{ x: 1200 }}
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={setExpandedRowKeys}
          expandable={{
            expandedRowRender: (r) => {
              const trucks = r.trucks || [];
              if (!trucks.length) return <Empty description="No truck entries" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
              return (
                <div style={{ padding: "8px 16px" }}>
                  <Table
                    dataSource={trucks}
                    rowKey={(_, i) => i}
                    size="small"
                    pagination={false}
                    columns={[
                      { title: "Ticket No.", dataIndex: "disposalTicketNo", width: 130, render: (v) => <Text style={{ fontSize: 11, fontFamily: "monospace" }}>{v || "—"}</Text> },
                      { title: "Hauler", dataIndex: "hauler", ellipsis: true, render: (v) => v || "—" },
                      { title: "Plate No.", dataIndex: "plateNumber", width: 110 },
                      { title: "Truck Cap.", width: 100, render: (_, t) => t.truckCapacity ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}` : "—" },
                      { title: "Actual Volume", width: 110, render: (_, t) => t.actualVolume != null ? <Text strong style={{ color: "#2f54eb" }}>{t.actualVolume} {(t.actualVolumeUnit || "tons").replace("m3", "m³")}</Text> : "—" },
                      { title: "Waste Type", dataIndex: "wasteType", width: 130, render: (v) => v ? <Tag color={(v || "").toLowerCase().includes("haz") || (v || "").toLowerCase().includes("inert") ? "red" : "green"} style={{ fontSize: 10 }}>{v}</Tag> : "—" },
                    ]}
                  />
                </div>
              );
            },
            rowExpandable: (r) => (r.trucks || []).length > 0,
          }}
          columns={subColumns}
        />
      </Card>

      <Modal
        title={editing ? "Edit Generator" : "Add Generator"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={720}
        okText="Save"
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" size="small">
          <Form.Item
            label="SLF Name"
            name="slfName"
            rules={[{ required: true }]}
          >
            <Input placeholder="SLF name" />
          </Form.Item>
          <Form.Item label="Active" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Divider orientation="left" plain>
            Volume / Baseline Info
          </Divider>
          <VolumeRow
            label="Existing Baseline Volume"
            nameVal="existingBaselineVolume"
            nameUnit="existingBaselineUnit"
          />
          <VolumeRow
            label="Total Volume Since Operation"
            nameVal="totalVolumeSinceOperation"
            nameUnit="totalVolumeSinceOperationUnit"
          />
          <VolumeRow
            label="Active Cells Volume"
            nameVal="totalVolumeActiveCells"
            nameUnit="totalVolumeActiveCellsUnit"
          />
          <VolumeRow
            label="Closed Cells Volume"
            nameVal="totalVolumeClosedCells"
            nameUnit="totalVolumeClosedCellsUnit"
          />
          <Divider orientation="left" plain>
            Accredited Haulers
          </Divider>
          <Form.List name="accreditedHaulers">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...rest }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 8 }}
                    extra={
                      <MinusCircleOutlined
                        style={{ color: "red" }}
                        onClick={() => remove(name)}
                      />
                    }
                  >
                    <Row gutter={12}>
                      <Col span={10}>
                        <Form.Item
                          {...rest}
                          name={[name, "haulerName"]}
                          label="Name"
                          rules={[{ required: true }]}
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item
                          {...rest}
                          name={[name, "numberOfTrucks"]}
                          label="Trucks"
                        >
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          {...rest}
                          name={[name, "privateSectorClients"]}
                          label="Clients"
                        >
                          <Input />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                ))}
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  icon={<PlusOutlined />}
                >
                  Add Hauler
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Transaction History Modal */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: isDark ? "rgba(47,84,235,0.1)" : "#f0f5ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <HistoryOutlined style={{ color: "#722ed1", fontSize: 16 }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                Transaction History
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {txnHistoryModal.submissionId}
              </Text>
            </div>
          </div>
        }
        open={txnHistoryModal.open}
        onCancel={() => setTxnHistoryModal({ open: false, submissionId: null })}
        footer={
          <Button
            block
            onClick={() =>
              setTxnHistoryModal({ open: false, submissionId: null })
            }
          >
            Close
          </Button>
        }
        width={1200}
        zIndex={1100}
      >
        {txnHistoryLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}><Spin /></div>
        ) : txnHistoryData.length === 0 ? (
          <Empty description="No transactions found" />
        ) : (
          <Table
            dataSource={txnHistoryData}
            rowKey={(t) => t._id}
            size="small"
            pagination={{ pageSize: 10, size: "small", showSizeChanger: true, pageSizeOptions: ["10", "20", "50"] }}
            scroll={{ y: 400 }}
            columns={[
              {
                title: "#",
                key: "idx",
                width: 45,
                render: (_, __, i) => <Text type="secondary">{i + 1}</Text>,
              },
              {
                title: "Type",
                dataIndex: "type",
                key: "type",
                width: 120,
                render: (v) => (
                  <Tag
                    bordered={false}
                    color={
                      v === "submission"
                        ? "blue"
                        : v === "email_ack_sent"
                          ? "green"
                          : v === "email_ack_failed"
                            ? "red"
                            : v === "status_change"
                              ? "orange"
                              : v === "revert_approved"
                                ? "volcano"
                                : v === "resubmission"
                                  ? "cyan"
                                  : "default"
                    }
                    style={{ margin: 0, fontSize: 11 }}
                  >
                    {v === "submission"
                      ? "Submission"
                      : v === "email_ack_sent"
                        ? "Email Sent"
                        : v === "email_ack_failed"
                          ? "Email Failed"
                          : v === "status_change"
                            ? "Status Change"
                            : v === "revert_approved"
                              ? "Revert Approved"
                              : v === "resubmission"
                                ? "Resubmission"
                                : v === "deleted"
                                  ? "Deleted"
                                  : v}
                  </Tag>
                ),
              },
              {
                title: "Description",
                dataIndex: "description",
                key: "desc",
                ellipsis: false,
                render: (v) => <Text style={{ fontSize: 11 }}>{v}</Text>,
              },
              {
                title: "Message",
                key: "msg",
                width: 250,
                ellipsis: false,
                render: (_, t) => {
                  const msg = t.meta?.comment || t.meta?.reason || "";
                  return msg ? (
                    <Text
                      style={{
                        fontSize: 12,
                        color: t.meta?.comment ? (isDark ? "#7eb8da" : "#1a3353") : "#fa541c",
                        fontStyle: "italic",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {msg}
                    </Text>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      —
                    </Text>
                  );
                },
              },
              {
                title: "Performed By",
                dataIndex: "performedBy",
                key: "by",
                width: 200,
                render: (v) => (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {v || "system"}
                  </Text>
                ),
              },
              {
                title: "Date / Time",
                dataIndex: "createdAt",
                key: "date",
                width: 150,
                render: (v) => (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(v).format("MMM DD, YYYY hh:mm A")}
                  </Text>
                ),
              },
            ]}
          />
        )}
      </Modal>

      {/* Send Email Modal */}
      <Modal
        title={<Space><MailOutlined /> Send Email to Portal User</Space>}
        open={emailModal.open}
        onCancel={() => setEmailModal({ open: false, record: null })}
        onOk={handleSendEmail}
        confirmLoading={emailSending}
        okText={<><SendOutlined /> Send Email</>}
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
        width={560}
      >
        {emailModal.record && (
          <div>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="To">{emailModal.record.submittedBy}</Descriptions.Item>
              <Descriptions.Item label="Company">{emailModal.record.lguCompanyName || "—"}</Descriptions.Item>
              <Descriptions.Item label="Submission">{emailModal.record.submissionId || emailModal.record.idNo}</Descriptions.Item>
            </Descriptions>
            <Form layout="vertical" size="small">
              <Form.Item label="Subject" required>
                <Input
                  placeholder="e.g. Missing requirements for your submission"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
              </Form.Item>
              <Form.Item label="Message" required>
                <Input.TextArea
                  rows={5}
                  placeholder="Type your message to the portal user..."
                  value={emailMessage}
                  onChange={(e) => setEmailMessage(e.target.value)}
                />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>

      {/* Admin Revert Modal */}
      <Modal
        title={<Space><UndoOutlined style={{ color: "#fa541c" }} /> Revert Submission</Space>}
        open={revertModal.open}
        onCancel={() => setRevertModal({ open: false, record: null })}
        onOk={handleAdminRevert}
        confirmLoading={revertLoading}
        okText="Revert Submission"
        okButtonProps={{ style: { background: "#fa541c", borderColor: "#fa541c" } }}
        width={520}
      >
        {revertModal.record && (
          <div>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="ID No.">{revertModal.record.idNo || "—"}</Descriptions.Item>
              <Descriptions.Item label="Company">{revertModal.record.lguCompanyName || "—"}</Descriptions.Item>
              <Descriptions.Item label="Submitted By">{revertModal.record.submittedBy || "—"}</Descriptions.Item>
              <Descriptions.Item label="Current Status"><Tag color={revertModal.record.status === "acknowledged" ? "green" : "orange"}>{revertModal.record.status}</Tag></Descriptions.Item>
            </Descriptions>
            <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
              This will revert the submission back to the portal user. The portal user will see this entry
              on their Submission History and can update and resubmit it.
            </Text>
            <Form layout="vertical" size="small">
              <Form.Item label="Reason for Revert" required>
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
    </>
  );
}

// ── Main Component ──
export default function SLFMonitoring({canEdit = true, canDelete = true, isDark}) {
  const { getValues } = useDataRef();
  const provinceOptions = getValues("province").map((p) => ({ label: p, value: p }));
  const monthOptions = getValues("target-month").map((m) => ({ label: m.replace(/^\d+\./, ""), value: m }));
  const mbaOptions = getValues("manila-bay-area").map((v) => ({ label: v, value: v }));
  const slfStatusOptions = getValues("slf-status").map((v) => ({ label: v, value: v }));
  const ownershipOptions = getValues("ownership").map((v) => ({ label: v, value: v }));
  const wasteTypeOptions = getValues("waste-type").map((v) => ({ label: v, value: v }));
  const enmoOptions = getValues("enmo").map((v) => ({ label: v, value: v }));
  const eswmStaffOptions = getValues("eswm-staff").map((v) => ({ label: v, value: v }));
  const focalOptions = getValues("eswm-focal").map((v) => ({ label: v, value: v }));

  const [records, setRecords] = useState([]);
  const [generators, setGenerators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingGen, setLoadingGen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [detailYearRecords, setDetailYearRecords] = useState([]);
  const [detailYear, setDetailYear] = useState(null);
  const [baselineData, setBaselineData] = useState(null);
  const [loadingBaseline, setLoadingBaseline] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editYear, setEditYear] = useState(null);
  const [editYearRecords, setEditYearRecords] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [filterProvince, setFilterProvince] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterMonth, setFilterMonth] = useState(null);
  const [quickFilter, setQuickFilter] = useState(null);
  const [slfLguModal, setSlfLguModal] = useState(false);
  const [slfWasteModal, setSlfWasteModal] = useState(false);
  const [form] = Form.useForm();

  const fetchRecords = useCallback(async (skipCache = false) => {
    setLoading(true);
    try {
      if (!skipCache) {
        const cached = secureStorage.getJSON(CACHE_KEY);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setRecords(cached.data.map((r) => ({ ...r, ...computeFields(r) })));
          setLoading(false);
          return;
        }
      }
      const { data } = await api.get("/slf-facilities");
      const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
      setRecords(enriched);
      secureStorage.setJSON(CACHE_KEY, { data, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Failed to load records", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGenerators = useCallback(async () => {
    setLoadingGen(true);
    try {
      const { data } = await api.get("/slf-generators");
      setGenerators(data);
    } catch {
      /* silent */
    } finally {
      setLoadingGen(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    fetchGenerators();
  }, [fetchRecords, fetchGenerators]);

  // Fetch baseline data when detail modal opens for a facility with linked generator
  useEffect(() => {
    if (!detailModal) {
      setBaselineData(null);
      return;
    }
    const gen = detailModal.slfGenerator;
    const slfName =
      gen && typeof gen === "object" ? gen.slfName : null;
    if (!slfName) {
      setBaselineData(null);
      return;
    }
    setLoadingBaseline(true);
    api
      .get(`/data-slf/baseline/${encodeURIComponent(slfName)}`)
      .then(({ data }) => setBaselineData(data))
      .catch(() => setBaselineData(null))
      .finally(() => setLoadingBaseline(false));
  }, [detailModal]);

  // Fetch cross-year history when viewing a facility record
  useEffect(() => {
    if (!detailModal) { setDetailYearRecords([]); setDetailYear(null); return; }
    const lgu = detailModal.lgu;
    if (!lgu) { setDetailYearRecords([]); setDetailYear(detailModal.dataYear || new Date().getFullYear()); return; }
    api.get(`/slf-facilities/history/${encodeURIComponent(lgu)}`)
      .then(({ data }) => {
        const enriched = data.map((r) => ({ ...r, ...computeFields(r) }));
        setDetailYearRecords(enriched);
        setDetailYear(detailModal.dataYear || new Date().getFullYear());
      })
      .catch(() => { setDetailYearRecords([]); setDetailYear(detailModal.dataYear || new Date().getFullYear()); });
  }, [detailModal]);

  const detailViewRecord = useMemo(() => {
    if (!detailModal) return null;
    if (detailYearRecords.length === 0) return detailModal;
    return detailYearRecords.find((r) => (r.dataYear || new Date().getFullYear()) === detailYear) || null;
  }, [detailModal, detailYearRecords, detailYear]);

  const generatorOptions = useMemo(
    () => generators.map((g) => ({ label: g.slfName, value: g._id })),
    [generators],
  );

  const toFileList = (arr) =>
    (arr || []).map((item, i) =>
      typeof item === "string"
        ? { uid: `existing-${i}`, name: item.split("/").pop() || item, status: "done", url: item }
        : item
    );

  const populateForm = (record) => {
    form.setFieldsValue({
      ...record,
      cellCapacities: record.cellCapacities || [],
      cellStatuses: record.cellStatuses || Array.from({ length: record.numberOfCell || 0 }, () => "Operational"),
      cellTypes: record.cellTypes || Array.from({ length: record.numberOfCell || 0 }, () => "Residual"),
      leachatePondDetails: (record.leachatePondDetails || []).map((p) => ({ ...p, attachments: toFileList(p.attachments) })),
      gasVentDetails: (record.gasVentDetails || []).map((v) => ({ ...v, attachments: toFileList(v.attachments) })),
      dateOfMonitoring: record.dateOfMonitoring ? dayjs(record.dateOfMonitoring) : null,
      dateReportPrepared: record.dateReportPrepared ? dayjs(record.dateReportPrepared) : null,
      dateReportReviewedStaff: record.dateReportReviewedStaff ? dayjs(record.dateReportReviewedStaff) : null,
      dateReportReviewedFocal: record.dateReportReviewedFocal ? dayjs(record.dateReportReviewedFocal) : null,
      dateReportApproved: record.dateReportApproved ? dayjs(record.dateReportApproved) : null,
    });
  };

  const openAdd = () => {
    setEditing(null);
    setEditYear(new Date().getFullYear());
    setEditYearRecords([]);
    form.resetFields();
    setModalOpen(true);
  };
  const openEdit = (record) => {
    const yr = record.dataYear || new Date().getFullYear();
    setEditing(record);
    setEditYear(yr);
    populateForm(record);
    // Fetch all year records for this LGU
    if (record.lgu) {
      api.get(`/slf-facilities/history/${encodeURIComponent(record.lgu)}`)
        .then(({ data }) => setEditYearRecords(data))
        .catch(() => setEditYearRecords([]));
    } else {
      setEditYearRecords([]);
    }
    setModalOpen(true);
  };

  const handleEditYearChange = (yr) => {
    setEditYear(yr);
    const match = editYearRecords.find((r) => (r.dataYear || new Date().getFullYear()) === yr);
    if (match) {
      setEditing(match);
      form.resetFields();
      populateForm(match);
    } else {
      // Blank record for this year — keep location fields from current editing
      const current = editing || {};
      setEditing({ _id: null, lgu: current.lgu, province: current.province, barangay: current.barangay, latitude: current.latitude, longitude: current.longitude, eccNo: current.eccNo });
      form.resetFields();
      form.setFieldsValue({ province: current.province, lgu: current.lgu, barangay: current.barangay, latitude: current.latitude, longitude: current.longitude, eccNo: current.eccNo });
    }
  };

  const handleSave = async () => {
    if (!editYear) {
      Swal.fire("Year Required", "Please select a year before saving.", "warning");
      return;
    }
    try {
      const values = await form.validateFields();
      const fromFileList = (fl) =>
        (fl || [])
          .filter((f) => f.status !== "error" && f.status !== "uploading")
          .map((f) => f.response?.url || f.url || f.name || "")
          .filter(Boolean);
      const payload = {
        ...values,
        dataYear: editYear,
        leachatePondDetails: (values.leachatePondDetails || []).map((p) => ({ ...p, attachments: fromFileList(p.attachments) })),
        gasVentDetails: (values.gasVentDetails || []).map((v) => ({ ...v, attachments: fromFileList(v.attachments) })),
        dateOfMonitoring: values.dateOfMonitoring?.toISOString(),
        dateReportPrepared: values.dateReportPrepared?.toISOString(),
        dateReportReviewedStaff: values.dateReportReviewedStaff?.toISOString(),
        dateReportReviewedFocal: values.dateReportReviewedFocal?.toISOString(),
        dateReportApproved: values.dateReportApproved?.toISOString(),
      };
      Object.assign(payload, computeFields(payload));
      if (editing && editing._id) {
        const { data } = await api.put(
          `/slf-facilities/${editing._id}`,
          payload,
        );
        setRecords((prev) => {
          const exists = prev.some((r) => r._id === data._id);
          if (exists) return prev.map((r) => r._id === data._id ? { ...data, ...computeFields(data) } : r);
          return [...prev, { ...data, ...computeFields(data) }];
        });
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Updated", `Record updated for year ${editYear}`, "success");
      } else {
        await api.post("/slf-facilities", payload);
        secureStorage.remove(CACHE_KEY);
        secureStorage.invalidateDashboard();
        Swal.fire("Created", `Record added for year ${editYear}`, "success");
        fetchRecords();
      }
    } catch (err) {
      if (err.response)
        Swal.fire(
          "Error",
          err.response.data?.message || "Save failed",
          "error",
        );
    }
    setModalOpen(false);
  };

  const reviewAndDeleteRecord = async (record) => {
    const reviewHtml = `
      <div style="text-align:left;font-size:13px;line-height:1.7;">
        <div><strong>LGU:</strong> ${record.lgu || "N/A"}</div>
        <div><strong>Province:</strong> ${record.province || "N/A"}</div>
        <div><strong>Data Year:</strong> ${record.dataYear || "N/A"}</div>
        <div><strong>Status:</strong> ${record.statusOfSLF || "N/A"}</div>
        <div><strong>Category:</strong> ${record.category || "N/A"}</div>
      </div>
    `;

    const result = await Swal.fire({
      icon: "warning",
      title: "Review Before Deletion",
      html: `${reviewHtml}<p style="margin-top:12px;">This record will be moved to Deleted SLF Data in Developer Settings.</p>`,
      showCancelButton: true,
      confirmButtonText: "Move to Trash",
      confirmButtonColor: "#ff4d4f",
      cancelButtonText: "Cancel",
    });

    if (!result.isConfirmed) return;

    try {
      await api.delete(`/slf-facilities/${record._id}`);
      setRecords((prev) => prev.filter((r) => r._id !== record._id));
      secureStorage.remove(CACHE_KEY);
      secureStorage.invalidateDashboard();
      Swal.fire({ icon: "success", title: "Moved to Trash", timer: 1100, showConfirmButton: false });
    } catch {
      Swal.fire("Error", "Failed to delete record", "error");
    }
  };

  // Available years from data — kept for edit/detail modals (year navigation)
  const availableYears = useMemo(() => {
    const cy = new Date().getFullYear();
    const years = [...new Set([cy, cy - 1, ...records.map((r) => r.dataYear || cy)])];
    return years.sort((a, b) => b - a);
  }, [records]);

  const filtered = useMemo(() => {
    let data = records;
    if (searchText) {
      const q = searchText.toLowerCase();
      data = data.filter((r) =>
        [
          r.province,
          r.lgu,
          r.barangay,
          r.enmo,
          r.focalPerson,
          r.ownership,
        ].some((v) => v && v.toLowerCase().includes(q)),
      );
    }
    if (filterProvince)
      data = data.filter((r) => r.province === filterProvince);
    if (filterStatus) data = data.filter((r) => r.statusOfSLF === filterStatus);
    if (filterCategory)
      data = data.filter((r) => r.category === filterCategory);
    if (filterMonth) data = data.filter((r) => r.targetMonth === filterMonth);

    if (quickFilter === "operational") {
      data = data.filter((r) => /operational/i.test(r.statusOfSLF || "") && !/non/i.test(r.statusOfSLF || ""));
    }
    if (quickFilter === "withCells") {
      data = data.filter((r) => Number(r.numberOfCell || 0) > 0);
    }
    if (quickFilter === "withLGUs") {
      data = data.filter((r) => Number(r.noOfLGUServed || 0) > 0);
    }
    if (quickFilter === "private") {
      data = data.filter((r) => /private/i.test(r.ownership || ""));
    }
    if (quickFilter === "withCapacity") {
      data = data.filter((r) => Number(r.volumeCapacity || 0) > 0);
    }
    if (quickFilter === "withWaste") {
      data = data.filter((r) => Number(r.actualResidualWasteReceived || 0) > 0);
    }
    if (quickFilter === "withLeachate") {
      data = data.filter((r) => Number(r.noOfLeachatePond || 0) > 0);
    }
    if (quickFilter === "withGas") {
      data = data.filter((r) => Number(r.numberOfGasVents || 0) > 0);
    }

    // Deduplicate by LGU — keep only the latest dataYear record per facility
    const map = new Map();
    for (const r of data) {
      const key = (r.lgu || "").toLowerCase();
      const existing = map.get(key);
      if (!existing || (r.dataYear || 0) > (existing.dataYear || 0)) {
        map.set(key, r);
      }
    }
    return [...map.values()];
  }, [
    records,
    searchText,
    filterProvince,
    filterStatus,
    filterCategory,
    filterMonth,
    quickFilter,
  ]);

  const hasFilters =
    searchText ||
    filterProvince ||
    filterStatus ||
    filterCategory ||
    filterMonth ||
    quickFilter;
  const clearFilters = () => {
    setSearchText("");
    setFilterProvince(null);
    setFilterStatus(null);
    setFilterCategory(null);
    setFilterMonth(null);
    setQuickFilter(null);
  };

  // Summary tiles
  const totalRecords = filtered.length;
  const opCount = filtered.filter(
    (r) => /operational/i.test(r.statusOfSLF) && !/non/i.test(r.statusOfSLF),
  ).length;
  const nonOpCount = filtered.filter((r) => /non/i.test(r.statusOfSLF)).length;
  const totalCapacity = filtered.reduce(
    (s, r) => s + (r.volumeCapacity || 0),
    0,
  );
  const totalLGUs = filtered.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
  const totalCells = filtered.reduce((s, r) => s + (r.numberOfCell || 0), 0);
  const totalLeachate = filtered.reduce(
    (s, r) => s + (r.noOfLeachatePond || 0),
    0,
  );
  const totalGasVents = filtered.reduce(
    (s, r) => s + (r.numberOfGasVents || 0),
    0,
  );
  const totalWaste = filtered.reduce(
    (s, r) => s + (r.actualResidualWasteReceived || 0),
    0,
  );
  const privateSectorCount = filtered.filter(
    (r) => /private/i.test(r.ownership),
  ).length;

  // Denominators — counts of records that have a value for each metric
  const cellsWithData = filtered.filter((r) => r.numberOfCell > 0).length;
  const lgusWithData = filtered.filter((r) => r.noOfLGUServed > 0).length;
  const capacityWithData = filtered.filter((r) => r.volumeCapacity > 0).length;
  const wasteWithData = filtered.filter((r) => r.actualResidualWasteReceived > 0).length;
  const leachateWithData = filtered.filter((r) => r.noOfLeachatePond > 0).length;
  const gasVentsWithData = filtered.filter((r) => r.numberOfGasVents > 0).length;
  const privateWithData = filtered.filter((r) => /private/i.test(r.ownership)).length;

  // Category descriptions
  const CATEGORY_DESC = {
    "Cat 1": "< 15 TPD",
    "Cat 2": "15–75 TPD",
    "Cat 3": "75–150 TPD",
    "Cat 4": "> 150 TPD",
  };

  const columns = [
    {
      title: "#",
      key: "idx",
      width: 50,
      render: (_, __, i) => i + 1,
    },
    {
      title: (
        <>
          <EnvironmentOutlined style={{ color: ACCENT }} /> LGU
        </>
      ),
      key: "lgu",
      width: 150,
      filters: buildFilters(records, "province"),
      onFilter: (v, r) => r.province === v,
      sorter: (a, b) => (a.lgu || "").localeCompare(b.lgu || ""),
      render: (_, r) => (
        <Tooltip
          title={`${r.province} — ${r.lgu}${r.barangay ? ` (${r.barangay})` : ""}`}
        >
          <div style={{ lineHeight: 1.3 }}>
            <Text strong style={{ fontSize: 12 }}>
              {r.lgu}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.province}
              {r.barangay ? ` · ${r.barangay}` : ""}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "MBA",
      dataIndex: "manilaBayArea",
      width: 70,
      filters: buildFilters(records, "manilaBayArea"),
      onFilter: (v, r) => r.manilaBayArea === v,
    },
    {
      title: "Ownership",
      dataIndex: "ownership",
      width: 100,
      filters: buildFilters(records, "ownership"),
      onFilter: (v, r) => r.ownership === v,
    },
    {
      title: "Category",
      dataIndex: "category",
      width: 130,
      render: (v) =>
        v ? (
          <Tooltip title={CATEGORY_DESC[v] || v}>
            <Tag color="blue" bordered={false}>
              {v}{CATEGORY_DESC[v] ? ` — ${CATEGORY_DESC[v]}` : ""}
            </Tag>
          </Tooltip>
        ) : (
          "—"
        ),
      filters: buildFilters(records, "category"),
      onFilter: (v, r) => r.category === v,
    },
    {
      title: (
        <>
          <SafetyCertificateOutlined style={{ color: "#52c41a" }} /> Status
        </>
      ),
      key: "status",
      width: 140,
      filters: buildFilters(records, "statusOfSLF"),
      onFilter: (v, r) => r.statusOfSLF === v,
      sorter: (a, b) =>
        (a.yearStartedOperation || 0) - (b.yearStartedOperation || 0),
      render: (_, r) => (
        <div style={{ lineHeight: 1.3 }}>
          {getStatusTag(r.statusOfSLF)}
          {r.yearStartedOperation && (
            <div>
              <Text type="secondary" style={{ fontSize: 10 }}>
                <CalendarOutlined style={{ marginRight: 3 }} />
                Since {r.yearStartedOperation}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Capacity",
      dataIndex: "volumeCapacity",
      width: 100,
      sorter: (a, b) => (a.volumeCapacity || 0) - (b.volumeCapacity || 0),
      render: (v) =>
        v != null ? (
          <Text strong style={{ color: ACCENT }}>
            {Number(v).toLocaleString()}
          </Text>
        ) : (
          "—"
        ),
    },
    {
      title: "LGUs Served",
      dataIndex: "noOfLGUServed",
      width: 100,
      sorter: (a, b) => (a.noOfLGUServed || 0) - (b.noOfLGUServed || 0),
    },
    { title: "Cells", dataIndex: "numberOfCell", width: 70 },
    { title: "Leachate", dataIndex: "noOfLeachatePond", width: 80 },
    { title: "Gas Vents", dataIndex: "numberOfGasVents", width: 80 },
    {
      title: "Waste (tons)",
      dataIndex: "actualResidualWasteReceived",
      width: 110,
      sorter: (a, b) =>
        (a.actualResidualWasteReceived || 0) -
        (b.actualResidualWasteReceived || 0),
      render: (v) => (v != null ? Number(v).toLocaleString() : "—"),
    },
    { title: "Lifespan", dataIndex: "remainingLifeSpan", width: 100 },
    {
      title: (
        <>
          <CalendarOutlined style={{ color: "#13c2c2" }} /> Target Month
        </>
      ),
      dataIndex: "targetMonth",
      key: "targetMonth",
      width: 220,
      ellipsis: true,
      filters: buildFilters(records, "targetMonth"),
      onFilter: (v, r) => r.targetMonth === v,
      render: (v) =>
        v ? (
          <Tag bordered={false} color="cyan">
            {v.replace(/^\d+\./, "")}
          </Tag>
        ) : (
          "—"
        ),
    },
    {
      title: (
        <>
          <TeamOutlined style={{ color: "#722ed1" }} /> Personnel
        </>
      ),
      key: "personnel",
      width: 170,
      ellipsis: false,
      render: (_, r) => (
        <Tooltip
          title={
            <div>
              <div>
                <UserOutlined /> ENMO: {r.enmo || "—"}
              </div>
              <div>
                <UserOutlined /> Focal: {r.focalPerson || "—"}
              </div>
            </div>
          }
        >
          <div
            style={{
              lineHeight: 1.3,
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            <Text style={{ fontSize: 11 }}>
              <UserOutlined style={{ color: "#722ed1", marginRight: 4 }} />
              {r.focalPerson || "—"}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <SolutionOutlined style={{ marginRight: 3 }} />
              {r.enmo || "—"}
            </Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 130,
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="View">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setDetailModal(r)}
            />
          </Tooltip>
          {canEdit && <Tooltip title="Edit">
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>}
          {canDelete && <Tooltip title="Delete">
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => reviewAndDeleteRecord(r)}
            />
          </Tooltip>}
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    const rows = filtered.map((r, i) => ({
      "#": i + 1,
      Province: r.province,
      LGU: r.lgu,
      Barangay: r.barangay,
      MBA: r.manilaBayArea,
      Ownership: r.ownership,
      Category: r.category,
      Status: r.statusOfSLF,
      "Year Started": r.yearStartedOperation,
      Capacity: r.volumeCapacity,
      "LGUs Served": r.noOfLGUServed,
      Cells: r.numberOfCell,
      Leachate: r.noOfLeachatePond,
      "Gas Vents": r.numberOfGasVents,
      "Waste Received": r.actualResidualWasteReceived,
      Lifespan: r.remainingLifeSpan,
      "Target Month": r.targetMonth,
      ENMO: r.enmo,
      Focal: r.focalPerson,
    }));
    exportToExcel(rows, "SLF_Facilities_Data");
  };

  return (
    <div style={{ padding: 0 }}>
      {/* Record count */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Tag bordered={false} color={hasFilters ? "blue" : "default"}>
          {filtered.length} / {records.length} records
        </Tag>
      </div>

      {/* Summary tiles */}
      {loading ? (
        <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Col xs={12} sm={6} md={6} lg={3} key={i}>
              <Card size="small" style={{ borderRadius: 8, height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
                <Skeleton active paragraph={{ rows: 1 }} title={{ width: "60%" }} />
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        {/* Row 1 */}
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card
            size="small"
            hoverable
            onClick={() => setQuickFilter(quickFilter === "operational" ? null : "operational")}
            style={{ borderRadius: 8, borderLeft: `3px solid ${ACCENT}`, height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "operational" ? "0 0 0 1px #2f54eb inset" : undefined }}
            bodyStyle={{ padding: "8px 12px" }}
          >
            <Statistic
              title={<span style={{ fontSize: 11 }}>Total SLF</span>}
              value={totalRecords}
              valueStyle={{ fontSize: 20 }}
              prefix={<BankOutlined style={{ color: ACCENT, fontSize: 14 }} />}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <CheckCircleOutlined style={{ color: "#52c41a", marginRight: 2 }} />{opCount}/{totalRecords} Operational
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card size="small" hoverable onClick={() => setQuickFilter(quickFilter === "withCells" ? null : "withCells")} style={{ borderRadius: 8, borderLeft: "3px solid #13c2c2", height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "withCells" ? "0 0 0 1px #13c2c2 inset" : undefined }} bodyStyle={{ padding: "8px 12px" }}>
            <Statistic
              title={<span style={{ fontSize: 11 }}>Total Cells</span>}
              value={totalCells}
              valueStyle={{ fontSize: 20 }}
              prefix={<ExperimentOutlined style={{ color: "#13c2c2", fontSize: 14 }} />}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>{cellsWithData}/{totalRecords} with cells</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card size="small" hoverable onClick={() => { setQuickFilter(quickFilter === "withLGUs" ? null : "withLGUs"); setSlfLguModal(true); }} style={{ borderRadius: 8, borderLeft: "3px solid #fa8c16", height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "withLGUs" ? "0 0 0 1px #fa8c16 inset" : undefined }} bodyStyle={{ padding: "8px 12px" }}>
            <Statistic
              title={<span style={{ fontSize: 11 }}>LGUs Served</span>}
              value={totalLGUs}
              valueStyle={{ fontSize: 20 }}
              prefix={<TeamOutlined style={{ color: "#fa8c16", fontSize: 14 }} />}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>{lgusWithData}/{totalRecords} reporting</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card size="small" hoverable onClick={() => setQuickFilter(quickFilter === "private" ? null : "private")} style={{ borderRadius: 8, borderLeft: "3px solid #722ed1", height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "private" ? "0 0 0 1px #722ed1 inset" : undefined }} bodyStyle={{ padding: "8px 12px" }}>
            <Statistic
              title={<span style={{ fontSize: 11 }}>Private Sectors</span>}
              value={privateSectorCount}
              valueStyle={{ fontSize: 20 }}
              prefix={<BankOutlined style={{ color: "#722ed1", fontSize: 14 }} />}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>{privateWithData}/{totalRecords} private-owned</Text>
          </Card>
        </Col>
        {/* Row 2 */}
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card size="small" hoverable onClick={() => setQuickFilter(quickFilter === "withCapacity" ? null : "withCapacity")} style={{ borderRadius: 8, borderLeft: "3px solid #eb2f96", height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "withCapacity" ? "0 0 0 1px #eb2f96 inset" : undefined }} bodyStyle={{ padding: "8px 12px" }}>
            <Statistic
              title={<span style={{ fontSize: 11 }}>Total Capacity</span>}
              value={totalCapacity}
              valueStyle={{ fontSize: 20 }}
              prefix={<DatabaseOutlined style={{ color: "#eb2f96", fontSize: 14 }} />}
              formatter={(v) => Number(v).toLocaleString()}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>{capacityWithData}/{totalRecords} with data</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card size="small" hoverable onClick={() => { setQuickFilter(quickFilter === "withWaste" ? null : "withWaste"); setSlfWasteModal(true); }} style={{ borderRadius: 8, borderLeft: "3px solid #ff4d4f", height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "withWaste" ? "0 0 0 1px #ff4d4f inset" : undefined }} bodyStyle={{ padding: "8px 12px" }}>
            <Statistic
              title={<span style={{ fontSize: 11 }}>Waste Received</span>}
              value={totalWaste}
              suffix="tons"
              valueStyle={{ fontSize: 20 }}
              prefix={<BarChartOutlined style={{ color: "#ff4d4f", fontSize: 14 }} />}
              formatter={(v) => Number(v).toLocaleString()}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>{wasteWithData}/{totalRecords} reporting</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card size="small" hoverable onClick={() => setQuickFilter(quickFilter === "withLeachate" ? null : "withLeachate")} style={{ borderRadius: 8, borderLeft: "3px solid #1890ff", height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "withLeachate" ? "0 0 0 1px #1890ff inset" : undefined }} bodyStyle={{ padding: "8px 12px" }}>
            <Statistic
              title={<span style={{ fontSize: 11 }}>Leachate Ponds</span>}
              value={totalLeachate}
              valueStyle={{ fontSize: 20 }}
              prefix={<AlertOutlined style={{ color: "#1890ff", fontSize: 14 }} />}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>{leachateWithData}/{totalRecords} with ponds</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={6} lg={3}>
          <Card size="small" hoverable onClick={() => setQuickFilter(quickFilter === "withGas" ? null : "withGas")} style={{ borderRadius: 8, borderLeft: "3px solid #52c41a", height: "100%", padding: 0, cursor: "pointer", boxShadow: quickFilter === "withGas" ? "0 0 0 1px #52c41a inset" : undefined }} bodyStyle={{ padding: "8px 12px" }}>
            <Statistic
              title={<span style={{ fontSize: 11 }}>Gas Vents</span>}
              value={totalGasVents}
              valueStyle={{ fontSize: 20 }}
              prefix={<ExperimentOutlined style={{ color: "#52c41a", fontSize: 14 }} />}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>{gasVentsWithData}/{totalRecords} with vents</Text>
          </Card>
        </Col>
      </Row>
      )}

      <Tabs
        defaultActiveKey="facilities"
        destroyOnHidden
        items={[
          {
            key: "facilities",
            label: (
              <>
                <BankOutlined /> Sanitary Landfill Facility
              </>
            ),
            children: (
              <>
                {/* Header with Search + Export */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 16,
                    flexWrap: "wrap",
                    gap: 12,
                  }}
                >
                  <Title level={4} style={{ margin: 0 }}>
                    <BankOutlined /> Sanitary Landfill Facility
                  </Title>
                  <Space wrap>
                    <Input
                      placeholder="Search..."
                      prefix={<SearchOutlined />}
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      style={{ width: "100%", maxWidth: 200 }}
                      allowClear
                    />
                    {canEdit && <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={openAdd}
                      style={{ background: ACCENT, borderColor: ACCENT }}
                    >
                      Add Record
                    </Button>}
                    <Button icon={<DownloadOutlined />} onClick={handleExport}>
                      Export
                    </Button>
                    <Tooltip title="Refresh data">
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => fetchRecords(true)}
                        loading={loading}
                      />
                    </Tooltip>
                  </Space>
                </div>

                {/* Filter Bar */}
                <Card
                  size="small"
                  style={{ borderRadius: 10, marginBottom: 12 }}
                  bodyStyle={{ padding: "10px 16px" }}
                >
                  <Row gutter={[10, 10]} align="middle">
                    <Col>
                      <FilterOutlined
                        style={{ color: ACCENT, marginRight: 6 }}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Filters:
                      </Text>
                    </Col>
                    <Col flex="auto">
                      <Space wrap size={8}>
                        <Select
                          placeholder="Province"
                          value={filterProvince}
                          onChange={setFilterProvince}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 120,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={provinceOptions}
                          suffixIcon={<EnvironmentOutlined />}
                        />
                        <Select
                          placeholder="Status"
                          value={filterStatus}
                          onChange={setFilterStatus}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 160,
                          }}
                          size="small"
                          options={buildFilters(records, "statusOfSLF")}
                          suffixIcon={<SafetyCertificateOutlined />}
                        />
                        <Select
                          placeholder="Category"
                          value={filterCategory}
                          onChange={setFilterCategory}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={buildFilters(records, "category")}
                        />
                        <Select
                          placeholder="Target Month"
                          value={filterMonth}
                          onChange={setFilterMonth}
                          allowClear
                          style={{
                            width: "100%",
                            minWidth: 110,
                            maxWidth: 150,
                          }}
                          size="small"
                          options={monthOptions}
                          suffixIcon={<CalendarOutlined />}
                        />
                        {hasFilters && (
                          <Tooltip title="Clear all filters">
                            <Button
                              size="small"
                              type="link"
                              danger
                              icon={<ClearOutlined />}
                              onClick={clearFilters}
                            >
                              Clear
                            </Button>
                          </Tooltip>
                        )}
                      </Space>
                    </Col>
                    <Col>
                      <Tag
                        bordered={false}
                        color={hasFilters ? "blue" : "default"}
                      >
                        {filtered.length} / {records.length} records
                      </Tag>
                    </Col>
                  </Row>
                </Card>

                {/* Table */}
                <Card size="small" style={{ borderRadius: 10 }}>
                  <Table
                    className="slf-table"
                    dataSource={filtered}
                    columns={columns}
                    rowKey="_id"
                    loading={loading}
                    size="small"
                    scroll={{ x: 1800 }}
                    pagination={{
                      pageSize: 50,
                      showSizeChanger: true,
                      showTotal: (t) => `${t} records`,
                    }}
                  />
                </Card>
              </>
            ),
          },
          {
            key: "portal",
            label: (
              <>
                <LinkOutlined /> Waste Generators
              </>
            ),
            children: (
              <PortalGenerators
                generators={generators}
                loadingGen={loadingGen}
                fetchGenerators={fetchGenerators}
                slfRecords={records}
                canEdit={canEdit}
                canDelete={canDelete}
                isDark={isDark}
              />
            ),
          },
        ]}
      />

      {/* Add/Edit Modal */}
      <Modal
        title={editing?._id ? `Edit SLF Facility — ${editYear}` : "Add SLF Facility"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        width={1400}
        okText="Save"
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
      >
        <div style={{ marginBottom: 12, padding: "8px 12px", background: isDark ? "rgba(47,84,235,0.1)" : "#f0f5ff", borderRadius: 6, border: isDark ? "1px solid rgba(47,84,235,0.3)" : "1px solid #d6e4ff" }}>
          <Row align="middle" gutter={12}>
            <Col>
              <Text strong style={{ fontSize: 13 }}><CalendarOutlined style={{ marginRight: 4 }} /> Data Year:</Text>
            </Col>
            <Col>
              <Select
                value={editYear}
                onChange={editing?._id ? handleEditYearChange : setEditYear}
                style={{ width: 120 }}
                options={(() => {
                  const cy = new Date().getFullYear();
                  const yrs = [...new Set([
                    cy, cy - 1, cy - 2, cy - 3, cy - 4,
                    ...(editYearRecords || []).map((r) => r.dataYear || cy),
                  ])].sort((a, b) => b - a);
                  return yrs.map((y) => {
                    const has = (editYearRecords || []).some((r) => r.dataYear === y);
                    return { label: has ? `${y}` : `${y} (new)`, value: y };
                  });
                })()}
              />
            </Col>
            {editing?._id && (
              <Col>
                <Tag color={editYearRecords.some((r) => r.dataYear === editYear && r._id) ? "green" : "orange"} bordered={false}>
                  {editYearRecords.some((r) => r.dataYear === editYear && r._id) ? "Existing record" : "New record for this year"}
                </Tag>
              </Col>
            )}
          </Row>
        </div>
        <Form form={form} layout="vertical" size="small">
          <Tabs
            defaultActiveKey="location"
            tabPosition="left"
            size="small"
            style={{ minHeight: 400 }}
            items={[
              {
                key: "location",
                label: <span style={{ color: "#1677ff" }}><EnvironmentOutlined /> Location</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name="province"
                label="Province"
                rules={[{ required: true }]}
              >
                <Select options={provinceOptions} placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lgu" label="LGU" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="barangay" label="Barangay">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="manilaBayArea" label="Manila Bay Area">
                <Select options={mbaOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="congressionalDistrict"
                label="Congressional District"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="ownership" label="Ownership">
                <Select options={ownershipOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="latitude" label="Latitude">
                <InputNumber style={{ width: "100%" }} step={0.0001} precision={4} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="longitude" label="Longitude">
                <InputNumber style={{ width: "100%" }} step={0.0001} precision={4} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "facility",
                label: <span style={{ color: "#fa8c16" }}><BankOutlined /> Facility Details</span>,
                children: (
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="yearStartedOperation" label="Year Started">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="category" label="Category">
                <Select options={wasteTypeOptions} allowClear placeholder="Select" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="volumeCapacity" label="Volume Capacity (m³)">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="noOfLGUServed" label="LGUs Served">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="statusOfSLF" label="Status">
                <Select options={slfStatusOptions} allowClear placeholder="Select Status" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="remainingLifeSpan" label="Remaining Lifespan">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="noOfLeachatePond" label="Leachate Ponds">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="numberOfGasVents" label="Gas Vents">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="actualResidualWasteReceived"
                label="Waste Received"
              >
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="estimatedVolumeWaste" label="Est. Volume Waste">
                <InputNumber style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="mrfEstablished" label="MRF Established">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "leachate-gas",
                label: <span style={{ color: "#1677ff" }}><AlertOutlined /> Leachate &amp; Gas Management</span>,
                children: (
                  <>
                    <Divider orientation="left" style={{ fontSize: 13, color: "#1677ff", marginTop: 0 }}>
                      <AlertOutlined style={{ marginRight: 6 }} />Leachate Ponds
                    </Divider>
                    <Form.List name="leachatePondDetails">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Card
                              key={key}
                              size="small"
                              style={{ marginBottom: 12, borderRadius: 8, border: `1px solid ${isDark ? "#1d3a6b" : "#bae0ff"}`, overflow: "hidden" }}
                              headStyle={{ background: isDark ? "rgba(23,119,255,0.08)" : "#e6f4ff", borderBottom: `1px solid ${isDark ? "#1d3a6b" : "#bae0ff"}`, padding: "6px 12px", minHeight: 36 }}
                              bodyStyle={{ padding: "10px 12px 8px" }}
                              title={
                                <Space size={6}>
                                  <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, background: "#1677ff", borderRadius: "50%", fontSize: 10, color: "#fff", fontWeight: 700, flexShrink: 0 }}>
                                    {name + 1}
                                  </div>
                                  <Text strong style={{ fontSize: 12, color: isDark ? "#69b1ff" : "#0958d9" }}>Leachate Pond</Text>
                                </Space>
                              }
                              extra={<Button size="small" type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />}
                            >
                              <Row gutter={[12, 0]} align="top">
                                <Col span={4}>
                                  <Form.Item {...rest} name={[name, "pondNo"]} label={<Text style={{ fontSize: 11 }}>Pond No.</Text>}>
                                    <InputNumber style={{ width: "100%" }} min={1} precision={0} />
                                  </Form.Item>
                                </Col>
                                <Col span={7}>
                                  <Form.Item {...rest} name={[name, "status"]} label={<Text style={{ fontSize: 11 }}>Operational Status</Text>}>
                                    <Select placeholder="Select status" options={[
                                      { label: "Active", value: "Active" },
                                      { label: "Inactive", value: "Inactive" },
                                      { label: "Under Maintenance", value: "Under Maintenance" },
                                      { label: "Decommissioned", value: "Decommissioned" },
                                    ]} />
                                  </Form.Item>
                                </Col>
                                <Col span={13}>
                                  <Form.Item {...rest} name={[name, "description"]} label={<Text style={{ fontSize: 11 }}>Description / Condition Notes</Text>}>
                                    <Input.TextArea rows={2} placeholder="Pond dimensions, lining type, current condition, treatment process..." style={{ resize: "none" }} />
                                  </Form.Item>
                                </Col>
                              </Row>
                              <Divider plain style={{ margin: "2px 0 8px", fontSize: 11, color: "#8c8c8c" }}>
                                <PaperClipOutlined /> Attached Files
                              </Divider>
                              <Form.Item
                                {...rest}
                                name={[name, "attachments"]}
                                valuePropName="fileList"
                                getValueFromEvent={(e) => Array.isArray(e) ? e : e?.fileList}
                                style={{ marginBottom: 0 }}
                              >
                                <Upload
                                  action="/eswm-pipeline/api/upload"
                                  headers={{ Authorization: `Bearer ${secureStorage.get("token")}` }}
                                  listType="picture"
                                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                                  multiple
                                  beforeUpload={(file) => {
                                    const ok = file.type.startsWith("image/") || /pdf|msword|officedocument|ms-excel|ms-powerpoint/.test(file.type);
                                    if (!ok) { message.error("Only images, PDFs, and Office documents are allowed."); return Upload.LIST_IGNORE; }
                                    if (file.size > 20 * 1024 * 1024) { message.error("File must be under 20 MB."); return Upload.LIST_IGNORE; }
                                    return true;
                                  }}
                                >
                                  <Button icon={<UploadOutlined />} size="small">Upload Photos or Documents</Button>
                                </Upload>
                              </Form.Item>
                            </Card>
                          ))}
                          <Button type="dashed" onClick={() => add({ pondNo: fields.length + 1, status: "Active" })} block icon={<PlusOutlined />} style={{ marginBottom: 4 }}>
                            Add Leachate Pond
                          </Button>
                        </>
                      )}
                    </Form.List>

                    <Divider orientation="left" style={{ fontSize: 13, color: "#52c41a", marginTop: 16 }}>
                      <ExperimentOutlined style={{ marginRight: 6 }} />Gas Vents
                    </Divider>
                    <Form.List name="gasVentDetails">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Card
                              key={key}
                              size="small"
                              style={{ marginBottom: 12, borderRadius: 8, border: `1px solid ${isDark ? "#1a3d20" : "#b7eb8f"}`, overflow: "hidden" }}
                              headStyle={{ background: isDark ? "rgba(82,196,26,0.08)" : "#f6ffed", borderBottom: `1px solid ${isDark ? "#1a3d20" : "#b7eb8f"}`, padding: "6px 12px", minHeight: 36 }}
                              bodyStyle={{ padding: "10px 12px 8px" }}
                              title={
                                <Space size={6}>
                                  <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, background: "#52c41a", borderRadius: "50%", fontSize: 10, color: "#fff", fontWeight: 700, flexShrink: 0 }}>
                                    {name + 1}
                                  </div>
                                  <Text strong style={{ fontSize: 12, color: isDark ? "#95de64" : "#389e0d" }}>Gas Vent</Text>
                                </Space>
                              }
                              extra={<Button size="small" type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} />}
                            >
                              <Row gutter={[12, 0]} align="top">
                                <Col span={4}>
                                  <Form.Item {...rest} name={[name, "ventNo"]} label={<Text style={{ fontSize: 11 }}>Vent No.</Text>}>
                                    <InputNumber style={{ width: "100%" }} min={1} precision={0} />
                                  </Form.Item>
                                </Col>
                                <Col span={6}>
                                  <Form.Item {...rest} name={[name, "ventType"]} label={<Text style={{ fontSize: 11 }}>Vent Type</Text>}>
                                    <Select placeholder="Select type" allowClear options={[
                                      { label: "Passive", value: "Passive" },
                                      { label: "Active", value: "Active" },
                                      { label: "Flare", value: "Flare" },
                                      { label: "LFG Recovery", value: "LFG Recovery" },
                                      { label: "Other", value: "Other" },
                                    ]} />
                                  </Form.Item>
                                </Col>
                                <Col span={6}>
                                  <Form.Item {...rest} name={[name, "status"]} label={<Text style={{ fontSize: 11 }}>Operational Status</Text>}>
                                    <Select placeholder="Select status" options={[
                                      { label: "Active", value: "Active" },
                                      { label: "Inactive", value: "Inactive" },
                                      { label: "Under Maintenance", value: "Under Maintenance" },
                                      { label: "Decommissioned", value: "Decommissioned" },
                                    ]} />
                                  </Form.Item>
                                </Col>
                                <Col span={8}>
                                  <Form.Item {...rest} name={[name, "description"]} label={<Text style={{ fontSize: 11 }}>Description / Notes</Text>}>
                                    <Input.TextArea rows={2} placeholder="Pipe diameter, installation depth, condition, maintenance notes..." style={{ resize: "none" }} />
                                  </Form.Item>
                                </Col>
                              </Row>
                              <Divider plain style={{ margin: "2px 0 8px", fontSize: 11, color: "#8c8c8c" }}>
                                <PaperClipOutlined /> Attached Files
                              </Divider>
                              <Form.Item
                                {...rest}
                                name={[name, "attachments"]}
                                valuePropName="fileList"
                                getValueFromEvent={(e) => Array.isArray(e) ? e : e?.fileList}
                                style={{ marginBottom: 0 }}
                              >
                                <Upload
                                  action="/eswm-pipeline/api/upload"
                                  headers={{ Authorization: `Bearer ${secureStorage.get("token")}` }}
                                  listType="picture"
                                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                                  multiple
                                  beforeUpload={(file) => {
                                    const ok = file.type.startsWith("image/") || /pdf|msword|officedocument|ms-excel|ms-powerpoint/.test(file.type);
                                    if (!ok) { message.error("Only images, PDFs, and Office documents are allowed."); return Upload.LIST_IGNORE; }
                                    if (file.size > 20 * 1024 * 1024) { message.error("File must be under 20 MB."); return Upload.LIST_IGNORE; }
                                    return true;
                                  }}
                                >
                                  <Button icon={<UploadOutlined />} size="small">Upload Photos or Documents</Button>
                                </Upload>
                              </Form.Item>
                            </Card>
                          ))}
                          <Button type="dashed" onClick={() => add({ ventNo: fields.length + 1, status: "Active" })} block icon={<PlusOutlined />} style={{ marginBottom: 4 }}>
                            Add Gas Vent
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
              {
                key: "cell-infra",
                label: <span style={{ color: "#13c2c2" }}><BarChartOutlined /> Cell Infrastructure</span>,
                children: (
          <>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="numberOfCell" label="No. of Cells">
                <Select
                  placeholder="Select"
                  allowClear
                  options={[1,2,3,4,5,6,7,8,9,10].map(n => ({ label: `${n}`, value: n }))}
                  onChange={(val) => {
                    const cur = form.getFieldValue("cellCapacities") || [];
                    const curSt = form.getFieldValue("cellStatuses") || [];
                    const curTy = form.getFieldValue("cellTypes") || [];
                    const next = Array.from({ length: val || 0 }, (_, i) => cur[i] ?? null);
                    const nextSt = Array.from({ length: val || 0 }, (_, i) => curSt[i] || "Operational");
                    const nextTy = Array.from({ length: val || 0 }, (_, i) => curTy[i] || "Residual");
                    form.setFieldsValue({ cellCapacities: next, cellStatuses: nextSt, cellTypes: nextTy });
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          {/* ── Capacity Unit Converter ── */}
          <Card size="small" style={{ borderRadius: 8, background: isDark ? "rgba(82,196,26,0.1)" : "#f6ffed", marginBottom: 12 }}>
            <Text strong style={{ fontSize: 12, color: "#389e0d" }}>📐 Capacity Converter (m² → m³)</Text>
            <Row gutter={12} style={{ marginTop: 8 }} align="middle">
              <Col span={7}>
                <Space.Compact style={{ width: "100%" }}>
                  <InputNumber
                    id="conv-area"
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    placeholder="Area (m²)"
                    onChange={() => {
                      const area = document.getElementById("conv-area")?.querySelector("input")?.value;
                      const depth = document.getElementById("conv-depth")?.querySelector("input")?.value;
                      const res = document.getElementById("conv-result");
                      if (area && depth && res) res.textContent = `= ${(Number(area) * Number(depth)).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
                    }}
                  />
                  <span className="ant-input-group-addon">m²</span>
                </Space.Compact>
              </Col>
              <Col span={1} style={{ textAlign: "center" }}><Text type="secondary">×</Text></Col>
              <Col span={7}>
                <Space.Compact style={{ width: "100%" }}>
                  <InputNumber
                    id="conv-depth"
                    style={{ width: "100%" }}
                    min={0}
                    step={0.01}
                    placeholder="Depth (m)"
                    onChange={() => {
                      const area = document.getElementById("conv-area")?.querySelector("input")?.value;
                      const depth = document.getElementById("conv-depth")?.querySelector("input")?.value;
                      const res = document.getElementById("conv-result");
                      if (area && depth && res) res.textContent = `= ${(Number(area) * Number(depth)).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
                    }}
                  />
                  <span className="ant-input-group-addon">m</span>
                </Space.Compact>
              </Col>
              <Col span={9}>
                <Text id="conv-result" strong style={{ fontSize: 14, color: "#389e0d" }}>= 0 m³</Text>
              </Col>
            </Row>
          </Card>

          <Form.Item noStyle dependencies={["numberOfCell"]}>
            {() => {
              const cellCount = form.getFieldValue("numberOfCell") || 0;
              if (cellCount < 1) return null;
              return (
                <>
                <Divider plain orientation="left" style={{ fontSize: 12, margin: "8px 0 16px" }}>Cell Capacities, Status &amp; Type</Divider>
                <Row gutter={12}>
                  {Array.from({ length: cellCount }, (_, i) => (
                    <Col span={8} key={i}>
                      <Form.Item name={["cellCapacities", i]} label={`Cell ${i + 1} Capacity (m³)`}>
                        <InputNumber style={{ width: "100%" }} min={0} step={0.01} placeholder="Capacity" />
                      </Form.Item>
                      <Form.Item name={["cellStatuses", i]} label={`Cell ${i + 1} Status`} initialValue="Operational">
                        <Select options={[{ label: "Operational", value: "Operational" }, { label: "Closed", value: "Closed" }]} />
                      </Form.Item>
                      <Form.Item name={["cellTypes", i]} label={`Cell ${i + 1} Type`} initialValue="Residual">
                        <Select options={[
                          { label: "Residual Cell", value: "Residual" },
                          { label: "Treated Haz Waste Cell", value: "Treated Haz Waste" },
                        ]} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
                </>
              );
            }}
          </Form.Item>
          <Form.Item noStyle dependencies={["numberOfCell", "cellCapacities", "cellStatuses", "cellTypes", "volumeCapacity", "actualResidualWasteReceived"]}>
            {() => {
              const cellCount = form.getFieldValue("numberOfCell") || 0;
              const caps = form.getFieldValue("cellCapacities") || [];
              const statuses = form.getFieldValue("cellStatuses") || [];
              const types = form.getFieldValue("cellTypes") || [];
              const totalCap = form.getFieldValue("volumeCapacity") || 0;
              const waste = form.getFieldValue("actualResidualWasteReceived") || 0;
              const pct = totalCap > 0 ? Math.min(Math.round((waste / totalCap) * 100), 100) : 0;
              if (cellCount < 1) return <Empty description="Select number of cells to see infrastructure preview" />;
              // Per-cell donut data for charts
              const cellDonutData = Array.from({ length: cellCount }, (_, i) => {
                const cap = caps[i] || 0;
                const st = statuses[i] || "Operational";
                const ty = types[i] || "Residual";
                // Distribute waste proportionally across operational cells
                const opCaps = caps.filter((c, j) => (statuses[j] || "Operational") !== "Closed" && c > 0);
                const totalOpCap = opCaps.reduce((s, c) => s + c, 0);
                const cellWaste = st === "Closed" ? cap : (totalOpCap > 0 && cap > 0 ? Math.round((cap / totalOpCap) * waste) : 0);
                return { index: i, capacity: cap, status: st, cellType: ty, waste: Math.min(cellWaste, cap), remaining: Math.max(0, cap - Math.min(cellWaste, cap)) };
              });
              return (
                <Card size="small" style={{ borderRadius: 10, marginTop: 8, background: isDark ? "#1f1f1f" : "#fafafa" }}>
                  <Row gutter={16} align="middle">
                    <Col xs={24} md={8} style={{ textAlign: "center" }}>
                      <Progress
                        type="dashboard"
                        percent={pct}
                        size={110}
                        strokeColor={pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a"}
                        format={() => (
                          <div style={{ lineHeight: 1.3 }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: pct >= 90 ? "#ff4d4f" : pct >= 70 ? "#faad14" : "#52c41a" }}>{pct}%</div>
                            <div style={{ fontSize: 10, color: "#8c8c8c" }}>used</div>
                          </div>
                        )}
                      />
                      <div style={{ fontSize: 11, color: "#8c8c8c", marginTop: 4 }}>
                        {waste > 0 ? waste.toLocaleString() : "0"} / {totalCap > 0 ? totalCap.toLocaleString() : "—"} m³
                      </div>
                    </Col>
                    <Col xs={24} md={16}>
                      <Row gutter={[12, 12]} justify="center">
                        {cellDonutData.map((cell, i) => {
                          const cellPct = cell.capacity > 0 ? Math.min(Math.round((cell.waste / cell.capacity) * 100), 100) : 0;
                          const isClosed = cell.status === "Closed";
                          const isHaz = cell.cellType === "Treated Haz Waste";
                          return (
                            <Col xs={12} sm={8} key={i} style={{ textAlign: "center" }}>
                              <Progress
                                type="dashboard"
                                percent={isClosed ? 100 : cellPct}
                                size={70}
                                strokeColor={isClosed ? "#d9d9d9" : isHaz ? "#f5222d" : cellPct >= 90 ? "#ff4d4f" : cellPct >= 70 ? "#faad14" : "#52c41a"}
                                format={() => (
                                  <div style={{ lineHeight: 1.2 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: isClosed ? "#8c8c8c" : isHaz ? "#f5222d" : cellPct >= 90 ? "#ff4d4f" : cellPct >= 70 ? "#faad14" : "#52c41a" }}>
                                      {isClosed ? "—" : `${cellPct}%`}
                                    </div>
                                  </div>
                                )}
                              />
                              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4 }}>Cell {i + 1}</div>
                              <Tag color={isClosed ? "default" : "green"} style={{ fontSize: 9, marginTop: 2 }}>{cell.status}</Tag>
                              <Tag color={isHaz ? "red" : "blue"} style={{ fontSize: 9, marginTop: 2 }}>{isHaz ? "Haz Waste" : "Residual"}</Tag>
                              <div style={{ fontSize: 10, color: "#8c8c8c" }}>{cell.capacity > 0 ? `${cell.capacity.toLocaleString()} m³` : "Not set"}</div>
                            </Col>
                          );
                        })}
                      </Row>
                    </Col>
                  </Row>
                  {/* Per-cell donut charts when 2+ cells with capacity */}
                  {cellCount >= 2 && cellDonutData.some(c => c.capacity > 0) && (
                    <>
                      <Divider plain style={{ fontSize: 11, margin: "12px 0 8px" }}>Per-Cell Capacity Donut Charts</Divider>
                      <Row gutter={[8, 8]} justify="center">
                        {cellDonutData.filter(c => c.capacity > 0).map((cell) => {
                          const chartData = cell.status === "Closed"
                            ? [{ name: "Closed", value: cell.capacity }]
                            : [{ name: "Used", value: cell.waste }, { name: "Remaining", value: cell.remaining }];
                          const colors = cell.status === "Closed" ? ["#d9d9d9"] : ["#ff4d4f", "#52c41a"];
                          return (
                            <Col xs={12} sm={8} md={6} key={cell.index} style={{ textAlign: "center" }}>
                              <Text style={{ fontSize: 11, fontWeight: 600 }}>Cell {cell.index + 1}</Text>
                              <ResponsiveContainer width="100%" height={100}>
                                <PieChart>
                                  <Pie data={chartData} cx="50%" cy="50%" innerRadius={25} outerRadius={40} paddingAngle={2} dataKey="value">
                                    {chartData.map((_, j) => <RCell key={j} fill={colors[j % colors.length]} />)}
                                  </Pie>
                                  <RTooltip formatter={(v) => `${v.toLocaleString()} m³`} />
                                </PieChart>
                              </ResponsiveContainer>
                            </Col>
                          );
                        })}
                      </Row>
                    </>
                  )}
                </Card>
              );
            }}
          </Form.Item>
          </>
                ),
              },
              {
                key: "permits",
                label: <span style={{ color: "#faad14" }}><SafetyCertificateOutlined /> Permits</span>,
                children: (
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="eccNo" label="ECC No.">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="dischargePermit" label="Discharge Permit">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="permitToOperate" label="Permit to Operate">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="hazwasteGenerationId" label="Hazwaste Gen. ID">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "personnel",
                label: <span style={{ color: "#52c41a" }}><TeamOutlined /> Personnel</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="targetMonth" label="Target Month">
                <Select
                  options={monthOptions}
                  placeholder="Select"
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="enmo" label="ENMO">
                <Select options={enmoOptions} allowClear showSearch placeholder="Select ENMO" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="eswmStaff" label="ESWM Staff">
                <Select options={eswmStaffOptions} allowClear showSearch placeholder="Select Staff" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="focalPerson" label="Focal Person">
                <Select options={focalOptions} allowClear showSearch placeholder="Select Focal" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="iisNumber" label="IIS Number">
                <Input />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "monitoring",
                label: <span style={{ color: "#13c2c2" }}><CalendarOutlined /> Monitoring Dates</span>,
                children: (
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="dateOfMonitoring" label="Monitoring">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateReportPrepared" label="Report Prepared">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateReportReviewedStaff"
                label="Reviewed (Staff)"
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateReportReviewedFocal"
                label="Reviewed (Focal)"
              >
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateReportApproved" label="Approved">
                <DatePicker style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "compliance",
                label: <span style={{ color: "#eb2f96" }}><FileTextOutlined /> Compliance</span>,
                children: (
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="remarksAndRecommendation" label="Remarks">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="findings" label="Findings">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="adviseLetterDateIssued"
                label="Advise Letter Date"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="complianceToAdvise" label="Compliance">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="signedDocument" label="Signed Document">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="docketNoNOV" label="Docket No. (NOV)">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="dateOfIssuanceNOV" label="NOV Issuance Date">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="dateOfTechnicalConference"
                label="Tech Conference Date"
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="commitments" label="Commitments">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="remarksCompliance" label="Compliance Remarks">
                <Input.TextArea rows={2} />
              </Form.Item>
            </Col>
          </Row>
                ),
              },
              {
                key: "preventive",
                label: <span style={{ color: "#fa8c16" }}><WarningOutlined /> Preventive Measures</span>,
                children: (
                  <>
                    <Divider orientation="left" plain>Trash Slide Prevention Measures</Divider>
                    <Form.List name="trashSlideMeasures">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Card key={key} size="small" style={{ marginBottom: 8 }}
                              extra={<MinusCircleOutlined style={{ color: "#ff4d4f" }} onClick={() => remove(name)} />}
                            >
                              <Row gutter={12}>
                                <Col span={6}>
                                  <Form.Item {...rest} name={[name, "measure"]} label="Measure">
                                    <Input placeholder="e.g. Compaction, Cover Soil" />
                                  </Form.Item>
                                </Col>
                                <Col span={8}>
                                  <Form.Item {...rest} name={[name, "description"]} label="Description">
                                    <Input />
                                  </Form.Item>
                                </Col>
                                <Col span={5}>
                                  <Form.Item {...rest} name={[name, "status"]} label="Status">
                                    <Select options={[
                                      { label: "Implemented", value: "Implemented" },
                                      { label: "Pending", value: "Pending" },
                                      { label: "Not Applicable", value: "Not Applicable" },
                                    ]} />
                                  </Form.Item>
                                </Col>
                                <Col span={5}>
                                  <Form.Item {...rest} name={[name, "attachments"]} label="Attachments">
                                    <Select mode="tags" placeholder="File names or URLs" style={{ width: "100%" }} tokenSeparators={[","]} />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </Card>
                          ))}
                          <Button type="dashed" onClick={() => add({ status: "Implemented" })} block icon={<PlusOutlined />}>
                            Add Trash Slide Measure
                          </Button>
                        </>
                      )}
                    </Form.List>
                    <Divider orientation="left" plain style={{ marginTop: 16 }}>Fire Prevention Measures</Divider>
                    <Form.List name="firePrevMeasures">
                      {(fields, { add, remove }) => (
                        <>
                          {fields.map(({ key, name, ...rest }) => (
                            <Card key={key} size="small" style={{ marginBottom: 8 }}
                              extra={<MinusCircleOutlined style={{ color: "#ff4d4f" }} onClick={() => remove(name)} />}
                            >
                              <Row gutter={12}>
                                <Col span={6}>
                                  <Form.Item {...rest} name={[name, "measure"]} label="Measure">
                                    <Input placeholder="e.g. Fire Extinguisher, Firebreak" />
                                  </Form.Item>
                                </Col>
                                <Col span={8}>
                                  <Form.Item {...rest} name={[name, "description"]} label="Description">
                                    <Input />
                                  </Form.Item>
                                </Col>
                                <Col span={5}>
                                  <Form.Item {...rest} name={[name, "status"]} label="Status">
                                    <Select options={[
                                      { label: "Implemented", value: "Implemented" },
                                      { label: "Pending", value: "Pending" },
                                      { label: "Not Applicable", value: "Not Applicable" },
                                    ]} />
                                  </Form.Item>
                                </Col>
                                <Col span={5}>
                                  <Form.Item {...rest} name={[name, "attachments"]} label="Attachments">
                                    <Select mode="tags" placeholder="File names or URLs" style={{ width: "100%" }} tokenSeparators={[","]} />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </Card>
                          ))}
                          <Button type="dashed" onClick={() => add({ status: "Implemented" })} block icon={<PlusOutlined />}>
                            Add Fire Prevention Measure
                          </Button>
                        </>
                      )}
                    </Form.List>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        title={
          <Space>
            <BankOutlined /> SLF Facility Details
            {detailModal && <Text type="secondary" style={{ fontSize: 12 }}>— {detailModal.lgu}, {detailModal.province}</Text>}
            {detailYearRecords.length >= 1 && <Tag color="blue" bordered={false} style={{ marginLeft: 8 }}>{detailYearRecords.length} year record{detailYearRecords.length > 1 ? "s" : ""}</Tag>}
          </Space>
        }
        open={!!detailModal}
        onCancel={() => setDetailModal(null)}
        footer={<Button onClick={() => setDetailModal(null)}>Close</Button>}
        width={1100}
      >
        {detailModal && (
          <>
          {/* Year Selector */}
          {detailYearRecords.length >= 1 && (
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Year:</Text>
              <Space size={4}>
                {detailYearRecords.map((r) => r.dataYear || new Date().getFullYear()).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a).map((yr) => (
                  <Button key={yr} size="small" type={detailYear === yr ? "primary" : "default"} onClick={() => setDetailYear(yr)}
                    style={detailYear === yr ? { background: ACCENT, borderColor: ACCENT } : {}}
                  >{yr}</Button>
                ))}
              </Space>
            </div>
          )}
          {detailViewRecord ? (
          <Tabs
            defaultActiveKey="1"
            tabPosition="left"
            style={{ minHeight: 400 }}
            items={[
              {
                key: "1",
                label: "Location & Status",
                children: (
                  <Descriptions column={2} size="small" bordered>
                    <Descriptions.Item label="Province">{detailViewRecord.province || "—"}</Descriptions.Item>
                    <Descriptions.Item label="LGU">{detailViewRecord.lgu || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Barangay">{detailViewRecord.barangay || "—"}</Descriptions.Item>
                    <Descriptions.Item label="MBA">{detailViewRecord.manilaBayArea || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Ownership">{detailViewRecord.ownership || "—"}</Descriptions.Item>
                    <Descriptions.Item label="District">{detailViewRecord.congressionalDistrict || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Status">{getStatusTag(detailViewRecord.statusOfSLF)}</Descriptions.Item>
                    <Descriptions.Item label="Category">
                      {detailViewRecord.category ? <Tag color="blue">{detailViewRecord.category}</Tag> : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Year Started">{detailViewRecord.yearStartedOperation || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Capacity">
                      {detailViewRecord.volumeCapacity ? Number(detailViewRecord.volumeCapacity).toLocaleString() : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="LGUs Served">{detailViewRecord.noOfLGUServed || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Remaining Lifespan">{detailViewRecord.remainingLifeSpan || "—"}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: "2",
                label: (
                  <>
                    <BarChartOutlined /> Operations
                  </>
                ),
                children: (() => {
                  const cells = detailViewRecord.numberOfCell || 0;
                  const leachate = detailViewRecord.noOfLeachatePond || 0;
                  const gasVents = detailViewRecord.numberOfGasVents || 0;
                  const wasteReceived = detailViewRecord.actualResidualWasteReceived || 0;
                  const estVolume = detailViewRecord.estimatedVolumeWaste || 0;
                  const capacity = detailViewRecord.volumeCapacity || 0;
                  const infraData = [
                    { name: "Cells", value: cells },
                    { name: "Leachate Ponds", value: leachate },
                    { name: "Gas Vents", value: gasVents },
                  ].filter((d) => d.value > 0);
                  // Baseline waste-type breakdown for donut chart
                  const residualBaselineVol = baselineData
                    ? (baselineData.activeCellResidualVolume || 0) + (baselineData.closedCellResidualVolume || 0)
                    : 0;
                  const hazBaselineVol = baselineData
                    ? (baselineData.activeCellInertVolume || 0) + (baselineData.closedCellInertVolume || 0)
                    : 0;
                  const baselineWasteTotal = residualBaselineVol + hazBaselineVol;
                  const capacityData = (() => {
                    if (capacity > 0 && baselineWasteTotal > 0) {
                      const slices = [];
                      if (residualBaselineVol > 0) slices.push({ name: "Residual Waste", value: residualBaselineVol });
                      if (hazBaselineVol > 0) slices.push({ name: "Haz/Inert Waste", value: hazBaselineVol });
                      const remaining = Math.max(0, capacity - baselineWasteTotal);
                      if (remaining > 0) slices.push({ name: "Remaining Capacity", value: remaining });
                      return slices;
                    }
                    if (capacity > 0) {
                      return [
                        { name: "Waste Received", value: Math.min(wasteReceived, capacity) },
                        { name: "Remaining Capacity", value: Math.max(0, capacity - wasteReceived) },
                      ];
                    }
                    return wasteReceived > 0 ? [{ name: "Waste Received", value: wasteReceived }] : [];
                  })();
                  const volumeData = [
                    wasteReceived > 0 && { name: "Waste Received", value: wasteReceived },
                    estVolume > 0 && { name: "Est. Volume", value: estVolume },
                    capacity > 0 && { name: "Capacity", value: capacity },
                  ].filter(Boolean);
                  // Cell volume data from baseline
                  const cellVolumeData = baselineData
                    ? [
                        baselineData.activeCellResidualVolume > 0 && {
                          name: "Active Residual",
                          value: baselineData.activeCellResidualVolume,
                          unit: (baselineData.activeCellResidualUnit || "m³").replace("m3", "m³"),
                        },
                        baselineData.activeCellInertVolume > 0 && {
                          name: "Active Inert",
                          value: baselineData.activeCellInertVolume,
                          unit: (baselineData.activeCellInertUnit || "m³").replace("m3", "m³"),
                        },
                        baselineData.closedCellResidualVolume > 0 && {
                          name: "Closed Residual",
                          value: baselineData.closedCellResidualVolume,
                          unit: (baselineData.closedCellResidualUnit || "m³").replace("m3", "m³"),
                        },
                        baselineData.closedCellInertVolume > 0 && {
                          name: "Closed Inert",
                          value: baselineData.closedCellInertVolume,
                          unit: (baselineData.closedCellInertUnit || "m³").replace("m3", "m³"),
                        },
                      ].filter(Boolean)
                    : [];
                  const hasCharts = infraData.length > 0 || capacityData.length > 0 || cellVolumeData.length > 0;
                  const pctUsed = capacity > 0 ? Math.min(Math.round((wasteReceived / capacity) * 100), 100) : 0;
                  const cellCaps = detailViewRecord.cellCapacities || [];
                  return (
                    <>
                      <Descriptions column={3} size="small" bordered style={{ marginBottom: 16 }}>
                        <Descriptions.Item label="Cells">{cells || "—"}</Descriptions.Item>
                        <Descriptions.Item label="Leachate Ponds">{leachate || "—"}</Descriptions.Item>
                        <Descriptions.Item label="Gas Vents">{gasVents || "—"}</Descriptions.Item>
                        <Descriptions.Item label="Waste Received" span={1}>
                          {wasteReceived ? `${Number(wasteReceived).toLocaleString()} tons` : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Est. Volume" span={1}>
                          {estVolume ? Number(estVolume).toLocaleString() : "—"}
                        </Descriptions.Item>
                        <Descriptions.Item label="MRF Established" span={1}>
                          {detailViewRecord.mrfEstablished || "—"}
                        </Descriptions.Item>
                      </Descriptions>

                      {/* Cell Infrastructure Status */}
                      {cells > 0 && (() => {
                        const cellStatuses = detailViewRecord.cellStatuses || [];
                        const cellTypesArr = detailViewRecord.cellTypes || [];
                        const hasCellBaseline = baselineData && (
                          baselineData.activeCellResidualVolume > 0 ||
                          baselineData.activeCellInertVolume > 0 ||
                          baselineData.closedCellResidualVolume > 0 ||
                          baselineData.closedCellInertVolume > 0
                        );
                        const handleCellToggle = async (cellIndex, checked) => {
                          const newStatus = checked ? "Operational" : "Closed";
                          try {
                            const { data } = await api.patch(`/slf-facilities/${detailViewRecord._id}/cell-status`, { cellIndex, status: newStatus });
                            setDetailModal(data);
                            setDetailYearRecords(prev => prev.map(r => r._id === data._id ? data : r));
                            // Refresh list and clear cache
                            fetchRecords(true);
                            Swal.fire({ icon: "success", title: `Cell ${cellIndex + 1}`, text: `Set to ${newStatus}`, timer: 1500, showConfirmButton: false });
                          } catch {
                            Swal.fire("Error", "Failed to update cell status", "error");
                          }
                        };
                        return (
                        <>
                          <Divider plain orientation="left"><BarChartOutlined /> Cell Infrastructure Status</Divider>
                          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                            <Col xs={24} md={10}>
                              <Card size="small" title={<><PieChartOutlined style={{ color: "#2f54eb" }} /> Capacity Utilization</>} style={{ borderRadius: 10 }}>
                                {capacityData.length > 0 ? (
                                  <ResponsiveContainer width="100%" height={190}>
                                    <PieChart>
                                      <Pie
                                        data={capacityData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={48}
                                        outerRadius={75}
                                        paddingAngle={capacityData.length > 1 ? 3 : 0}
                                        dataKey="value"
                                      >
                                        {capacityData.map((entry, i) => (
                                          <RCell
                                            key={i}
                                            fill={
                                              entry.name.includes("Residual") ? "#52c41a"
                                              : entry.name.includes("Haz") ? "#ff4d4f"
                                              : entry.name.includes("Remaining") ? "#d9d9d9"
                                              : CHART_COLORS[i % CHART_COLORS.length]
                                            }
                                          />
                                        ))}
                                      </Pie>
                                      <RTooltip formatter={(v) => v.toLocaleString()} />
                                      <Legend wrapperStyle={{ fontSize: 11 }} />
                                    </PieChart>
                                  </ResponsiveContainer>
                                ) : (
                                  <div style={{ textAlign: "center", padding: "30px 0", color: "#8c8c8c", fontSize: 12 }}>No capacity data available</div>
                                )}
                                <Row gutter={8} style={{ marginTop: 8, borderTop: "1px solid #f0f0f0", paddingTop: 8 }}>
                                  <Col span={12}>
                                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>Waste Received</div>
                                    <div style={{ fontSize: 14, fontWeight: 600 }}>{wasteReceived > 0 ? wasteReceived.toLocaleString() : "0"}</div>
                                  </Col>
                                  <Col span={12}>
                                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>Total Capacity</div>
                                    <div style={{ fontSize: 14, fontWeight: 600 }}>{capacity > 0 ? capacity.toLocaleString() : "—"}</div>
                                  </Col>
                                  <Col span={12} style={{ marginTop: 8 }}>
                                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>Remaining</div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: capacity - wasteReceived <= 0 ? "#ff4d4f" : "#52c41a" }}>
                                      {capacity > 0 ? (capacity - wasteReceived).toLocaleString() : "—"}
                                    </div>
                                  </Col>
                                  <Col span={12} style={{ marginTop: 8 }}>
                                    <div style={{ fontSize: 11, color: "#8c8c8c" }}>Status</div>
                                    <Tag color={detailViewRecord.statusOfSLF?.toLowerCase().includes("non") ? "red" : "green"} style={{ margin: 0 }}>
                                      {detailViewRecord.statusOfSLF || "—"}
                                    </Tag>
                                  </Col>
                                </Row>
                              </Card>
                            </Col>
                            <Col xs={24} md={14}>
                              <Card size="small" title={<><BarChartOutlined /> Per-Cell Status &amp; Capacity</>} style={{ borderRadius: 10 }}>
                                <Row gutter={[16, 16]} justify="center">
                                  {(cellCaps.length > 0 ? cellCaps : Array.from({ length: cells }, () => 0)).map((cap, i) => {
                                    const cellFill = capacity > 0 && cap > 0 ? Math.min(Math.round((cap / capacity) * 100 * cells), 100) : 0;
                                    const cellSt = cellStatuses[i] || "Operational";
                                    const cellTy = cellTypesArr[i] || "Residual";
                                    const isClosed = cellSt === "Closed";
                                    const isHaz = cellTy === "Treated Haz Waste";
                                    return (
                                      <Col xs={12} sm={8} key={i} style={{ textAlign: "center" }}>
                                        <Progress
                                          type="dashboard"
                                          percent={isClosed ? 100 : cellFill}
                                          size={80}
                                          strokeColor={isClosed ? "#d9d9d9" : isHaz ? "#f5222d" : cellFill >= 90 ? "#ff4d4f" : cellFill >= 70 ? "#faad14" : "#52c41a"}
                                          format={() => (
                                            <div style={{ lineHeight: 1.2 }}>
                                              <div style={{ fontSize: 14, fontWeight: 700, color: isClosed ? "#8c8c8c" : isHaz ? "#f5222d" : cellFill >= 90 ? "#ff4d4f" : cellFill >= 70 ? "#faad14" : "#52c41a" }}>
                                                {isClosed ? "—" : `${cellFill}%`}
                                              </div>
                                            </div>
                                          )}
                                        />
                                        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600 }}>Cell {i + 1}</div>
                                        <Tag color={isHaz ? "red" : "blue"} style={{ fontSize: 9, marginTop: 2 }}>{cellTy === "Treated Haz Waste" ? "Haz Waste" : cellTy}</Tag>
                                        <div style={{ fontSize: 10, color: "#8c8c8c" }}>{cap > 0 ? `${cap.toLocaleString()} m³` : "—"}</div>
                                        <div style={{ marginTop: 6 }}>
                                          <Tooltip title={isClosed ? "Set to Operational" : "Set to Closed"}>
                                            <Switch
                                              size="small"
                                              checked={!isClosed}
                                              onChange={(checked) => handleCellToggle(i, checked)}
                                              checkedChildren="ON"
                                              unCheckedChildren="OFF"
                                            />
                                          </Tooltip>
                                          <div style={{ fontSize: 9, color: isClosed ? "#ff4d4f" : "#52c41a", marginTop: 2, fontWeight: 600 }}>
                                            {cellSt}
                                          </div>
                                        </div>
                                      </Col>
                                    );
                                  })}
                                </Row>
                              </Card>
                            </Col>
                          </Row>

                          {/* Baseline cell volumes */}
                          {hasCellBaseline ? (
                            <Card size="small" title="Baseline Cell Volumes" style={{ borderRadius: 10, marginBottom: 8 }}>
                              <Descriptions size="small" bordered column={2}>
                                <Descriptions.Item label="Active Cell (Residual)">
                                  {baselineData.activeCellResidualVolume > 0
                                    ? `${Number(baselineData.activeCellResidualVolume).toLocaleString()} ${(baselineData.activeCellResidualUnit || "m³").replace("m3", "m³")}`
                                    : "—"}
                                </Descriptions.Item>
                                <Descriptions.Item label="Active Cell (Inert)">
                                  {baselineData.activeCellInertVolume > 0
                                    ? `${Number(baselineData.activeCellInertVolume).toLocaleString()} ${(baselineData.activeCellInertUnit || "m³").replace("m3", "m³")}`
                                    : "—"}
                                </Descriptions.Item>
                                <Descriptions.Item label="Closed Cell (Residual)">
                                  {baselineData.closedCellResidualVolume > 0
                                    ? `${Number(baselineData.closedCellResidualVolume).toLocaleString()} ${(baselineData.closedCellResidualUnit || "m³").replace("m3", "m³")}`
                                    : "—"}
                                </Descriptions.Item>
                                <Descriptions.Item label="Closed Cell (Inert)">
                                  {baselineData.closedCellInertVolume > 0
                                    ? `${Number(baselineData.closedCellInertVolume).toLocaleString()} ${(baselineData.closedCellInertUnit || "m³").replace("m3", "m³")}`
                                    : "—"}
                                </Descriptions.Item>
                                {baselineData.totalVolumeAccepted > 0 && (
                                  <Descriptions.Item label="Total Volume Accepted" span={2}>
                                    {Number(baselineData.totalVolumeAccepted).toLocaleString()} {(baselineData.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}
                                  </Descriptions.Item>
                                )}
                              </Descriptions>
                            </Card>
                          ) : (
                            <Alert
                              type="warning"
                              showIcon
                              message="Baseline cell information not available"
                              description="The assigned SLF's baseline cell information (Active/Closed cell volumes) needs to be updated in the Baseline Data tab."
                              style={{ marginBottom: 8, borderRadius: 8 }}
                            />
                          )}
                        </>
                        );
                      })()}

                      {/* Leachate Pond Details */}
                      {((detailViewRecord.leachatePondDetails || []).length > 0 || leachate > 0) && (
                        <>
                          <Divider plain orientation="left"><AlertOutlined style={{ color: "#1677ff" }} /> Leachate Pond Details</Divider>
                          {(detailViewRecord.leachatePondDetails || []).length > 0 ? (
                            <Table
                              dataSource={detailViewRecord.leachatePondDetails}
                              rowKey={(_, i) => i}
                              size="small"
                              pagination={false}
                              style={{ marginBottom: 16 }}
                              expandable={{
                                rowExpandable: (r) => !!(r.description || (r.attachments || []).length),
                                expandedRowRender: (r) => (
                                  <div>
                                    {r.description && <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>{r.description}</Text>}
                                    {(r.attachments || []).length > 0 && (
                                      <Space size={4} wrap>
                                        {r.attachments.map((a, ai) => (
                                          <Tag key={ai} color="blue" style={{ cursor: "pointer" }} onClick={() => a.startsWith("http") ? window.open(a, "_blank") : null}>{a}</Tag>
                                        ))}
                                      </Space>
                                    )}
                                  </div>
                                ),
                              }}
                              columns={[
                                { title: "Pond No.", dataIndex: "pondNo", width: 80, render: (v) => v ?? "—" },
                                { title: "Description", dataIndex: "description", render: (v) => v ? <Text ellipsis={{ tooltip: v }} style={{ maxWidth: 280, display: "block" }}>{v}</Text> : <Text type="secondary">—</Text> },
                                { title: "Status", dataIndex: "status", width: 150, render: (v) => <Tag color={v === "Active" ? "blue" : v === "Under Maintenance" ? "orange" : "default"}>{v || "—"}</Tag> },
                                { title: "Attachments", dataIndex: "attachments", width: 100, render: (v) => (v || []).length ? <Tag color="geekblue">{(v || []).length} file(s)</Tag> : "—" },
                              ]}
                            />
                          ) : (
                            <Alert type="info" showIcon message={`${leachate} leachate pond(s) recorded (no detail entries yet)`} style={{ marginBottom: 16, borderRadius: 8 }} />
                          )}
                        </>
                      )}

                      {/* Gas Vent Details */}
                      {((detailViewRecord.gasVentDetails || []).length > 0 || gasVents > 0) && (
                        <>
                          <Divider plain orientation="left"><ExperimentOutlined style={{ color: "#52c41a" }} /> Gas Vent Details</Divider>
                          {(detailViewRecord.gasVentDetails || []).length > 0 ? (
                            <Table
                              dataSource={detailViewRecord.gasVentDetails}
                              rowKey={(_, i) => i}
                              size="small"
                              pagination={false}
                              style={{ marginBottom: 16 }}
                              expandable={{
                                rowExpandable: (r) => !!(r.description || (r.attachments || []).length),
                                expandedRowRender: (r) => (
                                  <div>
                                    {r.description && <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>{r.description}</Text>}
                                    {(r.attachments || []).length > 0 && (
                                      <Space size={4} wrap>
                                        {r.attachments.map((a, ai) => (
                                          <Tag key={ai} color="green" style={{ cursor: "pointer" }} onClick={() => a.startsWith("http") ? window.open(a, "_blank") : null}>{a}</Tag>
                                        ))}
                                      </Space>
                                    )}
                                  </div>
                                ),
                              }}
                              columns={[
                                { title: "Vent No.", dataIndex: "ventNo", width: 80, render: (v) => v ?? "—" },
                                { title: "Type", dataIndex: "ventType", width: 130, render: (v) => v || "—" },
                                { title: "Description", dataIndex: "description", render: (v) => v ? <Text ellipsis={{ tooltip: v }} style={{ maxWidth: 220, display: "block" }}>{v}</Text> : <Text type="secondary">—</Text> },
                                { title: "Status", dataIndex: "status", width: 150, render: (v) => <Tag color={v === "Active" ? "green" : v === "Under Maintenance" ? "orange" : "default"}>{v || "—"}</Tag> },
                                { title: "Attachments", dataIndex: "attachments", width: 100, render: (v) => (v || []).length ? <Tag color="cyan">{(v || []).length} file(s)</Tag> : "—" },
                              ]}
                            />
                          ) : (
                            <Alert type="info" showIcon message={`${gasVents} gas vent(s) recorded (no detail entries yet)`} style={{ marginBottom: 16, borderRadius: 8 }} />
                          )}
                        </>
                      )}

                      <Descriptions column={2} size="small" bordered title="Permits" style={{ marginBottom: 16 }}>
                        <Descriptions.Item label="ECC No.">{detailViewRecord.eccNo || "—"}</Descriptions.Item>
                        <Descriptions.Item label="Discharge Permit">{detailViewRecord.dischargePermit || "—"}</Descriptions.Item>
                        <Descriptions.Item label="Permit to Operate">{detailViewRecord.permitToOperate || "—"}</Descriptions.Item>
                        <Descriptions.Item label="Hazwaste Gen. ID">{detailViewRecord.hazwasteGenerationId || "—"}</Descriptions.Item>
                      </Descriptions>
                      {detailViewRecord.slfGenerator && (
                        <div style={{ marginBottom: 16 }}>
                          <Divider plain orientation="left">
                            Portal Link
                          </Divider>
                          <Tag color="blue" icon={<LinkOutlined />}>
                            {typeof detailViewRecord.slfGenerator === "object"
                              ? detailViewRecord.slfGenerator.slfName
                              : "Linked Generator"}
                          </Tag>
                        </div>
                      )}
                      {hasCharts && (
                        <>
                          <Divider plain orientation="left">
                            <BarChartOutlined /> Charts
                          </Divider>
                          <Row gutter={[16, 16]}>
                            {/* Capacity Utilization Pie — shown in Charts section only when no cell infra section (cells === 0) */}
                            {capacityData.length > 0 && cells === 0 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Capacity Utilization by Waste Type" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                      <Pie
                                        data={capacityData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={capacityData.length > 1 ? 3 : 0}
                                        dataKey="value"
                                        label={({ name, value }) => `${name}: ${value.toLocaleString()}`}
                                      >
                                        {capacityData.map((entry, i) => (
                                          <RCell
                                            key={i}
                                            fill={
                                              entry.name.includes("Residual") ? "#52c41a"
                                              : entry.name.includes("Haz") ? "#ff4d4f"
                                              : entry.name.includes("Remaining") ? "#d9d9d9"
                                              : CHART_COLORS[i % CHART_COLORS.length]
                                            }
                                          />
                                        ))}
                                      </Pie>
                                      <RTooltip formatter={(v) => v.toLocaleString()} />
                                      <Legend />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                            {/* Volume Comparison Bar */}
                            {volumeData.length > 1 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Volume Comparison" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={volumeData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                      <YAxis />
                                      <RTooltip formatter={(v) => v.toLocaleString()} />
                                      <Bar dataKey="value" fill="#52c41a" radius={[4, 4, 0, 0]}>
                                        {volumeData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                            {/* Cell Volumes (from baseline) */}
                            {cellVolumeData.length > 0 && (
                              <Col xs={24} md={cellVolumeData.length >= 2 ? 12 : 24}>
                                <Card size="small" title="Cell Volumes (Baseline)" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={cellVolumeData}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                      <YAxis />
                                      <RTooltip
                                        formatter={(v, _, entry) =>
                                          `${v.toLocaleString()} ${entry.payload.unit || ""}`
                                        }
                                      />
                                      <Bar dataKey="value" fill="#722ed1" radius={[4, 4, 0, 0]}>
                                        {cellVolumeData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[(i + 3) % CHART_COLORS.length]} />
                                        ))}
                                      </Bar>
                                    </BarChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                            {/* Per-cell pie if 2+ cells */}
                            {cells >= 2 && cellVolumeData.length >= 2 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Cell Volume Distribution" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                      <Pie
                                        data={cellVolumeData}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        paddingAngle={3}
                                        dataKey="value"
                                        label={({ name, value }) =>
                                          `${name}: ${value.toLocaleString()}`
                                        }
                                      >
                                        {cellVolumeData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[(i + 3) % CHART_COLORS.length]} />
                                        ))}
                                      </Pie>
                                      <RTooltip
                                        formatter={(v, _, entry) =>
                                          `${v.toLocaleString()} ${entry.payload.unit || ""}`
                                        }
                                      />
                                      <Legend />
                                    </PieChart>
                                  </ResponsiveContainer>
                                </Card>
                              </Col>
                            )}
                          </Row>
                        </>
                      )}
                    </>
                  );
                })(),
              },
              {
                key: "3",
                label: "Personnel & Monitoring",
                children: (
                  <Descriptions column={2} size="small" bordered>
                    <Descriptions.Item label="Target Month">{detailViewRecord.targetMonth || "—"}</Descriptions.Item>
                    <Descriptions.Item label="ENMO">{detailViewRecord.enmo || "—"}</Descriptions.Item>
                    <Descriptions.Item label="ESWM Staff">{detailViewRecord.eswmStaff || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Focal Person">{detailViewRecord.focalPerson || "—"}</Descriptions.Item>
                    <Descriptions.Item label="IIS Number">{detailViewRecord.iisNumber || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Monitoring">
                      {detailViewRecord.dateOfMonitoring
                        ? dayjs(detailViewRecord.dateOfMonitoring).format("MMM DD, YYYY")
                        : "—"}
                    </Descriptions.Item>
                    <Descriptions.Item label="Days Prepared">{detailViewRecord.totalDaysReportPrepared ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="Days Staff Review">{detailViewRecord.totalDaysReviewedStaff ?? "—"}</Descriptions.Item>
                    <Descriptions.Item label="Days Focal Review" span={2}>{detailViewRecord.totalDaysReviewedFocal ?? "—"}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: "4",
                label: "Compliance",
                children: (
                  <Descriptions column={2} size="small" bordered>
                    <Descriptions.Item label="Remarks" span={2}>{detailViewRecord.remarksAndRecommendation || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Findings" span={2}>{detailViewRecord.findings || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Advise Letter">{detailViewRecord.adviseLetterDateIssued || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Compliance">{detailViewRecord.complianceToAdvise || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Signed Document">{detailViewRecord.signedDocument || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Docket (NOV)">{detailViewRecord.docketNoNOV || "—"}</Descriptions.Item>
                    <Descriptions.Item label="NOV Date">{detailViewRecord.dateOfIssuanceNOV || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Tech Conference">{detailViewRecord.dateOfTechnicalConference || "—"}</Descriptions.Item>
                    <Descriptions.Item label="Commitments" span={2}>{detailViewRecord.commitments || "—"}</Descriptions.Item>
                  </Descriptions>
                ),
              },
              {
                key: "5",
                label: <span style={{ color: "#fa8c16" }}><WarningOutlined /> Preventive Measures</span>,
                children: (
                  <>
                    <Divider orientation="left">Trash Slide Prevention Measures</Divider>
                    {detailViewRecord.trashSlideMeasures?.length > 0 ? (
                      <Table
                        dataSource={detailViewRecord.trashSlideMeasures}
                        rowKey={(_, i) => i}
                        size="small"
                        pagination={false}
                        columns={[
                          { title: "Measure", dataIndex: "measure", render: (v) => v || "—" },
                          { title: "Description", dataIndex: "description", render: (v) => v || "—" },
                          { title: "Status", dataIndex: "status", width: 140, render: (v) => <Tag color={v === "Implemented" ? "green" : v === "Pending" ? "orange" : "default"}>{v || "—"}</Tag> },
                          { title: "Attachments", dataIndex: "attachments", width: 180, render: (v) => (v || []).length > 0 ? <Space size={4} wrap>{(v || []).map((a, i) => <Tag key={i} color="orange" style={{ fontSize: 11 }}>{a}</Tag>)}</Space> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                        ]}
                      />
                    ) : <Empty description="No trash slide prevention measures recorded" />}
                    <Divider orientation="left" style={{ marginTop: 16 }}>Fire Prevention Measures</Divider>
                    {detailViewRecord.firePrevMeasures?.length > 0 ? (
                      <Table
                        dataSource={detailViewRecord.firePrevMeasures}
                        rowKey={(_, i) => i}
                        size="small"
                        pagination={false}
                        columns={[
                          { title: "Measure", dataIndex: "measure", render: (v) => v || "—" },
                          { title: "Description", dataIndex: "description", render: (v) => v || "—" },
                          { title: "Status", dataIndex: "status", width: 140, render: (v) => <Tag color={v === "Implemented" ? "green" : v === "Pending" ? "orange" : "default"}>{v || "—"}</Tag> },
                          { title: "Attachments", dataIndex: "attachments", width: 180, render: (v) => (v || []).length > 0 ? <Space size={4} wrap>{(v || []).map((a, i) => <Tag key={i} color="red" style={{ fontSize: 11 }}>{a}</Tag>)}</Space> : <Text type="secondary" style={{ fontSize: 11 }}>—</Text> },
                        ]}
                      />
                    ) : <Empty description="No fire prevention measures recorded" />}
                  </>
                ),
              },
              ...(detailViewRecord.slfGenerator
                ? [
                    {
                      key: "6",
                      label: (
                        <>
                          <DatabaseOutlined /> Baseline Info
                        </>
                      ),
                      children: loadingBaseline ? (
                        <div style={{ textAlign: "center", padding: 32 }}>
                          <Text type="secondary">Loading baseline data...</Text>
                        </div>
                      ) : baselineData ? (
                        <>
                          <Row gutter={[16, 12]}>
                            <Col span={24}>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                Last updated:{" "}
                                {baselineData.savedAt
                                  ? dayjs(baselineData.savedAt).format("MMM DD, YYYY h:mm A")
                                  : "—"}
                              </Text>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Total Volume Accepted"
                                  value={baselineData.totalVolumeAccepted ?? 0}
                                  suffix={(baselineData.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Active Cell (Residual)"
                                  value={baselineData.activeCellResidualVolume ?? 0}
                                  suffix={(baselineData.activeCellResidualUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Active Cell (Inert)"
                                  value={baselineData.activeCellInertVolume ?? 0}
                                  suffix={(baselineData.activeCellInertUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Closed Cell (Residual)"
                                  value={baselineData.closedCellResidualVolume ?? 0}
                                  suffix={(baselineData.closedCellResidualUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                            <Col span={12}>
                              <Card size="small" style={{ borderRadius: 8 }}>
                                <Statistic
                                  title="Closed Cell (Inert)"
                                  value={baselineData.closedCellInertVolume ?? 0}
                                  suffix={(baselineData.closedCellInertUnit || "m³").replace("m3", "m³")}
                                  precision={2}
                                />
                              </Card>
                            </Col>
                          </Row>
                          {baselineData.accreditedHaulers?.length > 0 && (
                            <>
                              <Divider plain orientation="left">
                                <TeamOutlined /> Accredited Haulers ({baselineData.accreditedHaulers.length})
                              </Divider>
                              <Table
                                dataSource={baselineData.accreditedHaulers}
                                rowKey={(_, i) => i}
                                size="small"
                                pagination={false}
                                expandable={{
                                  expandedRowRender: (h) => {
                                    const vehicles = h.vehicles || [];
                                    const clients = h.privateSectorClients || [];
                                    return (
                                      <div style={{ padding: "8px 0" }}>
                                        {vehicles.length > 0 && (
                                          <>
                                            <Text strong style={{ fontSize: 12, color: "#1677ff" }}>Registered Vehicles</Text>
                                            <Table
                                              dataSource={vehicles}
                                              rowKey={(_, vi) => vi}
                                              size="small"
                                              pagination={false}
                                              style={{ marginTop: 6, marginBottom: 10 }}
                                              columns={[
                                                { title: "Plate No.", dataIndex: "plateNumber", width: 120, render: v => v || "—" },
                                                { title: "Type", dataIndex: "vehicleType", width: 130, render: v => v ? <Tag color="geekblue">{v}</Tag> : "—" },
                                                { title: "Capacity", width: 140, render: (_, v) => v.capacity ? `${Number(v.capacity).toLocaleString()} ${v.capacityUnit || "m³"}` : "—" },
                                              ]}
                                            />
                                          </>
                                        )}
                                        {clients.length > 0 && (
                                          <>
                                            <Text strong style={{ fontSize: 12, color: "#52c41a" }}>Private Sector Clients</Text>
                                            <Table
                                              dataSource={clients}
                                              rowKey={(_, ci) => ci}
                                              size="small"
                                              pagination={false}
                                              style={{ marginTop: 6 }}
                                              columns={[
                                                { title: "Client Name", dataIndex: "clientName", render: v => v || "—" },
                                                { title: "Type", dataIndex: "clientType", width: 100, render: v => v ? <Tag color={v === "LGU" ? "blue" : "purple"}>{v}</Tag> : "—" },
                                                { title: "Province", dataIndex: "province", width: 120, render: v => v || "—" },
                                                { title: "Municipality", dataIndex: "municipality", width: 140, render: v => v || "—" },
                                                { title: "Trips/Month", dataIndex: "noOfTripsPerMonth", width: 110, align: "center", render: v => v ?? "—" },
                                              ]}
                                            />
                                          </>
                                        )}
                                        {vehicles.length === 0 && clients.length === 0 && (
                                          <Text type="secondary" style={{ fontSize: 12 }}>No vehicle or client details recorded.</Text>
                                        )}
                                      </div>
                                    );
                                  },
                                  rowExpandable: (h) => (h.vehicles?.length || 0) > 0 || (h.privateSectorClients?.length || 0) > 0,
                                }}
                                columns={[
                                  { title: "Hauler Name", dataIndex: "haulerName", key: "haulerName", render: v => <Text strong style={{ fontSize: 12 }}>{v || "—"}</Text> },
                                  { title: "No. of Trucks", dataIndex: "numberOfTrucks", key: "numberOfTrucks", width: 110, align: "center", render: v => v != null ? <Tag color="blue">{v}</Tag> : "—" },
                                  { title: "Office Address", key: "officeAddr", render: (_, h) => {
                                    const parts = [h.officeBarangay, h.officeCity, h.officeProvince].filter(Boolean);
                                    return parts.length > 0 ? parts.join(", ") : (h.officeAddress || "—");
                                  }},
                                  { title: "Vehicles", key: "vehicleCount", width: 90, align: "center", render: (_, h) => (h.vehicles?.length || 0) > 0 ? <Tag color="geekblue">{h.vehicles.length}</Tag> : <Text type="secondary">—</Text> },
                                  { title: "Clients", key: "clientCount", width: 80, align: "center", render: (_, h) => (h.privateSectorClients?.length || 0) > 0 ? <Tag color="green">{h.privateSectorClients.length}</Tag> : <Text type="secondary">—</Text> },
                                ]}
                              />
                            </>
                          )}
                        </>
                      ) : (
                        <div style={{ textAlign: "center", padding: 32 }}>
                          <Text type="secondary">
                            No baseline data submitted yet for this SLF.
                          </Text>
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />) : (
            <div style={{ textAlign: "center", padding: 48 }}>
              <Empty description="No record found for this year" />
            </div>
          )}
          </>
        )}
      </Modal>

      {/* ── LGU Served Drill-Down Modal ── */}
      <Modal
        open={slfLguModal}
        onCancel={() => setSlfLguModal(false)}
        title={<Space><TeamOutlined style={{ color: "#fa8c16" }} /><Text strong>LGU Served — SLF Details</Text></Space>}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Button onClick={() => setSlfLguModal(false)}>Close</Button>
            <Button type="primary" icon={<TableOutlined />} onClick={() => setSlfLguModal(false)}>
              See More Details in Table
            </Button>
          </div>
        }
        width={1050}
        destroyOnHidden
      >
        {(() => {
          const lguData = records.filter(r => Number(r.noOfLGUServed || 0) > 0);
          const inR3 = lguData.filter(r => R3_PROVINCES.includes(r.province));
          const outR3 = lguData.filter(r => !R3_PROVINCES.includes(r.province));
          const totalInR3 = inR3.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
          const totalOutR3 = outR3.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
          const cols = [
            { title: "SLF / LGU", dataIndex: "lgu", key: "lgu", width: 180, render: (v, r) => <Text strong style={{ fontSize: 12 }}>{v}{r.barangay ? <Text type="secondary" style={{ fontSize: 11 }}> ({r.barangay})</Text> : ""}</Text> },
            { title: "Province", dataIndex: "province", key: "province", width: 120, render: v => <Tag color="geekblue">{v || "—"}</Tag> },
            { title: "No. of LGUs Served", dataIndex: "noOfLGUServed", key: "noOfLGUServed", width: 140, align: "center", render: v => <Badge count={v} color="#fa8c16" overflowCount={999} style={{ fontWeight: 700 }} /> },
            { title: "Status", dataIndex: "statusOfSLF", key: "statusOfSLF", width: 130, render: v => getStatusTag(v) },
            { title: "Ownership", dataIndex: "ownership", key: "ownership", width: 130, render: v => v || "—" },
            { title: "Category", dataIndex: "category", key: "category", width: 80, align: "center", render: v => v ? <Tag color="purple">{v}</Tag> : "—" },
          ];
          const summary = (data) => {
            const tot = data.reduce((s, r) => s + (r.noOfLGUServed || 0), 0);
            return <Table.Summary.Row><Table.Summary.Cell colSpan={2} index={0}><Text strong>Total</Text></Table.Summary.Cell><Table.Summary.Cell index={2} align="center"><Text strong style={{ color: "#fa8c16" }}>{tot}</Text></Table.Summary.Cell><Table.Summary.Cell colSpan={3} index={3} /></Table.Summary.Row>;
          };
          return (
            <Tabs
              defaultActiveKey="r3"
              items={[
                {
                  key: "r3",
                  label: <span><EnvironmentOutlined /> Within Region 3 <Badge count={totalInR3} color="#fa8c16" overflowCount={999} style={{ marginLeft: 4 }} /></span>,
                  children: inR3.length > 0 ? (
                    <>
                      <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col span={8}><Card size="small" style={{ borderRadius: 8, background: "#fff7e6", borderColor: "#ffd591" }}><Statistic title="SLF Facilities" value={inR3.length} valueStyle={{ color: "#fa8c16", fontSize: 22 }} /></Card></Col>
                        <Col span={8}><Card size="small" style={{ borderRadius: 8, background: "#fff7e6", borderColor: "#ffd591" }}><Statistic title="Total LGUs Served" value={totalInR3} valueStyle={{ color: "#fa8c16", fontSize: 22 }} /></Card></Col>
                        <Col span={8}><Card size="small" style={{ borderRadius: 8, background: "#fff7e6", borderColor: "#ffd591" }}><Statistic title="Avg LGUs/SLF" value={(totalInR3 / inR3.length).toFixed(1)} valueStyle={{ color: "#fa8c16", fontSize: 22 }} /></Card></Col>
                      </Row>
                      <Table dataSource={inR3} rowKey="_id" size="small" columns={cols} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: "max-content" }} summary={summary} />
                    </>
                  ) : <Empty description="No SLF data within Region 3 reporting LGU services" />,
                },
                {
                  key: "out",
                  label: <span><EnvironmentOutlined /> Outside Region 3 <Badge count={totalOutR3} color="#1890ff" overflowCount={999} style={{ marginLeft: 4 }} /></span>,
                  children: outR3.length > 0 ? (
                    <>
                      <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col span={8}><Card size="small" style={{ borderRadius: 8, background: "#e6f7ff", borderColor: "#91d5ff" }}><Statistic title="SLF Facilities" value={outR3.length} valueStyle={{ color: "#1890ff", fontSize: 22 }} /></Card></Col>
                        <Col span={8}><Card size="small" style={{ borderRadius: 8, background: "#e6f7ff", borderColor: "#91d5ff" }}><Statistic title="Total LGUs Served" value={totalOutR3} valueStyle={{ color: "#1890ff", fontSize: 22 }} /></Card></Col>
                        <Col span={8}><Card size="small" style={{ borderRadius: 8, background: "#e6f7ff", borderColor: "#91d5ff" }}><Statistic title="Avg LGUs/SLF" value={(totalOutR3 / outR3.length).toFixed(1)} valueStyle={{ color: "#1890ff", fontSize: 22 }} /></Card></Col>
                      </Row>
                      <Table dataSource={outR3} rowKey="_id" size="small" columns={cols} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: "max-content" }} summary={summary} />
                    </>
                  ) : <Empty description="No SLF data outside Region 3 reporting LGU services" />,
                },
              ]}
            />
          );
        })()}
      </Modal>

      {/* ── Waste Received Drill-Down Modal ── */}
      <Modal
        open={slfWasteModal}
        onCancel={() => setSlfWasteModal(false)}
        title={<Space><BarChartOutlined style={{ color: "#ff4d4f" }} /><Text strong>Waste Received — SLF Details</Text></Space>}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Button onClick={() => setSlfWasteModal(false)}>Close</Button>
            <Button type="primary" icon={<TableOutlined />} onClick={() => setSlfWasteModal(false)}>
              See More Details in Table
            </Button>
          </div>
        }
        width={1100}
        destroyOnHidden
      >
        {(() => {
          const wasteData = records.filter(r => Number(r.actualResidualWasteReceived || 0) > 0);
          const r3Lgus = wasteData.filter(r => R3_PROVINCES.includes(r.province) && !/private/i.test(r.ownership || ""));
          const outLgus = wasteData.filter(r => !R3_PROVINCES.includes(r.province) && !/private/i.test(r.ownership || ""));
          const privates = wasteData.filter(r => /private/i.test(r.ownership || ""));
          const toBarData = (arr) => arr.map(r => ({ name: r.lgu || r.province || "Unknown", waste: r.actualResidualWasteReceived || 0, province: r.province || "—", status: r.statusOfSLF || "—" })).sort((a, b) => b.waste - a.waste);
          const WasteSection = ({ data, color, label }) => {
            const barData = toBarData(data);
            const total = barData.reduce((s, d) => s + d.waste, 0);
            if (barData.length === 0) return <Empty description={`No ${label} waste data available`} style={{ padding: 24 }} />;
            return (
              <div style={{ marginBottom: 20 }}>
                <Row gutter={12} style={{ marginBottom: 10 }}>
                  <Col span={8}><Card size="small" style={{ borderRadius: 8, background: `${color}0d`, border: `1px solid ${color}40` }}><Statistic title="SLF Facilities" value={barData.length} valueStyle={{ color, fontSize: 20 }} /></Card></Col>
                  <Col span={8}><Card size="small" style={{ borderRadius: 8, background: `${color}0d`, border: `1px solid ${color}40` }}><Statistic title="Total Waste (tons)" value={total.toLocaleString()} valueStyle={{ color, fontSize: 20 }} /></Card></Col>
                  <Col span={8}><Card size="small" style={{ borderRadius: 8, background: `${color}0d`, border: `1px solid ${color}40` }}><Statistic title="Avg/Facility (tons)" value={(total / barData.length).toLocaleString(undefined, { maximumFractionDigits: 0 })} valueStyle={{ color, fontSize: 20 }} /></Card></Col>
                </Row>
                <ResponsiveContainer width="100%" height={Math.max(160, barData.length * 30)}>
                  <BarChart data={barData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <RTooltip formatter={(v) => [`${Number(v).toLocaleString()} tons`, "Waste Received"]} />
                    <Bar dataKey="waste" fill={color} radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 10, formatter: v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          };
          return (
            <Tabs
              defaultActiveKey="r3"
              items={[
                {
                  key: "r3",
                  label: <span><EnvironmentOutlined /> Region 3 LGUs ({r3Lgus.length})</span>,
                  children: <WasteSection data={r3Lgus} color="#52c41a" label="Region 3 LGU" />,
                },
                {
                  key: "out",
                  label: <span><EnvironmentOutlined /> Outside Region 3 ({outLgus.length})</span>,
                  children: <WasteSection data={outLgus} color="#1890ff" label="outside Region 3 LGU" />,
                },
                {
                  key: "private",
                  label: <span><BankOutlined /> Private Industries ({privates.length})</span>,
                  children: <WasteSection data={privates} color="#722ed1" label="private industry" />,
                },
              ]}
            />
          );
        })()}
      </Modal>

    </div>
  );
}
