import { useState, useEffect, useMemo, useCallback } from 'react';
import { Alert, Badge, Button, Card, Col, Descriptions, Divider, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Row, Select, Space, Spin, Statistic, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { AlertOutlined, BankOutlined, BarChartOutlined, CheckCircleOutlined, ContainerOutlined, DatabaseOutlined, DeleteOutlined, EditOutlined, FileTextOutlined, HistoryOutlined, MailOutlined, MinusCircleOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SendOutlined, TableOutlined, TeamOutlined, UndoOutlined, WarningOutlined } from '@ant-design/icons';
import { PieChart, Pie, Cell as RCell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ResponsiveContainer } from 'recharts';
import dayjs from 'dayjs';
import api from '../../../api';
import { buildFilters, matchesFilter, rowMatchesSearch } from '../shared/tableFilters';
import { fetchAllSubmissions, getSubmissionVolumeSummary, getTruckCapacityText, getTruckPlateText, normalizeSubmissionRecord } from '../shared/submissionRecords';
import ResponsiveTable from '../shared/ResponsiveTable';
import { getSocket } from '../../../utils/socket';
import Swal from 'sweetalert2';
import { ACCENT, CHART_COLORS, normalizeUnit, isHazardousCellType, formatVolume } from './helpers.jsx';
import { buildFacilityCellUsage } from './SlfDashboardTab';
import {
  getRecordIds,
  expandSlfNames,
  getFacilitySlfNames,
  getSubmissionSlfId,
  getSubmissionSlfNames,
  normalizeSlfKey,
} from './SlfDashboardTab';

const { Text } = Typography;

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
  const [portalUsers, setPortalUsers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loadingSub, setLoadingSub] = useState(false);
  const [form] = Form.useForm();
  const [txnHistoryModal, setTxnHistoryModal] = useState({
    open: false,
    submissionId: null,
  });
  const [txnHistoryData, setTxnHistoryData] = useState([]);
  const [txnHistoryLoading, setTxnHistoryLoading] = useState(false);
  const [emailModal, setEmailModal] = useState({ open: false, record: null });
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [revertModal, setRevertModal] = useState({ open: false, record: null });
  const [revertReason, setRevertReason] = useState("");
  const [revertLoading, setRevertLoading] = useState(false);
  const [revertFollowUp, setRevertFollowUp] = useState({
    enabled: false,
    subject: "",
    message: "",
    temporaryDeleteAfterDays: 3,
  });
  const [submissionSearch, setSubmissionSearch] = useState("");
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState(null);
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);
  const unitOptions = [
    { label: "Tons", value: "tons" },
    {
      label: (
        <span>
          m<sup>3</sup>
        </span>
      ),
      value: "m³",
    },
  ];

  const fetchSubmissions = useCallback((showLoading = true) => {
    if (showLoading) setLoadingSub(true);
    // Paged. This panel is unscoped — it wants EVERY submission — and
    // `includeTrucks` is required because the expandable row renders each truck,
    // which put the whole collection at ~36 KB a record into one response. That
    // overran the MongoDB socket timeout and answered 500, and because the
    // rejection was swallowed below the panel simply rendered empty rather than
    // reporting anything.
    fetchAllSubmissions({ includeTrucks: true })
      .then((rows) => setSubmissions(rows.map(normalizeSubmissionRecord)))
      .catch(() => {})
      .finally(() => {
        if (showLoading) setLoadingSub(false);
      });
  }, []);

  const fetchGeneratorStats = useCallback(() => {
    api
      .get("/data-slf/generator-summary")
      .then(({ data }) => setPortalStats(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchGeneratorStats();
    api
      .get("/portal-users")
      .then(({ data }) => setPortalUsers(Array.isArray(data) ? data : []))
      .catch(() => setPortalUsers([]));
    fetchSubmissions();
  }, [fetchSubmissions, fetchGeneratorStats]);

  // Refresh quietly in the background so the table does not keep entering a
  // loading state. Live socket events drive immediate updates; the timer is a
  // gentle fallback so the Waste Generators view reflects newly submitted data.
  useEffect(() => {
    const refresh = () => {
      fetchSubmissions(false);
      fetchGeneratorStats();
    };
    const interval = setInterval(refresh, 60000);
    const socket = getSocket();
    const handler = ({ target } = {}) => {
      if (!target || target === "submissions") refresh();
    };
    if (socket) socket.on("data-refresh", handler);
    return () => {
      clearInterval(interval);
      if (socket) socket.off("data-refresh", handler);
    };
  }, [fetchSubmissions, fetchGeneratorStats]);

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

  const isAgedSubmission = (record) => dayjs().diff(dayjs(record?.createdAt), "day") >= 1;

  const getRevertFollowUpTemplate = (record) => ({
    enabled: isAgedSubmission(record),
    subject: "Follow-Up Required: Reverted SLF Submission {{idNo}}",
    message: [
      "Dear Portal User,",
      "",
      "This is a follow-up regarding your reverted SLF submission {{idNo}} for {{companyName}}.",
      "",
      "Reason for revert: {{reason}}",
      "",
      "Please log in to the SLF portal, update the reverted data, and submit the corrected entry on or before {{deadline}}. If no corrected submission is received by the deadline, the data will be temporarily moved to Deleted Submissions for admin review.",
      "",
      "Thank you.",
    ].join("\n"),
    temporaryDeleteAfterDays: 3,
  });

  const openRevertModal = (record) => {
    setRevertModal({ open: true, record });
    setRevertReason("");
    setRevertFollowUp(getRevertFollowUpTemplate(record));
  };

  const handleSendEmail = async () => {
    if (!emailSubject.trim() || !emailMessage.trim()) {
      Swal.fire(
        "Warning",
        "Please fill in both subject and message.",
        "warning",
      );
      return;
    }
    setEmailSending(true);
    try {
      await api.post(`/data-slf/${emailModal.record._id}/send-email`, {
        subject: emailSubject,
        message: emailMessage,
      });
      Swal.fire({
        icon: "success",
        title: "Email Sent",
        text: `Email sent to ${emailModal.record.submittedBy}`,
        confirmButtonColor: ACCENT,
        timer: 2500,
      });
      setEmailModal({ open: false, record: null });
    } catch (err) {
      Swal.fire(
        "Error",
        err.response?.data?.message || "Failed to send email",
        "error",
      );
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
        sendFollowUp: revertFollowUp.enabled,
        followUpSubject: revertFollowUp.subject,
        followUpMessage: revertFollowUp.message,
        temporaryDeleteAfterDays: revertFollowUp.temporaryDeleteAfterDays,
      });
      Swal.fire({
        icon: "success",
        title: "Reverted",
        text: "Submission reverted and the portal user has been notified via email.",
        confirmButtonColor: ACCENT,
        timer: 2500,
      });
      setRevertModal({ open: false, record: null });
      setRevertReason("");
      setRevertFollowUp({ enabled: false, subject: "", message: "", temporaryDeleteAfterDays: 3 });
      fetchSubmissions();
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

  const portalGeneratorCount = useMemo(
    () =>
      portalUsers.length
        ? portalUsers.filter((user) => user.status === "approved").length
        : generators.length,
    [generators.length, portalUsers],
  );

  const activePortalGeneratorCount = useMemo(
    () =>
      portalUsers.length
        ? portalUsers.filter(
            (user) =>
              user.status === "approved" &&
              !user.blocked &&
              !user.maintenanceMode,
          ).length
        : generators.filter((g) => g.isActive).length,
    [generators, portalUsers],
  );

  const filteredSubmissions = useMemo(() => {
    return submissions.filter((s) => {
      const matchStatus =
        !submissionStatusFilter || s.status === submissionStatusFilter;
      const matchSearch = rowMatchesSearch(s, submissionSearch);
      return matchStatus && matchSearch;
    });
  }, [submissions, submissionSearch, submissionStatusFilter]);

  const submissionWasteStats = useMemo(() => {
    let residual = 0,
      haz = 0,
      other = 0;
    submissions.forEach((s) => {
      (s.trucks || []).forEach((t) => {
        const wt = (t.wasteType || "").toLowerCase();
        if (wt.includes("haz") || wt.includes("inert"))
          haz += t.actualVolume || 0;
        else if (wt.includes("residual")) residual += t.actualVolume || 0;
        else other += t.actualVolume || 0;
      });
    });
    return { residual, haz, other };
  }, [submissions]);

  const portalCellSummaries = useMemo(() => {
    return generators
      .map((generator) => {
        const generatorId = String(generator._id || "");
        const facility = slfRecords.find((record) => {
          const ids = getRecordIds(record);
          const names = expandSlfNames(getFacilitySlfNames(record)).map(
            (name) => normalizeSlfKey(name),
          );
          return (
            ids.includes(generatorId) ||
            names.includes(normalizeSlfKey(generator.slfName))
          );
        });
        const generatorSubmissions = submissions.filter((submission) => {
          const submissionId = getSubmissionSlfId(submission);
          if (submissionId && submissionId === generatorId) return true;
          return getSubmissionSlfNames(submission).some(
            (name) =>
              normalizeSlfKey(name) === normalizeSlfKey(generator.slfName),
          );
        });
        const usage = facility?._cellUsageRows?.length
          ? {
              rows: facility._cellUsageRows,
              totalBaseline: Number(facility._baselineWasteReceived || 0),
              totalSubmissions: Number(facility._submissionWasteReceived || 0),
              total: Number(facility.actualResidualWasteReceived || 0),
              unit: facility.wasteReceivedUnit || "tons",
            }
          : buildFacilityCellUsage(
              { ...generator, lgu: generator.slfName, numberOfCell: 1 },
              null,
              generatorSubmissions,
            );

        return {
          key: generatorId || generator.slfName,
          slfName: generator.slfName,
          facility,
          rows: usage.rows.filter(
            (row) => row.status !== "Closed" || row.total > 0,
          ),
          totalBaseline: usage.totalBaseline,
          totalSubmissions: usage.totalSubmissions,
          total: usage.total,
          unit: usage.unit,
          submissionCount: generatorSubmissions.length,
        };
      })
      .filter(
        (item) =>
          item.submissionCount > 0 ||
          item.total > 0 ||
          item.facility?._cellUsageRows?.length > 0,
      );
  }, [generators, slfRecords, submissions]);

  const portalCellColumns = [
    {
      title: "Cell",
      dataIndex: "cellName",
      width: 130,
      render: (value, row) => (
        <Text strong>{value || `Cell ${row.index + 1}`}</Text>
      ),
    },
    {
      title: "Type",
      dataIndex: "type",
      width: 120,
      render: (value) => (
        <Tag color={isHazardousCellType(value) ? "red" : "blue"}>
          {isHazardousCellType(value) ? "Haz" : "Residual"}
        </Tag>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      render: (value) => (
        <Tag
          color={
            value === "Operational"
              ? "green"
              : value === "Closed"
                ? "default"
                : "gold"
          }
        >
          {value || "Operational"}
        </Tag>
      ),
    },
    {
      title: "Baseline",
      key: "baseline",
      align: "right",
      render: (_, row) => formatVolume(row.baseline, row.unit),
    },
    {
      title: "Submissions",
      key: "submissions",
      align: "right",
      render: (_, row) => (
        <Text strong style={{ color: "#2f54eb" }}>
          {formatVolume(row.submissions, row.unit)}
        </Text>
      ),
    },
    {
      title: "Total Fill",
      key: "total",
      align: "right",
      render: (_, row) => (
        <Text strong>{formatVolume(row.total, row.unit)}</Text>
      ),
    },
    {
      title: "Capacity",
      key: "capacity",
      align: "right",
      render: (_, row) =>
        row.capacity > 0 ? formatVolume(row.capacity, row.capacityUnit) : "—",
    },
  ];

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
          <Text strong style={{ fontSize: 12 }}>
            {t}
          </Text>
          {!r.isActive && (
            <Tag color="red" style={{ marginLeft: 6, fontSize: 9 }}>
              Inactive
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: "Linked Facility",
      width: 120,
      render: (_, r) => {
        const cnt = linkedFacilities[r._id] || 0;
        const fac = slfRecords.find((sr) => {
          const gid =
            typeof sr.slfGenerator === "object"
              ? sr.slfGenerator?._id
              : sr.slfGenerator;
          return gid === r._id;
        });
        return cnt > 0 ? (
          <div>
            <Tag
              color="geekblue"
              icon={<BankOutlined />}
              style={{ fontSize: 10 }}
            >
              {cnt} record{cnt > 1 ? "s" : ""}
            </Tag>
            {fac && (
              <div style={{ fontSize: 10, color: "#8c8c8c", marginTop: 2 }}>
                {fac.lgu || "—"}, {fac.province || ""}
              </div>
            )}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            —
          </Text>
        );
      },
    },
    {
      title: "Baseline Volume",
      width: 130,
      render: (_, r) => {
        const v = r.existingBaselineVolume ?? 0;
        return v > 0 ? (
          <Text style={{ fontSize: 12 }}>
            {v.toLocaleString()}{" "}
            <Text type="secondary" style={{ fontSize: 10 }}>
              {(r.existingBaselineUnit || "tons").replace("m3", "m³")}
            </Text>
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            —
          </Text>
        );
      },
    },
    {
      title: "Total Since Operation",
      width: 140,
      render: (_, r) => {
        const v = r.totalVolumeSinceOperation ?? 0;
        return v > 0 ? (
          <Text style={{ fontSize: 12 }}>
            {v.toLocaleString()}{" "}
            <Text type="secondary" style={{ fontSize: 10 }}>
              {(r.totalVolumeSinceOperationUnit || "tons").replace("m3", "m³")}
            </Text>
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            —
          </Text>
        );
      },
    },
    {
      title: "Accredited Haulers",
      width: 110,
      align: "center",
      render: (_, r) => {
        const cnt = r.accreditedHaulers?.length || 0;
        return cnt > 0 ? (
          <Tag color="blue">
            {cnt} hauler{cnt > 1 ? "s" : ""}
          </Tag>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            —
          </Text>
        );
      },
    },
    {
      title: "Submissions",
      width: 100,
      align: "center",
      render: (_, r) => {
        const st = statsMap[r._id];
        if (!st)
          return (
            <Text type="secondary" style={{ fontSize: 11 }}>
              -
            </Text>
          );
        return (
          <div style={{ lineHeight: 1.3 }}>
            <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
              {st.totalEntries}
            </Tag>
            {st.pendingCount > 0 && (
              <Tag
                color="orange"
                style={{ margin: "2px 0 0", fontSize: 10, display: "block" }}
              >
                Pending: {st.pendingCount} pending
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: "Status",
      width: 80,
      align: "center",
      dataIndex: "isActive",
      render: (v) =>
        v ? (
          <Tag color="success">Active</Tag>
        ) : (
          <Tag color="error">Inactive</Tag>
        ),
    },
    {
      title: "Actions",
      width: 100,
      render: (_, r) => (
        <Space size={4}>
          {canEdit && (
            <Tooltip title="Edit Generator">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined style={{ color: ACCENT }} />}
                onClick={() => openEdit(r)}
              />
            </Tooltip>
          )}
          {canDelete && (
            <Popconfirm
              title="Delete this generator?"
              onConfirm={() => handleDelete(r._id)}
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Delete">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
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

  const getSubmissionSlfLabel = (record) =>
    record.slfGenerator?.slfName ||
    record.slfGenerator?.lgu ||
    record.slfName ||
    "Unassigned SLF";

  const submittedDataSummary = useMemo(() => {
    const statusCounts = submissions.reduce((acc, submission) => {
      const status = submission.status || "pending";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const companySet = new Set();
    const haulerSet = new Set();
    const volumeByUnit = {};
    const generatorMap = new Map();
    let totalTrucks = 0;
    let latestSubmission = null;

    submissions.forEach((submission) => {
      if (submission.lguCompanyName) {
        companySet.add(submission.lguCompanyName.trim().toLowerCase());
      }
      const slfName = getSubmissionSlfLabel(submission);
      const current = generatorMap.get(slfName) || {
        name: slfName,
        submissions: 0,
        trucks: 0,
        volume: 0,
      };
      current.submissions += 1;
      if (
        !latestSubmission ||
        dayjs(submission.createdAt).isAfter(dayjs(latestSubmission.createdAt))
      ) {
        latestSubmission = submission;
      }

      (submission.trucks || []).forEach((truck) => {
        totalTrucks += 1;
        current.trucks += 1;
        if (truck.hauler) {
          haulerSet.add(truck.hauler.trim().toLowerCase());
        }
        const volume = Number(truck.actualVolume || 0);
        if (volume > 0) {
          const unit = normalizeUnit(truck.actualVolumeUnit || "tons");
          volumeByUnit[unit] = (volumeByUnit[unit] || 0) + volume;
          current.volume += volume;
        }
      });

      generatorMap.set(slfName, current);
    });

    const volumeText = Object.entries(volumeByUnit)
      .sort((a, b) => b[1] - a[1])
      .map(([unit, value]) => `${value.toLocaleString()} ${unit}`)
      .join(" / ");

    return {
      statusCounts,
      uniqueCompanies: companySet.size,
      uniqueHaulers: haulerSet.size,
      totalTrucks,
      averageTrucks: submissions.length
        ? (totalTrucks / submissions.length).toFixed(1)
        : "0",
      volumeText: volumeText || "No volume yet",
      latestSubmission,
      topGenerators: [...generatorMap.values()]
        .sort((a, b) => b.submissions - a.submissions || b.volume - a.volume)
        .slice(0, 5),
    };
  }, [submissions]);

  const subColumns = [
    {
      title: "ID No.",
      dataIndex: "idNo",
      width: 160,
      render: (t) => (
        <Text strong style={{ fontSize: 11, fontFamily: "monospace" }}>
          {t}
        </Text>
      ),
    },
    {
      title: "SLF / Generator",
      key: "slfName",
      width: 150,
      render: (_, r) => {
        const label = getSubmissionSlfLabel(r);
        return label !== "Unassigned SLF" ? (
          <Tag
            icon={<BankOutlined />}
            color="geekblue"
            style={{ fontSize: 10 }}
          >
            {label}
          </Tag>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            —
          </Text>
        );
      },
      filters: generators.map((g) => ({ text: g.slfName, value: g._id })),
      onFilter: (val, r) => matchesFilter(r.slfGenerator?._id || r.slfGenerator, val),
    },
    {
      title: "Company",
      dataIndex: "lguCompanyName",
      ellipsis: true,
      render: (v, r) => (
        <div style={{ lineHeight: 1.3 }}>
          <Text style={{ fontSize: 12 }}>{v || "—"}</Text>
          {r.companyType && (
            <div>
              <Tag
                style={{ fontSize: 9, marginTop: 2 }}
                color={r.companyType === "LGU" ? "blue" : "purple"}
              >
                {r.companyType}
              </Tag>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "Date",
      dataIndex: "dateOfDisposal",
      width: 100,
      render: (v) =>
        v ? (
          <Text style={{ fontSize: 11 }}>{dayjs(v).format("MM/DD/YYYY")}</Text>
        ) : (
          "—"
        ),
      sorter: (a, b) =>
        new Date(a.dateOfDisposal || 0) - new Date(b.dateOfDisposal || 0),
    },
    {
      title: "Trucks",
      width: 65,
      align: "center",
      render: (_, r) => {
        const cnt = r.trucks?.length || 0;
        return cnt > 0 ? (
          <Tag color="cyan">{cnt}</Tag>
        ) : (
          <Text type="secondary">0</Text>
        );
      },
    },
    {
      title: "Volume",
      width: 110,
      render: (_, r) => {
        const summary = getSubmissionVolumeSummary(r);
        return summary ? (
          <Text strong style={{ fontSize: 12, color: "#2f54eb" }}>
            {summary}
          </Text>
        ) : (
          "—"
        );
      },
      sorter: (a, b) => {
        const va = (a.trucks || []).reduce(
          (s, t) => s + (t.actualVolume || 0),
          0,
        );
        const vb = (b.trucks || []).reduce(
          (s, t) => s + (t.actualVolume || 0),
          0,
        );
        return va - vb;
      },
    },
    {
      title: "Waste Types",
      width: 140,
      render: (_, r) => {
        const trucks = r.trucks || [];
        const residual = trucks.filter(
          (t) =>
            !(t.wasteType || "").toLowerCase().includes("haz") &&
            !(t.wasteType || "").toLowerCase().includes("inert"),
        );
        const haz = trucks.filter(
          (t) =>
            (t.wasteType || "").toLowerCase().includes("haz") ||
            (t.wasteType || "").toLowerCase().includes("inert"),
        );
        if (!trucks.length)
          return (
            <Text type="secondary" style={{ fontSize: 11 }}>
              —
            </Text>
          );
        return (
          <Space size={4} wrap>
            {residual.length > 0 && (
              <Tag color="green" style={{ fontSize: 10 }}>
                <CheckCircleOutlined /> {residual.length} Residual
              </Tag>
            )}
            {haz.length > 0 && (
              <Tag color="red" style={{ fontSize: 10 }}>
                <WarningOutlined /> {haz.length} Haz/Inert
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 110,
      render: (v, r) => {
        const color =
          v === "acknowledged"
            ? "green"
            : v === "rejected"
              ? "red"
              : v === "reverted"
                ? "volcano"
                : v === "revert_requested"
                  ? "gold"
                  : "orange";
        return (
          <div>
            <Tag color={color} style={{ fontSize: 10 }}>
              {v}
            </Tag>
            {r.revertRequested && (
              <Tag
                color="gold"
                style={{ fontSize: 9, marginTop: 2, display: "block" }}
              >
                Revert Req.
              </Tag>
            )}
          </div>
        );
      },
      filters: [
        { text: "Pending", value: "pending" },
        { text: "Acknowledged", value: "acknowledged" },
        { text: "Rejected", value: "rejected" },
        { text: "Reverted", value: "reverted" },
      ],
      onFilter: (val, r) => matchesFilter(r.status, val),
    },
    {
      title: "Submitted",
      dataIndex: "createdAt",
      width: 110,
      render: (v) =>
        v ? (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {dayjs(v).format("MM/DD/YYYY")}
          </Text>
        ) : (
          "—"
        ),
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
              <Button
                type="text"
                size="small"
                icon={<HistoryOutlined style={{ color: "#722ed1" }} />}
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
                onClick={() => openRevertModal(r)}
              />
            </Tooltip>
          )}
          {r.revertRequested && (
            <Tooltip
              title={`Revert requested: ${r.revertReason || "No reason"}`}
            >
              <Popconfirm
                title="Approve Revert?"
                description="This will set the submission back to Pending for the portal user to edit."
                onConfirm={async () => {
                  try {
                    await api.patch(`/data-slf/${r._id}/approve-revert`);
                    fetchSubmissions();
                    Swal.fire({
                      icon: "success",
                      title: "Reverted",
                      text: "Submission reverted to Pending.",
                      confirmButtonColor: ACCENT,
                      timer: 2000,
                    });
                  } catch (err) {
                    Swal.fire({
                      icon: "error",
                      title: "Error",
                      text: err.response?.data?.message || "Failed to revert",
                    });
                  }
                }}
                okText="Approve Revert"
                okButtonProps={{
                  style: { background: "#fa8c16", borderColor: "#fa8c16" },
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={
                    <Badge dot>
                      <UndoOutlined style={{ color: "#fa8c16" }} />
                    </Badge>
                  }
                />
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
      {/* -- Summary Stats -------------------------------------------- */}
      <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card
            size="small"
            style={{ borderRadius: 10, borderLeft: `3px solid ${ACCENT}` }}
            bodyStyle={{ padding: "10px 14px" }}
          >
            <Statistic
              title={<span style={{ fontSize: 11 }}>Total Generators</span>}
              value={portalGeneratorCount}
              styles={{ content: { fontSize: 20 } }}
              prefix={
                <DatabaseOutlined style={{ color: ACCENT, fontSize: 13 }} />
              }
            />
            <Text type="secondary" style={{ fontSize: 10 }}>
              {activePortalGeneratorCount} active portal accounts
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card
            size="small"
            style={{ borderRadius: 10, borderLeft: "3px solid #1677ff" }}
            bodyStyle={{ padding: "10px 14px" }}
          >
            <Statistic
              title={<span style={{ fontSize: 11 }}>Total Submissions</span>}
              value={overallStats.totalEntries}
              styles={{ content: { fontSize: 20 } }}
              prefix={
                <FileTextOutlined style={{ color: "#1677ff", fontSize: 13 }} />
              }
            />
            <Text type="secondary" style={{ fontSize: 10 }}>
              {submissions.length} entries loaded
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card
            size="small"
            style={{ borderRadius: 10, borderLeft: "3px solid #faad14" }}
            bodyStyle={{ padding: "10px 14px" }}
          >
            <Statistic
              title={<span style={{ fontSize: 11 }}>Pending Reviews</span>}
              value={overallStats.pendingCount}
              styles={{ content: { fontSize: 20, color: "#faad14" } }}
              prefix={
                <AlertOutlined style={{ color: "#faad14", fontSize: 13 }} />
              }
            />
            <Text type="secondary" style={{ fontSize: 10 }}>
              Awaiting acknowledgement
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card
            size="small"
            style={{ borderRadius: 10, borderLeft: "3px solid #52c41a" }}
            bodyStyle={{ padding: "10px 14px" }}
          >
            <Statistic
              title={<span style={{ fontSize: 11 }}>Acknowledged</span>}
              value={overallStats.acknowledgedCount}
              styles={{ content: { fontSize: 20, color: "#52c41a" } }}
              prefix={
                <CheckCircleOutlined
                  style={{ color: "#52c41a", fontSize: 13 }}
                />
              }
            />
            <Text type="secondary" style={{ fontSize: 10 }}>
              Confirmed submissions
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card
            size="small"
            style={{ borderRadius: 10, borderLeft: "3px solid #fa8c16" }}
            bodyStyle={{ padding: "10px 14px" }}
          >
            <Statistic
              title={<span style={{ fontSize: 11 }}>Revert Requests</span>}
              value={revertRequestCount}
              styles={{ content: {
                fontSize: 20,
                color: revertRequestCount > 0 ? "#fa8c16" : undefined,
              } }}
              prefix={
                <UndoOutlined style={{ color: "#fa8c16", fontSize: 13 }} />
              }
            />
            <Text type="secondary" style={{ fontSize: 10 }}>
              Pending revert approval
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card
            size="small"
            style={{ borderRadius: 10, borderLeft: "3px solid #722ed1" }}
            bodyStyle={{ padding: "10px 14px" }}
          >
            <Statistic
              title={<span style={{ fontSize: 11 }}>Total Volume</span>}
              value={overallStats.totalVolume}
              styles={{ content: { fontSize: 20, color: "#722ed1" } }}
              prefix={
                <DatabaseOutlined style={{ color: "#722ed1", fontSize: 13 }} />
              }
              formatter={(v) => Number(v).toLocaleString()}
            />
            <Text type="secondary" style={{ fontSize: 10 }}>
              <Tag color="green" style={{ fontSize: 9 }}>
                R: {submissionWasteStats.residual.toLocaleString()}
              </Tag>
              <Tag color="red" style={{ fontSize: 9 }}>
                H: {submissionWasteStats.haz.toLocaleString()}
              </Tag>
            </Text>
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        style={{ borderRadius: 10, marginBottom: 18 }}
        bodyStyle={{ padding: 18 }}
        title={
          <Space wrap>
            <BarChartOutlined style={{ color: ACCENT }} />
            <Text strong>Submission Summary</Text>
            <Tag variant="filled" color="blue">
              Based on submitted portal data
            </Tag>
          </Space>
        }
      >
        <Row gutter={[18, 18]} align="stretch">
          <Col xs={24} md={8}>
            <div
              style={{
                border: "1px solid #f0f0f0",
                borderRadius: 8,
                height: "100%",
                padding: 14,
              }}
            >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Statistic
                title="Encoded Waste Volume"
                value={submittedDataSummary.volumeText}
                styles={{ content: { fontSize: 18, color: "#722ed1" } }}
                prefix={<DatabaseOutlined />}
              />
              <Space size={[6, 6]} wrap>
                <Tag color="green">
                  Residual: {submissionWasteStats.residual.toLocaleString()}
                </Tag>
                <Tag color="red">
                  Haz/Inert: {submissionWasteStats.haz.toLocaleString()}
                </Tag>
                {submissionWasteStats.other > 0 && (
                  <Tag color="default">
                    Other: {submissionWasteStats.other.toLocaleString()}
                  </Tag>
                )}
              </Space>
            </Space>
            </div>
          </Col>
          <Col xs={24} md={8}>
            <div
              style={{
                border: "1px solid #f0f0f0",
                borderRadius: 8,
                height: "100%",
                padding: 14,
              }}
            >
            <Row gutter={[10, 10]}>
              {[
                {
                  label: "Companies",
                  value: submittedDataSummary.uniqueCompanies,
                  icon: <TeamOutlined />,
                  color: "#1677ff",
                },
                {
                  label: "Haulers",
                  value: submittedDataSummary.uniqueHaulers,
                  icon: <ContainerOutlined />,
                  color: "#13c2c2",
                },
                {
                  label: "Truck Trips",
                  value: submittedDataSummary.totalTrucks,
                  icon: <TableOutlined />,
                  color: "#fa8c16",
                },
                {
                  label: "Avg Trips",
                  value: submittedDataSummary.averageTrucks,
                  icon: <BarChartOutlined />,
                  color: "#52c41a",
                },
              ].map((item) => (
                <Col xs={12} key={item.label}>
                  <div
                    style={{
                      border: "1px solid #f0f0f0",
                      borderRadius: 8,
                      padding: "10px 12px",
                      height: "100%",
                    }}
                  >
                    <Space size={6}>
                      <span style={{ color: item.color }}>{item.icon}</span>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.label}
                      </Text>
                    </Space>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: item.color,
                        lineHeight: 1.2,
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
            </div>
          </Col>
          <Col xs={24} md={8}>
            <div
              style={{
                border: "1px solid #f0f0f0",
                borderRadius: 8,
                height: "100%",
                padding: 14,
              }}
            >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Text strong>Submission Status</Text>
              {STATUS_OPTS.filter((opt) => opt.value).map((opt) => {
                const count = submittedDataSummary.statusCounts[opt.value] || 0;
                const percent = submissions.length
                  ? Math.round((count / submissions.length) * 100)
                  : 0;
                return (
                  <div key={opt.value}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 3,
                      }}
                    >
                      <Text style={{ fontSize: 12 }}>{opt.label}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {count}
                      </Text>
                    </div>
                    <Progress
                      percent={percent}
                      size="small"
                      showInfo={false}
                      strokeColor={
                        opt.color === "green"
                          ? "#52c41a"
                          : opt.color === "red"
                            ? "#ff4d4f"
                            : opt.color === "volcano"
                              ? "#fa541c"
                              : "#faad14"
                      }
                    />
                  </div>
                );
              })}
            </Space>
            </div>
          </Col>
        </Row>
        <Divider style={{ margin: "18px 0" }} />
        <Row gutter={[18, 18]}>
          <Col xs={24} lg={14}>
            <Text strong>Top SLFs by Submitted Entries</Text>
            <Space
              direction="vertical"
              size={8}
              style={{ width: "100%", marginTop: 8 }}
            >
              {submittedDataSummary.topGenerators.length ? (
                submittedDataSummary.topGenerators.map((item, index) => (
                  <div key={item.name}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <Text style={{ fontSize: 12 }}>
                        {index + 1}. {item.name}
                      </Text>
                      <Text strong style={{ fontSize: 12, color: ACCENT }}>
                        {item.submissions} submissions
                      </Text>
                    </div>
                    <Progress
                      percent={Math.round(
                        (item.submissions /
                          Math.max(
                            submittedDataSummary.topGenerators[0]
                              ?.submissions || 1,
                            1,
                          )) *
                          100,
                      )}
                      showInfo={false}
                      size="small"
                      strokeColor={ACCENT}
                    />
                  </div>
                ))
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No submitted entries yet"
                />
              )}
            </Space>
          </Col>
          <Col xs={24} lg={10}>
            <Alert
              type="info"
              showIcon
              message="Latest Submitted Record"
              description={
                submittedDataSummary.latestSubmission
                  ? `${submittedDataSummary.latestSubmission.idNo || "No ID"} - ${submittedDataSummary.latestSubmission.lguCompanyName || "Unnamed company"} submitted ${dayjs(submittedDataSummary.latestSubmission.createdAt).format("MM/DD/YYYY hh:mm A")}`
                  : "No portal submissions loaded yet."
              }
              style={{ borderRadius: 8 }}
            />
          </Col>
        </Row>
      </Card>

      {/* -- Portal Submissions ------------------------------------------ */}
      <Card
        size="small"
        style={{ borderRadius: 10 }}
        bodyStyle={{ padding: 0 }}
        title={
          <Space wrap>
            <FileTextOutlined style={{ color: ACCENT }} />
            <Text strong>Portal Submitted Data</Text>
            <Tag variant="filled" color="blue">
              {filteredSubmissions.length} / {submissions.length}
            </Tag>
            {revertRequestCount > 0 && (
              <Badge
                count={revertRequestCount}
                style={{ backgroundColor: "#fa8c16" }}
                title="Revert requests pending"
              />
            )}
          </Space>
        }
        extra={
          <Tooltip title="Refresh submissions">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => fetchSubmissions(true)}
              loading={loadingSub}
            />
          </Tooltip>
        }
      >
        {/* Toolbar: search + status chips */}
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
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
                type={
                  submissionStatusFilter === opt.value ? "primary" : "default"
                }
                onClick={() => setSubmissionStatusFilter(opt.value)}
                style={
                  submissionStatusFilter === opt.value
                    ? { background: ACCENT, borderColor: ACCENT }
                    : {}
                }
              >
                {opt.label}
                {opt.value && (
                  <Tag variant="filled"
                    color={
                      submissionStatusFilter === opt.value
                        ? undefined
                        : opt.color
                    }
                    style={{ marginLeft: 4, fontSize: 10, padding: "0 4px" }}
                  >
                    {submissions.filter((s) => s.status === opt.value).length}
                  </Tag>
                )}
              </Button>
            ))}
          </Space>
        </div>
        <ResponsiveTable
          dataSource={filteredSubmissions}
          rowKey="_id"
          loading={loadingSub}
          size="small"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t) => `${t} entries`,
            pageSizeOptions: ["10", "20", "50"],
          }}
          expandedRowKeys={expandedRowKeys}
          onExpandedRowsChange={setExpandedRowKeys}
          expandable={{
            expandedRowRender: (r) => {
              const trucks = r.trucks || [];
              if (!trucks.length)
                return (
                  <Empty
                    description="No truck entries"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                );
              return (
                <div style={{ padding: "8px 16px" }}>
                  <Table
                    dataSource={trucks}
                    rowKey={(_, i) => i}
                    size="small"
                    pagination={false}
                    columns={[
                      {
                        title: "Ticket No.",
                        dataIndex: "disposalTicketNo",
                        width: 130,
                        render: (v) => (
                          <Text
                            style={{ fontSize: 11, fontFamily: "monospace" }}
                          >
                            {v || "—"}
                          </Text>
                        ),
                      },
                      {
                        title: "Hauler",
                        dataIndex: "hauler",
                        ellipsis: true,
                        render: (v) => v || "—",
                      },
                      {
                        title: "Plate No.",
                        width: 110,
                        render: (_, t) => getTruckPlateText(t),
                      },
                      {
                        title: "Truck Cap.",
                        width: 100,
                        render: (_, t) => getTruckCapacityText(t),
                      },
                      {
                        title: "Actual Volume",
                        width: 110,
                        render: (_, t) =>
                          t.actualVolume != null ? (
                            <Text strong style={{ color: "#2f54eb" }}>
                              {t.actualVolume}{" "}
                              {(t.actualVolumeUnit || "tons").replace(
                                "m3",
                                "m³",
                              )}
                            </Text>
                          ) : (
                            "—"
                          ),
                      },
                      {
                        title: "Waste Type",
                        dataIndex: "wasteType",
                        width: 130,
                        render: (v) =>
                          v ? (
                            <Tag
                              color={
                                (v || "").toLowerCase().includes("haz") ||
                                (v || "").toLowerCase().includes("inert")
                                  ? "red"
                                  : "green"
                              }
                              style={{ fontSize: 10 }}
                            >
                              {v}
                            </Tag>
                          ) : (
                            "—"
                          ),
                      },
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
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin />
          </div>
        ) : txnHistoryData.length === 0 ? (
          <Empty description="No transactions found" />
        ) : (
          <Table
            dataSource={txnHistoryData}
            rowKey={(t) => t._id}
            size="small"
            pagination={{
              pageSize: 10,
              size: "small",
              showSizeChanger: true,
              pageSizeOptions: ["10", "20", "50"],
            }}
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
                  <Tag variant="filled"
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
                        color: t.meta?.comment
                          ? isDark
                            ? "#7eb8da"
                            : "#1a3353"
                          : "#fa541c",
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
                    {dayjs(v).format("MM/DD/YYYY hh:mm A")}
                  </Text>
                ),
              },
            ]}
          />
        )}
      </Modal>

      {/* Send Email Modal */}
      <Modal
        title={
          <Space>
            <MailOutlined /> Send Email to Portal User
          </Space>
        }
        open={emailModal.open}
        onCancel={() => setEmailModal({ open: false, record: null })}
        onOk={handleSendEmail}
        confirmLoading={emailSending}
        okText={
          <>
            <SendOutlined /> Send Email
          </>
        }
        okButtonProps={{ style: { background: ACCENT, borderColor: ACCENT } }}
        width={560}
      >
        {emailModal.record && (
          <div>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="To">
                {emailModal.record.submittedBy}
              </Descriptions.Item>
              <Descriptions.Item label="Company">
                {emailModal.record.lguCompanyName || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Submission">
                {emailModal.record.submissionId || emailModal.record.idNo}
              </Descriptions.Item>
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
        title={
          <Space>
            <UndoOutlined style={{ color: "#fa541c" }} /> Revert Submission
          </Space>
        }
        open={revertModal.open}
        onCancel={() => {
          setRevertModal({ open: false, record: null });
          setRevertFollowUp({ enabled: false, subject: "", message: "", temporaryDeleteAfterDays: 3 });
        }}
        onOk={handleAdminRevert}
        confirmLoading={revertLoading}
        okText="Revert Submission"
        okButtonProps={{
          style: { background: "#fa541c", borderColor: "#fa541c" },
        }}
        width={680}
      >
        {revertModal.record && (
          <div>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="ID No.">
                {revertModal.record.idNo || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Company">
                {revertModal.record.lguCompanyName || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Submitted By">
                {revertModal.record.submittedBy || "—"}
              </Descriptions.Item>
              <Descriptions.Item label="Current Status">
                <Tag
                  color={
                    revertModal.record.status === "acknowledged"
                      ? "green"
                      : "orange"
                  }
                >
                  {revertModal.record.status}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
            <Text
              type="secondary"
              style={{ fontSize: 12, display: "block", marginBottom: 8 }}
            >
              This will revert the submission back to the portal user. The
              portal user will see this entry on their Submission History and
              can update and resubmit it.
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
              {isAgedSubmission(revertModal.record) && (
                <Card size="small" style={{ borderRadius: 8, background: "#fff7e6", borderColor: "#ffd591" }}>
                  <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Alert
                      type="warning"
                      showIcon
                      message="This submission is at least 1 day old. A follow-up email template can be sent with a temporary deletion deadline."
                    />
                    <Form.Item label="Send follow-up email" style={{ marginBottom: 0 }}>
                      <Switch
                        checked={revertFollowUp.enabled}
                        onChange={(enabled) => setRevertFollowUp((prev) => ({ ...prev, enabled }))}
                      />
                    </Form.Item>
                    {revertFollowUp.enabled && (
                      <>
                        <Form.Item label="Follow-Up Subject" required>
                          <Input
                            value={revertFollowUp.subject}
                            onChange={(e) => setRevertFollowUp((prev) => ({ ...prev, subject: e.target.value }))}
                          />
                        </Form.Item>
                        <Form.Item label="Follow-Up Message" required>
                          <Input.TextArea
                            rows={7}
                            value={revertFollowUp.message}
                            onChange={(e) => setRevertFollowUp((prev) => ({ ...prev, message: e.target.value }))}
                          />
                        </Form.Item>
                        <Form.Item label="Temporarily delete after (days)" style={{ maxWidth: 220 }}>
                          <InputNumber
                            min={1}
                            precision={0}
                            value={revertFollowUp.temporaryDeleteAfterDays}
                            onChange={(value) => setRevertFollowUp((prev) => ({ ...prev, temporaryDeleteAfterDays: value || 1 }))}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          Available tokens: {"{{idNo}}"}, {"{{companyName}}"}, {"{{reason}}"}, {"{{deadline}}"}
                        </Text>
                      </>
                    )}
                  </Space>
                </Card>
              )}
            </Form>
          </div>
        )}
      </Modal>
    </>
  );
}

// -- Main Component --

export default PortalGenerators;
