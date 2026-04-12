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
      render: (t) => <Text strong>{t}</Text>,
    },
    {
      title: "Baseline Volume",
      render: (_, r) =>
        `${(r.existingBaselineVolume ?? 0).toLocaleString()} ${(r.existingBaselineUnit || "tons").replace("m3", "m³")}`,
    },
    {
      title: "Total Since Operation",
      render: (_, r) =>
        `${(r.totalVolumeSinceOperation ?? 0).toLocaleString()} ${(r.totalVolumeSinceOperationUnit || "tons").replace("m3", "m³")}`,
    },
    { title: "Haulers", render: (_, r) => r.accreditedHaulers?.length || 0 },
    {
      title: "Linked Facilities",
      render: (_, r) => linkedFacilities[r._id] || 0,
    },
    {
      title: "Portal Entries",
      render: (_, r) => {
        const cnt = statsMap[r._id]?.totalEntries || 0;
        return cnt > 0 ? (
          <Tag color="blue">{cnt}</Tag>
        ) : (
          <Text type="secondary">0</Text>
        );
      },
    },
    {
      title: "Pending",
      render: (_, r) => {
        const cnt = statsMap[r._id]?.pendingCount || 0;
        return cnt > 0 ? (
          <Tag color="orange">{cnt}</Tag>
        ) : (
          <Text type="secondary">0</Text>
        );
      },
    },
    {
      title: "Status",
      dataIndex: "isActive",
      render: (v) =>
        v ? <Tag color="green">Active</Tag> : <Tag color="red">Inactive</Tag>,
    },
    {
      title: "Actions",
      width: 120,
      render: (_, r) => (
        <Space>
          {canEdit && <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEdit(r)}
          />}
          {canDelete && <Popconfirm title="Delete?" onConfirm={() => handleDelete(r._id)}>
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>}
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
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Portal Submissions"
              value={overallStats.totalEntries}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Total Waste Volume"
              value={overallStats.totalVolume}
              suffix="tons"
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Pending Reviews"
              value={overallStats.pendingCount}
              valueStyle={{ color: "#faad14" }}
              prefix={<AlertOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" style={{ borderRadius: 10 }}>
            <Statistic
              title="Acknowledged"
              value={overallStats.acknowledgedCount}
              valueStyle={{ color: "#52c41a" }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <Text type="secondary">
          Manage portal SLF generators that waste generators submit disposal
          data to.
        </Text>
        {canEdit && <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={openAdd}
          style={{ background: ACCENT, borderColor: ACCENT }}
        >
          Add Generator
        </Button>}
      </div>
      <Table
        dataSource={generators}
        columns={genColumns}
        rowKey="_id"
        loading={loadingGen}
        size="small"
        pagination={{ pageSize: 10 }}
        scroll={{ x: 700 }}
      />

      {/* Portal Submissions Data Table */}
      <Divider orientation="left" plain>
        <FileTextOutlined style={{ color: ACCENT }} /> Portal Submitted Data
        {submissions.filter((s) => s.revertRequested).length > 0 && (
          <Badge
            count={submissions.filter((s) => s.revertRequested).length}
            style={{ marginLeft: 8, backgroundColor: "#fa8c16" }}
            title="Revert requests pending"
          />
        )}
      </Divider>
      <Table
        dataSource={submissions}
        rowKey="_id"
        loading={loadingSub}
        size="small"
        pagination={{ pageSize: 15, showSizeChanger: true, showTotal: (t) => `${t} entries` }}
        scroll={{ x: 1100 }}
        columns={[
          {
            title: "ID No",
            dataIndex: "idNo",
            key: "idNo",
            width: 160,
            render: (t) => <Text strong style={{ fontSize: 12 }}>{t}</Text>,
          },
          {
            title: "SLF Name",
            key: "slfName",
            width: 160,
            render: (_, r) =>
              r.slfGenerator?.slfName || <Text type="secondary">—</Text>,
            filters: generators.map((g) => ({ text: g.slfName, value: g._id })),
            onFilter: (val, r) => {
              const gid = r.slfGenerator?._id || r.slfGenerator;
              return gid === val;
            },
          },
          {
            title: "Company",
            dataIndex: "lguCompanyName",
            key: "lguCompanyName",
            ellipsis: true,
          },
          {
            title: "Type",
            dataIndex: "companyType",
            key: "companyType",
            width: 80,
            render: (v) =>
              v === "LGU" ? (
                <Tag color="blue">LGU</Tag>
              ) : v === "Private" ? (
                <Tag color="purple">Private</Tag>
              ) : (
                <Tag>{v || "—"}</Tag>
              ),
            filters: [
              { text: "LGU", value: "LGU" },
              { text: "Private", value: "Private" },
            ],
            onFilter: (val, r) => r.companyType === val,
          },
          {
            title: "Date of Disposal",
            dataIndex: "dateOfDisposal",
            key: "dateOfDisposal",
            width: 120,
            render: (v) => (v ? dayjs(v).format("MMM DD, YYYY") : "—"),
            sorter: (a, b) =>
              new Date(a.dateOfDisposal || 0) - new Date(b.dateOfDisposal || 0),
          },
          {
            title: "Trucks",
            key: "trucks",
            width: 70,
            render: (_, r) => r.trucks?.length || 0,
          },
          {
            title: "Total Volume",
            key: "volume",
            width: 110,
            render: (_, r) => {
              const vol = (r.trucks || []).reduce(
                (s, t) => s + (t.actualVolume || 0),
                0,
              );
              return vol > 0 ? `${vol.toLocaleString()} tons` : "—";
            },
            sorter: (a, b) => {
              const va = (a.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
              const vb = (b.trucks || []).reduce((s, t) => s + (t.actualVolume || 0), 0);
              return va - vb;
            },
          },
          {
            title: "Status",
            dataIndex: "status",
            key: "status",
            width: 110,
            render: (v) => {
              const color =
                v === "acknowledged"
                  ? "green"
                  : v === "rejected"
                    ? "red"
                    : v === "reverted"
                      ? "volcano"
                      : "orange";
              return <Tag color={color}>{v}</Tag>;
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
            key: "createdAt",
            width: 120,
            render: (v) => (v ? dayjs(v).format("MMM DD, YYYY") : "—"),
            sorter: (a, b) =>
              new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
            defaultSortOrder: "descend",
          },
          {
            title: "Actions",
            key: "actions",
            width: 180,
            render: (_, r) => (
              <Space size="small">
                {r.submissionId && (
                  <Tooltip title="View Transaction History">
                    <Button
                      type="text"
                      size="small"
                      icon={<HistoryOutlined style={{ color: ACCENT }} />}
                      onClick={() => openTxnHistory(r.submissionId)}
                    />
                  </Tooltip>
                )}
                {r.submittedBy && (
                  <Tooltip title="Send Email">
                    <Button
                      type="text"
                      size="small"
                      icon={<MailOutlined style={{ color: "#1677ff" }} />}
                      onClick={() => openEmailModal(r)}
                    />
                  </Tooltip>
                )}
                {r.status !== "reverted" && (
                  <Tooltip title="Revert Submission">
                    <Button
                      type="text"
                      size="small"
                      icon={<UndoOutlined style={{ color: "#fa541c" }} />}
                      onClick={() => { setRevertModal({ open: true, record: r }); setRevertReason(""); }}
                    />
                  </Tooltip>
                )}
                {r.revertRequested && (
                  <Tooltip title={`Revert requested: ${r.revertReason || "No reason"}`}>
                    <Popconfirm
                      title="Approve Revert?"
                      description="This will set the submission back to Pending so the portal user can edit it."
                      onConfirm={async () => {
                        try {
                          await api.patch(`/data-slf/${r._id}/approve-revert`);
                          fetchSubmissions();
                          Swal.fire({ icon: "success", title: "Reverted", text: "Submission reverted to Pending.", confirmButtonColor: ACCENT, timer: 2000 });
                        } catch (err) {
                          Swal.fire({ icon: "error", title: "Error", text: err.response?.data?.message || "Failed to revert" });
                        }
                      }}
                      okText="Revert"
                      okButtonProps={{ style: { background: "#fa8c16", borderColor: "#fa8c16" } }}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<Badge dot><UndoOutlined style={{ color: "#fa8c16" }} /></Badge>}
                      />
                    </Popconfirm>
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]}
      />

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
  const [filterYear, setFilterYear] = useState(null);
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

  const populateForm = (record) => {
    form.setFieldsValue({
      ...record,
      cellCapacities: record.cellCapacities || [],
      cellStatuses: record.cellStatuses || Array.from({ length: record.numberOfCell || 0 }, () => "Operational"),
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
      const payload = {
        ...values,
        dataYear: editYear,
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

  // Available years from data (always include current + previous year)
  const availableYears = useMemo(() => {
    const cy = new Date().getFullYear();
    const years = [...new Set([cy, cy - 1, ...records.map((r) => r.dataYear || cy)])];
    return years.sort((a, b) => b - a);
  }, [records]);

  const filtered = useMemo(() => {
    let data = records;
    if (filterYear)
      data = data.filter((r) => (r.dataYear || new Date().getFullYear()) === filterYear);
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
    filterYear,
  ]);

  const hasFilters =
    searchText ||
    filterProvince ||
    filterStatus ||
    filterCategory ||
    filterMonth ||
    filterYear;
  const clearFilters = () => {
    setSearchText("");
    setFilterProvince(null);
    setFilterStatus(null);
    setFilterCategory(null);
    setFilterMonth(null);
    setFilterYear(null);
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
      fixed: "left",
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
      fixed: "left",
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
      width: 100,
      fixed: "right",
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
      {/* Year Selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Space size={4} align="center">
          <CalendarOutlined style={{ color: ACCENT }} />
          <Text strong style={{ fontSize: 13, color: ACCENT }}>Data Year:</Text>
          <Button
            size="small"
            type={filterYear === null ? "primary" : "default"}
            onClick={() => setFilterYear(null)}
            style={filterYear === null ? { background: ACCENT, borderColor: ACCENT } : {}}
          >
            All
          </Button>
          {availableYears.map((yr) => (
            <Button
              key={yr}
              size="small"
              type={filterYear === yr ? "primary" : "default"}
              onClick={() => setFilterYear(yr)}
              style={filterYear === yr ? { background: ACCENT, borderColor: ACCENT } : {}}
            >
              {yr}
            </Button>
          ))}
        </Space>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: `3px solid ${ACCENT}`, height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: "3px solid #13c2c2", height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: "3px solid #fa8c16", height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: "3px solid #722ed1", height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: "3px solid #eb2f96", height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: "3px solid #ff4d4f", height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: "3px solid #1890ff", height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
          <Card size="small" hoverable style={{ borderRadius: 8, borderLeft: "3px solid #52c41a", height: "100%", padding: 0 }} bodyStyle={{ padding: "8px 12px" }}>
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
                          placeholder="Year"
                          value={filterYear}
                          onChange={setFilterYear}
                          style={{
                            width: "100%",
                            minWidth: 90,
                            maxWidth: 110,
                          }}
                          size="small"
                          options={availableYears.map((y) => ({ label: y, value: y }))}
                          suffixIcon={<CalendarOutlined />}
                        />
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
                  <style>{`
                    .slf-table .ant-table-header .ant-table-cell-fix-left,
                    .slf-table .ant-table-header .ant-table-cell-fix-right {
                      z-index: 3 !important;
                    }
                  `}</style>
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
        width={960}
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
            size="small"
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
                    const next = Array.from({ length: val || 0 }, (_, i) => cur[i] ?? null);
                    const nextSt = Array.from({ length: val || 0 }, (_, i) => curSt[i] || "Operational");
                    form.setFieldsValue({ cellCapacities: next, cellStatuses: nextSt });
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
                <InputNumber
                  id="conv-area"
                  style={{ width: "100%" }}
                  min={0}
                  step={0.01}
                  placeholder="Area (m²)"
                  addonAfter="m²"
                  onChange={() => {
                    const area = document.getElementById("conv-area")?.querySelector("input")?.value;
                    const depth = document.getElementById("conv-depth")?.querySelector("input")?.value;
                    const res = document.getElementById("conv-result");
                    if (area && depth && res) res.textContent = `= ${(Number(area) * Number(depth)).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
                  }}
                />
              </Col>
              <Col span={1} style={{ textAlign: "center" }}><Text type="secondary">×</Text></Col>
              <Col span={7}>
                <InputNumber
                  id="conv-depth"
                  style={{ width: "100%" }}
                  min={0}
                  step={0.01}
                  placeholder="Depth (m)"
                  addonAfter="m"
                  onChange={() => {
                    const area = document.getElementById("conv-area")?.querySelector("input")?.value;
                    const depth = document.getElementById("conv-depth")?.querySelector("input")?.value;
                    const res = document.getElementById("conv-result");
                    if (area && depth && res) res.textContent = `= ${(Number(area) * Number(depth)).toLocaleString(undefined, { maximumFractionDigits: 2 })} m³`;
                  }}
                />
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
                <Divider plain orientation="left" style={{ fontSize: 12, margin: "8px 0 16px" }}>Cell Capacities &amp; Status</Divider>
                <Row gutter={12}>
                  {Array.from({ length: cellCount }, (_, i) => (
                    <Col span={6} key={i}>
                      <Form.Item name={["cellCapacities", i]} label={`Cell ${i + 1} Capacity (m³)`}>
                        <InputNumber style={{ width: "100%" }} min={0} step={0.01} placeholder="Capacity" />
                      </Form.Item>
                      <Form.Item name={["cellStatuses", i]} label={`Cell ${i + 1} Status`} initialValue="Operational">
                        <Select options={[{ label: "Operational", value: "Operational" }, { label: "Closed", value: "Closed" }]} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
                </>
              );
            }}
          </Form.Item>
          <Form.Item noStyle dependencies={["numberOfCell", "cellCapacities", "cellStatuses", "volumeCapacity", "actualResidualWasteReceived"]}>
            {() => {
              const cellCount = form.getFieldValue("numberOfCell") || 0;
              const caps = form.getFieldValue("cellCapacities") || [];
              const statuses = form.getFieldValue("cellStatuses") || [];
              const totalCap = form.getFieldValue("volumeCapacity") || 0;
              const waste = form.getFieldValue("actualResidualWasteReceived") || 0;
              const pct = totalCap > 0 ? Math.min(Math.round((waste / totalCap) * 100), 100) : 0;
              if (cellCount < 1) return <Empty description="Select number of cells to see infrastructure preview" />;
              // Per-cell donut data for charts
              const cellDonutData = Array.from({ length: cellCount }, (_, i) => {
                const cap = caps[i] || 0;
                const st = statuses[i] || "Operational";
                // Distribute waste proportionally across operational cells
                const opCaps = caps.filter((c, j) => (statuses[j] || "Operational") !== "Closed" && c > 0);
                const totalOpCap = opCaps.reduce((s, c) => s + c, 0);
                const cellWaste = st === "Closed" ? cap : (totalOpCap > 0 && cap > 0 ? Math.round((cap / totalOpCap) * waste) : 0);
                return { index: i, capacity: cap, status: st, waste: Math.min(cellWaste, cap), remaining: Math.max(0, cap - Math.min(cellWaste, cap)) };
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
                          return (
                            <Col xs={12} sm={8} key={i} style={{ textAlign: "center" }}>
                              <Progress
                                type="dashboard"
                                percent={isClosed ? 100 : cellPct}
                                size={70}
                                strokeColor={isClosed ? "#d9d9d9" : cellPct >= 90 ? "#ff4d4f" : cellPct >= 70 ? "#faad14" : "#52c41a"}
                                format={() => (
                                  <div style={{ lineHeight: 1.2 }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: isClosed ? "#8c8c8c" : cellPct >= 90 ? "#ff4d4f" : cellPct >= 70 ? "#faad14" : "#52c41a" }}>
                                      {isClosed ? "—" : `${cellPct}%`}
                                    </div>
                                  </div>
                                )}
                              />
                              <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4 }}>Cell {i + 1}</div>
                              <Tag color={isClosed ? "default" : "green"} style={{ fontSize: 9, marginTop: 2 }}>{cell.status}</Tag>
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
        width={900}
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
                  const capacityData =
                    capacity > 0
                      ? [
                          { name: "Waste Received", value: Math.min(wasteReceived, capacity) },
                          { name: "Remaining", value: Math.max(0, capacity - wasteReceived) },
                        ]
                      : wasteReceived > 0
                        ? [{ name: "Waste Received", value: wasteReceived }]
                        : [];
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
                              <Card size="small" style={{ borderRadius: 10, textAlign: "center" }}>
                                <Progress
                                  type="dashboard"
                                  percent={pctUsed}
                                  size={140}
                                  strokeColor={pctUsed >= 90 ? "#ff4d4f" : pctUsed >= 70 ? "#faad14" : "#52c41a"}
                                  format={() => (
                                    <div style={{ lineHeight: 1.3 }}>
                                      <div style={{ fontSize: 22, fontWeight: 700, color: pctUsed >= 90 ? "#ff4d4f" : pctUsed >= 70 ? "#faad14" : "#52c41a" }}>{pctUsed}%</div>
                                      <div style={{ fontSize: 10, color: "#8c8c8c" }}>capacity used</div>
                                    </div>
                                  )}
                                />
                                <div style={{ marginTop: 12 }}>
                                  <Row gutter={8}>
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
                                </div>
                              </Card>
                            </Col>
                            <Col xs={24} md={14}>
                              <Card size="small" title={<><BarChartOutlined /> Per-Cell Status &amp; Capacity</>} style={{ borderRadius: 10 }}>
                                <Row gutter={[16, 16]} justify="center">
                                  {(cellCaps.length > 0 ? cellCaps : Array.from({ length: cells }, () => 0)).map((cap, i) => {
                                    const cellFill = capacity > 0 && cap > 0 ? Math.min(Math.round((cap / capacity) * 100 * cells), 100) : 0;
                                    const cellSt = cellStatuses[i] || "Operational";
                                    const isClosed = cellSt === "Closed";
                                    return (
                                      <Col xs={12} sm={8} key={i} style={{ textAlign: "center" }}>
                                        <Progress
                                          type="dashboard"
                                          percent={isClosed ? 100 : cellFill}
                                          size={80}
                                          strokeColor={isClosed ? "#d9d9d9" : cellFill >= 90 ? "#ff4d4f" : cellFill >= 70 ? "#faad14" : "#52c41a"}
                                          format={() => (
                                            <div style={{ lineHeight: 1.2 }}>
                                              <div style={{ fontSize: 14, fontWeight: 700, color: isClosed ? "#8c8c8c" : cellFill >= 90 ? "#ff4d4f" : cellFill >= 70 ? "#faad14" : "#52c41a" }}>
                                                {isClosed ? "—" : `${cellFill}%`}
                                              </div>
                                            </div>
                                          )}
                                        />
                                        <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600 }}>Cell {i + 1}</div>
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
                        </>
                        );
                      })()}

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
                            {/* Capacity Utilization Pie */}
                            {capacityData.length > 0 && (
                              <Col xs={24} md={12}>
                                <Card size="small" title="Waste Capacity Utilization" style={{ borderRadius: 10 }}>
                                  <ResponsiveContainer width="100%" height={220}>
                                    <PieChart>
                                      <Pie
                                        data={capacityData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={80}
                                        paddingAngle={3}
                                        dataKey="value"
                                        label={({ name, value }) => `${name}: ${value.toLocaleString()}`}
                                      >
                                        {capacityData.map((_, i) => (
                                          <RCell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
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
              ...(detailViewRecord.slfGenerator
                ? [
                    {
                      key: "5",
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
                                <TeamOutlined /> Accredited Haulers
                              </Divider>
                              <Table
                                dataSource={baselineData.accreditedHaulers}
                                rowKey={(_, i) => i}
                                size="small"
                                pagination={false}
                                columns={[
                                  { title: "Hauler Name", dataIndex: "haulerName", key: "haulerName" },
                                  {
                                    title: "No. of Trucks",
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
    </div>
  );
}
