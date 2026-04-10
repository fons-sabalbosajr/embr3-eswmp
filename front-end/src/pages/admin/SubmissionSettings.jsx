import { useState, useEffect, useRef } from "react";
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
  Progress,
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
  DatabaseOutlined,
  TeamOutlined,
  IdcardOutlined,
  InboxOutlined,
  BankOutlined,
  ReloadOutlined,
  HistoryOutlined,
  UndoOutlined,
  ExclamationCircleOutlined,
  PieChartOutlined,
} from "@ant-design/icons";
import { exportToExcel } from "../../utils/exportExcel";
import Swal from "sweetalert2";
import api from "../../api";
import secureStorage from "../../utils/secureStorage";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { Option } = Select;
const ACCENT = "#2f54eb";
const CACHE_KEY = "submissions-cache";
const CACHE_TTL = 10 * 60 * 1000;

export default function SubmissionSettings() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const fetchingRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewRecord, setViewRecord] = useState(null);
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
  // Address cascading dropdowns for admin edit
  const [addrRegions, setAddrRegions] = useState([]);
  const [addrProvinces, setAddrProvinces] = useState([]);
  const [addrMunicipalities, setAddrMunicipalities] = useState([]);
  const [addrBarangays, setAddrBarangays] = useState([]);
  // Resolved address names for view details
  const [resolvedAddr, setResolvedAddr] = useState({});

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 20000);
    return () => clearInterval(interval);
  }, []);

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

  const fetchData = async (skipCache = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      if (!skipCache) {
        const cached = secureStorage.getJSON(CACHE_KEY);
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setData(cached.data);
          setLoading(false);
          return;
        }
      }
      const { data: result } = await api.get("/data-slf");
      setData(result);
      secureStorage.setJSON(CACHE_KEY, { data: result, ts: Date.now() });
    } catch {
      Swal.fire("Error", "Could not load submissions", "error");
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const { data: updated } = await api.patch(`/data-slf/${id}/status`, {
        status,
      });
      setData((prev) => prev.map((d) => (d._id === id ? updated : d)));
      secureStorage.remove(CACHE_KEY);
      secureStorage.invalidateDashboard();
      Swal.fire({
        icon: "success",
        title: `Submission ${status}`,
        timer: 1000,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not update status", "error");
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/data-slf/${id}`);
      setData((prev) => prev.filter((d) => d._id !== id));
      secureStorage.remove(CACHE_KEY);
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
    const pendingIds = selectedRowKeys.filter((id) => {
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
    try {
      const { data: result } = await api.patch("/data-slf/bulk-status", {
        ids: pendingIds,
        status: "acknowledged",
      });
      setData((prev) =>
        prev.map((d) => {
          const updated = result.data.find((u) => u._id === d._id);
          return updated || d;
        }),
      );
      secureStorage.remove(CACHE_KEY);
      secureStorage.invalidateDashboard();
      setSelectedRowKeys([]);
      Swal.fire({
        icon: "success",
        title: `${result.data.length} entries acknowledged`,
        timer: 1500,
        showConfirmButton: false,
      });
    } catch {
      Swal.fire("Error", "Could not acknowledge entries", "error");
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

  const openEdit = (record) => {
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
      secureStorage.remove(CACHE_KEY);
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
      Swal.fire({
        icon: "success",
        title: "Reverted",
        text: "Submission reverted and the portal user has been notified via email.",
        confirmButtonColor: ACCENT,
        timer: 2500,
      });
      setRevertModal({ open: false, record: null });
      setRevertReason("");
      fetchData(true);
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

  const filtered = data.filter((d) => {
    const matchSearch =
      d.idNo?.toLowerCase().includes(search.toLowerCase()) ||
      d.lguCompanyName?.toLowerCase().includes(search.toLowerCase()) ||
      d.submittedBy?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || d.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusColors = {
    pending: "orange",
    acknowledged: "green",
    rejected: "red",
    reverted: "volcano",
  };

  const columns = [
    {
      title: (
        <>
          <IdcardOutlined /> ID No.
        </>
      ),
      dataIndex: "idNo",
      key: "idNo",
      width: 120,
      render: (text) => (
        <Text strong style={{ fontSize: 12 }}>
          {text}
        </Text>
      ),
    },
    {
      title: (
        <>
          <BankOutlined /> LGU/Company
        </>
      ),
      dataIndex: "lguCompanyName",
      key: "lguCompanyName",
      ellipsis: true,
      width: 300,
    },
    {
      title: "Type",
      dataIndex: "companyType",
      key: "companyType",
      width: 80,
      render: (v) => (
        <Tag color={v === "LGU" ? "blue" : "purple"} bordered={false}>
          {v}
        </Tag>
      ),
    },
    {
      title: (
        <>
          <CalendarOutlined /> Disposal Date
        </>
      ),
      dataIndex: "dateOfDisposal",
      key: "dateOfDisposal",
      width: 130,
      render: (val) => (val ? dayjs(val).format("MMM DD, YYYY") : "—"),
    },
    {
      title: (
        <>
          <CarOutlined /> Trucks
        </>
      ),
      key: "trucks",
      width: 70,
      render: (_, r) => r.trucks?.length || 0,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (val) => (
        <Tag color={statusColors[val] || "default"}>
          {val?.charAt(0).toUpperCase() + val?.slice(1)}
        </Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 220,
      render: (_, r) => (
        <Space size={4} wrap={false}>
          <Tooltip title="View Details">
            <Button
              size="small"
              icon={<EyeOutlined />}
              style={{ borderColor: ACCENT, color: ACCENT }}
              onClick={() => setViewRecord(r)}
            />
          </Tooltip>
          {r.submissionId && (
            <Tooltip title="Transaction History">
              <Button
                size="small"
                icon={<HistoryOutlined />}
                style={{ borderColor: "#722ed1", color: "#722ed1" }}
                onClick={() => openTxnHistory(r.submissionId)}
              />
            </Tooltip>
          )}
          {r.status === "pending" && (
            <>
              <Tooltip title="Edit">
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  style={{ borderColor: ACCENT, color: ACCENT }}
                  onClick={() => openEdit(r)}
                />
              </Tooltip>
              <Tooltip title="Acknowledge">
                <Button
                  size="small"
                  icon={<CheckOutlined />}
                  style={{ borderColor: "#52c41a", color: "#52c41a" }}
                  onClick={() => updateStatus(r._id, "acknowledged")}
                />
              </Tooltip>
              <Tooltip title="Reject">
                <Button
                  size="small"
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => updateStatus(r._id, "rejected")}
                />
              </Tooltip>
            </>
          )}
          {r.status !== "reverted" && r.status !== "pending" && (
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
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <div>
          <Title level={4} style={{ marginBottom: 4 }}>
            <InboxOutlined /> Submission Management
          </Title>
          <Text type="secondary">
            View, edit, acknowledge, or reject client portal submissions
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => fetchData(true)}
          loading={loading}
          size="small"
        >
          Refresh
        </Button>
      </div>

      <Card style={{ marginTop: 16, borderRadius: 10 }}>
        <Space style={{ marginBottom: 16, flexWrap: "wrap" }}>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const rows = filtered.map((d) => ({
                "ID No.": d.idNo,
                "LGU/Company": d.lguCompanyName,
                "Company Type": d.companyType,
                "Date of Disposal": d.dateOfDisposal
                  ? dayjs(d.dateOfDisposal).format("YYYY-MM-DD")
                  : "",
                Status: d.status,
                Trucks: d.trucks?.length || 0,
                "Submitted By": d.submittedBy || "",
                "Submitted At": d.createdAt
                  ? dayjs(d.createdAt).format("YYYY-MM-DD HH:mm")
                  : "",
              }));
              exportToExcel(rows, "Submissions");
            }}
          >
            Export Excel
          </Button>
          <Input
            placeholder="Search by ID, company, or email..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 300 }}
            allowClear
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: "100%", maxWidth: 160 }}
          >
            <Option value="all">All Statuses</Option>
            <Option value="pending">Pending</Option>
            <Option value="acknowledged">Acknowledged</Option>
            <Option value="rejected">Rejected</Option>
            <Option value="reverted">Reverted</Option>
          </Select>
          {selectedRowKeys.length > 0 && (
            <Button
              type="primary"
              icon={<CheckOutlined />}
              style={{ background: "#52c41a", borderColor: "#52c41a" }}
              onClick={handleBulkAcknowledge}
            >
              Acknowledge Selected ({selectedRowKeys.length})
            </Button>
          )}
        </Space>

        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={{ pageSize: 15 }}
          size="middle"
          scroll={{ x: 900 }}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        />
      </Card>

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
              {viewRecord?.status === "pending" && (
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
                    onClick={() => {
                      updateStatus(viewRecord._id, "acknowledged");
                      setViewRecord(null);
                    }}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    danger
                    icon={<CloseOutlined />}
                    onClick={() => {
                      updateStatus(viewRecord._id, "rejected");
                      setViewRecord(null);
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
              <Button onClick={() => setViewRecord(null)}>Close</Button>
            </Space>
          </div>
        }
        width={820}
        style={{ maxWidth: "95vw" }}
        styles={{ body: { padding: 0 } }}
      >
        {viewRecord &&
          (() => {
            const r = viewRecord;
            const totalVolume = (r.trucks || []).reduce(
              (s, t) => s + (t.actualVolume || 0),
              0,
            );
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
                          {r.idNo}
                        </Text>
                      </div>
                      <Text
                        style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}
                      >
                        {r.lguCompanyName} &middot;{" "}
                        {r.dateOfDisposal
                          ? dayjs(r.dateOfDisposal).format("MMM DD, YYYY")
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
                            ? dayjs(r.createdAt).format("MMM DD, YYYY hh:mm A")
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
                          background: "#f0f5ff",
                          borderRadius: 8,
                          padding: "12px 14px",
                          border: "1px solid #d6e4ff",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
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
                          background: "#f6ffed",
                          borderRadius: 8,
                          padding: "12px 14px",
                          border: "1px solid #d9f7be",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Truck Entries
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{ fontSize: 18, color: "#52c41a" }}
                          >
                            {r.trucks?.length || 0}
                          </Text>
                        </div>
                      </div>
                    </Col>
                    <Col xs={8}>
                      <div
                        style={{
                          background: "#fff7e6",
                          borderRadius: 8,
                          padding: "12px 14px",
                          border: "1px solid #ffe7ba",
                          minHeight: 72,
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          Total Volume
                        </Text>
                        <div style={{ marginTop: 4 }}>
                          <Text
                            strong
                            style={{ fontSize: 18, color: "#fa8c16" }}
                          >
                            {totalVolume > 0
                              ? totalVolume.toLocaleString()
                              : "0"}
                          </Text>{" "}
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            tons
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
                        children: (
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
                                    Total Volume Accepted
                                  </Text>
                                  <Text strong style={{ fontSize: 13 }}>
                                    {r.totalVolumeAccepted != null
                                      ? `${r.totalVolumeAccepted.toLocaleString()} ${(r.totalVolumeAcceptedUnit || "m³").replace("m3", "m³")}`
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
                                    Active Cell — Residual
                                  </Text>
                                  <Text strong style={{ fontSize: 13 }}>
                                    {r.activeCellResidualVolume != null
                                      ? `${r.activeCellResidualVolume.toLocaleString()} ${(r.activeCellResidualUnit || "m³").replace("m3", "m³")}`
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
                                    Active Cell — Inert
                                  </Text>
                                  <Text strong style={{ fontSize: 13 }}>
                                    {r.activeCellInertVolume != null
                                      ? `${r.activeCellInertVolume.toLocaleString()} ${(r.activeCellInertUnit || "m³").replace("m3", "m³")}`
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
                                    Closed Cell — Residual
                                  </Text>
                                  <Text strong style={{ fontSize: 13 }}>
                                    {r.closedCellResidualVolume != null
                                      ? `${r.closedCellResidualVolume.toLocaleString()} ${(r.closedCellResidualUnit || "m³").replace("m3", "m³")}`
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
                                    Closed Cell — Inert
                                  </Text>
                                  <Text strong style={{ fontSize: 13 }}>
                                    {r.closedCellInertVolume != null
                                      ? `${r.closedCellInertVolume.toLocaleString()} ${(r.closedCellInertUnit || "m³").replace("m3", "m³")}`
                                      : "—"}
                                  </Text>
                                </div>
                              </Col>
                            </Row>
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
                                    style={{ fontSize: 13, color: "#262626" }}
                                  >
                                    Accredited Haulers (
                                    {r.accreditedHaulers.length})
                                  </Text>
                                </div>
                                <Table
                                  dataSource={r.accreditedHaulers}
                                  rowKey={(_, i) => i}
                                  size="small"
                                  pagination={false}
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
                                                  capacityUnit: h.capacityUnit,
                                                },
                                              ]
                                            : [];
                                      return vehicles.length > 0 ? (
                                        <Table
                                          dataSource={vehicles}
                                          rowKey={(_, vi) => vi}
                                          size="small"
                                          pagination={false}
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
                                              render: (v) => v || "—",
                                            },
                                            {
                                              title: "Vehicle Type",
                                              dataIndex: "vehicleType",
                                              key: "type",
                                              render: (v) => v || "—",
                                            },
                                            {
                                              title: "Capacity",
                                              key: "cap",
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
                                      render: (v) => <Text strong>{v}</Text>,
                                    },
                                    {
                                      title: "No. of Trucks",
                                      dataIndex: "numberOfTrucks",
                                      key: "numberOfTrucks",
                                      width: 110,
                                      render: (v) => v ?? "—",
                                    },
                                    {
                                      title: "Office Address",
                                      dataIndex: "officeAddress",
                                      key: "officeAddress",
                                      render: (v) => v || "—",
                                    },
                                    {
                                      title: "Private Sector Clients",
                                      dataIndex: "privateSectorClients",
                                      key: "privateSectorClients",
                                      render: (v) => {
                                        const arr = Array.isArray(v)
                                          ? v
                                          : v
                                            ? [v]
                                            : [];
                                        return arr.length > 0
                                          ? arr.join(", ")
                                          : "—";
                                      },
                                    },
                                  ]}
                                />
                              </>
                            )}
                          </div>
                        ),
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
                                          color: "#8c8c8c",
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
                                            ? `${truckVol.toLocaleString()} tons`
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
                              rowKey={(_, i) => i}
                              size="small"
                              pagination={false}
                              scroll={{ x: 700 }}
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
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Hauler",
                                  dataIndex: "hauler",
                                  key: "hauler",
                                  render: (v) => <Text strong>{v || "—"}</Text>,
                                },
                                {
                                  title: "Plate No.",
                                  dataIndex: "plateNumber",
                                  key: "plate",
                                  render: (v) => v || "—",
                                },
                                {
                                  title: "Capacity",
                                  key: "cap",
                                  render: (_, t) =>
                                    t.truckCapacity
                                      ? `${t.truckCapacity} ${(t.truckCapacityUnit || "m³").replace("m3", "m³")}`
                                      : "—",
                                },
                                {
                                  title: "Volume",
                                  key: "vol",
                                  render: (_, t) =>
                                    t.actualVolume != null ? (
                                      <Text strong style={{ color: "#52c41a" }}>
                                        {t.actualVolume}{" "}
                                        {t.actualVolumeUnit || "tons"}
                                      </Text>
                                    ) : (
                                      "—"
                                    ),
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
                  {r.submissionId && (
                    <Button
                      block
                      icon={<HistoryOutlined />}
                      style={{
                        borderColor: "#722ed1",
                        color: "#722ed1",
                        marginTop: 8,
                        marginBottom: 8,
                      }}
                      onClick={() => openTxnHistory(r.submissionId)}
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
        width={900}
        style={{ maxWidth: "95vw" }}
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" size="small">
          <Collapse
            defaultActiveKey={["disposal", "company", "operations", "baseline", "trucks"]}
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
                            background: "#f0f5ff",
                            borderRadius: 6,
                            padding: "8px 14px",
                            border: "1px solid #d6e4ff",
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
                        <DatePicker style={{ width: "100%" }} />
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
                        <Select>
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
                        <Select>
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
                    <Col xs={12} sm={12}>
                      <Form.Item
                        name="totalVolumeAccepted"
                        label="Total Volume of Waste Accepted"
                      >
                        <InputNumber min={0} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={6} sm={6}>
                      <Form.Item name="totalVolumeAcceptedUnit" label="Unit">
                        <Select>
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
                      <Form.Item name="activeCellResidualUnit" label="Unit">
                        <Select>
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
                      <Form.Item name="activeCellInertUnit" label="Unit">
                        <Select>
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
                      <Form.Item name="closedCellResidualUnit" label="Unit">
                        <Select>
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
                      <Form.Item name="closedCellInertUnit" label="Unit">
                        <Select>
                          <Option value="m³">m³</Option>
                          <Option value="tons">Tons</Option>
                        </Select>
                      </Form.Item>
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
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "#f0f5ff",
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
                        color: t.meta?.comment ? "#1a3353" : "#fa541c",
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

      {/* ── Admin Revert Modal ── */}
      <Modal
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "#fff2e8",
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
                background: "#fff7e6",
                border: "1px solid #ffe7ba",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
              }}
            >
              <Space align="start">
                <ExclamationCircleOutlined
                  style={{ color: "#fa8c16", marginTop: 2 }}
                />
                <Text style={{ fontSize: 12, color: "#8c6d1f" }}>
                  This will revert the submission back to the portal user. They
                  will be notified via email and can update and resubmit the
                  entry.
                </Text>
              </Space>
            </div>
            <div
              style={{
                background: "#fafafa",
                borderRadius: 8,
                padding: "14px 16px",
                marginBottom: 16,
                border: "1px solid #f0f0f0",
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
                      {revertModal.record.idNo || "—"}
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
    </div>
  );
}
